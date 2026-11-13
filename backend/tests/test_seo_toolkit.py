"""SEO toolkit endpoints: domain overview, top pages, organic rank checks (Search Console) and the keyword overview (Google Ads Keyword Planner)."""
import pytest
from test_competitor_intel import faked  # noqa: F401  (sets GOOGLE_PLACES_API_KEY and clears the cache)

from app.competitors import service
from app.db import SessionLocal
from app.models import Business, GoogleConnection
from app.services import gsc_access

ROWS = [{"keys": ["dentist in pune", "https://mydental.in/"], "clicks": 12, "impressions": 300, "position": 3.6}]


class FakeSearchConsole:
    def query(self, site, body):
        return ROWS


@pytest.fixture
def serper(faked, monkeypatch):  # noqa: F811
    """Google is faked: Search Console answers with one ranking keyword; the Places API answers with an empty Maps result."""
    monkeypatch.setattr(gsc_access, "search_console", lambda db, b, host: ("ok", "owner@x.in", FakeSearchConsole(), "sc-domain:mydental.in"))
    monkeypatch.setattr(service, "places_search", lambda *a, **k: [])


def business(client):
    return client.post("/api/v1/businesses", json={"name": "My Dental", "primary_category": "Dentist", "area": "Baner", "city": "Pune", "website": "https://mydental.in"}).json()["id"]


def test_domain_page_works_before_anything_has_run(client):
    bid = business(client)
    o = client.get(f"/api/v1/businesses/{bid}/seo/domain").json()
    assert o["domain"] == "mydental.in" and o["rankings"]["tracked"] == 0 and o["traffic"]["state"] in ("not_connected", "scope_missing", "no_website")
    assert client.get(f"/api/v1/businesses/{bid}/seo/top-pages").json() == {"pages": [], "audited_at": None}


def test_check_ranks_saves_positions_and_the_change(client, serper):
    bid = business(client)
    client.post(f"/api/v1/businesses/{bid}/keywords", json=[{"keyword": "dentist in Pune"}, {"keyword": "dentist in Baner"}])
    r = client.post(f"/api/v1/businesses/{bid}/seo/check-ranks", json={}).json()
    by = {x["keyword"]: x for x in r["results"]}
    assert by["dentist in pune"]["rank"] == 4 and by["dentist in pune"]["url"] == "https://mydental.in/" and by["dentist in pune"]["position"] == 3.6   # Search Console's average position, rounded for the rank
    assert by["dentist in baner"]["rank"] is None  # no impressions on Google for that search in the last 28 days
    kws = {k["keyword"]: k for k in client.get(f"/api/v1/businesses/{bid}/keywords").json()["keywords"]}
    assert kws["dentist in pune"]["rank"] == 4 and kws["dentist in pune"]["rank_checked_at"]
    # A second check keeps the previous position so the page can show the move.
    client.post(f"/api/v1/businesses/{bid}/seo/check-ranks", json={"keywords": ["dentist in pune"]})
    k = {k["keyword"]: k for k in client.get(f"/api/v1/businesses/{bid}/keywords").json()["keywords"]}["dentist in pune"]
    assert k["prev_rank"] == 4
    o = client.get(f"/api/v1/businesses/{bid}/seo/domain").json()["rankings"]
    assert o["tracked"] == 2 and o["ranking"] == 1
    # Each check is a history row, so the trend is real: the same day updates its row instead of duplicating it.
    h = client.get(f"/api/v1/businesses/{bid}/seo/rank-history").json()["history"]
    assert [x["rank"] for x in h["dentist in pune"]] == [4] and [x["rank"] for x in h["dentist in baner"]] == [None]


