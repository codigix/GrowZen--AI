"""Backlink bot rotation: batches of businesses take turns, each business works through its own share of the frontier,
and a later pass carries on where the last one stopped instead of fetching the same pages again."""
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import func, select

from app.backlinks import bot, engine, rotation
from app.backlinks.models import BiBotConfig, BiRotationState, BiTrackedTarget, FrontierUrl
from app.db import SessionLocal, utcnow
from app.models import Business
from test_backlinks import _wipe


@pytest.fixture()
def db():
    """Leaves the shared test database as it found it: backlink tables emptied and the businesses these tests create removed
    (other tests, e.g. the copilot's first-50-businesses reports, count the businesses that exist)."""
    s = SessionLocal()
    _wipe(s)
    s.query(BiRotationState).delete()
    s.commit()
    first_new = (s.scalar(select(func.max(Business.id))) or 0) + 1
    rotation._finished.clear()
    yield s
    s.rollback()
    _wipe(s)
    s.query(BiRotationState).delete()
    s.query(Business).filter(Business.id >= first_new).delete()
    s.commit()
    s.close()


def _businesses(client, db, n):
    ids = []
    for i in range(n):
        bid = client.post("/api/v1/businesses", json={"name": f"Rotation Co {i}"}).json()["id"]
        db.add(BiTrackedTarget(business_id=bid, domain=f"site{bid}.com"))
        db.add(BiBotConfig(business_id=bid, enabled=True))
        ids.append(bid)
    db.commit()
    return ids


def test_next_batch_goes_in_order_and_wraps():
    ids = list(range(1, 13))
    assert rotation.next_batch(ids, 0, 5) == ([1, 2, 3, 4, 5], False)
    assert rotation.next_batch(ids, 5, 5) == ([6, 7, 8, 9, 10], False)
    assert rotation.next_batch(ids, 10, 5) == ([11, 12], False)
    assert rotation.next_batch(ids, 12, 5) == ([1, 2, 3, 4, 5], True)  # all served: back to the first five
    assert rotation.next_batch([3, 4], 4, 5) == ([3, 4], True)  # fewer businesses than a batch: all of them every window
    assert rotation.next_batch([], 0, 5) == ([], False)


def test_batches_take_turns_by_window_and_wrap_to_a_new_pass(client, db, monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "backlink_batch_size", 5)
    monkeypatch.setattr(get_settings(), "backlink_batch_minutes", 60)
    ids = _businesses(client, db, 7)
    db.add(BiBotConfig(business_id=client.post("/api/v1/businesses", json={"name": "Bot off"}).json()["id"], enabled=False))  # not in the rotation
    db.commit()
    started = []
    spawn = lambda fn, bid, window, deadline, factory: started.append(bid)  # noqa: E731 - record instead of crawling
    t0 = utcnow()

    out = rotation.tick(db, now=t0, spawn=spawn)
    assert out["state"] == "started" and out["batch"] == ids[:5] and started == ids[:5]

    started.clear()  # half-way through the window (e.g. after a restart): the same batch is resumed, not replaced
    out = rotation.tick(db, now=t0 + timedelta(minutes=30), spawn=spawn)
    assert out["state"] == "running" and started == ids[:5]

    started.clear()  # window over: the next batch gets its turn
    out = rotation.tick(db, now=t0 + timedelta(minutes=61), spawn=spawn)
    assert out["batch"] == ids[5:] and started == ids[5:]
    assert bot.status(db, ids[0])["rotation"]["batches_before_turn"] == 0  # in the very next batch

    out = rotation.tick(db, now=t0 + timedelta(minutes=122), spawn=spawn)  # all served: back to the first five, pass 2
    assert out["batch"] == ids[:5] and out["pass"] == 2
    st = bot.status(db, ids[0])["rotation"]
    assert st["in_current_batch"] and st["pass"] == 2 and st["businesses_in_rotation"] == 7


def test_a_batch_that_runs_out_of_pages_hands_over_early(client, db, monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "backlink_batch_size", 2)
    ids = _businesses(client, db, 3)
    t0 = utcnow()

    def spawn(fn, bid, window, deadline, factory):
        rotation._finished[bid] = window  # as if its runs found nothing left to crawl

    assert rotation.tick(db, now=t0, spawn=spawn)["batch"] == ids[:2]
    assert rotation.tick(db, now=t0 + timedelta(minutes=1), spawn=spawn)["batch"] == ids[2:]  # long before the window ends


