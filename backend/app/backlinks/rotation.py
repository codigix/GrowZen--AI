"""Batch rotation for the discovery bot: businesses take turns instead of all crawling at once.

The businesses whose bot is on (ordered by id) are served in batches of `backlink_batch_size`. One batch crawls in parallel, one thread per business,
for `backlink_batch_minutes`; then that batch stops and the next one starts. After the last batch the rotation wraps to the first again.
Example with 12 businesses and a batch of 5: [1-5] -> [6-10] -> [11-12] -> [1-5] (pass 2) -> ...

Nothing is done twice between passes: the frontier keeps one row per URL and never fetches a finished page again for discovery, so on its next turn
a business carries on with the pages it had not reached yet. Only each tracked site's front door is looked at again (once a day, see bot.seed_targets),
which is how new pages and new outbound links get found.

A batch whose businesses all run out of pages before the window ends hands over early. The window lives in the database (`bi_rotation_state`), so a
restart resumes the same batch for the time it has left. `tick` never blocks: the scheduler calls it every minute and it only starts or checks threads.
Run one scheduler instance only (as for the rest of the scheduler)."""
import logging
import threading
from collections.abc import Callable
from datetime import datetime, timedelta

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import SessionLocal, utcnow
from . import bot, engine, stop
from .models import BiBotConfig, BiRotationState, BiTrackedTarget

log = logging.getLogger("seo.backlinks.rotation")
MIN_CYCLE_SECONDS = 20  # do not start another run with less than this left in the window

_lock = threading.Lock()
_workers: dict[int, threading.Thread] = {}  # business id -> its crawl thread in this process
_finished: dict[int, datetime] = {}  # business id -> the window in which it ran out of pages (so it is not restarted in that window)


def _state(db: Session) -> BiRotationState:
    st = db.scalar(select(BiRotationState).order_by(BiRotationState.id).limit(1))
    if st is None:
        st = BiRotationState(batch=[], cursor=0, pass_number=1)
        db.add(st)
        db.commit()
    return st


def eligible(db: Session) -> list[int]:
    """Businesses that take part: bot switched on and at least one domain being monitored. In id order (= onboarding order)."""
    has_target = exists().where(BiTrackedTarget.business_id == BiBotConfig.business_id, BiTrackedTarget.monitoring_enabled.is_(True))
    return list(db.scalars(select(BiBotConfig.business_id).where(BiBotConfig.enabled.is_(True), has_target).order_by(BiBotConfig.business_id)))


def next_batch(ids: list[int], cursor: int, size: int) -> tuple[list[int], bool]:
    """The next `size` businesses after `cursor`; when none are left, start again from the first. Returns (batch, wrapped)."""
    if not ids:
        return [], False
    after = [i for i in ids if i > cursor]
    wrapped = not after and cursor > 0
    return (after or ids)[: max(1, size)], wrapped


def _active() -> set[int]:
    with _lock:
        for bid in [b for b, t in _workers.items() if not t.is_alive()]:
            del _workers[bid]
        return set(_workers)


def _cycle(db: Session, fetcher, business_id: int, window: datetime, deadline: datetime) -> bool:
    """One bot run for one business inside the window. False when it should not run again in this window (yet)."""
    left = (deadline - utcnow()).total_seconds()
    if left < MIN_CYCLE_SECONDS:
        return False
    if not db.scalar(select(BiBotConfig.enabled).where(BiBotConfig.business_id == business_id)):
        _finished[business_id] = window  # switched off (or deleted) during its turn: done for this window, not restarted every tick
        return False
    try:
        stats = bot.run_cycle(db, fetcher, business_id, budget_seconds=min(bot.TIME_BUDGET_SECONDS, left))
    except Exception:  # noqa: BLE001 - one business never stops the others; the next tick restarts it if its window is still open
        db.rollback()
        log.exception("Backlink rotation run failed for business %s", business_id)
        return False
    if "skipped" in stats:  # a run for this business is already going (e.g. the onboarding run): the next tick tries again
        return False
    if not stats.get("pages"):
        _finished[business_id] = window  # nothing left to crawl for now: let the batch hand over early
        return False
    return True


