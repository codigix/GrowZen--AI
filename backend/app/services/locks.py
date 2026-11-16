"""Session-level PostgreSQL advisory locks that cannot leak.

A lock taken on a pooled connection that is later returned to the pool stays held by whoever borrows that connection next, and a connection left "idle in transaction" holds
back the database's clean-up for everyone. So a lock gets its OWN connection in autocommit mode (never idle in a transaction), is released explicitly, and when the release
cannot be confirmed the connection is thrown away: closing the real connection always frees a session lock.
SQLite has nothing to lock: the lock is simply granted.
"""
import logging

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

log = logging.getLogger("seo.locks")


class AdvisoryLock:
    def __init__(self, engine: Engine, key: int):
        self.key = key
        self.acquired = False
        self._conn: Connection | None = None
        if engine.dialect.name != "postgresql":
            self.acquired = True
            return
        conn = engine.connect().execution_options(isolation_level="AUTOCOMMIT")
        try:
            self.acquired = bool(conn.execute(text("select pg_try_advisory_lock(:k)"), {"k": key}).scalar())
        except Exception:  # noqa: BLE001 - a connection that failed mid-lock is discarded, never reused
            self._discard(conn)
            raise
        if self.acquired:
            self._conn = conn
        else:
            conn.close()

    @staticmethod
    def _discard(conn: Connection) -> None:
        try:
            conn.invalidate()  # closes the physical connection: that frees the lock
        except Exception:  # noqa: BLE001
            pass
        try:
            conn.close()
        except Exception:  # noqa: BLE001
            pass

    def release(self) -> None:
        conn, self._conn = self._conn, None
        if conn is None:
            return
        try:
            freed = conn.execute(text("select pg_advisory_unlock(:k)"), {"k": self.key}).scalar()
            if not freed:
                raise RuntimeError("the lock was not held")
            conn.close()
        except Exception as exc:  # noqa: BLE001 - cannot confirm the unlock: drop the connection so the lock cannot outlive it
            log.warning("Advisory lock %s release could not be confirmed (%s): connection discarded", self.key, exc)
            self._discard(conn)

    def __enter__(self) -> "AdvisoryLock":
        return self

    def __exit__(self, *exc) -> None:
        self.release()
