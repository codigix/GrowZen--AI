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
