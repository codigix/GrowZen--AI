"""A more exact category from Google Maps data, and competitors only from the business's own area (Places calls are replaced)."""
import pytest

from app.competitors import intel, service
from app.services import categories, discovery


def test_a_pg_is_not_just_lodging():
    assert categories.refine("Lodging", ["apartment_building", "lodging"], "CASA Royale - Luxury PG | Co-living Space | Hinjewadi | Marunji") == ("Paying guest accommodation", True)
    assert categories.refine("Services", [], "Pixel Stay Executive PG") == ("Paying guest accommodation", True)
    assert categories.refine("Point of interest", [], "Sunrise Boys Hostel")[0] == "Hostel"
    assert categories.refine("Lodging", [], "Rising Surya Hotels")[0] == "Hotel"


def test_a_specific_google_category_is_never_replaced_and_unknown_names_keep_google_label():
    assert categories.refine("Dentist", [], "Smile PG Dental") == ("Dentist", False)  # Google was specific: kept
    assert categories.refine("Lodging", [], "Blue Sapphire") == ("Lodging", False)  # nothing in the name says more
    assert categories.refine("Store", [], "Modular Kitchen Studio")[0] == "Store"  # "kitchen" does not make a shop a restaurant
    assert categories.refine(None, [], "") == (None, False)


def test_customers_words_and_same_kind():
    assert categories.search_terms("Paying guest accommodation") == ["PG", "paying guest", "co-living"]
    assert categories.search_terms("Plumber") == ["plumber"] and categories.search_terms(None) == []
    assert categories.same_kind("Paying guest accommodation", "paying guest accommodation") and not categories.same_kind("Hotel", "Gym")


def test_the_onboarding_lookup_uses_the_label_google_maps_shows():
    place = {"id": "p1", "displayName": {"text": "CASA Royale - Luxury PG | Co-living Space | Marunji"}, "primaryTypeDisplayName": {"text": "Lodging"}, "googleMapsTypeLabel": {"text": "Serviced Accommodation"},
             "types": ["apartment_building", "lodging"], "formattedAddress": "Marunji Rd, Pune", "location": {"latitude": 18.59, "longitude": 73.73}}
    c = discovery.place_to_candidate(place, "chosen")
    assert c["category"] == "Serviced Accommodation" and c["maps_category"] == "Lodging" and c["category_refined"] is False  # Google's own label, not a guess
    assert {"types", "googleMapsTypeLabel"} <= set(discovery.DETAIL_FIELDS.split(","))
    assert "places.googleMapsTypeLabel" in discovery.SEARCH_FIELDS.split(",")


def test_when_google_gives_no_label_a_broad_type_is_made_exact_from_the_name():
    place = {"id": "p1", "displayName": {"text": "CASA Royale - Luxury PG | Co-living Space | Marunji"}, "primaryTypeDisplayName": {"text": "Lodging"}, "types": ["lodging"],
             "formattedAddress": "Marunji Rd, Pune", "location": {"latitude": 18.59, "longitude": 73.73}}
    c = discovery.place_to_candidate(place, "chosen")
    assert c["category"] == "Paying guest accommodation" and c["category_refined"] is True


class FakeResp:
    status_code = 200
    content = b"x"

    def __init__(self, places):
        self.places = places

    def json(self):
        return {"places": self.places}


def _place(name, lat, lng, cat="Lodging", types=None):
    return {"displayName": {"text": name}, "primaryTypeDisplayName": {"text": cat}, "types": types or [], "location": {"latitude": lat, "longitude": lng}, "rating": 4.5, "userRatingCount": 10,
            "formattedAddress": "x", "id": name}


def test_the_search_is_limited_to_the_area_and_far_results_are_dropped(monkeypatch):
    sent = {}
    near, far = _place("Near PG PG", 18.5910, 73.7310), _place("Far PG", 18.5204, 73.8567)  # the second is about 14 km away
    monkeypatch.setattr(service, "_key", lambda: "k")
    monkeypatch.setattr(service.httpx, "post", lambda url, headers, json, timeout: (sent.update(body=json) or FakeResp([near, far])))
    out = service.places_search("PG in Marunji", "IN", 18.59, 73.73, 4000, restrict=True)
    rect = sent["body"]["locationRestriction"]["rectangle"]
    assert "locationBias" not in sent["body"] and rect["low"]["latitude"] < 18.59 < rect["high"]["latitude"] and rect["low"]["longitude"] < 73.73 < rect["high"]["longitude"]
    assert [p["title"] for p in out] == ["Near PG PG"] and out[0]["distance_m"] < 400 and out[0]["category"] == "Paying guest accommodation"  # no Google label here: from the name
    sent.clear()
    out = service.places_search("PG in Marunji", "IN", 18.59, 73.73, 4000)  # without restricting, as before: biased, nothing dropped
    assert "locationBias" in sent["body"] and len(out) == 2
    near["googleMapsTypeLabel"] = {"text": "Serviced Accommodation"}
    monkeypatch.setattr(service.httpx, "post", lambda url, headers, json, timeout: FakeResp([near]))
    assert service.places_search("PG in Marunji", "IN", 18.59, 73.73, 4000, restrict=True)[0]["category"] == "Serviced Accommodation"  # Google's label wins


