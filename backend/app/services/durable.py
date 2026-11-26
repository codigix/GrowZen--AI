"""Background jobs that survive a server restart.

Background work runs inside the web process, so a restart (a deploy, `pm2 restart`, a crash) kills whatever was running.
`durable(fn, *args)` is a drop-in for `in_background(fn, *args)`: it also writes the job to the database first and removes
it when the job ends. At start-up `resume_all` starts again every job still in the table, so the person's page keeps
waiting and then shows the result, instead of an "Interrupted, run it again" error.

Rules for a job: it must be a plain module-level function with JSON-able arguments, and running it twice must be safe
(it is restarted from the beginning, at most MAX_ATTEMPTS runs in all, so a crash loop cannot repeat it forever).
A lambda or an argument that is not JSON-able simply runs as before, without the restart cover.

Several backend processes may share one database. Every job row names its OWNER (this process) and the owner touches `heartbeat_at` every few seconds while it is alive. A job is taken over
by another process only when its owner has been quiet for `job_abandoned_seconds`, and the take-over is one conditional UPDATE, so exactly one process wins; a job that is alive is never
started a second time, whatever the number of processes. Abandoned jobs are looked for at start-up and every half minute afterwards, so a crash is recovered within about two minutes.

`refs` names the rows a job works on ("audit:12"). The start-up cleanups that fail unfinished rows ask `resuming()`
first and leave those rows alone, because their job is about to run again.
"""
import importlib
import json
import logging
import os
import socket
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from sqlalchemy import create_engine, delete, func, or_, select, update
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from ..db import SessionLocal, engine
from ..models import DurableJob

log = logging.getLogger("seo.durable")
MAX_ATTEMPTS = 3
_RESUMING: set[str] = set()
PROCESS_ID = f"{socket.gethostname()[:40]}:{os.getpid()}:{uuid.uuid4().hex[:8]}"  # who owns a job row; new for every start of the process, so a restarted process is a different owner


def _limits() -> tuple[int, int]:
    try:
        from ..config import get_settings  # noqa: PLC0415
        s = get_settings()
        return max(1, int(s.background_jobs_max)), max(1, int(s.background_resume_max))
    except Exception:  # noqa: BLE001
        return 10, 3


MAX_BACKGROUND_JOBS, MAX_RESUMED_AT_ONCE = _limits()  # background jobs this process runs at the same time (the others wait, in a sleeping thread that holds no connection); of those, jobs started again after a restart
_slots = threading.BoundedSemaphore(MAX_BACKGROUND_JOBS)
_resume_slots = threading.BoundedSemaphore(MAX_RESUMED_AT_ONCE)


def _times() -> tuple[int, int]:
    try:
        from ..config import get_settings  # noqa: PLC0415
        s = get_settings()
        return max(1, int(s.job_heartbeat_seconds)), max(5, int(s.job_abandoned_seconds))
    except Exception:  # noqa: BLE001
        return 10, 60


def _now() -> datetime:
    return datetime.now(timezone.utc)


_stop = threading.Event()
_beat_thread: threading.Thread | None = None
_beat_lock = threading.Lock()
_beat_engine = None
_last_reclaim = [0.0]


def _beat_bind():
    """Where the heartbeat (and the search for abandoned jobs) reads and writes. It uses its own connection, opened for each beat and closed at once, so a busy pool can never make a live job look
    dead and the heartbeat never takes a place from the requests. Only an in-memory SQLite database (which a second engine could not reach) uses the normal engine."""
    global _beat_engine
    if engine.dialect.name == "sqlite" and engine.url.database in (None, "", ":memory:"):
        return engine
    if _beat_engine is None:
        _beat_engine = create_engine(engine.url, poolclass=NullPool, connect_args={"connect_timeout": 5} if engine.dialect.name == "postgresql" else {})
    return _beat_engine


def beat_once() -> int:
    """Touch the heartbeat of every job this process owns. Returns how many rows were touched."""
    with _beat_bind().begin() as c:
        r = c.execute(update(DurableJob).where(DurableJob.owner == PROCESS_ID, DurableJob.status == "running").values(heartbeat_at=_now()))
        return r.rowcount or 0


def _beat_loop() -> None:
    every, _ = _times()
    while not _stop.wait(every):
        try:
            beat_once()
        except Exception as exc:  # noqa: BLE001 - one missed beat is harmless; the next one is tried at once
            log.warning("Job heartbeat failed: %s", exc)
        if time.monotonic() - _last_reclaim[0] >= 30:
            _last_reclaim[0] = time.monotonic()
            try:
                with Session(_beat_bind()) as db:
                    reclaim(db)
            except Exception as exc:  # noqa: BLE001
                log.warning("Looking for abandoned jobs failed: %s", exc)


