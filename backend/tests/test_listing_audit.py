from types import SimpleNamespace

from app.competitors import listing_audit as la

FULL = {"basics": {"name": "Glam Rental", "category": "Clothing rental service", "summary": "Rents lehengas.", "phone": "+91 98765 43210", "website": None, "status": "open", "address": "Wagholi, Pune"},
        "hours": ["Monday: 10-8"], "reputation": {"rating": 4.7, "count": 120, "photos": 10, "reviews": [{"when": "2 weeks ago"}, {"when": "3 months ago"}]}, "features": ["a", "b", "c"], "maps_url": "https://maps.example/x"}
THIN = {"basics": {"name": "Walk In", "category": "", "summary": None, "phone": None, "website": None}, "hours": [], "reputation": {"rating": None, "count": 3, "photos": 1, "reviews": []}, "features": []}


def test_review_age_is_read_from_googles_words_and_dates():
    assert la.age_days("a month ago") == 30 and la.age_days("3 weeks ago") == 21 and la.age_days("2 years ago") == 730 and la.age_days("an hour ago") == 0
    assert la.age_days("2020-01-01T00:00:00Z") > 365 and la.age_days(None) is None and la.age_days("whenever") is None


def test_a_listing_is_scored_on_what_a_customer_sees():
    full, thin = la.score_listing(FULL), la.score_listing(THIN)
    by = {r["key"]: r["status"] for r in full["rows"]}
    assert by["website"] == "bad" and by["photos"] == "ok" and by["recent"] == "ok" and by["rating"] == "ok" and by["attributes"] == "ok"
    assert full["facts"]["newest_review_days"] == 14 and full["facts"]["reviews"] == 120
    assert 70 <= full["score"] <= 90 and thin["score"] < 10  # the missing website costs 12 points, a bare listing earns almost nothing
    assert len(full["rows"]) == len(la.CHECKS)


def test_a_competitor_with_no_website_is_audited_through_its_listing_next_to_ours(monkeypatch):
    listings = {"placeA": FULL, "placeMine": THIN | {"basics": {"name": "Mine", "category": "Clothes market", "phone": "+91 1", "website": "https://mine.in"}}}
    monkeypatch.setattr("app.services.maps_public.read", lambda pid, fresh=False: listings[pid])
    monkeypatch.setattr(la, "_resolve", lambda item, region, lat, lng: item.get("cid") or None)
    b = SimpleNamespace(name="Mine", place_id="placeMine", lat=18.5, lng=73.9)
    out = la.audit(b, [{"name": "Glam Rental", "cid": "placeA"}, {"name": "Unknown", "cid": None}])
    assert out["you"]["score"] < out["items"][0]["score"] and out["items"][0]["facts"]["website"] is None
    assert out["items"][1]["error"] == "Its Google listing could not be found." and len(out["checks"]) == len(la.CHECKS)
    b2 = SimpleNamespace(name="No pin", place_id=None, lat=None, lng=None)
    assert la.audit(b2, [{"name": "Glam Rental", "cid": "placeA"}])["you"] is None


def test_the_endpoint_needs_at_least_one_competitor(client):
    bid = client.post("/api/v1/businesses", json={"name": "Listing Co", "website": "https://listing.example/"}).json()["id"]
    assert client.post(f"/api/v1/businesses/{bid}/competitor-research/listing-audit", json={"competitors": []}).status_code == 400
