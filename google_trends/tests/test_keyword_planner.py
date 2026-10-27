import pandas as pd
import pytest

from app.services import keyword_planner, trends_client
from app.services.exceptions import TrendsUnavailableError


def _iot_df(keyword, values):
    index = pd.date_range("2026-01-01", periods=len(values), freq="D")
    df = pd.DataFrame({keyword: values, "isPartial": [False] * len(values)}, index=index)
    return df


def test_build_interest_over_time_classifies_rising(monkeypatch):
    df = _iot_df("seo tool", [10, 12, 11, 40])
    monkeypatch.setattr(trends_client, "fetch_interest_over_time", lambda *a, **k: df)

    points, summary = keyword_planner.build_interest_over_time("seo tool", "IN", "past_7_days")

    assert len(points) == 4
    assert summary.latest_score == 40
    assert summary.classification == "rising"
    assert summary.change_percent is not None


def test_build_interest_over_time_insufficient_data(monkeypatch):
    df = _iot_df("seo tool", [10, 12])
    monkeypatch.setattr(trends_client, "fetch_interest_over_time", lambda *a, **k: df)

    points, summary = keyword_planner.build_interest_over_time("seo tool", "IN", "past_7_days")

    assert len(points) == 2
    assert summary.classification is None
    assert "at least" in summary.classification_basis


def test_build_interest_over_time_empty(monkeypatch):
    monkeypatch.setattr(trends_client, "fetch_interest_over_time", lambda *a, **k: pd.DataFrame())

    points, summary = keyword_planner.build_interest_over_time("seo tool", "IN", "past_7_days")

    assert points == []
    assert summary.latest_score is None
    assert summary.classification is None


def test_build_related_keywords_dedupes_and_classifies_breakout(monkeypatch):
    top_df = pd.DataFrame({"query": ["seo audit", "seo audit"], "value": [100, 80]})
    rising_df = pd.DataFrame({"query": ["seo audit free"], "value": ["Breakout"]})
    raw = {"seo audit": {"top": top_df, "rising": rising_df}}
    monkeypatch.setattr(trends_client, "fetch_related_queries", lambda *a, **k: raw)

    top, rising = keyword_planner.build_related_keywords("seo audit", "IN", "past_7_days")

    assert len(top) == 1  # deduped
    assert top[0].source_type == "top"
    assert top[0].score == 100
    assert len(rising) == 1
    assert rising[0].source_type == "breakout"
    assert rising[0].growth_indicator == "Breakout"


def test_build_related_keywords_no_data(monkeypatch):
    monkeypatch.setattr(trends_client, "fetch_related_queries", lambda *a, **k: {})

    top, rising = keyword_planner.build_related_keywords("seo audit", "IN", "past_7_days")

    assert top == []
    assert rising == []


def test_build_regional_interest_sorts_and_filters_zero(monkeypatch):
    df = pd.DataFrame({"seo audit": [0, 50, 90]}, index=["Goa", "Delhi", "Maharashtra"])
    monkeypatch.setattr(trends_client, "fetch_interest_by_region", lambda *a, **k: df)

    regions = keyword_planner.build_regional_interest("seo audit", "IN", "past_7_days")

    assert len(regions) == 2
    assert regions[0].region == "Maharashtra"
    assert regions[0].score == 90


def test_expand_candidate_keywords_bounded_and_deduped():
    from app.schemas import RelatedKeyword

    related = [RelatedKeyword(keyword="SEO Audit", score=1, source_type="top")]
    rising = [RelatedKeyword(keyword="seo audit tool", source_type="rising")]

    candidates = keyword_planner.expand_candidate_keywords("seo audit", related, rising)

    assert candidates[0] == "seo audit"
    assert "seo audit tool" in candidates
    assert len(candidates) == len(set(candidates))


def test_apply_limit_trims_list():
    assert keyword_planner.apply_limit([1, 2, 3, 4, 5], 2) == [1, 2]


def test_apply_limit_none_returns_everything():
    assert keyword_planner.apply_limit([1, 2, 3], None) == [1, 2, 3]


def test_expand_candidate_keywords_respects_max_candidates_override():
    from app.schemas import RelatedKeyword

    rising = [RelatedKeyword(keyword=f"kw {i}", source_type="rising") for i in range(10)]

    candidates = keyword_planner.expand_candidate_keywords("seed", [], rising, max_candidates=3)

    assert len(candidates) == 3


def test_trends_unavailable_propagates(monkeypatch):
    def _raise(*a, **k):
        raise TrendsUnavailableError("boom")

    monkeypatch.setattr(trends_client, "fetch_interest_by_region", _raise)

    with pytest.raises(TrendsUnavailableError):
        keyword_planner.build_regional_interest("seo audit", "IN", "past_7_days")
