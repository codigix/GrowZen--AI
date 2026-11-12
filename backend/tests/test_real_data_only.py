"""With ALLOW_SAMPLE_DATA off (the default everywhere except this test suite), nothing invented is shown as real: a missing key means "not available"."""
from datetime import datetime, timedelta, timezone

import pytest

from app.config import get_settings
from app.db import SessionLocal
from app.errors import DataUnavailable
from app.models import Business, GeoResult, Schedule
from app.services import audits, geo, landscape, providers, schedules

AI_KEYS = ("openai_api_key", "gemini_api_key", "perplexity_api_key", "deepseek_api_key", "anthropic_api_key")
ADS_KEYS = ("google_ads_developer_token", "google_ads_client_id", "google_ads_client_secret", "google_ads_refresh_token", "google_ads_customer_id")


@pytest.fixture()
def real_only(monkeypatch):
    """No sample data, and no keys: what a fresh install looks like."""
    s = get_settings()
    monkeypatch.setattr(s, "allow_sample_data", False)
    monkeypatch.setattr(s, "serper_api_key", "")
    for k in (*AI_KEYS, *ADS_KEYS):
        monkeypatch.setattr(s, k, "")
    return s


def _project(client, name="Real Only Co"):
    r = client.post("/api/v1/businesses", json={"name": name, "primary_category": "Clothing rental service", "city": "Pune", "country": "IN"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_every_provider_refuses_and_names_the_missing_key(real_only):
    for factory, key in [(providers.rank_provider, "SERPER_API_KEY"), (providers.backlink_provider, "SERPER_API_KEY"), (providers.citation_provider, "SERPER_API_KEY"),
                         (providers.keyword_provider, "GOOGLE_ADS_REFRESH_TOKEN")]:
        with pytest.raises(DataUnavailable) as e:
            factory()
        assert key in e.value.message and e.value.code == "data_unavailable"


def test_the_sample_providers_exist_only_when_explicitly_allowed(real_only, monkeypatch):
    monkeypatch.setattr(real_only, "allow_sample_data", True)
    assert providers.rank_provider().source == "sample" and providers.keyword_provider().source == "sample"
    monkeypatch.setattr(real_only, "serper_api_key", "k")
    assert providers.rank_provider().source == "live"  # a real key always wins


def test_routes_answer_503_data_unavailable_instead_of_invented_numbers(client, real_only):
    bid = _project(client)
    r = client.post(f"/api/v1/businesses/{bid}/rank-scans", json={"keyword": "clothing rental in pune"})
    assert r.status_code == 503 and r.json()["code"] == "data_unavailable" and "SERPER_API_KEY" in r.json()["detail"]
    r = client.post(f"/api/v1/businesses/{bid}/keywords/ideas", json={"seed": "lehenga rental"})
    assert r.status_code == 503 and r.json()["code"] == "data_unavailable" and "Keyword Planner" in r.json()["detail"]
    r = client.post(f"/api/v1/businesses/{bid}/geo/run")
    assert r.status_code == 503 and r.json()["code"] == "data_unavailable" and "ANTHROPIC_API_KEY" in r.json()["detail"]
    assert client.get("/api/v1/status").json()["rank_source"] == "unavailable"


def test_an_audit_without_a_data_source_fails_with_the_reason_and_never_counts(client, real_only):
    bid = _project(client)
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        for kind in ("rankings", "backlinks", "citations"):
            a = audits.run(db, b, kind)
            assert a.status == "failed" and "SERPER_API_KEY" in a.error and a.score is None
        assert {k: v for k, v in audits.latest(db, b).items() if k in ("rankings", "backlinks", "citations")} == {}  # a failed run is never the latest result
    finally:
        db.close()


def test_geo_never_stores_random_mentions_and_lists_engines_as_not_connected(client, real_only, monkeypatch):
    bid = _project(client)
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        with pytest.raises(DataUnavailable):
            geo.run_prompts(db, b)
        assert db.query(GeoResult).filter(GeoResult.business_id == bid).count() == 0
    finally:
        db.close()
    d = client.get(f"/api/v1/businesses/{bid}/geo").json()
    assert [e["engine"] for e in d["engines"]] == ["ChatGPT", "Gemini", "Perplexity", "DeepSeek", "Claude"] and not any(e["connected"] for e in d["engines"])
    assert d["results"] == [] and "AI Overviews" not in str(d)
    monkeypatch.setattr(real_only, "anthropic_api_key", "sk-test")
    assert [e["engine"] for e in geo.engine_status() if e["connected"]] == ["Claude"]  # only the engine with a key is connected


def test_even_with_sample_data_allowed_there_is_no_ai_overviews_result(client, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "allow_sample_data", True)
    for k in AI_KEYS:
        monkeypatch.setattr(s, k, "")
    bid = _project(client)
    db = SessionLocal()
    try:
        geo.run_prompts(db, db.get(Business, bid))
        engines = {g.engine for g in db.query(GeoResult).filter(GeoResult.business_id == bid)}
        assert engines == set(geo.ENGINE_NAMES) and "AI Overviews" not in engines
        assert all(g.data_source == "sample" for g in db.query(GeoResult).filter(GeoResult.business_id == bid))  # and it says so
    finally:
        db.close()


def test_the_landscape_mock_refuses_in_production_and_without_the_switch(monkeypatch):
    from datetime import date
    s = get_settings()
    monkeypatch.setattr(s, "allow_sample_data", True)
    monkeypatch.setattr(s, "rank_landscape_mock", True)
    monkeypatch.setattr(s, "environment", "development")
    assert s.rank_landscape_mock_on and landscape.mock_obs("example.com", 3, date.today())[0]
    monkeypatch.setattr(s, "environment", "production")
    assert not s.rank_landscape_mock_on
    with pytest.raises(DataUnavailable):
        landscape.mock_obs("example.com", 3, date.today())
    monkeypatch.setattr(s, "environment", "development")
    monkeypatch.setattr(s, "allow_sample_data", False)
    assert not s.rank_landscape_mock_on  # RANK_LANDSCAPE_MOCK alone is not enough
    with pytest.raises(DataUnavailable):
        landscape.mock_obs("example.com", 3, date.today())


def test_a_scheduled_job_without_its_data_source_is_skipped_with_the_reason(client, real_only):
    bid = _project(client)
    db = SessionLocal()
    try:
        db.add(Schedule(business_id=bid, job="geo", every="daily", next_run_at=datetime.now(timezone.utc) - timedelta(minutes=5)))
        db.commit()
        schedules.run_due(db)  # must not raise
        s = db.query(Schedule).filter(Schedule.business_id == bid, Schedule.job == "geo").one()
        assert s.last_status == "skipped" and "AI engine key" in s.last_error
        assert s.next_run_at.replace(tzinfo=None) > datetime.now(timezone.utc).replace(tzinfo=None)  # it tries again at its next turn (SQLite returns naive times)
    finally:
        db.close()
