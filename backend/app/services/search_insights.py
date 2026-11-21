"""Search and visitor insights: what Google Search Console and Google Analytics 4 know about the site that a crawl and a rank tracker cannot see, and what they say together.

Every figure is read from Google for the project's own site; nothing is estimated. A source that is not connected, or a report Google does not offer through an API, is said so plainly.

  Search Console: queries nobody tracks yet, click-through rate against the usual rate for the position, index breakdown by Google's own reason, sitemap health, rich results seen by Google,
                  real-user speed (Chrome field data, through PageSpeed).
  Analytics 4:    engagement and conversions per landing page for organic search, channels per landing page, key events and other events, devices and cities, new against returning.
  Together:       pages with many impressions and few clicks, pages that bring visitors who do not engage or convert, indexed pages nobody sees or visits, and what changed in clicks after
                  the AI changes were applied.
"""
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import AgentTask, Business, IndexPage, Keyword
from . import gsc, gsc_access

log = logging.getLogger("seo.insights")

DAYS = 90
# The usual share of searchers who click at each Google position (a published industry average, only used to spot pages that earn clearly less than usual)
EXPECTED_CTR = {1: 0.28, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.07, 6: 0.05, 7: 0.04, 8: 0.035, 9: 0.03, 10: 0.025, 11: 0.015, 12: 0.012}
STANDARD_EVENTS = {"page_view", "session_start", "first_visit", "user_engagement", "scroll", "view_search_results"}
NOT_AVAILABLE = [
    {"item": "Manual actions and security issues", "why": "Google shows these only inside Search Console and offers no API for them.", "where": "Search Console > Security & Manual Actions"},
    {"item": "Search Console's backlink report", "why": "Google offers no API for its links report. Backlink Intelligence finds backlinks with our own bot instead.", "where": "Backlink Intelligence"},
    {"item": "Funnels and cohort retention", "why": "Analytics 4 builds these in Explorations, which its reporting API does not return. New against returning visitors is shown instead.", "where": "Analytics > Explore"},
    {"item": "Predictive metrics and consent-mode modeling", "why": "Analytics 4 shows modeled and predictive figures only in its own screens, and only when the property is eligible.", "where": "Analytics > Reports"},
]

_cache: dict[tuple, tuple[float, Any]] = {}


def path_of(url: str | None) -> str:
    p = urlsplit(url or "").path or "/"
    return p if p == "/" else p.rstrip("/")


def _part(fn, *a) -> dict[str, Any]:
    try:
        return {"state": "ok", **fn(*a)}
    except Exception as exc:  # noqa: BLE001 - one report Google refuses must not hide the others
        return {"state": "error", "message": str(exc)[:240]}


def expected_ctr(position: float) -> float:
    return EXPECTED_CTR.get(max(1, min(12, round(position))), 0.01)


# ------------------------------------------------------------------ Search Console
def _rows(sc: gsc.SearchConsole, site: str, start: date, end: date, dim: str, limit: int = 1000) -> list[dict[str, Any]]:
    return [{"key": r["keys"][0], "clicks": int(r["clicks"]), "impressions": int(r["impressions"]), "ctr": r["ctr"], "position": r["position"]}
            for r in sc.query(site, gsc._body(start, end, [dim], limit))]


def untracked_queries(db: Session, b: Business, queries: list[dict[str, Any]]) -> dict[str, Any]:
    """What people really searched to see the site, that is not in the project's keywords: new keywords that already work."""
    tracked = {k.lower().strip() for k in db.scalars(select(Keyword.keyword).where(Keyword.business_id == b.id))}
    rows = [q for q in queries if q["key"].lower().strip() not in tracked]
    rows.sort(key=lambda q: (-q["impressions"], -q["clicks"]))
    return {"total": len(queries), "untracked": len(rows),
            "rows": [{"query": q["key"], "impressions": q["impressions"], "clicks": q["clicks"], "ctr": round(q["ctr"] * 100, 2), "position": round(q["position"], 1)} for q in rows[:25]]}


