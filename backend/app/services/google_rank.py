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


DEVICES = ("desktop", "mobile", "tablet")
_device_cache: dict[tuple, tuple[float, dict]] = {}


def device_positions(db: Session, b: Business, keywords: list[str], days: int = DAYS) -> dict[str, Any]:
    """How the tracked keywords do on each device, from Search Console (the same 28-day average position, split by desktop / mobile / tablet).
    {devices: {device: {keywords, impressions, clicks, ctr, position}}, keywords: {keyword: {device: position}}, days}. Cached for ten minutes."""
    import time
    host = host_of(b.website)
    if not host:
        raise RankCheckError("Add the project's website first: positions are read from its Search Console property.")
    state, message, sc, site = gsc_access.search_console(db, b, host)
    if state != "ok":
        raise RankCheckError(message)
    end = date.today() - timedelta(days=gsc.LAG_DAYS)
    start = end - timedelta(days=days - 1)
    key = (b.id, site, start, end, tuple(sorted(norm(k) for k in keywords)))
    hit = _device_cache.get(key)
    if hit and time.time() - hit[0] < 600:
        return hit[1]
    try:
        rows = sc.query(site, gsc._body(start, end, ["query", "device"], 25000, market.serp_country(b)))
    except Exception as exc:  # noqa: BLE001
        raise RankCheckError(str(exc)) from exc
    wanted = {norm(k): k for k in keywords}
    per_device: dict[str, dict[str, Any]] = {d: {"imp": 0.0, "pos": 0.0, "clicks": 0, "kws": set()} for d in DEVICES}
    per_keyword: dict[str, dict[str, dict[str, float]]] = {}
    for r in rows:
        q, dev = norm((r.get("keys") or ["", ""])[0]), str((r.get("keys") or ["", ""])[1]).lower()
        if q not in wanted or dev not in per_device:
            continue
        imp = float(r.get("impressions") or 0)
        if imp <= 0:
            continue
        d = per_device[dev]
        d["imp"] += imp
        d["pos"] += float(r.get("position") or 0) * imp
        d["clicks"] += int(r.get("clicks") or 0)
        d["kws"].add(q)
        per_keyword.setdefault(wanted[q], {})[dev] = {"position": round(float(r.get("position") or 0), 1), "impressions": int(imp), "clicks": int(r.get("clicks") or 0)}
    devices = {dev: {"keywords": len(d["kws"]), "impressions": int(d["imp"]), "clicks": d["clicks"], "ctr": round(d["clicks"] / d["imp"] * 100, 2) if d["imp"] else None,
                     "position": round(d["pos"] / d["imp"], 1) if d["imp"] else None} for dev, d in per_device.items()}
    out = {"devices": devices, "keywords": per_keyword, "days": days, "country": market.serp_country(b)}
    _device_cache[key] = (time.time(), out)
    return out


_kw_cache: dict[tuple, tuple[float, dict]] = {}


def keyword_report(db: Session, b: Business, keyword: str, days: int = 180) -> dict[str, Any]:
    """Everything Search Console knows about one search: per day (clicks, impressions, click rate, average position), per page, per device and per country, for the last `days` days
    and the same number before them (to show growth). Google's own figures, not kept. Cached for ten minutes."""
    import time  # noqa: PLC0415
    host = host_of(b.website)
    if not host:
        raise RankCheckError("Add the project's website first: positions are read from its Search Console property.")
    state, message, sc, site = gsc_access.search_console(db, b, host)
    if state != "ok":
        raise RankCheckError(message)
    q = norm(keyword)
    end = date.today() - timedelta(days=gsc.LAG_DAYS)
    start = end - timedelta(days=days * 2 - 1)
    key = (b.id, site, q, end, days)
    hit = _kw_cache.get(key)
    if hit and time.time() - hit[0] < 600:
        return hit[1]

    def ask(dims: list[str], limit: int = 5000, since: date = start) -> list[dict[str, Any]]:
        body = {"startDate": since.isoformat(), "endDate": end.isoformat(), "dimensions": dims, "rowLimit": limit, "dataState": "final",
                "dimensionFilterGroups": [{"groupType": "and", "filters": [{"dimension": "query", "operator": "equals", "expression": q}]}]}
        try:
            return sc.query(site, body)
        except Exception as exc:  # noqa: BLE001
            raise RankCheckError(str(exc)) from exc

    def agg(rows: list[dict[str, Any]], pick) -> dict[str, float]:
        imp = sum(float(r.get("impressions") or 0) for r in rows)
        clk = sum(float(r.get("clicks") or 0) for r in rows)
        pos = sum(float(r.get("position") or 0) * float(r.get("impressions") or 0) for r in rows)
        return {"impressions": int(imp), "clicks": int(clk), "ctr": round(clk * 100 / imp, 2) if imp else None, "position": round(pos / imp, 1) if imp else None}

    daily = ask(["date"])
    cut = (end - timedelta(days=days - 1)).isoformat()
    series = [{"day": r["keys"][0], "clicks": int(r.get("clicks") or 0), "impressions": int(r.get("impressions") or 0), "ctr": round(float(r.get("ctr") or 0) * 100, 2), "position": round(float(r.get("position") or 0), 1)}
              for r in sorted(daily, key=lambda r: r["keys"][0])]
    now_rows = [r for r in daily if r["keys"][0] >= cut]
    before_rows = [r for r in daily if r["keys"][0] < cut]
    pages = [{"page": r["keys"][0], "clicks": int(r.get("clicks") or 0), "impressions": int(r.get("impressions") or 0), "ctr": round(float(r.get("ctr") or 0) * 100, 2), "position": round(float(r.get("position") or 0), 1)}
             for r in sorted(ask(["page"], 100, date.fromisoformat(cut)), key=lambda r: -float(r.get("impressions") or 0))]
    devices = [{"device": str(r["keys"][0]).lower(), "clicks": int(r.get("clicks") or 0), "impressions": int(r.get("impressions") or 0), "ctr": round(float(r.get("ctr") or 0) * 100, 2), "position": round(float(r.get("position") or 0), 1)}
               for r in sorted(ask(["device"], 10, date.fromisoformat(cut)), key=lambda r: -float(r.get("impressions") or 0))]
    countries = [{"country": str(r["keys"][0]).upper(), "clicks": int(r.get("clicks") or 0), "impressions": int(r.get("impressions") or 0), "ctr": round(float(r.get("ctr") or 0) * 100, 2), "position": round(float(r.get("position") or 0), 1)}
                 for r in sorted(ask(["country"], 25, date.fromisoformat(cut)), key=lambda r: -float(r.get("impressions") or 0))]
    out = {"days": days, "from": cut, "to": end.isoformat(), "series": [s for s in series if s["day"] >= cut], "now": agg(now_rows, None), "before": agg(before_rows, None),
           "pages": pages, "devices": devices, "countries": countries}
    _kw_cache[key] = (time.time(), out)
    return out