SITE = '<html><body><main><a href="/a">A</a> <a href="/b">B</a> <a href="https://elsewhere.org/">x</a></main></body></html>'


def _web(requested):
    def handler(req):
        requested.append((req.url.host, req.url.path))
        if req.url.path in ("/robots.txt", "/sitemap.xml"):
            return httpx.Response(404)
        return httpx.Response(200, text=SITE, headers={"content-type": "text/html"})
    return engine.PageFetcher(httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True), sleep=lambda s: None, default_delay=0)


def test_each_business_works_its_own_frontier_and_a_later_pass_skips_what_is_done(client, db):
    a, b = _businesses(client, db, 2)
    for bid in (a, b):
        bot.get_config(db, bid).max_hops = 0
    db.commit()
    bot.seed_targets(db, b)  # business b's work is queued too, but this run is a's turn

    requested = []
    stats = bot.run_cycle(db, _web(requested), a)
    assert stats["pages"] > 0
    assert {h for h, _ in requested} == {f"site{a}.com"}  # never took business b's pages
    assert db.scalar(select(FrontierUrl.status).where(FrontierUrl.url == f"https://site{b}.com/")) == "pending"
    assert all(r.business_id == a for r in db.scalars(select(FrontierUrl).where(FrontierUrl.url.like(f"%site{a}.com%"))))

    requested.clear()  # a's next turn the same day: everything it fetched is done, nothing is fetched twice
    assert bot.run_cycle(db, _web(requested), a)["pages"] == 0 and requested == []

    seed = db.scalar(select(FrontierUrl).where(FrontierUrl.url == f"https://site{a}.com/"))  # a day later: only the front door is looked at again
    seed.next_eligible_at = utcnow() - timedelta(hours=25)
    db.commit()
    requested.clear()
    bot.run_cycle(db, _web(requested), a)
    assert [p for _, p in requested if p != "/robots.txt"] == ["/"]


def test_the_worker_keeps_running_cycles_until_its_window_closes(client, db, monkeypatch):
    (a,) = _businesses(client, db, 1)
    calls = []

    def fake_run_cycle(s, fetcher, bid, budget_seconds=150, **kw):
        calls.append(budget_seconds)
        return {"pages": 3} if len(calls) < 3 else {"pages": 0}

    monkeypatch.setattr(bot, "run_cycle", fake_run_cycle)
    window = utcnow()
    rotation._work([a], window, window + timedelta(minutes=60), lambda: None)
    assert len(calls) == 3 and all(c <= bot.TIME_BUDGET_SECONDS for c in calls)
    assert rotation._finished[a] == window  # ran out of pages: its batch may hand over early

    calls.clear()  # a window with too little time left starts nothing
    rotation._work([a], window, utcnow() + timedelta(seconds=5), lambda: None)
    assert calls == []


def test_two_runs_queuing_the_same_url_at_once_keep_one_row(db):
    """Parallel runs: another business's run inserts the URL between our lookup and our insert. No crash, one row, the session stays usable."""
    from app.backlinks import frontier
    first = frontier.enqueue(db, "https://shared.org/page", business_id=None)
    db.commit()
    real_scalar, missed = db.scalar, []

    def scalar_missing_once(stmt, *a, **kw):  # the lookup does not see the row the other run just committed
        if not missed and "bi_frontier.url_hash" in str(stmt) and "count" not in str(stmt):
            missed.append(1)
            return None
        return real_scalar(stmt, *a, **kw)

    db.scalar = scalar_missing_once
    try:
        row = frontier.enqueue(db, "https://shared.org/page", priority=40, business_id=7)
    finally:
        db.scalar = real_scalar
    assert missed and row is not None and row.id == first.id
    assert row.priority == 40 and row.business_id == 7  # the shared row is upgraded and adopted instead
    db.commit()
    assert db.scalar(select(func.count()).select_from(FrontierUrl).where(FrontierUrl.url == "https://shared.org/page")) == 1