def test_keyword_overview_uses_the_google_ads_keyword_planner(client, monkeypatch):
    from app.services import google_ads_client as ads, keyword_metrics
    bid = business(client)
    assert client.post(f"/api/v1/businesses/{bid}/seo/keyword-overview", json={"keyword": "dentist in pune"}).status_code == 400  # Ads not set up: said plainly
    monkeypatch.setattr(keyword_metrics, "enabled", lambda: True)
    idea = lambda k, v: {"keyword": k, "avg_monthly_searches": v, "competition": "MEDIUM", "competition_index": 48, "low_top_of_page_bid": 1.2, "high_top_of_page_bid": 3.4, "three_month_change": 5.0, "yoy_change": -2.5,  # noqa: E731
                         "monthly_search_volumes": [{"year": 2026, "month": "JANUARY", "monthly_searches": v}]}
    seen = {}
    monkeypatch.setattr(ads, "keyword_ideas", lambda seeds, **kw: seen.update(seeds=seeds) or [idea("dentist in pune", 1900), idea("best dentist in pune", 720), idea("dental clinic pune", 390)])
    client.post(f"/api/v1/businesses/{bid}/keywords", json=[{"keyword": "dentist in Pune"}])
    o = client.post(f"/api/v1/businesses/{bid}/seo/keyword-overview", json={"keyword": "Dentist in Pune"}).json()
    assert seen["seeds"] == ["dentist in pune"] and o["keyword"] == "dentist in pune" and o["intent"] == "local" and o["source"] == "Google Ads Keyword Planner"
    assert o["metrics"]["volume"] == 1900 and o["metrics"]["cpc_high"] == 3.4 and o["metrics"]["difficulty"] == 48 and o["metrics"]["monthly"][0]["searches"] == 1900
    assert [i["keyword"] for i in o["ideas"]] == ["best dentist in pune", "dental clinic pune"] and o["you"]["tracked"] is True
    assert "organic" not in o and "local" not in o  # the Planner has no results page: nothing is invented


def test_rank_checks_explain_a_missing_google_account_or_website(client):
    bid = business(client)
    r = client.post(f"/api/v1/businesses/{bid}/seo/check-ranks", json={})
    assert r.status_code == 400 and "Google account" in r.json()["detail"]   # no linked account: said plainly, no data invented
    nosite = client.post("/api/v1/businesses", json={"name": "No Site Clinic"}).json()["id"]
    r = client.post(f"/api/v1/businesses/{nosite}/seo/check-ranks", json={})
    assert r.status_code == 400 and "website" in r.json()["detail"]


def test_seed_keywords_then_rank_report_gives_advice_per_keyword(client):
    bid = client.post("/api/v1/businesses", json={"name": "Acme Dental", "website": "https://acme.example", "primary_category": "Dentist", "city": "Pune"}).json()["id"]
    assert client.get(f"/api/v1/businesses/{bid}/seo/rank-report").json()["state"] == "no_keywords"
    added = client.post(f"/api/v1/businesses/{bid}/seo/seed-keywords").json()["added"]
    assert added >= 1
    assert client.post(f"/api/v1/businesses/{bid}/seo/seed-keywords").json()["added"] == 0  # idempotent
    rep = client.get(f"/api/v1/businesses/{bid}/seo/rank-report").json()
    assert rep["tracked"] == added and rep["rows"][0]["advice"][0]["level"] == "fix"


def test_crawl_pages_needs_a_website_and_runs_in_the_background(client, monkeypatch):
    from app.services import audits
    seen = {}
    monkeypatch.setattr(audits, "run", lambda db, b, kind, **o: seen.update(kind=kind, **o))
    no_site = client.post("/api/v1/businesses", json={"name": "No Site Co"}).json()["id"]
    assert client.post(f"/api/v1/businesses/{no_site}/seo/crawl-pages").status_code == 400
    bid = client.post("/api/v1/businesses", json={"name": "Site Co", "website": "https://site-co.example"}).json()["id"]
    assert client.post(f"/api/v1/businesses/{bid}/seo/crawl-pages?pages=999").status_code == 202
    assert seen == {"kind": "onpage", "max_pages": 300}  # capped
    assert "crawling" in client.get(f"/api/v1/businesses/{bid}/seo/top-pages-report").json()


