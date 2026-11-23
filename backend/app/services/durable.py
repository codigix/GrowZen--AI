"""Background jobs that survive a server restart.

Background work runs inside the web process, so a restart (a deploy, `pm2 restart`, a crash) kills whatever was running.
`durable(fn, *args)` is a drop-in for `in_background(fn, *args)`: it also writes the job to the database first and removes
it when the job ends. At start-up `resume_all` starts again every job still in the table, so the person's page keeps
waiting and then shows the result, instead of an "Interrupted, run it again" error.

Rules for a job: it must be a plain module-level function with JSON-able arguments, and running it twice must be safe
(it is restarted from the beginning, at most MAX_ATTEMPTS runs in all, so a crash loop cannot repeat it forever).
A lambda or an argument that is not JSON-able simply runs as before, without the restart cover.

`refs` names the rows a job works on ("audit:12"). The start-up cleanups that fail unfinished rows ask `resuming()`
first and leave those rows alone, because their job is about to run again.
"""
import importlib
import json
import logging
import threading
from typing import Any, Callable

from sqlalchemy import select

from ..db import SessionLocal
from ..models import DurableJob

log = logging.getLogger("seo.durable")
MAX_ATTEMPTS = 3
_RESUMING: set[str] = set()


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
        row = db.get(DurableJob, job_id)
        if row is not None:
            db.delete(row)
            db.commit()
    except Exception:  # noqa: BLE001 - a leftover row only means one more (safe) run after the next restart
        db.rollback()
        log.warning("Could not remove finished job %s", job_id)
    finally:
        db.close()


def _wrap(job_id: int, run: Callable[[], None], refs: list[str]) -> Callable[[], None]:
    def job() -> None:
        run()  # in_background records a failure itself and returns; a kill never gets past this line, so the row stays
        _finish(job_id, refs)
    return job


def durable(fn: Callable, *args: Any, refs: tuple[str, ...] | list[str] = ()) -> Callable[[], None]:
    """Use in place of in_background(fn, *args) with BackgroundTasks.add_task(...)."""
    from ..deps import in_background
    run = in_background(fn, *args)
    path = _path(fn)
    try:
        json.dumps(list(args))
    except (TypeError, ValueError):
        return run
    if path is None:
        return run
    db = SessionLocal()
    try:
        row = DurableJob(fn=path, args=list(args), refs=list(refs), status="running", attempts=1)
        db.add(row)
        db.commit()
        return _wrap(row.id, run, list(refs))
    except Exception:  # noqa: BLE001 - never stop the work itself because the safety record could not be written
        db.rollback()
        log.warning("Could not record background job %s: it runs without restart cover", path)
        return run
    finally:
        db.close()


def start_now(fn: Callable, *args: Any, refs: tuple[str, ...] | list[str] = (), name: str = "job") -> None:
    """The same for work started in its own thread instead of BackgroundTasks."""
    threading.Thread(target=durable(fn, *args, refs=refs), daemon=True, name=name).start()


def resume_all(db) -> int:
    """At start-up: start again every job a restart cut off. Jobs already tried MAX_ATTEMPTS times are given up on."""
    from ..deps import in_background
    todo: list[tuple[int, Callable, list, list[str], str]] = []
    for r in list(db.scalars(select(DurableJob).where(DurableJob.status == "running"))):
        r.attempts = (r.attempts or 1) + 1
        try:
            if r.attempts > MAX_ATTEMPTS:
                raise RuntimeError(f"cut off by a restart {MAX_ATTEMPTS} times")
            fn = _load(r.fn)
        except Exception as exc:  # noqa: BLE001
            r.status, r.error = "failed", f"{type(exc).__name__}: {exc}"[:300]
            log.warning("Gave up on background job %s: %s", r.fn, r.error)
            continue
        refs = list(r.refs or [])
        _RESUMING.update(refs)
        todo.append((r.id, fn, list(r.args or []), refs, r.fn))
    db.commit()  # the new attempt counts are saved before any job can finish and delete its row
    for job_id, fn, args, refs, path in todo:
        threading.Thread(target=_wrap(job_id, in_background(fn, *args), refs), daemon=True, name=f"resume-{job_id}").start()
        log.warning("Started background job %s again after a restart", path)
    return len(todo)
