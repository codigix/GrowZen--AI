"""Thin, isolated wrapper around the unofficial ``pytrends`` client.

Every call to Google Trends goes through this module so the rest of the
app never touches ``pytrends`` directly. That keeps the (unofficial, can
break at any time) data provider swappable later without touching the
API or the keyword-planner logic.
"""

from __future__ import annotations

import datetime
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
_client = None  # lazily-built, reused TrendReq -- see _get_client()


def _throttle() -> None:
    """Serialize and space out requests -- pytrends has no official rate limit,
    but hitting Google too fast from one process reliably triggers 429s."""
    global _last_request_at
    with _request_lock:
        wait = settings.min_request_interval_seconds - (time.monotonic() - _last_request_at)
        if wait > 0:
            time.sleep(wait)
        _last_request_at = time.monotonic()


def _new_client():
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


def _get_client(force_new: bool = False):
    """Returns a shared, cookie-warmed TrendReq client, building it once and reusing it
    across calls. Building a new client fetches a fresh Google NID cookie (an extra
    round-trip on top of the token + data round-trips every pytrends call already makes),
    and churning through fresh cookies on every call makes Google far more likely to flag
    the traffic and 429 it -- which is what was driving the very slow (40-50s) responses:
    each failure fell into the retry/backoff loop below. ``force_new`` rebuilds the client
    (fresh cookie) after a failure, in case the cached one got rate-limited or expired."""
    global _client
    with _request_lock:
        if _client is None or force_new:
            _client = _new_client()
        return _client


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
            return fn(_get_client(force_new=attempt > 0), *args, **kwargs)
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

    def _call(client) -> pd.DataFrame:
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

    def _call(client) -> dict:
        client.build_payload([keyword], cat=0, timeframe=tf, geo=geo, gprop="")
        return client.related_queries()

    result = _with_retries(f"related_queries:{keyword}", _call)
    _cache.set(key, result)
    return result or {}


# Day-counts for each timeframe's previous-period comparison window.
_PERIOD_DAYS: dict[str, int] = {
    "past_day": 1,
    "past_7_days": 7,
    "past_30_days": 30,
    "past_90_days": 90,
    "past_12_months": 365,
}


def _previous_period_range(timeframe: str) -> str | None:
    """Builds an explicit 'YYYY-MM-DD YYYY-MM-DD' range for the period immediately
    preceding ``timeframe`` (same length), so top queries can be compared
    period-over-period the way Google Trends' own UI does. None if ``timeframe``
    is too short to compare this way."""
    days = _PERIOD_DAYS.get(timeframe)
    if not days:
        return None
    today = datetime.date.today()
    end = today - datetime.timedelta(days=days + 1)
    start = end - datetime.timedelta(days=days - 1)
    return f"{start.isoformat()} {end.isoformat()}"


def fetch_related_queries_previous_period(keyword: str, country: str, timeframe: str) -> dict | None:
    """Related queries for the period immediately before ``timeframe``, used to compute
    top queries' period-over-period change. Returns None (no extra request made) when
    ``timeframe`` is too short to compare, or when the request fails -- a missing
    comparison is not worth risking the main request's rate-limit budget."""
    tf = _previous_period_range(timeframe)
    if tf is None:
        return None

    key = _cache_key("related_prev", keyword.lower(), country.upper(), timeframe)
    cached = _cache.get(key)
    if cached is not None:
        return cached

    geo = country.upper()

    def _call(client) -> dict:
        client.build_payload([keyword], cat=0, timeframe=tf, geo=geo, gprop="")
        return client.related_queries()

    try:
        result = _with_retries(f"related_queries_previous_period:{keyword}", _call)
    except TrendsUnavailableError as exc:
        logger.warning("Previous-period related queries unavailable for '%s': %s", keyword, exc)
        return None
    result = result or {}
    _cache.set(key, result)
    return result


def fetch_interest_by_region(keyword: str, country: str, timeframe: str) -> pd.DataFrame:
    key = _cache_key("region", keyword.lower(), country.upper(), timeframe)
    cached = _cache.get(key)
    if cached is not None:
        return cached

    geo = country.upper()
    tf = _resolve_timeframe(timeframe)

    def _call(client) -> pd.DataFrame:
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

    def _call(client) -> pd.DataFrame:
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

    def _call(client) -> dict:
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

    def _call(client) -> pd.DataFrame:
        client.build_payload(keywords, cat=category, timeframe=tf, geo=geo, gprop="")
        return client.interest_by_region(resolution=resolution, inc_low_vol=True, inc_geo_code=False)

    df = _with_retries(f"interest_by_region_multi:{keywords}", _call)
    _cache.set(key, df)
    return df


def clear_cache() -> None:
    _cache.clear()