def ensure_heartbeat() -> None:
    """Start this process's one heartbeat thread (also the one that looks for abandoned jobs). Safe to call again and again."""
    global _beat_thread
    with _beat_lock:
        if _beat_thread is not None and _beat_thread.is_alive():
            return
        _stop.clear()
        _last_reclaim[0] = time.monotonic()
        _beat_thread = threading.Thread(target=_beat_loop, daemon=True, name="job-heartbeat")
        _beat_thread.start()


def stop() -> None:
    """At shutdown: stop the heartbeat thread. The rows of jobs still running stay, go quiet, and another process (or the next start) takes them over."""
    global _beat_thread, _beat_engine
    _stop.set()
    t = _beat_thread
    if t is not None and t.is_alive() and t is not threading.current_thread():
        t.join(timeout=5)
    _beat_thread = None
    if _beat_engine is not None:
        _beat_engine.dispose()
        _beat_engine = None


def live_refs() -> set[str]:
    """Every ref of a job recorded as running by any process (or waiting to be taken over from a dead one). One query, for code that checks many rows."""
    with SessionLocal() as db:
        rows = db.scalars(select(DurableJob.refs).where(DurableJob.status == "running")).all()
    return {x for r in rows for x in (r or [])} | set(_RESUMING)


def alive(ref: str) -> bool:
    """True when a job working on `ref` (for example "xray:7") is recorded as running by ANY process, or is waiting to be taken over from a dead one. Other processes' work is invisible
    to in-memory registries, so code that must not call a run dead asks this."""
    if ref in _RESUMING:
        return True
    try:
        return ref in live_refs()
    except Exception:  # noqa: BLE001 - when in doubt, do not declare someone else's work dead
        return True


def bounded(fn: Callable, resumed: bool = False) -> Callable:
    """`fn`, but waiting for one of MAX_BACKGROUND_JOBS places before it runs (and one of MAX_RESUMED_AT_ONCE as well for a job started again after a restart). Use it as the
    target of a thread you start yourself. A job that is waiting for its turn holds nothing: no database connection, no lock."""
    def run(*args: Any, **kwargs: Any) -> Any:
        if resumed:
            with _resume_slots, _slots:
                return fn(*args, **kwargs)
        with _slots:
            return fn(*args, **kwargs)
    return run


def spawn(fn: Callable, *args: Any, name: str = "job", resumed: bool = False) -> threading.Thread:
    """Run `fn(*args)` in a background thread, but at most MAX_BACKGROUND_JOBS at a time in this process. The thread is a daemon, as before, so a restart is never held up by it."""
    t = threading.Thread(target=bounded(fn, resumed), args=args, daemon=True, name=name)
    t.start()
    return t


def _path(fn: Callable) -> str | None:
    mod, name = getattr(fn, "__module__", None), getattr(fn, "__qualname__", "")
    return f"{mod}:{name}" if mod and name and "<" not in name else None


def _load(path: str) -> Callable:
    mod, name = path.split(":", 1)
    obj: Any = importlib.import_module(mod)
    for part in name.split("."):
        obj = getattr(obj, part)
    return obj


def resuming(ref: str) -> bool:
    """True when `ref` belongs to a job that was cut off by the restart and is being started again."""
    return ref in _RESUMING


def _finish(job_id: int, refs: list[str]) -> None:
    _RESUMING.difference_update(refs)
    db = SessionLocal()
    try:
        # only the owner removes the row: a run that was taken over (it stalled for a minute) must not delete the row of the run that replaced it
        db.execute(delete(DurableJob).where(DurableJob.id == job_id, or_(DurableJob.owner == PROCESS_ID, DurableJob.owner.is_(None))))
        db.commit()
    except Exception:  # noqa: BLE001 - a leftover row only means one more (safe) run after the next restart
        db.rollback()
        log.warning("Could not remove finished job %s", job_id)
    finally:
        db.close()


def _gate(job: Callable[[], None]) -> Callable[[], None]:
    """A job started by BackgroundTasks runs in the web server's own threads (shared with every request). It takes one of the MAX_BACKGROUND_JOBS places when one is free and runs
    right there, as before. When none is free it is handed to a waiting daemon thread and the request's thread is released at once: a crowd of queued jobs can never use up the
    threads that answer requests."""
    def gated() -> None:
        if _slots.acquire(blocking=False):
            try:
                job()
            finally:
                _slots.release()
        else:
            threading.Thread(target=bounded(job), daemon=True, name="job-waiting").start()
    return gated


