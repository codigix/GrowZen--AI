"""Look up every analytic we hold for a Google account / contact email.

GET /analytics/by-email?email=owner@example.com[&days=30][&refresh=true]

The email is matched to (1) a connected Google account (the one that manages the Business Profiles), and
every business imported through it; or, if no Google account has that email, (2) businesses whose contact
email is it. For each business it returns the profile, the Business Profile performance (calls, directions,
website clicks, search and maps views, bookings) for the period with the previous period beside it and the
daily series, reviews, the last synced live snapshot (search keywords, posts, photos) and the audit scores.
`refresh=true` re-reads Google first (same sync as POST /businesses/{id}/sync). Read-only otherwise.
"""
from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..conn_access import only_my_connections
from ..db import get_db
from ..deps import only_mine
from ..models import Business, GoogleConnection, InsightDay, Lead, Review
from ..serialize import row, rows
from ..services import audits, gbp

router = APIRouter(prefix="/analytics", tags=["analytics-by-email"])

METRICS = ("calls", "directions", "website_clicks", "views_search", "views_maps", "bookings")


def _totals(db: Session, business_id: int, after: date, upto: date) -> dict[str, int]:
    cols = [func.coalesce(func.sum(getattr(InsightDay, m)), 0) for m in METRICS]
    r = db.execute(select(*cols).where(InsightDay.business_id == business_id, InsightDay.day > after, InsightDay.day <= upto)).one()
    return {m: int(v) for m, v in zip(METRICS, r)}


def _change(now: dict[str, int], prev: dict[str, int]) -> dict[str, float | None]:
    """Percent change per metric; None when there is nothing before to compare with."""
    return {m: (round((now[m] - prev[m]) * 100 / prev[m], 1) if prev[m] else None) for m in METRICS}


def _business_report(db: Session, b: Business, days: int) -> dict[str, Any]:
    today = date.today()
    since, before = today - timedelta(days=days), today - timedelta(days=days * 2)
    now, prev = _totals(db, b.id, since, today), _totals(db, b.id, before, since)
    reviews = list(db.scalars(select(Review).where(Review.business_id == b.id).order_by(Review.review_date.desc().nullslast(), Review.id.desc())))
    in_period = [r for r in reviews if r.review_date and r.review_date > since]
    status = dict(b.gbp_status or {})
    live = status.pop("live", None) or {}
    latest = audits.latest(db, b)
    return {
        "business": {"id": b.id, "name": b.name, "category": b.primary_category, "city": b.city, "website": b.website, "phone": b.phone,
                     "contact_email": b.contact_email, "gbp_location": b.gbp_location, "gbp_account": b.gbp_account, "place_id": b.place_id,
                     "verification": b.verification, "listing_status": status},
        "period": {"days": days, "from": (since + timedelta(days=1)).isoformat(), "to": today.isoformat()},
        "performance": {"current": now, "previous": prev, "change_percent": _change(now, prev),
                        "customer_actions": now["calls"] + now["directions"] + now["website_clicks"],
                        "daily": rows(db.scalars(select(InsightDay).where(InsightDay.business_id == b.id, InsightDay.day > since).order_by(InsightDay.day)))},
        "reviews": {"rating": b.rating, "total": b.review_count, "in_period": len(in_period),
                    "split": {str(n): sum(1 for r in reviews if r.rating == n) for n in (5, 4, 3, 2, 1)},
                    "unreplied": sum(1 for r in reviews if r.reply_status in ("none", "draft")),
                    "recent": [{"author": r.author, "rating": r.rating, "body": r.body, "date": r.review_date.isoformat() if r.review_date else None,
                                "replied": r.reply_status == "posted", "reply": r.reply_text} for r in reviews[:10]]},
        "profile_content": {"photos": b.photo_count, "posts_live": len(live.get("posts") or []), "search_keywords": live.get("search_keywords") or [],
                            "synced_at": live.get("synced_at"), "errors": live.get("errors") or {}},
        "leads_in_period": db.scalar(select(func.count(Lead.id)).where(Lead.business_id == b.id, Lead.lead_date > since)) or 0,
        "audits": {"overall": audits.overall(db, b),
                   "areas": {k: {"score": a.score, "data_source": a.data_source, "finished_at": a.finished_at.isoformat() if a.finished_at else None} for k, a in latest.items()}},
    }


@router.get("/by-email")
def analytics_by_email(email: str = Query(min_length=3, max_length=255), days: int = Query(30, ge=7, le=365), refresh: bool = False,
                       db: Session = Depends(get_db), user: User = Depends(current_user)):
    addr = email.strip().lower()
    conn = db.scalar(only_my_connections(select(GoogleConnection), user).where(func.lower(GoogleConnection.email) == addr))
    if conn:
        found, matched_by = list(db.scalars(only_mine(select(Business), user).where(Business.connection_id == conn.id).order_by(Business.name))), "google_account"
    else:
        found, matched_by = list(db.scalars(only_mine(select(Business), user).where(func.lower(Business.contact_email) == addr).order_by(Business.name))), "contact_email"
    if not conn and not found:
        raise HTTPException(404, "No connected Google account or business is registered with this email.")

    refreshed: dict[int, str] = {}
    if refresh:
        for b in found:
            try:
                gbp.sync_business(db, b)
                refreshed[b.id] = "ok"
            except gbp.GbpError as exc:
                db.rollback()
                refreshed[b.id] = f"failed: {str(exc)[:200]}"
    businesses = [_business_report(db, b, days) | ({"refresh": refreshed[b.id]} if refresh else {}) for b in found]

    totals = {m: sum(r["performance"]["current"][m] for r in businesses) for m in METRICS}
    return {
        "email": addr, "matched_by": matched_by,
        "connection": conn and {k: v for k, v in row(conn).items() if k in ("id", "email", "display_name", "status", "last_sync_at", "last_error")},
        "businesses_found": len(businesses),
        "totals": totals | {"customer_actions": totals["calls"] + totals["directions"] + totals["website_clicks"]},
        "businesses": businesses,
    }
