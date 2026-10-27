import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import keyword_planner, trends_client

client = TestClient(app)


def test_build_geo_country_only():
    assert keyword_planner.build_geo("in", None) == "IN"


def test_build_geo_with_state():
    assert keyword_planner.build_geo("in", "ka") == "IN-KA"


def test_build_explore_report_combines_all_keywords(monkeypatch):
    index = pd.date_range("2026-01-01", periods=5, freq="D")
    iot_df = pd.DataFrame(
        {"seo audit": [10, 20, 15, 25, 30], "seo tool": [5, 5, 10, 10, 20], "isPartial": [False] * 5},
        index=index,
    )
    related_raw = {
        "seo audit": {"top": pd.DataFrame({"query": ["seo audit tool"], "value": [90]}), "rising": None},
        "seo tool": {"top": None, "rising": pd.DataFrame({"query": ["free seo tool"], "value": ["Breakout"]})},
    }
    region_df = pd.DataFrame({"seo audit": [70, 0], "seo tool": [10, 40]}, index=["Karnataka", "Delhi"])

    monkeypatch.setattr(trends_client, "fetch_interest_over_time_multi", lambda *a, **k: iot_df)
    monkeypatch.setattr(trends_client, "fetch_related_queries_multi", lambda *a, **k: related_raw)
    monkeypatch.setattr(trends_client, "fetch_interest_by_region_multi", lambda *a, **k: region_df)

    geo, results = keyword_planner.build_explore_report(
        ["seo audit", "seo tool"], "IN", "KA", 0, "past_week"
    )

    assert geo == "IN-KA"
    assert [r.keyword for r in results] == ["seo audit", "seo tool"]

    seo_audit_result = results[0]
    assert len(seo_audit_result.interest_over_time) == 5
    assert seo_audit_result.trend_summary.latest_score == 30
    assert seo_audit_result.related_keywords[0].keyword == "seo audit tool"
    assert seo_audit_result.regional_interest == [
        r for r in seo_audit_result.regional_interest if r.score > 0
    ]
    assert seo_audit_result.regional_interest[0].region == "Karnataka"

    seo_tool_result = results[1]
    assert seo_tool_result.rising_keywords[0].source_type == "breakout"


def test_explore_endpoint_success(monkeypatch):
    monkeypatch.setattr(
        keyword_planner, "build_explore_report",
        lambda *a, **k: ("IN-KA", [])
    )

    resp = client.get("/api/keywords/explore", params={
        "keywords": "seo audit, seo tool",
        "country": "IN",
        "state": "KA",
        "category": "all_categories",
        "timeframe": "past_week",
    })

    assert resp.status_code == 200
    body = resp.json()
    assert body["keywords"] == ["seo audit", "seo tool"]
    assert body["geo"] == "IN-KA"
    assert body["state"] == "KA"
    assert body["category"] == "all_categories"
    assert body["category_id"] == 0


def test_explore_endpoint_too_many_keywords_rejected():
    resp = client.get("/api/keywords/explore", params={"keywords": "a,b,c,d,e,f"})
    assert resp.status_code == 422
    assert "at most" in resp.json()["detail"]


def test_explore_endpoint_empty_keywords_rejected():
    resp = client.get("/api/keywords/explore", params={"keywords": "  ,  "})
    assert resp.status_code == 422


def test_categories_endpoint_lists_real_google_taxonomy():
    resp = client.get("/api/keywords/categories")
    assert resp.status_code == 200
    categories = resp.json()["categories"]
    assert {"id": 0, "name": "All categories", "slug": "all_categories"} in categories
    assert {"id": 7, "name": "Finance", "slug": "finance"} in categories


def test_explore_endpoint_rejects_unknown_category():
    resp = client.get("/api/keywords/explore", params={"keywords": "seo audit", "category": "not_a_real_category"})
    assert resp.status_code == 422


def test_explore_endpoint_upstream_failure_returns_503(monkeypatch):
    from app.services.exceptions import TrendsUnavailableError

    def _raise(*a, **k):
        raise TrendsUnavailableError("down")

    monkeypatch.setattr(keyword_planner, "build_explore_report", _raise)

    resp = client.get("/api/keywords/explore", params={"keywords": "seo audit"})

    assert resp.status_code == 503
