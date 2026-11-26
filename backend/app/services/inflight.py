"""One at a time for the same operation on the same project, in this process AND in the other backend processes that share the database.

A person who double-clicks "Check ranks", or two tabs that press it together, used to start the operation twice: twice the Google requests and the same rows written twice.
`only_one(key)` lets the first caller in and tells the second to wait for it. It never waits: the caller that does not get in is told at once.

Inside a process the guard is a set. Across processes (PostgreSQL only) the first caller also takes a session advisory lock on a connection of its own, opened outside the pool, so a slow
operation never holds a pooled connection and the lock cannot leak into the pool: closing that connection frees the lock, even if the process is killed. When that connection cannot be
opened the guard falls back to this process alone (the work is allowed, never refused, because the guard itself failed). SQLite has one process and needs nothing more.
"""
import hashlib
import logging
import threading
from contextlib import contextmanager

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from ..db import engine

log = logging.getLogger("seo.inflight")
_running: set[tuple] = set()
_lock = threading.Lock()
_guard_engine = None


def _lock_id(key: tuple) -> int:
    """The same 64-bit number for the same key in every process (Python's own hash differs from one process to the next)."""
    return int.from_bytes(hashlib.blake2b(repr(key).encode(), digest_size=8).digest(), "big", signed=True)


def _guard_bind():
    global _guard_engine
    if _guard_engine is None:
        _guard_engine = create_engine(engine.url, poolclass=NullPool, connect_args={"connect_timeout": 5})
    return _guard_engine


def _take_shared(key: tuple):
    """(taken, connection). `taken` is False only when ANOTHER process holds the lock. When the database cannot be asked, it is True with no connection."""
    if engine.dialect.name != "postgresql":
        return True, None
    conn = None
    try:
        conn = _guard_bind().connect().execution_options(isolation_level="AUTOCOMMIT")
        if conn.execute(text("select pg_try_advisory_lock(:k)"), {"k": _lock_id(key)}).scalar():
            return True, conn
        conn.close()
        return False, None
    except Exception as exc:  # noqa: BLE001 - the guard failing must not stop the work
        log.warning("Cross-process guard unavailable for %s: %s", key[0] if key else key, exc)
        if conn is not None:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass
        return True, None


def _release_shared(conn) -> None:
    if conn is None:
        return
    try:
        conn.close()  # closing the connection frees its session locks
    except Exception:  # noqa: BLE001
        pass


@contextmanager
def only_one(key: tuple):
    with _lock:
        if key in _running:
            first = False
        else:
            _running.add(key)
            first = True
    conn = None
    if first:
        first, conn = _take_shared(key)  # another process may already be doing it
        if not first:
            with _lock:
                _running.discard(key)
    try:
        yield first
    finally:
        if first:
            _release_shared(conn)
            with _lock:
                _running.discard(key)


def running(key: tuple) -> bool:
    with _lock:
        return key in _running


def stop() -> None:
    global _guard_engine
    if _guard_engine is not None:
        _guard_engine.dispose()
        _guard_engine = None