def low_ctr(rows: list[dict[str, Any]], what: str) -> list[dict[str, Any]]:
    """Positions 3 to 12 with real impressions where the click-through rate is clearly below the usual rate for that position: the title and description are what to rewrite."""
    out = []
    floor = 100 if what == "query" else 150
    for r in rows:
        pos = r["position"]
        if not (3 <= pos <= 12.5) or r["impressions"] < floor:
            continue
        exp = expected_ctr(pos)
        if r["ctr"] >= exp * 0.6:
            continue
        lost = round(r["impressions"] * exp - r["clicks"])
        out.append({what: r["key"], "impressions": r["impressions"], "clicks": r["clicks"], "ctr": round(r["ctr"] * 100, 2), "expected_ctr": round(exp * 100, 1), "position": round(pos, 1), "clicks_missing": max(lost, 0)})
    return sorted(out, key=lambda x: -x["clicks_missing"])[:15]


def index_breakdown(db: Session, b: Business) -> dict[str, Any]:
    pages = list(db.scalars(select(IndexPage).where(IndexPage.business_id == b.id)))
    if not pages:
        return {"total": 0, "message": "No pages are listed yet: open Page indexing and press Scan."}
    from collections import Counter
    reasons = Counter((p.g_reason or "").strip() for p in pages if p.g_state)
    states = Counter(p.g_state or "unchecked" for p in pages)
    tech = Counter((p.tech or {}).get("verdict") or "unchecked" for p in pages)
    return {"total": len(pages), "states": dict(states), "tech": dict(tech),
            "reasons": [{"reason": k or "No reason given", "pages": v, "example": next((p.url for p in pages if (p.g_reason or "").strip() == k and p.g_state), None)} for k, v in reasons.most_common(12)],
            "unchecked": states.get("unchecked", 0)}


def sitemap_health(sc: gsc.SearchConsole, site: str) -> dict[str, Any]:
    out = []
    for s in sc.sitemaps(site):
        sub = sum(int(c.get("submitted") or 0) for c in s.get("contents") or [])
        out.append({"path": s.get("path"), "submitted": sub, "errors": int(s.get("errors") or 0), "warnings": int(s.get("warnings") or 0), "pending": bool(s.get("isPending")),
                    "last_submitted": s.get("lastSubmitted"), "last_read": s.get("lastDownloaded")})
    return {"sitemaps": out, "message": None if out else "Google knows no sitemap for this property. Submit it in Search Console (Sitemaps)."}


def rich_results(sc: gsc.SearchConsole, site: str, pages: list[str]) -> dict[str, Any]:
    """What Google itself detected as structured data on the busiest pages (URL Inspection): which types are valid and which have errors or warnings."""
    def one(url: str) -> dict[str, Any]:
        try:
            r = (sc.inspect(site, url).get("inspectionResult") or {}).get("richResultsResult") or {}
        except Exception as exc:  # noqa: BLE001
            return {"url": url, "error": str(exc)[:160]}
        types = []
        for d in r.get("detectedItems") or []:
            issues = [i for it in d.get("items") or [] for i in it.get("issues") or []]
            types.append({"type": d.get("richResultType"), "items": len(d.get("items") or []), "errors": sum(1 for i in issues if i.get("severity") == "ERROR"),
                          "warnings": sum(1 for i in issues if i.get("severity") == "WARNING"),
                          "message": next((i.get("issueMessage") for i in issues), None)})
        return {"url": url, "verdict": r.get("verdict") or "NONE", "types": types}
    with ThreadPoolExecutor(max_workers=4) as pool:
        rows = list(pool.map(one, pages[:6]))
    return {"pages": rows}


