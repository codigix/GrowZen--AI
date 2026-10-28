from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from ..config import MAX_EXPLORE_KEYWORDS, TOP_LEVEL_CATEGORIES, settings
from ..schemas import (
    CATEGORY_SLUG_TO_ID,
    Category,
    ExploreResponse,
    ExploreTimeframe,
    InterestOverTimeResponse,
    PlannerResponse,
    RelatedKeywordsResponse,
    Timeframe,
)
from ..services import keyword_planner
from ..services.exceptions import InvalidTrendsRequestError, TrendsUnavailableError

logger = logging.getLogger("google_trends.api")

router = APIRouter(prefix="/api/keywords", tags=["keywords"])

KeywordQuery = Query(..., min_length=2, max_length=100, description="Seed keyword to research")
CountryQuery = Query(default=settings.default_country, min_length=2, max_length=2,
                      description="Two-letter country code, e.g. IN, US")
TimeframeQuery = Query(default=Timeframe.past_7_days, description="Lookback window")
DEFAULT_TARGET_COUNT = 50  # related/rising keywords aimed for per list when `limit` isn't given

LimitQuery = Query(default=None, ge=1, le=DEFAULT_TARGET_COUNT,
                    description="Max related/rising keywords to return per list and candidates to expand. "
                                "A single Google Trends call returns at most ~25 per list (often fewer); beyond "
                                f"that, extra related keywords are fetched as additional seeds and merged in to "
                                f"approach this count. Leave empty to aim for {DEFAULT_TARGET_COUNT}.")
RegionalLimitQuery = Query(default=None, ge=1, le=500,
                            description="Max regions to return, ranked by score descending. Unlike related/rising "
                                        "keywords, Google Trends doesn't cap this, so set it as high as you need.")


@router.get("/trends", response_model=InterestOverTimeResponse)
def get_trends(keyword: str = KeywordQuery, country: str = CountryQuery,
               timeframe: Timeframe = TimeframeQuery) -> InterestOverTimeResponse:
    try:
        points, summary = keyword_planner.build_interest_over_time(keyword, country, timeframe.value)
    except InvalidTrendsRequestError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except TrendsUnavailableError as exc:
        logger.error("Google Trends unavailable for /trends: %s", exc)
        raise HTTPException(status_code=503, detail="Google Trends is temporarily unavailable. Please try again shortly.") from exc

    return InterestOverTimeResponse(
        seed_keyword=keyword,
        country=country.upper(),
        timeframe=timeframe,
        interest_over_time=points,
        trend_summary=summary,
    )


@router.get("/related", response_model=RelatedKeywordsResponse)
def get_related(keyword: str = KeywordQuery, country: str = CountryQuery,
                 timeframe: Timeframe = TimeframeQuery, limit: int | None = LimitQuery) -> RelatedKeywordsResponse:
    try:
        top, rising = keyword_planner.build_related_keywords_expanded(keyword, country, timeframe.value,
                                                                        target_count=limit or DEFAULT_TARGET_COUNT)
    except InvalidTrendsRequestError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except TrendsUnavailableError as exc:
        logger.error("Google Trends unavailable for /related: %s", exc)
        raise HTTPException(status_code=503, detail="Google Trends is temporarily unavailable. Please try again shortly.") from exc

    return RelatedKeywordsResponse(
        seed_keyword=keyword,
        country=country.upper(),
        timeframe=timeframe,
        related_keywords=keyword_planner.apply_limit(top, limit),
        rising_keywords=keyword_planner.apply_limit(rising, limit),
    )


