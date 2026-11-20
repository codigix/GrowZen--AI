"""The project dashboard's numbers in one place: counts of what exists, how each thing moved week by week or month by month, and the actions taken on the project.
Everything is read from what is stored for the project (nothing is invented): a series is empty when nothing happened in that period."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (ActivityLog, AgentTask, Article, Audit, BacklinkCheck, Business, GrowthAction, IndexPage, InsightDay, Keyword, Lead, Post, Review)

WEEKS, MONTHS = 12, 6

ACTION_WORDS = {
    "business_updated": "Profile details updated", "business_imported": "Imported from Google", "gbp_synced": "Synced with Google", "gbp_categories_updated": "Categories updated on Google",
    "gbp_address_updated": "Address updated on Google", "gbp_media_added": "Photo added to Google", "gbp_post_deleted": "Google post deleted", "autopilot_scheduled": "Google post approved and scheduled",
    "autopilot_edited": "Waiting post edited", "autopilot_generate": "Assistant prepared new items", "task_handed_off": "Task handed to a person", "products.updated": "Products updated",
    "service_enabled": "Service switched on", "service_disabled": "Service switched off",
}


def _tz(d: datetime | None) -> datetime | None:
    return d if d is None or d.tzinfo else d.replace(tzinfo=timezone.utc)


def _week(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _month(d: date) -> date:
    return d.replace(day=1)


def buckets(period: str, today: date | None = None) -> list[date]:
    """The start dates of the periods shown, oldest first: the last 12 weeks (Monday) or the last 6 months."""
    today = today or date.today()
    if period == "month":
        first, out = _month(today), []
        for _ in range(MONTHS):
            out.append(first)
            first = _month(first - timedelta(days=1))
        return out[::-1]
    start = _week(today)
    return [start - timedelta(weeks=i) for i in range(WEEKS - 1, -1, -1)]


def _label(d: date, period: str) -> str:
    return d.strftime("%b %Y") if period == "month" else d.strftime("%d %b")


def _key(d: date | datetime | None, period: str) -> date | None:
    if d is None:
        return None
    d = d.date() if isinstance(d, datetime) else d
    return _month(d) if period == "month" else _week(d)


def _series(rows: list[date | datetime | None], period: str, keys: list[date], weight: list[int] | None = None) -> list[int]:
    got: dict[date, int] = defaultdict(int)
    for i, r in enumerate(rows):
        k = _key(r, period)
        if k in keys:
            got[k] += weight[i] if weight else 1
    return [got.get(k, 0) for k in keys]


def _change(series: list[float]) -> dict[str, Any]:
    """The last period against the one before it."""
    if len(series) < 2:
        return {"now": series[-1] if series else 0, "before": 0, "delta": 0, "pct": None}
    now, before = series[-1], series[-2]
    return {"now": now, "before": before, "delta": now - before, "pct": round((now - before) / before * 100) if before else None}


def humanize(action: str) -> str:
    return ACTION_WORDS.get(action) or action.replace("_", " ").replace(".", " ").strip().capitalize()


def build(db: Session, b: Business, period: str = "week") -> dict[str, Any]:
    period = "month" if period == "month" else "week"
    keys = buckets(period)
    since = datetime.combine(keys[0], datetime.min.time(), tzinfo=timezone.utc)
    labels = [_label(k, period) for k in keys]

    # ---- series
    ins = db.execute(select(InsightDay.day, InsightDay.calls, InsightDay.directions, InsightDay.website_clicks, InsightDay.views_search, InsightDay.views_maps)
                     .where(InsightDay.business_id == b.id, InsightDay.day >= keys[0])).all()
    ins_days = [r[0] for r in ins]
    reviews = [_tz(x) for x in db.scalars(select(func.coalesce(Review.review_at, Review.created_at)).where(Review.business_id == b.id)).all()]
    posts = [_tz(x) for x in db.scalars(select(Post.published_at).where(Post.business_id == b.id, Post.status == "published", Post.published_at.is_not(None))).all()]
    articles = [_tz(x) for x in db.scalars(select(Article.generated_at).where(Article.business_id == b.id, Article.status == "completed", Article.generated_at.is_not(None))).all()]
    fixed = [_tz(x) for x in db.scalars(select(GrowthAction.verified_at).where(GrowthAction.business_id == b.id, GrowthAction.verified_at.is_not(None))).all()]
    leads = list(db.scalars(select(Lead.lead_date).where(Lead.business_id == b.id, Lead.lead_date.is_not(None))).all())
    acts = [_tz(x) for x in db.scalars(select(ActivityLog.created_at).where(ActivityLog.business_id == b.id, ActivityLog.created_at >= since)).all()]
    audit_rows = db.execute(select(Audit.finished_at, Audit.score).where(Audit.business_id == b.id, Audit.status == "done", Audit.score.is_not(None), Audit.finished_at.is_not(None),
                                                                        Audit.finished_at >= since)).all()
    health: dict[date, list[int]] = defaultdict(list)
    for fin, sc in audit_rows:
        k = _key(fin, period)
        if k in keys:
            health[k].append(sc)
    health_series = [round(sum(health[k]) / len(health[k])) if health.get(k) else None for k in keys]

    series = {
        "calls": _series(ins_days, period, keys, [r[1] or 0 for r in ins]),
        "directions": _series(ins_days, period, keys, [r[2] or 0 for r in ins]),
        "website_clicks": _series(ins_days, period, keys, [r[3] or 0 for r in ins]),
        "views": _series(ins_days, period, keys, [(r[4] or 0) + (r[5] or 0) for r in ins]),
        "reviews": _series(reviews, period, keys),
        "posts": _series(posts, period, keys),
        "articles": _series(articles, period, keys),
        "fixes": _series(fixed, period, keys),
        "leads": _series(leads, period, keys),
        "actions": _series(acts, period, keys),
    }
    movement = {k: _change(v) for k, v in series.items()}

    # ---- counts of what exists
    def count(model, *where) -> int:
        return int(db.scalar(select(func.count()).select_from(model).where(model.business_id == b.id, *where)) or 0)

    rating = db.execute(select(func.avg(Review.rating), func.count()).where(Review.business_id == b.id, Review.rating.is_not(None))).one()
    ranks = [r for r in db.scalars(select(Keyword.rank).where(Keyword.business_id == b.id, Keyword.tracked.is_(True))).all() if r]
    acts_total = db.execute(select(GrowthAction.status, func.count()).where(GrowthAction.business_id == b.id).group_by(GrowthAction.status)).all()
    by_status = {s: n for s, n in acts_total}
    counts = {
        "keywords_tracked": count(Keyword, Keyword.tracked.is_(True)),
        "ranking_top3": sum(1 for r in ranks if r <= 3), "ranking_top10": sum(1 for r in ranks if r <= 10), "ranking_any": len(ranks),
        "articles": count(Article, Article.status == "completed"),
        "articles_live": count(Article, Article.wp_status == "publish") + count(Article, Article.react_status == "publish"),
        "posts_published": count(Post, Post.status == "published"), "posts_waiting": count(Post, Post.status.in_(("draft", "scheduled"))),
        "reviews": int(rating[1] or 0), "rating": round(float(rating[0]), 1) if rating[0] else None,
        "reviews_unreplied": count(Review, Review.reply_status != "posted"),
        "leads": count(Lead), "backlinks_checked": count(BacklinkCheck),
        "pages_known": count(IndexPage), "pages_indexed": count(IndexPage, IndexPage.g_state.in_(("indexed", "INDEXED", "Submitted and indexed", "PASS"))),
        "fixes_total": sum(by_status.values()), "fixes_done": by_status.get("verified", 0), "fixes_open": sum(v for k, v in by_status.items() if k in ("todo", "done", "unverified", "failed")),
        "approvals_waiting": int(db.scalar(select(func.count()).select_from(AgentTask).where(AgentTask.business_id == b.id, AgentTask.status == "pending")) or 0),
    }

    # ---- actions taken
    recent = db.scalars(select(ActivityLog).where(ActivityLog.business_id == b.id).order_by(ActivityLog.id.desc()).limit(40)).all()
    noisy = {"gbp_synced"}
    timeline, seen = [], set()
    for a in recent:
        if a.action in noisy:
            continue
        what = humanize(a.action)
        fields = (a.detail or {}).get("fields")
        if fields and a.action == "business_updated":
            what += ": " + ", ".join(str(x).replace("_", " ") for x in fields[:5])
        key = (what, a.created_at.replace(second=0, microsecond=0) if a.created_at else None)
        if key in seen:
            continue
        seen.add(key)
        timeline.append({"what": what, "who": a.actor, "at": a.created_at.isoformat() if a.created_at else None, "pushed": bool((a.detail or {}).get("pushed_to_google"))})
        if len(timeline) >= 12:
            break
    done_tasks = db.scalars(select(AgentTask).where(AgentTask.business_id == b.id, AgentTask.status.in_(("applied", "approved", "scheduled"))).order_by(AgentTask.id.desc()).limit(6)).all()

    return {
        "period": period, "labels": labels, "starts": [k.isoformat() for k in keys], "series": series, "health": health_series, "movement": movement, "counts": counts, "timeline": timeline,
        "recent_tasks": [{"title": t.title, "status": t.status, "kind": t.kind, "at": t.updated_at.isoformat() if t.updated_at else None} for t in done_tasks],
    }
