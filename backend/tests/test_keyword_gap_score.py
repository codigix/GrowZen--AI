"""Keyword gap: Missing / Weak / Shared / Strong / Only you, and the documented opportunity score."""
from app.db import SessionLocal
from app.models import Business, CompetitorKeyword, Keyword
from app.services import competitor_keyword_report as ck
from app.competitors import hygiene


def test_opportunity_formula_parts():
    row = {"volume": 10000, "difficulty": 20, "intent": "transactional", "status": "missing", "fit": "yes", "difference": None}
    score, parts = ck.opportunity(row)
    assert parts == {"searches": 30, "ease": 20, "intent": 15, "distance": 20, "fit": 10} and score == 95
    # nothing known: neutral middle values, never invented numbers
    score, parts = ck.opportunity({"status": "weak", "fit": "no", "difference": 4})
    assert parts == {"searches": 0, "ease": 12, "intent": 7, "distance": 8, "fit": 0} and score == 27
    assert ck.opportunity({"volume": 100, "difficulty": 100, "intent": "navigational", "status": "strong", "fit": "have"})[1]["distance"] == 0
    assert ck.opportunity({"status": "weak", "difference": 40, "fit": "no"})[1]["distance"] == 20  # capped


def test_status_missing_weak_shared_strong(monkeypatch):
    db = SessionLocal()
    b = Business(name="Mine", city="Pune", website="https://mine.example")
    db.add(b)
    db.commit()
    monkeypatch.setattr(hygiene, "saved_competitor_domains", lambda db_, b_, limit=12: ["rival.example"])
    monkeypatch.setattr(ck, "_own_positions", lambda db_, b_, kws: {"weak kw": 20, "shared kw": 7, "strong kw": 2})
    try:
        for kw, pos in (("missing kw", 3), ("weak kw", 5), ("shared kw", 5), ("strong kw", 9)):
            db.add(CompetitorKeyword(business_id=b.id, domain="rival.example", keyword=kw, position=pos, volume=500))
        db.add(Keyword(business_id=b.id, keyword="only mine", rank=4, tracked=True))
        db.commit()
        out = ck.gap(db, b)
        st = {r["keyword"]: r["status"] for r in out["rows"]}
        assert st == {"missing kw": "missing", "weak kw": "weak", "shared kw": "shared", "strong kw": "strong", "only mine": "only_you"}
        assert out["counts"]["missing"] == 1 and out["counts"]["shared"] == 1
        assert out["rows"][0]["status"] == "missing" and out["rows"][0]["score"] is not None
        assert next(r for r in out["rows"] if r["keyword"] == "only mine")["score"] is None
    finally:
        db.delete(b)
        db.commit()
        db.close()


def test_the_gap_uses_only_chosen_competitors(client):
    from app.db import SessionLocal
    from app.models import Competitor, CompetitorKeyword
    bid = client.post("/api/v1/businesses", json={"name": "Choice Co", "website": "https://choice.example", "city": "Pune"}).json()["id"]
    db = SessionLocal()
    db.add_all([Competitor(business_id=bid, website="https://chosen-one.com", name="Chosen", source="manual", selected=True, domain="chosen-one.com"),
                Competitor(business_id=bid, website="https://left-out.com", name="Left out", source="research", selected=False, domain="left-out.com"),
                CompetitorKeyword(business_id=bid, domain="chosen-one.com", keyword="alpha keyword", position=4, volume=900),
                CompetitorKeyword(business_id=bid, domain="left-out.com", keyword="beta keyword", position=2, volume=800)])
    db.commit()
    db.close()
    out = client.get(f"/api/v1/businesses/{bid}/keyword-workspace/competitor-gap").json()
    words = {r["keyword"] for r in out["rows"]}
    assert "alpha keyword" in words and "beta keyword" not in words
