"""A fix plan for one area of the project (website SEO, answer engines, AI search, Google profile...): every change to make, what each is worth, and the area's score.

- Tasks are the project's fix tasks (services/growth_issues.py) for that area, with their severity, time, how they are checked and where the detail page is.
- The score of the website areas (seo, aeo, geo) is the Page X-Ray score of the homepage: passed checks' weight over all checks' weight. A failed check is worth exactly its share of
  that score, so "+6.2" really is what fixing it adds. Nothing is estimated for areas that have no such score; they show task progress only.
- "Check my fixes" scans the homepage again, closes the tasks whose check now passes and returns the score before and after.
"""
from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, GrowthAction, PageXRayRun
from . import growth_issues, page_xray

AREAS = {
    "seo": ("Website SEO", "Titles, descriptions, headings, speed, security, indexing and links of the website."),
    "aeo": ("Answer engines (AEO)", "Direct answers, FAQs, question headings and structured data that answer engines read."),
    "geo": ("AI search (GEO)", "The signals AI assistants use to trust and quote the business: author, dates, entity details."),
    "gmb": ("Google profile", "Everything missing or weak on the Google Business Profile."),
    "local": ("Listings and rankings", "Listings, citations and local ranking fixes."),
    "chatgpt": ("ChatGPT", "The Business-in-ChatGPT checklist."),
}
SCORED = ("seo", "aeo", "geo")
ORDER = {"critical": 0, "serious": 1, "warning": 2, "info": 3}


def _home(b: Business) -> str | None:
    try:
        return page_xray.normalise_url(b.website) if (b.website or "").strip() else None
    except Exception:  # noqa: BLE001
        return None


def _key(u: str | None) -> str:
    p = urlsplit(u or "")
    return f"{(p.hostname or '').lower().removeprefix('www.')}{(p.path.rstrip('/') or '/')}"


def _runs(db: Session, b: Business, limit: int = 12) -> list[PageXRayRun]:
    home = _home(b)
    if not home:
        return []
    rows = db.scalars(select(PageXRayRun).where(PageXRayRun.business_id == b.id).order_by(PageXRayRun.created_at.desc(), PageXRayRun.id.desc()).limit(80))
    out = [r for r in rows if _key(r.url) == _key(home) and (r.report or {}).get("scores")]
    return out[:limit]


def _scores(report: dict[str, Any] | None, area: str) -> dict[str, Any] | None:
    s = ((report or {}).get("scores") or {}).get(area)
    if not s or not s.get("checks"):
        return None
    total = sum(c.get("weight", 0) for c in s["checks"]) or 1
    return {"score": s["score"], "passed": s["passed"], "total": s["total"], "weight": total, "checks": {c["key"]: {"weight": c.get("weight", 0), "passed": bool(c.get("passed")), "label": c.get("label")} for c in s["checks"]}}


def plan(db: Session, b: Business, area: str) -> dict[str, Any]:
    if area not in AREAS:
        raise ValueError("Unknown area")
    label, about = AREAS[area]
    listing = growth_issues.listing(db, b)
    home = _home(b)
    runs = _runs(db, b)
    latest = runs[0] if runs else None
    sc = _scores(latest.report, area) if latest and area in SCORED else None

    rules = {a.id: (a.verify or {}) for a in db.scalars(select(GrowthAction).where(GrowthAction.business_id == b.id, GrowthAction.period == "fix", GrowthAction.area == area))}

    def item(x: dict[str, Any]) -> dict[str, Any]:
        rule = rules.get(x["id"], {})
        pts = None
        if sc and rule.get("type") == "xray_check" and rule.get("area") == area and _key(rule.get("url")) == _key(home):
            ck = sc["checks"].get(rule.get("key"))
            if ck:
                pts = round(ck["weight"] / sc["weight"] * 100, 1)
        return {"id": x["id"], "key": x["key"], "title": x["title"], "why": x.get("why"), "severity": x.get("severity", "warning"), "status": x["status"], "due_on": x.get("due_on"), "overdue": x.get("overdue", False),
                "est_minutes": x.get("est_minutes"), "fix_mode": x.get("fix_mode"), "fix_mode_label": x.get("fix_mode_label"), "source": x.get("source_label"), "points": pts, "closes_when": x.get("closes_when"), "last_check": x.get("last_check"),
                "verified_at": x.get("verified_at"), "link": x.get("link"), "page": rule.get("url") if rule.get("type") == "xray_check" else None}

    open_items = sorted([item(x) for x in listing["open"] if x["area"] == area], key=lambda i: (ORDER.get(i["severity"], 9), -(i["points"] or 0)))
    closed = [item(x) for x in listing["closed"] if x["area"] == area]
    potential = round(sum(i["points"] or 0 for i in open_items), 1)
    gained = round(sum(i["points"] or 0 for i in closed), 1)
    score = None
    if sc:
        score = {"now": sc["score"], "potential": min(100, round(sc["score"] + potential)), "scanned_at": latest.created_at.isoformat() if latest.created_at else None, "url": latest.url, "checks_passed": sc["passed"], "checks_total": sc["total"]}
    history = []
    if area in SCORED:
        for r in reversed(runs):
            s = _scores(r.report, area)
            if s:
                history.append({"at": r.created_at.isoformat() if r.created_at else None, "score": s["score"]})
    by_sev = {k: sum(1 for i in open_items if i["severity"] == k) for k in ORDER}
    return {"area": area, "label": label, "about": about, "areas": {k: v[0] for k, v in AREAS.items()}, "scored": area in SCORED, "has_website": bool(home), "score": score, "history": history[-10:],
            "open": open_items, "closed": closed, "counts": by_sev, "open_total": len(open_items), "gained": gained, "potential": potential,
            "note": None if score or area not in SCORED else ("Add the project's website first." if not home else "Scan the homepage to get this score: press “Check my fixes”.")}


def check(db: Session, b: Business, area: str) -> dict[str, Any]:
    """Scan the homepage again, close the tasks whose check passes now, and report the score before and after."""
    from . import growth_metrics
    before = plan(db, b, area)
    home = _home(b)
    if not home:
        raise ValueError("Add the project's website first.")
    report, why = growth_metrics._fresh_xray(db, b)
    if report is None:
        raise ValueError(why or "The website could not be read.")
    growth_issues.xray_sync(db, b, home, True)
    db.commit()
    after = plan(db, b, area)
    b_now, a_now = (before["score"] or {}).get("now"), (after["score"] or {}).get("now")
    after["result"] = {"before": b_now, "after": a_now, "delta": (a_now - b_now) if (a_now is not None and b_now is not None) else None,
                       "closed": max(0, len(after["closed"]) - len(before["closed"])), "still_open": after["open_total"]}
    return after