@router.get("/planner", response_model=PlannerResponse)
def get_planner(keyword: str = KeywordQuery, country: str = CountryQuery,
                 timeframe: Timeframe = TimeframeQuery, limit: int | None = LimitQuery,
                 regional_limit: int | None = RegionalLimitQuery) -> PlannerResponse:
    try:
        points, summary = keyword_planner.build_interest_over_time(keyword, country, timeframe.value)
        top, rising = keyword_planner.build_related_keywords_expanded(keyword, country, timeframe.value,
                                                                        target_count=limit or DEFAULT_TARGET_COUNT)
        regional = keyword_planner.build_regional_interest(keyword, country, timeframe.value)
        candidates = keyword_planner.expand_candidate_keywords(keyword, top, rising, max_candidates=limit)
    except InvalidTrendsRequestError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except TrendsUnavailableError as exc:
        logger.error("Google Trends unavailable for /planner: %s", exc)
        raise HTTPException(status_code=503, detail="Google Trends is temporarily unavailable. Please try again shortly.") from exc

    return PlannerResponse(
        seed_keyword=keyword,
        country=country.upper(),
        timeframe=timeframe,
        trend_summary=summary,
        interest_over_time=points,
        related_keywords=keyword_planner.apply_limit(top, limit),
        rising_keywords=keyword_planner.apply_limit(rising, limit),
        candidate_keywords=candidates,
        regional_interest=keyword_planner.apply_limit(regional, regional_limit),
    )


def _parse_keywords(raw: str) -> list[str]:
    keywords = [k.strip() for k in raw.split(",") if k.strip()]
    if not keywords:
        raise HTTPException(status_code=422, detail="At least one keyword is required.")
    if len(keywords) > MAX_EXPLORE_KEYWORDS:
        raise HTTPException(
            status_code=422,
            detail=f"Google Trends supports comparing at most {MAX_EXPLORE_KEYWORDS} keywords at once.",
        )
    for kw in keywords:
        if len(kw) < 2 or len(kw) > 100:
            raise HTTPException(status_code=422, detail=f"Keyword '{kw}' must be 2-100 characters long.")
    return keywords


@router.get("/explore", response_model=ExploreResponse)
def get_explore(
    keywords: str = Query(..., description="One or more keywords, comma-separated (max "
                                             f"{MAX_EXPLORE_KEYWORDS}), e.g. 'seo audit,seo tool'"),
    country: str = CountryQuery,
    state: str | None = Query(default=None, min_length=1, max_length=10,
                               description="Optional ISO 3166-2 region code without the country prefix, "
                                           "e.g. 'KA' for Karnataka, 'DL' for Delhi"),
    category: Category = Query(default=Category.all_categories,
                                description="Google Trends category (real taxonomy pulled from Google itself)"),
    timeframe: ExploreTimeframe = Query(default=ExploreTimeframe.past_week,
                                         description="Lookback window, matching Google Trends Explore's own options"),
    limit: int | None = LimitQuery,
    regional_limit: int | None = RegionalLimitQuery,
) -> ExploreResponse:
    keyword_list = _parse_keywords(keywords)
    category_id = CATEGORY_SLUG_TO_ID[category.value]

    try:
        geo, results = keyword_planner.build_explore_report(keyword_list, country, state, category_id, timeframe.value)
    except InvalidTrendsRequestError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except TrendsUnavailableError as exc:
        logger.error("Google Trends unavailable for /explore: %s", exc)
        raise HTTPException(status_code=503, detail="Google Trends is temporarily unavailable. Please try again shortly.") from exc

    for result in results:
        result.related_keywords, result.rising_keywords = keyword_planner.expand_related_keywords_explore(
            result.keyword, result.related_keywords, result.rising_keywords, geo, timeframe.value, category_id,
            target_count=limit or DEFAULT_TARGET_COUNT,
        )
        result.related_keywords = keyword_planner.apply_limit(result.related_keywords, limit)
        result.rising_keywords = keyword_planner.apply_limit(result.rising_keywords, limit)
        result.regional_interest = keyword_planner.apply_limit(result.regional_interest, regional_limit)

    return ExploreResponse(
        keywords=keyword_list,
        country=country.upper(),
        state=state.upper() if state else None,
        geo=geo,
        category=category,
        category_id=category_id,
        timeframe=timeframe,
        results=results,
    )


@router.get("/categories")
def get_categories() -> dict:
    """Lists the top-level Google Trends categories this API accepts for the
    `category` parameter on /explore, straight from Google's own taxonomy."""
    return {
        "categories": [
            {"id": category_id, "name": TOP_LEVEL_CATEGORIES[category_id], "slug": slug}
            for slug, category_id in CATEGORY_SLUG_TO_ID.items()
        ]
    }
