"""Real research data for the workflow, never invented:

    google_results(q)      Google results through Serper (when SERPER_API_KEY is set): top pages, People-Also-Ask, related searches
    competitor_pages(...)  the title and H1-H3 headings of the top result pages (fetched safely; the business's own site is skipped)
    keyword_metrics(...)   average monthly searches from Google Keyword Planner (when Google Ads is configured)

Each answer says whether it is available; when it is not, the stages must say so instead of guessing.
"""
from __future__ import annotations

import html
import logging
import re
from urllib.parse import urlparse

import httpx

from ...config import get_settings

log = logging.getLogger("seo.workflow.research")
_SKIP_HOSTS = ("youtube.com", "facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", "pinterest.", "reddit.com", "quora.com")


def _host(url: str) -> str:
    return (urlparse(url).hostname or "").lower().removeprefix("www.")


def google_results(q: str, country: str | None = "IN") -> dict:
    key = get_settings().serper_api_key.strip()
    if not key:
        return {"available": False, "note": "Google results are not available (no SERPER_API_KEY on the server)."}
    try:
        r = httpx.post("https://google.serper.dev/search", headers={"X-API-KEY": key, "Content-Type": "application/json"},
                       json={"q": q, "num": 10, "gl": (country or "in").lower()}, timeout=20)
        if r.status_code >= 400:
            why = ("the Serper account has no credits left (top it up at serper.dev)" if "credit" in r.text.lower() else
                   "the Serper key was refused (check SERPER_API_KEY)" if r.status_code in (401, 403) else
                   "the Serper search quota is used up for now" if r.status_code == 429 else f"the Google results service answered {r.status_code}")
            return {"available": False, "note": f"Google results are not available: {why}. No search data or competitor pages were used."}
        d = r.json()
    except (httpx.HTTPError, ValueError) as exc:
        return {"available": False, "note": f"Google results could not be read ({type(exc).__name__}); no search data was used."}
    organic = [{"position": x.get("position"), "title": html.unescape(x.get("title") or ""), "url": x.get("link") or "", "snippet": html.unescape(x.get("snippet") or "")}
               for x in (d.get("organic") or [])[:10] if x.get("link")]
    return {
        "available": True, "query": q, "country": (country or "in").upper(),
        "organic": organic,
        "paa": [x.get("question") for x in (d.get("peopleAlsoAsk") or []) if x.get("question")][:8],
        "related": [x.get("query") for x in (d.get("relatedSearches") or []) if x.get("query")][:10],
    }


def _headings(page: str) -> tuple[str, list[str], int]:
    title = html.unescape(re.sub(r"\s+", " ", (re.search(r"<title[^>]*>(.*?)</title>", page, re.S | re.I) or [None, ""])[1])).strip()
    body = re.sub(r"<(script|style|noscript|svg)[\s\S]*?</\1>", " ", page, flags=re.I)
    heads = []
    for lvl, inner in re.findall(r"<h([1-3])\b[^>]*>([\s\S]*?)</h\1>", body, re.I):
        t = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", inner))).strip()
        if 3 <= len(t) <= 140 and t not in heads:
            heads.append(f"H{lvl}: {t}")
    words = len(html.unescape(re.sub(r"<[^>]+>", " ", body)).split())
    return title, heads[:25], words


def competitor_pages(serp: dict, own_site: str | None, limit: int = 3) -> dict:
    """Title, headings and word count of the top result pages (only from real results; nothing when there are none)."""
    if not serp or not serp.get("available"):
        return {"available": False, "note": "No competitor pages were analysed: Google results were not available.", "results": []}
    from ..net import site_client
    own = _host(own_site or "") if own_site else ""
    picked = [x for x in serp.get("organic") or [] if _host(x["url"]) and _host(x["url"]) != own and not any(s in _host(x["url"]) for s in _SKIP_HOSTS)][:limit]
    out = []
    with site_client(timeout=10) as c:
        for x in picked:
            try:
                r = c.get(x["url"])
                if r.status_code >= 400 or "html" not in r.headers.get("content-type", ""):
                    continue
                title, heads, words = _headings(r.text[:1_500_000])
                if heads:
                    out.append({"url": x["url"], "title": title or x["title"], "headings": heads, "words": words, "position": x.get("position")})
            except Exception as exc:  # noqa: BLE001 - one unreadable page never stops the research
                log.info("Competitor page not read %s: %s", x["url"], exc)
    if not out:
        return {"available": False, "note": "The top result pages could not be read, so no competitor pages were analysed.", "results": []}
    return {"available": True, "results": out, "note": f"{len(out)} top Google result page(s) read for their headings."}


def keyword_metrics(keywords: list[str]) -> dict:
    """{available, volumes: {keyword: monthly searches}} from Google Keyword Planner only."""
    from .. import articles as svc
    try:
        vols = svc.planner_volumes(keywords)
    except Exception as exc:  # noqa: BLE001
        log.info("Keyword Planner volumes not available: %s", exc)
        vols = {}
    if not vols:
        return {"available": False, "volumes": {}, "note": "Google Keyword Planner returned no search volumes; none are shown."}
    return {"available": True, "volumes": {k: v for k, v in vols.items() if v is not None}, "note": "Average monthly searches from Google Keyword Planner."}
