"""Competitors for the Google Business Profile: how each competitor's public Google listing compares with this business's own, whether or not the competitor has a website.

Each listing is read and checked the same way (see listing_audit.py), so the two sides are comparable. The result says where the profile is behind most of the competitors, which main
category they use, how fresh their reviews are, and which services they list that this profile does not, each with the next step. Everything is read from Google Maps: nothing is guessed."""
from __future__ import annotations

import statistics
from collections import Counter
from app.services.fanout import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, Competitor
from . import listing_audit as la

MAX_COMPETITORS = 12
# What each check asks for on the profile, for the advice
ADVICE = {
    "category": "Set the main category the competitors use (Categories step).",
    "summary": "Write a full description of 400 to 750 characters: what you do, for whom, where.",
    "phone": "Add the phone number customers can call.",
    "website": "Add the website link: most competitors show one.",
    "hours": "Add opening hours for every day, and special hours for holidays.",
    "photos": "Add real photos every week: outside, inside, your work and your team.",
    "reviews": "Ask every happy customer for a review with your review link or QR code.",
    "rating": "Reply to every review and fix what unhappy customers name.",
    "recent": "Ask for new reviews: competitors get them more often than you.",
    "attributes": "Turn on every attribute that is true for you (payment, accessibility, amenities).",
}


