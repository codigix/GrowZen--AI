import pandas as pd
import pytest
from fastapi.testclient import TestClient

from gt_app.main import app
from gt_app.schemas import RelatedKeyword, RegionalInterest, TrendSummary
from gt_app.services import keyword_planner
from gt_app.services.exceptions import TrendsUnavailableError

client = TestClient(app)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_trends_endpoint_success(monkeypatch):
    summary = TrendSummary(latest_score=50, average_score=40.0, change_percent=10.0,
                            classification="stable", classification_basis="calc")
    monkeypatch.setattr(keyword_planner, "build_interest_over_time", lambda *a, **k: ([], summary))

    resp = client.get("/api/keywords/trends", params={"keyword": "seo audit", "country": "IN", "timeframe": "past_7_days"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["seed_keyword"] == "seo audit"
    assert body["country"] == "IN"
    assert body["trend_summary"]["classification"] == "stable"
    assert "data_source" in body
    assert len(body["limitations"]) > 0


def test_trends_endpoint_short_keyword_rejected():
    resp = client.get("/api/keywords/trends", params={"keyword": "a"})
    assert resp.status_code == 422


def test_trends_endpoint_upstream_failure_returns_503(monkeypatch):
    def _raise(*a, **k):
        raise TrendsUnavailableError("down")

    monkeypatch.setattr(keyword_planner, "build_interest_over_time", _raise)

    resp = client.get("/api/keywords/trends", params={"keyword": "seo audit"})

    assert resp.status_code == 503
    assert "temporarily unavailable" in resp.json()["detail"]
    assert "Traceback" not in resp.text


def test_related_endpoint_success(monkeypatch):
    top = [RelatedKeyword(keyword="seo tool", score=80, source_type="top")]
    rising = [RelatedKeyword(keyword="seo tool free", growth_indicator="Breakout", source_type="breakout")]
    monkeypatch.setattr(keyword_planner, "build_related_keywords", lambda *a, **k: (top, rising))

    resp = client.get("/api/keywords/related", params={"keyword": "seo audit"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["related_keywords"][0]["keyword"] == "seo tool"
    assert body["rising_keywords"][0]["source_type"] == "breakout"


def test_related_endpoint_respects_limit(monkeypatch):
    top = [RelatedKeyword(keyword=f"kw {i}", score=100 - i, source_type="top") for i in range(10)]
    monkeypatch.setattr(keyword_planner, "build_related_keywords", lambda *a, **k: (top, []))

    resp = client.get("/api/keywords/related", params={"keyword": "seo audit", "limit": 3})

    assert resp.status_code == 200
    assert len(resp.json()["related_keywords"]) == 3


def test_related_endpoint_limit_above_25_rejected():
    resp = client.get("/api/keywords/related", params={"keyword": "seo audit", "limit": 100})
    assert resp.status_code == 422


def test_planner_endpoint_combines_all_sources(monkeypatch):
    summary = TrendSummary(classification_basis="n/a")
    monkeypatch.setattr(keyword_planner, "build_interest_over_time", lambda *a, **k: ([], summary))
    monkeypatch.setattr(keyword_planner, "build_related_keywords", lambda *a, **k: ([], []))
    monkeypatch.setattr(keyword_planner, "build_regional_interest",
                         lambda *a, **k: [RegionalInterest(region="Delhi", country="IN", score=70)])
    monkeypatch.setattr(keyword_planner, "expand_candidate_keywords", lambda *a, **k: ["seo audit"])

    resp = client.get("/api/keywords/planner", params={"keyword": "seo audit"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["candidate_keywords"] == ["seo audit"]
    assert body["regional_interest"][0]["region"] == "Delhi"


def test_planner_endpoint_respects_regional_limit(monkeypatch):
    regions = [RegionalInterest(region=f"Region {i}", country="IN", score=100 - i) for i in range(10)]
    monkeypatch.setattr(keyword_planner, "build_interest_over_time",
                         lambda *a, **k: ([], TrendSummary(classification_basis="n/a")))
    monkeypatch.setattr(keyword_planner, "build_related_keywords", lambda *a, **k: ([], []))
    monkeypatch.setattr(keyword_planner, "build_regional_interest", lambda *a, **k: regions)
    monkeypatch.setattr(keyword_planner, "expand_candidate_keywords", lambda *a, **k: [])

    resp = client.get("/api/keywords/planner", params={"keyword": "seo audit", "regional_limit": 4})

    assert resp.status_code == 200
    assert len(resp.json()["regional_interest"]) == 4
