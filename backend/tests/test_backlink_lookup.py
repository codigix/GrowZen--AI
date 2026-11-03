"""Fuzzy lookup of stored backlinks by domain, URL or word: GET /backlink-intel/lookup. Searches the whole table (every business); reads the database only."""
import pytest
from sqlalchemy import func, select

from app.backlinks import lookup
from app.backlinks.models import BiTrackedTarget
from app.backlinks.repository import LinkRecord, upsert_imported_link
from app.db import SessionLocal
from app.models import Business
from test_backlinks import _wipe


@pytest.fixture()
def db():
    """Leaves the shared test database as it found it: the backlink tables are emptied and the businesses these tests create are removed
    (other tests, e.g. the copilot's first-50-businesses reports, count the businesses that exist)."""
    s = SessionLocal()
    _wipe(s)
    first_new = (s.scalar(select(func.max(Business.id))) or 0) + 1
    yield s
    s.rollback()
    _wipe(s)
    s.query(Business).filter(Business.id >= first_new).delete()
    s.commit()
    s.close()


def _link(db, source, target, anchor=None, rel=()):
    upsert_imported_link(db, LinkRecord(source, target, anchor, list(rel)), "manual_import")


@pytest.fixture()
def biz(client, db):
    bid = client.post("/api/v1/businesses", json={"name": "Lookup Co"}).json()["id"]
    for d in ("codigix.co", "codigixinfotech.com", "client.com"):
        db.add(BiTrackedTarget(business_id=bid, domain=d))
    db.commit()
    _link(db, "https://hospital.org/", "https://codigix.co/", "Codigix infotech Pvt Ltd")
    _link(db, "https://hospital.org/about", "https://codigix.co/", "Codigix infotech Pvt Ltd")
    _link(db, "https://news.net/post", "https://codigix.co/blog/seo", "SEO guide", rel=["nofollow"])
    _link(db, "https://dir.example/list", "https://codigixinfotech.com/", "Web agency")
    _link(db, "https://blog.codigix.co/x", "https://client.com/", "great client")  # comes FROM a codigix domain
    _link(db, "https://other.org/", "https://client.com/pricing", "Pricing")  # unrelated to the word
    db.commit()
    return client, "/api/v1/backlink-intel/lookup"


def _urls(r):
    return {(d["source_url"], d["target_url"]) for d in r["data"]}


def test_a_word_finds_everything_related_to_it_and_nothing_else(biz):
    client, url = biz
    r = client.get(url, params={"q": "codigix"}).json()
    assert r["summary"]["total_backlinks"] == 5 and r["summary"]["referring_domains"] == 4
    assert ("https://other.org/", "https://client.com/pricing") not in _urls(r)
    assert {m["domain"] for m in r["matched_domains"]["as_target"]} == {"codigix.co", "codigixinfotech.com"}
    assert [m["domain"] for m in r["matched_domains"]["as_source"]] == ["codigix.co"]
    assert r["interpreted_as"]["type"] == "word"
    assert all(d["match_score"] >= 85 and d["matched_on"] for d in r["data"])
    first = r["matched_domains"]["as_target"][0]
    assert first["domain"] == "codigix.co" and first["backlinks"] == 3 and first["score"] >= 92  # the closer domain ranks first


def test_links_to_and_from_the_matching_domain_both_come_back(biz):
    client, url = biz
    r = client.get(url, params={"q": "codigix"}).json()
    assert ("https://blog.codigix.co/x", "https://client.com/") in _urls(r)  # a link FROM a codigix domain
    assert ("https://hospital.org/", "https://codigix.co/") in _urls(r)  # a link TO one
    from_side = next(d for d in r["data"] if d["source_url"] == "https://blog.codigix.co/x")
    assert "source_domain" in from_side["matched_on"] and "target_domain" not in from_side["matched_on"]


