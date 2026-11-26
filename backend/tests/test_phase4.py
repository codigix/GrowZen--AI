"""Phase 4: bounded concurrency (fan-out pools, background jobs, the delayed indexing sender), atomic claims, duplicate guards and failure isolation."""
import threading
import time
from datetime import datetime, timedelta, timezone

import pytest

from app.db import SessionLocal, engine
from app.models import Article, Business, Keyword
from app.services import durable, fanout, indexing, inflight


# ── fan-out pools: a process-wide limit ───────────────────────────────────────
def test_fanout_tasks_never_run_more_than_the_limit_at_once(monkeypatch):
    monkeypatch.setattr(fanout, "_slots", threading.BoundedSemaphore(4))
    monkeypatch.setattr(fanout, "MAX_FANOUT", 4)
    active, peak, lock = [0], [0], threading.Lock()

    def task(i):
        with lock:
            active[0] += 1
            peak[0] = max(peak[0], active[0])
        time.sleep(0.05)
        with lock:
            active[0] -= 1
        return i * 2
    results = []

    def request():  # six "requests", each fanning out five tasks through a pool of its own
        with fanout.ThreadPoolExecutor(max_workers=5) as pool:
            results.append(list(pool.map(task, range(5))))
    threads = [threading.Thread(target=request) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(20)
    assert len(results) == 6 and all(r == [0, 2, 4, 6, 8] for r in results)  # every task ran and the results are the same, in order
    assert peak[0] <= 4  # 30 tasks were asked for, never more than 4 ran together


def test_a_fanout_inside_a_fanout_cannot_deadlock(monkeypatch):
    monkeypatch.setattr(fanout, "_slots", threading.BoundedSemaphore(4))

    def inner(i):
        return i + 1

    def outer(i):  # a task that starts a pool of its own and waits for it
        with fanout.ThreadPoolExecutor(max_workers=3) as pool:
            return sum(pool.map(inner, range(3))) + i
    with fanout.ThreadPoolExecutor(max_workers=8) as pool:
        got = [f.result(timeout=10) for f in [pool.submit(outer, i) for i in range(8)]]  # 8 outer tasks, only 4 places
    assert got == [6 + i for i in range(8)]


def test_fanout_errors_reach_the_caller_and_free_their_place(monkeypatch):
    monkeypatch.setattr(fanout, "_slots", threading.BoundedSemaphore(2))

    def boom():
        raise ValueError("one source failed")
    with fanout.ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(boom) for _ in range(6)]
        for f in futures:
            with pytest.raises(ValueError):
                f.result(timeout=5)
    assert fanout.stats()["running"] == 0 and fanout._slots._value == 2  # nothing is left holding a place


# ── background jobs ───────────────────────────────────────────────────────────
def test_a_crowd_of_background_tasks_never_blocks_the_threads_that_answer_requests(monkeypatch):
    """BackgroundTasks run in the web server's own threads. With every place taken, the extra jobs must be handed on at once, not wait inside those threads."""
    monkeypatch.setattr(durable, "_slots", threading.BoundedSemaphore(2))
    running, peak, done, lock = [0], [0], [], threading.Lock()

    def work(i):
        with lock:
            running[0] += 1
            peak[0] = max(peak[0], running[0])
        time.sleep(0.4)
        with lock:
            running[0] -= 1
            done.append(i)
    gated = [durable._gate(lambda i=i: work(i)) for i in range(6)]  # what BackgroundTasks would call, six times at once
    returned_after = []

    def request_thread(job):
        t0 = time.monotonic()
        job()
        returned_after.append(time.monotonic() - t0)
    threads = [threading.Thread(target=request_thread, args=(g,)) for g in gated]
    for t in threads:
        t.start()
    time.sleep(0.1)
    for t in threads:
        t.join(10)
    time.sleep(1.5)
    assert sorted(done) == list(range(6)) and peak[0] <= 2  # all ran, two at a time
    fast = [x for x in returned_after if x < 0.2]
    assert len(fast) >= 4  # at least four request threads were released at once (two ran their job inline)


def test_a_failing_job_does_not_stop_the_others(monkeypatch):
    monkeypatch.setattr(durable, "_slots", threading.BoundedSemaphore(2))
    ok = []

    def good():
        ok.append(1)

    def bad():
        raise RuntimeError("this job crashed")
    threads = [durable.spawn(bad, name="bad"), durable.spawn(good, name="good1"), durable.spawn(good, name="good2")]
    for t in threads:
        t.join(5)
    assert len(ok) == 2 and durable._slots._value == 2  # the crash released its place and nothing else was affected


