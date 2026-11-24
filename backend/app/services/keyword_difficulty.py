"""SEO difficulty of one keyword, from what Google really shows for it.

The top 10 results of a Google search (and the "People also ask", related searches and ads on the page) come from Apify's Google Search scraper; Domain Authority, home-page Page
Authority, referring domains and spam score of each of those sites come from Moz through Apify (saved for a day, so a site is never paid for twice). Nothing is estimated: a site
Apify has no figures for is left out of the averages and said so.

Score (0-100, higher = harder), the parts of the formula we can measure:
    Authority_Strength      = mean(average DA, average PA, referring domains on a log scale)
    SERP_Feature_Competition = share of the SERP features we can see (ads, People also ask, AI overview) that are on the page
    Top10_Strength          = share of the top 10 sites with a Domain Authority of 70 or more
    SC = 0.50 * Authority_Strength + 0.25 * SERP_Feature_Competition + 0.25 * Top10_Strength
SV (search volume on a log scale against VOLUME_BENCHMARK) is returned beside it. BQ, CC and KI need page-by-page scoring that is not built, so they are not part of the score.
"""
from __future__ import annotations

import logging
import math
import time
from typing import Any
from urllib.parse import urlsplit

import httpx

from . import apify_metrics, countries

log = logging.getLogger("seo.difficulty")
SERP_ACTOR = "apify~google-search-scraper"
SERP_URL = f"https://api.apify.com/v2/acts/{SERP_ACTOR}/run-sync-get-dataset-items"
VOLUME_BENCHMARK = 100_000  # searches a month that count as 100 on the volume scale
RD_TOP = 1_000_000  # referring domains that count as 100 on the log scale
STRONG_DA = 70
TTL = 24 * 3600
_cache: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}
_TWO_PART = {"co", "com", "org", "net", "gov", "ac", "edu"}


class DifficultyError(Exception):
    pass


def site_of(url: str) -> str:
    host = (urlsplit(url).hostname or "").lower().removeprefix("www.")
    parts = host.split(".")
    if len(parts) >= 3 and parts[-2] in _TWO_PART and len(parts[-1]) == 2:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def serp(keyword: str, country: str) -> dict[str, Any]:
    """What Google shows for the keyword: {organic: [{position, title, url, site, description}], questions, related, ads: [{title, url, description}], ai_overview}. Kept for a day."""
    key = (keyword, country.upper())
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < TTL:
        return hit[1]
    tokens = [t for _i, t in apify_metrics.keys()]
    if not tokens:
        raise DifficultyError("Apify is not connected (APIFY_KEY): the Google results cannot be read.")
    last = ""
    for tok in tokens:
        try:
            r = httpx.post(SERP_URL, params={"token": tok}, json={"queries": keyword, "countryCode": countries.gl(country).lower(), "languageCode": "en", "maxPagesPerQuery": 1,
                                                                   "resultsPerPage": 10, "mobileResults": False}, timeout=180)
        except httpx.HTTPError as exc:
            last = f"Apify could not be reached ({type(exc).__name__})."
            continue
        if r.status_code in (200, 201) and isinstance(r.json(), list) and r.json():
            item = r.json()[0]
            out = {
                "organic": [{"position": o.get("position"), "title": o.get("title") or "", "url": o.get("url") or "", "site": site_of(o.get("url") or ""), "description": (o.get("description") or "")[:200]}
                            for o in (item.get("organicResults") or []) if o.get("url")][:10],
                "questions": [p.get("question") for p in (item.get("peopleAlsoAsk") or []) if p.get("question")],
                "related": [(q.get("title") if isinstance(q, dict) else str(q)) for q in (item.get("relatedQueries") or [])],
                "ads": [{"title": a.get("title") or "", "url": a.get("url") or a.get("displayedUrl") or "", "site": site_of(a.get("url") or a.get("displayedUrl") or ""), "description": (a.get("description") or "")[:240]}
                        for a in (item.get("paidResults") or [])],
                "ai_overview": bool(item.get("aiOverview")),
            }
            _cache[key] = (time.time(), out)
            return out
        last = f"Apify answered {r.status_code}."
    raise DifficultyError(last or "Apify gave no results.")


def _log_scale(v: float, top: float) -> float:
    return min(100.0, 100 * math.log(1 + max(v, 0)) / math.log(1 + top))


def score(keyword: str, country: str, volume: int | None = None) -> dict[str, Any]:
    page = serp(keyword, country)
    sites = list(dict.fromkeys(o["site"] for o in page["organic"] if o["site"]))
    metrics = {x["domain"]: x.get("scores") for x in apify_metrics.check(sites)}
    rows = []
    for o in page["organic"]:
        m = metrics.get(o["site"]) or {}
        rows.append({**o, "da": m.get("da"), "pa": m.get("pa"), "rd": m.get("rd"), "spam": m.get("spam")})
    known = [r for r in rows if r["da"] is not None]
    avg = lambda k: (sum(r[k] for r in known if r[k] is not None) / max(1, sum(1 for r in known if r[k] is not None))) if known else None  # noqa: E731
    da, pa = avg("da"), avg("pa")
    rds = [r["rd"] for r in known if r["rd"] is not None]
    rd_score = sum(_log_scale(x, RD_TOP) for x in rds) / len(rds) if rds else None
    parts = [x for x in (da, pa, rd_score) if x is not None]
    authority = sum(parts) / len(parts) if parts else None
    features = {"Ads": bool(page["ads"]), "People also ask": bool(page["questions"]), "AI overview": page["ai_overview"]}
    feature_comp = 100 * sum(features.values()) / len(features)
    top10 = 100 * sum(1 for r in known if r["da"] >= STRONG_DA) / len(known) if known else None
    sc = round(0.5 * authority + 0.25 * feature_comp + 0.25 * top10) if authority is not None and top10 is not None else None
    return {
        "score": sc, "sites_with_figures": len(known), "sites": len(rows),
        "components": {"authority_strength": round(authority) if authority is not None else None, "avg_da": round(da) if da is not None else None, "avg_pa": round(pa) if pa is not None else None,
                       "median_rd": round(sorted(rds)[len(rds) // 2]) if rds else None, "serp_features": round(feature_comp), "features": features, "top10_strength": round(top10) if top10 is not None else None,
                       "sv": round(_log_scale(volume, VOLUME_BENCHMARK)) if volume else None},
        "organic": rows, "questions": page["questions"], "related": page["related"], "ads": page["ads"],
        "note": "Page Authority is the home page's. Content quality, backlink quality and intent are not part of this score.",
    }
