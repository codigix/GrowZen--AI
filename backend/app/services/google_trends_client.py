"""HTTP client for the google_trends microservice.

That service lives in its own top-level folder (/google_trends), with its own venv, port
(default 8010) and tests, and is deliberately kept out of this codebase so it can be run,
restarted and debugged on its own: `cd google_trends && uvicorn app.main:app --port 8010`.
This module is the only place in the backend that knows its base URL / endpoint shapes.
"""
import httpx

from ..config import get_settings


class GoogleTrendsUnavailable(Exception):
    """Raised when the google_trends service can't be reached at all (down, wrong URL, timeout)."""


def _get(path: str, params: dict) -> tuple[int, dict]:
    settings = get_settings()
    clean_params = {k: v for k, v in params.items() if v is not None}
    try:
        resp = httpx.get(f"{settings.google_trends_base_url}{path}", params=clean_params, timeout=settings.google_trends_timeout_seconds)
    except httpx.RequestError as exc:
        raise GoogleTrendsUnavailable(f"google_trends service unreachable at {settings.google_trends_base_url}: {exc}") from exc
    try:
        body = resp.json()
    except ValueError:
        body = {"detail": resp.text}
    return resp.status_code, body


def trends(keyword: str, country: str | None = None, timeframe: str | None = None) -> tuple[int, dict]:
    return _get("/api/keywords/trends", {"keyword": keyword, "country": country, "timeframe": timeframe})


def related(keyword: str, country: str | None = None, timeframe: str | None = None, limit: int | None = None) -> tuple[int, dict]:
    return _get("/api/keywords/related", {"keyword": keyword, "country": country, "timeframe": timeframe, "limit": limit})


def planner(keyword: str, country: str | None = None, timeframe: str | None = None, limit: int | None = None, regional_limit: int | None = None) -> tuple[int, dict]:
    return _get("/api/keywords/planner", {"keyword": keyword, "country": country, "timeframe": timeframe, "limit": limit, "regional_limit": regional_limit})


def explore(keywords: str, country: str | None = None, state: str | None = None, category: str | None = None,
            timeframe: str | None = None, limit: int | None = None, regional_limit: int | None = None) -> tuple[int, dict]:
    return _get("/api/keywords/explore", {"keywords": keywords, "country": country, "state": state, "category": category,
                                           "timeframe": timeframe, "limit": limit, "regional_limit": regional_limit})


def categories() -> tuple[int, dict]:
    return _get("/api/keywords/categories", {})


def health() -> tuple[int, dict]:
    return _get("/health", {})
