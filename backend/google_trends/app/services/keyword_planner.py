"""Turns raw pytrends data into the response shapes the API returns.

No field here is ever invented: a score/growth value is included only when
Google Trends actually returned it, otherwise the field is left ``None``
and callers should render "Not available".
"""

from __future__ import annotations

import logging
import math

import pandas as pd

from ..config import MIN_POINTS_FOR_CLASSIFICATION, settings
from ..schemas import InterestPoint, KeywordExploreResult, RegionalInterest, RelatedKeyword, TrendSummary
from . import trends_client
from .exceptions import InvalidTrendsRequestError, TrendsUnavailableError

logger = logging.getLogger("google_trends.planner")

RISING_THRESHOLD_PCT = 15.0
DECLINING_THRESHOLD_PCT = -15.0

# A single related-queries call to Google Trends returns at most ~25 rows per list (often fewer).
# To reach a larger target, expand_related_keywords() re-queries a few of those rows as extra seed
# keywords and merges their own related/rising queries in. Each extra seed costs one more Google
# Trends request (throttled by settings.min_request_interval_seconds), so this is capped low.
MAX_SEED_EXPANSIONS = 4


def _normalize(keyword: str) -> str:
    return " ".join(keyword.strip().lower().split())


def build_interest_over_time(keyword: str, country: str, timeframe: str) -> tuple[list[InterestPoint], TrendSummary]:
    df = trends_client.fetch_interest_over_time(keyword, country, timeframe)
    return _dataframe_to_points_and_summary(df, keyword)


def _dataframe_to_points_and_summary(df: pd.DataFrame, keyword: str) -> tuple[list[InterestPoint], TrendSummary]:
    if df is None or df.empty or keyword not in df.columns:
        return [], TrendSummary(
            classification_basis="No interest-over-time data was returned for this keyword/region/timeframe."
        )

    points: list[InterestPoint] = []
    values: list[int] = []
    for ts, row in df.iterrows():
        value = row.get(keyword)
        if value is None or (isinstance(value, float) and math.isnan(value)):
            continue
        is_partial = bool(row.get("isPartial", False))
        points.append(InterestPoint(date=str(ts.date()) if hasattr(ts, "date") else str(ts),
                                     value=int(value), is_partial=is_partial))
        values.append(int(value))

    if not values:
        return points, TrendSummary(
            classification_basis="Interest-over-time series was empty after filtering."
        )

    latest = values[-1]
    average = round(sum(values) / len(values), 2)

    if len(values) < MIN_POINTS_FOR_CLASSIFICATION:
        return points, TrendSummary(
            latest_score=latest,
            average_score=average,
            classification_basis=(
                f"Only {len(values)} data point(s) available; at least "
                f"{MIN_POINTS_FOR_CLASSIFICATION} are required to classify a trend."
            ),
        )

    baseline = sum(values[:-1]) / (len(values) - 1) if len(values) > 1 else values[0]
    change_percent = round(((latest - baseline) / baseline) * 100, 2) if baseline else None

    classification = "stable"
    if change_percent is not None:
        if change_percent >= RISING_THRESHOLD_PCT:
            classification = "rising"
        elif change_percent <= DECLINING_THRESHOLD_PCT:
            classification = "declining"

    return points, TrendSummary(
        latest_score=latest,
        average_score=average,
        change_percent=change_percent,
        classification=classification,
        classification_basis=(
            "Calculated from the latest data point versus the average of prior points "
            f"in this series ({len(values)} points)."
        ),
    )


def _rows_to_related_keywords(df: pd.DataFrame | None, source_type: str) -> list[RelatedKeyword]:
    if df is None or df.empty:
        return []
    results: list[RelatedKeyword] = []
    for _, row in df.iterrows():
        query = row.get("query")
        if not query:
            continue
        raw_value = row.get("value")
        score = None
        growth_indicator = None
        effective_source = source_type
        if isinstance(raw_value, str) and raw_value.strip().lower() == "breakout":
            effective_source = "breakout"
            growth_indicator = "Breakout"
        elif raw_value is not None and not (isinstance(raw_value, float) and math.isnan(raw_value)):
            try:
                numeric = int(raw_value)
                if source_type == "rising":
                    growth_indicator = f"+{numeric}%"
                else:
                    score = numeric
            except (TypeError, ValueError):
                growth_indicator = str(raw_value)
        results.append(RelatedKeyword(keyword=query, score=score, growth_indicator=growth_indicator,
                                       source_type=effective_source))
    return results


def build_related_keywords(keyword: str, country: str, timeframe: str) -> tuple[list[RelatedKeyword], list[RelatedKeyword]]:
    raw = trends_client.fetch_related_queries(keyword, country, timeframe)
    return _related_queries_dict_to_lists(raw, keyword)


