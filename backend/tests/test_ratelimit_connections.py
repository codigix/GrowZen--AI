"""The rate limiter: the same limits as before, counted with one statement instead of several, and no wait for a second connection when every connection is already in use."""
import threading
import time

import pytest
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError

from app.db import SessionLocal, engine
from app.models import RateHit
from app.services import ratelimit


@pytest.fixture()
def name():
    n = f"t_conn_{time.time_ns()}"
    yield n
    db = SessionLocal()
    db.query(RateHit).filter(RateHit.name == n).delete()
    db.commit()
    db.close()


def count_of(name, caller="u1"):
    db = SessionLocal()
    row = db.scalar(select(RateHit).where(RateHit.name == name, RateHit.caller == caller))
    db.close()
    return row.count if row else None


class OldHits(ratelimit.Hits):
    """The limiter as it was: read the row with a lock (creating it first when missing), then add one, in a session of its own."""

    def _hit_db(self, caller, limit, window):
        bucket = int(time.time() // window)
        with SessionLocal() as db:
            for attempt in (1, 2):
                row = db.scalar(select(RateHit).where(RateHit.name == self.name, RateHit.caller == caller, RateHit.window_start == bucket).with_for_update())
                if row is not None:
                    break
                try:
                    db.add(RateHit(name=self.name, caller=caller, window_start=bucket, ends_at=(bucket + 1) * window, count=0))
                    db.commit()
                except IntegrityError:
                    db.rollback()
            if row is None:
                raise RuntimeError("rate row unavailable")
            if row.count >= limit:
                db.rollback()
                return False
            row.count += 1
            db.commit()
        return True


# ── the same limits ───────────────────────────────────────────────────────────
def test_calls_up_to_the_limit_are_allowed_and_the_next_is_not(name):
    h = ratelimit.Hits(name)
    assert [h.hit("u1", 3, 3600) for _ in range(5)] == [True, True, True, False, False]
    assert count_of(name) == 3  # a refused call does not count


def test_each_caller_and_each_limiter_counts_on_its_own(name):
    a, b = ratelimit.Hits(name), ratelimit.Hits(name + "_b")
    try:
        assert a.hit("u1", 1, 3600) and not a.hit("u1", 1, 3600)
        assert a.hit("u2", 1, 3600) and b.hit("u1", 1, 3600)
    finally:
        b.clear()


def test_a_limit_of_zero_allows_nothing_as_before(name):
    assert ratelimit.Hits(name).hit("u1", 0, 3600) is False and count_of(name) is None


def test_a_new_window_starts_a_new_count(name):
    h = ratelimit.Hits(name)
    assert h.hit("u1", 1, 1) and not h.hit("u1", 1, 1)
    time.sleep(1.1)
    assert h.hit("u1", 1, 1)


def test_two_processes_share_one_count_and_never_give_out_more_than_the_limit(name):
    """Twelve callers at once (fewer than the pool has connections) through four limiter objects (four server processes): exactly `limit` of them get in, and the database says so.
    With every connection in use the limiter counts in memory instead; that is tested below."""
    limiters = [ratelimit.Hits(name) for _ in range(4)]
    allowed, lock = [], threading.Lock()
    start = threading.Barrier(12)

    def call(i):
        start.wait()
        ok = limiters[i % 4].hit("u1", 5, 3600)
        with lock:
            allowed.append(ok)
    threads = [threading.Thread(target=call, args=(i,)) for i in range(12)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert allowed.count(True) == 5 and allowed.count(False) == 7 and count_of(name) == 5


# ── statements ────────────────────────────────────────────────────────────────
def test_statements_per_call_before_and_after(name):
    seen: list[str] = []
    listener = lambda conn, cur, stmt, *a: seen.append(stmt)  # noqa: E731

    def run(h):
        seen.clear()
        event.listen(engine, "before_cursor_execute", listener)
        try:
            for _ in range(5):  # four allowed calls and one refused, for a limit of 4
                h.hit("u1", 4, 3600)
        finally:
            event.remove(engine, "before_cursor_execute", listener)
        return len([s for s in seen if "rate_hits" in s])
    old = run(OldHits(name + "_old"))
    new = run(ratelimit.Hits(name))
    OldHits(name + "_old").clear()
    print(f"\nRATE LIMIT statements for five calls: before={old} after={new}")
    assert new == 5 and old >= 2 * new  # one statement per call; the old way read, created, read again and updated


# ── connections ───────────────────────────────────────────────────────────────
def test_no_second_connection_is_waited_for_when_the_pool_is_full(name):
    pool = engine.pool
    if not hasattr(pool, "checkedout") or not hasattr(pool, "_max_overflow"):
        pytest.skip("this pool has no fixed size")
    total = pool.size() + pool._max_overflow
    held = []
    try:
        while pool.checkedout() < total:  # every connection this process may open is in use
            s = SessionLocal()
            s.execute(select(1))
            held.append(s)
        assert ratelimit.pool_is_full()
        h = ratelimit.Hits(name)
        t0 = time.monotonic()
        results = [h.hit("u1", 2, 3600) for _ in range(3)]
        took = time.monotonic() - t0
        assert results == [True, True, False]  # the limit still holds (counted in memory for these calls)
        assert took < 1.0 and pool.checkedout() == total  # no wait for a connection, and none was taken
        f = ratelimit.FailureLog()
        t0 = time.monotonic()
        f.add("k1")
        assert len(f.recent("k1", 60)) == 1 and time.monotonic() - t0 < 1.0  # the lock-out count also falls back at once
    finally:
        for s in held:
            s.close()
    assert not ratelimit.pool_is_full()


def test_a_database_failure_still_falls_back_to_memory(name, monkeypatch):
    h = ratelimit.Hits(name)
    monkeypatch.setattr(ratelimit, "SessionLocal", lambda: (_ for _ in ()).throw(RuntimeError("db down")))
    assert [h.hit("u1", 2, 3600) for _ in range(3)] == [True, True, False]