def test_subdomains_are_discovered_and_checked(client, monkeypatch):
    from app.services import subdomains as sub
    monkeypatch.setattr(sub, "from_certificates", lambda root: ["blog.site-co.example", "shop.site-co.example", "evil.other.com"])
    monkeypatch.setattr(sub, "_probe", lambda h: {"subdomain": h, "resolves": True, "status": 200, "final_url": None, "title": None})
    bid = client.post("/api/v1/businesses", json={"name": "Sub Co", "website": "https://www.site-co.example"}).json()["id"]
    r = client.get(f"/api/v1/businesses/{bid}/seo/subdomains").json()
    assert {x["subdomain"] for x in r["rows"]} == {"site-co.example", "blog.site-co.example", "shop.site-co.example"}
    assert r["rows"][0]["main"] and r["root"] == "site-co.example"


def test_projects_do_not_share_google_accounts_or_audit_history(client):
    from app.db import SessionLocal
    from app.models import GoogleConnection
    a = client.post("/api/v1/businesses", json={"name": "Iso A", "website": "https://iso-a.example"}).json()["id"]
    b = client.post("/api/v1/businesses", json={"name": "Iso B", "website": "https://iso-b.example"}).json()["id"]
    db = SessionLocal()
    conn = GoogleConnection(email="owner-of-a@example.com", status="active", refresh_token_enc="x", scopes="", connected_by="user crm:48")
    db.add(conn); db.commit(); db.refresh(conn)
    db.close()
    # B has no linked account: it is never tried against A's (or any) account, and no other account's address is named
    r = client.get(f"/api/v1/businesses/{b}/seo/domain").json()
    assert r["traffic"]["state"] != "ok" and "owner-of-a@example.com" not in r["traffic"].get("message", "")
    # audit history is per project
    from app.models import Audit
    db = SessionLocal()
    db.add_all([Audit(kind="website", target="https://iso-a.example/", status="done", workspace_id=a), Audit(kind="website", target="https://iso-b.example/", status="done", workspace_id=b)])
    db.commit(); db.close()
    ha = client.get(f"/api/v1/website-audits?workspace_id={a}").json()
    assert {x["target"] for x in ha} == {"https://iso-a.example/"}


def test_site_audit_overview_computes_each_figure_from_the_saved_audit(client):
    from app.db import SessionLocal
    from app.models import Audit
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    ws = client.post("/api/v1/businesses", json={"name": "Overview Co"}).json()["id"]  # a scan belongs to a real project of the signed-in user
    page = lambda u, **k: {"url": u, "status": 200, "noindex": False, "title_length": 50, "meta_description_length": 140, "h1_count": 1, "schema_types": ["Organization"], "canonical": u, "inbound": 2, **k}
    crawl = {"start_url": "https://ov.example/", "robots_txt": True, "sitemap": True, "https": True, "crawled": 2, "max_pages": 100,
             "pages": [page("https://ov.example/"), page("https://ov.example/a", noindex=True, hreflang=1)]}
    db = SessionLocal()
    db.add(Audit(kind="website", target="https://ov.example/", status="done", score=80, workspace_id=ws, finished_at=now,
                 issues=[{"level": "serious"}, {"level": "warning"}, {"level": "warning"}, {"level": "info"}],
                 result={"crawl": crawl, "pagespeed": {"scores": {"performance": 90}, "metrics": {"lcp": "2.0 s", "cls": "0.2", "tbt": "100 ms"}}}))
    db.commit()
    db.close()
    r = client.get(f"/api/v1/website-audits/overview?workspace_id={ws}").json()
    assert len(r) == 1
    x = r[0]
    assert (x["pages"], x["limit"], x["health"], x["errors"], x["warnings"], x["crawlability"], x["https"], x["intl"], x["performance"], x["markups"]) == (2, 100, 80, 1, 2, 50, 100, 50, 90, 100)
    assert x["vitals"]["pass"] == 2 and x["vitals"]["of"] == 3 and x["diff"]["health"] is None
    assert client.get(f"/api/v1/website-audits/overview?workspace_id={ws + 999}").status_code == 404


