"""Organic rankings of one page: how strong its site is, what the page is about, the searches it shows for (measured now) and who it competes with.

Everything is read from a real source at the moment of the request and nothing is kept:
  * the page itself (title, headings, length, links, structured data),
  * Moz through Apify for the site (Domain Authority, referring domains, how many keywords the whole site ranks for),
  * Google Keyword Planner: the searches Google says the page is about (it reads the page) with their searches a month,
  * Google's results: for each of those searches, the top 20 pages with their real addresses, so the page's position and the pages it competes with are measured, not guessed,
  * for a page of the project's own site, Google Search Console: the real searches, clicks and positions, how they moved against the 90 days before, the daily clicks and the site's top pages.
What no source gives (traffic and traffic cost of other sites, history of positions, SERP features per keyword) is not shown.
"""
from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Any
from urllib.parse import urlsplit

from . import apify_metrics
from . import google_ads_client as ads
from . import keyword_difficulty as kd
from . import url_overview as uo
from .providers.base import intent_of

log = logging.getLogger("seo.organic_rankings")
MIN_VOLUME = 10


def _page_filter(body: dict[str, Any], url: str) -> dict[str, Any]:
    body["dimensionFilterGroups"] = [{"groupType": "and", "filters": [{"dimension": "page", "operator": "equals", "expression": url}]}]
    return body