def field_speed(url: str) -> dict[str, Any]:
    """Real visitors' Largest Contentful Paint, Interaction to Next Paint and Layout Shift on the site (Chrome user experience data, through PageSpeed Insights), mobile and desktop."""
    from . import pagespeed

    def one(strategy: str) -> dict[str, Any]:
        d = pagespeed.fetch(url, strategy)
        names = {"lcp": "LARGEST_CONTENTFUL_PAINT_MS", "inp": "INTERACTION_TO_NEXT_PAINT", "cls": "CUMULATIVE_LAYOUT_SHIFT_SCORE"}

        def pick(block: dict[str, Any]) -> dict[str, Any] | None:
            m = (block or {}).get("metrics") or {}
            if not m:
                return None
            return {k: {"p75": (m.get(v) or {}).get("percentile"), "rating": (m.get(v) or {}).get("category")} for k, v in names.items() if m.get(v)} | {"overall": block.get("overall_category")}
        return {"page": pick(d.get("loadingExperience")), "site": pick(d.get("originLoadingExperience"))}
    with ThreadPoolExecutor(max_workers=2) as pool:
        mobile, desktop = pool.map(one, ("mobile", "desktop"))
    have = any(x for r in (mobile, desktop) for x in r.values())
    return {"mobile": mobile, "desktop": desktop, "message": None if have else "Google has no real-visitor data for this site yet: it needs enough Chrome visitors over 28 days."}


def search_console_block(db: Session, b: Business) -> tuple[dict[str, Any], dict[str, Any]]:
    """(the Search Console sections, the raw rows the joined view needs)"""
    host = gsc.host_of(b.website)
    if not host:
        return {"state": "no_website", "message": "Add the project's website first."}, {}
    state, msg, sc, site = gsc_access.search_console(db, b, host)
    if state != "ok":
        return {"state": state, "message": msg}, {}
    end = date.today() - timedelta(days=gsc.LAG_DAYS)
    start = end - timedelta(days=DAYS - 1)
    with ThreadPoolExecutor(max_workers=2) as pool:
        fq, fp = pool.submit(_safe_rows, sc, site, start, end, "query"), pool.submit(_safe_rows, sc, site, start, end, "page")
    queries, pages = fq.result(), fp.result()
    out: dict[str, Any] = {"state": "ok", "account": msg, "property": site, "period": {"start": start.isoformat(), "end": end.isoformat(), "days": DAYS}}
    top_pages = [p["key"] for p in sorted(pages or [], key=lambda p: -p["clicks"])[:5]] or [f"https://{host}/"]
    out["untracked"] = _part(lambda: untracked_queries(db, b, queries)) if queries is not None else {"state": "error", "message": "Search Console did not return the queries."}
    out["low_ctr_pages"] = {"state": "ok", "rows": low_ctr(pages, "page")} if pages is not None else {"state": "error", "message": "Search Console did not return the pages."}
    out["low_ctr_queries"] = {"state": "ok", "rows": low_ctr(queries, "query")} if queries is not None else {"state": "error", "message": "Search Console did not return the queries."}
    out["index"] = _part(index_breakdown, db, b)
    out["sitemaps"] = _part(sitemap_health, sc, site)
    out["rich_results"] = _part(rich_results, sc, site, top_pages)
    return out, {"pages": pages or [], "queries": queries or [], "sc": sc, "site": site}


def _safe_rows(sc, site, start, end, dim):
    try:
        return _rows(sc, site, start, end, dim)
    except Exception as exc:  # noqa: BLE001
        log.info("Search Console %s rows failed: %s", dim, exc)
        return None


# ------------------------------------------------------------------ Analytics 4
def _organic() -> dict[str, Any]:
    return {"filter": {"fieldName": "sessionDefaultChannelGroup", "stringFilter": {"matchType": "EXACT", "value": "Organic Search"}}}


def _ga_body(start: date, end: date, metrics: list[str], dims: list[str], limit: int, organic: bool = False, order: str | None = None) -> dict[str, Any]:
    body = {"dateRanges": [{"startDate": start.isoformat(), "endDate": end.isoformat()}], "metrics": [{"name": m} for m in metrics], "dimensions": [{"name": d} for d in dims], "limit": limit}
    if organic:
        body["dimensionFilter"] = _organic()
    if order:
        body["orderBys"] = [{"metric": {"metricName": order}, "desc": True}]
    return body


