"""Thin, isolated wrapper around the unofficial ``pytrends`` client.

Every call to Google Trends goes through this module so the rest of the
app never touches ``pytrends`` directly. That keeps the (unofficial, can
break at any time) data provider swappable later without touching the
API or the keyword-planner logic.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

import pandas as pd

from ..config import EXPLORE_TIMEFRAME_MAP, TIMEFRAME_MAP, settings
from .cache import TTLCache
from .exceptions import InvalidTrendsRequestError, TrendsUnavailableError

logger = logging.getLogger("google_trends.client")

_cache = TTLCache(ttl_seconds=settings.cache_ttl_seconds)
_request_lock = threading.Lock()
_last_request_at = 0.0


def _throttle() -> None:
    """Serialize and space out requests -- pytrends has no official rate limit,
    but hitting Google too fast from one process reliably triggers 429s."""
    global _last_request_at
    with _request_lock:
        wait = settings.min_request_interval_seconds - (time.monotonic() - _last_request_at)
        if wait > 0:
            time.sleep(wait)
        _last_request_at = time.monotonic()


def _build_client():
    try:
        from pytrends.request import TrendReq
    except ImportError as exc:  # pragma: no cover - exercised only if dependency missing
        raise TrendsUnavailableError(
            "The pytrends library is not installed. Run `pip install -r requirements.txt`."
        ) from exc

    return TrendReq(
        hl=settings.default_language,
        tz=settings.timezone_offset_minutes,
        timeout=(settings.request_timeout_seconds, settings.request_timeout_seconds),
        retries=0,  # we handle retries ourselves so we control backoff/logging
    )


def _resolve_timeframe(timeframe: str) -> str:
    try:
        return TIMEFRAME_MAP[timeframe]
    except KeyError as exc:
        raise InvalidTrendsRequestError(
            f"Unsupported timeframe '{timeframe}'. Valid values: {', '.join(TIMEFRAME_MAP)}"
        ) from exc


def _resolve_explore_timeframe(timeframe: str) -> str:
    try:
        return EXPLORE_TIMEFRAME_MAP[timeframe]
    except KeyError as exc:
        raise InvalidTrendsRequestError(
            f"Unsupported timeframe '{timeframe}'. Valid values: {', '.join(EXPLORE_TIMEFRAME_MAP)}"
        ) from exc


def _with_retries(label: str, fn, *args, **kwargs) -> Any:
    last_exc: Exception | None = None
    for attempt in range(settings.max_retries + 1):
        try:
            _throttle()
            return fn(*args, **kwargs)
        except InvalidTrendsRequestError:
            raise
        except Exception as exc:  # noqa: BLE001 - pytrends raises assorted/undocumented errors
            last_exc = exc
            logger.warning("Google Trends request failed (%s) attempt %s/%s: %s",
                            label, attempt + 1, settings.max_retries + 1, exc)
            if attempt < settings.max_retries:
                time.sleep(settings.retry_backoff_seconds * (attempt + 1))
    raise TrendsUnavailableError(
        f"Google Trends did not respond for '{label}' after {settings.max_retries + 1} attempt(s)."
    ) from last_exc


def _cache_key(*parts: str) -> str:
    return "|".join(parts)


def fetch_interest_over_time(keyword: str, country: str, timeframe: str) -> pd.DataFrame:
    key = _cache_key("iot", keyword.lower(), country.upper(), timeframe)
    cached = _cache.get(key)
    if cached is not None:
        return cached

    geo = country.upper()
    tf = _resolve_timeframe(timeframe)

    def _call() -> pd.DataFrame:
        client = _build_client()
        client.build_payload([keyword], cat=0, timeframe=tf, geo=geo, gprop="")
        return client.interest_over_time()

    df = _with_retries(f"interest_over_time:{keyword}", _call)
    _cache.set(key, df)
    return df


def fetch_related_queries(keyword: str, country: str, timeframe: str) -> dict:
    key = _cache_key("related", keyword.lower(), country.upper(), timeframe)
    cached = _cache.get(key)
    if cached is not None:
        return cached

    geo = country.upper()
    tf = _resolve_timeframe(timeframe)

    def _call() -> dict:
        client = _build_client()
        client.build_payload([keyword], cat=0, timeframe=tf, geo=geo, gprop="")
        return client.related_queries()

    result = _with_retries(f"related_queries:{keyword}", _call)
    _cache.set(key, result)
    return result or {}


def fetch_interest_by_region(keyword: str, country: str, timeframe: str) -> pd.DataFrame:
    key = _cache_key("region", keyword.lower(), country.upper(), timeframe)
    cached = _cache.get(key)
    if cached is not None:
        return cached

    geo = country.upper()
    tf = _resolve_timeframe(timeframe)

    def _call() -> pd.DataFrame:
        client = _build_client()
        client.build_payload([keyword], cat=0, timeframe=tf, geo=geo, gprop="")
        return client.interest_by_region(resolution="REGION", inc_low_vol=True, inc_geo_code=False)

    df = _with_retries(f"interest_by_region:{keyword}", _call)
    _cache.set(key, df)
    return df


def fetch_interest_over_time_multi(keywords: list[str], geo: str, timeframe: str, category: int = 0) -> pd.DataFrame:
    """Like fetch_interest_over_time, but for up to MAX_EXPLORE_KEYWORDS
    keywords at once and an arbitrary geo (country or country-state) and
    category, as used by /api/keywords/explore."""
    key = _cache_key("iot_multi", ",".join(k.lower() for k in keywords), geo.upper(), timeframe, str(category))
    cached = _cache.get(key)
    if cached is not None:
        return cached

    tf = _resolve_explore_timeframe(timeframe)

    def _call() -> pd.DataFrame:
        client = _build_client()
        client.build_payload(keywords, cat=category, timeframe=tf, geo=geo, gprop="")
        return client.interest_over_time()

    df = _with_retries(f"interest_over_time_multi:{keywords}", _call)
    _cache.set(key, df)
    return df


def fetch_related_queries_multi(keywords: list[str], geo: str, timeframe: str, category: int = 0) -> dict:
    key = _cache_key("related_multi", ",".join(k.lower() for k in keywords), geo.upper(), timeframe, str(category))
    cached = _cache.get(key)
    if cached is not None:
        return cached

    tf = _resolve_explore_timeframe(timeframe)

    def _call() -> dict:
        client = _build_client()
        client.build_payload(keywords, cat=category, timeframe=tf, geo=geo, gprop="")
        return client.related_queries()

    result = _with_retries(f"related_queries_multi:{keywords}", _call)
    _cache.set(key, result)
    return result or {}


def fetch_interest_by_region_multi(keywords: list[str], geo: str, timeframe: str, category: int = 0) -> pd.DataFrame:
    key = _cache_key("region_multi", ",".join(k.lower() for k in keywords), geo.upper(), timeframe, str(category))
    cached = _cache.get(key)
    if cached is not None:
        return cached

    tf = _resolve_explore_timeframe(timeframe)
    resolution = "REGION" if "-" not in geo else "CITY"

    def _call() -> pd.DataFrame:
        client = _build_client()
        client.build_payload(keywords, cat=category, timeframe=tf, geo=geo, gprop="")
        return client.interest_by_region(resolution=resolution, inc_low_vol=True, inc_geo_code=False)

    df = _with_retries(f"interest_by_region_multi:{keywords}", _call)
    _cache.set(key, df)
    return df


def clear_cache() -> None:
    _cache.clear()