def test_shared_rows_are_claimed_by_whoever_reaches_them_but_owned_rows_are_not(db):
    from app.backlinks import frontier
    frontier.enqueue(db, "https://old-shared.org/", business_id=None)  # from before the rotation
    frontier.enqueue(db, "https://mine.org/", business_id=1)
    frontier.enqueue(db, "https://theirs.org/", business_id=2)
    db.commit()
    claimed = {r.url for r in frontier.take_next(db, 10, business_id=1)}
    assert claimed == {"https://old-shared.org/", "https://mine.org/"}
    db.rollback()
    assert {r.url for r in frontier.take_next(db, 10)} >= {"https://theirs.org/"}  # no business given: the old global behaviour


def test_a_business_switched_off_during_its_turn_is_not_restarted_every_minute(client, db, monkeypatch):
    (a,) = _businesses(client, db, 1)
    bot.get_config(db, a).enabled = False
    db.commit()
    calls = []
    monkeypatch.setattr(bot, "run_cycle", lambda *x, **k: calls.append(1) or {"pages": 1})
    window = utcnow()
    rotation._work([a], window, window + timedelta(minutes=60), lambda: None)
    assert calls == [] and rotation._finished[a] == window


def test_scheduler_uses_the_rotation_and_can_fall_back(monkeypatch):
    from app.config import get_settings
    from app.backlinks import router as bl_router
    from app.services import scheduler
    used = []
    monkeypatch.setattr(rotation, "tick", lambda db: used.append("rotation"))
    monkeypatch.setattr(bot, "run_due", lambda db, f: used.append("interval"))
    monkeypatch.setattr(bl_router, "get_fetcher", lambda: None)
    from app.backlinks import outcomes, watch
    monkeypatch.setattr(outcomes, "measure_due", lambda db: None)
    monkeypatch.setattr(watch, "run_due", lambda db, f: None)
    monkeypatch.setattr(get_settings(), "backlink_rotation_enabled", True)
    scheduler.bot_tick()
    monkeypatch.setattr(get_settings(), "backlink_rotation_enabled", False)
    scheduler.bot_tick()
    assert used == ["rotation", "interval"]


def test_email_onboarding_starts_the_first_run(monkeypatch):
    from app.backlinks import autostart
    from app.config import get_settings
    ran = []
    monkeypatch.setattr(autostart, "first_run", lambda db, bid: ran.append(bid))
    monkeypatch.setattr(get_settings(), "backlink_autostart", True)
    autostart.first_run_in_background(42)
    import time
    for _ in range(50):
        if ran:
            break
        time.sleep(0.05)
    assert ran == [42]
    ran.clear()
    monkeypatch.setattr(get_settings(), "backlink_autostart", False)
    autostart.first_run_in_background(43)
    time.sleep(0.2)
    assert ran == []


def test_overlapping_businesses_each_crawl_their_own_site_on_their_turn(client, db):
    """Business a tracks b's site as a competitor and queued it first; b can still crawl its own site on b's turn, and owns what it finds there."""
    a, b = _businesses(client, db, 2)
    db.add(BiTrackedTarget(business_id=a, domain=f"site{b}.com", is_competitor=True))
    for bid in (a, b):
        bot.get_config(db, bid).max_hops = 0
    db.commit()
    bot.seed_targets(db, a)  # a's seeds include b's front door, owned by a
    assert db.scalar(select(FrontierUrl.business_id).where(FrontierUrl.url == f"https://site{b}.com/")) == a
    requested = []
    bot.run_cycle(db, _web(requested), b)
    assert (f"site{b}.com", "/") in requested and not any(h == f"site{a}.com" for h, _ in requested)
    assert db.scalar(select(FrontierUrl.business_id).where(FrontierUrl.url == f"https://site{b}.com/a")) == b


def test_on_sqlite_a_batch_shares_one_thread_and_takes_turns(client, db, monkeypatch):
    a, b = _businesses(client, db, 2)
    order = []

    def fake_run_cycle(s, fetcher, bid, budget_seconds=150, **kw):
        order.append(bid)
        return {"pages": 1} if order.count(bid) < 2 else {"pages": 0}

    monkeypatch.setattr(bot, "run_cycle", fake_run_cycle)
    window = utcnow()
    rotation._work([a, b], window, window + timedelta(minutes=60), lambda: None)
    assert order == [a, b, a, b]  # run by run, not one business hogging the window
    assert rotation._finished[a] == rotation._finished[b] == window
    assert rotation._parallel(db) is (db.get_bind().dialect.name != "sqlite")
