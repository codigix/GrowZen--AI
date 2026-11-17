"""The six-stage SEO plan, keyword mapping and competitor pages."""
from app.db import SessionLocal
from app.models import Audit, Business, Keyword
from app.services import keyword_mapping


def _project(client, **extra):
    r = client.post("/api/v1/businesses", json={"name": "Asha Dental", "website": "https://asha.example", "city": "Pune", "primary_category": "Dentist", **extra})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _crawl(db, bid):
    pg = lambda path, title, h1: {"url": "https://asha.example" + path, "status": 200, "title": title, "h1": h1, "meta_description": ""}
    db.add(Audit(business_id=bid, kind="onpage", status="done", data_source="live", score=70, result={"pages": [pg("/", "Asha Dental | Pune", "Dentist in Pune"), pg("/implants", "Dental implants in Pune", "Dental implants"), pg("/about", "About us", "About")]}))
    db.commit()


def test_business_analysis_fields_save(client):
    bid = _project(client)
    r = client.patch(f"/api/v1/businesses/{bid}", json={"target_audience": "Families in Baner", "goals": ["calls", "bookings"]})
    assert r.status_code == 200 and r.json()["target_audience"] == "Families in Baner" and r.json()["goals"] == ["calls", "bookings"]


def test_mapping_assigns_pages_primary_and_finds_missing_pages_and_posts(client):
    bid = _project(client)
    db = SessionLocal()
    _crawl(db, bid)
    for k, v in (("dental implants pune", 900), ("implants", 300), ("teeth whitening", 700), ("how much do braces cost", 400)):
        db.add(Keyword(business_id=bid, keyword=k, volume=v, tracked=True, intent="informational" if k.startswith("how") else "commercial"))
    db.commit()
    p = keyword_mapping.plan(db, db.get(Business, bid))
    page = {x["path"]: x for x in p["pages"]}
    assert page["/implants"]["primary"] == "dental implants pune" and "implants" in page["/implants"]["secondary"]
    assert [m["keyword"] for m in p["missing_pages"]] == ["teeth whitening"] and [x["keyword"] for x in p["blog_opportunities"]] == ["how much do braces cost"]
    out = client.post(f"/api/v1/businesses/{bid}/keyword-mapping/apply").json()
    assert out["mapped"] == 2
    k = db.query(Keyword).filter_by(business_id=bid, keyword="dental implants pune").one()
    db.refresh(k)
    assert k.role == "primary" and k.target_url.endswith("/implants")
    f = client.get(f"/api/v1/businesses/{bid}/flow").json()
    assert {s["key"]: s for s in f["steps"]}["mapping"]["metric"] == "2/4 mapped"


def test_competitor_pages_need_the_research(client):
    bid = _project(client)
    assert client.get(f"/api/v1/businesses/{bid}/competitor-pages").json()["available"] is False
    db = SessionLocal()
    org = lambda d, u, pos: {"domain": d, "url": u, "position": pos, "title": "t", "mine": False, "type": "business"}
    db.add(Audit(kind="intel", target=f"business:{bid}", status="done", result={"serps": [{"keyword": "dentist pune", "you_organic": 6, "organic": [org("rival.in", "https://rival.in/dentist", 1), org("rival.in", "https://rival.in/", 3)]}], "gaps": {"keywords": [{"keyword": "dentist pune", "competitors": [{"domain": "rival.in"}]}]}}))
    db.add(Keyword(business_id=bid, keyword="dentist pune", volume=1000, tracked=True))
    db.commit()
    r = client.get(f"/api/v1/businesses/{bid}/competitor-pages").json()
    c = r["competitors"][0]
    assert c["domain"] == "rival.in" and c["est_visits"] == 390 and c["top_pages"][0]["url"] == "https://rival.in/dentist" and r["you"]["visits"] == 50 and r["gaps"][0]["volume"] == 1000


def test_a_saved_competitor_can_be_added_and_removed(client):
    bid = _project(client)
    c = client.post("/api/v1/competitors/manual", json={"business_id": bid, "url": "rival-one.example", "name": "Rival One"}).json()
    assert c["source"] == "manual" and [x["id"] for x in client.get(f"/api/v1/competitors?business_id={bid}").json()] == [c["id"]]
    assert client.delete(f"/api/v1/competitors/{c['id']}").status_code == 204
    assert client.get(f"/api/v1/competitors?business_id={bid}").json() == []
    assert client.delete(f"/api/v1/competitors/{c['id']}").status_code == 404


def test_found_competitors_must_be_chosen_before_the_other_steps_use_them(client):
    from app.competitors import hygiene
    from app.competitors.router import _upsert
    from app.db import SessionLocal
    from app.models import Business
    bid = _project(client)
    db = SessionLocal()
    found = _upsert(db, bid, [{"name": "Maps Rival", "website": "https://maps-rival.example"}])
    assert found[0].selected is False and hygiene.saved_competitor_domains(db, db.get(Business, bid)) == []  # found, not chosen: feeds nothing
    hand = client.post("/api/v1/competitors/manual", json={"business_id": bid, "url": "hand-rival.example"}).json()
    assert hand["selected"] is True
    r = client.patch(f"/api/v1/competitors/{found[0].id}", json={"selected": True})
    assert r.status_code == 200 and r.json()["selected"] is True
    db.expire_all()
    assert sorted(hygiene.saved_competitor_domains(db, db.get(Business, bid))) == ["hand-rival.example", "maps-rival.example"]
    client.patch(f"/api/v1/competitors/{found[0].id}", json={"selected": False})
    db.expire_all()
    assert hygiene.saved_competitor_domains(db, db.get(Business, bid)) == ["hand-rival.example"]
    db.close()


def test_competitor_watch_lists_only_the_chosen_with_their_numbers(client):
    from app.competitors.router import _upsert
    from app.db import SessionLocal
    bid = _project(client)
    db = SessionLocal()
    _upsert(db, bid, [{"name": "Left Out", "website": "https://left-out.example"}])
    db.close()
    client.post("/api/v1/competitors/manual", json={"business_id": bid, "url": "chosen-rival.example", "name": "Chosen Rival"})
    w = client.get(f"/api/v1/businesses/{bid}/competitor-watch").json()
    assert [c["domain"] for c in w["competitors"]] == ["chosen-rival.example"] and w["competitors"][0]["name"] == "Chosen Rival"
    assert w["competitors"][0]["changes_30d"] == {"new_page": 0, "changed": 0, "removed": 0} and [c["name"] for c in w["not_chosen"]] == ["Left Out"]
