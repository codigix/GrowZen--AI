"""Runtime configuration for the Google Trends keyword planner service.

Kept as a plain dataclass (no extra dependency) so the module stays
self-contained inside the ``google_trends`` folder.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _load_dotenv() -> None:
    """Minimal .env loader so GOOGLE_TRENDS_* vars can be set without an
    extra dependency. Reads the single .env shared by the whole repo (one
    level above this folder). Does not override variables already set in
    the environment."""
    env_path = Path(__file__).resolve().parent.parent.parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key and key not in os.environ:
            os.environ[key] = value.strip()


_load_dotenv()


def _split_origins(raw: str) -> list[str]:
    if raw.strip() == "*":
        return ["*"]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


@dataclass(frozen=True)
class Settings:
    default_country: str = field(
        default_factory=lambda: os.getenv("GOOGLE_TRENDS_DEFAULT_COUNTRY", "IN")
    )
    default_language: str = field(
        default_factory=lambda: os.getenv("GOOGLE_TRENDS_DEFAULT_LANGUAGE", "en-IN")
    )
    timezone_offset_minutes: int = field(
        default_factory=lambda: int(os.getenv("GOOGLE_TRENDS_TZ_OFFSET_MINUTES", "330"))
    )
    request_timeout_seconds: float = field(
        default_factory=lambda: float(os.getenv("GOOGLE_TRENDS_REQUEST_TIMEOUT_SECONDS", "10"))
    )
    max_retries: int = field(
        default_factory=lambda: int(os.getenv("GOOGLE_TRENDS_MAX_RETRIES", "3"))
    )
    retry_backoff_seconds: float = field(
        default_factory=lambda: float(os.getenv("GOOGLE_TRENDS_RETRY_BACKOFF_SECONDS", "5"))
    )
    cache_ttl_seconds: int = field(
        default_factory=lambda: int(os.getenv("GOOGLE_TRENDS_CACHE_TTL_SECONDS", "1800"))
    )
    min_request_interval_seconds: float = field(
        default_factory=lambda: float(os.getenv("GOOGLE_TRENDS_MIN_REQUEST_INTERVAL_SECONDS", "4.0"))
    )
    max_expansion_candidates: int = field(
        default_factory=lambda: int(os.getenv("GOOGLE_TRENDS_MAX_EXPANSION_CANDIDATES", "8"))
    )
    cors_origins: list[str] = field(
        default_factory=lambda: _split_origins(os.getenv("GOOGLE_TRENDS_CORS_ORIGINS", "*"))
    )


settings = Settings()

TIMEFRAME_MAP: dict[str, str] = {
    "past_day": "now 1-d",
    "past_7_days": "now 7-d",
    "past_30_days": "today 1-m",
    "past_90_days": "today 3-m",
    "past_12_months": "today 12-m",
}

# Mirrors the options Google's own Trends "Explore" UI exposes, for the
# /api/keywords/explore endpoint.
EXPLORE_TIMEFRAME_MAP: dict[str, str] = {
    "past_hour": "now 1-H",
    "past_four_hours": "now 4-H",
    "past_24_hours": "now 1-d",
    "past_week": "now 7-d",
    "past_month": "today 1-m",
    "past_3_months": "today 3-m",
    "past_year": "today 12-m",
    "past_5_years": "today 5-y",
}

MAX_EXPLORE_KEYWORDS = 5

# Top-level Google Trends categories, pulled from pytrends' TrendReq().categories()
# (the live taxonomy Google itself serves) rather than guessed at.
TOP_LEVEL_CATEGORIES: dict[int, str] = {
    0: "All categories",
    3: "Arts & Entertainment",
    47: "Autos & Vehicles",
    44: "Beauty & Fitness",
    22: "Books & Literature",
    12: "Business & Industrial",
    5: "Computers & Electronics",
    7: "Finance",
    71: "Food & Drink",
    8: "Games",
    45: "Health",
    65: "Hobbies & Leisure",
    11: "Home & Garden",
    13: "Internet & Telecom",
    958: "Jobs & Education",
    19: "Law & Government",
    16: "News",
    299: "Online Communities",
    14: "People & Society",
    66: "Pets & Animals",
    29: "Property",
    533: "Reference",
    174: "Science",
    18: "Shopping",
    20: "Sports",
    67: "Travel",
}

MIN_POINTS_FOR_CLASSIFICATION = 4
