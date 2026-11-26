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


def test_the_same_keyword_twice_in_one_request_is_saved_once(client, monkeypatch):
    """Two competitors rank for the same keyword, so a bulk save sends it twice. It must be one record that keeps both sources, not a server error."""
    monkeypatch.setattr(keyword_metrics, "fill", lambda rows, cc=None: None)
    bid = _project(client)
    url = f"/api/v1/businesses/{bid}/keywords"
    r = client.post(url, json=[{"keyword": "saree rental pune", "source": {"kind": "competitors", "label": "Competitor keywords: a.example", "competitor": "a.example"}},
                               {"keyword": "Saree  rental pune", "source": {"kind": "competitors", "label": "Competitor keywords: b.example", "competitor": "b.example"}},
                               {"keyword": "lehenga on rent", "source": {"kind": "competitors", "label": "Competitor keywords: a.example"}}])
    assert r.status_code == 201, r.text
    assert r.json()["added"] == 2 and r.json()["existing"] == []  # a repeat inside the request was not saved before it
    rows = client.get(url).json()["keywords"]
    assert sorted(k["keyword"] for k in rows) == ["lehenga on rent", "saree rental pune"]
    src = next(k for k in rows if k["keyword"] == "saree rental pune")["source"]
    assert {s["label"] for s in src["sources"]} == {"Competitor keywords: a.example", "Competitor keywords: b.example"}


def test_keywords_not_checked_yet_are_checked_against_the_project_and_unrelated_ones_set_aside(client, monkeypatch):
    from app.db import SessionLocal
    from app.models import KeywordCandidate
    from app.services import ai
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete_json", lambda system, user, **k: {"results": [{"i": 0, "fit": "yes", "why": "a listed service", "for": "clinics"}, {"i": 1, "fit": "no", "why": "another company's brand", "for": ""}]})
    bid = client.post("/api/v1/businesses", json={"name": "Fit Co", "website": "https://fit.example", "city": "Pune"}).json()["id"]
    db = SessionLocal()
    db.add_all([KeywordCandidate(business_id=bid, norm="seo for clinics", keyword="seo for clinics", sources=[{"kind": "planner", "label": "x"}]),
                KeywordCandidate(business_id=bid, norm="semrush seo tool", keyword="semrush seo tool", sources=[{"kind": "competitors", "label": "x"}])])
    db.commit()
    db.close()
    base = f"/api/v1/businesses/{bid}/keyword-workspace"
    before = client.get(base).json()
    assert before["unchecked"] == 2 and before["fit_check"] is True
    out = client.post(base + "/relevance").json()
    assert out["checked"] == 2 and out["hidden"] == 1 and out["remaining"] == 0
    after = client.get(base).json()
    assert [i["keyword"] for i in after["items"]] == ["seo for clinics"] and after["unchecked"] == 0


def test_nearby_areas_lists_the_areas_google_maps_names_without_districts_or_the_city(monkeypatch):
    from app.services import keywords
    from types import SimpleNamespace
    b = SimpleNamespace(lat=18.6, lng=73.8, area="Pimpri-Chinchwad, Pune", city="Pune")
    monkeypatch.setattr(keywords, "_google_ring", lambda bb: ["Wakad", "Mulshi Subdistrict", "Pune", "Nigdi", "wakad"])
    monkeypatch.setattr(keywords, "_cached", lambda key, ttl, fetch: ["Hinjewadi", "Nigdi"])
    assert keywords.nearby_areas(b) == ["Wakad", "Nigdi", "Hinjewadi"]
