"""run_lighthouse waits for the Lighthouse engine to finish an audit. It used to keep one database session open for the whole wait (up to 7 minutes) and ask the database every 1.5 s.
Now it holds no connection while waiting, learns from the runner when the audit is done, and only looks at the database then and (as a fallback) every few seconds."""
import json
import threading
import time

import pytest
from sqlalchemy import event

from app.config import get_settings
from app.db import SessionLocal, engine
from app.models import LighthouseAudit
from app.services import audits, lighthouse_runner, pagespeed

REAL_RUN = audits.run_lighthouse  # captured at import: conftest replaces `audits.run_lighthouse` with a stub while each test runs

RAW = {"finalDisplayedUrl": "https://wait.example/", "fetchTime": "2026-10-27T10:00:00Z",
       "categories": {"seo": {"score": 0.9, "auditRefs": []}, "performance": {"score": 0.5}}, "audits": {}}


@pytest.fixture()
def report(tmp_path):
    path = tmp_path / "wait.json"
    path.write_text(json.dumps(RAW), encoding="utf-8")
    return str(path)


@pytest.fixture()
def runner(monkeypatch, report):
    """The real runner (its pool, its worker and its signal), with the audit itself replaced by one that takes `seconds` and then stores a result."""
    made: list[int] = []
    state = {"seconds": 0.4, "outcome": "completed"}

    def execute(audit_id):
        time.sleep(state["seconds"])
        db = SessionLocal()
        a = db.get(LighthouseAudit, audit_id)
        if a is None:  # the test that made it has already finished and removed it
            db.close()
            return
        if state["outcome"] == "completed":
            a.status, a.raw_json_path, a.engine_used = "completed", report, "pagespeed"
        else:
            a.status, a.error_message = "failed", "Google refused the audit"
        db.commit()
        db.close()
    monkeypatch.setattr(lighthouse_runner, "execute", execute)

    def create_and_queue(db, url, strategy, engine_name, site_audit_id=None, check_duplicate=True):
        a = LighthouseAudit(submitted_url=url, strategy=strategy, engine=engine_name, status="queued")
        db.add(a)
        db.commit()
        made.append(a.id)
        lighthouse_runner.submit(a.id, engine_name)
        return a
    monkeypatch.setattr(lighthouse_runner, "create_and_queue", create_and_queue)
    yield state, made
    deadline = time.monotonic() + 8
    while lighthouse_runner.active_count() and time.monotonic() < deadline:  # a worker still sleeping from this test must finish before its audits are removed
        time.sleep(0.05)
    lighthouse_runner.stop()
    db = SessionLocal()
    for i in made:
        db.query(LighthouseAudit).filter(LighthouseAudit.id == i).delete()
    db.commit()
    db.close()


class Monitor:
    def __init__(self):
        self.samples: list[int] = []
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        while not self._stop.is_set():
            self.samples.append(engine.pool.checkedout())
            time.sleep(0.003)

    def __enter__(self):
        self._t.start()
        return self

    def __exit__(self, *a):
        self._stop.set()
        self._t.join()


def old_wait(audit_id, poll):
    """The wait as it was: one session for the whole wait, the audit asked for again every `poll` seconds."""
    db = SessionLocal()
    try:
        lh = db.get(LighthouseAudit, audit_id)
        while lh.status in ("queued", "running"):
            time.sleep(poll)
            db.expire_all()
            lh = db.get(LighthouseAudit, audit_id)
        return lh.status
    finally:
        db.close()


@pytest.fixture()
def run(runner):
    return REAL_RUN


# ── the result and the errors are the same as before ──────────────────────────
def test_a_finished_audit_returns_its_summary(runner, run):
    out = run("https://wait.example/", "mobile")
    assert out["scores"]["seo"] == 90 and out["scores"]["performance"] == 50 and out["lighthouse_audit_id"] and out["engine_used"] == "pagespeed"
    assert lighthouse_runner._waiters == {}  # nothing is left registered


def test_a_failed_audit_raises_with_the_engines_message(runner, run):
    runner[0]["outcome"] = "failed"
    with pytest.raises(pagespeed.PageSpeedError, match="Google refused the audit"):
        run("https://wait.example/", "mobile")
    assert lighthouse_runner._waiters == {}


