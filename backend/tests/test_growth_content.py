"""Keywords, content, metadata, sitemap and backlinks as growth issues (offline)."""
from datetime import date, datetime, timezone

import pytest

from app.db import SessionLocal
from app.models import Article, Business, Keyword, Post
from app.services import growth_content as gc, growth_issues as gi

TODAY = date(2026, 11, 13)


@pytest.fixture
def project(client):
    r = client.post("/api/v1/businesses", json={"name": "Rental Co", "city": "Pune", "website": "https://rental.example", "contact_email": "o@rental.example"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def page(url, **o):
    base = {"url": url, "status": 200, "title": f"Title for {url} page", "title_length": 30, "meta_description": "d" * 100, "meta_description_length": 100, "h1_count": 1, "og_image": "/x.jpg", "canonical": url, "images_missing_alt": []}
    base.update(o)
    return base


# ------------------------------------------------------------------------------------------------------------------- pure rules
def test_keyword_matching_ignores_filler_words_and_plurals():
    corpus = gc._corpus(["We rent designer lehengas for weddings in Pune"])
    assert gc.has_keyword(corpus, "best lehenga rental in pune") is False  # 'rental' is not 'rent'
    assert gc.has_keyword(corpus, "designer lehenga in pune") is True
    assert gc.has_keyword(corpus, "") is False


def test_metadata_probes_find_real_page_problems_and_the_sitemap():
    crawl = {"sitemap": False, "crawled": 3, "sitemap_urls": 0, "pages": [
        page("https://x.example/", title="", title_length=0), page("https://x.example/a", title="Same title here for both", title_length=24), page("https://x.example/b", title="Same title here for both", title_length=24, meta_description="", h1_count=0)]}
    p = gc.probes(crawl)
    assert p["meta.title_missing"]["items"] == ["/"] and set(p["meta.title_duplicate"]["items"]) == {"/a", "/b"}
    assert p["meta.desc_missing"]["items"] == ["/b"] and p["meta.h1_missing"]["items"] == ["/b"] and p["sitemap.missing"]["severity"] == "serious"
    assert gc.probes({"sitemap": True, "crawled": 10, "sitemap_urls": 3, "pages": [page("https://x.example/")]})["sitemap.incomplete"]
    assert gc.probes({"pages": []}) == {}  # no crawl, no claims


def test_noindex_and_error_pages_are_not_judged():
    crawl = {"sitemap": True, "crawled": 2, "sitemap_urls": 2, "pages": [page("https://x.example/", status=404, title=""), page("https://x.example/p", noindex=True, title="")]}
    assert gc.probes(crawl) == {}


# ------------------------------------------------------------------------------------------------------------------- the issues
def test_keyword_issues_and_where_keywords_are_missing(project, monkeypatch):
    monkeypatch.setattr(gc, "_crawl", lambda db, b: {"pages": [page("https://rental.example/lehenga", title="Designer lehenga rental in Pune", h1="Lehenga rental")], "sitemap": True, "crawled": 1, "sitemap_urls": 1, "_found": "2026-11-10"})
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        db.add_all([Keyword(business_id=project, keyword="lehenga rental in pune", volume=300, tracked=True), Keyword(business_id=project, keyword="rental co", volume=50, tracked=True)])
        db.add(Post(business_id=project, post_type="Update", body="New arrivals this week", status="published"))
        db.commit()
        out = {i["key"]: i for i in gc.issues(db, b, None)}
        assert out["fix.kw.few"]["severity"] == "serious" and out["fix.kw.few"]["link"] == "/keyword-management/discover"
        assert "fix.kw.ungrouped" in out and "fix.kw.no_target" in out
        assert "lehenga/rental" not in out["fix.kw.no_target"]["why"] and "https://rental.example/lehenga" in out["fix.kw.no_target"]["why"]  # suggests the page that already covers it
        assert out["fix.kw.use.posts"]["verify"]["keywords"] == ["lehenga rental in pune"]  # the brand keyword is not asked for
        assert "fix.kw.use.website" not in out  # the crawl shows the keyword on a page title
        assert out["fix.kw.use.blog"]["link"] == "/ai-content-generation/blog" and out["fix.blog.none"]["verify"]["type"] == "articles_since"
        assert out["fix.comp.none"]["link"] == "/gmb-profile/competitors"
    finally:
        db.close()


def test_grouping_fills_blanks_only_and_assigns_a_page_only_when_exactly_one_covers_it(project, monkeypatch):
    monkeypatch.setattr(gc, "_crawl", lambda db, b: {"pages": [page("https://rental.example/lehenga", title="Designer lehenga rental", h1="Lehenga"), page("https://rental.example/sherwani", title="Sherwani rental", h1="Sherwani")]})
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        db.add_all([Keyword(business_id=project, keyword="lehenga rental in pune", tracked=True), Keyword(business_id=project, keyword="designer lehenga rental", tracked=True),
                    Keyword(business_id=project, keyword="sherwani rental pune", tracked=True, cluster="Men", target_url="https://rental.example/custom"), Keyword(business_id=project, keyword="rental pune", tracked=True)])
        db.commit()
        res = gc.group_keywords(db, b)
        db.commit()
        rows = {k.keyword: k for k in db.query(Keyword).filter_by(business_id=project)}
        assert rows["lehenga rental in pune"].cluster == rows["designer lehenga rental"].cluster == "Lehenga"
        assert rows["sherwani rental pune"].cluster == "Men" and rows["sherwani rental pune"].target_url == "https://rental.example/custom"  # a person's choice is never overwritten
        assert rows["designer lehenga rental"].target_url == "https://rental.example/lehenga"
        assert rows["rental pune"].target_url is None  # both pages say "rental": not exactly one
        assert res["grouped"] == 3
        assert gc.verify(db, b, {"type": "kw_grouped"}, None, TODAY)["passed"] is True
    finally:
        db.close()


def test_irrelevant_competitor_keywords_are_not_suggested(project, monkeypatch):
    from app.services import keywords
    monkeypatch.setattr(keywords, "competitor_research", lambda db, b: {"summary": {}})
    monkeypatch.setattr(keywords, "competitor_ideas", lambda r: [{"keyword": "local search engine", "strength": 80, "reason": "x"}, {"keyword": "bridal lehenga rental pune", "strength": 95, "reason": "rival ranks"}, {"keyword": "rental co", "strength": 90, "reason": "x"}])
    monkeypatch.setattr(gc, "_crawl", lambda db, b: {})
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        b.description = "Bridal lehenga rental"
        db.commit()
        got = [g["keyword"] for g in gc._gap_ideas(db, b, {"rental co"})]
        assert got == ["bridal lehenga rental pune"]
    finally:
        db.close()


def test_a_javascript_site_gets_check_first_for_heading_and_alt_findings(project, monkeypatch):
    monkeypatch.setattr(gc, "_crawl", lambda db, b: {"pages": [page("https://rental.example/", h1_count=0), page("https://rental.example/a", title="Another title for a", h1_count=0)], "sitemap": True, "crawled": 2, "sitemap_urls": 2})
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        out = {i["key"]: i for i in gc.issues(db, b, {"rendering": {"js_required": True}})}
        h1 = out["fix.site.meta.h1_missing"]
        assert h1["confidence"] == "check_first" and h1["severity"] == "info" and "JavaScript" in h1["note"]
        no_js = {i["key"]: i for i in gc.issues(db, b, {"rendering": {"js_required": False}})}
        assert no_js["fix.site.meta.h1_missing"]["confidence"] == "confirmed"
    finally:
        db.close()


# ------------------------------------------------------------------------------------------------------------------- verification and the cap
def test_verifications_read_real_rows(project):
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        assert gc.verify(db, b, {"type": "kw_count", "min": 1}, None, TODAY)["passed"] is False
        db.add(Keyword(business_id=project, keyword="lehenga rental pune", tracked=True))
        db.flush()
        assert gc.verify(db, b, {"type": "kw_count", "min": 1}, None, TODAY)["passed"] is True
        assert gc.verify(db, b, {"type": "articles_since", "days": 30, "min": 1}, None, TODAY)["passed"] is False
        db.add(Article(business_id=project, keyword="lehenga", status="completed", title="Guide", generated_at=datetime.now(timezone.utc)))
        db.flush()
        assert gc.verify(db, b, {"type": "articles_since", "days": 30, "min": 1}, None, TODAY)["passed"] is True
        assert gc.verify(db, b, {"type": "articles_meta"}, None, TODAY)["passed"] is False  # the article has no meta description
        assert gc.verify(db, b, {"type": "backlinks", "min": 1, "field": "tracked"}, None, TODAY)["passed"] is False
    finally:
        db.close()


def test_every_new_kind_is_dispatched_and_described():
    for kind in gc.KINDS:
        assert kind in gi.VERIFY_KINDS
        assert gi.closes_when({"type": kind, "min": 3}) != "A person confirms it and the data agrees."


def test_a_cap_never_closes_a_task(project, monkeypatch):
    many = [gi.make(f"i{n}", "seo", "t", "info", f"T{n}", "w", ["h"], 5, "/x", {"type": "field", "field": "name"}) for n in range(gi.CAPS["info"] + 5)]
    monkeypatch.setattr(gi, "collect", lambda db, b, live=False: {"issues": many[:gi.CAPS["info"]], "skipped": [], "total_found": len(many), "all_keys": {i["key"] for i in many}})
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        gi.sweep(db, b, TODAY)
        capped_out = many[-1]["key"]
        from app.models import GrowthAction
        db.add(GrowthAction(business_id=project, area="seo", key=capped_out, period="fix", due_on=TODAY, title="x", status="todo", verify={"type": "field", "field": "name"}, evidence={"severity": "info"}))
        db.flush()
        assert gi.sweep(db, b, TODAY)["closed"] == 0  # reported but beyond the cap: still open
    finally:
        db.close()
