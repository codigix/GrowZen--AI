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


def test_short_brand_name_website_and_entities_are_understood_and_ids_are_not_phones():
    class B:
        name, phone, country, website = "Codigix Infotech \u2013 Healthcare Marketing Agency", "070665 56768", "IN", "https://codigix.co"
    insta = (200, '<html><head><title>Codigix (&#064;codigix) &bull; Instagram photos and videos</title>'
                  '<meta property="og:description" content="45 Followers. Codigix (@codigix) on Instagram: Digital Marketing | SEO. codigix.co"></head>'
                  '<body>770804245193579016</body></html>')
    r = sites.check_listing(B, "https://www.instagram.com/codigix", insta)
    assert r["status"] == "listed" and r["found"]["name"].startswith("Codigix (@codigix)") and r["found"]["phone"] is None
    # a directory with the brand name but no phone and no website is not accepted
    r = sites.check_listing(B, "https://www.justdial.com/x", (200, "<title>Codigix</title><body>Codigix Pune</body>"))
    assert r["status"] == "missing"
    # a directory page with the short name and the right phone is listed
    r = sites.check_listing(B, "https://www.justdial.com/x", (200, "<title>Codigix | Justdial</title><body>Codigix Pune 070665 56768</body>"))
    assert r["status"] == "listed"


def test_a_social_profile_with_only_the_brand_name_is_listed_with_a_warning_and_no_stray_phone():
    class B:
        name, phone, country, website = "Codigix Infotech – Healthcare Marketing Agency", "070665 56768", "IN", "https://codigix.co"
    page = (200, "<html><head><title>Codigix (&#064;codigix) &bull; Instagram photos and videos</title></head><body>1054639155</body></html>")
    r = sites.check_listing(B, "https://www.instagram.com/codigix?xtok=abc", page)
    assert r["status"] == "listed" and r["found"]["phone"] is None and "make sure this profile is yours" in r["note"]
    # the same page on a directory is still not accepted
    assert sites.check_listing(B, "https://www.justdial.com/x", page)["status"] == "missing"
