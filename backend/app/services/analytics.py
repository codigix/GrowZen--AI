"""Growth over time across every client, for the dashboard charts. Everything is read from what the platform
stored (audits, rank scans, Google insights, leads, reviews, agent tasks, projects); nothing is estimated.
Weekly points, oldest first, ending with the current week. A week with no data is null, not zero, so a chart
shows a gap instead of a fake drop."""
from collections import defaultdict
from datetime import date, datetime, timedelta
from statistics import mean
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import AgentTask, Audit, Business, InsightDay, Lead, RankScan, Review


def _week(d: date | datetime | None, start: date) -> int | None:
    """Index of the week `d` falls in (0 = oldest), or None when it is outside the window."""
    if d is None:
        return None
    d = d.date() if isinstance(d, datetime) else d
    i = (d - start).days // 7
    return i if i >= 0 else None


def summary(db: Session, weeks: int = 12) -> dict[str, Any]:
    weeks = max(4, min(weeks, 26))
    today = date.today()
    start = today - timedelta(days=today.weekday()) - timedelta(weeks=weeks - 1)  # Monday of the oldest week
    labels = [(start + timedelta(weeks=i)) for i in range(weeks)]
    since = datetime.combine(start, datetime.min.time())

    def bucket() -> list[list]:
        return [[] for _ in range(weeks)]

    def avg(rows: list[list], nd: int = 0) -> list[float | None]:
        return [round(mean(r), nd) if r else None for r in rows]

    def inside(i: int | None) -> bool:
        return i is not None and i < weeks

    # Health: average finished-audit score per week.
    health, sample = bucket(), 0
    for score, finished, source in db.execute(select(Audit.score, Audit.finished_at, Audit.data_source).where(
            Audit.status == "done", Audit.score.is_not(None), Audit.business_id.is_not(None), Audit.finished_at >= since)):
        i = _week(finished, start)
        if inside(i):
            health[i].append(score)
            sample += source == "sample"

    # Rankings: average local rank (lower is better) and grid points in the top 3, from the rank scans.
    rank, top3, found, scans = bucket(), [0] * weeks, [0] * weeks, 0
    for avg_rank, t3, f, created in db.execute(select(RankScan.avg_rank, RankScan.top3, RankScan.found, RankScan.created_at).where(RankScan.created_at >= since)):
        i = _week(created, start)
        if inside(i):
            scans += 1
            if avg_rank is not None:
                rank[i].append(avg_rank)
            top3[i] += t3 or 0
            found[i] += f or 0

    # Customers: Google calls / directions / website clicks, and leads by type.
    actions = {k: [0] * weeks for k in ("calls", "directions", "website_clicks")}
    has_actions = [False] * weeks
    for day, c, d, w in db.execute(select(InsightDay.day, InsightDay.calls, InsightDay.directions, InsightDay.website_clicks).where(InsightDay.day >= start)):
        i = _week(day, start)
        if inside(i):
            actions["calls"][i] += c or 0
            actions["directions"][i] += d or 0
            actions["website_clicks"][i] += w or 0
            has_actions[i] = True
    leads = [0] * weeks
    lead_types: dict[str, int] = defaultdict(int)
    for kind, day, status in db.execute(select(Lead.lead_type, Lead.lead_date, Lead.status).where(Lead.lead_date >= start)):
        i = _week(day, start)
        if inside(i):
            leads[i] += 1
            lead_types[kind or "other"] += 1

    # Reputation: new reviews per week and their average rating.
    review_n, review_rating = [0] * weeks, bucket()
    for rating, day in db.execute(select(Review.rating, Review.review_date).where(Review.review_date >= start)):
        i = _week(day, start)
        if inside(i):
            review_n[i] += 1
            review_rating[i].append(rating)

    # AI work: changes the agents proposed, and those applied.
    proposed, applied = [0] * weeks, [0] * weeks
    for created, status, applied_at in db.execute(select(AgentTask.created_at, AgentTask.status, AgentTask.applied_at).where(AgentTask.created_at >= since)):
        i = _week(created, start)
        if inside(i):
            proposed[i] += 1
        j = _week(applied_at, start) if status == "applied" else None
        if inside(j):
            applied[j] += 1

    # Portfolio growth: projects added each week and the running total.
    created_at = sorted(c.date() for (c,) in db.execute(select(Business.created_at)) if c)
    before = sum(1 for d in created_at if d < start)
    added = [0] * weeks
    for d in created_at:
        i = _week(d, start)
        if inside(i):
            added[i] += 1
    total, running = before, []
    for n in added:
        total += n
        running.append(total)

    series = [{
        "week": labels[i].isoformat(), "health": avg(health)[i], "avg_rank": avg(rank, 1)[i], "top3": top3[i], "found": found[i],
        "calls": actions["calls"][i] if has_actions[i] else None, "directions": actions["directions"][i] if has_actions[i] else None,
        "website_clicks": actions["website_clicks"][i] if has_actions[i] else None, "leads": leads[i],
        "reviews": review_n[i], "rating": avg(review_rating, 2)[i], "proposed": proposed[i], "applied": applied[i],
        "projects": running[i], "added": added[i],
    } for i in range(weeks)]

    def change(key: str) -> float | None:
        """Last two weeks that have a value for `key`: how much it moved."""
        have = [p[key] for p in series if p[key] is not None]
        return round(have[-1] - have[-2], 1) if len(have) >= 2 else None

    return {
        "weeks": weeks, "series": series,
        "lead_types": dict(lead_types),
        "notes": {"sample_audits": sample, "rank_scans": scans},
        "change": {k: change(k) for k in ("health", "avg_rank", "leads", "calls", "rating", "projects")},
    }
