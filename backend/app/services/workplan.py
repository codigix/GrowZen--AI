"""Weekly work plan and reports for every project.

Each Monday-to-Sunday week a project gets a list of work items. They come from four places: fixes the audits report, improvements from the site research
(see site_research.py), the recurring operations the project's plan includes (Google post, review replies, rank check, content, links), and anything a
person adds. Work that is not finished carries into the next week (and says how many times); work the next audit/research no longer reports is closed as
"verified". The same items drive the reports: a weekly report says what was planned and done last week, what changed this week (scores, rankings, links,
operations) and what is next; the monthly report rolls the weeks up. Nothing is invented: every figure is counted from stored rows.
"""
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..backlinks.models import Backlink, BacklinkEvent, BiDomain
from ..backlinks.summary import own_site_links
from ..models import AgentTask, Article, Audit, Business, Keyword, KeywordRankLog, Post, Review, Schedule, SiteProfile, WeeklyReport, WorkItem
from . import ai, audits, ranking_checklist, site_research, task_detail
from .activity import log

logger = logging.getLogger("seo.workplan")

STATUSES = ("todo", "doing", "done", "skipped", "backlog", "carried")
OPEN = ("todo", "doing", "backlog")
AREAS = ("gmb", "seo", "technical", "metadata", "content", "backlinks", "rankings", "reviews", "other")
CAPACITY = {"Starter": 6, "Growth": 10, "Pro": 14, "Agency": 18}  # improvement items per week (recurring operations are on top)
LEVEL_PRIORITY = {"critical": 1, "serious": 2, "warning": 3, "info": 4}
IMPACT_PRIORITY = {"High": 2, "Medium": 3, "Low": 4}
AUDIT_AREA = {"GBP": "gmb", "Rankings": "rankings", "Backlinks": "backlinks", "Citations": "backlinks", "On-page": "seo", "Images": "seo", "Links": "seo", "Content": "seo",
              "Structured data": "seo", "Technical": "technical", "Speed": "technical", "Performance": "technical", "Crawlability": "technical", "Indexing": "technical",
              "Security": "technical", "Mobile": "technical", "Website": "technical"}
REOPEN_AFTER_DAYS = 7  # a fix marked done that the next audit still reports comes back after this long


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    """SQLite hands datetimes back without a timezone; treat them as UTC so they can be compared."""
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def week_start(d: date | None = None) -> date:
    d = d or date.today()
    return d - timedelta(days=d.weekday())


def _span(period: str, start: date) -> tuple[date, date]:
    if period == "month":
        start = start.replace(day=1)
        return start, (date(start.year + (start.month == 12), start.month % 12 + 1, 1) - timedelta(days=1))
    start = week_start(start)
    return start, start + timedelta(days=6)


def _norm(x: Any) -> str:
    return " ".join(str(x or "").lower().split())


def serialize(i: WorkItem) -> dict[str, Any]:
    return {c: (getattr(i, c).isoformat() if isinstance(getattr(i, c), (date, datetime)) else getattr(i, c))
            for c in ("id", "business_id", "week_start", "key", "area", "title", "detail", "source", "priority", "impact", "status", "assignee", "due_date", "note",
                      "carried_from", "carry_count", "completed_at", "verified")}


# --- candidates: everything that could be done ----------------------------------------------------------------------------------------------------

def _audit_candidates(db: Session, b: Business) -> list[dict[str, Any]]:
    out = []
    for kind, a in audits.latest(db, b).items():
        if a.data_source == "sample":
            continue  # sample data is not a finding about this client
        for i in a.issues or []:
            if kind == "gbp" and i.get("key") in ("photos", "reviews", "reply_rate") and (b.gbp_location or b.place_id):
                continue  # the ranking checklist has a fuller task for these (review requests, replies, photos)
            ident = _norm(i.get("code") or i.get("title"))
            out.append({"key": f"audit:{kind}:{ident}"[:200], "area": AUDIT_AREA.get(i.get("area", ""), "seo"), "title": i["title"][:500], "source": "audit",
                        "priority": LEVEL_PRIORITY.get(i.get("level"), 3), "impact": {"critical": "High", "serious": "High", "warning": "Medium"}.get(i.get("level"), "Low"),
                        "detail": {"how": i.get("fix", ""), "why": i.get("why", ""), "pages": i.get("pages"), "code": i.get("code"), "audit_kind": kind, "audit_id": a.id, "level": i.get("level"), "issue_area": i.get("area")}})
    return out


