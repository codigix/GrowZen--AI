"""The project dashboard's numbers in one place: counts of what exists, how each thing moved week by week or month by month, and the actions taken on the project.
Everything is read from what is stored for the project (nothing is invented): a series is empty when nothing happened in that period."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..backlinks import summary as bl_summary
from ..backlinks.analytics import SourceDomain, TargetDomain
from ..backlinks.lifecycle import LIVE_STATES
from ..backlinks.models import Backlink, BiOpportunity, BiTrackedTarget
from ..models import (ActivityLog, AgentTask, Article, Audit, BacklinkCheck, Business, GrowthAction, IndexPage, InsightDay, Keyword, KeywordCandidate, Lead, Post, Review)


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


RANGES = {"30d": 30, "90d": 90, "180d": 180, "365d": 365}


def _keys_between(start: date, end: date, group: str) -> list[date]:
    k, last, out = _key(start, group), _key(end, group), []
    while k <= last:
        out.append(k)
        k = (k + timedelta(days=7)) if group == "week" else _month(k + timedelta(days=32))
    return out


def plan(range_key: str, start: date | None, end: date | None, group: str | None, earliest: date | None, today: date | None = None) -> tuple[str, date, date, str, list[date]]:
    """The period shown. By default everything so far (from the first thing stored for the project until today); a fixed number of days, this month or a custom range narrows it.
    Grouped by month when the range is long, by week when it is short, unless the person chose."""
    today = today or date.today()
    from . import report_filter  # noqa: PLC0415
    f = report_filter.current()
    if f.has_period and not (range_key == "custom" and start and end):
        range_key, start, end = "custom", f.start, f.end  # the period chosen in the page header
    if range_key == "custom" and start and end:
        s, e = (start, min(end, today)) if start <= end else (end, min(start, today))
    elif range_key in RANGES:
        s, e = today - timedelta(days=RANGES[range_key] - 1), today
    elif range_key == "this_month":
        s, e = today.replace(day=1), today
    else:
        range_key, s, e = "all", min(earliest or today, today), today
    days = (e - s).days + 1
    group = group if group in ("week", "month") else ("month" if days > 120 else "week")
    keys = _keys_between(s, e, group)
    if group == "week" and len(keys) > 60:
        group, keys = "month", _keys_between(s, e, "month")
    return range_key, s, e, group, keys[-72:]


AREA_FIX = {"onpage": ("On-page SEO", "/website-audit"), "technical": ("Technical SEO", "/website-audit"), "gbp": ("Google Business Profile", "/gmb-profile"),
            "citations": ("Local citations", "/off-page-seo/citations"), "geo": ("AI search visibility", "/geo-optimization")}
_LEVEL = {"high": 0, "medium": 1, "low": 2}


def attention(db: Session, b: Business, counts: dict[str, Any]) -> list[dict[str, str]]:
    """What to do next on this project, most important first: each item says what is wrong, why it matters and where to fix it. Built only from what is stored."""
    from . import audits
    out: list[dict[str, str]] = []

    def add(level: str, title: str, why: str, to: str) -> None:
        out.append({"level": level, "title": title, "why": why, "to": to})

    linked = bool(b.gbp_location and b.connection_id)
    if not linked:
        add("high", "The Google Business Profile is not connected", "Without it nothing can be edited, posted or measured on Google from here.", "/gmb-profile")
    if b.google_watch:
        add("low", "Google is reviewing your latest profile edit", "It shows on Search and Maps once Google finishes (a few hours, sometimes up to 3 days). We tell you when it is live.", "/gmb-profile?tab=profile&sub=edit")
    waiting = db.scalars(select(Post).where(Post.business_id == b.id, Post.status.in_(("draft", "scheduled")))).all()
    holes = [p for p in waiting if "[" in (p.body or "") and "]" in (p.body or "")]
    if holes:
        add("high", f"{len(holes)} waiting post{'s' if len(holes) != 1 else ''} still ha{'ve' if len(holes) != 1 else 's'} [placeholders] to fill in", "The brackets would be published as they are. Fill them in before approving.", "/google-posts")
    if counts["approvals_waiting"]:
        add("medium", f"{counts['approvals_waiting']} item{'s' if counts['approvals_waiting'] != 1 else ''} waiting for your approval", "Nothing is posted or changed on Google until you approve it.", "/automation")
    if counts["reviews_unreplied"]:
        add("medium", f"{counts['reviews_unreplied']} review{'s' if counts['reviews_unreplied'] != 1 else ''} without a reply", "Replying shows customers (and Google) that the business is active.", "/reviews")
    for k, a in audits.latest(db, b, with_result=False).items():
        if a.score is not None and a.data_source != "sample" and k in AREA_FIX and a.score < 50:
            name, to = AREA_FIX[k]
            add("high" if a.score < 30 else "medium", f"{name} scores {a.score}/100", "A low score here holds the project back: the audit lists exactly what to fix.", to)
    gaps = []
    if not (b.attributes or []):
        gaps.append("highlights")
    if len([x for x in (b.services or []) if x.get("name")]) < 3:
        gaps.append("services (add at least 3)")
    if (b.photo_count or 0) < 10:
        gaps.append(f"photos ({b.photo_count or 0} of 10)")
    if len(b.description or "") < 250:
        gaps.append("a longer description")
    if linked and gaps:
        add("medium", "The Google profile is missing: " + ", ".join(gaps), "A complete profile gets more calls, directions and website visits.", "/gmb-profile?tab=profile&sub=edit")
    if counts["keywords_tracked"] and not counts["ranking_any"]:
        add("medium", "Keyword positions have not been read yet", f"{counts['keywords_tracked']} keywords are tracked but there is no position for any of them: run Position Tracking.", "/rank-tracking/landscape")
    if not counts["keywords_saved"] and counts["keywords_suggested"]:
        add("medium", f"{counts['keywords_suggested']} keyword suggestions are waiting", "Pick the ones to track so rankings can be measured.", "/keyword-management/ai")
    not_indexed = int(db.scalar(select(func.count()).select_from(IndexPage).where(IndexPage.business_id == b.id, IndexPage.g_state == "not_indexed")) or 0)
    if not_indexed:
        add("medium", f"{not_indexed} page{'s' if not_indexed != 1 else ''} not indexed by Google", "A page Google has not indexed cannot rank.", "/page-indexing")
    if not counts["backlinks"] and counts["backlinks_tracked"]:
        add("low", "No backlinks found yet", "Links from other sites are a main ranking factor: start with the link opportunities.", "/backlinks/opportunities")
    recent_article = db.scalar(select(func.count()).select_from(Article).where(Article.business_id == b.id, Article.status == "completed", Article.generated_at >= datetime.now(timezone.utc) - timedelta(days=30))) or 0
    if not recent_article:
        add("low", "No article written in the last 30 days", "Fresh content keeps the site growing: write one from Topic Research.", "/ai-content-generation/blog")
    if counts["fixes_open"]:
        add("low", f"{counts['fixes_open']} Growth Plan issue{'s' if counts['fixes_open'] != 1 else ''} still open", f"{counts['fixes_done']} of {counts['fixes_total']} are fixed.", "/growth")
    out.sort(key=lambda x: _LEVEL[x["level"]])
    return out[:8]


def humanize(action: str) -> str:
    return ACTION_WORDS.get(action) or action.replace("_", " ").replace(".", " ").strip().capitalize()


def _d(x: date | datetime | None) -> date | None:
    return x.date() if isinstance(x, datetime) else x


def build(db: Session, b: Business, range_key: str = "all", start: date | None = None, end: date | None = None, group: str | None = None) -> dict[str, Any]:
    # ---- every dated thing stored for the project (nothing is cut off here: the range is applied below)
    ins = db.execute(select(InsightDay.day, InsightDay.calls, InsightDay.directions, InsightDay.website_clicks, InsightDay.views_search, InsightDay.views_maps).where(InsightDay.business_id == b.id)).all()
    own = bl_summary.own_site_links(db, b.id)  # what our own bot has found for the project's site: None when no site is tracked
    links_new: list[datetime | None] = []
    if own:
        links_new = [_tz(x) for x in db.scalars(select(Backlink.first_seen_at).join(TargetDomain, TargetDomain.id == Backlink.target_domain_id)
                                                 .where(TargetDomain.registrable_domain == own["domain"], Backlink.current_status.in_(LIVE_STATES), Backlink.first_seen_at.is_not(None))).all()]
    events: dict[str, tuple[list, list[int] | None]] = {
        "calls": ([r[0] for r in ins], [r[1] or 0 for r in ins]),
        "directions": ([r[0] for r in ins], [r[2] or 0 for r in ins]),
        "website_clicks": ([r[0] for r in ins], [r[3] or 0 for r in ins]),
        "views": ([r[0] for r in ins], [(r[4] or 0) + (r[5] or 0) for r in ins]),
        "reviews": ([_tz(x) for x in db.scalars(select(func.coalesce(Review.review_at, Review.created_at)).where(Review.business_id == b.id)).all()], None),
        "posts": ([_tz(x) for x in db.scalars(select(Post.published_at).where(Post.business_id == b.id, Post.status == "published", Post.published_at.is_not(None))).all()], None),
        "articles": ([_tz(x) for x in db.scalars(select(Article.generated_at).where(Article.business_id == b.id, Article.status == "completed", Article.generated_at.is_not(None))).all()], None),
        "fixes": ([_tz(x) for x in db.scalars(select(GrowthAction.verified_at).where(GrowthAction.business_id == b.id, GrowthAction.verified_at.is_not(None))).all()], None),
        "keywords": ([_tz(x) for x in db.scalars(select(Keyword.created_at).where(Keyword.business_id == b.id)).all()], None),
        "backlinks": (links_new, None),
        "leads": (list(db.scalars(select(Lead.lead_date).where(Lead.business_id == b.id, Lead.lead_date.is_not(None))).all()), None),
        "actions": ([_tz(x) for x in db.scalars(select(ActivityLog.created_at).where(ActivityLog.business_id == b.id)).all()], None),
    }
    audit_rows = db.execute(select(Audit.finished_at, Audit.score).where(Audit.business_id == b.id, Audit.status == "done", Audit.score.is_not(None), Audit.finished_at.is_not(None))).all()
    firsts = [d for d in (_d(x) for rows, _w in events.values() for x in rows) if d] + [_d(f) for f, _s in audit_rows] + [_d(b.created_at)]
    earliest = min((d for d in firsts if d), default=None)

    range_key, s, e, period, keys = plan(range_key, start, end, group, earliest)
    labels = [_label(k, period) for k in keys]
    in_range = lambda x, a, z: (d := _d(x)) is not None and a <= d <= z  # noqa: E731
    days = (e - s).days + 1

    def total(name: str, a: date, z: date) -> int:
        rows, w = events[name]
        return sum((w[i] if w else 1) for i, r in enumerate(rows) if in_range(r, a, z))

    health: dict[date, list[int]] = defaultdict(list)
    for fin, sc in audit_rows:
        k = _key(fin, period)
        if k in keys:
            health[k].append(sc)
    health_series = [round(sum(health[k]) / len(health[k])) if health.get(k) else None for k in keys]

    series = {name: _series(rows, period, keys, w) for name, (rows, w) in events.items()}
    movement: dict[str, Any] = {}
    for name in events:
        now = total(name, s, e)
        if range_key == "all":
            movement[name] = {"total": now, "before": None, "delta": 0, "pct": None, "compare": False}
        else:
            before = total(name, s - timedelta(days=days), s - timedelta(days=1))  # the same number of days just before
            movement[name] = {"total": now, "before": before, "delta": now - before, "pct": round((now - before) / before * 100) if before else None, "compare": True}

    # ---- counts of what exists
    def count(model, *where) -> int:
        return int(db.scalar(select(func.count()).select_from(model).where(model.business_id == b.id, *where)) or 0)

    rating = db.execute(select(func.avg(Review.rating), func.count()).where(Review.business_id == b.id, Review.rating.is_not(None))).one()
    ranks = [r for r in db.scalars(select(Keyword.rank).where(Keyword.business_id == b.id, Keyword.tracked.is_(True))).all() if r]
    opp = dict(db.execute(select(BiOpportunity.status, func.count()).where(BiOpportunity.business_id == b.id).group_by(BiOpportunity.status)).all())
    acts_total = db.execute(select(GrowthAction.status, func.count()).where(GrowthAction.business_id == b.id).group_by(GrowthAction.status)).all()
    by_status = {s: n for s, n in acts_total}
    counts = {
        "keywords_saved": count(Keyword), "keywords_tracked": count(Keyword, Keyword.tracked.is_(True)), "keywords_suggested": count(KeywordCandidate),
        "ranking_top3": sum(1 for r in ranks if r <= 3), "ranking_top10": sum(1 for r in ranks if r <= 10), "ranking_top20": sum(1 for r in ranks if r <= 20), "ranking_any": len(ranks),
        "backlinks": own["backlinks"] if own else 0, "referring_domains": own["referring_domains"] if own else 0, "backlinks_verified": own["crawler_verified"] if own else 0,
        "backlinks_tracked": own is not None, "link_opportunities": sum(opp.values()), "link_opportunities_live": opp.get("live", 0), "link_opportunities_contacted": opp.get("contacted", 0),
        "articles": count(Article, Article.status == "completed"),
        "articles_live": count(Article, Article.wp_status == "publish") + count(Article, Article.react_status == "publish"),
        "posts_published": count(Post, Post.status == "published"), "posts_waiting": count(Post, Post.status.in_(("draft", "scheduled"))),
        "reviews": int(rating[1] or 0), "rating": round(float(rating[0]), 1) if rating[0] else None,
        "reviews_unreplied": count(Review, Review.reply_status != "posted"),
        "leads": count(Lead), "backlink_checks": count(BacklinkCheck),
        "pages_known": count(IndexPage), "pages_indexed": count(IndexPage, IndexPage.g_state.in_(("indexed", "INDEXED", "Submitted and indexed", "PASS"))),
        "fixes_total": sum(by_status.values()), "fixes_done": by_status.get("verified", 0), "fixes_open": sum(v for k, v in by_status.items() if k in ("todo", "done", "unverified", "failed")),
        "approvals_waiting": int(db.scalar(select(func.count()).select_from(AgentTask).where(AgentTask.business_id == b.id, AgentTask.status == "pending")) or 0),
    }

    # ---- actions taken
    q = select(ActivityLog).where(ActivityLog.business_id == b.id)
    if range_key != "all":
        q = q.where(ActivityLog.created_at >= datetime.combine(s, datetime.min.time(), tzinfo=timezone.utc), ActivityLog.created_at < datetime.combine(e + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc))
    recent = db.scalars(q.order_by(ActivityLog.id.desc()).limit(40)).all()
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
    kws = db.scalars(select(Keyword).where(Keyword.business_id == b.id).order_by(Keyword.tracked.desc(), Keyword.rank.is_(None), Keyword.rank, Keyword.volume.desc().nulls_last()).limit(8)).all()
    top_keywords = [{"keyword": k.keyword, "rank": k.rank, "prev_rank": k.prev_rank, "volume": k.volume, "tracked": bool(k.tracked), "url": k.target_url} for k in kws]
    top_links: list[dict[str, Any]] = []
    if own:
        for bl, src in db.execute(select(Backlink, SourceDomain.registrable_domain).join(TargetDomain, TargetDomain.id == Backlink.target_domain_id)
                                  .join(SourceDomain, SourceDomain.id == Backlink.source_domain_id)
                                  .where(TargetDomain.registrable_domain == own["domain"], Backlink.current_status.in_(LIVE_STATES)).order_by(Backlink.first_seen_at.desc().nulls_last()).limit(6)).all():
            top_links.append({"from": src, "anchor": bl.anchor_text, "first_seen": bl.first_seen_at.isoformat() if bl.first_seen_at else None, "verified": bl.verification_status == "CRAWLER_VERIFIED"})
    done_tasks = db.scalars(select(AgentTask).where(AgentTask.business_id == b.id, AgentTask.status.in_(("applied", "approved", "scheduled"))).order_by(AgentTask.id.desc()).limit(6)).all()

    return {
        "attention": attention(db, b, counts),
        "range": {"key": range_key, "start": s.isoformat(), "end": e.isoformat(), "days": days, "group": period, "earliest": earliest.isoformat() if earliest else None},
        "period": period, "labels": labels, "starts": [k.isoformat() for k in keys], "series": series, "health": health_series, "movement": movement, "counts": counts, "timeline": timeline,
        "top_keywords": top_keywords, "latest_backlinks": top_links, "backlink_domain": own["domain"] if own else None,
        "recent_tasks": [{"title": t.title, "status": t.status, "kind": t.kind, "at": t.updated_at.isoformat() if t.updated_at else None} for t in done_tasks],
    }
