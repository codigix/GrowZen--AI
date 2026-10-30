"""Tests for the integrated Keyword Explorer endpoints."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from keyword_explorer.services.keyword_engine import keyword_engine


@pytest.fixture
def kw_client():
    return TestClient(app)


def test_keyword_explorer_health(kw_client):
    response = kw_client.get("/api/keywords/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["app"] == "Keyword Explorer API"
    assert "concurrency_limit" in data
    assert "cache_entries" in data


def test_keyword_explorer_platforms(kw_client):
    response = kw_client.get("/api/keywords/platforms")
    assert response.status_code == 200
    platforms = response.json()
    assert isinstance(platforms, list)
    assert len(platforms) >= 7

    platform_ids = {p["id"] for p in platforms}
    expected = {"google", "youtube", "bing", "amazon", "duckduckgo", "ebay", "app_stores"}
    assert expected.issubset(platform_ids)

    for p in platforms:
        assert "id" in p
        assert "name" in p
        assert "category" in p
        assert "is_free" in p
        assert p["status"] == "active"


def test_keyword_explorer_search(kw_client, monkeypatch):
    # Mock network fetching to return deterministic suggestions quickly without network calls
    async def mock_execute(request):
        from keyword_explorer.schemas.keyword import KeywordItem
        return [
            KeywordItem(
                keyword=f"{request.keyword} tools",
                trend=[50] * 12,
                search_volume=1200,
                intent="COMMERCIAL",
                competition="MEDIUM",
                cpc=1.25,
                difficulty=45,
            ),
            KeywordItem(
                keyword=f"{request.keyword} agency",
                trend=[60] * 12,
                search_volume=850,
                intent="TRANSACTIONAL",
                competition="HIGH",
                cpc=2.40,
                difficulty=65,
            ),
        ]

    monkeypatch.setattr(keyword_engine, "execute_search", mock_execute)

    payload = {
        "keyword": "seo marketing",
        "country": "IN",
        "language": "en",
        "platforms": ["google", "bing"],
        "limit": 10,
        "include_expansions": False,
    }

    response = kw_client.post("/api/keywords", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 2
    item = data[0]
    assert "keyword" in item
    assert "trend" in item
    assert len(item["trend"]) == 12
    assert "search_volume" in item
    assert "intent" in item
    assert "competition" in item
    assert "cpc" in item
    assert "difficulty" in item


def test_keyword_explorer_export_csv(kw_client, monkeypatch):
    async def mock_execute(request):
        from keyword_explorer.schemas.keyword import KeywordItem
        return [
            KeywordItem(
                keyword="local seo services",
                trend=[70] * 12,
                search_volume=2400,
                intent="COMMERCIAL",
                competition="HIGH",
                cpc=3.50,
                difficulty=58,
            )
        ]

    monkeypatch.setattr(keyword_engine, "execute_search", mock_execute)

    response = kw_client.get(
        "/api/keywords/export?keyword=local+seo+services&country=IN&language=en&platforms=google"
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert 'attachment; filename="keywords_local_seo_services_IN.csv"' in response.headers["content-disposition"]
    content = response.text
    assert "Keyword,Trend (12m),Search Volume,Intent,Competition,CPC,Difficulty" in content
    assert "local seo services" in content

