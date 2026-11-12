"""Listing management: the merged view of the automatic check and manual links, and checking a listing page against the profile."""
from app.services import citation_sites as sites

PAGE_OK = (200, "<html><head><title>Asha Rentals - Pune | Justdial</title></head><body>Asha Rentals, Wagholi Pune. Call 98765 43210</body></html>")
PAGE_OTHER_PHONE = (200, "<html><title>Asha Rentals</title><body>Asha Rentals Pune. Phone 99999 11111</body></html>")
PAGE_OTHER_BUSINESS = (200, "<html><title>Some Other Shop</title><body>Call 98765 43210</body></html>")


def _project(client):
    r = client.post("/api/v1/businesses", json={"name": "Asha Rentals", "phone": "+91 98765 43210", "city": "Pune", "address": "12 MG Road, Pune", "country": "IN", "primary_category": "Clothing rental service"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_checking_a_listing_page_against_the_profile():
    class B:
        name, phone, country = "Asha Rentals", "+91 98765 43210", "IN"
    assert sites.check_listing(B, "https://x.test", PAGE_OK)["status"] == "listed"
    assert sites.check_listing(B, "https://x.test", PAGE_OTHER_PHONE)["status"] == "inconsistent"
    assert sites.check_listing(B, "https://x.test", PAGE_OTHER_BUSINESS)["status"] == "missing"
    assert sites.check_listing(B, "https://x.test", (404, ""))["status"] == "missing"


def test_overview_manual_links_verify_and_remove(client, monkeypatch):
    bid = _project(client)
    base = f"/api/v1/businesses/{bid}/citations"
    ov = client.get(f"{base}/overview").json()
    keys = [d["key"] for d in ov["directories"]]
    assert keys[0] == "google" and "justdial" in keys and "yelp" not in keys  # Indian business: Indian directories, not US ones
    assert ov["nap"]["phone"] == "+91 98765 43210" and ov["summary"]["total"] == len(keys)
    assert next(d for d in ov["directories"] if d["key"] == "justdial")["submit_url"].startswith("https://")
    # Google is managed elsewhere
    assert client.put(f"{base}/listings/google", json={"url": "https://x.in"}).status_code == 400
    # A person adds a link, then it is checked
    assert client.put(f"{base}/listings/justdial", json={"url": "not a link"}).status_code == 422
    assert client.put(f"{base}/listings/justdial", json={"url": "https://www.justdial.com/Pune/Asha-Rentals"}).status_code == 200
    monkeypatch.setattr(sites, "fetch_page", lambda url: PAGE_OK)
    v = client.post(f"{base}/listings/justdial/verify").json()
    assert v["status"] == "listed"
    row = next(d for d in client.get(f"{base}/overview").json()["directories"] if d["key"] == "justdial")
    assert row["status"] == "listed" and row["source"] == "manual" and row["url"].endswith("Asha-Rentals")
    assert client.get(f"{base}/overview").json()["summary"]["listed"] == 1
    # A mismatch is reported, then a manual 'pending' mark, then removal
    monkeypatch.setattr(sites, "fetch_page", lambda url: PAGE_OTHER_PHONE)
    assert client.post(f"{base}/listings/justdial/verify").json()["status"] == "inconsistent"
    assert client.put(f"{base}/listings/sulekha", json={"status": "pending", "note": "Submitted on 12 Nov"}).status_code == 200
    assert next(d for d in client.get(f"{base}/overview").json()["directories"] if d["key"] == "sulekha")["status"] == "pending"
    assert client.post(f"{base}/listings/indiamart/verify").status_code == 422  # nothing to check yet
    assert client.put(f"{base}/listings/sulekha", json={"status": "bogus"}).status_code == 422
    assert client.delete(f"{base}/listings/sulekha").status_code == 204
    assert next(d for d in client.get(f"{base}/overview").json()["directories"] if d["key"] == "sulekha")["status"] == "missing"
    # The page cannot be opened
    def boom(url):
        raise OSError("blocked address")
    monkeypatch.setattr(sites, "fetch_page", boom)
    assert client.post(f"{base}/listings/justdial/verify").status_code == 502


def test_listings_are_private_to_the_owner(client):
    from test_security import login, user
    user("cit1@x.in", "editor")
    user("cit2@x.in", "editor")
    a, _ = login("cit1@x.in")
    o, _ = login("cit2@x.in")
    bid = a.post("/api/v1/businesses", json={"name": "Mine Co"}).json()["id"]
    assert a.get(f"/api/v1/businesses/{bid}/citations/overview").status_code == 200
    assert o.get(f"/api/v1/businesses/{bid}/citations/overview").status_code == 404
    assert o.put(f"/api/v1/businesses/{bid}/citations/listings/justdial", json={"url": "https://x.in/a"}).status_code == 404