def _research_candidates(db: Session, b: Business) -> list[dict[str, Any]]:
    prof = site_research.get(db, b)
    if not prof or prof.status != "done":
        return []
    return [{"key": r["key"][:200], "area": r["area"] if r["area"] in AREAS else "seo", "title": r["title"], "source": "research", "priority": IMPACT_PRIORITY.get(r["impact"], 3),
             "impact": r["impact"], "detail": {"how": r["how"], "why": r["why"], "effort": r["effort"], "rec_source": r["source"], "pages": r.get("pages"), "topics": r.get("topics")}}
            for r in prof.recommendations or []]


def _checklist_context(db: Session, b: Business) -> dict[str, Any]:
    onpage = audits.latest(db, b).get("onpage")
    pages = ((onpage.result or {}).get("pages") or []) if onpage and onpage.status == "done" else []
    unreplied = db.scalar(select(func.count(Review.id)).where(Review.business_id == b.id, Review.reply_status.in_(("none", "draft")))) or 0
    cannibal = 0
    latest_day = {}
    for kw, day, urls in db.execute(select(KeywordRankLog.keyword, KeywordRankLog.day, KeywordRankLog.own_urls).where(KeywordRankLog.business_id == b.id).order_by(KeywordRankLog.day.desc())):
        if kw not in latest_day:
            latest_day[kw] = True
            cannibal += 1 if len(urls or []) > 1 else 0
    return ranking_checklist.build_context(b, pages, audits.profile_stats(db, b), unreplied, cannibal)


def _checklist_candidates(db: Session, b: Business) -> tuple[list[dict[str, Any]], set[str]]:
    """The ranking checklist (website, Google profile and other places) as task candidates, plus the keys now confirmed fine."""
    ctx = _checklist_context(db, b)
    out = []
    for p in ranking_checklist.candidates(ctx):
        links = [(l[0], l[1]) for l in (p["links"] or [])]
        out.append({"key": ("chk:" + p["key"])[:200], "area": p["area"], "title": p["title"], "source": "checklist", "priority": p["priority"], "impact": p["impact"],
                    "detail": {"how": p["how"], "why": p["why"], "effort": p["effort"], "standing": p["standing"], "links_preset": links,
                               "example_only": True, "fix_help": {"where": [s.strip() for s in p["where"].split(" > ")], "platform": "n/a",
                                                                   **({"example": {"language": "text", "code": p["example"]}} if p["example"] else {})}}})
    return out, ranking_checklist.resolved(ctx)


def _schedule_on(db: Session, b: Business, job: str) -> bool:
    s = db.scalar(select(Schedule).where(Schedule.business_id == b.id, Schedule.job == job))
    return bool(s and s.every != "off")


def _operation_candidates(db: Session, b: Business, wk: date) -> list[dict[str, Any]]:
    """What the plan commits to every week. Keyed per week, so each week has its own copy."""
    tag = wk.isoformat()
    ops: list[tuple[str, str, str, str]] = []
    if _schedule_on(db, b, "posts"):
        ops.append(("gbp-post", "gmb", "Publish this week's Google Business Profile post", "Approve the drafted post (or write one) and publish it with a call to action."))
    if _schedule_on(db, b, "reviews"):
        ops.append(("reviews", "reviews", "Reply to every new review", "Reply to all new reviews within 48 hours; escalate 1-3 star reviews to the owner."))
    if _schedule_on(db, b, "rank_scan"):
        ops.append(("rank-review", "rankings", "Review ranking movement and note what changed", "Check the local grid and organic positions; record winners, losers and the likely reason."))
    if _schedule_on(db, b, "technical"):
        ops.append(("tech-check", "technical", "Check speed, indexing and mobile on the home page and top pages", "Run the technical audit; fix anything that got worse since last week."))
    if (b.plan or "Starter") != "Starter":
        ops.append(("content", "content", "Publish one new blog article or service page", "Pick a keyword from Keyword Management, generate the draft, edit it and publish it to the site."))
        ops.append(("backlinks", "backlinks", "Build new links: send outreach and follow up on last week's", "Work through the backlink opportunities list; record every link gained."))
    pending = db.scalar(select(func.count(AgentTask.id)).where(AgentTask.business_id == b.id, AgentTask.status == "pending", AgentTask.kind.in_(("gbp_post", "review_reply", "blog_draft", "outreach_email")))) or 0
    if pending:
        ops.append(("approve-drafts", "other", f"Review and approve the {pending} drafts waiting in AI Agents", "Open Autonomous AI Agents, edit or approve each draft."))
    return [{"key": f"op:{k}:{tag}", "area": area, "title": title, "source": "operation", "priority": 2, "impact": "Medium", "detail": {"how": how, "operation": k}} for k, area, title, how in ops]


