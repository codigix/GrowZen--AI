"""One status line per tracked keyword: position, clicks, where it is used, the verdict and the next step."""
from datetime import date

import pytest

from app.db import SessionLocal
from app.models import Article, Keyword, KeywordRankLog


@pytest.fixture()
def biz(client):
    bid = client.post("/api/v1/businesses", json={"name": "Status Co", "website": "https://statusco.example/", "city": "Pune"}).json()["id"]
    db = SessionLocal()
    for name, vol in (("dental implants pune", 1000), ("teeth whitening", 500), ("root canal cost", 300), ("braces pune", 200), ("kids dentist", 100)):
        db.add(Keyword(business_id=bid, keyword=name, volume=vol, tracked=True, target_url="/services" if name == "dental implants pune" else None))
    today = date.today()

    def log(kw, rank, pos, imps, clicks):
        db.add(KeywordRankLog(business_id=bid, keyword=kw, day=today, rank=rank, position=pos, impressions=imps, clicks=clicks, url="https://statusco.example/services" if rank else None))
    log("dental implants pune", 4, 4.2, 300, 12)       # page 1 with clicks: working
    log("teeth whitening", 14, 14.0, 60, 0)             # page 2: climbing
    log("root canal cost", 35, 35.0, 10, 0)             # weak
    log("braces pune", None, None, 0, 0)                # checked, no impressions: invisible
    db.add(Article(business_id=bid, keyword="braces pune", status="completed", title="Braces", body="<p>braces pune</p>"))
    db.commit()
    yield bid
    db.close()


def test_every_keyword_gets_a_verdict_a_reason_and_a_next_step(client, biz):
    d = client.get(f"/api/v1/businesses/{biz}/keywords/status").json()
    by = {x["keyword"]: x for x in d["items"]}
    assert d["total"] == 5 and d["counts"] == {"working": 1, "climbing": 1, "weak": 1, "invisible": 1, "unchecked": 1}
    assert by["dental implants pune"]["status"] == "working" and by["dental implants pune"]["clicks"] == 12 and "12 clicks" in by["dental implants pune"]["why"]
    assert by["teeth whitening"]["status"] == "climbing" and by["teeth whitening"]["label"] == "Almost page 1"
    assert by["root canal cost"]["status"] == "weak" and by["braces pune"]["status"] == "invisible" and by["kids dentist"]["status"] == "unchecked"
    assert by["kids dentist"]["next"]["to"] == "/rank-tracking/positions"
    assert by["braces pune"]["articles"] == 1 and by["teeth whitening"]["articles"] == 0
    assert by["dental implants pune"]["potential"] == 300 - 12 or by["dental implants pune"]["potential"] == round(1000 * 0.30) - 12  # modelled: top-spot click-through x searches, less clicks
    assert [x["status"] for x in d["items"]][0] == "working"  # best first
    assert d["clicks"] == 12 and d["impressions"] == 370


def test_nothing_is_shown_for_a_project_with_no_keywords(client):
    bid = client.post("/api/v1/businesses", json={"name": "Empty Co", "website": "https://emptyco.example/"}).json()["id"]
    d = client.get(f"/api/v1/businesses/{bid}/keywords/status").json()
    assert d["total"] == 0 and d["state"] == "no_keywords"