def competitors_for(db: Session, b: Business, store_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The competitors to compare: the ones saved on the Google profile page and the chosen ones from the competitor finder (including those with no website), without repeats."""
    out: list[dict[str, Any]] = []
    seen_pid: set[str] = set()
    seen_name: set[str] = set()

    def add(item: dict[str, Any]) -> None:
        pid, name = str(item.get("place_id") or item.get("cid") or ""), (item.get("name") or "").strip().lower()
        if (pid and pid in seen_pid) or (name and name in seen_name):
            return
        seen_pid.add(pid) if pid else None
        seen_name.add(name) if name else None
        out.append(item)

    for it in store_items:
        add({"name": it.get("name"), "address": it.get("address"), "place_id": it.get("place_id"), "website": it.get("website"), "source": it.get("source") or "maps"})
    for c in db.scalars(select(Competitor).where(Competitor.business_id == b.id).order_by(Competitor.id)):
        if c.selected is False:
            continue
        add({"name": c.name, "address": c.address, "place_id": c.place_id, "website": c.website, "source": "chosen", "competitor_id": c.id})
    return out[:MAX_COMPETITORS]


def _read(item: dict[str, Any], b: Business, region: str) -> dict[str, Any]:
    out = {"name": item.get("name"), "website": item.get("website"), "source": item.get("source")}
    try:
        pid = la._resolve(item | {"cid": item.get("place_id")}, region, getattr(b, "lat", None), getattr(b, "lng", None))
        if not pid:
            return out | {"error": "Its Google listing could not be found."}
        return out | la.audit_one(pid) | {"place_id": pid}
    except Exception:  # noqa: BLE001 - one listing that cannot be read must not stop the rest
        return out | {"error": "Its Google listing could not be read."}


def _median(xs: list[float]) -> float | None:
    return float(statistics.median(xs)) if xs else None


def analyse(db: Session, b: Business, comps: list[dict[str, Any]], region: str = "IN") -> dict[str, Any]:
    """Read every competitor's listing and this business's own, and say where the profile is behind."""
    from ..db import release_connection
    release_connection(db)  # the Google reads below take seconds: no connection is held while they run
    own_place = getattr(b, "place_id", None)
    with ThreadPoolExecutor(max_workers=5) as pool:
        own = pool.submit(la.audit_one, own_place) if own_place else None  # this business's own listing is read at the same time as the competitors', not after them
        reads = list(pool.map(lambda it: _read(it, b, region), comps[:MAX_COMPETITORS]))
        you = None
        if own is not None:
            try:
                you = own.result()
            except Exception:  # noqa: BLE001
                you = None
    ok = [r for r in reads if not r.get("error")]

    # the checks side by side
    checks = []
    for key, label, _w in la.CHECKS:
        statuses = [next((x["status"] for x in r["rows"] if x["key"] == key), None) for r in ok]
        mine = next((x["status"] for x in (you or {}).get("rows", []) if x["key"] == key), None)
        good = sum(1 for s in statuses if s == "ok")
        checks.append({"key": key, "label": label, "you": mine, "competitors_good": good, "competitors_total": len(ok), "behind": bool(ok) and mine is not None and mine != "ok" and good * 2 >= len(ok)})

    insights: list[dict[str, str]] = []
    n = len(ok)
    if you and n:
        med = _median([r["score"] for r in ok]) or 0
        gap = round(med - you["score"])
        insights.append({"level": "critical" if gap >= 25 else "warning" if gap > 0 else "good", "title": (f"Your Google listing scores {you['score']}; the typical competitor scores {round(med)}" if gap > 0
                                                                                                  else f"Your Google listing scores {you['score']}, level with or above the typical competitor ({round(med)})"),
                         "fix": "The checks below show exactly where you are behind." if gap > 0 else "Keep adding photos and reviews to stay ahead."})
    cats = Counter((r["facts"].get("category") or "").strip() for r in ok if r["facts"].get("category"))
    mine_cat = ((you or {}).get("facts") or {}).get("category") or getattr(b, "primary_category", None) or ""
    if cats:
        top, count = cats.most_common(1)[0]
        if count * 2 >= n and mine_cat and la.same_thing(top, mine_cat) is False and top.lower() != mine_cat.lower():
            insights.append({"level": "warning", "title": f"{count} of {n} competitors use \"{top}\" as the main category; yours is \"{mine_cat}\"",
                             "fix": "The main category tells Google what you are. If \"" + top + "\" describes your business, make it the primary category (Categories step)."})
    photos = _median([r["facts"].get("photos") or 0 for r in ok])
    if you and photos is not None and (you["facts"].get("photos") or 0) < photos:
        insights.append({"level": "warning", "title": f"{you['facts'].get('photos') or 0} photos on your listing; the typical competitor shows {round(photos)}", "fix": ADVICE["photos"]})
    new_days = [r["facts"]["newest_review_days"] for r in ok if r["facts"].get("newest_review_days") is not None]
    mine_new = ((you or {}).get("facts") or {}).get("newest_review_days")
    if new_days and (mine_new is None or mine_new > (_median(new_days) or 0) * 2):
        insights.append({"level": "warning", "title": "Competitors get reviews more often than you" if mine_new is not None else "No recent review shows on your listing; competitors have them",
                         "fix": ADVICE["recent"]})
    for c in checks:
        if c["behind"] and c["key"] not in ("photos", "category", "recent"):
            insights.append({"level": "info", "title": f"{c['competitors_good']} of {c['competitors_total']} competitors are good on \"{c['label']}\"; you are not", "fix": ADVICE[c["key"]]})
    no_site = sum(1 for r in reads if not r.get("website"))
    if no_site:
        insights.append({"level": "info", "title": f"{no_site} of {len(reads)} competitors have no website: their Google profile is their only presence", "fix": "They compete with you on the profile alone: reviews, photos and posts decide who wins."})

    # services competitors list that this profile does not
    ours_services = [s.get("name") for s in (getattr(b, "services", None) or []) if s.get("name")] + list(((getattr(b, "business_brief", None) or {}).get("offerings")) or [])
    theirs: list[str] = []
    for c in db.scalars(select(Competitor).where(Competitor.business_id == b.id, Competitor.listing.is_not(None))):
        if c.selected is False:
            continue
        theirs += ((c.listing or {}).get("understanding") or {}).get("services") or []
    services_gap = la.overlap(ours_services, list(dict.fromkeys(theirs)))["only_them"][:8]
    if services_gap:
        insights.append({"level": "info", "title": f"Competitors list services you do not: {', '.join(services_gap[:3])}{' and more' if len(services_gap) > 3 else ''}",
                         "fix": "If you offer them, add them under Services on the profile (the Services step). Only add what you really provide."})
    order = {"critical": 0, "warning": 1, "info": 2, "good": 3}
    insights.sort(key=lambda i: order.get(i["level"], 2))
    return {"you": you and {"score": you["score"], "facts": you["facts"], "rows": you["rows"]}, "competitors": [{"name": r["name"], "website": r.get("website"), "source": r.get("source"), "score": r.get("score"), "facts": r.get("facts"),
                                                                                                                 "error": r.get("error")} for r in reads],
            "checks": checks, "categories": [{"category": k, "count": v} for k, v in cats.most_common(5)], "services_gap": services_gap, "insights": insights, "read": n, "asked": len(reads),
            "read_at": datetime.now(timezone.utc).isoformat(),
            "note": "Read from each public Google Maps listing: Maps shows at most 10 photos and 5 reviews, and no posts, services list or owner replies."}