# --- keeping items in step with reality -----------------------------------------------------------------------------------------------------------

def _verify(db: Session, b: Business, audit_keys: set[str], research_keys: set[str] | None, checklist_resolved: set[str] | None = None) -> int:
    """Close open items whose problem the latest audit/research no longer reports. Only what was actually re-checked is touched."""
    n = 0
    prof = site_research.get(db, b)
    checked_kinds = set(audits.latest(db, b))
    scanned = _aware(prof.scanned_at) if prof else None
    for it in db.scalars(select(WorkItem).where(WorkItem.business_id == b.id, WorkItem.status.in_(OPEN))):
        gone = (it.source == "checklist" and it.key in (checklist_resolved or set())) or (it.source == "audit" and it.key not in audit_keys and (it.detail or {}).get("audit_kind") in checked_kinds) or                (it.source == "research" and research_keys is not None and it.key not in research_keys and scanned and _aware(it.created_at) and scanned > _aware(it.created_at))
        if gone:
            it.status, it.verified, it.completed_at = "done", True, _now()
            it.note = (it.note + " " if it.note else "") + "Closed automatically: the latest check no longer reports this."
            log(db, "workplan", "work_item_verified", b.id, item_id=it.id, title=it.title)
            n += 1
    return n


def _blocked(existing: list[WorkItem]) -> bool:
    """True when this finding must not become a new item: it is already open, the team chose to skip it, or it was finished less than a week ago.
    A fix marked done a week ago that is still reported comes back (marked as re-opened)."""
    if any(e.status in OPEN or e.status == "skipped" for e in existing):
        return True
    if any(e.status == "done" and (e.detail or {}).get("standing") for e in existing):
        return True  # a one-off point (claiming a listing...) that was done stays done
    return any(e.status == "done" and e.completed_at and (_now() - _aware(e.completed_at)) < timedelta(days=REOPEN_AFTER_DAYS) for e in existing)


def _fix_context(db: Session, b: Business) -> dict[str, Any]:
    """What the worked examples need: the site's platform and the client's own name, city, category and first service."""
    prof = site_research.get(db, b)
    svc = next((s.get("name") for s in (b.services or []) if s.get("name")), "")
    return {"platform": (prof.stack or {}).get("platform") if prof else None,
            "biz": {"name": b.name, "city": b.city or b.area or "", "category": b.primary_category or "", "service": svc, "phone": b.phone or ""}}


