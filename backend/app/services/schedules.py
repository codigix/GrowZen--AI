"""Per-business schedules and the job runner the scheduler calls."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, Schedule
from . import agent, audits, gbp, geo, reports
from .activity import log
from .playbook import get_playbook

INTERVALS = {"daily": 1, "weekly": 7, "fortnightly": 14, "monthly": 30}
JOBS = ["full_audit", "rank_scan", "reviews", "posts", "technical", "report", "geo"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def next_run(every: str, after: datetime | None = None) -> datetime | None:
    days = INTERVALS.get(every)
    return (after or _now()) + timedelta(days=days) if days else None


def create_for_plan(db: Session, b: Business) -> list[Schedule]:
    plan = get_playbook(db).plan_schedules.get(b.plan or "Starter") or get_playbook(db).plan_schedules["Starter"]
    rows = []
    for job in JOBS:
        every = plan.get(job, "off")
        row = db.scalar(select(Schedule).where(Schedule.business_id == b.id, Schedule.job == job)) or Schedule(business_id=b.id, job=job)
        row.every = every
        row.next_run_at = next_run(every)
        db.add(row)
        rows.append(row)
    db.commit()
    return rows


def run_job(db: Session, s: Schedule) -> None:
    b = db.get(Business, s.business_id)
    if not b or b.status == "paused":
        return
    if s.job == "full_audit":
        found = audits.run_all(db, b)
        agent.plan_from_audits(db, b, [i for a in found if a.status == "done" for i in a.issues])
    elif s.job == "rank_scan":
        audits.run(db, b, "rankings")
    elif s.job == "technical":
        audits.run(db, b, "technical")
    elif s.job == "reviews":
        if b.connection and b.gbp_location:
            gbp.sync_business(db, b, days=7)
        agent.draft_review_replies(db, b)
    elif s.job == "posts":
        agent.draft_weekly_post(db, b)
    elif s.job == "report":
        reports.send_monthly(db, b)
    elif s.job == "geo":
        geo.run_prompts(db, b)


def run_due(db: Session, limit: int = 20) -> int:
    """Run every schedule whose time has come (oldest first)."""
    due = list(db.scalars(select(Schedule).where(Schedule.every != "off", Schedule.next_run_at.is_not(None), Schedule.next_run_at <= _now()).order_by(Schedule.next_run_at).limit(limit)))
    for s in due:
        try:
            run_job(db, s)
            s.last_status, s.last_error = "ok", None
        except Exception as exc:
            db.rollback()
            s.last_status, s.last_error = "failed", str(exc)[:500]
            log(db, "scheduler", "job_failed", s.business_id, job=s.job, error=str(exc)[:200])
        s.last_run_at = _now()
        s.next_run_at = next_run(s.every)
        db.add(s)
        db.commit()
    agent.auto_apply_pending(db)
    return len(due)