def _work(business_ids: list[int], window: datetime, deadline: datetime, fetcher_factory: Callable[[], engine.PageFetcher]) -> None:
    """The window's work for one thread: back-to-back bot runs until the window closes or there is nothing left to crawl.
    With several businesses (SQLite) they take turns run by run, so only one crawl writes to the database at a time."""
    db = SessionLocal()
    try:
        fetcher = fetcher_factory()  # own HTTP client per thread
        active = list(business_ids)
        while active and not stop.stopping():
            active = [bid for bid in active if not stop.stopping() and _cycle(db, fetcher, bid, window, deadline)]
    finally:
        db.close()


def _parallel(db: Session) -> bool:
    """PostgreSQL: one thread per business. SQLite allows one writer at a time and a crawl holds its write lock across a page fetch, so parallel
    threads there fail with "database is locked": the batch shares one thread instead (same window, same turns, just not simultaneous)."""
    return db.get_bind().dialect.name != "sqlite"


def _start(business_ids: list[int], window: datetime, deadline: datetime, fetcher_factory, spawn, parallel: bool) -> None:
    groups = [[bid] for bid in business_ids] if parallel else [list(business_ids)]
    for group in groups:
        if spawn is not None:  # tests: record or run inline
            for bid in group:
                spawn(_work, bid, window, deadline, fetcher_factory)
            continue
        t = threading.Thread(target=_work, args=(group, window, deadline, fetcher_factory), daemon=True, name=f"backlink-bot-{'-'.join(map(str, group))}")
        with _lock:
            for bid in group:
                _workers[bid] = t
        t.start()


def tick(db: Session, fetcher_factory: Callable[[], engine.PageFetcher] | None = None, now: datetime | None = None, spawn=None) -> dict:
    """Scheduler entry point (every minute). Keeps the current batch running until its window closes, then starts the next batch."""
    s = get_settings()
    now = now or utcnow()
    factory = fetcher_factory or engine.PageFetcher
    st = _state(db)
    alive = _active()
    window = engine.aware(st.window_started_at) if st.window_started_at else None
    deadline = window + timedelta(minutes=s.backlink_batch_minutes) if window else None

    if st.batch and deadline and now < deadline:
        todo = [b for b in st.batch if b not in alive and _finished.get(b) != window]
        if todo or alive:
            if todo and (deadline - now).total_seconds() >= MIN_CYCLE_SECONDS:  # not running: after a restart, or it stopped early
                _start(todo, window, deadline, factory, spawn, _parallel(db))
            else:
                todo = []
            return {"state": "running", "batch": st.batch, "window_ends_at": deadline, "started": todo}
        # every business in the batch ran out of pages: hand over early
    elif alive:
        return {"state": "closing", "batch": st.batch}  # window over; the threads stop after the page they are on

    batch, wrapped = next_batch(eligible(db), st.cursor or 0, s.backlink_batch_size)
    if not batch:
        st.batch, st.window_started_at = [], None
        db.commit()
        return {"state": "idle"}
    st.batch, st.cursor, st.window_started_at = batch, batch[-1], now
    if wrapped:
        st.pass_number = (st.pass_number or 1) + 1
    db.commit()
    deadline = now + timedelta(minutes=s.backlink_batch_minutes)
    _start(batch, now, deadline, factory, spawn, _parallel(db))
    log.info("Backlink rotation: pass %s, batch %s until %s", st.pass_number, batch, deadline.isoformat())
    return {"state": "started", "batch": batch, "window_ends_at": deadline, "pass": st.pass_number}


def status(db: Session, business_id: int) -> dict:
    """Where one business stands in the rotation, for the bot panel."""
    s = get_settings()
    st = _state(db)
    window = engine.aware(st.window_started_at) if st.window_started_at else None
    ids = eligible(db)
    ahead = None
    if business_id in ids and business_id not in (st.batch or []):
        cursor, ahead = st.cursor or 0, 0  # whole batches that run before its turn
        for _ in range(len(ids)):
            batch, _wrapped = next_batch(ids, cursor, s.backlink_batch_size)
            if business_id in batch:
                break
            cursor, ahead = batch[-1], ahead + 1
    return {"enabled": s.backlink_rotation_enabled, "batch_size": s.backlink_batch_size, "batch_minutes": s.backlink_batch_minutes,
            "pass": st.pass_number, "current_batch": st.batch or [], "in_current_batch": business_id in (st.batch or []),
            "window_started_at": window, "window_ends_at": window + timedelta(minutes=s.backlink_batch_minutes) if window else None,
            "batches_before_turn": ahead, "businesses_in_rotation": len(ids)}
