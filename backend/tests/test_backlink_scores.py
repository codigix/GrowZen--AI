"""DataForSEO figures on saved backlink checks: filled for rows that have none, kept with the row, and a lookup that found nothing is not remembered."""
import pytest

from app.services import backlink_checker as bc


@pytest.fixture()
def bid(client):
    return client.post("/api/v1/businesses", json={"name": "Scores Co", "website": "https://scores.example"}).json()["id"]


def _row(bid, url, state="working", scores=None):
    from app.db import SessionLocal
    from app.models import BacklinkCheck
    db = SessionLocal()
    try:
        db.add(BacklinkCheck(business_id=bid, source_url=url, target="scores.example", state=state, data={"source_url": url, "state": state, **({"scores": scores} if scores else {})}, checks=1))
        db.commit()
    finally:
        db.close()


def test_missing_figures_are_filled_for_every_row_including_pages_that_did_not_open(client, bid, monkeypatch):
    _row(bid, "https://blog-a.example/post-1")
    _row(bid, "https://blog-a.example/post-2", state="page_error")
    _row(bid, "https://blog-b.example/x", scores={"da": 12, "pa": 5, "spam": 3, "source": "DataForSEO"})
    monkeypatch.setattr(bc, "dfs_configured", lambda: True)
    seen = {}

    def fake(domains, pages):
        seen["domains"], seen["pages"] = domains, pages
        out = {d: {"rank": 40, "spam": 7} for d in domains}
        out.update({p: {"rank": 22, "spam": None} for p in pages})
        return out

    monkeypatch.setattr(bc, "dfs_scores", fake)
    before = client.get(f"/api/v1/businesses/{bid}/backlink-check").json()
    assert before["missing_scores"] == 2
    r = client.post(f"/api/v1/businesses/{bid}/backlink-check/scores").json()
    assert r["filled"] == 2 and r["tried"] == 2 and r["left"] == 0
    assert "blog-a.example" in seen["domains"] and "https://blog-a.example/post-2" in seen["pages"]  # the page that would not open is included
    after = client.get(f"/api/v1/businesses/{bid}/backlink-check").json()
    assert after["missing_scores"] == 0
    by = {x["source_url"]: x for x in after["rows"]}
    assert by["https://blog-a.example/post-1"]["scores"] == {"da": 40, "pa": 22, "spam": 7, "source": "DataForSEO"}
    assert by["https://blog-b.example/x"]["scores"]["da"] == 12  # a row that already had figures is left alone


def test_a_lookup_that_found_nothing_is_not_cached(monkeypatch):
    monkeypatch.setattr(bc, "dfs_configured", lambda: True)
    bc._DFS.clear()
    calls = []

    def call(endpoint, targets):
        calls.append(endpoint)
        return {}  # DataForSEO had no item for the target

    monkeypatch.setattr(bc, "_dfs_call", call)
    assert bc.dfs_scores(["nothing.example"], [])["nothing.example"] == {"rank": None, "spam": None}
    bc.dfs_scores(["nothing.example"], [])
    assert calls.count("bulk_ranks") == 2  # asked again, not remembered as empty
    monkeypatch.setattr(bc, "_dfs_call", lambda e, t: {"nothing.example": {"rank": 300, "spam_score": 9}})
    assert bc.dfs_scores(["nothing.example"], [])["nothing.example"]["rank"] == 30
    bc._DFS.clear()


def test_each_check_adds_a_point_to_the_links_history(client, bid, monkeypatch):
    url = "https://blog-h.example/post"
    states = iter(["working", "link_missing", "working"])

    def fake_check(sources, target):
        st = next(states)
        return [{"source_url": url, "final_url": url, "state": st, "follow": "dofollow" if st == "working" else None, "links": [{"href": "https://scores.example/"}] if st == "working" else [],
                 "http_status": 200, "checked_at": "2026-11-18T10:00:00+00:00"}], None

    monkeypatch.setattr(bc, "check_many", fake_check)
    for _ in range(3):
        r = client.post(f"/api/v1/businesses/{bid}/backlink-check", json={"sources": [url]})
        assert r.status_code == 200
    row = client.get(f"/api/v1/businesses/{bid}/backlink-check").json()["rows"][0]
    assert [h["state"] for h in row["history"]] == ["working", "link_missing", "working"]
    assert row["history"][0]["links"] == 1 and row["history"][1]["links"] == 0 and row["checks"] == 3
    assert "crawler" in row  # what the crawler knows (empty when it has not seen this page)


def test_dataforseo_is_not_paid_for_pages_that_moz_already_answered(client, bid, monkeypatch):
    url_a, url_b = "https://blog-m.example/a", "https://blog-n.example/b"
    monkeypatch.setattr(bc, "dfs_configured", lambda: True)
    asked = {}

    def fake_check(sources, target):
        base = {"final_url": None, "follow": "dofollow", "links": [], "http_status": 200, "checked_at": "2026-11-18T10:00:00+00:00", "state": "working"}
        return [{**base, "source_url": url_a, "moz": {"da": 33, "pa": 21, "spam": 2}}, {**base, "source_url": url_b, "moz": None}], "Moz has no quota"

    def fake_dfs(domains, pages):
        asked["domains"], asked["pages"] = list(domains), list(pages)
        return {**{d: {"rank": 40, "spam": 7} for d in domains}, **{p: {"rank": 22, "spam": None} for p in pages}}

    monkeypatch.setattr(bc, "check_many", fake_check)
    monkeypatch.setattr(bc, "dfs_scores", fake_dfs)
    client.post(f"/api/v1/businesses/{bid}/backlink-check", json={"sources": [url_a, url_b]})
    assert asked["pages"] == [url_b] and asked["domains"] == ["blog-n.example"]  # only the page Moz could not answer
    rows = {x["source_url"]: x for x in client.get(f"/api/v1/businesses/{bid}/backlink-check").json()["rows"]}
    assert rows[url_a]["moz"]["da"] == 33 and not rows[url_a].get("scores")
    assert rows[url_b]["scores"]["da"] == 40


