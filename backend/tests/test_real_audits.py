"""Real data for the Maps rank grid (Google Places), and never mistaking one business for another."""
from types import SimpleNamespace

import pytest

from app.config import get_settings
from app.services import providers
from app.services.match import is_same_business, same_name
from app.services.providers import google as gp

BIZ = SimpleNamespace(id=1, name="Skin 101", place_id="ChIJskin101", phone="+91 70551 01101", website="https://www.the101clinic.com/",
                      lat=18.559, lng=73.787, city="Pune", primary_category="Dermatologist")


def fake_places(query, region="IN", lat=None, lng=None, radius_m=5000.0, page_size=20, language="en"):
    near = (round(lat, 3), round(lng, 3)) == (18.559, 73.787)  # the centre point: the business ranks #2 there
    places = [{"position": 1, "title": "Clear Skin", "placeId": "ChIJclear", "phoneNumber": "+91 95845 84111"}]
    if near:
        places.append({"position": 2, "title": "Skin 101", "placeId": "ChIJskin101"})
    return places


@pytest.fixture
def places(monkeypatch):
    monkeypatch.setenv("GOOGLE_PLACES_API_KEY", "test-key")
    get_settings.cache_clear()
    from app.competitors import service
    monkeypatch.setattr(service, "places_search", fake_places)
    yield
    get_settings.cache_clear()


def test_the_rank_provider_is_google_places_when_its_key_is_set(places):
    assert providers.rank_provider().__class__.__name__ == "GooglePlacesRanks"
    assert providers.citation_provider().__class__.__name__ == "ManualCitations"  # no automatic listing search any more


def test_providers_fall_back_to_sample_without_keys():
    assert providers.rank_provider().source == "sample"  # tests run with no keys


def test_rank_grid_finds_the_business_by_its_google_place(places):
    out = gp.GooglePlacesRanks().scan_grid(BIZ, "dermatologist", 3, 2.0)
    assert out["grid_size"] == 3 and len(out["points"]) == 9
    ranks = [p["rank"] for p in out["points"]]
    assert ranks.count(2) == 1 and ranks.count(None) == 8  # found at the centre only
    assert out["competitors"][0]["name"] == "Clear Skin" and out["competitors"][0]["top3"] == 9
    assert out["requests"] == 9  # one Google Places request per point


def test_rank_grid_is_capped(places):
    assert gp.GooglePlacesRanks().scan_grid(BIZ, "dermatologist", 9, 3.0)["grid_size"] == gp.MAX_GRID


def test_listings_are_added_by_a_person_not_searched_for():
    assert gp.ManualCitations().check(BIZ) == []


def test_listing_sites_by_kind():
    from app.services import countries
    assert ("Zomato", "zomato.com") in countries.listing_sites("Restaurant", None)
    assert ("Shiksha", "shiksha.com") in countries.listing_sites("Nursery school", None)
    assert ("IndiaMART", "indiamart.com") in countries.listing_sites("Wholesaler", None)


def test_a_shared_phone_is_not_the_same_business():
    moraya = SimpleNamespace(place_id="ChIJmoraya", phone="9112706604", website=None, name="Moraya Multispeciality Hospital")
    assert not is_same_business(moraya, "ChIJwadi", "Wadi Al-Lawami Int'l Nursery, Seeb", "9112706604", None)
    assert not is_same_business(SimpleNamespace(**{**moraya.__dict__, "place_id": None}), None, "Wadi Al-Lawami Int'l Nursery", "9112706604", None)
    assert is_same_business(moraya, "ChIJmoraya", "Anything", None, None)
    assert is_same_business(SimpleNamespace(place_id=None, phone="070551 01101", website=None, name="Skin 101"), None, "Skin 101 Clinic", "+91 70551 01101", None)
    assert same_name("SMD MultiSpeciality Hospital Kalewadi", "SMD Hospital") and not same_name("Skin 101", "Skin Ethics")


def test_import_creates_a_new_project_for_a_different_business_with_the_same_phone(client):
    first = client.post("/api/v1/businesses", json={"name": "Moraya Multispeciality Hospital", "phone": "+91 91127 06604"}).json()
    r = client.post("/api/v1/discover/import", json={"email": "", "plan": "Starter", "candidate": {
        "source": "google_maps", "name": "Wadi Al-Lawami Int'l Nursery, Seeb", "phone": "9112706604", "address": "Alabab Street, Seeb, Oman"}})
    assert r.status_code == 201 and r.json()["created"] is True and r.json()["id"] != first["id"]
    assert client.get(f"/api/v1/businesses/{first['id']}").json()["name"] == "Moraya Multispeciality Hospital"  # untouched


def test_a_rejected_pagespeed_key_retries_without_it(monkeypatch):
    from app.services import pagespeed
    monkeypatch.setenv("PAGESPEED_API_KEY", "bad-key")
    get_settings.cache_clear()
    sent = []

    class Resp:
        def __init__(self, ok):
            self.status_code = 200 if ok else 400
            self.headers = {"content-type": "application/json"}
            self._ok = ok
        def json(self):
            return {"lighthouseResult": {}} if self._ok else {"error": {"message": "API key not valid. Please pass a valid API key."}}

    def fake_get(url, params, timeout):
        has_key = any(k == "key" for k, _ in params)
        sent.append(has_key)
        return Resp(ok=not has_key)

    monkeypatch.setattr(pagespeed.httpx, "get", fake_get)
    assert pagespeed.fetch("https://example.com") == {"lighthouseResult": {}}
    assert sent == [True, False]  # tried with the key, then without
    get_settings.cache_clear()


def test_onboarding_audit_can_wait_for_the_details(client, monkeypatch):
    from app.routers import discover
    started = []
    monkeypatch.setattr(discover, "_onboard", lambda db, bid: started.append(bid))
    r = client.post("/api/v1/discover/import", json={"email": "", "candidate": {"source": "manual", "name": "Deferred Dental"}, "defer_audit": True})
    bid = r.json()["id"]
    assert started == []  # not yet
    assert client.post(f"/api/v1/discover/onboard/{bid}").status_code == 202
    assert started == [bid]


def test_default_rank_keywords_skip_generic_categories():
    from app.competitors.intel import default_keywords
    b = SimpleNamespace(name="Skin 101", primary_category="Doctor", secondary_categories=["Dermatologist"], services=[], area="Baner", city="Pune")
    assert default_keywords(b)[0] == "dermatologist in Baner"


def test_audits_always_start_at_the_homepage():
    from app.services import crawler

    assert crawler.homepage("https://parthvalve.com/products/valves?id=3#x") == "https://parthvalve.com/"
    assert crawler.homepage("parthvalve.com/about") == "https://parthvalve.com/"
    assert crawler.homepage("http://www.site.in") == "http://www.site.in/"
