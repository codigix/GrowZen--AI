"""Advisory locks: granted once, released for good, never left on a pooled connection (PostgreSQL only; skipped on SQLite)."""
import pytest
from sqlalchemy import text

from app.db import engine
from app.services import locks

pg = pytest.mark.skipif(engine.dialect.name != "postgresql", reason="advisory locks are PostgreSQL only")
KEY = 7_999_001


def test_sqlite_is_always_granted(monkeypatch):
    from sqlalchemy import create_engine
    lite = create_engine("sqlite://")
    lock = locks.AdvisoryLock(lite, KEY)
    assert lock.acquired is True
    lock.release()  # nothing to release: no error


@pg
def test_second_holder_is_refused_until_the_first_releases():
    first = locks.AdvisoryLock(engine, KEY)
    try:
        assert first.acquired is True
        second = locks.AdvisoryLock(engine, KEY)
        assert second.acquired is False
    finally:
        first.release()
    third = locks.AdvisoryLock(engine, KEY)
    try:
        assert third.acquired is True  # released for good, not stuck on a pooled connection
    finally:
        third.release()


@pg
def test_the_lock_connection_is_never_idle_in_a_transaction():
    lock = locks.AdvisoryLock(engine, KEY)
    try:
        with engine.connect() as c:
            state = c.execute(text("select state from pg_stat_activity where query like 'select pg_try_advisory_lock%' and pid <> pg_backend_pid() limit 1")).scalar()
        assert state != "idle in transaction"
    finally:
        lock.release()


def test_a_slow_job_cannot_hold_the_rest_of_the_tick(client, monkeypatch):
    from datetime import datetime, timedelta, timezone

    from app.db import SessionLocal
    from app.models import Business, Schedule
    from app.services import schedules
    bid = client.post("/api/v1/businesses", json={"name": "Budget Co"}).json()["id"]
    ran = []
    clock = {"t": 0.0}
    monkeypatch.setattr(schedules, "run_job", lambda db, s: (ran.append(s.job), clock.__setitem__("t", clock["t"] + 100)))
    import time as _t
    monkeypatch.setattr(_t, "monotonic", lambda: clock["t"])
    db = SessionLocal()
    try:
        db.query(Schedule).filter_by(business_id=bid).delete()
        past = datetime.now(timezone.utc) - timedelta(hours=1)
        for job in ("technical", "geo", "report", "rank_scan"):
            db.add(Schedule(business_id=bid, job=job, every="daily", next_run_at=past))
        db.commit()
        n = schedules.run_due(db, budget_seconds=150)
        assert n == 2 and len(ran) == 2  # started two (100s each), then the budget was spent
        assert db.query(Schedule).filter(Schedule.business_id == bid, Schedule.next_run_at <= datetime.now(timezone.utc)).count() == 2  # the rest are still due
    finally:
        db.close()


def test_a_failing_background_task_is_recorded_not_lost(client):
    from app.db import SessionLocal
    from app.deps import in_background
    from app.models import ActivityLog
    bid = client.post("/api/v1/businesses", json={"name": "Bg Co"}).json()["id"]

    def boom(db, business_id):
        raise ValueError("the provider said no")
    in_background(boom, bid)()  # must not raise
    db = SessionLocal()
    try:
        row = db.query(ActivityLog).filter_by(action="background_task_failed", business_id=bid).one()
        assert row.detail["task"] == "boom" and "provider said no" in row.detail["error"]
    finally:
        db.close()


def test_a_failed_start_up_step_is_recorded_and_the_next_steps_still_run(client, monkeypatch):
    import asyncio

    from app import main, startup_state
    from app.services import jobs, schema
    ran = []
    monkeypatch.setattr(schema, "is_current", lambda e: False)
    monkeypatch.setattr(schema, "sync", lambda e: (_ for _ in ()).throw(RuntimeError("permission denied for table businesses")))
    monkeypatch.setattr(jobs, "recover_stale", lambda db, startup=False: ran.append("recover"))

    async def start():
        async with main.lifespan(main.app):
            pass
    asyncio.run(start())
    assert ran == ["recover"]  # the failure of the schema update did not skip what comes after it
    assert startup_state.PROBLEMS and startup_state.PROBLEMS[0]["step"] == "schema update" and "permission denied" in startup_state.PROBLEMS[0]["error"]
    assert client.get("/api/v1/status").json()["startup_problems"][0]["step"] == "schema update"
    startup_state.clear()


