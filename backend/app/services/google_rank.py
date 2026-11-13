"""Where the site ranks on Google, read from Google itself (no search-result scraping, no third party):

- Organic position: Google Search Console. For every tracked keyword, the average position the site's pages had in Google Search over the last 28 days, with the clicks and
  impressions behind it and the page that ranked. A keyword with no impressions in that time is "not shown on Google yet". It is Google's own figure, so it is an AVERAGE over the
  days, not the result of one search made right now.
- Maps position: the Google Places API (New), asked for the same search around the business's pin; the business's rank is its place in Google's own order.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any

from sqlalchemy.orm import Session

from ..models import Business
from . import gsc, gsc_access, market

DAYS = 28


class RankCheckError(RuntimeError):
    pass


def host_of(url: str | None) -> str:
    return gsc.host_of(url)


def norm(q: str | None) -> str:
    return re.sub(r"\s+", " ", (q or "").lower()).strip()


def organic_positions(db: Session, b: Business, keywords: list[str], days: int = DAYS) -> dict[str, dict[str, Any]]:
    """{keyword: {position, clicks, impressions, url, pages, days}} for the tracked keywords Search Console has data for. Raises RankCheckError (with the reason) when Search Console cannot be read."""
    host = host_of(b.website)
    if not host:
        raise RankCheckError("Add the project's website first: positions are read from its Search Console property.")
    state, message, sc, site = gsc_access.search_console(db, b, host)
    if state != "ok":
        raise RankCheckError(message)
    end = date.today() - timedelta(days=gsc.LAG_DAYS)
    start = end - timedelta(days=days - 1)
    try:
        rows = sc.query(site, gsc._body(start, end, ["query", "page"], 25000, market.serp_country(b)))
    except Exception as exc:  # noqa: BLE001 - the reason (API not enabled, no permission) is Google's own message
        raise RankCheckError(str(exc)) from exc
    wanted = {norm(k): k for k in keywords}
    agg: dict[str, dict[str, Any]] = {}
    for r in rows:
        q = norm((r.get("keys") or [""])[0])
        if q not in wanted:
            continue
        imp = float(r.get("impressions") or 0)
        d = agg.setdefault(wanted[q], {"imp": 0.0, "pos_x_imp": 0.0, "clicks": 0, "pages": []})
        d["imp"] += imp
        d["pos_x_imp"] += float(r.get("position") or 0) * imp
        d["clicks"] += int(r.get("clicks") or 0)
        d["pages"].append({"page": (r.get("keys") or ["", ""])[1], "impressions": int(imp), "clicks": int(r.get("clicks") or 0), "position": round(float(r.get("position") or 0), 1)})
    out: dict[str, dict[str, Any]] = {}
    for k, d in agg.items():
        if d["imp"] <= 0:
            continue
        pages = sorted(d["pages"], key=lambda p: (-p["impressions"], p["position"]))
        out[k] = {"position": round(d["pos_x_imp"] / d["imp"], 1), "clicks": d["clicks"], "impressions": int(d["imp"]), "url": pages[0]["page"], "pages": [p["page"] for p in pages[:10]], "days": days}
    return out


def maps_results(b: Business, keyword: str, radius_m: float = 5000.0) -> list[dict[str, Any]]:
    """Google Maps results for the search, around the business's pin when it has one (Places API, Google's own order)."""
    from ..competitors import service
    return service.places_search(keyword, market.serp_country(b) or "IN", getattr(b, "lat", None), getattr(b, "lng", None), radius_m)


def maps_enabled() -> bool:
    from ..competitors import service
    return service.competitors_enabled()
