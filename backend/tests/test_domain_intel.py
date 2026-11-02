"""Domain Overview: internal versus client businesses, and the Google (Search Console) sections, with Search Console stubbed (no network)."""
import pytest

from app.db import SessionLocal
from app.models import GoogleConnection
from app.services import crypto, gsc


def _business(client, name, website, **extra):
    r = client.post("/api/v1/businesses", json={"name": name, "website": website, **extra})
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.fixture()
def google_account():
    db = SessionLocal()
    c = GoogleConnection(email="owner@codigix.co", refresh_token_enc=crypto.seal("rt"), scopes=f"openid {gsc.SCOPE}", status="active", connected_by="test")
    db.add(c)
    db.commit()
    cid = c.id
    db.close()
    yield cid
    db = SessionLocal()
    db.query(GoogleConnection).filter(GoogleConnection.id == cid).delete()
    db.commit()
    db.close()


def _stub(monkeypatch, calls, fail_dims=None):
    monkeypatch.setattr(gsc.SearchConsole, "__init__", lambda self, conn: None)
    monkeypatch.setattr(gsc.SearchConsole, "sites", lambda self: [{"siteUrl": "sc-domain:codigix.co", "permissionLevel": "siteOwner"}])

    def query(self, site, body):
        dims = tuple(body.get("dimensions") or ())
        calls.append(dims)
        if fail_dims and dims == fail_dims:
            raise gsc.gbp.GbpError("Search Console unavailable")
        if dims == ("query",):
            return [{"keys": ["customs automation"], "clicks": 12, "impressions": 300, "ctr": 0.04, "position": 2.4},
                    {"keys": ["codigix"], "clicks": 30, "impressions": 90, "ctr": 0.33, "position": 1.1},
                    {"keys": ["trade software"], "clicks": 1, "impressions": 500, "ctr": 0.002, "position": 18.0}]
        if dims == ("page",):
            return [{"keys": ["https://codigix.co/"], "clicks": 40, "impressions": 700, "ctr": 0.05, "position": 5.0},
                    {"keys": ["https://blog.codigix.co/post"], "clicks": 3, "impressions": 100, "ctr": 0.03, "position": 9.0}]
        if dims == ("date",):
            return [{"keys": ["2026-09-03"], "clicks": 10, "impressions": 50, "ctr": 0.2, "position": 4}, {"keys": ["2026-10-03"], "clicks": 33, "impressions": 80, "ctr": 0.4, "position": 3}]
        if dims == ("country",):
            return [{"keys": ["ind"], "clicks": 43, "impressions": 790, "ctr": 0.05, "position": 4}]
        return [{"clicks": 43, "impressions": 790, "ctr": 0.05, "position": 4}]
    monkeypatch.setattr(gsc.SearchConsole, "query", query)


def test_internal_domain_gets_deeper_data_and_its_own_messages(client):
    own = _business(client, "Codigix", "https://www.codigix.co/")
    other = _business(client, "Some Clinic", "https://someclinic.in")
    a = client.get(f"/api/v1/businesses/{own}/seo/domain").json()
    c = client.get(f"/api/v1/businesses/{other}/seo/domain").json()
    assert a["internal"] is True and c["internal"] is False
    assert a["limits"]["keywords"] > c["limits"]["keywords"]
    assert not any(x["id"] == "approval" for x in a["checks"])  # a client-only check


def test_placeholder_website_is_an_error(client):
    bid = _business(client, "Placeholder", "https://example.com")
    checks = client.get(f"/api/v1/businesses/{bid}/seo/domain").json()["checks"]
    assert any(x["id"] == "website" and x["level"] == "error" for x in checks)


def test_intel_needs_a_google_account(client):
    bid = _business(client, "Codigix", "https://codigix.co")
    j = client.get(f"/api/v1/businesses/{bid}/seo/domain-intel").json()
    assert j["state"] in ("not_connected", "no_property") and j["message"]


def test_intel_comes_from_search_console_and_is_cached(client, monkeypatch, google_account):
    calls: list = []
    _stub(monkeypatch, calls)
    bid = _business(client, "Codigix", "https://codigix.co", country="IN")
    j = client.get(f"/api/v1/businesses/{bid}/seo/domain-intel?refresh=true").json()
    assert j["state"] == "ok" and j["cached"] is False and j["source"] == "google_search_console"
    o = j["overview"]["data"]["organic"]
    assert o["count"] == 3 and o["traffic"] == 43 and o["top3"] == 2 and o["p11_20"] == 1
    assert j["keywords"]["data"]["rows"][0]["keyword"] == "codigix" and j["keywords"]["data"]["rows"][0]["traffic"] == 30
    assert j["organic"]["data"]["branded"] == 30 and j["organic"]["data"]["non_branded"] == 13
    assert [p["subdomain"] for p in j["subdomains"]["data"]] == ["codigix.co", "blog.codigix.co"]
    assert [h["date"] for h in j["history"]["data"]] == ["2026-09", "2026-10"] and j["history"]["data"][1]["traffic"] == 33
    # What Google has no API for is reported as unavailable, never estimated.
    for k in ("links", "backlinks", "competitors", "paid_keywords"):
        assert j[k]["ok"] is False and "Google" in j[k]["error"]
    n = len(calls)
    assert client.get(f"/api/v1/businesses/{bid}/seo/domain-intel").json()["cached"] is True and len(calls) == n
    assert client.get(f"/api/v1/businesses/{bid}/seo/domain-intel?refresh=true").json()["cached"] is False and len(calls) > n


def test_a_failed_google_section_is_reported_and_not_cached(client, monkeypatch, google_account):
    calls: list = []
    _stub(monkeypatch, calls, fail_dims=("page",))
    bid = _business(client, "Codigix", "https://codigix.co", country="IN")
    j = client.get(f"/api/v1/businesses/{bid}/seo/domain-intel?refresh=true").json()
    assert j["pages"] == {"ok": False, "error": "Search Console unavailable"} and j["overview"]["ok"] is True
    _stub(monkeypatch, [])  # fixed: the next view fetches again instead of replaying the failure
    assert client.get(f"/api/v1/businesses/{bid}/seo/domain-intel").json()["pages"]["ok"] is True
