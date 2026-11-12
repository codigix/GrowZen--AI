"""GBP competitor analysis: search saves the local competitors, the profile is compared with them, manual add and remove."""
from app.competitors import service
from app.routers import gbp_competitors as g

FOUND = [
    {"name": "Big Rentals", "rating": 4.8, "reviews": 300, "address": "MG Road", "phone": "1", "website": "https://bigrentals.in", "maps_link": "https://maps.google.com/?cid=1"},
    {"name": "Small Shop", "rating": 4.2, "reviews": 20, "address": "FC Road", "phone": "", "website": "", "maps_link": "https://maps.google.com/?cid=2"},
    {"name": "Mid Boutique", "rating": 4.6, "reviews": 90, "address": "JM Road", "phone": "", "website": "https://mid.in", "maps_link": "https://maps.google.com/?cid=3"},
]


def _project(client):
    r = client.post("/api/v1/businesses", json={"name": "Asha Rentals", "primary_category": "Clothing rental service", "city": "Pune", "country": "IN"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_insights_name_the_gap_and_the_next_step():
    comps = [{"rating": 4.8, "reviews": 300, "website": "https://a.in"}, {"rating": 4.6, "reviews": 90, "website": "https://b.in"}, {"rating": 4.2, "reviews": 20, "website": None}]
    out = g.insights({"rating": 4.0, "reviews": 3, "website": None}, comps)
    titles = " | ".join(i["title"] for i in out)
    assert "3 reviews; the typical competitor has 90" in titles and "below the competitors" in titles and "2 of 3 competitors have a website" in titles
    assert out[0]["level"] == "critical" and "review link" in out[0]["fix"]
    assert g.insights({"rating": 5.0, "reviews": 500, "website": "x"}, comps)[0]["level"] == "good"
    assert g.insights({"rating": 5.0, "reviews": 5}, []) == []


def test_search_add_remove_and_privacy(client, monkeypatch):
    bid = _project(client)
    base = f"/api/v1/businesses/{bid}/gbp/competitors"
    seen = {}
    def fake(kind, area, own, top_n):
        seen.update(kind=kind, area=area, own=own)
        return FOUND
    monkeypatch.setattr(service, "find_competitors", fake)
    monkeypatch.setattr(service, "competitors_enabled", lambda: True)
    assert client.get(base).json()["competitors"] == []
    r = client.post(f"{base}/search", json={})
    assert r.status_code == 200, r.text
    assert seen == {"kind": "Clothing rental service", "area": "Pune", "own": "Asha Rentals"}
    d = r.json()
    assert [c["name"] for c in d["competitors"]] == ["Big Rentals", "Small Shop", "Mid Boutique"] and d["found_at"] and d["can_search"]
    assert d["your_rank"] == 4 and d["total"] == 4 and d["insights"]
    # A manual competitor survives a new search; it can be removed
    m = client.post(base, json={"name": "Corner Shop", "rating": 4.1, "reviews": 12, "website": "cornershop.in"})
    assert m.status_code == 201 and any(c["name"] == "Corner Shop" and c["website"] == "https://cornershop.in" for c in m.json()["competitors"])
    assert client.post(base, json={"name": "corner shop"}).status_code == 409
    again = client.post(f"{base}/search", json={"keyword": "lehenga rental"}).json()
    assert seen["kind"] == "lehenga rental" and "Corner Shop" in [c["name"] for c in again["competitors"]]
    cid = next(c["id"] for c in again["competitors"] if c["name"] == "Corner Shop")
    assert "Corner Shop" not in [c["name"] for c in client.delete(f"{base}/{cid}").json()["competitors"]]
    assert client.delete(f"{base}/nope").status_code == 404
    # Needs a category, and the search can be off
    nb = client.post("/api/v1/businesses", json={"name": "No Category Co", "city": "Pune"}).json()["id"]
    assert client.post(f"/api/v1/businesses/{nb}/gbp/competitors/search", json={}).status_code == 422
    def off(*a):
        raise service.CompetitorSearchError("Competitor search is off")
    monkeypatch.setattr(service, "find_competitors", off)
    monkeypatch.setattr(service, "competitors_enabled", lambda: False)
    assert client.post(f"{base}/search", json={}).status_code == 503


def test_competitors_are_private(client):
    from test_security import login, user
    user("gc1@x.in", "editor")
    user("gc2@x.in", "editor")
    a, _ = login("gc1@x.in")
    o, _ = login("gc2@x.in")
    bid = a.post("/api/v1/businesses", json={"name": "Mine Co"}).json()["id"]
    assert a.get(f"/api/v1/businesses/{bid}/gbp/competitors").status_code == 200
    assert o.get(f"/api/v1/businesses/{bid}/gbp/competitors").status_code == 404
    assert o.post(f"/api/v1/businesses/{bid}/gbp/competitors", json={"name": "X"}).status_code == 404