def generate_week(db: Session, b: Business, wk: date | None = None) -> dict[str, Any]:
    """Plan the week (safe to call again: it only adds what is missing). Returns counts."""
    wk = week_start(wk)
    stats = {"week_start": wk.isoformat(), "carried": 0, "added": 0, "backlog": 0, "verified": 0}
    cands_audit, cands_rec = _audit_candidates(db, b), _research_candidates(db, b)
    cands_chk, chk_resolved = _checklist_candidates(db, b)
    prof = site_research.get(db, b)
    stats["verified"] = _verify(db, b, {c["key"] for c in cands_audit}, {c["key"] for c in cands_rec} if prof and prof.status == "done" else None, chk_resolved)

    # 1. unfinished work from earlier weeks moves into this one (never-started backlog moves silently; started work is counted as carried)
    for it in db.scalars(select(WorkItem).where(WorkItem.business_id == b.id, WorkItem.week_start < wk, WorkItem.status.in_(OPEN)).order_by(WorkItem.week_start)):
        if it.status == "backlog":
            it.week_start, it.due_date = wk, task_detail.due_for(wk, it.priority)
            continue
        if it.source == "operation":  # a missed weekly routine is not repeated: this week has its own
            it.status, it.note = "skipped", (it.note or "") + " Not done that week."
            continue
        new = WorkItem(business_id=b.id, week_start=wk, key=it.key, area=it.area, title=it.title, detail=it.detail, source=it.source, priority=max(1, it.priority - 1),
                       impact=it.impact, status="todo", assignee=it.assignee, due_date=task_detail.due_for(wk, max(1, it.priority - 1), (it.detail or {}).get("operation")), carried_from=it.id, carry_count=(it.carry_count or 0) + 1)
        it.status = "carried"
        db.add(new)
        stats["carried"] += 1
    db.flush()

    # 2. this week's recurring operations
    have = {i.key for i in db.scalars(select(WorkItem).where(WorkItem.business_id == b.id, WorkItem.week_start == wk))}
    gbp_url = ((b.gbp_status or {}).get("maps_url")) or None
    ctx = _fix_context(db, b)
    for c in _operation_candidates(db, b, wk):
        if c["key"] not in have:
            db.add(WorkItem(business_id=b.id, week_start=wk, due_date=task_detail.decorate(c, b.website, wk, gbp_url, **ctx), **c))
            stats["added"] += 1

    # 3. improvements: everything new is queued, then the best are promoted into the week up to the plan's capacity; the rest waits in the backlog
    by_key: dict[str, list[WorkItem]] = {}
    for it in db.scalars(select(WorkItem).where(WorkItem.business_id == b.id, WorkItem.source.in_(("audit", "research", "checklist")))):
        by_key.setdefault(it.key, []).append(it)
    for c in sorted(cands_audit + cands_rec + cands_chk, key=lambda c: (c["priority"], c["key"])):
        existing = by_key.get(c["key"], [])
        if _blocked(existing):
            continue
        detail = c["detail"] | ({"reopened": True} if any(e.status == "done" for e in existing) else {})
        c = c | {"detail": detail, "status": "backlog"}
        due = task_detail.decorate(c, b.website, wk, gbp_url, **ctx)
        db.add(WorkItem(business_id=b.id, week_start=wk, due_date=due, **c))
        stats["added"] += 1
    db.flush()
    committed = db.scalar(select(func.count(WorkItem.id)).where(WorkItem.business_id == b.id, WorkItem.week_start == wk, WorkItem.status.in_(("todo", "doing", "done")),
                                                                  WorkItem.source != "operation")) or 0
    room = max(0, CAPACITY.get(b.plan or "Starter", 6) - committed)
    for it in db.scalars(select(WorkItem).where(WorkItem.business_id == b.id, WorkItem.week_start == wk, WorkItem.status == "backlog").order_by(WorkItem.priority, WorkItem.id)):
        if room <= 0:
            break
        it.status = "todo"
        room -= 1
    stats["backlog"] = db.scalar(select(func.count(WorkItem.id)).where(WorkItem.business_id == b.id, WorkItem.status == "backlog")) or 0
    for it in db.scalars(select(WorkItem).where(WorkItem.business_id == b.id, WorkItem.status.in_(OPEN + ("done",)), WorkItem.source != "manual")):
        if not (it.detail or {}).get("description") or (it.source != "operation" and not (it.detail or {}).get("fix_help")):
            c = {"key": it.key, "title": it.title, "source": it.source, "priority": it.priority, "detail": dict(it.detail or {})}
            due = task_detail.decorate(c, b.website, it.week_start, gbp_url, **ctx)
            it.detail = c["detail"]
            it.due_date = it.due_date or due
    log(db, "workplan", "week_planned", b.id, **stats)
    db.commit()
    return stats


# --- editing -------------------------------------------------------------------------------------------------------------------------------------

def update_item(db: Session, it: WorkItem, changes: dict[str, Any], actor: str) -> WorkItem:
    if "status" in changes:
        new = changes["status"]
        if new == "done" and it.status != "done":
            it.completed_at = _now()
        if new != "done":
            it.completed_at, it.verified = None, False
        it.status = new
    for k in ("title", "assignee", "due_date", "note", "priority", "area"):
        if k in changes:
            setattr(it, k, changes[k])
    log(db, actor, "work_item_updated", it.business_id, item_id=it.id, changes={k: str(v) for k, v in changes.items()})
    db.commit()
    return it


def add_item(db: Session, b: Business, wk: date, title: str, area: str, actor: str, **kw: Any) -> WorkItem:
    it = WorkItem(business_id=b.id, week_start=week_start(wk), key=f"manual:{_now().timestamp():.0f}:{_norm(title)[:80]}", area=area, title=title, source="manual",
                  priority=kw.get("priority", 3), impact=kw.get("impact", "Medium"), assignee=kw.get("assignee"),
                  due_date=kw.get("due_date") or task_detail.due_for(week_start(wk), kw.get("priority", 3)),
                  detail={"how": kw.get("how", ""), "description": kw.get("how", "") or title, "priority_label": task_detail.PRIORITY_LABEL.get(kw.get("priority", 3)), "test_links": []})
    db.add(it)
    log(db, actor, "work_item_added", b.id, title=title)
    db.commit()
    return it


