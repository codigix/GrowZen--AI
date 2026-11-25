"""A keyword added again from another place is not duplicated: it keeps every place it came from, and the answer says it already existed."""
from app.services import keyword_metrics


def _project(client):
    r = client.post("/api/v1/businesses", json={"name": "Asha Rentals", "primary_category": "Clothing rental service", "city": "Pune", "country": "IN"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_same_keyword_from_two_places_is_one_keyword_with_two_sources(client, monkeypatch):
    monkeypatch.setattr(keyword_metrics, "fill", lambda rows, cc=None: None)
    bid = _project(client)
    url = f"/api/v1/businesses/{bid}/keywords"
    first = client.post(url, json=[{"keyword": "Saree Rental Pune", "source": {"kind": "competitors", "label": "Competitor keywords: rival.example"}}])
    assert first.status_code == 201 and first.json()["added"] == 1 and first.json()["existing"] == []
    again = client.post(url, json=[{"keyword": "saree  rental pune", "source": {"kind": "google_ideas", "label": "Keyword gap", "competitor": "rival.example"}}])
    assert again.json()["added"] == 0 and again.json()["existing"] == ["saree rental pune"] and again.json()["updated"] == 1
    rows = [k for k in client.get(url).json()["keywords"] if k["keyword"] == "saree rental pune"]
    assert len(rows) == 1  # no duplicate record
    src = rows[0]["source"]
    assert {s["label"] for s in src["sources"]} == {"Competitor keywords: rival.example", "Keyword gap"}
    assert set(src["groups"]) == {"competitor_keywords", "competitor_gap"} and src["competitors"] == ["rival.example"]
    same = client.post(url, json=[{"keyword": "saree rental pune", "source": {"kind": "google_ideas", "label": "Keyword gap"}}])
    assert same.json()["updated"] == 0  # the same place again changes nothing


def test_group_of_names_the_four_places():
    from app.services.keyword_workspace import group_of
    assert group_of("google_ideas", "Keyword gap") == "competitor_gap"
    assert group_of("competitors", "Rival") == "competitor_keywords"
    assert group_of("google_ideas", "Saved by hand") == "manual"
    assert group_of("planner", "Google Keyword Planner") == "keyword_research"
