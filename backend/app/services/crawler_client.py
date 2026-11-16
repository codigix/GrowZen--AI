"""Client for our own deployed backlink crawler (CRAWLER_URL + CRAWLER_API_KEY).

Reads only what the crawler has stored. A missing setting or an unreachable crawler raises CrawlerError with the reason;
nothing is ever invented."""
from typing import Any
from urllib.parse import quote

import httpx

from ..config import get_settings


class CrawlerError(Exception):
    pass


def _client() -> httpx.Client:
    s = get_settings()
    if not s.crawler_enabled:
        raise CrawlerError("The backlink crawler is not set up: add CRAWLER_URL and CRAWLER_API_KEY to the backend settings.")
    key = s.crawler_api_key.strip()
    header = s.crawler_auth_header.strip() or "X-API-Key"
    value = f"Bearer {key}" if header.lower() == "authorization" else key
    return httpx.Client(base_url=s.crawler_url.strip().rstrip("/"), headers={header: value}, timeout=s.crawler_timeout_seconds)


def _call(method: str, path: str, **kw: Any) -> Any:
    try:
        with _client() as c:
            r = c.request(method, path, **kw)
    except httpx.HTTPError as exc:
        raise CrawlerError(f"The backlink crawler could not be reached: {exc.__class__.__name__}") from exc
    if r.status_code in (401, 403):
        raise CrawlerError("The backlink crawler refused the API key (check CRAWLER_API_KEY and CRAWLER_AUTH_HEADER).")
    if r.status_code >= 400:
        raise CrawlerError(f"The backlink crawler answered {r.status_code}: {r.text[:200]}")
    return r.json()


def normalize_domain(value: str) -> str:
    """A domain or URL reduced to its host without www. Raises ValueError for anything that is not a domain."""
    import re
    from urllib.parse import urlsplit
    raw = (value or "").strip().lower()
    host = (urlsplit(raw if "://" in raw else f"//{raw}").hostname or "").strip(".")
    host = host[4:] if host.startswith("www.") else host
    if len(host) > 253 or not re.fullmatch(r"([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", host):
        raise ValueError("not a domain")
    return host


def _d(domain: str) -> str:
    return quote(domain.strip().lower(), safe=".-")


def backlinks(domain: str, *, include_removed: bool = False, limit: int = 100, offset: int = 0):
    return _call("GET", f"/backlinks/{_d(domain)}", params={"include_removed": include_removed, "limit": limit, "offset": offset})


def referring_domains(domain: str):
    return _call("GET", f"/backlinks/{_d(domain)}/referring-domains")


def anchors(domain: str):
    return _call("GET", f"/backlinks/{_d(domain)}/anchors")


def history(domain: str, limit: int = 200):
    return _call("GET", f"/backlinks/{_d(domain)}/history", params={"limit": limit})


def discovery_status():
    return _call("GET", "/discovery/status")


def discovery_statistics():
    return _call("GET", "/discovery/statistics")


def global_status():
    return _call("GET", "/crawler/global-status")


def seed(urls: list[str]):
    return _call("POST", "/crawler/seed", json={"urls": urls})
