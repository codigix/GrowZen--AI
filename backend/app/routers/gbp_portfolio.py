"""One page for every project: what is connected to Google, what was posted, photographed, replied to and updated, and how the profile performed.

GET /gbp/portfolio   one row per project the signed-in user may open, with totals. Everything comes from what is stored for the project (Google data is brought in by each project's sync):
                     nothing here calls Google, so the page is quick however many projects there are.
"""
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import only_mine
from ..models import ActivityLog, AgentTask, Business, InsightDay, Post, Review

router = APIRouter(prefix="/gbp", tags=["gbp-portfolio"])


def _sum(db: Session, bid: int, a: date, z: date) -> dict[str, int]:
    r = db.execute(select(func.coalesce(func.sum(InsightDay.calls), 0), func.coalesce(func.sum(InsightDay.directions), 0), func.coalesce(func.sum(InsightDay.website_clicks), 0),
                          func.coalesce(func.sum(InsightDay.views_search + InsightDay.views_maps), 0)).where(InsightDay.business_id == bid, InsightDay.day.between(a, z))).one()
    return dict(zip(("calls", "directions", "website_clicks", "views"), (int(x) for x in r)))


def _count(db: Session, model, *where) -> int:
    return int(db.scalar(select(func.count()).select_from(model).where(*where)) or 0)


def row_for(db: Session, b: Business) -> dict:
    today = date.today()
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=30)
    linked = bool(b.gbp_location and b.connection_id)
    conn = b.connection
    cur, prev = _sum(db, b.id, today - timedelta(days=29), today), _sum(db, b.id, today - timedelta(days=59), today - timedelta(days=30))
    days = {d.day: d for d in db.scalars(select(InsightDay).where(InsightDay.business_id == b.id, InsightDay.day > today - timedelta(days=30)))}
    series = [(lambda d: (d.calls + d.directions + d.website_clicks) if d else 0)(days.get(today - timedelta(days=29 - i))) for i in range(30)]
    views = [(lambda d: (d.views_search + d.views_maps) if d else 0)(days.get(today - timedelta(days=29 - i))) for i in range(30)]
    live = Review.business_id == b.id, Review.gone_at.is_(None)
    waiting = _count(db, Review, *live, Review.reply_status != "posted")
    posts30 = _count(db, Post, Post.business_id == b.id, Post.status == "published", Post.published_at >= since)
    scheduled = _count(db, Post, Post.business_id == b.id, Post.status == "scheduled")
    drafts = _count(db, Post, Post.business_id == b.id, Post.status == "draft")
    last_post = db.scalar(select(func.max(Post.published_at)).where(Post.business_id == b.id, Post.status == "published"))
    photos30 = _count(db, ActivityLog, ActivityLog.business_id == b.id, ActivityLog.action == "gbp_media_added", ActivityLog.created_at >= since)
    updates30 = _count(db, ActivityLog, ActivityLog.business_id == b.id, ActivityLog.action == "business_updated", ActivityLog.created_at >= since)
    last_update = db.scalar(select(func.max(ActivityLog.created_at)).where(ActivityLog.business_id == b.id, ActivityLog.action == "business_updated"))
    pending = _count(db, AgentTask, AgentTask.business_id == b.id, AgentTask.status == "pending")
    attention: list[str] = []
    if not linked:
        attention.append("Not connected to Google")
    elif conn is not None and conn.status != "active":
        attention.append("Google connection needs to be renewed")
    if b.verification not in ("verified", "unknown") and linked:
        attention.append(f"Profile is {b.verification}")
    if waiting:
        attention.append(f"{waiting} review{'s' if waiting != 1 else ''} without a reply")
    if linked and (last_post is None or now - (last_post if last_post.tzinfo else last_post.replace(tzinfo=timezone.utc)) > timedelta(days=14)) and not scheduled:
        attention.append("No post in the last 14 days")
    if b.google_watch:
        attention.append("A change is under Google's review")
    if pending:
        attention.append(f"{pending} item{'s' if pending != 1 else ''} wait for approval")
    return {
        "id": b.id, "name": b.name, "logo": b.logo, "category": b.primary_category, "city": b.city, "website": b.website,
        "google": {"linked": linked, "email": conn.email if conn else None, "status": conn.status if conn else None, "verification": b.verification, "open_status": b.open_status,
                   "last_sync": conn.last_sync_at.isoformat() if conn and conn.last_sync_at else None, "under_review": bool(b.google_watch)},
        "profile": {"rating": b.rating, "reviews": b.review_count, "photos": b.photo_count, "services": len(b.services or []), "score": b.last_audit_score},
        "reviews": {"waiting": waiting, "replied_30d": _count(db, Review, *live, Review.replied_at >= since), "new_30d": _count(db, Review, *live, Review.review_date >= today - timedelta(days=30))},
        "posts": {"published_30d": posts30, "scheduled": scheduled, "drafts": drafts, "last": last_post.isoformat() if last_post else None},
        "photos": {"total": b.photo_count, "added_30d": photos30},
        "updates": {"count_30d": updates30, "last": last_update.isoformat() if last_update else None},
        "insights": {"now": cur, "before": prev, "actions": series, "views": views},
        "pending": pending, "attention": attention,
    }


@router.get("/portfolio")
def portfolio(db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = [row_for(db, b) for b in db.scalars(only_mine(select(Business).where(Business.status != "paused"), user).order_by(Business.name))]
    tot = {
        "projects": len(rows), "connected": sum(1 for r in rows if r["google"]["linked"]),
        "reviews_waiting": sum(r["reviews"]["waiting"] for r in rows), "replied_30d": sum(r["reviews"]["replied_30d"] for r in rows),
        "posts_30d": sum(r["posts"]["published_30d"] for r in rows), "scheduled": sum(r["posts"]["scheduled"] for r in rows),
        "photos_added_30d": sum(r["photos"]["added_30d"] for r in rows), "updates_30d": sum(r["updates"]["count_30d"] for r in rows),
        "needs_attention": sum(1 for r in rows if r["attention"]),
        "views": [sum(r["insights"]["now"]["views"] for r in rows), sum(r["insights"]["before"]["views"] for r in rows)],
        "actions": [sum(r["insights"]["now"][k] for r in rows for k in ("calls", "directions", "website_clicks")), sum(r["insights"]["before"][k] for r in rows for k in ("calls", "directions", "website_clicks"))],
    }
    return {"totals": tot, "projects": rows, "generated_at": datetime.now(timezone.utc).isoformat()}