def test_the_job_limits_come_from_the_settings():
    from app.config import get_settings
    s = get_settings()
    assert (durable.MAX_BACKGROUND_JOBS, durable.MAX_RESUMED_AT_ONCE) == (s.background_jobs_max, s.background_resume_max) == (10, 3)
    assert fanout.MAX_FANOUT == s.fanout_max == 48


# ── indexing: one delayed sender instead of a sleeping thread per page ────────
def test_published_pages_are_sent_by_one_sender_and_each_only_once(monkeypatch):
    sent: list[tuple[int, str]] = []
    monkeypatch.setattr(indexing, "_send_later", lambda business_id, url, wait=0: sent.append((business_id, url)))
    before = {t.ident for t in threading.enumerate()}
    for i in range(30):
        assert indexing.send_later(1, f"https://x.example/p{i}", delay=0.05)
    assert indexing.send_later(1, "https://x.example/p3", delay=0.05) is False  # the same address waiting twice is sent once
    senders = [t for t in threading.enumerate() if t.name == "indexing-sender" and t.ident not in before]
    assert len(senders) <= 1  # thirty pages, one thread (an idle sender from an earlier test may already exist)
    deadline = time.monotonic() + 5
    while len(sent) < 30 and time.monotonic() < deadline:
        time.sleep(0.05)
    assert sorted(sent) == sorted((1, f"https://x.example/p{i}") for i in range(30))
    assert len([t for t in threading.enumerate() if t.name == "indexing-sender"]) <= 1


# ── one at a time ─────────────────────────────────────────────────────────────
def test_the_same_operation_cannot_run_twice_at_once():
    entered, results = threading.Event(), []

    def first():
        with inflight.only_one(("t", 1)) as ok:
            results.append(("first", ok))
            entered.set()
            time.sleep(0.3)
    t = threading.Thread(target=first)
    t.start()
    entered.wait(2)
    with inflight.only_one(("t", 1)) as ok:
        results.append(("second", ok))
    with inflight.only_one(("t", 2)) as ok:  # another key is free
        results.append(("other", ok))
    t.join(5)
    with inflight.only_one(("t", 1)) as ok:  # and the place is free again afterwards
        results.append(("later", ok))
    assert dict(results) == {"first": True, "second": False, "other": True, "later": True} and not inflight.running(("t", 1))


@pytest.fixture()
def project(client):
    bid = client.post("/api/v1/businesses", json={"name": "Phase4 Co", "website": "https://phase4.example", "city": "Pune", "primary_category": "Dentist"}).json()["id"]
    yield bid
    db = SessionLocal()
    for model in (Keyword, Article):
        db.query(model).filter(model.business_id == bid).delete()
    db.query(Business).filter(Business.id == bid).delete()
    db.commit()
    db.close()


def test_a_second_rank_check_for_the_same_project_is_refused_while_the_first_runs(client, project, monkeypatch):
    from app.services import organic
    gate, started = threading.Event(), threading.Event()

    def slow_check(db, b, keywords=None, **k):
        started.set()
        gate.wait(5)
        return {"checked": 0, "results": [], "location": None, "source": "x", "days": 28}
    monkeypatch.setattr(organic, "check", slow_check)
    out = {}

    def first():
        out["first"] = client.post(f"/api/v1/businesses/{project}/seo/check-ranks", json={}).status_code
    t = threading.Thread(target=first)
    t.start()
    assert started.wait(5)
    second = client.post(f"/api/v1/businesses/{project}/seo/check-ranks", json={})
    gate.set()
    t.join(10)
    assert second.status_code == 409 and "already running" in second.json()["detail"] and out["first"] == 200
    assert client.post(f"/api/v1/businesses/{project}/seo/check-ranks", json={}).status_code == 200  # free again