def _related_queries_dict_to_lists(raw: dict, keyword: str) -> tuple[list[RelatedKeyword], list[RelatedKeyword]]:
    entry = raw.get(keyword) if raw else None
    if not entry:
        return [], []

    top = _rows_to_related_keywords(entry.get("top"), "top")
    rising = _rows_to_related_keywords(entry.get("rising"), "rising")

    return _dedupe(top), _dedupe(rising)


def _dedupe(keywords: list[RelatedKeyword]) -> list[RelatedKeyword]:
    seen: set[str] = set()
    deduped: list[RelatedKeyword] = []
    for kw in keywords:
        normalized = _normalize(kw.keyword)
        if normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(kw)
    return deduped


def _merge_expansion(seed_keyword: str, top: list[RelatedKeyword], rising: list[RelatedKeyword],
                      target_count: int, max_seed_expansions: int, fetch_fn) -> tuple[list[RelatedKeyword], list[RelatedKeyword]]:
    """Tops up ``top``/``rising`` (already fetched for ``seed_keyword``) past Google's single-call size by
    re-querying a few of those keywords as additional seeds (via ``fetch_fn(seed) -> (top, rising)``) and
    merging their own related/rising queries in, deduplicated, until each list reaches ``target_count`` or
    seeds run out. Mutates and returns the same lists."""
    if len(top) >= target_count and len(rising) >= target_count:
        return top, rising

    seen_top = {_normalize(seed_keyword)} | {_normalize(k.keyword) for k in top}
    seen_rising = {_normalize(seed_keyword)} | {_normalize(k.keyword) for k in rising}

    extra_seeds: list[str] = []
    seed_seen = {_normalize(seed_keyword)}
    for kw in rising + top:  # rising first: the strongest growth signals make the most useful seeds
        normalized = _normalize(kw.keyword)
        if normalized in seed_seen:
            continue
        seed_seen.add(normalized)
        extra_seeds.append(kw.keyword)
        if len(extra_seeds) >= max_seed_expansions:
            break

    for extra_seed in extra_seeds:
        if len(top) >= target_count and len(rising) >= target_count:
            break
        try:
            extra_top, extra_rising = fetch_fn(extra_seed)
        except (InvalidTrendsRequestError, TrendsUnavailableError) as exc:
            logger.warning("Skipping expansion seed '%s': %s", extra_seed, exc)
            continue
        for kw in extra_top:
            normalized = _normalize(kw.keyword)
            if normalized in seen_top or len(top) >= target_count:
                continue
            seen_top.add(normalized)
            top.append(kw)
        for kw in extra_rising:
            normalized = _normalize(kw.keyword)
            if normalized in seen_rising or len(rising) >= target_count:
                continue
            seen_rising.add(normalized)
            rising.append(kw)

    return top, rising


def expand_related_keywords(seed_keyword: str, top: list[RelatedKeyword], rising: list[RelatedKeyword],
                             country: str, timeframe: str, target_count: int,
                             max_seed_expansions: int = MAX_SEED_EXPANSIONS) -> tuple[list[RelatedKeyword], list[RelatedKeyword]]:
    """For /trends, /related and /planner (plain country + Timeframe)."""
    return _merge_expansion(seed_keyword, top, rising, target_count, max_seed_expansions,
                             fetch_fn=lambda kw: build_related_keywords(kw, country, timeframe))


def expand_related_keywords_explore(seed_keyword: str, top: list[RelatedKeyword], rising: list[RelatedKeyword],
                                     geo: str, timeframe: str, category: int, target_count: int,
                                     max_seed_expansions: int = MAX_SEED_EXPANSIONS) -> tuple[list[RelatedKeyword], list[RelatedKeyword]]:
    """For /explore: geo may be "COUNTRY-STATE", timeframe is an ExploreTimeframe value, and a category
    applies. Google Trends' /explore and /trends timeframe vocabularies differ (e.g. "past_week" vs
    "past_7_days"), so this fetches expansion seeds the same way build_explore_report does, not via
    expand_related_keywords()."""
    def fetch(kw: str) -> tuple[list[RelatedKeyword], list[RelatedKeyword]]:
        raw = trends_client.fetch_related_queries_multi([kw], geo, timeframe, category)
        return _related_queries_dict_to_lists(raw, kw)

    return _merge_expansion(seed_keyword, top, rising, target_count, max_seed_expansions, fetch_fn=fetch)


def build_related_keywords_expanded(keyword: str, country: str, timeframe: str, target_count: int,
                                     max_seed_expansions: int = MAX_SEED_EXPANSIONS) -> tuple[list[RelatedKeyword], list[RelatedKeyword]]:
    """build_related_keywords(), topped up toward target_count via expand_related_keywords()."""
    top, rising = build_related_keywords(keyword, country, timeframe)
    top, rising = expand_related_keywords(keyword, top, rising, country, timeframe, target_count, max_seed_expansions)
    top = _attach_top_query_changes(top, keyword, country, timeframe)
    return top, rising


