"""Businesses in any country: detection, phones, postcodes, listing sites, and Google searched in that country."""
from types import SimpleNamespace

from app.services import countries as C
from app.services.match import is_same_business


def test_detect_from_maps_address_and_phone():
    assert C.detect([{"types": ["locality"], "shortText": "Seeb"}, {"types": ["country", "political"], "shortText": "OM"}]) == "OM"
    assert C.detect(address="Alabab Street, Seeb, Oman") == "OM"
    assert C.detect(address="Sheikh Zayed Rd, Dubai, United Arab Emirates") == "AE"
    assert C.detect(address="Baner, Pune, Maharashtra 411045, India") == "IN"
    assert C.detect(phone="+968 9123 4567") == "OM"
    assert C.detect(phone="+971 50 123 4567") == "AE"
    assert C.detect(phone="98220 11223") is None  # no dial code: can't tell
    assert C.of(SimpleNamespace(country=None)) == "IN" and C.of(SimpleNamespace(country="om")) == "OM"


def test_phones_in_any_format():
    assert C.national("+968 9123 4567", "OM") == "91234567"
    assert C.same_phone("+968 9123 4567", "9123 4567", "OM")
    assert C.same_phone("+91 98220 11223", "098220 11223", "IN")
    assert C.same_phone("+44 20 7946 0958", "020 7946 0958", "GB")
    assert not C.same_phone("+968 9123 4567", "+968 9123 4568", "OM")
    assert C.phone_ok("+968 9123 4567", "OM") and not C.phone_ok("9123 456", "OM")
    assert C.phone_ok("+91 98220 11223", "IN") and not C.phone_ok("+91 98220 112", "IN")
    assert C.format_phone("91234567", "OM") == "+968 9123 4567"
    assert C.format_phone("9822011223", "IN") == "+91 98220 11223"


def test_postcodes_only_where_used():
    assert C.has_postcode("Baner, Pune 411045", "IN") and not C.has_postcode("Baner, Pune", "IN")
    assert C.has_postcode("Alabab Street, Seeb", "OM")  # Oman doesn't use postcodes in addresses
    assert C.has_postcode("10 Downing St, London SW1A 2AA", "GB") and not C.has_postcode("10 Downing St, London", "GB")
    assert C.postcode_name("US") == "ZIP code" and C.postcode_name("IN") == "PIN code"


def test_listing_sites_by_country_and_kind():
    oman = [n for n, _ in C.listing_sites("Nursery school", "OM")]
    assert "Yellow Pages Oman" in oman and "Justdial" not in oman
    assert "Practo" in [n for n, _ in C.listing_sites("Dentist", "IN")]
    us = [n for n, _ in C.listing_sites("Plumber", "US")]
    assert us[:2] == ["Yelp", "Better Business Bureau"]
    assert [n for n, _ in C.listing_sites("Shop", "FR")][:2] == ["Facebook", "Instagram"]  # unlisted country: international sites


def test_same_business_across_countries():
    oman = SimpleNamespace(place_id=None, phone="+968 9123 4567", website=None, name="Wadi Al-Lawami Nursery", country="OM")
    assert is_same_business(oman, None, "Wadi Al Lawami Nursery", "9123 4567", None)
    assert not is_same_business(oman, None, "Moraya Hospital", "9123 4567", None)


def test_assist_checks_follow_the_country(monkeypatch):
    from app.services import onboard_assist
    form = {"name": "Wadi Al-Lawami Nursery", "phone": "+968 9123 4567", "address": "Alabab Street, Seeb", "country": "OM", "description": ""}
    texts = [c["text"] for c in onboard_assist.checks(form, {}, None, False)]
    assert not any("phone" in t.lower() for t in texts) and not any("postcode" in t.lower() or "PIN" in t for t in texts)
    india = {**form, "country": "IN", "phone": "+91 98220 112", "address": "Baner, Pune"}
    texts = [c["text"] for c in onboard_assist.checks(india, {}, None, False)]
    assert any("India" in t for t in texts) and any("PIN code" in t for t in texts)


def test_google_is_searched_in_the_business_country(monkeypatch):
    from app.competitors import intel
    from app.config import get_settings
    monkeypatch.setenv("SERPER_API_KEY", "k")
    get_settings.cache_clear()
    sent = []
    monkeypatch.setattr(intel.Serper, "call", lambda self, path, body: sent.append(body) or {"organic": []})
    intel.Serper("OM").search("nursery in seeb", "Seeb, Oman")
    assert sent[0]["gl"] == "om" and sent[0]["location"] == "Seeb, Oman"
    assert intel.default_location(SimpleNamespace(city="Seeb", country="OM")) == "Seeb, Oman"
    get_settings.cache_clear()


def test_countries_endpoint(client):
    rows = {r["code"]: r for r in client.get("/api/v1/discover/countries").json()}
    assert rows["OM"]["dial"] == "968" and rows["OM"]["postcode"] is None and rows["IN"]["postcode_name"] == "PIN code"


def test_business_keeps_its_country(client):
    bid = client.post("/api/v1/businesses", json={"name": "Seeb Bakery", "country": "OM"}).json()["id"]
    assert client.get(f"/api/v1/businesses/{bid}").json()["country"] == "OM"
    r = client.post("/api/v1/discover/import", json={"email": "", "candidate": {"source": "google_maps", "name": "Dubai Dental", "country": "AE", "phone": "+971 50 123 4567"}, "defer_audit": True})
    assert r.json()["country"] == "AE"
