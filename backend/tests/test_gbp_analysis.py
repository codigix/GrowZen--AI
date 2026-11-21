from types import SimpleNamespace

from app.competitors import gbp_analysis as ga
from app.competitors import listing_audit as la


def listing(name, category="Clothing rental service", photos=10, reviews=120, rating=4.7, website=None, when="2 weeks ago", feats=("a", "b", "c"), phone="+91 1"):
    return {"basics": {"name": name, "category": category, "summary": "We rent.", "phone": phone, "website": website, "status": "open", "address": "Wagholi, Pune"}, "hours": ["Mon 10-8"],
            "reputation": {"rating": rating, "count": reviews, "photos": photos, "reviews": [{"when": when}]}, "features": list(feats), "maps_url": "https://maps.example/" + name}


def test_the_comparison_list_has_the_page_s_competitors_and_the_chosen_ones_once(client):
    from app.db import SessionLocal
    from app.models import Business, Competitor
    bid = client.post("/api/v1/businesses", json={"name": "Cmp Co", "website": "https://cmp.example/"}).json()["id"]
    db = SessionLocal()
    try:
        db.add_all([Competitor(business_id=bid, name="Style Story", website=None, place_id="pS", selected=True), Competitor(business_id=bid, name="Left Out", website=None, place_id="pL", selected=False),
                    Competitor(business_id=bid, name="Glam Rental", website="https://glam.in", place_id="pG", selected=True)])
        db.commit()
        items = ga.competitors_for(db, db.get(Business, bid), [{"name": "glam rental", "place_id": "pG", "source": "maps"}, {"name": "Only Here", "place_id": "pO"}])
    finally:
        db.query(Competitor).filter_by(business_id=bid).delete()
        db.commit()
        db.close()
    assert [i["name"] for i in items] == ["glam rental", "Only Here", "Style Story"]  # Glam once (by place), Left Out left out, a no-website one included


def test_the_profile_is_compared_with_competitor_listings_with_or_without_a_website(client, monkeypatch):
    from app.db import SessionLocal
    from app.models import Business, Competitor
    bid = client.post("/api/v1/businesses", json={"name": "Mine Co", "website": "https://mine.example/", "services": [{"name": "Lehenga rental"}]}).json()["id"]
    pages = {"pMine": listing("Mine", category="Clothes market", photos=4, reviews=1, rating=5.0, website="https://mine.example/", when="1 year ago", feats=()),
             "p1": listing("Style Story"), "p2": listing("Rentozone"), "p3": listing("Glam Rental", website="https://glam.in")}
    monkeypatch.setattr("app.services.maps_public.read", lambda pid, fresh=False: pages[pid])
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        b.place_id = "pMine"
        db.add(Competitor(business_id=bid, name="Style Story", website=None, place_id="p1", selected=True, listing={"understanding": {"services": ["Gown rental", "Lehenga rental"], "keywords": []}}))
        db.commit()
        comps = [{"name": "Style Story", "place_id": "p1"}, {"name": "Rentozone", "place_id": "p2"}, {"name": "Glam Rental", "place_id": "p3", "website": "https://glam.in"}]
        out = ga.analyse(db, b, comps, "IN")
    finally:
        db.query(Competitor).filter_by(business_id=bid).delete()
        db.commit()
        db.close()
    assert out["read"] == 3 and out["you"]["score"] < out["competitors"][0]["score"] and out["categories"][0] == {"category": "Clothing rental service", "count": 3}
    titles = " | ".join(i["title"] for i in out["insights"])
    assert "scores" in titles and "use \"Clothing rental service\" as the main category; yours is \"Clothes market\"" in titles
    assert "4 photos on your listing; the typical competitor shows 10" in titles and "2 of 3 competitors have no website" in titles and "Competitors get reviews more often" in titles
    assert out["services_gap"] == ["Gown rental"] and "Gown rental" in titles
    by = {c["key"]: c for c in out["checks"]}
    assert by["photos"]["behind"] is True and by["photos"]["competitors_good"] == 3 and by["website"]["behind"] is False  # you have a website: not behind there
    assert out["insights"][0]["level"] == "critical"  # sorted: the biggest gap first


def test_an_unreadable_competitor_is_reported_not_fatal(monkeypatch):
    def boom(pid, fresh=False):
        raise RuntimeError("x")
    monkeypatch.setattr("app.services.maps_public.read", boom)
    monkeypatch.setattr(la, "_resolve", lambda item, region, lat, lng: item.get("cid"))
    b = SimpleNamespace(name="B", place_id=None, lat=None, lng=None, services=[], business_brief=None, primary_category=None, id=0)
    assert ga._read({"name": "Gone", "place_id": "px"}, b, "IN")["error"] == "Its Google listing could not be read."


def test_the_endpoint_needs_competitors_first(client):
    bid = client.post("/api/v1/businesses", json={"name": "Empty Co", "website": "https://empty.example/"}).json()["id"]
    assert client.post(f"/api/v1/businesses/{bid}/gbp/competitors/analysis").status_code == 409