def week_items(db: Session, b: Business, wk: date) -> list[WorkItem]:
    return list(db.scalars(select(WorkItem).where(WorkItem.business_id == b.id, WorkItem.week_start == wk).order_by(WorkItem.priority, WorkItem.id)))


def progress(items: list[WorkItem]) -> dict[str, Any]:
    counted = [i for i in items if i.status not in ("backlog", "carried")]
    done = sum(1 for i in counted if i.status == "done")
    return {"planned": len(counted), "done": done, "doing": sum(1 for i in counted if i.status == "doing"), "todo": sum(1 for i in counted if i.status == "todo"),
            "skipped": sum(1 for i in counted if i.status == "skipped"), "carried_out": sum(1 for i in items if i.status == "carried"), "backlog": sum(1 for i in items if i.status == "backlog"),
            "completion_pct": round(done / len(counted) * 100) if counted else None}


# --- reports -------------------------------------------------------------------------------------------------------------------------------------

def _score_at(db: Session, b: Business, on: date) -> dict[str, int | None]:
    """The latest finished audit score of each kind on or before `on` (end of day)."""
    cutoff = datetime.combine(on + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    out: dict[str, int | None] = {}
    for a in db.scalars(select(Audit).where(Audit.business_id == b.id, Audit.status == "done", Audit.finished_at < cutoff).order_by(Audit.finished_at.desc())):
        if a.data_source != "sample":
            out.setdefault(a.kind, a.score)
    return out


def _score_changes(db: Session, b: Business, start: date, end: date) -> dict[str, Any]:
    before, after = _score_at(db, b, start - timedelta(days=1)), _score_at(db, b, end)
    kinds = sorted(set(before) | set(after))
    rows = {k: {"before": before.get(k), "now": after.get(k), "delta": (after[k] - before[k]) if before.get(k) is not None and after.get(k) is not None else None} for k in kinds}

    def avg(d: dict) -> int | None:
        v = [x for x in d.values() if x is not None]
        return round(sum(v) / len(v)) if v else None
    return {"by_area": rows, "overall_before": avg(before), "overall_now": avg(after)}


def _rank_at(db: Session, b: Business, kw: str, on: date) -> int | None | str:
    r = db.scalar(select(KeywordRankLog).where(KeywordRankLog.business_id == b.id, KeywordRankLog.keyword == kw, KeywordRankLog.day <= on).order_by(KeywordRankLog.day.desc()).limit(1))
    return "n/a" if r is None else r.rank


def _ranking_changes(db: Session, b: Business, start: date, end: date) -> list[dict[str, Any]]:
    kws = [k for (k,) in db.execute(select(KeywordRankLog.keyword).where(KeywordRankLog.business_id == b.id, KeywordRankLog.day <= end).distinct())]
    out = []
    for kw in kws[:40]:
        a, z = _rank_at(db, b, kw, start - timedelta(days=1)), _rank_at(db, b, kw, end)
        if z == "n/a":
            continue
        # null rank = outside the top 20; a lower number is better
        delta = (a - z) if isinstance(a, int) and isinstance(z, int) else None
        out.append({"keyword": kw, "before": None if a == "n/a" else a, "now": z, "delta": delta})
    out.sort(key=lambda r: -(abs(r["delta"]) if r["delta"] else 0))
    return out[:15]


def _link_changes(db: Session, b: Business, start: date, end: date) -> dict[str, Any] | None:
    own = own_site_links(db, b.id)
    if not own:
        return None
    out = {**own, "gained": 0, "lost": 0}
    lo, hi = datetime.combine(start, datetime.min.time()), datetime.combine(end + timedelta(days=1), datetime.min.time())
    for kind, key in (("NEW", "gained"), ("LOST_CONFIRMED", "lost")):
        out[key] = db.scalar(select(func.count(func.distinct(BacklinkEvent.backlink_id))).join(Backlink, Backlink.id == BacklinkEvent.backlink_id).join(BiDomain, BiDomain.id == Backlink.target_domain_id)
                             .where(BiDomain.registrable_domain == own["domain"], BacklinkEvent.event_type == kind, BacklinkEvent.event_at >= lo, BacklinkEvent.event_at < hi)) or 0
    return out


def _operations(db: Session, b: Business, start: date, end: date) -> dict[str, int]:
    lo, hi = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc), datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    c = lambda q: db.scalar(q) or 0  # noqa: E731
    return {
        "google_posts_published": c(select(func.count(Post.id)).where(Post.business_id == b.id, Post.status == "published", Post.published_at >= lo, Post.published_at < hi)),
        "reviews_replied": c(select(func.count(Review.id)).where(Review.business_id == b.id, Review.reply_status == "posted", Review.replied_at >= lo, Review.replied_at < hi)),
        "new_reviews": c(select(func.count(Review.id)).where(Review.business_id == b.id, Review.review_date >= start, Review.review_date <= end)),
        "articles_drafted": c(select(func.count(Article.id)).where(Article.business_id == b.id, Article.generated_at >= lo, Article.generated_at < hi)),
        "articles_published": c(select(func.count(Article.id)).where(Article.business_id == b.id, Article.wp_status == "publish", Article.updated_at >= lo, Article.updated_at < hi)),
        "agent_tasks_applied": c(select(func.count(AgentTask.id)).where(AgentTask.business_id == b.id, AgentTask.applied_at >= lo, AgentTask.applied_at < hi)),
        "audits_run": c(select(func.count(Audit.id)).where(Audit.business_id == b.id, Audit.status == "done", Audit.finished_at >= lo, Audit.finished_at < hi)),
    }