def analytics_block(db: Session, user: Any, b: Business) -> tuple[dict[str, Any], dict[str, Any]]:
    from fastapi import HTTPException

    from .. import access
    from . import ga4
    try:
        props = access.ga4_properties(db, user, b)
    except HTTPException as exc:
        d = exc.detail
        return {"state": "not_connected", "message": (d.get("message") if isinstance(d, dict) else str(d)) or "Connect Google Analytics 4 for this site first."}, {}
    except Exception as exc:  # noqa: BLE001
        return {"state": "error", "message": str(exc)[:240]}, {}
    if not props:
        return {"state": "not_connected", "message": "No Analytics 4 property measures this site yet."}, {}
    try:
        ga = ga4.Ga4(b.connection)
    except ga4.Ga4Error as exc:
        return {"state": "error", "message": str(exc)}, {}
    prop = props[0]["property"]
    end = datetime.now(ga.timezone(prop)).date() - timedelta(days=1)
    start = end - timedelta(days=DAYS - 1)
    run = lambda body: ga.run(prop, body)  # noqa: E731
    metrics = ["sessions", "engagementRate", "bounceRate", "userEngagementDuration", "keyEvents"]
    jobs = {
        "landing": lambda: run(_ga_body(start, end, metrics, ["landingPage"], 250, True, "sessions")),
        "channels": lambda: run(_ga_body(start, end, ["sessions", "keyEvents"], ["landingPage", "sessionDefaultChannelGroup"], 400, False, "sessions")),
        "events": lambda: run(_ga_body(start, end, ["eventCount", "keyEvents"], ["eventName"], 100, False, "eventCount")),
        "devices": lambda: run(_ga_body(start, end, metrics, ["deviceCategory"], 10, False, "sessions")),
        "cities": lambda: run(_ga_body(start, end, metrics, ["city"], 12, False, "sessions")),
        "returning": lambda: run(_ga_body(start, end, ["activeUsers", "engagementRate", "keyEvents"], ["newVsReturning"], 5, False, "activeUsers")),
    }
    got: dict[str, Any] = {}
    errors: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        futs = {k: pool.submit(fn) for k, fn in jobs.items()}
        for k, f in futs.items():
            try:
                got[k] = f.result()
            except Exception as exc:  # noqa: BLE001
                got[k], errors[k] = [], str(exc)[:200]

    def eng(r: dict[str, Any]) -> dict[str, Any]:
        s = r.get("sessions") or 0
        return {"sessions": s, "engagement_rate": round((r.get("engagementRate") or 0) * 100, 1), "bounce_rate": round((r.get("bounceRate") or 0) * 100, 1),
                "avg_engagement_seconds": round((r.get("userEngagementDuration") or 0) / s, 1) if s else 0, "key_events": r.get("keyEvents") or 0,
                "conversion_rate": round((r.get("keyEvents") or 0) * 100 / s, 1) if s else 0}
    landing = [{"path": path_of(r["landingPage"]), **eng(r)} for r in got["landing"] if r.get("landingPage") not in (None, "(not set)")]
    by_page: dict[str, dict[str, Any]] = {}
    for r in got["channels"]:
        p = by_page.setdefault(path_of(r["landingPage"]), {"path": path_of(r["landingPage"]), "total": 0, "channels": {}})
        p["total"] += r["sessions"]
        p["channels"][r["sessionDefaultChannelGroup"]] = p["channels"].get(r["sessionDefaultChannelGroup"], 0) + r["sessions"]
    channels = sorted(by_page.values(), key=lambda p: -p["total"])[:15]
    for p in channels:
        p["channels"] = [{"channel": k, "sessions": v, "share": round(v * 100 / p["total"])} for k, v in sorted(p["channels"].items(), key=lambda kv: -kv[1])[:4]]
    events = [{"event": r["eventName"], "count": r["eventCount"], "key_event": bool(r["keyEvents"]), "standard": r["eventName"] in STANDARD_EVENTS} for r in got["events"]]
    out = {"state": "ok", "property": prop, "property_name": props[0].get("name"), "period": {"start": start.isoformat(), "end": end.isoformat(), "days": DAYS}, "errors": errors,
           "landing_pages": {"rows": landing[:25]}, "landing_channels": {"rows": channels},
           "events": {"key": [e for e in events if e["key_event"]], "other": [e for e in events if not e["key_event"] and not e["standard"]][:12],
                      "message": None if any(e["key_event"] for e in events) else "No key events are marked in this property: mark the ones that matter (form sent, call click, booking) as key events in Analytics, then conversions show here."},
           "devices": {"rows": [{"device": r["deviceCategory"], **eng(r)} for r in got["devices"]]},
           "cities": {"rows": [{"city": r["city"], **eng(r)} for r in got["cities"] if r["city"] != "(not set)"]},
           "returning": {"rows": [{"kind": r["newVsReturning"], "users": r["activeUsers"], "engagement_rate": round((r["engagementRate"] or 0) * 100, 1), "key_events": r["keyEvents"]} for r in got["returning"] if r["newVsReturning"] in ("new", "returning")]}}
    return out, {"landing": landing, "ga": ga, "prop": prop}


