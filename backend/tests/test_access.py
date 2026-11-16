"""The access checklist: a project's website traffic and Google Business Profile data stay hidden (409) until every step is done."""
import uuid

import pytest

from app import access
from app.db import SessionLocal
from app.models import Business, GoogleConnection
from app.services import crypto, ga4, gsc

SC, GA, BM = gsc.SCOPE, ga4.SCOPE, "https://www.googleapis.com/auth/business.manage"


@pytest.fixture(autouse=True)
def _fresh_cache():
    access.forget()
    yield
    access.forget()


def project(client, website="https://shop.example/"):
    return client.post("/api/v1/businesses", json={"name": "Access Co", "website": website}).json()["id"]


def link(bid, scopes, status="active", gbp=False):
    db = SessionLocal()
    c = db.query(GoogleConnection).filter_by(email="owner@shop.example").first() or GoogleConnection(email="owner@shop.example")
    c.refresh_token_enc, c.status, c.scopes, c.connected_by = crypto.seal("rt"), status, " ".join(["openid", *scopes]), "user crm:48"
    db.add(c)
    db.commit()
    b = db.get(Business, bid)
    b.connection_id = c.id
    if gbp:
        b.gbp_location = f"locations/{uuid.uuid4().hex[:12]}"
    db.commit()
    db.close()


def steps(client, bid, refresh=True):
    r = client.get(f"/api/v1/businesses/{bid}/access-status?refresh={'true' if refresh else 'false'}").json()
    return r, {s["id"]: s for s in r["steps"]}


def test_a_new_project_has_an_open_checklist_and_no_google_data(client):
    bid = project(client)
    r, s = steps(client, bid)
    assert r["website"]["complete"] is False and r["gmb"]["complete"] is False
    assert s["website"]["status"] == "ok" and s["account"]["status"] == "missing" and s["account"]["fix"]["action"] == "link_account"
    assert s["ga4_property"]["status"] == "blocked" and s["gbp"]["status"] == "blocked"
    for method, url in [("get", f"/api/v1/businesses/{bid}/gbp/live"), ("get", f"/api/v1/businesses/{bid}/insights"), ("get", f"/api/v1/businesses/{bid}/reviews"),
                        ("post", f"/api/v1/businesses/{bid}/sync"), ("get", f"/api/v1/analytics/ga4/by-email?business_id={bid}"), ("get", f"/api/v1/analytics/ga4/realtime?business_id={bid}&property_id=123456")]:
        x = getattr(client, method)(url)
        d = x.json()["detail"]
        assert x.status_code == 409 and d["code"] == "access_incomplete" and d["steps"], url


def test_a_disconnected_account_blocks_everything(client):
    bid = project(client)
    link(bid, [GA, SC, BM], status="revoked", gbp=True)
    r, s = steps(client, bid)
    assert s["account"]["status"] == "missing" and s["account"]["fix"]["action"] == "reconnect_google"
    assert not r["website"]["complete"] and not r["gmb"]["complete"]


def test_missing_permissions_are_named(client):
    bid = project(client)
    link(bid, [BM], gbp=True)
    r, s = steps(client, bid)
    assert s["scope_analytics"]["status"] == "missing" and s["scope_analytics"]["fix"]["action"] == "grant_analytics"
    assert s["scope_search_console"]["status"] == "missing"
    assert s["scope_business"]["status"] == "ok" and s["gbp"]["status"] == "ok"
    assert r["gmb"]["complete"] is True and r["website"]["complete"] is False  # the two lists are independent


def test_business_profile_data_shows_once_its_steps_are_done(client):
    bid = project(client)
    link(bid, [BM])
    assert client.get(f"/api/v1/businesses/{bid}/gbp/live").status_code == 409  # no profile linked yet
    link(bid, [BM], gbp=True)
    assert client.get(f"/api/v1/businesses/{bid}/gbp/live").status_code == 200
    assert client.get(f"/api/v1/businesses/{bid}/insights").status_code == 200


