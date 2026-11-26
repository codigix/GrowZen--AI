"""Top pages detail, top traffic keywords and the traffic trend from analysis runs."""
from datetime import datetime, timedelta, timezone

from app.services import competitor_keyword_report as ck

KW = "/api/v1/businesses/{bid}/keyword-workspace/competitor-analysis"


def _project(client):
    r = client.post("/api/v1/businesses", json={"name": "Asha Rentals", "primary_category": "Clothing rental service", "city": "Pune", "country": "IN"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _seed(bid):
    from app.db import SessionLocal
    from app.models import CompetitorAnalysisRun, CompetitorKeyword
    db = SessionLocal()
    try:
        rows = [("saree rental pune", 3, 900, 120.0, "https://rival.example/saree"), ("lehenga on rent", 8, 500, 40.0, "https://rival.example/saree"),
                ("bridal wear hire", 14, 200, 6.0, "https://rival.example/saree"), ("rival shoes", 1, 50, 30.0, "https://rival.example/shoes"), ("no page kw", 5, 10, 1.0, None)]
        for kw, pos, vol, tr, url in rows:
            db.add(CompetitorKeyword(business_id=bid, domain="rival.example", keyword=kw, position=pos, volume=vol, traffic=tr, url=url))
        now = datetime.now(timezone.utc)
        for i, (tr, kws) in enumerate(((100, 20), (150, 30), (None, None))):
            db.add(CompetitorAnalysisRun(business_id=bid, domain="rival.example", status="analyzed", trigger="manual", started_at=now - timedelta(days=10 - i), finished_at=now - timedelta(days=10 - i),
                                         snapshot={"traffic": tr, "keywords": kws, "top10": 5}))
        db.commit()
    finally:
        db.close()


def test_pages_carry_keywords_with_our_position_and_say_what_is_not_read(client, monkeypatch):
    bid = _project(client)
    _seed(bid)
    monkeypatch.setattr(ck, "_own_positions", lambda db, b, kws: {"saree rental pune": 12})
    pages = client.post(f"{KW.format(bid=bid)}/pages", json={"domains": ["www.rival.example"]}).json()["pages"]
    assert [p["url"] for p in pages] == ["https://rival.example/saree", "https://rival.example/shoes"]  # sorted by traffic, a keyword without a page is not a page
    top = pages[0]
    assert top["keywords"] == 3 and top["traffic"] == 166 and top["best"] == 3 and top["top_keyword"] == "saree rental pune" and top["top_position"] == 3
    assert top["title"] is None and top["backlinks"] is None  # not read by any provider: never invented
    assert [k["keyword"] for k in top["list"]][0] == "saree rental pune" and top["list"][0]["yours"] == 12 and top["list"][1]["yours"] is None


def test_top_traffic_keywords_and_a_trend_made_only_of_real_runs(client):
    bid = _project(client)
    _seed(bid)
    base = KW.format(bid=bid)
    tk = client.post(f"{base}/top-keywords", json={"domains": ["rival.example"]}).json()["keywords"]["rival.example"]
    assert [k["keyword"] for k in tk][:2] == ["saree rental pune", "lehenga on rent"] and tk[0]["traffic"] == 120.0
    tr = client.post(f"{base}/trend", json={"domains": ["rival.example"]}).json()["trend"]["rival.example"]
    assert [p["traffic"] for p in tr] == [100, 150]  # the run that read nothing is not a point
    assert client.post(f"{base}/trend", json={"domains": ["other.example"]}).json()["trend"] == {}


def test_a_page_that_no_longer_exists_is_marked_and_its_traffic_not_counted(client, monkeypatch):
    import httpx
    from app.db import SessionLocal
    from app.models import Competitor, CompetitorKeyword
    from app.services import competitor_analysis as ca
    bid = client.post("/api/v1/businesses", json={"name": "Gone Co", "website": "https://gone.example", "city": "Pune"}).json()["id"]
    db = SessionLocal()
    db.add(Competitor(business_id=bid, website="https://rival-g.com", name="Rival", source="manual", selected=True, domain="rival-g.com"))
    db.add_all([CompetitorKeyword(business_id=bid, domain="rival-g.com", keyword="live thing", position=2, volume=500, traffic=100.0, url="https://rival-g.com/live"),
                CompetitorKeyword(business_id=bid, domain="rival-g.com", keyword="dead thing", position=1, volume=9000, traffic=900.0, url="https://rival-g.com/dead")])
    db.commit()
    db.close()

    class FakeClient:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def stream(self, method, url):
            code = 404 if url.endswith("/dead") else 200
            class R:
                status_code = code
                def __enter__(s): return s
                def __exit__(s, *a): return False
            return R()
    monkeypatch.setattr(httpx, "Client", FakeClient)
    url = f"/api/v1/businesses/{bid}/keyword-workspace/competitor-analysis/pages/check"
    out = client.post(url, json={"domains": ["rival-g.com"]}).json()
    assert out["checked"] == 2 and out["gone"] == 1
    by = {p["url"]: p for p in out["pages"]}
    assert by["https://rival-g.com/dead"]["live"] is False and by["https://rival-g.com/dead"]["traffic"] == 0 and by["https://rival-g.com/dead"]["traffic_was"] == 900
    assert by["https://rival-g.com/live"]["live"] is True and by["https://rival-g.com/live"]["read_at"]
    assert out["metrics"]["rival-g.com"]["traffic"] == 100  # the gone page's 900 is not counted
    assert client.post(url, json={"domains": ["rival-g.com"]}).json()["checked"] == 0  # checked today: not asked again
