"""Competitor discovery inputs: services, country, language and radius; merged by place; one competitor per domain; the source is kept."""
from app.competitors import service


def _project(client):
    r = client.post("/api/v1/businesses", json={"name": "Asha Rentals", "primary_category": "Clothing rental service", "city": "Pune", "country": "IN"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _p(name, site, pid, addr="MG Road"):
    return {"name": name, "rating": 4.5, "reviews": 50, "address": addr, "phone": "", "website": site, "maps_link": f"https://maps.example/{pid}", "place_id": pid, "category": "Rental"}


def test_services_are_searched_too_and_merged_by_place(client, monkeypatch):
    bid = _project(client)
    seen = []
    def fake(q, place, own, top_n, region="IN", language="en"):
        seen.append((q, place, region, language))
        return {"clothing rental": [_p("A Rentals", "https://www.a.example/", "p1"), _p("B Rentals", "https://b.example", "p2")],
                "saree rental": [_p("A Rentals", "https://a.example", "p1"), _p("C Sarees", "https://c.example", "p3")]}[q]
    monkeypatch.setattr(service, "find_competitors", fake)
    r = client.post("/api/v1/competitors", json={"business_type": "clothing rental", "location": "Pune", "business_id": bid, "services": ["saree rental", "saree rental"], "country": "ae", "language": "HI", "top_n": 10})
    assert r.status_code == 200, r.text
    out = r.json()
    assert [q[0] for q in seen] == ["clothing rental", "saree rental"] and seen[0][2:] == ("AE", "hi")
    assert out["requests"] == 2 and out["count"] == 3  # A Rentals once
    assert {c["name"] for c in out["competitors"]} == {"A Rentals", "B Rentals", "C Sarees"}
    assert next(c for c in out["competitors"] if c["name"] == "C Sarees")["found_by"] == "saree rental"
    saved = client.get("/api/v1/competitors", params={"business_id": bid}).json()
    assert sorted(c["domain"] for c in saved) == ["a.example", "b.example", "c.example"]
    assert all(c["discovery"] == ["google_places"] for c in saved)
    # again, with www / trailing slash spelled differently: still one row per domain
    client.post("/api/v1/competitors", json={"business_type": "clothing rental", "location": "Pune", "business_id": bid, "services": ["saree rental"]})
    assert len(client.get("/api/v1/competitors", params={"business_id": bid}).json()) == 3


def test_radius_uses_a_map_point_and_keeps_only_places_inside(client, monkeypatch):
    bid = _project(client)
    from app.competitors import intel_router
    monkeypatch.setattr(intel_router, "_centre", lambda b, loc: (18.52, 73.85))
    got = {}
    def fake_search(q, region="IN", lat=None, lng=None, radius_m=5000.0, page_size=20, language="en", restrict=False):
        got.update(q=q, lat=lat, lng=lng, radius_m=radius_m, restrict=restrict, language=language)
        return [{"position": 1, "title": "Near Rentals", "rating": 4.4, "ratingCount": 10, "distance_m": 900, "category": "Rental", "address": "FC Road", "website": "https://near.example", "phoneNumber": "", "cid": "p9", "maps_link": "x"}]
    monkeypatch.setattr(service, "places_search", fake_search)
    r = client.post("/api/v1/competitors", json={"business_type": "clothing rental", "location": "Baner, Pune", "business_id": bid, "radius_km": 3})
    assert r.status_code == 200, r.text
    assert got["radius_m"] == 3000 and got["restrict"] is True and got["lat"] == 18.52
    assert r.json()["competitors"][0]["distance_m"] == 900 and r.json()["requests"] == 1


def test_a_competitor_added_in_backlink_intelligence_is_listed_and_stays_removed(client):
    from app.backlinks.models import BiTrackedTarget
    from app.db import SessionLocal
    bid = client.post("/api/v1/businesses", json={"name": "Adopt Co", "website": "https://adopt.example", "city": "Pune"}).json()["id"]
    db = SessionLocal()
    db.add(BiTrackedTarget(business_id=bid, domain="rival-site.com", is_competitor=True))
    db.add(BiTrackedTarget(business_id=bid, domain="not-a-rival.com", is_competitor=False))
    db.commit()
    db.close()
    rows = client.get(f"/api/v1/competitors?business_id={bid}").json()
    assert [r["website"] for r in rows] == ["https://rival-site.com"] and rows[0]["selected"] is True and rows[0]["source"] == "backlinks"
    assert len(client.get(f"/api/v1/competitors?business_id={bid}").json()) == 1  # not added twice
    assert client.delete(f"/api/v1/competitors/{rows[0]['id']}").status_code == 204
    assert client.get(f"/api/v1/competitors?business_id={bid}").json() == []  # removing it also stops it being a competitor there