def test_project_audit_overview_uses_the_same_figures_as_the_site_audit_table(client):
    from app.db import SessionLocal
    from app.models import Audit
    from datetime import datetime, timezone
    bid = client.post("/api/v1/businesses", json={"name": "Ovw Co", "website": "https://ovw.example"}).json()["id"]
    assert client.get(f"/api/v1/businesses/{bid}/audit-overview").status_code == 404  # nothing audited yet
    pg = lambda u, **k: {"url": u, "status": 200, "noindex": False, "title_length": 50, "meta_description_length": 140, "h1_count": 1, "word_count": 500, "images_missing_alt": 0,
                         "has_viewport": True, "schema_types": ["Organization"], "inbound": 1, "internal_out": 2, "lang": "en", **k}
    db = SessionLocal()
    db.add(Audit(business_id=bid, kind="onpage", target="https://ovw.example", status="done", score=80, finished_at=datetime.now(timezone.utc),
                 issues=[{"code": "h1_count", "area": "On-page", "level": "warning", "title": "/a has 0 H1 headings"}],
                 result={"https": True, "sitemap": True, "robots_txt": True, "pages": [pg("https://ovw.example/"), pg("https://ovw.example/a", h1_count=0)]}))
    db.commit()
    db.close()
    r = client.get(f"/api/v1/businesses/{bid}/audit-overview").json()
    row = next(x for x in client.get("/api/v1/businesses/site-audit").json() if x["id"] == bid)
    assert r["health"] == row["metrics"]["site_health"]["value"] and r["crawlability"] == row["metrics"]["crawlability"]["value"] and r["pages"] == row["pages_crawled"] == 2
    assert r["top_issues"][0]["code"] == "h1_count" and r["with_issues"] == 1 and r["warnings"] == 1


def test_a_project_with_no_linked_account_finds_the_one_that_owns_its_site(client, monkeypatch):
    from app.db import SessionLocal
    from app.models import Business, GoogleConnection
    from app.services import crypto, gsc
    db = SessionLocal()
    other = GoogleConnection(email="other-owner@example.com", refresh_token_enc=crypto.seal("rt"), scopes=f"openid {gsc.SCOPE}", status="active", connected_by="user crm:48")
    owner = GoogleConnection(email="auto-owner@example.com", refresh_token_enc=crypto.seal("rt"), scopes=f"openid {gsc.SCOPE}", status="active", connected_by="user crm:48")
    db.add_all([other, owner])
    db.commit()
    ids = (other.id, owner.id)
    db.close()
    monkeypatch.setattr(gsc.SearchConsole, "sites", lambda self: [{"siteUrl": "sc-domain:auto.example", "permissionLevel": "siteOwner"}] if self.client.conn.id == ids[1] else [{"siteUrl": "sc-domain:else.example", "permissionLevel": "siteOwner"}])
    monkeypatch.setattr(gsc, "report", lambda *a, **k: {"totals": {}})
    bid = client.post("/api/v1/businesses", json={"name": "Auto Co", "website": "https://auto.example"}).json()["id"]
    r = client.get(f"/api/v1/businesses/{bid}/seo/domain").json()
    assert r["traffic"]["state"] == "ok" and r["traffic"]["account"] == "auto-owner@example.com"
    db = SessionLocal()
    assert db.get(Business, bid).connection_id == ids[1]  # linked for next time
    db.close()
    # choosing an account by hand, or none
    assert client.post(f"/api/v1/businesses/{bid}/seo/link-account", json={"connection_id": ids[0]}).json() == {"connection_id": ids[0]}
    assert client.post(f"/api/v1/businesses/{bid}/seo/link-account", json={"connection_id": 999999}).status_code == 404
    assert client.post(f"/api/v1/businesses/{bid}/seo/link-account", json={"connection_id": None}).json() == {"connection_id": None}


