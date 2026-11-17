"""What a project must have, by the services it uses."""
from app.services import project_rules as pr


def test_seo_only_needs_a_website_and_services_but_no_google_profile_details():
    ok = {"name": "A", "website": "https://a.example", "services": [{"name": "x"}], "target_scope": "national"}
    assert pr.problems(ok, ["seo"]) == []
    assert any("website" in p for p in pr.problems({**ok, "website": ""}, ["seo", "geo"]))
    assert any("service or product" in p for p in pr.problems({**ok, "services": []}, ["seo"]))


def test_a_google_profile_needs_phone_city_and_category():
    d = {"name": "A", "website": "https://a.example", "services": [{"name": "x"}]}
    got = " ".join(pr.problems(d, ["seo", "gmb"]))
    assert "phone" in got and "city" in got and "category" in got
    assert pr.problems({**d, "phone": "+919876543210", "city": "Pune", "primary_category": "Dentist"}, ["seo", "gmb"]) == []


def test_reach_and_empty_services():
    base = {"name": "A", "website": "https://a.example", "services": [{"name": "x"}]}
    assert any("city or at least one target area" in p for p in pr.problems(base, ["seo"]))  # local is the default reach
    assert any("target country" in p for p in pr.problems({**base, "target_scope": "international"}, ["seo"]))
    assert pr.problems(base, [])[0].startswith("Choose at least one service")


def test_create_and_change_services_are_checked(client):
    r = client.post("/api/v1/businesses", json={"name": "Rules Co", "website": "rules.example", "modules": ["seo", "gmb"], "services": [{"name": "x"}]})
    assert r.status_code == 422 and "phone" in r.json()["detail"]
    r = client.post("/api/v1/businesses", json={"name": "Rules Co", "website": "not a site", "modules": ["seo"]})
    assert r.status_code == 422  # not a website address
    ok = client.post("/api/v1/businesses", json={"name": "Rules Co", "website": "rules.example", "city": "Pune", "services": [{"name": "x"}], "modules": ["seo"]})
    assert ok.status_code == 201 and ok.json()["website"] == "https://rules.example"
    bid = ok.json()["id"]
    bad = client.patch(f"/api/v1/businesses/{bid}", json={"modules": ["seo", "gmb"]})
    assert bad.status_code == 422 and "phone" in bad.json()["detail"]
    assert client.get(f"/api/v1/businesses/{bid}").json()["services_on"] == ["seo"]
