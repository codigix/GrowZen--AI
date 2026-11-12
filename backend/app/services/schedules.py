"""Per-business schedules and the job runner the scheduler calls."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import DataUnavailable
from ..models import Business, Schedule
from . import agent, notify, project_services, audits, gbp, geo, reports, organic, workplan
from .activity import log
from .playbook import get_playbook

INTERVALS = {"daily": 1, "weekly": 7, "fortnightly": 14, "monthly": 30}
JOBS = ["full_audit", "rank_scan", "reviews", "posts", "technical", "report", "geo", "weekly_plan", "site_research", "site_crawl"]
# Jobs every plan gets even when the playbook saved before they existed has no entry for them.
JOB_DEFAULTS = {"weekly_plan": "weekly", "site_research": "monthly"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def next_run(every: str, after: datetime | None = None) -> datetime | None:
    days = INTERVALS.get(every)
    return (after or _now()) + timedelta(days=days) if days else None


def create_for_plan(db: Session, b: Business) -> list[Schedule]:
    plan = get_playbook(db).plan_schedules.get(b.plan or "Starter") or get_playbook(db).plan_schedules["Starter"]
    rows = []
    for job in JOBS:
        if not project_services.job_enabled(b, job):
            continue  # a service removed from the project
        every = plan.get(job, JOB_DEFAULTS.get(job, "off"))
        row = db.scalar(select(Schedule).where(Schedule.business_id == b.id, Schedule.job == job)) or Schedule(business_id=b.id, job=job)
        row.every = every
        row.next_run_at = next_run(every)
        db.add(row)
        rows.append(row)
    db.commit()
    return rows


def ensure_jobs(db: Session, b: Business) -> int:
    """Add the schedule rows a project lacks (new job types, older projects) without touching the ones a person already changed."""
    plan = get_playbook(db).plan_schedules.get(b.plan or "Starter") or get_playbook(db).plan_schedules["Starter"]
    have = {j for (j,) in db.execute(select(Schedule.job).where(Schedule.business_id == b.id))}
    n = 0
    for job in JOBS:
        if job not in have and project_services.job_enabled(b, job):
            every = plan.get(job, JOB_DEFAULTS.get(job, "off"))
            db.add(Schedule(business_id=b.id, job=job, every=every, next_run_at=_now() if job in JOB_DEFAULTS and every != "off" else next_run(every)))
            n += 1
    if n:
        db.commit()
    return n


def run_job(db: Session, s: Schedule) -> None:
    b = db.get(Business, s.business_id)
    if not b or b.status == "paused" or not project_services.job_enabled(b, s.job):
        return
    if s.job == "full_audit":
        found = audits.run_all(db, b)
        agent.plan_from_audits(db, b, [i for a in found if a.status == "done" for i in a.issues], audited=[a.kind for a in found if a.status == "done"])
    elif s.job == "rank_scan":
        audits.run(db, b, "rankings")
        if b.website and organic.intel.serper_enabled():  # the organic positions too, so the history grows without anyone pressing a button
            try:
                organic.check(db, b)
            except organic.RankCheckError as exc:
                log(db, "scheduler", "rank_check_skipped", b.id, error=str(exc)[:200])
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
    elif s.job == "weekly_plan":
        workplan.weekly_cycle(db, b)
    elif s.job == "site_research":
        workplan.research_cycle(db, b)
    elif s.job == "site_crawl":  # the Site Audit settings' own schedule
        a = audits.run(db, b, "onpage")
        if (b.audit_config or {}).get("email") and a.status == "done" and b.contact_email:
            n = len(a.issues or [])
            notify.send_email(b.contact_email, f"Site audit finished: {b.name}", f"The scheduled site audit of {b.website} is complete.\nScore: {a.score}/100. Issues found: {n}.\nOpen Site Audit to see them.")


def run_due(db: Session, limit: int = 20) -> int:
    """Run every schedule whose time has come (oldest first)."""
    due = list(db.scalars(select(Schedule).where(Schedule.every != "off", Schedule.next_run_at.is_not(None), Schedule.next_run_at <= _now()).order_by(Schedule.next_run_at).limit(limit)))
    for s in due:
        try:
            run_job(db, s)
            s.last_status, s.last_error = "ok", None
        except DataUnavailable as exc:  # a key is not set up: the job is skipped (and says why), never run on invented data
            db.rollback()
            s.last_status, s.last_error = "skipped", exc.message[:500]
            log(db, "scheduler", "job_skipped", s.business_id, job=s.job, reason=exc.message[:200])
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
