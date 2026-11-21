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
import re
from urllib.parse import urljoin, urlsplit

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


def overview(sc: gsc.SearchConsole, site: str, start: date, end: date, queries: list[dict[str, Any]] | None, pages: list[dict[str, Any]] | None) -> dict[str, Any]:
    """The Performance view of Search Console: totals with the change against the period before, the daily series, and the top searches, pages, devices and countries."""
    p_end, p_start = start - timedelta(days=1), start - timedelta(days=DAYS)
    tot = lambda s_, e_: gsc._totals(sc.query(site, gsc._body(s_, e_)))  # noqa: E731
    now, prev = tot(start, end), tot(p_start, p_end)
    by_day = {r["keys"][0]: r for r in sc.query(site, gsc._body(start, end, ["date"], 1000))}
    series, d = [], start
    while d <= end:
        r = by_day.get(d.isoformat())
        series.append({"date": d.isoformat(), "clicks": int(r["clicks"]) if r else 0, "impressions": int(r["impressions"]) if r else 0,
                       "ctr": round(r["ctr"] * 100, 2) if r else 0, "position": round(r["position"], 1) if r else None})
        d += timedelta(days=1)
    row = lambda r, k: {k: r["key"], "clicks": r["clicks"], "impressions": r["impressions"], "ctr": round(r["ctr"] * 100, 2), "position": round(r["position"], 1)}  # noqa: E731
    top = lambda rows, k: [row(r, k) for r in sorted(rows or [], key=lambda r: (-r["clicks"], -r["impressions"]))[:25]]  # noqa: E731
    dev = [{"device": r["keys"][0].lower(), "clicks": int(r["clicks"]), "impressions": int(r["impressions"]), "ctr": round(r["ctr"] * 100, 2), "position": round(r["position"], 1)}
           for r in sc.query(site, gsc._body(start, end, ["device"], 10))]
    ctry = [{"code": gsc.A3.get(r["keys"][0], r["keys"][0].upper()[:2]), "clicks": int(r["clicks"]), "impressions": int(r["impressions"]), "ctr": round(r["ctr"] * 100, 2), "position": round(r["position"], 1)}
            for r in sorted(sc.query(site, gsc._body(start, end, ["country"], 50)), key=lambda r: -r["clicks"])[:8]]
    change = lambda k: (round((now[k] - prev[k]) * 100 / prev[k], 1) if prev.get(k) else None)  # noqa: E731
    return {"totals": now, "previous": prev, "change": {"clicks": change("clicks"), "impressions": change("impressions"), "ctr": None, "position": None},
            "series": series, "queries": top(queries, "query"), "pages": top(pages, "page"), "devices": dev, "countries": ctry}


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
    out["overview"] = _part(overview, sc, site, start, end, queries, pages)
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


def site_analytics_tag(website: str | None) -> str | None:
    """The Google Analytics measurement id (G-XXXX) the website's own pages send data to, read from its home page: it tells which Analytics property must be opened to see this site's visitors."""
    if not website:
        return None
    try:
        from .net import site_client
        client = site_client(10)
        try:
            html = client.get(website if website.startswith("http") else f"https://{website}").text[:200000]
        finally:
            client.close()
    except Exception:  # noqa: BLE001
        return None
    m = re.search(r"googletagmanager\.com/gtag/js\?id=(G-[A-Z0-9]{6,})", html) or re.search(r"[\"']((?:G)-[A-Z0-9]{8,12})[\"']", html)
    return m.group(1) if m else None