def _brief(i: WorkItem) -> dict[str, Any]:
    return {"id": i.id, "title": i.title, "area": i.area, "source": i.source, "status": i.status, "priority": i.priority, "impact": i.impact, "note": i.note, "verified": i.verified,
            "carry_count": i.carry_count, "assignee": i.assignee}


def _bucket_future(backlog: list[WorkItem], next_items: list[WorkItem]) -> list[dict[str, Any]]:
    """Future scope: what is already lined up, then the backlog by priority (soonest first)."""
    soon = [i for i in backlog if i.priority <= 2]
    month = [i for i in backlog if i.priority == 3]
    later = [i for i in backlog if i.priority >= 4]
    groups = [("Next week", [_brief(i) for i in next_items]), ("Next 2-4 weeks", [_brief(i) for i in soon]), ("Within 2 months", [_brief(i) for i in month]), ("Longer term", [_brief(i) for i in later])]
    return [{"horizon": h, "items": it[:12], "count": len(it)} for h, it in groups if it]


def build_report(db: Session, b: Business, period: str = "week", start: date | None = None, save: bool = True) -> dict[str, Any]:
    """The report for one week or month. The current (unfinished) period is rebuilt every time it is asked for; a finished period is kept as it was."""
    start, end = _span(period, start or date.today())
    if period == "week":
        pstart, pend = start - timedelta(days=7), start - timedelta(days=1)
    else:
        pend = start - timedelta(days=1)
        pstart = pend.replace(day=1)
    if save:
        saved = db.scalar(select(WeeklyReport).where(WeeklyReport.business_id == b.id, WeeklyReport.period == period, WeeklyReport.period_start == start))
        if saved and saved.final:
            return saved.data | {"id": saved.id, "narrative": saved.narrative, "final": True}

    def items_between(a: date, z: date) -> list[WorkItem]:
        return list(db.scalars(select(WorkItem).where(WorkItem.business_id == b.id, WorkItem.week_start >= week_start(a), WorkItem.week_start <= z).order_by(WorkItem.priority, WorkItem.id)))

    cur, prev = items_between(start, end), items_between(pstart, pend)
    cur_p, prev_p = progress(cur), progress(prev)
    completed = [i for i in cur if i.status == "done"]
    unfinished = [i for i in cur if i.status in ("todo", "doing")]
    next_start = end + timedelta(days=1)
    next_items = [i for i in db.scalars(select(WorkItem).where(WorkItem.business_id == b.id, WorkItem.week_start == week_start(next_start), WorkItem.status.in_(("todo", "doing"))))] if period == "week" else []
    backlog = list(db.scalars(select(WorkItem).where(WorkItem.business_id == b.id, WorkItem.status == "backlog").order_by(WorkItem.priority, WorkItem.id)))
    by_area: dict[str, int] = {}
    for i in completed:
        by_area[i.area] = by_area.get(i.area, 0) + 1
    scores, ranks, links, ops = _score_changes(db, b, start, end), _ranking_changes(db, b, start, end), _link_changes(db, b, start, end), _operations(db, b, start, end)
    prof = site_research.get(db, b)
    data: dict[str, Any] = {
        "business": {"id": b.id, "name": b.name, "plan": b.plan}, "period": period, "start": start.isoformat(), "end": end.isoformat(),
        "label": f"Week of {start.strftime('%d %b %Y')}" if period == "week" else start.strftime("%B %Y"),
        "previous": {"label": f"Week of {pstart.strftime('%d %b %Y')}" if period == "week" else pstart.strftime("%B %Y"), **prev_p,
                     "completed": [_brief(i) for i in prev if i.status == "done"][:25], "not_finished": [_brief(i) for i in prev if i.status in ("carried", "todo", "doing", "skipped")][:25]},
        "this_period": {**cur_p, "completed": [_brief(i) for i in completed][:40], "in_progress": [_brief(i) for i in unfinished][:40], "by_area": by_area,
                        "verified_by_audit": sum(1 for i in completed if i.verified), "carried_in": sum(1 for i in cur if i.carried_from)},
        "changes": {"scores": scores, "rankings": ranks, "backlinks": links, "operations": ops,
                    "metadata": {"coverage": (prof.metadata_audit or {}).get("coverage") if prof else None, "score": (prof.metadata_audit or {}).get("score") if prof else None},
                    "stack": (prof.stack or {}).get("stack") if prof else None},
        "next": {"label": "Next week" if period == "week" else "Next month", "planned": [_brief(i) for i in (next_items or unfinished)][:25]},
        "future_scope": _bucket_future(backlog, next_items or unfinished),
    }
    if period == "month":
        weeks = list(db.scalars(select(WeeklyReport).where(WeeklyReport.business_id == b.id, WeeklyReport.period == "week", WeeklyReport.period_start >= start, WeeklyReport.period_start <= end).order_by(WeeklyReport.period_start)))
        data["weeks"] = [{"start": w.period_start.isoformat(), "planned": w.data.get("this_period", {}).get("planned"), "done": w.data.get("this_period", {}).get("done"),
                          "completion_pct": w.data.get("this_period", {}).get("completion_pct")} for w in weeks]
        from . import reports as monthly  # GBP insights for the month (calls, directions...), already computed there
        try:
            m = monthly.monthly_summary(db, b, start.strftime("%Y-%m"))
            data["changes"]["insights"] = {"this": m["insights"], "previous": m["previous"], "leads": m["leads"], "new_reviews": m["new_reviews"]}
        except Exception as exc:  # noqa: BLE001
            logger.info("Monthly insights skipped: %s", exc)
    data["highlights"] = _highlights(data)
    narrative = _narrative(b, data)
    if save:
        row = db.scalar(select(WeeklyReport).where(WeeklyReport.business_id == b.id, WeeklyReport.period == period, WeeklyReport.period_start == start)) or WeeklyReport(business_id=b.id, period=period, period_start=start)
        row.period_end, row.data, row.narrative, row.final = end, data, narrative, end < date.today()
        db.add(row)
        db.commit()
        return data | {"id": row.id, "narrative": narrative, "final": row.final}
    return data | {"narrative": narrative, "final": False}


