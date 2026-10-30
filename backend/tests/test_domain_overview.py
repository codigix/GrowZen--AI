"""Domain Overview: real Google traffic from Search Console, AI visibility from stored checks, honest gaps."""
from urllib.parse import parse_qs, urlparse

from app.db import SessionLocal
from app.models import GeoPrompt, GeoResult, GoogleConnection
from app.services import crypto, gbp, gsc

SITES = [{"siteUrl": "sc-domain:mydental.in", "permissionLevel": "siteOwner"}, {"siteUrl": "https://other.com/", "permissionLevel": "siteOwner"}]


def rows_for(body):
    dims = body.get("dimensions") or []
    if not dims:
        return [{"clicks": 120, "impressions": 4000, "ctr": 0.03, "position": 12.3}]
    if dims == ["date"]:
        return [{"keys": ["2026-10-20"], "clicks": 5, "impressions": 100, "ctr": 0.05, "position": 10}, {"keys": ["2026-10-22"], "clicks": 9, "impressions": 150, "ctr": 0.06, "position": 9}]
    if dims == ["country"]:
        return [{"keys": ["usa"], "clicks": 80, "impressions": 2500, "ctr": 0.032, "position": 11}, {"keys": ["ind"], "clicks": 40, "impressions": 1500, "ctr": 0.027, "position": 14}]
    if dims == ["query"]:
        return [{"keys": ["dentist near me"], "clicks": 30, "impressions": 900, "ctr": 0.033, "position": 6.4}, {"keys": ["root canal"], "clicks": 10, "impressions": 700, "ctr": 0.014, "position": 14.2}]
    if dims == ["page"]:
        return [{"keys": ["https://mydental.in/"], "clicks": 70, "impressions": 2000, "ctr": 0.035, "position": 9}]
    if dims == ["device"]:
        return [{"keys": ["MOBILE"], "clicks": 90, "impressions": 3000}, {"keys": ["DESKTOP"], "clicks": 30, "impressions": 1000}]
    return []


def fake(monkeypatch, sites=SITES):
    calls = []

    def req(self, method, url, **kw):
        if url.endswith("/sites"):
            return {"siteEntry": sites}
        calls.append(kw["json"])
        return {"rows": rows_for(kw["json"])}
    monkeypatch.setattr(gsc.SearchConsole, "_req", req)
    monkeypatch.setattr(gbp.GbpClient, "_token", lambda self: "tok")
    gsc._cache.clear()
    return calls


def connect(scope=True):
    db = SessionLocal()
    c = db.query(GoogleConnection).filter_by(email="owner@mydental.in").first() or GoogleConnection(email="owner@mydental.in")
    c.refresh_token_enc, c.status = crypto.seal("rt"), "active"
    c.scopes = ("openid email " + gsc.SCOPE) if scope else "openid email https://www.googleapis.com/auth/business.manage"
    db.add(c)
    db.commit()
    db.close()


def disconnect():
    db = SessionLocal()
    db.query(GoogleConnection).filter_by(email="owner@mydental.in").delete()
    db.commit()
    db.close()


def project(client):
    return client.post("/api/v1/businesses", json={"name": "My Dental", "primary_category": "Dentist", "city": "Pune", "website": "https://www.mydental.in/about"}).json()["id"]


def test_without_a_google_account_it_says_what_is_missing(client):
    disconnect()
    bid = project(client)
    d = client.get(f"/api/v1/businesses/{bid}/seo/domain").json()
    assert d["domain"] == "mydental.in" and d["traffic"]["state"] == "not_connected" and "report" not in d["traffic"]
    assert d["ai"]["measured"] is False and d["links"]["available"] is False and "DataForSEO" in d["links"]["reason"] and "paid" in d["unavailable"]


def test_an_account_without_the_search_console_permission_is_asked_to_reconnect(client):
    bid = project(client)
    connect(scope=False)
    try:
        assert client.get(f"/api/v1/businesses/{bid}/seo/domain").json()["traffic"]["state"] == "scope_missing"
    finally:
        disconnect()