def analytics_block(db: Session, user: Any, b: Business) -> tuple[dict[str, Any], dict[str, Any]]:
    from fastapi import HTTPException

    from .. import access
    from . import ga4
    try:
        props = access.ga4_properties(db, user, b)
    except HTTPException as exc:
        d = exc.detail
        todo = [{"label": x.get("label"), "detail": x.get("detail"), "action": (x.get("fix") or {}).get("action"), "url": (x.get("fix") or {}).get("url"), "button": (x.get("fix") or {}).get("label")}
                for x in (d.get("steps") if isinstance(d, dict) else None) or []]
        return {"state": "not_connected", "message": (d.get("message") if isinstance(d, dict) else str(d)) or "Connect Google Analytics 4 for this site first.",
                "steps": todo, "site_tag": site_analytics_tag(b.website)}, {}
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
        "totals": lambda: run(_ga_body(start, end, ["activeUsers", "sessions", "engagementRate", "userEngagementDuration", "keyEvents"], [], 1)),
        "series": lambda: run(_ga_body(start, end, ["sessions", "activeUsers", "keyEvents"], ["date"], 400)),
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
    tr = (got["totals"] or [{}])[0]
    ts = tr.get("sessions") or 0
    totals = {"users": tr.get("activeUsers") or 0, "sessions": ts, "engagement_rate": round((tr.get("engagementRate") or 0) * 100, 1),
              "avg_engagement_seconds": round((tr.get("userEngagementDuration") or 0) / ts, 1) if ts else 0, "key_events": tr.get("keyEvents") or 0}
    day = lambda s_: datetime.strptime(s_, "%Y%m%d").date().isoformat()  # noqa: E731
    series = sorted(({"date": day(r["date"]), "sessions": r["sessions"], "users": r["activeUsers"], "key_events": r["keyEvents"]} for r in got["series"]), key=lambda x: x["date"])
    out = {"state": "ok", "totals": totals, "series": series, "property": prop, "property_name": props[0].get("name"), "period": {"start": start.isoformat(), "end": end.isoformat(), "days": DAYS}, "errors": errors,
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


# ------------------------------------------------------------------ the row actions: check one page of the site, add searches as keywords
class PageCheckError(ValueError):
    pass


def _level(ok: bool, bad: str = "warning") -> str:
    return "good" if ok else bad


def check_site_page(db: Session, b: Business, url: str) -> dict[str, Any]:
    """Read ONE page of the project's own website and say what is right and what to fix for search: the title, description, headings, canonical, noindex, text, images, structured data,
    set against what Google shows for that page (its clicks and the searches that bring it). Pages of any other site are refused."""
    import json as _json

    from bs4 import BeautifulSoup

    from .net import site_client
    host = gsc.host_of(b.website)
    full = url if url.startswith("http") else f"https://{host}{url if url.startswith('/') else '/' + url}"
    if not host or gsc.host_of(full) != host:
        raise PageCheckError("Only pages of this project's own website can be checked.")
    client = site_client(15)
    try:
        r = client.get(full)
    except Exception as exc:  # noqa: BLE001
        raise PageCheckError(f"The page could not be loaded: {str(exc)[:100]}") from exc
    finally:
        client.close()
    if gsc.host_of(str(r.url)) != host:
        raise PageCheckError(f"The page redirects to another site ({gsc.host_of(str(r.url))}), so it is not checked.")
    out: dict[str, Any] = {"url": full, "status": r.status_code, "findings": []}
    add = lambda level, title, fix="", **extra: out["findings"].append({"level": level, "title": title, "fix": fix, **extra})  # noqa: E731
    if r.status_code >= 400:
        add("critical", f"The page answers HTTP {r.status_code}", "Fix the page or remove its links and sitemap entry: Google will not show an error page.")
        out["summary"] = {"problems": 1, "good": 0}
        return out
    soup = BeautifulSoup(r.text, "html.parser")
    title = (soup.title.string or "").strip() if soup.title and soup.title.string else ""
    desc_tag = soup.find("meta", attrs={"name": re.compile("^description$", re.I)})
    desc = (desc_tag.get("content") or "").strip() if desc_tag else ""
    h1 = [h.get_text(" ", strip=True) for h in soup.find_all("h1")]
    robots = soup.find("meta", attrs={"name": re.compile("^(robots|googlebot)$", re.I)})
    canon = soup.find("link", rel=lambda v: v and "canonical" in (v if isinstance(v, list) else [v]))
    canon_href = urljoin(str(r.url), (canon.get("href") or "").strip()) if canon and canon.get("href") else ""
    imgs = soup.find_all("img")
    no_alt = [i for i in imgs if not (i.get("alt") or "").strip()]
    types: list[str] = []
    for s_ in soup.find_all("script", type="application/ld+json"):
        try:
            data = _json.loads(s_.string or "")
        except ValueError:
            continue
        for node in (data if isinstance(data, list) else data.get("@graph", [data]) if isinstance(data, dict) else []):
            t_ = node.get("@type") if isinstance(node, dict) else None
            types += [t_] if isinstance(t_, str) else list(t_ or [])
    body = BeautifulSoup(r.text, "html.parser")
    for t_ in body(["script", "style", "noscript", "nav", "footer", "header"]):
        t_.decompose()
    words = len(body.get_text(" ", strip=True).split())
    out["facts"] = {"title": title, "title_length": len(title), "description": desc, "description_length": len(desc), "h1": h1[:3], "canonical": canon_href or None, "words": words,
                    "images": len(imgs), "images_without_alt": len(no_alt), "schema_types": sorted(set(types))}

    # what Google shows for this page
    google: dict[str, Any] | None = None
    host_state, _m, sc, site = gsc_access.search_console(db, b, host)
    if host_state == "ok":
        try:
            end = date.today() - timedelta(days=gsc.LAG_DAYS)
            start = end - timedelta(days=DAYS - 1)
            flt = [{"groupType": "and", "filters": [{"dimension": "page", "operator": "equals", "expression": full}]}]
            tot = sc.query(site, {"startDate": start.isoformat(), "endDate": end.isoformat(), "dimensionFilterGroups": flt})
            qs = sc.query(site, {"startDate": start.isoformat(), "endDate": end.isoformat(), "dimensions": ["query"], "rowLimit": 10, "dimensionFilterGroups": flt})
            t0 = tot[0] if tot else {}
            google = {"clicks": int(t0.get("clicks", 0)), "impressions": int(t0.get("impressions", 0)), "ctr": round(t0.get("ctr", 0) * 100, 2), "position": round(t0.get("position", 0), 1) or None,
                      "queries": [{"query": q["keys"][0], "clicks": int(q["clicks"]), "impressions": int(q["impressions"]), "position": round(q["position"], 1)} for q in sorted(qs, key=lambda q: -q["impressions"])]}
        except Exception as exc:  # noqa: BLE001
            google = {"error": str(exc)[:160]}
    out["google"] = google

    ok_title, ok_desc = 30 <= len(title) <= 60, 70 <= len(desc) <= 160
    if not title:
        add("critical", "The page has no title", "Add a title tag of 30 to 60 characters with the main search first.")
    else:
        add(_level(ok_title), f"Title is {len(title)} characters" + ("" if ok_title else " (30 to 60 shows fully in Google)"), "" if ok_title else "Rewrite it to fit, with the main search near the front.")
    if not desc:
        add("critical", "The page has no meta description", "Write 70 to 160 characters that say what the visitor gets and why to click: Google often shows it under the title.")
    else:
        add(_level(ok_desc), f"Description is {len(desc)} characters" + ("" if ok_desc else " (70 to 160 shows fully)"), "" if ok_desc else "Rewrite it to fit.")
    add(_level(len(h1) == 1, "warning" if h1 else "critical"), "One main heading (H1)" if len(h1) == 1 else (f"{len(h1)} H1 headings" if h1 else "No H1 heading"), "" if len(h1) == 1 else "Use exactly one H1 that names what the page is about.")
    if (robots and "noindex" in (robots.get("content") or "").lower()) or "noindex" in (r.headers.get("x-robots-tag") or "").lower():
        add("critical", "The page is set to noindex", "Remove the noindex tag if this page should appear in Google.")
    if canon_href and gsc.host_of(canon_href) == host and path_of(canon_href) != path_of(str(r.url)):
        add("critical", f"Canonical points to another page ({path_of(canon_href)})", "Google will show that page instead. Point the canonical at this page, or accept that this page never ranks.")
    elif not canon_href:
        add("warning", "No canonical tag", "Add a canonical link so Google knows which address to keep.")
    add(_level(words >= 250, "warning" if words >= 80 else "critical"), f"{words} words of text" + ("" if words >= 250 else " (thin: most ranking pages say more)"), "" if words >= 250 else "Add the useful details a visitor looks for: prices, steps, answers, proof.")
    if imgs:
        add(_level(not no_alt), f"{len(no_alt)} of {len(imgs)} images have no alt text" if no_alt else "Every image has alt text", "Describe each image in a few words." if no_alt else "")
    add(_level(bool(types), "info"), "Structured data: " + (", ".join(sorted(set(types))) if types else "none found"), "" if types else "Add LocalBusiness, FAQ or Product schema that matches the page.")
    if google and google.get("queries"):
        top = google["queries"][0]["query"]
        low = (title + " " + desc).lower()
        if not all(w in low for w in top.lower().split()[:3]):
            add("warning", f"The search that shows this page most (\"{top}\") is not in its title or description", f"Work \"{top}\" into the title or description so searchers see it matches.")
    order = {"critical": 0, "warning": 1, "info": 2, "good": 3}
    out["findings"].sort(key=lambda f: order.get(f["level"], 2))
    out["summary"] = {"problems": sum(1 for f in out["findings"] if f["level"] in ("critical", "warning")), "good": sum(1 for f in out["findings"] if f["level"] == "good")}
    return out


def add_keywords(db: Session, b: Business, keywords: list[str], label: str = "Search Console") -> dict[str, Any]:
    """Put searches people really used into My Keywords (through the keyword workspace, so they are compared and de-duplicated like the others)."""
    from ..models import KeywordCandidate
    from . import keyword_workspace as kw
    clean = list(dict.fromkeys(k.strip() for k in keywords if k and k.strip()))[:50]
    kw.add_ideas(db, b, [{"keyword": k, "detail": "A search that showed this site on Google (Search Console)"} for k in clean], label)
    lower = {k.lower() for k in clean}
    ids = [r.id for r in db.scalars(select(KeywordCandidate).where(KeywordCandidate.business_id == b.id)) if r.keyword.lower() in lower]
    picked = kw.pick(db, b, ids) if ids else {"picked": 0}
    return {"asked": len(clean), "added": picked.get("picked", 0)}


# ------------------------------------------------------------------ the site's own files: sitemap, robots.txt, llms.txt, against the pages the audit found
AI_BOTS = [("GPTBot", "ChatGPT training"), ("OAI-SearchBot", "ChatGPT search"), ("ChatGPT-User", "ChatGPT browsing"), ("ClaudeBot", "Claude"), ("PerplexityBot", "Perplexity"),
           ("Google-Extended", "Gemini training"), ("Applebot-Extended", "Apple AI"), ("CCBot", "Common Crawl"), ("Bytespider", "ByteDance")]


def norm_url(u: str) -> str:
    p = urlsplit(u or "")
    return f"{p.netloc.lower().removeprefix('www.')}{(p.path.rstrip('/') or '/')}"


def _audited_pages(db: Session, b: Business, host: str) -> dict[str, dict[str, Any]]:
    """Every page of the site the software has seen: the website audit's crawl, the page X-Ray scans, and the pages Page Indexing knows. {normalised: {url, sources}}"""
    from ..models import Audit, PageXRayJob
    seen: dict[str, dict[str, Any]] = {}

    def add(url: str | None, src: str) -> None:
        if not url or gsc.host_of(url) != host:
            return
        e = seen.setdefault(norm_url(url), {"url": url, "sources": []})
        if src not in e["sources"]:
            e["sources"].append(src)
    for a in db.scalars(select(Audit).where(Audit.kind == "website", Audit.status == "done", Audit.target.ilike(f"%{host}%")).order_by(Audit.id.desc()).limit(3)):
        for p in ((a.result or {}).get("crawl") or {}).get("pages") or []:
            add(p.get("url"), "Website audit crawl")
    for j in db.scalars(select(PageXRayJob).where(PageXRayJob.business_id == b.id).order_by(PageXRayJob.id.desc()).limit(2)):
        for p in j.pages or []:
            add(p.get("url"), "Page X-Ray scan")
    for p in db.scalars(select(IndexPage).where(IndexPage.business_id == b.id)):
        if not p.in_sitemap:
            add(p.url, "Page Indexing (not from the sitemap)")
    return seen


def read_sitemap(b: Business, host: str) -> dict[str, Any]:
    from . import sitemap
    try:
        entries = sitemap.discover_site_entries(b.website if b.website.startswith("http") else f"https://{b.website}", 2000)
    except Exception as exc:  # noqa: BLE001
        return {"found": False, "message": str(exc)[:200] or "No sitemap could be read.", "urls": []}
    return {"found": True, "urls": [{"url": u, "lastmod": m} for u, m in entries if gsc.host_of(u) == host]}


def read_robots(text: str | None, status: int | None, host: str, sample: list[str]) -> dict[str, Any]:
    from urllib.robotparser import RobotFileParser
    if status != 200 or not (text or "").strip():
        return {"found": False, "status": status, "message": "No robots.txt: search engines may crawl everything. Add one that lists your sitemap." if status in (404, 410) else "robots.txt could not be read.",
                "sitemaps": [], "rules": [], "ai_bots": [], "blocked_pages": []}
    rp = RobotFileParser()
    rp.parse(text.splitlines())
    groups: list[dict[str, Any]] = []
    cur: dict[str, Any] | None = None
    sitemaps: list[str] = []
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        k, v = (x.strip() for x in line.split(":", 1))
        k = k.lower()
        if k == "sitemap":
            sitemaps.append(v)
        elif k == "user-agent":
            if cur is None or cur["disallow"] or cur["allow"]:
                cur = {"agents": [], "disallow": [], "allow": []}
                groups.append(cur)
            cur["agents"].append(v)
        elif k in ("disallow", "allow") and cur is not None and v:
            cur[k].append(v)
    base = f"https://{host}"
    blocks_all = not rp.can_fetch("Googlebot", base + "/")
    bots = [{"bot": n, "purpose": why, "allowed": rp.can_fetch(n, base + "/")} for n, why in AI_BOTS]
    blocked = [u for u in sample if not rp.can_fetch("Googlebot", u)][:15]
    return {"found": True, "status": 200, "lines": len(text.splitlines()), "sitemaps": sitemaps, "rules": [g for g in groups if g["disallow"] or g["allow"]][:12], "blocks_google": blocks_all,
            "ai_bots": bots, "blocked_pages": blocked, "text": text[:3000]}


def read_llms(host: str, sitemap_norm: set[str]) -> list[dict[str, Any]]:
    """llms.txt and llms-full.txt, the files that tell AI assistants what the site is: read, checked against the format, and its links set against the sitemap."""
    from .page_xray import fetch_small
    out = []
    for name in ("llms.txt", "llms-full.txt"):
        url = f"https://{host}/{name}"
        raw = fetch_small(url, 400_000)
        text = (raw or {}).get("text") or ""
        ok = bool(raw) and raw["status"] == 200 and text.strip() and not text.lstrip().startswith("<") and "html" not in (raw.get("content_type") or "").lower()
        if not ok:
            out.append({"name": name, "url": url, "found": False, "status": (raw or {}).get("status")})
            continue
        links = re.findall(r"\[[^\]]*\]\((https?://[^)\s]+|/[^)\s]*)\)", text)
        links = [u if u.startswith("http") else f"https://{host}{u}" for u in links]
        own = [u for u in links if gsc.host_of(u) == host]
        lines = text.splitlines()
        h1 = next((ln for ln in lines if ln.startswith("# ")), "")
        checks = [{"ok": bool(h1), "text": "Starts with a title (# Name)"}, {"ok": any(ln.startswith(">") for ln in lines), "text": "Has a short summary (> what the site is)"},
                  {"ok": any(ln.startswith("## ") for ln in lines), "text": "Has sections (## Pages, ## Services)"}, {"ok": len(links) >= 3, "text": "Links to the important pages"}]
        out.append({"name": name, "url": url, "found": True, "chars": len(text), "lines": len(lines), "title": h1[2:].strip(), "links": len(links), "checks": checks,
                    "links_not_in_sitemap": [u for u in own if norm_url(u) not in sitemap_norm][:15] if sitemap_norm else [],
                    "preview": text[:1200]})
    return out


def site_files(db: Session, b: Business) -> dict[str, Any]:
    """The site's sitemap, robots.txt and llms.txt read live, with the pages the software has seen that the sitemap leaves out (and the reverse)."""
    from .page_xray import fetch_small
    host = gsc.host_of(b.website)
    if not host:
        return {"state": "no_website", "message": "Add the project's website first."}
    sm = read_sitemap(b, host)
    in_sm = {norm_url(x["url"]) for x in sm["urls"]}
    seen = _audited_pages(db, b, host)
    missing = [{"url": v["url"], "sources": v["sources"]} for k, v in seen.items() if k not in in_sm] if sm["found"] else []
    not_audited = [x["url"] for x in sm["urls"] if norm_url(x["url"]) not in seen][:50]
    rb = fetch_small(f"https://{host}/robots.txt")
    robots = read_robots((rb or {}).get("text"), (rb or {}).get("status"), host, [x["url"] for x in sm["urls"]] + [v["url"] for v in seen.values()])
    sitemap_lines = {norm_url(s) for s in robots.get("sitemaps", [])}
    robots["lists_sitemap"] = bool(sitemap_lines) and any(norm_url(f"https://{host}/sitemap.xml") == s or s.endswith("sitemap.xml") or "sitemap" in s for s in sitemap_lines)
    llms = read_llms(host, in_sm)
    xml = "\n".join(f"  <url><loc>{m['url']}</loc></url>" for m in missing)
    return {"state": "ok", "host": host, "sitemap": {**sm, "count": len(sm["urls"]), "urls": sm["urls"][:300]}, "audited": len(seen),
            "missing_from_sitemap": missing, "missing_xml": f"<!-- add inside <urlset> in your sitemap -->\n{xml}" if missing else "", "sitemap_not_audited": not_audited,
            "robots": robots, "llms": llms}