def _highlights(d: dict[str, Any]) -> list[str]:
    out, tp, pv, ch = [], d["this_period"], d["previous"], d["changes"]
    if tp["planned"]:
        out.append(f"{tp['done']} of {tp['planned']} planned tasks done ({tp['completion_pct']}%)" + (f"; previous {pv['label'].lower()}: {pv['done']} of {pv['planned']} ({pv['completion_pct']}%)" if pv["planned"] else ""))
    if tp["verified_by_audit"]:
        out.append(f"{tp['verified_by_audit']} fixes confirmed by the latest audit")
    s = ch["scores"]
    if s["overall_before"] is not None and s["overall_now"] is not None and s["overall_now"] != s["overall_before"]:
        out.append(f"Overall audit score {s['overall_before']} -> {s['overall_now']} ({s['overall_now'] - s['overall_before']:+d})")
    moved = [r for r in ch["rankings"] if r["delta"]]
    if moved:
        up = sum(1 for r in moved if r["delta"] > 0)
        out.append(f"{up} keywords moved up and {len(moved) - up} moved down")
    if ch["backlinks"] and (ch["backlinks"]["gained"] or ch["backlinks"]["lost"]):
        out.append(f"Links: {ch['backlinks']['gained']} gained, {ch['backlinks']['lost']} lost")
    o = ch["operations"]
    if o["google_posts_published"]:
        out.append(f"{o['google_posts_published']} Google posts published")
    if o["reviews_replied"]:
        out.append(f"{o['reviews_replied']} reviews replied to")
    if o["articles_published"]:
        out.append(f"{o['articles_published']} articles published")
    return out


