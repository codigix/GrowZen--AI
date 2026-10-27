import pandas as pd
import pytest

from app.services import trends_client
from app.services.exceptions import InvalidTrendsRequestError, TrendsUnavailableError


class _FakeTrendReq:
    """Stand-in for pytrends.request.TrendReq used by unit tests."""

    call_count = 0
    fail_times = 0

    def __init__(self, *args, **kwargs):
        pass

    def build_payload(self, *args, **kwargs):
        pass

    def interest_over_time(self):
        _FakeTrendReq.call_count += 1
        if _FakeTrendReq.call_count <= _FakeTrendReq.fail_times:
            raise RuntimeError("simulated upstream failure")
        return pd.DataFrame({"seo": [10, 20], "isPartial": [False, False]})

    def related_queries(self):
        return {"seo": {"top": pd.DataFrame({"query": ["seo tool"], "value": [50]}), "rising": None}}

    def interest_by_region(self, **kwargs):
        return pd.DataFrame({"seo": [10]}, index=["Delhi"])


@pytest.fixture
def fake_pytrends(monkeypatch):
    _FakeTrendReq.call_count = 0
    _FakeTrendReq.fail_times = 0

    import sys
    import types

    fake_module = types.ModuleType("pytrends.request")
    fake_module.TrendReq = _FakeTrendReq
    monkeypatch.setitem(sys.modules, "pytrends.request", fake_module)
    monkeypatch.setitem(sys.modules, "pytrends", types.ModuleType("pytrends"))
    return _FakeTrendReq


def test_fetch_interest_over_time_uses_cache(fake_pytrends):
    df1 = trends_client.fetch_interest_over_time("seo", "IN", "past_7_days")
    df2 = trends_client.fetch_interest_over_time("seo", "IN", "past_7_days")

    assert df1 is df2
    assert fake_pytrends.call_count == 1


def test_fetch_interest_over_time_retries_then_succeeds(fake_pytrends, monkeypatch):
    fake_pytrends.fail_times = 1
    monkeypatch.setattr(trends_client.time, "sleep", lambda *_: None)

    df = trends_client.fetch_interest_over_time("seo", "IN", "past_7_days")

    assert not df.empty
    assert fake_pytrends.call_count == 2


def test_fetch_interest_over_time_raises_after_exhausting_retries(fake_pytrends, monkeypatch):
    fake_pytrends.fail_times = 99
    monkeypatch.setattr(trends_client.time, "sleep", lambda *_: None)

    with pytest.raises(TrendsUnavailableError):
        trends_client.fetch_interest_over_time("seo", "IN", "past_7_days")


def test_invalid_timeframe_raises_without_calling_api(fake_pytrends):
    with pytest.raises(InvalidTrendsRequestError):
        trends_client.fetch_interest_over_time("seo", "IN", "not-a-real-timeframe")

    assert fake_pytrends.call_count == 0
