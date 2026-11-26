"""Phase 5: background jobs that are safe with several backend processes (heartbeat, atomic claims, take-over of abandoned jobs), bounded helper threads, and the competitor endpoints.

Several processes are imitated here by several threads that each use a session of their own, which is what matters to the database (one conditional UPDATE decides the winner). The real
multi-process behaviour is covered by the multi-worker load test (loadtest/run_multi.py). Nothing here depends on the order of the tests or on SQLite."""
import threading
import time
from datetime import datetime, timedelta, timezone

import pytest

from app.db import SessionLocal, engine
from app.models import Audit, DurableJob, LighthouseAudit
from app.services import durable, jobs, lifecycle, lighthouse_runner

OTHER = "other-host:4242:deadbeef"
RAN: list[tuple] = []
RAN_LOCK = threading.Lock()


def counting_job(db, key):  # a plain module-level job, as the durable rules ask
    with RAN_LOCK:
        RAN.append((key, threading.current_thread().name))


def _now():
    return datetime.now(timezone.utc)


@pytest.fixture(autouse=True)
def clean():
    RAN.clear()
    with SessionLocal() as db:
        db.query(DurableJob).delete()
        db.commit()
    yield
    for _ in range(100):  # let any job started by the test finish before the next one
        if engine.pool.checkedout() == 0:
            break
        time.sleep(0.05)
    with SessionLocal() as db:
        db.query(DurableJob).delete()
        db.commit()


def settle():
    for _ in range(100):
        if engine.pool.checkedout() == 0:
            return
        time.sleep(0.05)


def add_job(key, owner=OTHER, beat_age=300, attempts=1, refs=()):
    with SessionLocal() as db:
        row = DurableJob(fn=f"{__name__}:counting_job", args=[key], refs=list(refs), status="running", attempts=attempts, owner=owner, heartbeat_at=_now() - timedelta(seconds=beat_age))
        db.add(row)
        db.commit()
        return row.id


def wait_for(cond, seconds=8):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.05)
    return cond()


# ── heartbeat and ownership ───────────────────────────────────────────────────
def test_a_new_job_names_its_owner_and_the_heartbeat_keeps_it_fresh():
    run = durable.durable(counting_job, "own", refs=["x:1"], gate=False)
    with SessionLocal() as db:
        row = db.query(DurableJob).one()
        assert row.owner == durable.PROCESS_ID and row.heartbeat_at is not None
        first = row.heartbeat_at
    time.sleep(0.05)
    assert durable.beat_once() == 1
    with SessionLocal() as db:
        assert db.query(DurableJob).one().heartbeat_at >= first
    run()
    with SessionLocal() as db:
        assert db.query(DurableJob).count() == 0  # finished: its row is gone


def test_the_heartbeat_touches_only_this_processs_jobs():
    mine = durable.durable(counting_job, "mine", gate=False)
    other = add_job("theirs", beat_age=5000)
    assert durable.beat_once() == 1
    with SessionLocal() as db:
        theirs = db.get(DurableJob, other)
        assert (_now() - theirs.heartbeat_at.replace(tzinfo=timezone.utc)).total_seconds() > 4000  # a dead process's row is not kept alive by anyone else
    mine()


def test_a_job_whose_owner_is_alive_is_never_taken_over():
    jid = add_job("alive", beat_age=2)  # touched two seconds ago by another process
    with SessionLocal() as db:
        assert durable.reclaim(db) == 0
    time.sleep(0.3)
    assert RAN == []
    with SessionLocal() as db:
        assert db.get(DurableJob, jid).owner == OTHER