def _attach_top_query_changes(top: list[RelatedKeyword], keyword: str, country: str,
                               timeframe: str) -> list[RelatedKeyword]:
    """Adds a period-over-period growth_indicator to each top query, by comparing its score
    against the same query's score in the immediately preceding period of the same length
    (one extra Google Trends request for the seed keyword, same as Google Trends' own UI
    shows alongside the Top queries table). "Breakout" is Google's own signal (only ever seen
    on rising queries) and is never invented here: a top query with no prior-period match
    (this period's top-N snapshot and the previous one are each capped at ~25 rows, so a fast-
    moving topic's lists can simply not overlap) is left without a growth_indicator rather than
    mislabeled -- the frontend shows "no comparison data" for it, same as any other missing field."""
    if not top:
        return top
    raw_prev = trends_client.fetch_related_queries_previous_period(keyword, country, timeframe)
    if not raw_prev:
        return top
    prev_top, _ = _related_queries_dict_to_lists(raw_prev, keyword)
    prev_scores = {_normalize(kw.keyword): kw.score for kw in prev_top if kw.score is not None}

    updated: list[RelatedKeyword] = []
    for kw in top:
        prev_score = prev_scores.get(_normalize(kw.keyword))
        if kw.score is None or prev_score is None or prev_score == 0:
            updated.append(kw)
        else:
            pct = round((kw.score - prev_score) / prev_score * 100)
            updated.append(kw.model_copy(update={"growth_indicator": f"{'+' if pct >= 0 else ''}{pct}%"}))
    return updated


def build_regional_interest(keyword: str, country: str, timeframe: str) -> list[RegionalInterest]:
    df = trends_client.fetch_interest_by_region(keyword, country, timeframe)
    return _region_dataframe_to_list(df, keyword, country)


def _region_dataframe_to_list(df: pd.DataFrame, keyword: str, country: str) -> list[RegionalInterest]:
    if df is None or df.empty or keyword not in df.columns:
        return []

    results = []
    for region_name, row in df.iterrows():
        value = row.get(keyword)
        if value is None or (isinstance(value, float) and math.isnan(value)) or int(value) == 0:
            continue
        results.append(RegionalInterest(region=str(region_name), country=country.upper(), score=int(value)))

    results.sort(key=lambda r: r.score, reverse=True)
    return results


def expand_candidate_keywords(seed: str, related: list[RelatedKeyword], rising: list[RelatedKeyword],
                               max_candidates: int | None = None) -> list[str]:
    """Builds a deduplicated candidate list from the seed plus related/rising
    queries, bounded by ``max_candidates`` (falls back to
    ``settings.max_expansion_candidates``) to avoid hammering Google Trends
    with further lookups."""
    limit = max_candidates if max_candidates is not None else settings.max_expansion_candidates
    candidates: list[str] = []
    seen: set[str] = set()

    def _add(kw: str) -> None:
        normalized = _normalize(kw)
        if normalized and normalized not in seen:
            seen.add(normalized)
            candidates.append(normalized)

    _add(seed)
    for kw in rising + related:
        if len(candidates) >= limit:
            break
        _add(kw.keyword)

    return candidates


def apply_limit(items: list, limit: int | None) -> list:
    """Trims a list to at most `limit` items. `None` means "no extra limit" --
    the caller already got whatever Google Trends itself returned."""
    if limit is None:
        return items
    return items[:limit]


def build_geo(country: str, state: str | None) -> str:
    """Builds the geo code pytrends/Google Trends expects: a plain country
    code ("IN"), or "COUNTRY-STATE" for a first-level subdivision
    ("IN-KA" for Karnataka). Google Trends has no free-text city targeting,
    only country and ISO 3166-2 region codes, so that's the most granular
    "location" this service can offer."""
    country = country.upper().strip()
    if not state:
        return country
    return f"{country}-{state.upper().strip()}"


def build_explore_report(keywords: list[str], country: str, state: str | None,
                          category: int, timeframe: str) -> tuple[str, list[KeywordExploreResult]]:
    geo = build_geo(country, state)

    iot_df = trends_client.fetch_interest_over_time_multi(keywords, geo, timeframe, category)
    related_raw = trends_client.fetch_related_queries_multi(keywords, geo, timeframe, category)
    region_df = trends_client.fetch_interest_by_region_multi(keywords, geo, timeframe, category)

    results: list[KeywordExploreResult] = []
    for kw in keywords:
        points, summary = _dataframe_to_points_and_summary(iot_df, kw)
        top, rising = _related_queries_dict_to_lists(related_raw, kw)
        regional = _region_dataframe_to_list(region_df, kw, country)
        results.append(KeywordExploreResult(
            keyword=kw,
            trend_summary=summary,
            interest_over_time=points,
            related_keywords=top,
            rising_keywords=rising,
            regional_interest=regional,
        ))

    return geo, results
