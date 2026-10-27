from __future__ import annotations

import re
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field

from .config import TOP_LEVEL_CATEGORIES


def _slugify(name: str) -> str:
    slug = name.lower().replace("&", "and")
    slug = re.sub(r"[^a-z0-9]+", "_", slug).strip("_")
    return slug


# Built from the live Google Trends category taxonomy (see TOP_LEVEL_CATEGORIES)
# so Swagger renders a dropdown of real, human-readable category names instead
# of a free-typed integer id. A str Enum (like Timeframe/ExploreTimeframe
# below) is what makes FastAPI/Swagger show readable values in the dropdown.
Category = Enum(  # type: ignore[misc]
    "Category",
    {_slugify(name): _slugify(name) for name in TOP_LEVEL_CATEGORIES.values()},
    type=str,
)
CATEGORY_SLUG_TO_ID: dict[str, int] = {_slugify(name): category_id for category_id, name in TOP_LEVEL_CATEGORIES.items()}

DATA_SOURCE = "Google Trends (unofficial pytrends client)"

LIMITATIONS: list[str] = [
    "Google Trends scores are normalized relative search-interest values (0-100), not absolute search volume.",
    "pytrends is an unofficial client; Google may rate-limit, throttle, or change its response format without notice.",
    "No search volume, keyword difficulty, CPC, paid-ad competition, or ranking-position data is provided by this source.",
]


class Timeframe(str, Enum):
    past_day = "past_day"
    past_7_days = "past_7_days"
    past_30_days = "past_30_days"
    past_90_days = "past_90_days"
    past_12_months = "past_12_months"


class ExploreTimeframe(str, Enum):
    past_hour = "past_hour"
    past_four_hours = "past_four_hours"
    past_24_hours = "past_24_hours"
    past_week = "past_week"
    past_month = "past_month"
    past_3_months = "past_3_months"
    past_year = "past_year"
    past_5_years = "past_5_years"


class InterestPoint(BaseModel):
    date: str
    value: Optional[int] = None
    is_partial: bool = False


class TrendSummary(BaseModel):
    latest_score: Optional[int] = None
    average_score: Optional[float] = None
    change_percent: Optional[float] = None
    classification: Optional[Literal["rising", "stable", "declining"]] = None
    classification_basis: str = Field(
        description="Explains whether the classification is a calculated interpretation or unavailable."
    )


class InterestOverTimeResponse(BaseModel):
    seed_keyword: str
    country: str
    timeframe: Timeframe
    interest_over_time: list[InterestPoint]
    trend_summary: TrendSummary
    data_source: str = DATA_SOURCE
    limitations: list[str] = Field(default_factory=lambda: list(LIMITATIONS))


class RelatedKeyword(BaseModel):
    keyword: str
    score: Optional[int] = None
    growth_indicator: Optional[str] = None
    source_type: Literal["top", "rising", "breakout"]


class RelatedKeywordsResponse(BaseModel):
    seed_keyword: str
    country: str
    timeframe: Timeframe
    related_keywords: list[RelatedKeyword]
    rising_keywords: list[RelatedKeyword]
    data_source: str = DATA_SOURCE
    limitations: list[str] = Field(default_factory=lambda: list(LIMITATIONS))


class RegionalInterest(BaseModel):
    region: str
    country: str
    score: int


class PlannerResponse(BaseModel):
    seed_keyword: str
    country: str
    timeframe: Timeframe
    trend_summary: TrendSummary
    interest_over_time: list[InterestPoint]
    related_keywords: list[RelatedKeyword]
    rising_keywords: list[RelatedKeyword]
    candidate_keywords: list[str]
    regional_interest: list[RegionalInterest]
    data_source: str = DATA_SOURCE
    limitations: list[str] = Field(default_factory=lambda: list(LIMITATIONS))


class KeywordExploreResult(BaseModel):
    keyword: str
    trend_summary: TrendSummary
    interest_over_time: list[InterestPoint]
    related_keywords: list[RelatedKeyword]
    rising_keywords: list[RelatedKeyword]
    regional_interest: list[RegionalInterest]


class ExploreResponse(BaseModel):
    keywords: list[str]
    country: str
    state: Optional[str] = None
    geo: str
    category: Category
    category_id: int
    timeframe: ExploreTimeframe
    results: list[KeywordExploreResult]
    data_source: str = DATA_SOURCE
    limitations: list[str] = Field(default_factory=lambda: list(LIMITATIONS))


class ErrorResponse(BaseModel):
    detail: str
