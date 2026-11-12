"""Create a new Google Business Profile from a project and link it (Google stubbed)."""
import test_gbp as g  # the shared fake Google
from app.db import SessionLocal
from app.models import Business
from app.services import gbp

NEW = "locations/777"
ADDRESS = {"address_lines": ["12 MG Road"], "locality": "Pune", "administrative_area": "Maharashtra", "postal_code": "411007", "region_code": "IN"}


def _setup(monkeypatch):
    g.fake_google(monkeypatch)
    g.LOCATIONS.append(g.location(777))
    g.VOM[NEW] = {"verify": {}}
    sent = []
    base = gbp.GbpClient._req

    def req(self, method, url, **kw):
        if method == "POST" and url.endswith("/locations") and "accounts/111" in url:
            sent.append((url.split("/v1/")[-1], kw.get("params"), kw.get("json")))
            return {} if (kw.get("params") or {}).get("validateOnly") else {"name": NEW}
        if "/categories" in url and method == "GET" and "searchTerm" in (kw.get("params") or {}):
            return {"categories": [{"name": "categories/gcid:clothing_rental_service", "displayName": "Clothing rental service"}]}
        return base(self, method, url, **kw)
    monkeypatch.setattr(gbp.GbpClient, "_req", req)
    return sent


def _cleanup():
    g.LOCATIONS[:] = [x for x in g.LOCATIONS if x["name"] != NEW]
    g.VOM.pop(NEW, None)
    db = SessionLocal()
    db.query(Business).filter(Business.gbp_location == NEW).delete()
    db.commit()
    db.close()


def test_check_then_create_links_the_new_profile(client, monkeypatch):
    sent = _setup(monkeypatch)
    cid = g.connection()
    try:
        bid = client.post("/api/v1/businesses", json={"name": "New Rentals", "phone": "+91 98765 43210", "website": "https://newrentals.in", "description": "Clothes on rent."}).json()["id"]
        accounts = client.get(f"/api/v1/businesses/{bid}/gbp/create/accounts", params={"connection_id": cid}).json()
        assert accounts[0]["name"] == "accounts/111"
        cats = client.get(f"/api/v1/businesses/{bid}/gbp/create/categories", params={"connection_id": cid, "q": "clothing"}).json()
        assert cats[0]["name"] == "categories/gcid:clothing_rental_service"
        payload = {"connection_id": cid, "account": "accounts/111", "category": cats[0]["name"], "address": ADDRESS}
        # A check creates nothing
        r = client.post(f"/api/v1/businesses/{bid}/gbp/create", json={**payload, "validate_only": True})
        assert r.status_code == 201 and r.json()["ok"] and sent[-1][1] == {"validateOnly": "true"}
        assert client.get(f"/api/v1/businesses/{bid}").json()["gbp_location"] is None
        # Create: what Google receives comes from the project
        r = client.post(f"/api/v1/businesses/{bid}/gbp/create", json=payload)
        assert r.status_code == 201 and r.json()["location"] == NEW and r.json()["next"] == "verify"
        url, params, body = sent[-1]
        assert url == "accounts/111/locations" and "requestId" in params and "validateOnly" not in params
        assert body["title"] == "New Rentals" and body["categories"]["primaryCategory"]["name"] == "categories/gcid:clothing_rental_service"
        assert body["storefrontAddress"]["addressLines"] == ["12 MG Road"] and body["storefrontAddress"]["regionCode"] == "IN"
        assert body["phoneNumbers"]["primaryPhone"] == "+91 98765 43210" and body["websiteUri"] == "https://newrentals.in"
        got = client.get(f"/api/v1/businesses/{bid}").json()
        assert got["gbp_location"] == NEW and got["gbp_account"] == "accounts/111" and got["connection_id"] == cid
        # Already linked: a second create is refused
        assert client.post(f"/api/v1/businesses/{bid}/gbp/create", json=payload).status_code == 409
    finally:
        _cleanup()


def test_bad_requests_and_google_duplicates_are_refused(client, monkeypatch):
    _setup(monkeypatch)
    cid = g.connection()
    try:
        bid = client.post("/api/v1/businesses", json={"name": "Dup Rentals"}).json()["id"]
        ok = {"connection_id": cid, "account": "accounts/111", "category": "categories/gcid:x", "address": ADDRESS}
        assert client.post(f"/api/v1/businesses/{bid}/gbp/create", json={**ok, "account": "accounts/999"}).status_code == 400  # not an account of this connection
        assert client.post(f"/api/v1/businesses/{bid}/gbp/create", json={**ok, "category": "Clothes"}).status_code == 422  # must be Google's own category
        assert client.post(f"/api/v1/businesses/{bid}/gbp/create", json={**ok, "address": {**ADDRESS, "address_lines": []}}).status_code == 422
        assert client.post(f"/api/v1/businesses/{bid}/gbp/create", json={**ok, "connection_id": 99999}).status_code == 404
        base = gbp.GbpClient._req

        def dup(self, method, url, **kw):
            if method == "POST" and url.endswith("/locations"):
                raise gbp.GbpError("A location with these details already exists (ALREADY_EXISTS)")
            return base(self, method, url, **kw)
        monkeypatch.setattr(gbp.GbpClient, "_req", dup)
        r = client.post(f"/api/v1/businesses/{bid}/gbp/create", json=ok)
        assert r.status_code == 409 and "already exists" in r.json()["detail"]
        assert client.get(f"/api/v1/businesses/{bid}").json()["gbp_location"] is None  # nothing linked
    finally:
        _cleanup()
