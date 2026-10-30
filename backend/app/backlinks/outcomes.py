"""Outcome tracking: what did an action change? A snapshot of the business's key numbers is taken when something is done (a task approved, a removal
request started) and taken again 14 and 30 days later. The verdict compares the two. It shows what moved after an action, which is evidence, not
proof: rankings and links also move for reasons we did not cause, and every outcome says so."""
import logging
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import utcnow
from ..models import Keyword, Review
from .models import ActionOutcome
from .summary import own_site_links

log = logging.getLogger("seo.outcomes")
CHECK_DAYS = (14, 30)
NOTE = "Shows what changed after this action. Other things may also have moved these numbers."


def snapshot(db: Session, business_id: int) -> dict:
    kws = list(db.scalars(select(Keyword).where(Keyword.business_id == business_id)))
    ranked = [k.rank for k in kws if k.rank]
    rv = db.execute(select(func.count(Review.id), func.avg(Review.rating)).where(Review.business_id == business_id)).one()
    links = own_site_links(db, business_id)
    return {"tracked_keywords": len(kws), "ranking_keywords": len(ranked), "avg_rank": round(sum(ranked) / len(ranked), 1) if ranked else None,
            "reviews": int(rv[0] or 0), "avg_rating": round(float(rv[1]), 2) if rv[1] is not None else None,
            "backlinks": links["backlinks"] if links else None, "referring_domains": links["referring_domains"] if links else None}


def start(db: Session, business_id: int, action_kind: str, ref: str, title: str, now: datetime | None = None) -> int:
    """Record the baseline for an action. Safe to call repeatedly for the same action (it is recorded once)."""
    now = now or utcnow()
    made = 0
    base = None
    for days in CHECK_DAYS:
        if db.scalar(select(ActionOutcome.id).where(ActionOutcome.business_id == business_id, ActionOutcome.action_kind == action_kind, ActionOutcome.ref == ref,
                                                   ActionOutcome.check_days == days)):
            continue
        base = base or snapshot(db, business_id)
        db.add(ActionOutcome(business_id=business_id, action_kind=action_kind, ref=ref, title=title[:300], check_days=days, baseline=base, started_at=now,
                             due_at=now + timedelta(days=days)))
        db.flush()  # the next check (and a second call in the same transaction) must see this row
        made += 1
    return made


def verdict_for(before: dict, after: dict) -> tuple[str, dict]:
    """improved / worse / flat / unknown from the deltas. A metric only counts when it was known both times."""
    d, up, down = {}, 0, 0
    for k, better_when_higher, threshold in (("ranking_keywords", True, 1), ("backlinks", True, 1), ("referring_domains", True, 1), ("reviews", True, 1), ("avg_rating", True, 0.1), ("avg_rank", False, 1.0)):
        a, b = before.get(k), after.get(k)
        if a is None or b is None:
            continue
        delta = round(b - a, 2)
        d[k] = delta
        if abs(delta) >= threshold:
            if (delta > 0) == better_when_higher:
                up += 1
            else:
                down += 1
    if not d:
        return "unknown", d
    return ("improved" if up > down else "worse" if down > up else "flat"), d


def measure_due(db: Session, now: datetime | None = None) -> int:
    now = now or utcnow()
    n = 0
    for o in db.scalars(select(ActionOutcome).where(ActionOutcome.measured_at.is_(None), ActionOutcome.due_at <= now)):
        after = snapshot(db, o.business_id)
        v, deltas = verdict_for(o.baseline or {}, after)
        o.measured, o.verdict, o.measured_at = {"after": after, "change": deltas, "note": NOTE}, v, now
        n += 1
    db.commit()
    return n


def recent(db: Session, business_id: int, limit: int = 20) -> list[dict]:
    rows = db.scalars(select(ActionOutcome).where(ActionOutcome.business_id == business_id).order_by(ActionOutcome.started_at.desc(), ActionOutcome.check_days).limit(limit * 2))
    out = [{"id": o.id, "action": o.action_kind, "title": o.title, "check_days": o.check_days, "started_at": o.started_at, "due_at": o.due_at, "verdict": o.verdict,
            "measured_at": o.measured_at, "change": (o.measured or {}).get("change"), "baseline": o.baseline, "note": NOTE} for o in rows]
    return out[:limit]


def summary(db: Session, business_id: int) -> dict:
    """How actions have worked out so far, by kind: the 'what works for this business' view."""
    done = list(db.scalars(select(ActionOutcome).where(ActionOutcome.business_id == business_id, ActionOutcome.measured_at.is_not(None))))
    by: dict[str, dict] = {}
    for o in done:
        s = by.setdefault(o.action_kind, {"improved": 0, "flat": 0, "worse": 0, "unknown": 0})
        s[o.verdict or "unknown"] += 1
    return {"measured": len(done), "pending": db.scalar(select(func.count(ActionOutcome.id)).where(ActionOutcome.business_id == business_id, ActionOutcome.measured_at.is_(None))) or 0,
            "by_action": by, "note": NOTE}
