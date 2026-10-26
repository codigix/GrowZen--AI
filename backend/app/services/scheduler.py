"""Background scheduler: every tick it reads the onboarding mailbox, runs the pipeline for new
emails, runs due per-business jobs, and applies autopilot tasks. Run one instance only."""
import logging

from apscheduler.schedulers.background import BackgroundScheduler

from ..config import get_settings
from ..db import SessionLocal
from . import intake, pipeline, schedules

log = logging.getLogger("seo.scheduler")
_scheduler: BackgroundScheduler | None = None


def tick() -> dict[str, int]:
    db = SessionLocal()
    out = {"emails": 0, "onboarded": 0, "jobs": 0}
    try:
        try:
            out["emails"] = len(intake.poll_imap(db))
        except Exception as exc:
            log.warning("IMAP poll failed: %s", exc)
        out["onboarded"] = pipeline.process_waiting(db)
        out["jobs"] = schedules.run_due(db)
    finally:
        db.close()
    return out


def start() -> None:
    global _scheduler
    s = get_settings()
    if not s.scheduler_enabled or _scheduler:
        return
    _scheduler = BackgroundScheduler(timezone="UTC")
    _scheduler.add_job(tick, "interval", seconds=s.scheduler_tick_seconds, id="seo-tick", max_instances=1, coalesce=True)
    _scheduler.start()
    log.info("Scheduler started (every %ss)", s.scheduler_tick_seconds)


def stop() -> None:
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