def _narrative(b: Business, d: dict[str, Any]) -> str:
    nxt = [i["title"] for i in d["next"]["planned"][:3]]
    fallback = (f"{b.name}, {d['label']}: " + ("; ".join(d["highlights"]) + ". " if d["highlights"] else "No tracked activity in this period. ") +
                (f"Next: {'; '.join(nxt)}." if nxt else "Nothing is queued yet."))
    if not ai.is_configured() or not d["highlights"]:
        return fallback
    try:
        return ai.complete(f"You write short progress reports for a small business owner. Plain words, 4-6 sentences. Mention what was done, what changed, and what is next.\n{ai.RULES}",
                           f"Business: {b.name}\nUse only this data: highlights={d['highlights']}; completed={[i['title'] for i in d['this_period']['completed'][:8]]}; next={nxt}; future={[g['horizon'] for g in d['future_scope']]}", max_tokens=350)
    except Exception:  # noqa: BLE001
        return fallback


# --- the scheduled cycle -------------------------------------------------------------------------------------------------------------------------

def weekly_cycle(db: Session, b: Business) -> dict[str, Any]:
    """Close the week that just ended (a final report) and plan the new one. Safe to run at any time."""
    wk = week_start()
    last = wk - timedelta(days=7)
    build_report(db, b, "week", last)
    if last.month != date.today().month or wk.day <= 7:  # the first week of a month also closes the month before
        build_report(db, b, "month", last)
    stats = generate_week(db, b, wk)
    build_report(db, b, "week", wk)  # the live report for the week that starts now
    return stats


def research_cycle(db: Session, b: Business) -> None:
    """Re-research the website, then fold what it found into the plan."""
    site_research.run(db, b, refresh=True)
    generate_week(db, b)


def start_project(db: Session, b: Business, run_audits: bool = True) -> dict[str, Any]:
    """Everything that is done once when a project is onboarded: full audit, website research, schedules, the first week's plan."""
    from . import agent, schedules
    steps: dict[str, Any] = {}
    if run_audits:
        found = audits.run_all(db, b)
        agent.plan_from_audits(db, b, [i for a in found if a.status == "done" for i in a.issues], audited=[a.kind for a in found if a.status == "done"])
        steps["audits"] = [f"{a.kind}:{a.status}" for a in found]
    prof = site_research.run(db, b)
    steps["research"] = prof.status
    schedules.ensure_jobs(db, b)
    steps["plan"] = generate_week(db, b)
    build_report(db, b, "week", week_start())
    log(db, "workplan", "project_started", b.id, **{k: str(v) for k, v in steps.items()})
    db.commit()
    return steps


def start_in_background(db: Session, business_id: int) -> None:
    """Background entry point; never raises."""
    try:
        b = db.get(Business, business_id)
        if b is not None:
            start_project(db, b)
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("Project start failed for business %s", business_id)


def refresh_research_in_background(db: Session, business_id: int) -> None:
    """Background entry point for a changed website address: read the new site, then fold the findings into the plan. Never raises."""
    try:
        b = db.get(Business, business_id)
        if b is not None:
            research_cycle(db, b)
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("Research refresh failed for business %s", business_id)


def overview(db: Session, wk: date | None = None, ids: list[int] | None = None) -> list[dict[str, Any]]:
    """Every project's progress for one week (the cross-project view), from one query for all the week's items."""
    wk = week_start(wk)
    by_business: dict[int, list[WorkItem]] = {}
    for it in db.scalars(select(WorkItem).where(WorkItem.week_start == wk)):
        by_business.setdefault(it.business_id, []).append(it)
    out = []
    for b in db.scalars(select(Business).where(Business.status != "paused", *([Business.id.in_(ids)] if ids is not None else [])).order_by(Business.name)):
        items = by_business.get(b.id, [])
        late = sum(1 for i in items if i.status in ("todo", "doing") and i.due_date and i.due_date < date.today())
        out.append({"business_id": b.id, "name": b.name, "plan": b.plan, **progress(items), "overdue": late, "carried_in": sum(1 for i in items if i.carried_from)})
    return out