def test_filling_missing_figures_asks_moz_once_per_site_then_dataforseo_for_the_rest(client, bid, monkeypatch):
    _row(bid, "https://one.example/x")
    _row(bid, "https://one.example/y")  # same site: one Moz lookup serves both pages
    _row(bid, "https://two.example/y")
    monkeypatch.setattr(bc, "dfs_configured", lambda: True)
    monkeypatch.setattr(bc, "moz_configured", lambda: True)
    asked = []

    def moz(urls):
        asked.append(list(urls))
        return {"one.example/": {"da": 50, "pa": 30, "spam": 1, "ref_domains": 10}}  # Moz knows one.example only

    monkeypatch.setattr(bc, "moz_metrics", moz)
    monkeypatch.setattr(bc, "dfs_scores", lambda domains, pages: {**{d: {"rank": 40, "spam": 7} for d in domains}, **{p: {"rank": 22, "spam": None} for p in pages}})
    r = client.post(f"/api/v1/businesses/{bid}/backlink-check/scores").json()
    assert r["filled"] == 3 and r["tried"] == 3
    assert len(asked) == 1 and sorted(asked[0]) == ["https://one.example/", "https://two.example/"]  # one lookup per site, not per page
    rows = {x["source_url"]: x for x in client.get(f"/api/v1/businesses/{bid}/backlink-check").json()["rows"]}
    for u in ("https://one.example/x", "https://one.example/y"):
        assert rows[u]["moz"]["da"] == 50 and rows[u]["moz"]["spam"] == 1 and rows[u]["moz"]["pa"] is None and rows[u]["moz"]["site_level"] is True
    assert rows["https://two.example/y"]["scores"]["da"] == 40 and not rows["https://two.example/y"].get("moz")


def test_figures_dataforseo_supplied_while_moz_had_no_quota_are_replaced_by_moz_later(client, bid, monkeypatch):
    _row(bid, "https://swap.example/p", scores={"da": 5, "pa": 2, "spam": 30, "source": "DataForSEO"})
    monkeypatch.setattr(bc, "dfs_configured", lambda: True)
    monkeypatch.setattr(bc, "moz_configured", lambda: True)
    assert client.get(f"/api/v1/businesses/{bid}/backlink-check").json()["missing_scores"] == 1  # Moz can answer now, so this stand-in is to be replaced
    monkeypatch.setattr(bc, "moz_metrics", lambda urls: {"swap.example/": {"da": 61, "pa": 40, "spam": 2, "ref_domains": 99}})
    r = client.post(f"/api/v1/businesses/{bid}/backlink-check/scores").json()
    assert r["filled"] == 1
    row = client.get(f"/api/v1/businesses/{bid}/backlink-check").json()["rows"][0]
    assert row["moz"]["da"] == 61 and client.get(f"/api/v1/businesses/{bid}/backlink-check").json()["missing_scores"] == 0


def test_a_page_no_service_can_answer_takes_the_figures_known_for_its_site(client, bid, monkeypatch):
    _row(bid, "https://shared.example/one", scores={"da": 7, "pa": 3, "spam": 38, "source": "DataForSEO"})
    _row(bid, "https://shared.example/two")
    _row(bid, "https://other.example/x")
    monkeypatch.setattr(bc, "dfs_configured", lambda: True)

    def down(domains, pages):
        raise bc.CheckError("Your DataForSEO balance is empty: add funds in its Billing section, then try again.")

    monkeypatch.setattr(bc, "dfs_scores", down)
    r = client.post(f"/api/v1/businesses/{bid}/backlink-check/scores").json()
    assert r["filled"] == 1 and r["tried"] == 2 and "balance is empty" in r["note"]
    rows = {x["source_url"]: x for x in client.get(f"/api/v1/businesses/{bid}/backlink-check").json()["rows"]}
    two = rows["https://shared.example/two"]["scores"]
    assert two["da"] == 7 and two["spam"] == 38 and two["pa"] is None and two["site_level"] is True
    assert not rows["https://other.example/x"].get("scores")  # nothing known for that site


def test_a_recheck_that_cannot_get_new_figures_keeps_the_old_ones(client, bid, monkeypatch):
    url = "https://keep.example/p"
    _row(bid, url, scores={"da": 12, "pa": 9, "spam": 4, "source": "DataForSEO"})
    monkeypatch.setattr(bc, "dfs_configured", lambda: True)
    monkeypatch.setattr(bc, "dfs_scores", lambda d, p: (_ for _ in ()).throw(bc.CheckError("balance is empty")))
    monkeypatch.setattr(bc, "check_many", lambda sources, target: ([{"source_url": url, "final_url": None, "state": "working", "follow": "dofollow", "links": [], "http_status": 200, "checked_at": "2026-11-18T10:00:00+00:00"}], None))
    client.post(f"/api/v1/businesses/{bid}/backlink-check", json={"sources": [url]})
    row = client.get(f"/api/v1/businesses/{bid}/backlink-check").json()["rows"][0]
    assert row["scores"]["da"] == 12 and row["scores"]["pa"] == 9
