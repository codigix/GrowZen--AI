"""SEO toolkit endpoints: domain overview, top pages, organic rank checks and the keyword overview."""
import pytest
from test_competitor_intel import faked, fake_call  # noqa: F401  (the Serper fake)

from app.competitors import intel

CASED = {"dentist in pune": "dentist in Pune", "dentist in baner": "dentist in Baner"}


@pytest.fixture
def serper(faked, monkeypatch):  # noqa: F811
    """The fake answers by exact text; keywords are saved lowercase, so match them the way Google does (ignoring case)."""
    monkeypatch.setattr(intel.Serper, "call", lambda self, path, body: fake_call(self, path, body | {"q": CASED.get(body["q"].lower(), body["q"])}))


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
    assert by["dentist in pune"]["rank"] == 4 and by["dentist in pune"]["url"] == "https://mydental.in/"  # mydental.in is #4 in the fake results
    assert by["dentist in baner"]["rank"] is None  # not in Google's results for that search
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


def test_keyword_overview_reads_google_from_the_business_place(client, serper):
    bid = business(client)
    o = client.post(f"/api/v1/businesses/{bid}/seo/keyword-overview", json={"keyword": "Dentist in Pune"}).json()
    assert o["keyword"] == "dentist in pune" and o["intent"] == "local"
    assert o["you"]["organic"] == 4 and o["you"]["local"] == 2  # mydental.in is #4 on Google and #2 in Maps in the fake results
    assert [x["position"] for x in o["organic"]][:2] == [1, 4] and any(x["mine"] for x in o["organic"])
    assert o["metrics"]["volume"] is None  # no volume without a provider: never invented


def test_rank_checks_explain_a_missing_key_or_website(client, monkeypatch):
    bid = business(client)
    r = client.post(f"/api/v1/businesses/{bid}/seo/check-ranks", json={})
    assert r.status_code == 400 and "SERPER_API_KEY" in r.json()["detail"]
    assert client.post(f"/api/v1/businesses/{bid}/seo/keyword-overview", json={"keyword": "dentist"}).status_code == 400


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
    conn = GoogleConnection(email="owner-of-a@example.com", status="active", refresh_token_enc="x", scopes="")
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