# ------------------------------------------------------------------ joined
def joined(db: Session, b: Business, gs: dict[str, Any], ga: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    pages = {path_of(p["key"]): p for p in gs.get("pages", [])}
    landing = {r["path"]: r for r in ga.get("landing", [])}
    if landing:
        weak = []
        for path, r in landing.items():
            if r["sessions"] < 20:
                continue
            reasons = []
            if r["engagement_rate"] < 40:
                reasons.append(f"only {r['engagement_rate']}% of visits engage")
            if r["sessions"] >= 50 and r["key_events"] == 0:
                reasons.append("no conversion at all")
            if reasons:
                g = pages.get(path)
                weak.append({"path": path, "organic_sessions": r["sessions"], "engagement_rate": r["engagement_rate"], "key_events": r["key_events"], "avg_engagement_seconds": r["avg_engagement_seconds"],
                             "google_clicks": g["clicks"] if g else None, "why": "; ".join(reasons), "fix": "The ranking works, the page does not: check that it answers the search, and put a clear call to action near the top."})
        out["engagement_gaps"] = {"state": "ok", "rows": sorted(weak, key=lambda x: -x["organic_sessions"])[:12]}
    else:
        out["engagement_gaps"] = {"state": "needs_both", "message": "Needs Analytics 4 and Search Console together."}
    rows = list(db.scalars(select(IndexPage).where(IndexPage.business_id == b.id, IndexPage.g_state == "indexed")))
    if rows and gs.get("pages") is not None and gs:
        zombies = []
        for p in rows:
            path = path_of(p.url)
            g = pages.get(path)
            if (g and g["impressions"] > 0) or (landing.get(path) or {}).get("sessions"):
                continue
            zombies.append({"url": p.url, "path": path, "last_crawl": p.g_last_crawl.isoformat() if p.g_last_crawl else None})
        known = "and no Analytics visits" if landing else "(Analytics is not connected, so visits are not checked)"
        out["zombies"] = {"state": "ok", "rows": zombies[:20], "count": len(zombies), "of": len(rows), "basis": f"Indexed by Google, no impressions in {DAYS} days {known}.",
                          "fix": "Improve the page, merge it into a stronger one, or remove it: pages nobody sees weigh on the site's quality."}
    else:
        out["zombies"] = {"state": "needs_data", "message": "Needs the indexed pages (Page indexing, Google check) and Search Console."}
    out["changes"] = _before_after(db, b, gs)
    return out


def _before_after(db: Session, b: Business, gs: dict[str, Any]) -> dict[str, Any]:
    """Clicks, click-through rate and position in the 14 days before the latest batch of applied AI changes, against the 14 days after (once those days exist)."""
    sc, site = gs.get("sc"), gs.get("site")
    applied = list(db.scalars(select(AgentTask).where(AgentTask.business_id == b.id, AgentTask.status == "applied", AgentTask.applied_at.is_not(None)).order_by(AgentTask.applied_at.desc())))
    if not applied:
        return {"state": "none", "message": "No AI change has been applied yet, so there is nothing to compare. Approve changes in the AI Agent, then this shows what happened to clicks."}
    latest = applied[0].applied_at
    anchor = (latest if latest.tzinfo else latest.replace(tzinfo=timezone.utc)).date()
    batch = [t for t in applied if abs((t.applied_at.date() - anchor).days) <= 3]
    need = anchor + timedelta(days=14 + gsc.LAG_DAYS)
    if date.today() < need:
        return {"state": "early", "applied": len(applied), "batch": len(batch), "anchor": anchor.isoformat(), "ready_on": need.isoformat(),
                "message": f"{len(batch)} AI changes were applied on {anchor.isoformat()}. Google's data lags two days: the 14-day comparison is ready on {need.isoformat()}."}
    if not sc:
        return {"state": "needs_search_console", "message": "Search Console is needed to compare clicks."}
    try:
        def tot(s: date, e: date) -> dict[str, Any]:
            r = (sc.query(site, gsc._body(s, e, None, 1)) or [{}])[0]
            return {"clicks": int(r.get("clicks", 0)), "impressions": int(r.get("impressions", 0)), "ctr": round(r.get("ctr", 0) * 100, 2), "position": round(r.get("position", 0), 1) or None}
        before, after = tot(anchor - timedelta(days=14), anchor - timedelta(days=1)), tot(anchor + timedelta(days=1), anchor + timedelta(days=14))
    except Exception as exc:  # noqa: BLE001
        return {"state": "error", "message": str(exc)[:200]}
    delta = lambda k: (round((after[k] - before[k]) * 100 / before[k], 1) if before[k] else None)  # noqa: E731
    return {"state": "ok", "applied": len(applied), "batch": len(batch), "anchor": anchor.isoformat(), "before": before, "after": after,
            "change": {"clicks": delta("clicks"), "impressions": delta("impressions")},
            "note": "Other things also move clicks (season, new pages, ranking changes): read this as a signal, not proof."}


# ------------------------------------------------------------------ the report
def build(db: Session, user: Any, b: Business, refresh: bool = False) -> dict[str, Any]:
    key = (b.id, b.connection_id, b.website)
    hit = _cache.get(key)
    if hit and not refresh and time.time() - hit[0] < 900:
        return hit[1]
    gs_out, gs_raw = search_console_block(db, b)
    ga_out, ga_raw = analytics_block(db, user, b)
    out = {"search_console": gs_out, "analytics": ga_out, "joined": joined(db, b, gs_raw, {"landing": ga_raw.get("landing", [])}) if (gs_raw or ga_raw) else {}, "not_available": NOT_AVAILABLE,
           "built_at": datetime.now(timezone.utc).isoformat(), "website": b.website}
    _cache[key] = (time.time(), out)
    return out


def speed(b: Business, refresh: bool = False) -> dict[str, Any]:
    """Real-visitor speed: slow to read (two PageSpeed runs), so it is its own call and cached for six hours."""
    url = b.website if (b.website or "").startswith("http") else f"https://{b.website}"
    key = ("speed", url)
    hit = _cache.get(key)
    if hit and not refresh and time.time() - hit[0] < 6 * 3600:
        return hit[1]
    out = _part(field_speed, url) | {"url": url}
    if out["state"] == "ok":
        _cache[key] = (time.time(), out)
    return out