def test_an_audit_that_takes_too_long_times_out_as_before(runner, run, monkeypatch):
    runner[0]["seconds"] = 3
    monkeypatch.setattr(get_settings(), "lighthouse_timeout_seconds", -29.9)  # the deadline is timeout * 2 + 60 seconds: here about a fifth of a second
    t0 = time.monotonic()
    with pytest.raises(pagespeed.PageSpeedTimeoutError, match="took too long"):
        run("https://wait.example/", "mobile")
    assert time.monotonic() - t0 < 2 and lighthouse_runner._waiters == {}


def test_an_audit_finished_by_another_process_is_found_by_the_fallback_check(runner, run, monkeypatch, report):
    """No signal ever comes (another process ran it, or a restart cut the worker off): the database is still looked at every few seconds."""
    monkeypatch.setattr(audits, "LIGHTHOUSE_DB_CHECK_SECONDS", 0.1)
    monkeypatch.setattr(lighthouse_runner, "submit", lambda audit_id, engine_name: None)  # nothing runs here

    def finish_elsewhere():
        time.sleep(0.4)
        db = SessionLocal()
        for a in db.query(LighthouseAudit).filter(LighthouseAudit.id.in_(runner[1])):
            a.status, a.raw_json_path = "completed", report
        db.commit()
        db.close()
    threading.Thread(target=finish_elsewhere).start()
    out = run("https://wait.example/", "mobile")
    assert out["scores"]["seo"] == 90


# ── connections and database checks ───────────────────────────────────────────
def test_no_connection_is_held_and_the_database_is_asked_far_less_while_waiting(runner, run):
    runner[0]["seconds"] = 1.0
    seen: list[str] = []
    listener = lambda conn, cur, stmt, *a: seen.append(stmt)  # noqa: E731
    base = engine.pool.checkedout()
    event.listen(engine, "before_cursor_execute", listener)
    try:
        with Monitor() as m_new:
            run("https://wait.example/", "mobile")
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    new_reads = len([s for s in seen if "FROM lighthouse_audits" in s])
    # the same wait as it was before: one session, the audit asked for every 0.1 s (the real interval was 1.5 s, so this still understates the old cost)
    db = SessionLocal()
    a = LighthouseAudit(submitted_url="https://old.example/", strategy="mobile", engine="pagespeed", status="queued")
    db.add(a)
    db.commit()
    aid = a.id
    runner[1].append(aid)
    db.close()
    threading.Timer(1.0, lambda: (lambda s: (setattr(s.get(LighthouseAudit, aid), "status", "completed"), s.commit(), s.close()))(SessionLocal())).start()
    seen.clear()
    event.listen(engine, "before_cursor_execute", listener)
    try:
        with Monitor() as m_old:
            old_wait(aid, 0.1)
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    old_reads = len([s for s in seen if "FROM lighthouse_audits" in s])
    mid = lambda m: m.samples[len(m.samples) // 5: -len(m.samples) // 5]  # noqa: E731
    print(f"\nLIGHTHOUSE WAIT of 1 s: database reads before={old_reads} (at 0.1 s; at the real 1.5 s it was one per 1.5 s) after={new_reads} | connections held while waiting: before min={min(mid(m_old))} after max={max(mid(m_new))}")
    assert min(mid(m_old)) == base + 1  # before: a connection held for the whole wait
    assert max(mid(m_new)) == base  # after: none while waiting
    assert new_reads <= 4 < old_reads  # the first look, the look after the signal, and what the runner itself writes


def test_several_audits_at_once_do_not_hold_connections(runner, run):
    runner[0]["seconds"] = 1.0
    n = 6
    results, errors = [], []

    def one():
        try:
            results.append(run("https://wait.example/", "mobile"))
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
    base = engine.pool.checkedout()
    threads = [threading.Thread(target=one) for _ in range(n)]
    with Monitor() as m:
        for t in threads:
            t.start()
        for t in threads:
            t.join()
    middle = m.samples[len(m.samples) // 5: -len(m.samples) // 5]
    print(f"\nLIGHTHOUSE {n} audits at once: most connections held while they wait: {max(middle)} (before: {n}, one each)")
    assert not errors and len(results) == n
    assert max(middle) <= base + 2
    deadline = time.monotonic() + 3
    while engine.pool.checkedout() != base and time.monotonic() < deadline:  # a worker of an earlier test may still be closing its session
        time.sleep(0.05)
    assert engine.pool.checkedout() == base
    assert lighthouse_runner._waiters == {}
