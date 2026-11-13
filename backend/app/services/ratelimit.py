"""Rate limits that every server process shares.

An in-memory counter is reset by a restart and is per process: a second uvicorn worker (or a restart loop) hands out a fresh allowance, so the endpoints that cost money or a browser
(AI, Serper, Chrome, Lighthouse, the public review page) were less protected than they looked. This keeps a fixed-window counter per limiter name and caller in the database.
If the database cannot be reached the limiter falls back to counting in memory for that call, so a database problem never opens the gate completely and never blocks everyone.
"""
import logging
import threading
import time
from collections import defaultdict, deque

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from ..db import SessionLocal
from ..models import LoginFailure, RateHit

log = logging.getLogger("seo.ratelimit")
_CLEAN_EVERY = 200  # calls between deletions of expired windows


class Hits:
    def __init__(self, name: str):
        self.name = name[:60]
        self._memory: dict[str, deque] = defaultdict(deque)  # fallback only
        self._lock = threading.Lock()
        self._calls = 0

    def hit(self, caller: str, limit: int, window: int) -> bool:
        """Count one call. True = allowed, False = over the limit for this window."""
        caller = str(caller)[:120]
        try:
            return self._hit_db(caller, limit, window)
        except Exception as exc:  # noqa: BLE001
            log.warning("Rate limit '%s' fell back to memory: %s", self.name, exc)
            return self._hit_memory(caller, limit, window)

    def _hit_db(self, caller: str, limit: int, window: int) -> bool:
        bucket = int(time.time() // window)
        with SessionLocal() as db:
            for attempt in (1, 2):
                row = db.scalar(select(RateHit).where(RateHit.name == self.name, RateHit.caller == caller, RateHit.window_start == bucket).with_for_update())
                if row is not None:
                    break
                try:
                    db.add(RateHit(name=self.name, caller=caller, window_start=bucket, ends_at=(bucket + 1) * window, count=0))
                    db.commit()
                except IntegrityError:  # another process created it first: read theirs
                    db.rollback()
            if row is None:
                raise RuntimeError("rate row unavailable")
            if row.count >= limit:
                db.rollback()
                return False
            row.count += 1
            db.commit()
        self._maybe_clean(window)
        return True

    def _maybe_clean(self, window: int) -> None:
        with self._lock:
            self._calls += 1
            if self._calls % _CLEAN_EVERY:
                return
        try:
            with SessionLocal() as db:
                db.execute(delete(RateHit).where(RateHit.name == self.name, RateHit.ends_at < int(time.time()) - 3600))
                db.commit()
        except Exception:  # noqa: BLE001 - housekeeping only
            pass

    def _hit_memory(self, caller: str, limit: int, window: int) -> bool:
        now = time.time()
        with self._lock:
            q = self._memory[caller]
            while q and now - q[0] > window:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True

    def clear(self) -> None:
        """Forget every count of this limiter (tests, and an administrator resetting a locked-out caller)."""
        self._memory.clear()
        try:
            with SessionLocal() as db:
                db.execute(delete(RateHit).where(RateHit.name == self.name))
                db.commit()
        except Exception:  # noqa: BLE001
            pass


class FailureLog:
    """Wrong attempts per key within a time window, for lock-outs. In the database, so a restart does not unlock a locked-out address and a second server process sees the same count;
    in memory for that call only when the database cannot be reached (so a database problem never turns the lock-out off)."""
    MAX_AGE = 86400

    def __init__(self):
        self._memory: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def recent(self, key: str, window: float) -> list[float]:
        now = time.time()
        try:
            with SessionLocal() as db:
                if now % 50 < 1:  # now and then drop what no window can still need
                    db.execute(delete(LoginFailure).where(LoginFailure.at < now - self.MAX_AGE))
                    db.commit()
                return [r for (r,) in db.execute(select(LoginFailure.at).where(LoginFailure.key == key, LoginFailure.at > now - window).order_by(LoginFailure.at))]
        except Exception as exc:  # noqa: BLE001
            log.warning("Failure log fell back to memory: %s", exc)
            with self._lock:
                return [t for t in self._memory.get(key, []) if now - t < window]

    def add(self, key: str) -> None:
        now = time.time()
        try:
            with SessionLocal() as db:
                db.add(LoginFailure(key=key[:320], at=now))
                db.commit()
        except Exception:  # noqa: BLE001
            with self._lock:
                self._memory.setdefault(key, []).append(now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._memory.pop(key, None)
        try:
            with SessionLocal() as db:
                db.execute(delete(LoginFailure).where(LoginFailure.key == key))
                db.commit()
        except Exception:  # noqa: BLE001
            pass

    def clear(self) -> None:
        with self._lock:
            self._memory.clear()
        try:
            with SessionLocal() as db:
                db.execute(delete(LoginFailure))
                db.commit()
        except Exception:  # noqa: BLE001
            pass
