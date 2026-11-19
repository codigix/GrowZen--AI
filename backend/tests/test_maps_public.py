"""The public Google Maps view of a listing: read through Places, set against the saved profile, copied in on request."""
import pytest

from app.services import discovery, maps_public

PLACE = {"id": "ChIJ123", "displayName": {"text": "Hub Clinic"}, "formattedAddress": "12 MG Road, Pune, Maharashtra 411001, India", "nationalPhoneNumber": "020 1234 5678",
         "internationalPhoneNumber": "+91 20 1234 5678", "websiteUri": "https://hub-clinic.in/", "rating": 4.6, "userRatingCount": 120, "primaryTypeDisplayName": {"text": "Dental clinic"},
         "types": ["dentist", "health", "point_of_interest"], "location": {"latitude": 18.52, "longitude": 73.85}, "businessStatus": "OPERATIONAL",
         "regularOpeningHours": {"weekdayDescriptions": ["Monday: 9:00 AM - 6:00 PM"]}, "editorialSummary": {"text": "Family dental care."},
         "reviews": [{"name": "places/ChIJ123/reviews/r1", "publishTime": "2026-10-30T14:59:17Z", "rating": 5, "text": {"text": "Great"}, "authorAttribution": {"displayName": "Asha"}, "relativePublishTimeDescription": "a week ago"},
                     {"name": "places/ChIJ123/reviews/r2", "publishTime": "2026-10-20T09:00:00Z", "rating": 2, "authorAttribution": {"displayName": "Ravi"}}],
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


SEARCH = {"state": "ok", "account": "owner@example.com", "property": "sc-domain:hub-clinic.in", "period": {"start": "2026-10-20", "end": "2026-11-16", "days": 28},
          "totals": {"clicks": 40, "impressions": 900, "ctr": 4.4, "position": 12.5, "keywords": 30, "pages": 8}, "previous": {"clicks": 30, "impressions": 700, "ctr": 4.2, "position": 14.0, "keywords": 20, "pages": 6},
          "keywords": [{"query": "hub clinic", "clicks": 20, "impressions": 300, "ctr": 6.6, "position": 1.2}, {"query": "dentist near me pune", "clicks": 3, "impressions": 200, "ctr": 1.5, "position": 9.0},
                       {"query": "teeth whitening", "clicks": 1, "impressions": 400, "ctr": 0.2, "position": 21.0}], "pages": []}


def _city(bid, city="Pune"):
    from app.db import SessionLocal
    from app.models import Business
    db = SessionLocal()
    try:
        db.get(Business, bid).city = city
        db.commit()
    finally:
        db.close()


def test_profile_comes_from_google_places_and_search_console_not_a_paid_service(client, bid, monkeypatch):
    from app.services import gbp_public
    _city(bid)
    monkeypatch.setattr(gbp_public, "search", lambda db, b: SEARCH)
    r = client.get(f"/api/v1/businesses/{bid}/maps-public/profile").json()
    assert r["state"] == "ok" and r["profile"]["source"] == "Google Places"
    p = r["profile"]
    assert p["rating"] == 4.6 and p["votes"] == 120 and p["distribution"] is None and p["claimed"] is None and p["services"] == [] and r["posts"] is None
    keys = {c["key"]: c["status"] for c in r["analysis"]["checks"]}
    assert "claimed" not in keys and "posts" not in keys and "description" not in keys and "negatives" not in keys  # what Google does not share is left out, not guessed
    assert keys["search_visibility"] == "warn" and keys["brand_search"] == "ok" and keys["local_search"] == "ok"
    assert r["analysis"]["search_read"] is True and r["search"]["totals"]["clicks"] == 40
    assert [x["days"] for x in r["analysis"]["roadmap"]] == [7, 30, 90] and r["analysis"]["roadmap"][2]["items"]


def test_profile_says_why_search_console_cannot_be_read(client, bid, monkeypatch):
    from app.services import gsc_access
    monkeypatch.setattr(gsc_access, "search_console", lambda db, b, host: ("not_connected", "No Google account is linked to this project.", None, None))
    r = client.get(f"/api/v1/businesses/{bid}/maps-public/profile").json()
    assert r["state"] == "ok" and r["search"]["state"] == "not_connected" and "No Google account" in r["search"]["message"]
    assert r["analysis"]["search_read"] is False and "search_visibility" not in {c["key"] for c in r["analysis"]["checks"]}


def test_a_connected_profile_adds_its_own_saved_reviews_posts_and_services(client, bid, monkeypatch):
    from datetime import date, datetime, timezone

    from app.db import SessionLocal
    from app.models import Business, Post, Review
    from app.services import gbp_public
    monkeypatch.setattr(gbp_public, "search", lambda db, b: {"state": "no_site", "message": "x"})
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        b.gbp_location, b.description, b.photo_count = "locations/1", "d" * 420, 140
        b.services = [{"name": "Cleaning", "price": "500"}]
        for i, star in enumerate([5, 5, 5, 4, 4, 2]):
            db.add(Review(business_id=bid, external_id=f"g{i}", author=f"A{i}", rating=star, review_date=date(2026, 10, 1)))
        db.add(Post(business_id=bid, body="Offer", status="published", published_at=datetime.now(timezone.utc)))
        db.commit()
    finally:
        db.close()
    r = client.get(f"/api/v1/businesses/{bid}/maps-public/profile").json()
    p = r["profile"]
    assert p["claimed"] is True and p["distribution"] == {"1": 0, "2": 1, "3": 0, "4": 2, "5": 3} and p["services"][0]["name"] == "Cleaning" and p["photos"] == 140 and p["photos_partial"] is False
    keys = {c["key"]: c["status"] for c in r["analysis"]["checks"]}
    assert keys["claimed"] == "ok" and keys["description"] == "ok" and keys["negatives"] == "bad" and keys["services"] == "ok" and keys["posts"] in ("ok", "warn")
    assert len(r["posts"]) == 1


def test_save_the_reviews_google_shows(client, bid):
    r = client.post(f"/api/v1/businesses/{bid}/maps-public/import-reviews", json={"depth": 5}).json()
    assert r == {"added": 2, "skipped": 0, "read": 2}
    again = client.post(f"/api/v1/businesses/{bid}/maps-public/import-reviews", json={"depth": 5}).json()
    assert again["added"] == 0 and again["skipped"] == 2
    rows = {x["author"]: x for x in client.get(f"/api/v1/businesses/{bid}/maps-public/reviews").json()["reviews"]}
    assert rows["Asha"]["rating"] == 5 and rows["Asha"]["body"] == "Great" and rows["Ravi"]["rating"] == 2


def test_apply_profile_copies_only_what_maps_really_has(client, bid):
    r = client.post(f"/api/v1/businesses/{bid}/maps-public/apply-profile", json={"fields": ["primary_category", "phone", "secondary_categories", "description"]}).json()
    assert set(r["applied"]) == {"primary_category", "phone"}  # Google's summary is not the owner's description, and its place types are not business categories
    b = client.get(f"/api/v1/businesses/{bid}").json()
    assert b["primary_category"] == "Dental clinic"


def test_the_report_is_told_for_a_client_themes_gaps_with_reasons_and_the_score_if_fixed(client, bid, monkeypatch):
    from app.services import gbp_public
    _city(bid)
    monkeypatch.setattr(gbp_public, "search", lambda db, b: SEARCH)
    a = client.get(f"/api/v1/businesses/{bid}/maps-public/profile").json()["analysis"]
    assert [x["key"] for x in a["pillars"]] == ["reputation", "profile", "activity", "search"]
    activity = next(x for x in a["pillars"] if x["key"] == "activity")
    assert "Recent posts" in activity["missing"]  # what could not be measured is named, not scored
    assert a["gaps"] and all(g["why_it_matters"] and g["help"]["title"] and g["fix"] for g in a["gaps"])
    assert a["potential"] >= a["score"] and a["potential"] <= 100 and a["headline"]
    assert all(s["status"] == "ok" for s in a["strengths"])
    assert {g["pillar"] for g in a["gaps"]} <= {"reputation", "profile", "activity", "search"}


def test_the_comparison_appears_only_with_two_chosen_competitors(client, bid, monkeypatch):
    from app.db import SessionLocal
    from app.models import Competitor
    from app.services import gbp_public
    monkeypatch.setattr(gbp_public, "search", lambda db, b: {"state": "no_site", "message": "x"})
    assert client.get(f"/api/v1/businesses/{bid}/maps-public/profile").json()["compare"] is None
    db = SessionLocal()
    try:
        db.add_all([Competitor(business_id=bid, name="Rival A", website="https://a.example", rating=4.8, reviews=300, selected=True),
                    Competitor(business_id=bid, name="Rival B", website="https://b.example", rating=4.1, reviews=40, selected=True),
                    Competitor(business_id=bid, name="Not chosen", website="https://c.example", rating=5.0, reviews=9, selected=False)])
        db.commit()
    finally:
        db.close()
    c = client.get(f"/api/v1/businesses/{bid}/maps-public/profile").json()["compare"]
    assert c["you"]["rating"] == 4.6 and [x["name"] for x in c["others"]] == ["Rival A", "Rival B"] and c["rank"] == 2


def test_the_report_leads_with_what_is_missing_and_names_what_google_hides(client, bid, monkeypatch):
    from app.services import gbp_public
    monkeypatch.setattr(gbp_public, "search", lambda db, b: {"state": "not_connected", "message": "x"})
    a = client.get(f"/api/v1/businesses/{bid}/maps-public/profile").json()["analysis"]
    hidden = {u["key"] for u in a["unverified"]}
    assert {"claimed", "services", "posts", "search_visibility"} <= hidden  # not visible without access: said so, not guessed
    assert all(u["why_it_matters"] and u["help"]["title"] for u in a["unverified"])
    assert "cannot confirm from outside" in a["headline"] or "cannot be checked from outside" in a["headline"]
    assert not hidden & {c["key"] for c in a["checks"]}  # a thing is either measured or unverified, never both