def mock_google(monkeypatch, property_ok=True, sites=None):
    prop = {"property": "properties/555", "name": "Shop", "account": "Acct", "hosts": ["shop.example"]}
    monkeypatch.setattr(ga4, "match_properties", lambda ga, hosts: ([prop] if property_ok else [], [prop]))
    monkeypatch.setattr(ga4, "report", lambda ga, p, days=28: {"property": p, "totals": {"activeUsers": 7}})
    monkeypatch.setattr(ga4, "realtime_report", lambda ga, p: {"active_users_30_min": 2})
    monkeypatch.setattr(gsc.SearchConsole, "sites", lambda self: sites if sites is not None else [{"siteUrl": "sc-domain:shop.example", "permissionLevel": "siteOwner"}])


def test_website_traffic_shows_only_for_the_projects_own_site_when_complete(client, monkeypatch):
    mock_google(monkeypatch)
    bid = project(client)
    link(bid, [GA, SC])
    r, s = steps(client, bid)
    assert r["website"]["complete"] is True and s["ga4_property"]["status"] == "ok" and s["search_console"]["status"] == "ok"
    out = client.get(f"/api/v1/analytics/ga4/by-email?business_id={bid}").json()
    assert out["matched"] is True and out["email"] == "owner@shop.example" and out["reports"][0]["totals"]["activeUsers"] == 7
    assert client.get(f"/api/v1/analytics/ga4/by-email?business_id={bid}&property_id=999999").status_code == 404  # a property that does not measure the site
    assert client.get(f"/api/v1/analytics/ga4/realtime?business_id={bid}&property_id=555").json()["active_users_30_min"] == 2
    assert client.get(f"/api/v1/analytics/ga4/realtime?business_id={bid}&property_id=999999").status_code == 404


def test_an_unverified_search_console_property_explains_the_fix(client, monkeypatch):
    mock_google(monkeypatch, sites=[{"siteUrl": "https://shop.example/", "permissionLevel": "siteUnverifiedUser"}])
    bid = project(client)
    link(bid, [GA, SC])
    r, s = steps(client, bid)
    assert s["search_console"]["status"] == "missing" and "NOT verified" in s["search_console"]["detail"] and s["search_console"]["fix"]["action"] == "open_search_console"
    assert r["website"]["complete"] is False
    assert client.get(f"/api/v1/analytics/ga4/by-email?business_id={bid}").status_code == 409


def test_no_analytics_property_for_the_site(client, monkeypatch):
    mock_google(monkeypatch, property_ok=False)
    bid = project(client)
    link(bid, [GA, SC])
    _, s = steps(client, bid)
    assert s["ga4_property"]["status"] == "missing" and "none measures shop.example" in s["ga4_property"]["detail"]


def test_google_lookups_are_remembered_not_repeated(client, monkeypatch):
    calls = []
    mock_google(monkeypatch)
    prop = {"property": "properties/555", "name": "Shop", "account": "A", "hosts": ["shop.example"]}
    monkeypatch.setattr(ga4, "match_properties", lambda ga, hosts: (calls.append(1) or [prop], [prop]))
    bid = project(client)
    link(bid, [GA, SC])
    steps(client, bid, refresh=False)
    steps(client, bid, refresh=False)
    client.get(f"/api/v1/analytics/ga4/by-email?business_id={bid}")
    assert len(calls) == 1
    steps(client, bid, refresh=True)
    assert len(calls) == 2


def test_another_users_project_has_no_checklist(client):
    from app.models import AppUser
    from test_security import login, user
    user("x1@x.in", "editor")
    user("x2@x.in", "editor")
    try:
        a, _ = login("x1@x.in")
        b, _ = login("x2@x.in")
        bid = a.post("/api/v1/businesses", json={"name": "Mine", "website": "https://mine.example"}).json()["id"]
        assert b.get(f"/api/v1/businesses/{bid}/access-status").status_code == 404
        assert b.get(f"/api/v1/analytics/ga4/by-email?business_id={bid}").status_code == 404
    finally:  # test_auth seeds the admin only while there are no users: leave none behind
        db = SessionLocal()
        db.query(AppUser).filter(AppUser.email.in_(["x1@x.in", "x2@x.in"])).delete(synchronize_session=False)
        db.commit()
        db.close()