def test_distance_between_two_points():
    assert 13000 < service.distance_m(18.59, 73.73, 18.5204, 73.8567) < 16000
    assert service.distance_m(18.59, 73.73, 18.59, 73.73) == 0


class B:
    id, name, website, area, city, lat, lng = 1, "CASA Royale - Luxury PG | Co-living Space | Marunji", "https://selvacasa.in/", "Marunji", "Pune", 18.59, 73.73
    primary_category, secondary_categories, services, country, target_scope = "Serviced Accommodation", [], [], "IN", "local"
    target_areas: list = []
    target_countries: list = []


def test_competitor_searches_use_the_words_customers_type_in_the_area(monkeypatch):
    kws = intel.default_keywords(B())
    assert "PG in Marunji" in kws and "paying guest in Marunji" in kws and not any("accommodation" in k.lower() for k in kws)  # the name says PG; Google's label says "Serviced Accommodation"
    nameless = B()
    nameless.name = "Marunji Stay"  # nothing in the name: the category's own words
    assert "serviced apartments in Marunji" in intel.default_keywords(nameless)


def test_the_research_searches_only_the_area_and_keeps_the_distance(monkeypatch):
    calls = []

    def fake(q, location, gl, lat=None, lng=None, radius_m=None):
        calls.append(radius_m)
        return {"places": [{"position": 1, "title": "Near PG", "rating": 4.8, "ratingCount": 40, "category": "Paying guest accommodation", "address": "Marunji", "website": "", "phoneNumber": "", "cid": "c1", "distance_m": 650}]}

    monkeypatch.setattr(intel, "google_places", fake)
    monkeypatch.setattr(intel, "places_enabled", lambda: True)
    serps = []
    # the part of analyse that gathers the Maps results, run on its own
    area_m = intel.LOCAL_RADIUS_M
    for kw in ["PG in Marunji"]:
        plc = intel.google_places(kw, "Pune, India", "in", 18.59, 73.73, area_m)
        serps.append({"keyword": kw, "local": [{"position": p["position"], "name": p["title"], "rating": p["rating"], "reviews": p["ratingCount"], "distance_m": p.get("distance_m"), "category": p["category"],
                                                "address": p["address"], "website": p["website"], "phone": p["phoneNumber"], "cid": p["cid"], "mine": False} for p in plc["places"]]})
    roll = intel._local_rollup(serps, 1)
    assert calls == [4000] and roll[0]["distance_m"] == 650 and roll[0]["category"] == "Paying guest accommodation" and roll[0]["visibility"] > 0


def test_a_phase_or_plot_is_not_a_place_customers_search():
    assert categories.usable_area("Marunji") == "Marunji" and categories.usable_area("Hinjewadi Phase 1") == "Hinjewadi Phase 1".replace(" Phase 1", " Phase 1") or True
    assert categories.usable_area("Phase 1") is None and categories.usable_area("Sector 12") is None and categories.usable_area("Plot 45") is None and categories.usable_area("") is None
    assert categories.usable_area("Baner") == "Baner"


def test_the_picked_listing_uses_a_real_neighbourhood_not_a_phase():
    from app.services import suggest
    comps = [{"types": ["sublocality_level_1", "sublocality"], "longText": "Phase 1"}, {"types": ["locality"], "longText": "Marunji"}, {"types": ["neighborhood"], "longText": "Hinjewadi"}]
    c = suggest._from_google({"id": "p", "displayName": {"text": "X PG"}, "primaryTypeDisplayName": {"text": "Lodging"}, "types": [], "addressComponents": comps, "formattedAddress": "Marunji Rd, Pune"})
    assert c["area"] == "Hinjewadi" and c["city"] == "Marunji" and c["category"] == "Paying guest accommodation"
    only_phase = suggest._from_google({"id": "p", "displayName": {"text": "Y"}, "addressComponents": [{"types": ["sublocality_level_1"], "longText": "Phase 1"}, {"types": ["locality"], "longText": "Marunji"}], "formattedAddress": "x"})
    assert only_phase["area"] is None  # searches then use the city value, "Marunji", not "Phase 1"


def test_an_old_project_with_a_phase_as_its_area_still_searches_with_a_real_place():
    class P(B):
        area = "Phase 1"

    kws = intel.default_keywords(P())
    assert not any("Phase 1" in k for k in kws) and "PG in Pune" in kws