def test_the_shared_limiter_counts_across_instances_and_clears(client):
    from app.services import ratelimit
    a, b = ratelimit.Hits("t_shared"), ratelimit.Hits("t_shared")  # two instances = two server processes
    a.clear()
    assert [a.hit("u1", 2, 3600), b.hit("u1", 2, 3600), a.hit("u1", 2, 3600)] == [True, True, False]  # one allowance for both
    assert a.hit("u2", 2, 3600) is True  # another caller is separate
    a.clear()
    assert b.hit("u1", 2, 3600) is True


def test_the_limiter_falls_back_to_memory_when_the_database_fails(monkeypatch):
    from app.services import ratelimit
    h = ratelimit.Hits("t_fallback")
    monkeypatch.setattr(ratelimit, "SessionLocal", lambda: (_ for _ in ()).throw(RuntimeError("db down")))
    assert [h.hit("u", 1, 3600), h.hit("u", 1, 3600)] == [True, False]  # neither wide open nor blocking everyone


def test_history_pruning_thins_what_only_grows_and_keeps_what_people_read(client):
    from datetime import date, datetime, timedelta, timezone

    from app.db import SessionLocal
    from app.models import ActivityLog, KeywordRankLog, Notification, RateHit
    from app.services import jobs, ratelimit
    bid = client.post("/api/v1/businesses", json={"name": "Prune Co"}).json()["id"]
    now = datetime.now(timezone.utc)
    db = SessionLocal()
    try:
        owner = db.get(__import__("app.models", fromlist=["Business"]).Business, bid).owner_id
        db.add_all([Notification(business_id=bid, owner_id=owner, kind="x", title="old read", read=True, created_at=now - timedelta(days=100)),
                    Notification(business_id=bid, owner_id=owner, kind="x", title="old unread", read=False, created_at=now - timedelta(days=100)),
                    ActivityLog(actor="t", action="old", business_id=bid, created_at=now - timedelta(days=200)), ActivityLog(actor="t", action="new", business_id=bid, created_at=now - timedelta(days=5)),
                    KeywordRankLog(business_id=bid, keyword="k", day=date.today() - timedelta(days=120), rank=7, serp=[{"d": "a.com", "p": 1}]),
                    KeywordRankLog(business_id=bid, keyword="k", day=date.today() - timedelta(days=2), rank=5, serp=[{"d": "a.com", "p": 1}]),
                    RateHit(name="old", caller="u", window_start=1, ends_at=int(now.timestamp()) - 200000, count=3), RateHit(name="live", caller="u", window_start=1, ends_at=int(now.timestamp()) + 600, count=1)])
        db.commit()
        out = jobs.prune_history(db)
        assert out["notifications"] == 1 and out["activity"] == 1 and out["rank_serps"] == 1 and out["rate_hits"] == 1
        assert {n.title for n in db.query(Notification).filter_by(business_id=bid)} == {"old unread"}  # unread news is never thinned
        rows = {r.day: r for r in db.query(KeywordRankLog).filter_by(business_id=bid)}
        assert all(r.rank is not None for r in rows.values())  # the position history stays
        assert rows[date.today() - timedelta(days=120)].serp is None and rows[date.today() - timedelta(days=2)].serp is not None
    finally:
        db.close()


def test_login_failures_are_shared_and_survive_a_new_instance(client):
    from app.services import ratelimit
    a, b = ratelimit.FailureLog(), ratelimit.FailureLog()  # two server processes
    a.clear()
    for _ in range(3):
        a.add("me@x.com|1.2.3.4")
    assert len(b.recent("me@x.com|1.2.3.4", 900)) == 3  # the other process sees them (and a restart would too: they are rows)
    assert b.recent("other", 900) == []
    a.reset("me@x.com|1.2.3.4")
    assert b.recent("me@x.com|1.2.3.4", 900) == []


def test_old_failures_fall_out_of_the_window(client):
    import time

    from app.db import SessionLocal
    from app.models import LoginFailure
    from app.services import ratelimit
    f = ratelimit.FailureLog()
    f.clear()
    db = SessionLocal()
    db.add_all([LoginFailure(key="k", at=time.time() - 2000), LoginFailure(key="k", at=time.time() - 10)])
    db.commit()
    db.close()
    assert len(f.recent("k", 900)) == 1
