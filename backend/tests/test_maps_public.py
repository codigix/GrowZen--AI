"""The public Google Maps view of a listing: read through Places, set against the saved profile, copied in on request."""
import pytest

from app.services import discovery, maps_public

PLACE = {"id": "ChIJ123", "displayName": {"text": "Hub Clinic"}, "formattedAddress": "12 MG Road, Pune, Maharashtra 411001, India", "nationalPhoneNumber": "020 1234 5678",
         "internationalPhoneNumber": "+91 20 1234 5678", "websiteUri": "https://hub-clinic.in/", "rating": 4.6, "userRatingCount": 120, "primaryTypeDisplayName": {"text": "Dental clinic"},
         "types": ["dentist", "health", "point_of_interest"], "location": {"latitude": 18.52, "longitude": 73.85}, "businessStatus": "OPERATIONAL",
         "regularOpeningHours": {"weekdayDescriptions": ["Monday: 9:00 AM - 6:00 PM"]}, "editorialSummary": {"text": "Family dental care."},
         "reviews": [{"rating": 5, "text": {"text": "Great"}, "authorAttribution": {"displayName": "Asha"}, "relativePublishTimeDescription": "a week ago"}],
         "photos": [{}, {}], "wheelchairAccessibleEntrance": True, "takeout": True, "paymentOptions": {"acceptsCreditCards": True}}


@pytest.fixture()
def bid(client, monkeypatch):
    monkeypatch.setattr(discovery, "places_enabled", lambda: True)
    monkeypatch.setattr(maps_public, "fetch", lambda place_id, fresh=False: PLACE)
    b = client.post("/api/v1/businesses", json={"name": "Hub Clinic", "website": "https://old.example/"}).json()["id"]
    from app.db import SessionLocal
    from app.models import Business
    db = SessionLocal()
    try:
        db.get(Business, b).place_id = "ChIJ123"
        db.commit()
    finally:
        db.close()
    return b


def test_reads_public_info_and_compares(client, bid):
    r = client.get(f"/api/v1/businesses/{bid}/maps-public").json()
    assert r["state"] == "ok"
    assert r["reputation"]["rating"] == 4.6 and r["reputation"]["count"] == 120 and r["reputation"]["photos"] == 2
    assert r["reputation"]["reviews"][0]["author"] == "Asha"
    assert r["basics"]["category"] == "Dental clinic" and r["basics"]["categories"] == ["Dentist", "Health"]
    assert "Takeaway" in r["features"] and "Credit cards" in r["features"]
    by = {c["field"]: c for c in r["compare"]}
    assert by["name"]["same"] is True and by["website"]["same"] is False
    assert "Posts and offers" in r["not_public"]


def test_apply_copies_chosen_fields(client, bid):
    r = client.post(f"/api/v1/businesses/{bid}/maps-public/apply", json={"fields": ["website", "phone", "hours"]})
    assert r.status_code == 200 and set(r.json()["applied"]) == {"website", "phone", "hours"}
    b = client.get(f"/api/v1/businesses/{bid}").json()
    assert b["website"] == "https://hub-clinic.in/"


def test_not_linked_to_maps(client, monkeypatch):
    monkeypatch.setattr(discovery, "places_enabled", lambda: True)
    b = client.post("/api/v1/businesses", json={"name": "No Place Co"}).json()["id"]
    assert client.get(f"/api/v1/businesses/{b}/maps-public").json()["state"] == "no_place"


INFO = {"title": "Hub Clinic", "category": "Dental clinic", "additional_categories": ["Dentist"], "description": "x" * 300, "phone": "+91 20 1234 5678", "website": "https://hub-clinic.in/",
        "book_url": None, "address": "12 MG Road", "address_info": {}, "rating": 4.2, "votes": 40, "distribution": {"1": 5, "2": 3, "5": 32}, "photos": 12, "claimed": True, "price": None,
        "hours": ["Monday: 09:00-18:00"], "attributes": [], "attributes_missing": [], "services": [], "topics": [], "qa_count": None, "links": [], "logo": None, "image": None, "cid": "1", "read_at": "2026-11-18T00:00:00+00:00"}


def test_profile_analysis_and_roadmap(client, bid, monkeypatch):
    from app.services import gbp_public
    monkeypatch.setattr(gbp_public, "configured", lambda: True)
    monkeypatch.setattr(gbp_public, "info", lambda *a, **k: INFO)
    monkeypatch.setattr(gbp_public, "posts", lambda *a, **k: [{"text": "Offer", "date": "2020-01-01", "url": None, "image": None, "has_link": False}])
    r = client.get(f"/api/v1/businesses/{bid}/maps-public/profile").json()
    assert r["state"] == "ok" and r["posts"] is None and 0 < r["analysis"]["score"] < 100
    keys = {c["key"]: c["status"] for c in r["analysis"]["checks"]}
    assert keys["photos"] == "bad" and keys["reviews"] == "warn" and "posts" not in keys
    full = client.post(f"/api/v1/businesses/{bid}/maps-public/report").json()
    assert {c["key"]: c["status"] for c in full["analysis"]["checks"]}["posts"] == "bad"
    assert [p["days"] for p in full["analysis"]["roadmap"]] == [7, 30, 90] and full["analysis"]["roadmap"][0]["items"]
    done = client.post(f"/api/v1/businesses/{bid}/maps-public/apply-profile", json={"fields": ["primary_category", "secondary_categories", "description"]}).json()
    assert set(done["applied"]) == {"primary_category", "secondary_categories", "description"}
