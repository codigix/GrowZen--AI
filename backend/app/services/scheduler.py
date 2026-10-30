"""Background scheduler: every tick it reads the onboarding mailbox, runs the pipeline for new
emails, runs due per-business jobs, and applies autopilot tasks. Run one instance only."""
import logging
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import text

from ..config import get_settings
from ..db import SessionLocal
from . import intake, jobs, pipeline, schedules

log = logging.getLogger("seo.scheduler")
_scheduler: BackgroundScheduler | None = None


LAST_TICK: dict[str, object] = {"at": None, "result": None}


def tick() -> dict[str, int]:
    db = SessionLocal()
    out = {"emails": 0, "onboarded": 0, "jobs": 0, "recovered": 0}
    locked = False
    try:
        if db.bind.dialect.name == "postgresql":  # two processes must never run the same jobs twice
            locked = bool(db.execute(text("select pg_try_advisory_lock(7310042)")).scalar())
            if not locked:
                return out
        out["recovered"] = jobs.recover_stale(db)
        jobs.prune(db)
        try:
            out["emails"] = len(intake.poll_imap(db))
        except Exception as exc:
            log.warning("IMAP poll failed: %s", exc)
        out["onboarded"] = pipeline.process_waiting(db)
        out["jobs"] = schedules.run_due(db)
    finally:
        if locked:
            db.execute(text("select pg_advisory_unlock(7310042)"))
        db.close()
        LAST_TICK.update(at=datetime.now(timezone.utc).isoformat(), result=out)
    return out


def bot_tick() -> None:
    """Run the backlink discovery bot for businesses whose interval has elapsed (separate job: a run can take minutes)."""
    from ..backlinks import bot, router as bl_router
    db = SessionLocal()
    try:
        bot.run_due(db, bl_router.get_fetcher())
        from ..backlinks import outcomes, watch
        outcomes.measure_due(db)
        watch.run_due(db, bl_router.get_fetcher())  # weekly competitor visits (each business only when a week has passed)
    except Exception as exc:
        log.warning("Backlink bot tick failed: %s", exc)
    finally:
        db.close()


def start() -> None:
    global _scheduler
    s = get_settings()
    if not s.scheduler_enabled or _scheduler:
        return
    _scheduler = BackgroundScheduler(timezone="UTC")
    _scheduler.add_job(tick, "interval", seconds=s.scheduler_tick_seconds, id="seo-tick", max_instances=1, coalesce=True)
    _scheduler.add_job(bot_tick, "interval", seconds=60, id="backlink-bot", max_instances=1, coalesce=True)
    _scheduler.start()
    log.info("Scheduler started (every %ss)", s.scheduler_tick_seconds)


def stop() -> None:
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