def test_working_tools_check_platform_limits_and_use_live_results(client, monkeypatch):
    from app.services import ai, google_ads_client as ads, keyword_metrics
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(keyword_metrics, "enabled", lambda: True)
    ideas = [{"keyword": "how much does a dental clinic cost in pune", "avg_monthly_searches": 500}, {"keyword": "dental clinic near me", "avg_monthly_searches": 900}, {"keyword": "dental clinic pune", "avg_monthly_searches": 100}]
    monkeypatch.setattr(ads, "keyword_ideas", lambda seeds, **kw: ideas)
    bid = client.post("/api/v1/businesses", json={"name": "Tool Co", "website": "https://tool.example", "city": "Pune"}).json()["id"]

    monkeypatch.setattr(ai, "complete_json", lambda *a, **k: {"title_tag": "T" * 80, "meta_description": "M" * 300, "outline": [{"h2": "A", "points": [], "h3": []}]})
    r = client.post(f"/api/v1/businesses/{bid}/tools/seo-brief", json={"keyword": "dental clinic pune"}).json()
    assert len(r["brief"]["title_tag"]) == 60 and len(r["brief"]["meta_description"]) == 155 and r["live_results"] is False and r["questions"] == ["how much does a dental clinic cost in pune"]

    monkeypatch.setattr(ai, "complete_json", lambda *a, **k: {"posts": [{"platform": "x", "text": "x" * 400, "hashtags": ["a"]}, {"platform": "linkedin", "text": "hi"}]})
    r = client.post(f"/api/v1/businesses/{bid}/tools/social-posts", json={"topic": "Diwali offer", "platforms": ["x"]}).json()
    assert [p["platform"] for p in r["posts"]] == ["x"] and r["posts"][0]["length"] == 280 and r["posts"][0]["trimmed"]  # linkedin was not asked for

    monkeypatch.setattr(ai, "complete_json", lambda *a, **k: {"campaign_name": "C", "ad_groups": [{"name": "g", "keywords": [], "headlines": ["Short", "H" * 40], "descriptions": ["D" * 100, "Fine"]}]})
    r = client.post(f"/api/v1/businesses/{bid}/tools/ads-plan", json={"goal": "calls"}).json()
    g = r["plan"]["ad_groups"][0]
    assert g["headlines"] == ["Short"] and g["descriptions"] == ["Fine"] and r["dropped_over_limit"] == 2

    r = client.post(f"/api/v1/businesses/{bid}/tools/questions", json={"keywords": ["a", "b"]}).json()
    assert [i["question"] for i in r["items"]] == ["how much does a dental clinic cost in pune", "dental clinic near me", "dental clinic pune"] and r["source"] == "Google Ads Keyword Planner"


def test_domain_overview_backlinks_summary_counts_follow_types_anchors_and_domains(client):
    from app.backlinks import models as bm
    from app.backlinks.lifecycle import LIVE_STATES
    from app.db import SessionLocal
    bid = client.post("/api/v1/businesses", json={"name": "Bl Co", "website": "https://blco.example"}).json()["id"]
    assert client.get(f"/api/v1/businesses/{bid}/backlink-intel/domain-overview").json() == {"state": "no_target"}
    r = client.post(f"/api/v1/businesses/{bid}/backlink-intel/targets", json={"domain": "blco.example"})
    assert r.status_code in (200, 201), r.text
    out = client.get(f"/api/v1/businesses/{bid}/backlink-intel/domain-overview").json()
    assert out["state"] == "ok" and out["domain"] == "blco.example" and out["backlinks"] == 0 and out["follow"] == 0 and out["anchors"] == [] and out["sample"] == []
    assert LIVE_STATES and bm  # the live states the counts use
