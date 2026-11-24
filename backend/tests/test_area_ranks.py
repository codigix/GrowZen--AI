from types import SimpleNamespace

from app.competitors import service


def _biz(client):
    return client.post("/api/v1/businesses", json={"name": "Area Co", "website": "https://area.example/", "city": "Pune", "area": "Wakad", "target_areas": ["Aundh, Pune"], "phone": "+91 98765 43210"}).json()["id"]


def test_areas_are_measured_keyword_by_keyword_and_each_measurement_is_kept(client, monkeypatch):
    from app.services import suggest
    monkeypatch.setattr(suggest, "areas", lambda q, country="IN", near="": [{"label": q, "area": q, "city": None, "state": None, "lat": 18.6 + len(q) / 100, "lng": 73.8, "near": True}])
    bid = _biz(client)
    base = f"/api/v1/businesses/{bid}/area-ranks"
    o = client.get(base).json()
    assert [a["name"] for a in o["areas"]] == ["Aundh, Pune", "Wakad", "Pune"] and o["cells"] == []  # seeded from the project's own areas, each with a pin
    area = o["areas"][1]["id"]
    monkeypatch.setattr(service, "competitors_enabled", lambda: True)
    ranks = {"digital marketing wakad": 2, "seo pune": None}

    def places(q, region, lat, lng, radius):
        r = ranks[q]
        items = [{"position": 1, "title": "Rival A", "website": "https://a.example", "phoneNumber": ""}, {"position": 2, "title": "Rival B", "website": "https://b.example"}]
        if r:
            items.insert(r - 1, {"position": r, "title": "Area Co", "website": "https://area.example/"})
        return [{**x, "position": i + 1} for i, x in enumerate(items)]
    monkeypatch.setattr(service, "places_search", places)
    r = client.post(f"{base}/scan", json={"area_id": area, "keywords": ["digital marketing wakad", "seo pune"]}).json()
    assert r["measured"] == [{"keyword": "digital marketing wakad", "rank": 2}, {"keyword": "seo pune", "rank": None}]
    ranks["digital marketing wakad"] = 1
    client.post(f"{base}/scan", json={"area_id": area, "keywords": ["digital marketing wakad"]})
    cells = {(c["area_id"], c["keyword"]): c for c in client.get(base).json()["cells"]}
    c = cells[(area, "digital marketing wakad")]
    assert c["now"]["rank"] == 1 and c["before"]["rank"] == 2 and c["now"]["top"] == ["Rival A", "Rival B"]  # the change since the measurement before
    assert cells[(area, "seo pune")]["now"]["rank"] is None


def test_an_area_can_be_added_once_removed_with_its_records_and_the_scan_needs_places(client, monkeypatch):
    from app.services import suggest
    monkeypatch.setattr(suggest, "areas", lambda *a, **k: [])
    bid = _biz(client)
    base = f"/api/v1/businesses/{bid}/area-ranks"
    a = client.post(f"{base}/areas", json={"name": "Hinjewadi", "lat": 18.59, "lng": 73.73}).json()
    assert client.post(f"{base}/areas", json={"name": "hinjewadi", "lat": 18.59, "lng": 73.73}).status_code == 409
    monkeypatch.setattr(service, "competitors_enabled", lambda: False)
    assert client.post(f"{base}/scan", json={"area_id": a["id"], "keywords": ["x y"]}).status_code == 503
    monkeypatch.setattr(service, "competitors_enabled", lambda: True)
    monkeypatch.setattr(service, "places_search", lambda *args, **k: [{"position": 1, "title": "Area Co", "website": "https://area.example/"}])
    assert client.post(f"{base}/scan", json={"area_id": a["id"], "keywords": ["x y"]}).json()["measured"][0]["rank"] == 1
    assert client.delete(f"{base}/areas/{a['id']}").status_code == 204
    o = client.get(base).json()
    assert all(x["id"] != a["id"] for x in o["areas"]) and o["cells"] == []