def own_site_data(db, b, url: str) -> dict[str, Any]:
    """For a page of the project's own site: Google Search Console's searches for the page (last 90 days) and how each moved against the 90 days before, the daily clicks, the branded share, and the
    site's top pages. {own: False} for any other site."""
    from . import google_rank, gsc, gsc_access, keyword_workspace  # noqa: PLC0415
    host = google_rank.host_of(b.website)
    if not host or google_rank.host_of(url) != host:
        return {"own": False}
    state, message, sc, site = gsc_access.search_console(db, b, host)
    if state != "ok":
        return {"own": True, "note": message}
    end = date.today() - timedelta(days=gsc.LAG_DAYS)
    cur, prev = (end - timedelta(days=89), end), (end - timedelta(days=179), end - timedelta(days=90))

    def q(window: tuple[date, date], dims: list[str], limit: int, page: str | None) -> list[dict[str, Any]]:
        body = gsc._body(window[0], window[1], dims, limit, None)
        if page:
            _page_filter(body, page)
        return sc.query(site, body)
    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            f_cur, f_prev = pool.submit(q, cur, ["query"], 500, url), pool.submit(q, prev, ["query"], 500, url)
            f_days, f_pages = pool.submit(q, cur, ["date"], 100, url), pool.submit(q, cur, ["page"], 25, None)
            now_rows, before_rows, day_rows, page_rows = f_cur.result(), f_prev.result(), f_days.result(), f_pages.result()
    except Exception as exc:  # noqa: BLE001 -- Google's own message is the reason
        return {"own": True, "note": str(exc)[:200]}
    brand = {w for w in keyword_workspace._brand(b) if len(w) > 3}

    def rows_of(rs: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        return {(r.get("keys") or [""])[0]: {"keyword": (r.get("keys") or [""])[0], "views": int(r.get("impressions") or 0), "clicks": int(r.get("clicks") or 0),
                                              "position": round(float(r.get("position") or 0), 1), "ctr": round(100 * float(r.get("ctr") or 0), 1)} for r in rs}
    now, before = rows_of(now_rows), rows_of(before_rows)
    for k, r in now.items():
        r["branded"] = any(w in k for w in brand)
        r["previous"] = before[k]["position"] if k in before else None
    changes = {
        "new": [r for k, r in now.items() if k not in before],
        "lost": [{**r, "current": None} for k, r in before.items() if k not in now],
        "improved": [r for r in now.values() if r["previous"] is not None and r["position"] < r["previous"] - 0.5],
        "declined": [r for r in now.values() if r["previous"] is not None and r["position"] > r["previous"] + 0.5],
    }
    for lst in changes.values():
        lst.sort(key=lambda r: -r["views"])
    clicks = sum(r["clicks"] for r in now.values())
    views = sum(r["views"] for r in now.values())
    branded_clicks = sum(r["clicks"] for r in now.values() if r["branded"])
    return {"own": True, "note": None if now else "Search Console has no searches for this page in the last 90 days.",
            "rows": sorted(now.values(), key=lambda r: (-r["clicks"], -r["views"]))[:200], "changes": {k: v[:50] for k, v in changes.items()}, "counts": {k: len(v) for k, v in changes.items()},
            "totals": {"keywords": len(now), "clicks": clicks, "views": views, "branded_clicks": branded_clicks, "non_branded_clicks": clicks - branded_clicks},
            "series": [{"date": (r.get("keys") or [""])[0], "clicks": int(r.get("clicks") or 0), "views": int(r.get("impressions") or 0)} for r in sorted(day_rows, key=lambda r: (r.get("keys") or [""])[0])],
            "pages": [{"page": (r.get("keys") or [""])[0], "clicks": int(r.get("clicks") or 0), "views": int(r.get("impressions") or 0)} for r in sorted(page_rows, key=lambda r: -int(r.get("clicks") or 0))][:15]}


def summary(db, b, url: str, keyword: str | None, country: str) -> dict[str, Any]:
    """The quick part: the page, its site's strength, the searches Google says it is about, and (own pages) Search Console. The positions are measured separately, a few at a time."""
    site = kd.site_of(uo._public(url))
    geo = ads.geo_target_for(country)
    with ThreadPoolExecutor(max_workers=4) as pool:
        f_auth = pool.submit(uo.authority, site)
        f_own = pool.submit(own_site_data, db, b, url)
        f_ideas = pool.submit(lambda: ads.keyword_ideas([], limit=300, geo_target=geo, page_url=url))
        page = uo.page_analysis(url)
        try:
            ideas = f_ideas.result()
        except Exception as exc:  # noqa: BLE001 -- without ideas the page's own phrases are used
            log.info("page ideas unavailable: %r", exc)
            ideas = []
        authority, own = f_auth.result(), f_own.result()
    seen: dict[str, dict[str, Any]] = {}
    for i in ideas:
        if (i.get("avg_monthly_searches") or 0) >= MIN_VOLUME:
            seen[i["keyword"].lower()] = {"keyword": i["keyword"].lower(), "volume": i["avg_monthly_searches"], "index": i.get("competition_index"), "cpc": i.get("high_top_of_page_bid"), "source": "Google reads the page"}
    own_phrases = [p for p in uo.phrases(page, keyword) if p not in seen]
    if own_phrases:
        try:
            got = ads.historical_metrics(own_phrases, geo_target=geo)
        except Exception:  # noqa: BLE001 -- the phrases are still listed
            got = {}
        for p in own_phrases:
            m = got.get(p) or {}
            seen[p] = {"keyword": p, "volume": m.get("volume"), "index": m.get("competition_index"), "cpc": m.get("cpc"), "source": "On the page"}
    items = sorted(seen.values(), key=lambda x: -(x["volume"] or 0))[:150]
    for x in items:
        x["intent"] = intent_of(x["keyword"])
    return {"page": page, "site": site, "authority": authority, "country": country, "keywords": items, "search_console": own}


def _norm_hit(o: dict[str, Any], wanted: set[str]) -> bool:
    return uo.norm(o["url"]) in wanted


def positions(url: str, country: str, keywords: list[str], also: str | None = None) -> list[dict[str, Any]]:
    """For each search: the page's position in Google's top 20 (None when it is not there) and the pages that are there, with their real addresses."""
    wanted = {uo.norm(url)} | ({uo.norm(also)} if also else set())

    def one(k: str) -> dict[str, Any]:
        res = kd._lofo(k, country, 20)
        if not res:
            return {"keyword": k, "measured": False, "position": None, "top": []}
        hit = next((o["position"] for o in res if _norm_hit(o, wanted)), None)
        return {"keyword": k, "measured": True, "position": hit, "top": [{"position": o["position"], "site": o["site"], "url": o["url"], "title": o["title"]} for o in res]}
    with ThreadPoolExecutor(max_workers=4) as pool:
        return list(pool.map(one, keywords[:8]))


def authorities(domains: list[str]) -> dict[str, dict[str, Any]]:
    """Domain Authority, referring domains and ranking keywords of a few sites (Moz through Apify), asked afresh."""
    out: dict[str, dict[str, Any]] = {}
    try:
        for x in apify_metrics.lookup(list(dict.fromkeys(domains))[:8]):
            d = str(x.get("domain") or "").lower().removeprefix("www.")
            n = apify_metrics._num
            out[d] = {"da": n(x.get("domain_authority")), "rd": n(x.get("linking_root_domains")), "ranking_keywords": n(x.get("ranking_keywords")), "spam": n(x.get("spam_score"))}
    except apify_metrics.ApifyError as exc:
        log.info("authorities unavailable: %s", exc)
    return out