def test_typos_still_match_and_unrelated_words_do_not(biz):
    client, url = biz
    typo = client.get(url, params={"q": "codigx"}).json()
    assert typo["summary"]["total_backlinks"] >= 4 and "codigix.co" in {m["domain"] for m in typo["matched_domains"]["as_target"]}
    assert client.get(url, params={"q": "zzzqqq"}).json()["summary"]["total_backlinks"] == 0


def test_a_domain_a_www_domain_and_a_url_all_work(biz):
    client, url = biz
    for q in ("codigix.co", "www.codigix.co", "https://codigix.co/", "https://www.codigix.co"):
        r = client.get(url, params={"q": q}).json()
        assert r["interpreted_as"]["type"] == "domain" and r["interpreted_as"]["term"] == "codigix.co", q
        assert r["summary"]["total_backlinks"] >= 3, q
    r = client.get(url, params={"q": "https://codigix.co/blog"}).json()  # a path: matched against the stored URLs
    assert r["interpreted_as"] == {"type": "url", "term": "codigix.co", "path": "/blog"}
    assert _urls(r) == {("https://news.net/post", "https://codigix.co/blog/seo")} and r["data"][0]["match_score"] == 100


def test_anchor_text_matches_and_limit_returns_the_top_results(biz):
    client, url = biz
    r = client.get(url, params={"q": "web agency"}).json()  # the phrase as typed is searched in anchor text
    assert _urls(r) == {("https://dir.example/list", "https://codigixinfotech.com/")} and "anchor_text" in r["data"][0]["matched_on"]
    r = client.get(url, params={"q": "pricing"}).json()
    assert _urls(r) == {("https://other.org/", "https://client.com/pricing")} and {"anchor_text", "target_url"} <= set(r["data"][0]["matched_on"])
    top = client.get(url, params={"q": "codigix", "limit": 2}).json()
    assert len(top["data"]) == 2 and top["summary"]["returned"] == 2 and top["summary"]["total_backlinks"] == 5  # top 2 of 5, total still shown
    assert all(d["match_score"] >= 92 for d in top["data"])  # the best matches come first
    assert client.get(url, params={"q": "codigix"}).json()["summary"]["returned"] == 5  # default limit is 10


def test_it_searches_the_whole_table_across_businesses_and_untracked_domains(client, db, biz):
    """No business scoping: a backlink to a domain that no business tracks is found, and so is one that belongs to another business."""
    c, url = biz
    other = client.post("/api/v1/businesses", json={"name": "Someone Else"}).json()["id"]
    db.add(BiTrackedTarget(business_id=other, domain="shop.example"))
    db.commit()
    _link(db, "https://reviews.net/shop", "https://shop.example/", "Great shop")  # another business's backlink
    _link(db, "https://random.org/", "https://untracked-codigix-fan.com/", "fan")  # to a domain nobody tracks
    db.commit()
    assert _urls(c.get(url, params={"q": "shop.example"}).json()) == {("https://reviews.net/shop", "https://shop.example/")}
    r = c.get(url, params={"q": "codigix"}).json()
    assert ("https://random.org/", "https://untracked-codigix-fan.com/") in _urls(r) and r["summary"]["total_backlinks"] == 6
    assert "businesses" not in url  # the URL carries no business id


def test_bad_input_is_rejected(biz):
    client, url = biz
    assert client.get(url, params={"q": "codigix", "limit": 0}).status_code == 422
    assert client.get(url, params={"q": "codigix", "limit": lookup.MAX_LIMIT + 1}).status_code == 422
    assert client.get(url, params={"q": "codigix", "limit": lookup.MAX_LIMIT}).status_code == 200
    assert client.get(url, params={"q": "a"}).status_code == 422  # one character is too short to search for
    assert client.get(url, params={"q": "100%_off"}).status_code == 200  # LIKE wildcards in the query are taken literally