def _wrap(job_id: int, run: Callable[[], None], refs: list[str]) -> Callable[[], None]:
    def job() -> None:
        run()  # in_background records a failure itself and returns; a kill never gets past this line, so the row stays
        _finish(job_id, refs)
    return job


def durable(fn: Callable, *args: Any, refs: tuple[str, ...] | list[str] = (), gate: bool = True) -> Callable[[], None]:
    """Use in place of in_background(fn, *args) with BackgroundTasks.add_task(...). `gate=False` for a caller that starts its own bounded thread (spawn), which already waits for a place."""
    from ..deps import in_background
    _gate_it = _gate if gate else (lambda j: j)
    run = in_background(fn, *args)
    path = _path(fn)
    try:
        json.dumps(list(args))
    except (TypeError, ValueError):
        return _gate_it(run)
    if path is None:
        return _gate_it(run)
    db = SessionLocal()
    try:
        row = DurableJob(fn=path, args=list(args), refs=list(refs), status="running", attempts=1, owner=PROCESS_ID, heartbeat_at=_now())
        db.add(row)
        db.commit()
        ensure_heartbeat()
        return _gate_it(_wrap(row.id, run, list(refs)))
    except Exception:  # noqa: BLE001 - never stop the work itself because the safety record could not be written
        db.rollback()
        log.warning("Could not record background job %s: it runs without restart cover", path)
        return _gate_it(run)
    finally:
        db.close()


def start_now(fn: Callable, *args: Any, refs: tuple[str, ...] | list[str] = (), name: str = "job") -> None:
    """The same for work started in its own thread instead of BackgroundTasks."""
    spawn(durable(fn, *args, refs=refs, gate=False), name=name)


def reclaim(db) -> int:
    """Take over the jobs whose owner has gone quiet (a crash, a kill, a restart) and run them again here; give up on those already tried MAX_ATTEMPTS times.
    Safe in any number of processes at once: a job is taken by ONE conditional UPDATE (still running, same attempt count, still quiet) and only the process whose UPDATE changed the row runs it.
    Nothing slow happens while the database connection is held: the rows are claimed, the claim is saved, and only then do the jobs start (each waits for a place in its own thread)."""
    from ..deps import in_background
    _, quiet = _times()
    cutoff = _now() - timedelta(seconds=quiet)
    seen_at = func.coalesce(DurableJob.heartbeat_at, DurableJob.updated_at, DurableJob.created_at)  # rows from before heartbeats existed fall back to their own timestamps
    todo: list[tuple[int, Callable, list, list[str], str]] = []
    candidates = db.execute(select(DurableJob.id, DurableJob.attempts, DurableJob.fn, DurableJob.args, DurableJob.refs).where(DurableJob.status == "running", seen_at < cutoff)).all()
    for job_id, attempts, path, args, refs in candidates:
        attempts = attempts or 1
        mine = [DurableJob.id == job_id, DurableJob.status == "running", DurableJob.attempts == attempts, seen_at < cutoff]
        try:
            if attempts + 1 > MAX_ATTEMPTS:
                raise RuntimeError(f"cut off by a restart {MAX_ATTEMPTS} times")
            fn = _load(path)
        except Exception as exc:  # noqa: BLE001
            msg = f"{type(exc).__name__}: {exc}"[:300]
            if db.execute(update(DurableJob).where(*mine).values(status="failed", error=msg)).rowcount:
                log.warning("Gave up on background job %s: %s", path, msg)
            db.commit()
            continue
        _RESUMING.update(refs or [])  # before the claim is visible: the start-up cleanups must find the refs here and in the table
        won = db.execute(update(DurableJob).where(*mine).values(owner=PROCESS_ID, heartbeat_at=_now(), attempts=attempts + 1)).rowcount
        db.commit()  # saved before any job can finish and delete its row
        if won:
            todo.append((job_id, fn, list(args or []), list(refs or []), path))
        else:
            _RESUMING.difference_update(refs or [])  # another process took it
    if todo:
        ensure_heartbeat()
    for job_id, fn, args, refs, path in todo:
        spawn(_wrap(job_id, in_background(fn, *args), refs), name=f"resume-{job_id}", resumed=True)
        log.warning("Started background job %s again after its owner went quiet", path)
    return len(todo)


def resume_all(db) -> int:
    """At start-up: take over what a restart or crash cut off (see `reclaim`). Jobs that a live process is still running are left alone, so starting a second worker disturbs nothing."""
    ensure_heartbeat()
    return reclaim(db)
