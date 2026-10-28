"""In-process bridge to the google_trends keyword planner.

That service lives in its own top-level folder (/google_trends) with its own tests, so it can
still be developed and tested on its own. But its FastAPI app is no longer run as a separate
process: this module imports its service layer directly (sys.path trick below, since its package
is named ``gt_app`` specifically to avoid colliding with this app's own ``app`` package) and
calls it in-process, so the whole backend runs as a single process on one port. This module stays
the only place in this backend that knows google_trends' internal shapes.
"""
from __future__ import annotations

import sys
from pathlib import Path

_GT_ROOT = Path(__file__).resolve().parent.parent.parent / "google_trends"
if str(_GT_ROOT) not in sys.path:
    sys.path.insert(0, str(_GT_ROOT))

from gt_app.config import MAX_EXPLORE_KEYWORDS, TOP_LEVEL_CATEGORIES, settings as gt_settings  # noqa: E402
from gt_app.routers.keywords import DEFAULT_TARGET_COUNT  # noqa: E402
from gt_app.schemas import (  # noqa: E402
    CATEGORY_SLUG_TO_ID, Category, ExploreResponse, ExploreTimeframe,
    InterestOverTimeResponse, PlannerResponse, RelatedKeywordsResponse, Timeframe,
)
from gt_app.services import keyword_planner  # noqa: E402
from gt_app.services.exceptions import InvalidTrendsRequestError, TrendsUnavailableError  # noqa: E402


class GoogleTrendsUnavailable(Exception):
    """Kept for the facade router's except clause; no longer raised now that this call is
    in-process rather than over HTTP, but a future network-based provider could still need it."""


def _handle(build_fn) -> tuple[int, dict]:
    try:
        model = build_fn()
    except InvalidTrendsRequestError as exc:
        return 400, {"detail": str(exc)}
    except TrendsUnavailableError as exc:
        return 503, {"detail": "Google Trends is temporarily unavailable. Please try again shortly."}
    return 200, model.model_dump(mode="json")


def trends(keyword: str, country: str | None = None, timeframe: str | None = None) -> tuple[int, dict]:
    tf = Timeframe(timeframe) if timeframe else Timeframe.past_7_days
    country = country or gt_settings.default_country

    def _build():
        points, summary = keyword_planner.build_interest_over_time(keyword, country, tf.value)
        return InterestOverTimeResponse(seed_keyword=keyword, country=country.upper(), timeframe=tf,
                                         interest_over_time=points, trend_summary=summary)
    return _handle(_build)


def related(keyword: str, country: str | None = None, timeframe: str | None = None, limit: int | None = None) -> tuple[int, dict]:
    tf = Timeframe(timeframe) if timeframe else Timeframe.past_7_days
    country = country or gt_settings.default_country

    def _build():
        top, rising = keyword_planner.build_related_keywords_expanded(keyword, country, tf.value,
                                                                        target_count=limit or DEFAULT_TARGET_COUNT)
        return RelatedKeywordsResponse(seed_keyword=keyword, country=country.upper(), timeframe=tf,
                                        related_keywords=keyword_planner.apply_limit(top, limit),
                                        rising_keywords=keyword_planner.apply_limit(rising, limit))
    return _handle(_build)


def planner(keyword: str, country: str | None = None, timeframe: str | None = None, limit: int | None = None,
            regional_limit: int | None = None) -> tuple[int, dict]:
    tf = Timeframe(timeframe) if timeframe else Timeframe.past_7_days
    country = country or gt_settings.default_country

    def _build():
        points, summary = keyword_planner.build_interest_over_time(keyword, country, tf.value)
        top, rising = keyword_planner.build_related_keywords_expanded(keyword, country, tf.value,
                                                                        target_count=limit or DEFAULT_TARGET_COUNT)
        regional = keyword_planner.build_regional_interest(keyword, country, tf.value)
        candidates = keyword_planner.expand_candidate_keywords(keyword, top, rising, max_candidates=limit)
        return PlannerResponse(seed_keyword=keyword, country=country.upper(), timeframe=tf,
                                trend_summary=summary, interest_over_time=points,
                                related_keywords=keyword_planner.apply_limit(top, limit),
                                rising_keywords=keyword_planner.apply_limit(rising, limit),
                                candidate_keywords=candidates,
                                regional_interest=keyword_planner.apply_limit(regional, regional_limit))
    return _handle(_build)


def _parse_explore_keywords(raw: str) -> tuple[list[str] | None, dict | None]:
    keywords = [k.strip() for k in raw.split(",") if k.strip()]
    if not keywords:
        return None, {"detail": "At least one keyword is required."}
    if len(keywords) > MAX_EXPLORE_KEYWORDS:
        return None, {"detail": f"Google Trends supports comparing at most {MAX_EXPLORE_KEYWORDS} keywords at once."}
    for kw in keywords:
        if len(kw) < 2 or len(kw) > 100:
            return None, {"detail": f"Keyword '{kw}' must be 2-100 characters long."}
    return keywords, None


def explore(keywords: str, country: str | None = None, state: str | None = None, category: str | None = None,
            timeframe: str | None = None, limit: int | None = None, regional_limit: int | None = None) -> tuple[int, dict]:
    keyword_list, error = _parse_explore_keywords(keywords)
    if error is not None:
        return 422, error

    cat_slug = category or Category.all_categories.value
    if cat_slug not in CATEGORY_SLUG_TO_ID:
        return 422, {"detail": f"Unknown category '{cat_slug}'."}
    category_id = CATEGORY_SLUG_TO_ID[cat_slug]
    tf = ExploreTimeframe(timeframe) if timeframe else ExploreTimeframe.past_week
    country = country or gt_settings.default_country

    def _build():
        geo, results = keyword_planner.build_explore_report(keyword_list, country, state, category_id, tf.value)
        for result in results:
            result.related_keywords, result.rising_keywords = keyword_planner.expand_related_keywords_explore(
                result.keyword, result.related_keywords, result.rising_keywords, geo, tf.value, category_id,
                target_count=limit or DEFAULT_TARGET_COUNT,
            )
            result.related_keywords = keyword_planner.apply_limit(result.related_keywords, limit)
            result.rising_keywords = keyword_planner.apply_limit(result.rising_keywords, limit)
            result.regional_interest = keyword_planner.apply_limit(result.regional_interest, regional_limit)
        return ExploreResponse(keywords=keyword_list, country=country.upper(), state=state.upper() if state else None,
                                geo=geo, category=Category(cat_slug), category_id=category_id, timeframe=tf, results=results)
    return _handle(_build)


def categories() -> tuple[int, dict]:
    return 200, {
        "categories": [
            {"id": category_id, "name": TOP_LEVEL_CATEGORIES[category_id], "slug": slug}
            for slug, category_id in CATEGORY_SLUG_TO_ID.items()
        ]
    }


def health() -> tuple[int, dict]:
    return 200, {"status": "ok"}
