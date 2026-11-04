"""Background scheduler: every tick it reads the onboarding mailbox, runs the pipeline for new
emails, runs due per-business jobs, and applies autopilot tasks. Run one instance only."""
import logging
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import select, text

from ..config import get_settings
from ..db import SessionLocal
from . import intake, jobs, pipeline, schedules, site_publish

log = logging.getLogger("seo.scheduler")
_scheduler: BackgroundScheduler | None = None


LAST_TICK: dict[str, object] = {"at": None, "result": None}


def tick() -> dict[str, int]:
    db = SessionLocal()
    out = {"emails": 0, "onboarded": 0, "jobs": 0, "recovered": 0, "posts": 0}
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
        try:  # projects created before a job type existed get its schedule row (weekly plan, monthly site research)
            from ..models import Business
            for b in db.scalars(select(Business).where(Business.status != "paused")):
                schedules.ensure_jobs(db, b)
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            log.warning("Schedule backfill failed: %s", exc)
        out["jobs"] = schedules.run_due(db)
        out["posts"] = site_publish.run_due_scheduled(db)  # blog posts held for a chosen time
    finally:
        if locked:
            db.execute(text("select pg_advisory_unlock(7310042)"))
        db.close()
        LAST_TICK.update(at=datetime.now(timezone.utc).isoformat(), result=out)
    return out


def bot_tick() -> None:
    """Run the backlink discovery bot (separate job). With rotation on, businesses crawl in batches that take turns (backlinks/rotation.py);
    the tick only starts or checks the batch's threads, so it returns at once. Without rotation, each business whose interval has elapsed runs here."""
    from ..backlinks import bot, rotation, router as bl_router
    db = SessionLocal()
    try:
        if get_settings().backlink_rotation_enabled:
            rotation.tick(db)
        else:
            bot.run_due(db, bl_router.get_fetcher())
        from ..backlinks import outcomes, watch
        outcomes.measure_due(db)
        watch.run_due(db, bl_router.get_fetcher())  # weekly competitor visits (each business only when a week has passed)
    except Exception as exc:
        log.warning("Backlink bot tick failed: %s", exc)
    finally:
        db.close()


def posts_tick() -> int:
    """Articles scheduled in GrowZen, checked every minute (the main tick is slower). Rows are claimed one by one, so
    this and the main tick can never publish the same post twice."""
    db = SessionLocal()
    try:
        return site_publish.run_due_scheduled(db)
    except Exception as exc:
        log.warning("Scheduled posts tick failed: %s", exc)
        return 0
    finally:
        db.close()


def start() -> None:
    global _scheduler
    s = get_settings()
    if not s.scheduler_enabled or _scheduler:
        return
    _scheduler = BackgroundScheduler(timezone="UTC")
    _scheduler.add_job(tick, "interval", seconds=s.scheduler_tick_seconds, id="seo-tick", max_instances=1, coalesce=True)
    _scheduler.add_job(posts_tick, "interval", seconds=s.scheduled_posts_tick_seconds, id="scheduled-posts", max_instances=1, coalesce=True)
    if s.backlink_bot_auto_enabled:
        _scheduler.add_job(bot_tick, "interval", seconds=60, id="backlink-bot", max_instances=1, coalesce=True)
    _scheduler.start()
    log.info("Scheduler started (every %ss)", s.scheduler_tick_seconds)


def stop() -> None:
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
