"""Keyword/trend research: proxies to the standalone google_trends microservice (/google_trends
at the repo root). Not behind this platform's own auth for now (easier to test directly); the
upstream service itself has no auth of its own either.

The Timeframe/ExploreTimeframe values mirror google_trends' own enums (see its app/schemas.py) so
Swagger renders a dropdown here too; kept as a local copy rather than an import since the two
services are deliberately independent code bases.
"""
from enum import Enum

from fastapi import APIRouter, HTTPException, Query

from ..services import google_trends_client as gt

router = APIRouter(prefix="/keyword-trends", tags=["keyword-trends"])

CountryQuery = Query(default=None, min_length=2, max_length=2, description="Two-letter country code, e.g. IN, US")


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


# Mirrors google_trends' dynamically-built Category enum (slugified TOP_LEVEL_CATEGORIES, Google's
# own taxonomy from TrendReq().categories() — see its app/config.py / app/schemas.py).
class Category(str, Enum):
    all_categories = "all_categories"
    arts_and_entertainment = "arts_and_entertainment"
    autos_and_vehicles = "autos_and_vehicles"
    beauty_and_fitness = "beauty_and_fitness"
    books_and_literature = "books_and_literature"
    business_and_industrial = "business_and_industrial"
    computers_and_electronics = "computers_and_electronics"
    finance = "finance"
    food_and_drink = "food_and_drink"
    games = "games"
    health = "health"
    hobbies_and_leisure = "hobbies_and_leisure"
    home_and_garden = "home_and_garden"
    internet_and_telecom = "internet_and_telecom"
    jobs_and_education = "jobs_and_education"
    law_and_government = "law_and_government"
    news = "news"
    online_communities = "online_communities"
    people_and_society = "people_and_society"
    pets_and_animals = "pets_and_animals"
    property = "property"
    reference = "reference"
    science = "science"
    shopping = "shopping"
    sports = "sports"
    travel = "travel"


def _forward(status_code: int, body: dict) -> dict:
    if status_code >= 400:
        raise HTTPException(status_code, body)
    return body


def _call(fn, *args) -> dict:
    try:
        status_code, body = fn(*args)
    except gt.GoogleTrendsUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    return _forward(status_code, body)


@router.get("/trends")
def trends(keyword: str, country: str | None = CountryQuery, timeframe: Timeframe | None = None):
    return _call(gt.trends, keyword, country, timeframe.value if timeframe else None)


@router.get("/related")
def related(keyword: str, country: str | None = CountryQuery, timeframe: Timeframe | None = None, limit: int | None = None):
    return _call(gt.related, keyword, country, timeframe.value if timeframe else None, limit)


@router.get("/planner")
def planner(keyword: str, country: str | None = CountryQuery, timeframe: Timeframe | None = None, limit: int | None = None,
            regional_limit: int | None = None):
    return _call(gt.planner, keyword, country, timeframe.value if timeframe else None, limit, regional_limit)


@router.get("/explore")
def explore(keywords: str, country: str | None = CountryQuery, state: str | None = None, category: Category | None = None,
            timeframe: ExploreTimeframe | None = None, limit: int | None = None, regional_limit: int | None = None):
    return _call(gt.explore, keywords, country, state, category.value if category else None, timeframe.value if timeframe else None, limit, regional_limit)


@router.get("/categories")
def categories():
    return _call(gt.categories)


@router.get("/health")
def health():
    return _call(gt.health)