# ── abandoned jobs: exactly one process takes each ────────────────────────────
def test_an_abandoned_job_is_taken_over_by_exactly_one_of_eight_processes_at_once():
    jid = add_job("crashed", beat_age=300)
    start = threading.Barrier(8)
    won: list[int] = []

    def process():
        with SessionLocal() as db:
            start.wait(5)
            n = durable.reclaim(db)
            with RAN_LOCK:
                won.append(n)
    threads = [threading.Thread(target=process) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(15)
    assert sorted(won) == [0] * 7 + [1]  # one winner
    assert wait_for(lambda: len(RAN) >= 1)
    time.sleep(0.5)
    assert [k for k, _ in RAN] == ["crashed"]  # and it ran once
    assert wait_for(lambda: SessionLocal().query(DurableJob).filter_by(id=jid).count() == 0)  # finished: the row is gone


def test_a_job_cut_off_too_many_times_is_given_up_once_and_not_run():
    jid = add_job("loop", beat_age=300, attempts=durable.MAX_ATTEMPTS)
    with SessionLocal() as db:
        assert durable.reclaim(db) == 0
    time.sleep(0.2)
    assert RAN == []
    with SessionLocal() as db:
        row = db.get(DurableJob, jid)
        assert row.status == "failed" and "cut off" in (row.error or "")
        assert durable.reclaim(db) == 0  # a failed row is never looked at again


def test_a_job_that_cannot_be_loaded_fails_alone_and_the_others_still_run():
    with SessionLocal() as db:
        db.add(DurableJob(fn="no.such.module:nothing", args=[], refs=[], status="running", attempts=1, owner=OTHER, heartbeat_at=_now() - timedelta(seconds=300)))
        db.commit()
    add_job("fine", beat_age=300)
    with SessionLocal() as db:
        assert durable.reclaim(db) == 1
    assert wait_for(lambda: [k for k, _ in RAN] == ["fine"])
    with SessionLocal() as db:
        assert db.query(DurableJob).filter_by(status="failed").count() == 1


def test_a_run_that_was_taken_over_cannot_delete_the_new_owners_row():
    jid = add_job("taken", owner="the-new-owner:1:x", beat_age=1)
    durable._finish(jid, [])  # the slow original run ends and tries to clean up
    with SessionLocal() as db:
        assert db.get(DurableJob, jid) is not None


def test_takeover_holds_no_database_connection_while_the_job_runs():
    started, release, seen = threading.Event(), threading.Event(), []

    def slow(db, key):
        started.set()
        seen.append(engine.pool.checkedout())
        release.wait(5)
    import sys
    sys.modules[__name__].slow_job = slow
    slow.__module__, slow.__qualname__ = __name__, "slow_job"
    with SessionLocal() as db:
        db.add(DurableJob(fn=f"{__name__}:slow_job", args=["k"], refs=[], status="running", attempts=1, owner=OTHER, heartbeat_at=_now() - timedelta(seconds=300)))
        db.commit()
    settle()
    with SessionLocal() as db:
        assert durable.reclaim(db) == 1
    assert started.wait(5)
    time.sleep(0.2)
    assert engine.pool.checkedout() == 0  # the job is waiting for "Google"; it holds nothing
    release.set()


# ── the start-up cleanups leave other processes' work alone ───────────────────
def make_audit(status="running"):
    with SessionLocal() as db:
        a = Audit(kind="technical", status=status)
        db.add(a)
        db.commit()
        return a.id


def test_start_up_does_not_fail_an_audit_that_a_job_in_another_process_is_running():
    live, dead = make_audit(), make_audit()
    add_job("run", beat_age=2, refs=[f"audit:{live}"])  # another process, alive
    with SessionLocal() as db:
        jobs.recover_stale(db, startup=True)
    with SessionLocal() as db:
        assert db.get(Audit, live).status == "running"
        assert db.get(Audit, dead).status == "failed"  # nobody is running this one


def test_an_audit_waiting_for_its_dead_owners_take_over_is_not_failed_either():
    waiting = make_audit()
    add_job("run", beat_age=300, refs=[f"audit:{waiting}"])  # its owner went quiet; it will be taken over within the minute
    with SessionLocal() as db:
        jobs.recover_stale(db, startup=True)
    with SessionLocal() as db:
        assert db.get(Audit, waiting).status == "running"


# ── Lighthouse: one process runs an audit ─────────────────────────────────────
def lh_audit(status="queued", age_seconds=0):
    with SessionLocal() as db:
        a = LighthouseAudit(submitted_url="https://x.example/", strategy="mobile", engine="lighthouse", status=status)
        db.add(a)
        db.commit()
        aid = a.id
        if age_seconds:
            from sqlalchemy import text
            db.execute(text("update lighthouse_audits set updated_at = :t where id = :i"), {"t": _now() - timedelta(seconds=age_seconds), "i": aid})
            db.commit()
        return aid


def test_two_processes_handed_the_same_audit_run_it_once(monkeypatch):
    aid = lh_audit()
    calls = []

    def fake_validate(url):
        calls.append(url)
        time.sleep(0.3)
        raise lighthouse_runner.SSRFValidationError("stop here")
    monkeypatch.setattr(lighthouse_runner, "resolve_and_validate", fake_validate)
    barrier = threading.Barrier(4)

    def process():
        barrier.wait(5)
        lighthouse_runner.execute(aid)
    threads = [threading.Thread(target=process) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert len(calls) == 1
    with SessionLocal() as db:
        assert db.get(LighthouseAudit, aid).status == "failed"


def test_lighthouse_recovery_takes_only_audits_that_have_gone_quiet(monkeypatch):
    queued = []
    monkeypatch.setattr(lighthouse_runner, "submit", lambda audit_id, engine: queued.append(audit_id))
    busy, quiet = lh_audit("running", 5), lh_audit("running", 3600)
    with SessionLocal() as db:
        assert lighthouse_runner.recover_interrupted(db) >= 1
    with SessionLocal() as db:
        assert db.get(LighthouseAudit, busy).status == "running"  # another process is working on it
        assert db.get(LighthouseAudit, quiet).status == "queued" and quiet in queued


# ── helper threads ────────────────────────────────────────────────────────────
def test_a_helper_thread_is_started_once_and_its_errors_are_logged_not_lost(caplog):
    gate, ran = threading.Event(), []
    assert lifecycle.run_single("t5-one", lambda: (ran.append(1), gate.wait(5)))
    assert wait_for(lambda: ran)
    assert lifecycle.run_single("t5-one", lambda: ran.append(2)) is False  # already running: not started twice
    gate.set()
    assert wait_for(lambda: "t5-one" not in lifecycle.running())

    def boom():
        raise RuntimeError("helper failed")
    with caplog.at_level("ERROR", logger="seo.lifecycle"):
        assert lifecycle.run_single("t5-boom", boom)
        assert wait_for(lambda: "t5-boom" not in lifecycle.running())
    assert any("t5-boom" in r.getMessage() for r in caplog.records) and ran == [1]


def test_shutdown_asks_helpers_to_stop_and_waits_for_them():
    saw = []

    def helper():
        lifecycle.STOP.wait(10)
        saw.append("stopped")
    lifecycle.reset()
    try:
        assert lifecycle.run_single("t5-stop", helper)
        left = lifecycle.stop_all(timeout=5)
        assert saw == ["stopped"] and "t5-stop" not in left
    finally:
        lifecycle.reset()


def test_the_heartbeat_thread_starts_once_and_stops_at_shutdown():
    durable.ensure_heartbeat()
    durable.ensure_heartbeat()
    assert len([t for t in threading.enumerate() if t.name == "job-heartbeat"]) == 1
    durable.stop()
    assert wait_for(lambda: not [t for t in threading.enumerate() if t.name == "job-heartbeat"])


def test_the_dashboard_refresh_runs_one_at_a_time(client, monkeypatch):
    from app.routers import flow
    started, gate, runs = threading.Event(), threading.Event(), []

    def slow(ids):
        runs.append(list(ids))
        started.set()
        gate.wait(5)
    monkeypatch.setattr(flow, "_work_out", slow)
    assert lifecycle.run_single("flow-refresh", flow._work_out, [1])
    assert started.wait(5)
    assert lifecycle.run_single("flow-refresh", flow._work_out, [2]) is False  # a second request does not start a second refresher
    gate.set()
    assert wait_for(lambda: "flow-refresh" not in lifecycle.running())
    assert runs == [[1]]


# ── competitors ───────────────────────────────────────────────────────────────
def _biz(client, name="Phase5 Co"):
    return client.post("/api/v1/businesses", json={"name": name, "website": "https://phase5.example/", "services": [{"name": "Rental"}]}).json()["id"]


FULL = {"basics": {"name": "Glam", "category": "Clothing rental", "phone": "1", "website": "https://g.example", "summary": "s"}, "reputation": {"photos": 12, "count": 150, "rating": 4.7, "reviews": []},
        "hours": [1], "features": ["a", "b", "c"], "maps_url": "https://maps.example/g"}


def test_listing_compare_holds_no_connection_during_google_reads_and_reads_both_listings_side_by_side(client, monkeypatch):
    monkeypatch.setattr("app.services.ai.is_configured", lambda: False)
    bid = _biz(client)
    with SessionLocal() as db:
        from app.models import Business
        b = db.get(Business, bid)
        b.place_id = "ours"
        db.commit()
    c = client.post("/api/v1/competitors/maps", json={"business_id": bid, "name": "Glam Rental", "cid": "theirs"}).json()
    held, active, peak, lock = [], [0], [0], threading.Lock()

    def read(pid, fresh=False):
        with lock:
            active[0] += 1
            peak[0] = max(peak[0], active[0])
        held.append(engine.pool.checkedout())
        time.sleep(0.4)
        with lock:
            active[0] -= 1
        return FULL
    monkeypatch.setattr("app.services.maps_public.read", read)
    settle()
    r = client.post(f"/api/v1/competitors/{c['id']}/listing-compare")
    assert r.status_code == 200, r.text
    assert r.json()["you"]["listing_read"] is True and r.json()["scores"]["ours"] and r.json()["scores"]["theirs"]
    assert peak[0] == 2  # theirs and ours were read at the same time
    assert max(held) == 0  # and no pooled connection was held while Google was answering


def test_our_own_listing_failing_does_not_stop_the_comparison(client, monkeypatch):
    monkeypatch.setattr("app.services.ai.is_configured", lambda: False)
    bid = _biz(client, "Phase5 Two")
    with SessionLocal() as db:
        from app.models import Business
        db.get(Business, bid).place_id = "ours"
        db.commit()
    c = client.post("/api/v1/competitors/maps", json={"business_id": bid, "name": "Rival", "cid": "theirs"}).json()

    def read(pid, fresh=False):
        if pid == "ours":
            raise RuntimeError("Google is down for this one")
        return FULL
    monkeypatch.setattr("app.services.maps_public.read", read)
    r = client.post(f"/api/v1/competitors/{c['id']}/listing-compare")
    assert r.status_code == 200 and r.json()["you"]["listing_read"] is False and r.json()["scores"]["theirs"]


def test_their_listing_failing_is_reported_as_before(client, monkeypatch):
    bid = _biz(client, "Phase5 Three")
    c = client.post("/api/v1/competitors/maps", json={"business_id": bid, "name": "Rival Three", "cid": "theirs"}).json()
    monkeypatch.setattr("app.services.maps_public.read", lambda pid, fresh=False: (_ for _ in ()).throw(RuntimeError("down")))
    r = client.post(f"/api/v1/competitors/{c['id']}/listing-compare")
    assert r.status_code == 502 and "Google Maps could not be read" in r.json()["detail"]


def test_the_same_audit_asked_twice_at_once_reads_google_once(client, monkeypatch):
    monkeypatch.setattr("app.services.ai.is_configured", lambda: False)
    bid = _biz(client, "Phase5 Four")
    c = client.post("/api/v1/competitors/maps", json={"business_id": bid, "name": "Rival Four", "cid": "theirs"}).json()
    reads, gate, started = [], threading.Event(), threading.Event()

    def read(pid, fresh=False):
        reads.append(pid)
        started.set()
        gate.wait(5)
        return FULL
    monkeypatch.setattr("app.services.maps_public.read", read)
    out = []
    first = threading.Thread(target=lambda: out.append(client.post(f"/api/v1/competitors/{c['id']}/listing-audit").status_code))
    first.start()
    assert started.wait(5)
    second = client.post(f"/api/v1/competitors/{c['id']}/listing-audit")
    gate.set()
    first.join(10)
    assert second.status_code == 409 and out == [200] and reads == ["theirs"]
    assert client.post(f"/api/v1/competitors/{c['id']}/listing-audit").status_code == 200  # and a later one is fine


def test_finding_competitors_holds_no_connection_while_google_answers(client, monkeypatch):
    from app.competitors import service
    bid = _biz(client, "Phase5 Five")
    held = []

    def find(*a, **k):
        held.append(engine.pool.checkedout())
        time.sleep(0.3)
        return [{"name": "Shop", "website": "https://shop5.example", "address": "x"}]
    monkeypatch.setattr(service, "find_competitors", find)
    settle()
    r = client.post("/api/v1/competitors", json={"business_type": "Dentist", "location": "Pune", "own_firm_name": "Phase5 Five", "top_n": 5, "business_id": bid})
    assert r.status_code == 200, r.text
    assert held == [0] and r.json()["count"] == 1 and r.json()["registered"]


def test_gbp_analysis_reads_the_own_listing_beside_the_competitors(monkeypatch):
    from app.competitors import gbp_analysis, listing_audit as la

    class B:
        id = 999999
        place_id = "ours"
        lat = lng = None
    active, peak, lock = [0], [0], threading.Lock()

    def audit_one(pid):
        with lock:
            active[0] += 1
            peak[0] = max(peak[0], active[0])
        time.sleep(0.3)
        with lock:
            active[0] -= 1
        if pid == "bad":
            raise RuntimeError("one listing failed")
        return la.score_listing(FULL) | {"place_id": pid}
    monkeypatch.setattr(la, "audit_one", audit_one)
    monkeypatch.setattr(la, "_resolve", lambda item, region, lat, lng: item.get("cid") or item.get("place_id"))
    comps = [{"name": f"C{i}", "place_id": "bad" if i == 2 else f"p{i}", "source": "maps"} for i in range(4)]
    with SessionLocal() as db:
        out = gbp_analysis.analyse(db, B(), comps)
    assert peak[0] >= 4  # the competitors and our own listing were read together
    assert sum(1 for c in out["competitors"] if c.get("error")) == 1 and sum(1 for c in out["competitors"] if not c.get("error")) == 3  # one failing listing stopped nothing


# ── the one-at-a-time guard across processes (PostgreSQL) ─────────────────────
def test_the_guard_is_the_same_number_in_every_process_and_works_without_a_database_lock_on_sqlite():
    from app.services import inflight
    assert inflight._lock_id(("check_ranks", 7)) == inflight._lock_id(("check_ranks", 7)) != inflight._lock_id(("check_ranks", 8))
    with inflight.only_one(("t5", 1)) as a, inflight.only_one(("t5", 1)) as b:
        assert a is True and b is False
    assert not inflight.running(("t5", 1))


@pytest.mark.skipif(engine.dialect.name != "postgresql", reason="advisory locks exist on PostgreSQL only")
def test_a_second_process_is_refused_while_the_first_runs_and_the_lock_goes_with_its_connection():
    from app.services import inflight
    key = ("t5-shared", 1)
    taken, conn = inflight._take_shared(key)  # "process one"
    assert taken is True and conn is not None
    other_taken, other_conn = inflight._take_shared(key)  # "process two" (a different connection, as a different process would have)
    assert other_taken is False and other_conn is None
    inflight._release_shared(conn)  # process one ends, or is killed: its connection closes
    again, again_conn = inflight._take_shared(key)
    assert again is True
    inflight._release_shared(again_conn)


def test_a_shutdown_does_not_stop_later_work_in_the_same_process(monkeypatch):
    """The stop signal ends with the shutdown: an app started again (or the next test) finds the indexing sender and the helpers working."""
    from app.services import indexing
    sent = []
    monkeypatch.setattr(indexing, "_send_later", lambda business_id, url, wait=0: sent.append((business_id, url)))
    assert lifecycle.stop_all(timeout=3) == []
    assert not lifecycle.STOP.is_set()
    assert indexing.send_later(5, "https://after-shutdown.example/p", delay=0.05)
    assert wait_for(lambda: sent == [(5, "https://after-shutdown.example/p")])
