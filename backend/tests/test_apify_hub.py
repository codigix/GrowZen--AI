"""Apify figures on the Referring domains page: the refresh stores DA/PA/spam per site (Apify stubbed), and the checker's lookups feed the same store."""
from sqlalchemy import select

from app.backlinks import hub
from app.backlinks.models import BiDomainMetric
from app.db import SessionLocal
from app.services import apify_metrics as am

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _no_saved_apify_figures():
    """Saved Apify figures last 24 h by design: each test starts with none."""
    from app.backlinks.models import BiDomainMetric
    from app.db import SessionLocal
    def wipe():
        db = SessionLocal()
        try:
            db.query(BiDomainMetric).filter(BiDomainMetric.source == "apify").delete()
            db.commit()
        finally:
            db.close()
    wipe()
    yield
    wipe()


def test_refresh_stores_apify_figures_per_site_and_skips_fresh_ones(monkeypatch):
    calls = []
    monkeypatch.setattr(am, "configured", lambda: True)
    monkeypatch.setattr(am, "lookup", lambda doms: calls.append(list(doms)) or [{"domain": d, "domain_authority": 11, "home_page_authority": 30, "spam_score": 3} for d in doms if d != "nodata.example"])
    db = SessionLocal()
    try:
        out = hub.refresh_metrics(db, ["hub-a.example", "hub-b.example", "nodata.example"])
        assert out["configured"] is True and out["refreshed"] == 2 and "Apify" in out["message"] and "Could not read 1" in out["message"]
        m = db.scalar(select(BiDomainMetric).where(BiDomainMetric.domain == "hub-a.example"))
        assert (m.da, m.pa, m.spam_score, m.source) == (11, 30, 3, "apify")
        assert hub.metrics_for(db, ["hub-b.example"])["hub-b.example"]["pa"] == 30
        calls.clear()
        again = hub.refresh_metrics(db, ["hub-a.example", "hub-b.example"])  # still fresh: nothing is asked (nothing is billed)
        assert calls == [] and again["refreshed"] == 0
        for d in ("hub-a.example", "hub-b.example"):
            db.delete(db.scalar(select(BiDomainMetric).where(BiDomainMetric.domain == d)))
        db.commit()
    finally:
        db.close()


def test_scores_info_says_apify_is_the_source(monkeypatch):
    monkeypatch.setattr(am, "configured", lambda: True)
    info = hub._scores_info([{"source_domain": "x.example", "metrics": None}, {"source_domain": "y.example", "metrics": {"fetched_at": "t", "da": 4}}])
    assert info["configured"] and info["source"] == "Apify" and info["sites"] == 2 and info["missing"] == 1


def test_refresh_endpoint_covers_every_referring_domain_not_only_the_newest_200_links(client, monkeypatch):
    from app.backlinks import hub as h
    monkeypatch.setattr(h, "own_domain", lambda db, bid: "mine.example")
    monkeypatch.setattr(h, "domains", lambda db, b, **kw: {"domains": [{"domain": "big.example"}, {"domain": "small-old.example"}]})
    monkeypatch.setattr(h, "opportunities", lambda db, b, limit=30: {"opportunities": []})
    seen = []
    monkeypatch.setattr(h, "refresh_metrics", lambda db, names, **kw: seen.append(list(names)) or {"configured": True, "refreshed": 0, "message": "ok"})
    bid = client.post("/api/v1/businesses", json={"name": "Salon", "website": "https://salon.example"}).json()["id"]
    assert client.post(f"/api/v1/businesses/{bid}/backlink-hub/metrics/refresh").status_code == 200
    assert seen == [["big.example", "small-old.example"]]