def test_an_empty_query_or_star_lists_every_backlink(biz):
    client, url = biz
    for params in ({}, {"q": ""}, {"q": "*"}, {"q": "  *  "}):
        r = client.get(url, params={**params, "limit": 5000}).json()
        assert r["interpreted_as"] == {"type": "all", "term": None, "path": None}, params
        assert r["summary"]["total_backlinks"] == 6 and r["summary"]["returned"] == 6, params  # all six links in the fixture, matching or not
        assert ("https://other.org/", "https://client.com/pricing") in _urls(r)
        assert all(d["direction"] is None and d["matched_on"] == [] and d["match_score"] is None for d in r["data"])
        assert "inbound" not in r["summary"]  # direction only means something relative to a search
    top = client.get(url, params={"q": "*", "limit": 2}).json()  # the limit still applies, and the total still shows everything
    assert len(top["data"]) == 2 and top["summary"]["returned"] == 2 and top["summary"]["total_backlinks"] == 6


def test_a_link_out_to_a_page_named_after_the_query_is_outbound_not_inbound(biz, db):
    """codigix.co linking to facebook.com/codigix.infotech: the URL contains "codigix" but the link comes FROM codigix.co."""
    client, url = biz
    _link(db, "https://codigix.co/", "https://www.facebook.com/codigix.infotech", "Facebook")
    _link(db, "https://fan.example/", "https://www.facebook.com/codigix.infotech", "our friends")  # someone else linking to that page
    db.commit()
    r = client.get(url, params={"q": "codigix"}).json()
    by_source = {(d["source_url"], d["target_url"]): d["direction"] for d in r["data"]}
    assert by_source[("https://codigix.co/", "https://www.facebook.com/codigix.infotech")] == "outbound"
    assert by_source[("https://fan.example/", "https://www.facebook.com/codigix.infotech")] == "inbound"  # a link to a codigix-named page from elsewhere
    assert r["summary"]["inbound"] == sum(d["direction"] == "inbound" for d in r["data"]) and r["summary"]["outbound"] == sum(d["direction"] == "outbound" for d in r["data"])
    labels = [d["direction"] for d in r["data"]]
    assert labels == sorted(labels, key=lambda x: x != "inbound")  # all inbound results before any outbound one


def test_each_result_is_labelled_inbound_or_outbound_and_inbound_comes_first(biz):
    client, url = biz
    r = client.get(url, params={"q": "codigix"}).json()
    labels = [d["direction"] for d in r["data"]]
    assert labels == ["inbound"] * 4 + ["outbound"]  # the link FROM blog.codigix.co is last
    assert r["summary"]["inbound"] == 4 and r["summary"]["outbound"] == 1 and r["summary"]["total_backlinks"] == 5
    out = next(d for d in r["data"] if d["direction"] == "outbound")
    assert out["source_url"] == "https://blog.codigix.co/x"
    top = client.get(url, params={"q": "codigix", "limit": 2}).json()  # the top results are real backlinks, not outbound links
    assert {d["direction"] for d in top["data"]} == {"inbound"} and top["summary"]["inbound"] == 4
    r = client.get(url, params={"q": "web agency"}).json()  # found only by its anchor text: neither side matched
    assert [d["direction"] for d in r["data"]] == ["other"] and r["summary"]["inbound"] == 0 and r["summary"]["outbound"] == 0


def test_scoring_and_parsing_helpers():
    assert lookup.score_domain("codigix", "codigix.co") == 100 and lookup.score_domain("codigix.co", "codigix.co") == 100
    assert lookup.score_domain("codigix", "codigixinfotech.com") == 97 and lookup.score_domain("infotech", "codigixinfotech.com") == 92
    assert 70 <= lookup.score_domain("codigx", "codigix.co") < 92 and lookup.score_domain("codigx", "google.com") < 70
    assert lookup.score_domain("ab", "abc.com") == 97 and lookup.score_domain("ab", "xyz.com") == 0  # too short for typo tolerance
    assert lookup.parse_query("  HTTPS://WWW.Codigix.co/Blog/?a=1 ").path == "/blog?a=1"
    q = lookup.parse_query("codigix  Infotech")
    assert (q.term, q.phrase) == ("codigixinfotech", "codigix infotech")
    assert lookup.like_pattern("50%_x") == "%50\%\_x%"
    with pytest.raises(ValueError):
        lookup.parse_query("   ")