def test_real_traffic_from_search_console(client, monkeypatch):
    calls = fake(monkeypatch)
    bid = project(client)
    connect()
    try:
        t = client.get(f"/api/v1/businesses/{bid}/seo/domain?range=3m").json()["traffic"]
        assert t["state"] == "ok" and t["account"] == "owner@mydental.in" and t["report"]["property"] == "sc-domain:mydental.in"
        r = t["report"]
        assert r["totals"]["clicks"] == 120 and r["totals"]["impressions"] == 4000 and r["totals"]["ctr"] == 3.0 and r["totals"]["position"] == 12.3
        assert r["totals"]["keywords"] == 2 and r["totals"]["pages"] == 1 and r["previous"]["clicks"] == 120
        assert r["period"]["days"] == 90 and len(r["timeline"]) == 90  # every day is present, days without data as zero
        assert sum(x["clicks"] for x in r["timeline"]) == 14 and sum(1 for x in r["timeline"] if x["clicks"]) == 2
        assert [c["code"] for c in r["countries"]] == ["US", "IN"] and r["keywords"][0]["query"] == "dentist near me"
        assert {x["device"] for x in r["devices"]} == {"mobile", "desktop"} and r["pages"][0]["page"] == "https://mydental.in/"
        # A country and device filter reaches Google as Search Console filters.
        calls.clear()
        client.get(f"/api/v1/businesses/{bid}/seo/domain?range=28d&country=US&device=mobile")
        f = next(c for c in calls if c.get("dimensions") == ["query"])["dimensionFilterGroups"][0]["filters"]
        assert {"dimension": "country", "operator": "equals", "expression": "usa"} in f and {"dimension": "device", "operator": "equals", "expression": "MOBILE"} in f
    finally:
        disconnect()


def test_no_property_for_the_site_is_explained(client, monkeypatch):
    fake(monkeypatch, sites=[{"siteUrl": "https://other.com/", "permissionLevel": "siteOwner"}])
    bid = project(client)
    connect()
    try:
        t = client.get(f"/api/v1/businesses/{bid}/seo/domain").json()["traffic"]
        assert t["state"] == "no_property" and "mydental.in" in t["message"]
    finally:
        disconnect()


def test_google_errors_are_shown_not_hidden(client, monkeypatch):
    def boom(self, method, url, **kw):
        raise gbp.GbpError("The Google Search Console API is not enabled in the Google Cloud project.")
    monkeypatch.setattr(gsc.SearchConsole, "_req", boom)
    monkeypatch.setattr(gbp.GbpClient, "_token", lambda self: "tok")
    gsc._cache.clear()
    bid = project(client)
    connect()
    try:
        t = client.get(f"/api/v1/businesses/{bid}/seo/domain").json()["traffic"]
        assert t["state"] == "error" and "not enabled" in t["message"]
    finally:
        disconnect()


def test_ai_visibility_comes_from_stored_checks(client):
    bid = project(client)
    db = SessionLocal()
    p1, p2 = GeoPrompt(business_id=bid, prompt="best dentist in pune"), GeoPrompt(business_id=bid, prompt="root canal cost pune")
    db.add_all([p1, p2])
    db.flush()
    db.add_all([GeoResult(business_id=bid, prompt_id=p1.id, engine="chatgpt", mentioned=True, cited_urls=["https://www.mydental.in/about", "https://yelp.com/x"], data_source="live"),
                GeoResult(business_id=bid, prompt_id=p2.id, engine="chatgpt", mentioned=False, cited_urls=[], data_source="live"),
                GeoResult(business_id=bid, prompt_id=p1.id, engine="gemini", mentioned=True, cited_urls=["https://mydental.in/"], data_source="live")])
    db.commit()
    db.close()
    ai = client.get(f"/api/v1/businesses/{bid}/seo/domain").json()["ai"]
    assert ai["measured"] and ai["visibility"] == 67 and ai["mentions"] == 2 and ai["cited_pages"] == 2
    by = {e["engine"]: e for e in ai["engines"]}
    assert by["chatgpt"]["visibility"] == 50 and by["gemini"]["visibility"] == 100 and by["chatgpt"]["cited"] == 1


def test_search_console_only_sign_in_asks_for_that_permission_alone(monkeypatch):
    from app.config import get_settings
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "id.apps.googleusercontent.com")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "secret")
    get_settings.cache_clear()
    s = parse_qs(urlparse(gbp.auth_url("1", "gsc")).query)
    assert s["scope"][0] == gbp.GSC_SCOPES and "business.manage" not in s["scope"][0]
    assert "business.manage" in parse_qs(urlparse(gbp.auth_url("1")).query)["scope"][0]
    assert gbp.read_purpose(s["state"][0]) == "gsc" and gbp.read_state(s["state"][0]) == "1"

    get_settings.cache_clear()
