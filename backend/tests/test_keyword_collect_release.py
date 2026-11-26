"""Collecting keywords asks Google Ads, the AI and the website, which can take minutes. It must not hold a database connection while it waits, and it must report and save
exactly what it did before."""
import time

import pytest

from app.db import SessionLocal, engine
from app.models import Business, Keyword, KeywordCandidate
from app.services import ai, business_understanding as bu, keyword_metrics
from app.services import google_ads_client as ads


def settle(seconds: float = 5.0) -> None:
    """Wait for connections that an earlier test's background thread may still hold, so a count taken during a test starts from an idle pool."""
    deadline = time.monotonic() + seconds
    while engine.pool.checkedout() and time.monotonic() < deadline:
        time.sleep(0.05)


class Seen:
    def __init__(self):
        self.counts: list[int] = []

    def record(self, value=None):
        def inner(*a, **k):
            self.counts.append(engine.pool.checkedout())
            return value() if callable(value) else value
        return inner


@pytest.fixture()
def seen():
    settle()
    return Seen()


@pytest.fixture()
def bid(client):
    b = client.post("/api/v1/businesses", json={"name": "Collect Co", "website": "https://collect.example", "city": "Pune", "primary_category": "Dentist"}).json()["id"]
    yield b
    db = SessionLocal()
    db.query(KeywordCandidate).filter(KeywordCandidate.business_id == b).delete()
    db.query(Keyword).filter(Keyword.business_id == b).delete()
    db.query(Business).filter(Business.id == b).delete()
    db.commit()
    db.close()


IDEA = {"keyword": "dentist in pune", "avg_monthly_searches": 120, "competition": "LOW", "competition_index": 12, "high_top_of_page_bid": 1.5}


def test_collecting_from_the_planner_holds_no_connection_during_the_google_ads_calls(client, bid, seen, monkeypatch):
    monkeypatch.setattr(keyword_metrics, "enabled", lambda: True)
    monkeypatch.setattr(ads, "geo_target_for", lambda country: "geo")
    monkeypatch.setattr(ads, "keyword_ideas", seen.record([IDEA]))  # the ideas
    monkeypatch.setattr(ads, "historical_metrics", seen.record({}))  # the 12-month history asked for after the sources
    r = client.post(f"/api/v1/businesses/{bid}/keyword-workspace/collect", json={"sources": ["planner"]})
    assert r.status_code == 200
    rep = r.json()["report"]["planner"]
    assert rep["found"] == 1 and rep["new"] == 1 and rep["label"] == "Google Keyword Planner" and set(rep) == {"label", "found", "new", "note"}
    assert seen.counts and max(seen.counts) == 0
    db = SessionLocal()
    assert [c.keyword for c in db.query(KeywordCandidate).filter_by(business_id=bid)] == ["dentist in pune"]  # saved
    db.close()


def test_building_the_business_summary_holds_no_connection_while_the_site_is_read_and_the_ai_answers(client, bid, seen, monkeypatch):
    monkeypatch.setattr(keyword_metrics, "enabled", lambda: False)
    monkeypatch.setattr(bu, "read_site", seen.record([]))  # the website is read
    monkeypatch.setattr(bu, "_ai", seen.record({}))  # the AI writes the summary
    r = client.post(f"/api/v1/businesses/{bid}/keyword-workspace/collect", json={"sources": ["brief"]})
    assert r.status_code == 200 and "summary" in r.json()["report"]
    assert len(seen.counts) == 2 and max(seen.counts) == 0


def test_the_relevance_check_holds_no_connection_while_the_ai_judges(client, bid, seen, monkeypatch):
    monkeypatch.setattr(keyword_metrics, "enabled", lambda: False)
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete_json", seen.record({"results": [{"i": 0, "fit": "yes", "why": "a service", "for": "patients"}]}))
    base = f"/api/v1/businesses/{bid}/keyword-workspace"
    client.post(f"{base}/add", json={"ideas": [{"keyword": "dentist in pune", "kind": "google_ideas", "detail": "x"}]})  # a keyword the AI has not judged yet
    r = client.post(f"{base}/collect", json={"sources": ["website"]})
    assert r.status_code == 200 and r.json()["report"]["fit"]["found"] == 1
    assert seen.counts and max(seen.counts) == 0
    db = SessionLocal()
    assert db.query(KeywordCandidate).filter(KeywordCandidate.business_id == bid, KeywordCandidate.fit.is_not(None)).count() >= 1  # the verdicts were saved
    db.close()


def test_difficulty_holds_no_connection_while_google_and_apify_answer(client, bid, seen, monkeypatch):
    from app.services import keyword_difficulty as kd
    base = f"/api/v1/businesses/{bid}/keyword-workspace"
    client.post(f"{base}/add", json={"ideas": [{"keyword": "dentist in pune", "kind": "ai", "detail": "x"}]})
    ids = [i["id"] for i in client.get(base).json()["items"]]
    monkeypatch.setattr(kd, "score", seen.record({"score": 42, "formula": {}, "sites_with_figures": 3, "sites": 10, "weight_used": 1.0}))
    r = client.post(f"{base}/difficulty", json={"ids": ids})
    assert r.status_code == 200 and r.json()["results"][0]["kd"] == 42  # saved on the row and returned as before
    assert seen.counts and max(seen.counts) == 0
    db = SessionLocal()
    assert db.query(KeywordCandidate).filter_by(business_id=bid).one().kd == 42
    db.close()


def test_the_report_and_the_saved_keywords_are_the_same_for_several_sources_at_once(client, bid, monkeypatch):
    monkeypatch.setattr(keyword_metrics, "enabled", lambda: False)
    r = client.post(f"/api/v1/businesses/{bid}/keyword-workspace/collect", json={"sources": ["profile", "website", "competitors"]}).json()
    rep = r["report"]
    assert rep["profile"]["found"] >= 2 and rep["website"]["found"] == 0 and rep["competitors"]["found"] == 0
    assert "dentist in pune" in {i["keyword"] for i in r["items"]}
    db = SessionLocal()
    assert db.query(KeywordCandidate).filter_by(business_id=bid).count() == rep["profile"]["new"]
    db.close()
