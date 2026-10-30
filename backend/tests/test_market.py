"""A project's market (local / national / international) decides how it is searched and what its pages show."""
from types import SimpleNamespace

from app.competitors import intel
from app.services import market


def biz(**kw):
    return SimpleNamespace(**({"name": "Sai Dental", "primary_category": "Dentist", "secondary_categories": [], "services": [{"name": "Root canal"}], "area": "Aundh, Pune", "city": "Pune",
                               "country": "IN", "target_scope": None, "target_countries": []} | kw))


def test_local_is_the_default_and_searches_the_city():
    b = biz()
    assert market.scope(b) == "local" and market.search_location(b) == "Pune, India" and market.places(b) == ["Aundh", "Pune"]
    assert intel.default_keywords(b)[:2] == ["dentist in Aundh", "dentist in Pune"]
    assert market.summary(b)["geo_grid"] is True and market.label(b) == "Local · Aundh, Pune"


def test_national_reads_google_for_the_whole_country_without_a_city():
    b = biz(target_scope="national")
    assert market.search_location(b) == "India" and market.places(b) == ["India"] and market.serp_country(b) == "IN"
    kws = intel.default_keywords(b)
    assert kws[0] == "dentist" and "best dentist" in kws and not any("pune" in k.lower() or "aundh" in k.lower() for k in kws)
    assert intel.default_location(b) == "India" and market.summary(b)["geo_grid"] is False and market.label(b) == "National · India"


def test_international_reads_google_per_target_country():
    b = biz(target_scope="international", target_countries=["US", "GB", "AE"])
    assert market.target_countries(b) == ["US", "GB", "AE"] and market.serp_country(b) == "US" and market.search_location(b) == "United States"
    assert intel.default_keywords(b)[:3] == ["dentist in United States", "dentist in United Kingdom", "dentist in United Arab Emirates"]
    assert market.places(b) == ["United States", "United Kingdom", "United Arab Emirates"] and market.summary(b)["geo_grid"] is False
    assert market.label(b).startswith("International · United States, United Kingdom")
    # No countries picked yet: it falls back to the business's own country rather than searching nowhere.
    assert market.target_countries(biz(target_scope="international")) == ["IN"]


def test_the_scope_is_saved_on_the_project_and_shown_to_the_pages(client):
    bid = client.post("/api/v1/businesses", json={"name": "Export Co", "primary_category": "Valves", "city": "Pune", "country": "IN",
                                                  "target_scope": "international", "target_countries": ["US", "DE"]}).json()["id"]
    assert client.get(f"/api/v1/businesses/{bid}").json()["target_scope"] == "international"
    ctx = client.get(f"/api/v1/businesses/{bid}/keywords/context").json()
    assert ctx["areas"] == ["United States", "Germany"] and ctx["nearby"] == [] and ctx["market"]["scope"] == "international"
    assert client.patch(f"/api/v1/businesses/{bid}", json={"target_scope": "national", "target_countries": []}).status_code == 200
    ctx = client.get(f"/api/v1/businesses/{bid}/keywords/context").json()
    assert ctx["areas"] == ["India"] and ctx["market"]["label"] == "National · India"
    assert client.patch(f"/api/v1/businesses/{bid}", json={"target_scope": "worldwide"}).status_code == 422
    row = next(p for p in client.get("/api/v1/businesses/portfolio").json()["projects"] if p["id"] == bid)
    assert row["market"]["scope"] == "national"