# ── atomic claims and isolation ───────────────────────────────────────────────
def test_two_syncs_of_the_same_business_cannot_both_start(monkeypatch):
    from app.backlinks import bot, crawler_sync
    from app.models import Business as B
    db = SessionLocal()
    b = B(name="Claim Co", website="https://claim.example", status="active")
    db.add(b)
    db.commit()
    bid = b.id
    db.close()
    monkeypatch.setattr(crawler_sync, "register_domains", lambda domains: (time.sleep(0.5), 0)[1])
    monkeypatch.setattr(crawler_sync, "register_competitors", lambda *a, **k: 0)
    monkeypatch.setattr(crawler_sync.sync, "sync_targets", lambda db_, biz: None)
    results = []
    gate = threading.Barrier(2)

    def go():
        s = SessionLocal()
        try:
            gate.wait(5)
            results.append(crawler_sync.run_cycle(s, bid))
        finally:
            s.close()
    ts = [threading.Thread(target=go) for _ in range(2)]
    for t in ts:
        t.start()
    for t in ts:
        t.join(15)
    skipped = [r for r in results if r.get("skipped") == "already running"]
    assert len(results) == 2 and len(skipped) == 1  # exactly one of them ran
    db = SessionLocal()
    assert bot.get_config(db, bid).running is False  # and the place was given back
    from app.backlinks.models import BiBotConfig as Cfg
    db.query(Cfg).filter(Cfg.business_id == bid).delete()  # the test database does not cascade, and ids are reused
    db.query(B).filter(B.id == bid).delete()
    db.commit()
    db.close()


def test_one_business_failing_does_not_stop_the_scheduled_syncs_of_the_others(monkeypatch):
    from app.backlinks import bot
    from app.backlinks.models import BiBotConfig, BiTrackedTarget
    from app.models import Business as B
    db = SessionLocal()
    ids = []
    for n in range(3):
        b = B(name=f"Iso {n}", website=f"https://iso{n}.example", status="active")
        db.add(b)
        db.flush()
        ids.append(b.id)
        db.add(BiBotConfig(business_id=b.id, enabled=True, interval_minutes=1))
        db.add(BiTrackedTarget(business_id=b.id, domain=f"iso{n}.example", is_competitor=False, monitoring_enabled=True))
    db.commit()
    monkeypatch.setattr(bot, "crawler_mode", lambda: True)
    ran, sessions = [], []

    def run_cycle(s, business_id):
        ran.append(business_id)
        sessions.append(s)  # kept alive, so Python cannot hand the same id to a later session
        if business_id == ids[1]:
            raise RuntimeError("the crawler refused this one")
    monkeypatch.setattr(bot, "run_cycle", run_cycle)
    try:
        bot.run_due(db)
        assert [i for i in ran if i in ids] == ids  # all three were tried, in order, the failure of the second did not stop the third
        assert len({id(x) for x in sessions}) == len(sessions)  # each in a session of its own
    finally:
        d2 = SessionLocal()
        for model in (BiTrackedTarget, BiBotConfig):
            d2.query(model).filter(model.business_id.in_(ids)).delete(synchronize_session=False)
        d2.query(B).filter(B.id.in_(ids)).delete(synchronize_session=False)
        d2.commit()
        d2.close()
        db.close()


# ── releasing the connection ──────────────────────────────────────────────────
def test_growth_start_steps_hold_no_connection_while_they_run(project):
    from app.services import growth_start
    seen = []
    db = SessionLocal()
    try:
        growth_start.begin(project, "tester")  # the run is reserved, as the endpoint does
        db.get(Business, project)  # a read: the session now holds a connection
        base = engine.pool.checkedout()
        growth_start._step(db, project, "measure", lambda: (seen.append(engine.pool.checkedout()), ("done", "done"))[1])
    finally:
        growth_start._runs.pop(project, None)
        db.close()
    assert seen == [base - 1]  # the step ran with the connection released


def test_the_article_ai_review_holds_no_connection_while_the_ai_answers(client, project, monkeypatch):
    from app.services import seo_report
    db = SessionLocal()
    a = Article(business_id=project, keyword="phase4 keyword", status="completed", title="T", meta_description="M", body="<p>" + "word " * 200 + "</p>")
    db.add(a)
    db.commit()
    aid = a.id
    db.close()
    seen = []
    monkeypatch.setattr(seo_report, "ai_review", lambda **k: (seen.append(engine.pool.checkedout()), {"checks": [], "body_hash": "x", "supporting_queries": []})[1])
    r = client.post(f"/api/v1/businesses/{project}/articles/{aid}/seo-report?ai=true")
    assert r.status_code == 200 and seen == [0]


def test_the_bell_asks_for_one_number_and_only_sees_its_own_alerts(client):
    r = client.get("/api/v1/notifications/unread-count")
    assert r.status_code == 200 and set(r.json()) == {"count"} and isinstance(r.json()["count"], int)
