"""Ahrefs backlink report: parsing, storage in the bl_* tables (throwaway SQLite) and the /backlinks/ahrefs routes. The browser lookup is replaced by a fake
runner, so there is no network and no Chromium."""
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.backlink_service import ahrefs, lifecycle
from app.backlink_service.config import Settings
from app.backlink_service.db import Database
from app.backlink_service.models import AhrefsReport, utcnow

SAMPLE = {
    "domain": "bakulcatering.com", "mode": "subdomains", "domain_rating": "4.7",
    "backlinks": {"value": "883", "dofollow": "38%"}, "linking_websites": {"value": "833", "dofollow": "39%"},
    "referring_pages": [
        {"dr": "27", "referring_page_title": "Healthcare Digital Marketing Agency | Codigix Infotech", "referring_page_url": "https://codigix.co/",
         "anchor_text": "", "target_url": "https://www.bakulcatering.com/", "redirects": []},
        {"dr": "9", "referring_page_title": "🛸 Dark Side Links \x00", "referring_page_url": "http://gwc.spottedcow.media/2026/02/21/x/",
         "anchor_text": "JOIN OUR TELEGRAM", "target_url": "https://www.bakulcatering.com/", "redirects": ["301 https://old.bakulcatering.com/"]},
    ],
}


@pytest.fixture()
def db(tmp_path):
    database = Database(Settings(database_url=f"sqlite:///{tmp_path / 'bl.db'}", auto_businesses=False))
    database.create_tables()
    yield database
    database.dispose()


def lookup(db, domain="bakulcatering.com", mode="subdomains", refresh=False, runner=lambda d, m: SAMPLE):
    report, kind = ahrefs.request_report(db, domain, mode, refresh)
    if kind == "queued":
        ahrefs.run_report(db, report.id, runner)
    return report.id, kind


def test_normalize_domain():
    assert ahrefs.normalize_domain("https://www.Bakulcatering.com/blog?x=1") == "bakulcatering.com"
    assert ahrefs.normalize_domain("blog.codigix.co:8080") == "blog.codigix.co"
    for bad in ("", "nodot", "-rf.com", "a b.com", "127.0.0.1", "http://", "x.com; calc"):
        with pytest.raises(ValueError):
            ahrefs.normalize_domain(bad)


def test_parse_count():
    assert [ahrefs.parse_count(x) for x in ("883", "1,234", "1.2K", "3M", "x", None)] == [883, 1234, 1200, 3_000_000, None, None]


def test_report_is_stored_and_read_back_in_the_lookup_shape(db):
    rid, kind = lookup(db)
    assert kind == "queued"
    view = ahrefs.report_view(db, rid)
    assert view["status"] == "done" and view["error"] is None
    assert view["domain_rating"] == "4.7" and view["backlinks"] == {"value": "883", "dofollow": "38%"}
    assert view["linking_websites"] == {"value": "833", "dofollow": "39%"}
    first, second = view["referring_pages"]
    assert first == SAMPLE["referring_pages"][0] | {"dr": "27"}
    assert second["referring_page_title"] == "🛸 Dark Side Links " and second["redirects"] == ["301 https://old.bakulcatering.com/"]  # NUL removed, emoji kept
    with db.session() as s:
        r = s.get(AhrefsReport, rid)
        assert (r.backlinks_count, r.linking_websites_count, r.backlinks_dofollow_pct, r.domain_rating) == (883, 833, 38, 4.7)


def test_a_fresh_report_is_reused_unless_refresh(db):
    rid, _ = lookup(db)
    calls = []
    again, kind = lookup(db, runner=lambda d, m: calls.append(d) or SAMPLE)
    assert (again, kind, calls) == (rid, "cached", [])
    new, kind = lookup(db, refresh=True)
    assert kind == "queued" and new != rid
    old, kind = lookup(db, mode="exact")  # another mode is another report
    assert kind == "queued"
    with db.session() as s:
        s.get(AhrefsReport, new).finished_at = utcnow() - timedelta(hours=ahrefs.cache_hours() + 1)
        s.get(AhrefsReport, rid).finished_at = utcnow() - timedelta(hours=ahrefs.cache_hours() + 1)
    assert lookup(db)[1] == "queued"  # a stale report is looked up again


def test_a_running_lookup_is_not_started_twice_and_a_dead_one_is_released(db):
    report, kind = ahrefs.request_report(db, "a-clinic.in", "subdomains")
    assert kind == "queued"
    same, kind = ahrefs.request_report(db, "a-clinic.in", "subdomains")
    assert (same.id, kind) == (report.id, "in_progress")
    with db.session() as s:  # waiting an hour behind the daily refresh is normal: still in progress
        s.get(AhrefsReport, report.id).requested_at = utcnow() - timedelta(hours=1)
    assert ahrefs.request_report(db, "a-clinic.in", "subdomains")[1] == "in_progress"
    with db.session() as s:  # but running far longer than the timeout means the process died
        r = s.get(AhrefsReport, report.id)
        r.status, r.started_at = "running", utcnow() - timedelta(seconds=ahrefs.timeout_seconds() + 3600)
    new, kind = ahrefs.request_report(db, "a-clinic.in", "subdomains")
    assert kind == "queued" and new.id != report.id
    assert ahrefs.report_view(db, report.id)["status"] == "failed"
    with db.session() as s:  # a queued report nobody ran for a day is dropped too
        s.get(AhrefsReport, new.id).requested_at = utcnow() - timedelta(hours=ahrefs.QUEUED_MAX_HOURS + 1)
    assert ahrefs.request_report(db, "a-clinic.in", "subdomains")[1] == "queued"
    assert ahrefs.report_view(db, new.id)["status"] == "failed"


def test_a_report_runs_once_even_if_two_jobs_pick_it(db):
    report, _ = ahrefs.request_report(db, "a.com", "subdomains")
    calls = []
    ahrefs.run_report(db, report.id, lambda d, m: calls.append(d) or SAMPLE)
    ahrefs.run_report(db, report.id, lambda d, m: calls.append(d) or SAMPLE)  # the scheduler and a route's background task
    assert calls == ["a.com"]


def test_failures_are_recorded_not_raised(db):
    def boom(d, m):
        raise RuntimeError("Fortress is not set up")
    rid, _ = lookup(db, runner=boom)
    view = ahrefs.report_view(db, rid)
    assert view["status"] == "failed" and "not set up" in view["error"] and view["backlinks"] is None and view["referring_pages"] == []

    rid, _ = lookup(db, domain="b.com", runner=lambda d, m: {"domain": d, "error": "results did not appear (captcha or layout change)", "screenshot": "C:/x.png"})
    assert "captcha" in ahrefs.report_view(db, rid)["error"] and "C:/x.png" in ahrefs.report_view(db, rid)["error"]
    assert lookup(db, domain="b.com")[1] == "queued"  # a failed report is never served from the cache


def test_bad_pages_do_not_lose_the_report(db):
    broken = {**SAMPLE, "referring_pages": [{"dr": "n/a"}, {"referring_page_url": None}]}
    view = ahrefs.report_view(db, lookup(db, runner=lambda d, m: broken)[0])
    assert view["status"] == "done" and [p["dr"] for p in view["referring_pages"]] == ["", ""]


# ---- routes ----------------------------------------------------------------------------------

@pytest.fixture()
def api(client, db, monkeypatch):
    monkeypatch.setattr(lifecycle.state, "db", db)
    monkeypatch.setattr(ahrefs, "run_scraper", lambda d, m, timeout=None: SAMPLE | {"domain": d})
    return client


def test_route_queues_runs_in_background_and_serves_the_report(api):
    r = api.post("/api/v1/backlinks/ahrefs", json={"domain": "https://www.bakulcatering.com/about"})
    assert r.status_code == 202 and r.json()["state"] == "queued" and r.json()["domain"] == "bakulcatering.com"
    got = api.get("/api/v1/backlinks/ahrefs", params={"domain": "bakulcatering.com"})  # the background task has run by now
    assert got.status_code == 200 and got.json()["status"] == "done" and got.json()["backlinks"]["value"] == "883" and len(got.json()["referring_pages"]) == 2
    again = api.post("/api/v1/backlinks/ahrefs", json={"domain": "bakulcatering.com"})
    assert again.status_code == 200 and again.json()["state"] == "cached" and again.json()["domain_rating"] == "4.7"


def test_route_validation(api):
    assert api.post("/api/v1/backlinks/ahrefs", json={"domain": "not a domain"}).status_code == 422
    assert api.post("/api/v1/backlinks/ahrefs", json={"domain": "a.com", "mode": "weird"}).status_code == 422
    assert api.get("/api/v1/backlinks/ahrefs", params={"domain": "never-looked-up.com"}).status_code == 404


def test_route_needs_the_service(client, monkeypatch):
    monkeypatch.setattr(lifecycle.state, "db", None)
    assert client.post("/api/v1/backlinks/ahrefs", json={"domain": "a.com"}).status_code == 503


def test_href_test_route_waits_and_returns_the_data(api):
    r = api.get("/api/v1/backlinks/href", params={"domain": "bakulcatering.com"})
    assert r.status_code == 200 and r.json()["state"] == "queued" and r.json()["status"] == "done"
    assert r.json()["backlinks"] == {"value": "883", "dofollow": "38%"} and len(r.json()["referring_pages"]) == 2
    assert api.get("/api/v1/backlinks/href", params={"domain": "bakulcatering.com", "refresh": "false"}).json()["state"] == "cached"
    assert api.get("/api/v1/backlinks/href", params={"domain": "bad domain"}).status_code == 422


# ---- businesses: onboarding, daily refresh, what clients see ------------------------------------

def test_onboarding_queues_the_business_site(db, monkeypatch):
    from app.backlink_service import trigger
    monkeypatch.setattr(lifecycle.state, "db", db)
    monkeypatch.setattr(lifecycle.state, "settings", Settings(database_url="sqlite://", auto_businesses=False))
    trigger.start_for_website("https://www.bakulcatering.com/about")
    assert ahrefs.next_queued_id(db) is not None
    assert ahrefs.report_view(db, ahrefs.next_queued_id(db))["domain"] == "bakulcatering.com"
    assert ahrefs.queue_for_website(db, "bakulcatering.com")["state"] == "in_progress"  # onboarding again queues nothing new
    assert ahrefs.queue_for_website(db, None) == {"queued": False, "reason": "no valid website"}
    monkeypatch.setenv("AHREFS_AUTO", "0")
    assert ahrefs.queue_for_website(db, "other.com")["queued"] is False


def test_daily_refresh_queues_only_what_is_due(db):
    lookup(db, domain="fresh.com")  # looked up just now
    lookup(db, domain="old.com")
    lookup(db, domain="broken.com", runner=lambda d, m: {"error": "captcha"})
    with db.session() as s:  # old.com's report is a day old
        s.scalars(select(AhrefsReport).where(AhrefsReport.domain == "old.com")).one().finished_at = utcnow() - timedelta(hours=25)
    assert ahrefs.queue_due(db, ["fresh.com", "old.com", "broken.com", "new.com"]) == 2  # old.com and new.com; broken.com waits for its retry
    assert ahrefs.queue_due(db, ["fresh.com", "old.com", "broken.com", "new.com"]) == 0  # already queued
    with db.session() as s:
        s.scalars(select(AhrefsReport).where(AhrefsReport.domain == "broken.com")).one().finished_at = utcnow() - timedelta(hours=7)
    assert ahrefs.queue_due(db, ["broken.com"]) == 1  # retried after AHREFS_RETRY_HOURS


def test_clients_keep_seeing_the_last_report_while_it_refreshes(db):
    rid, _ = lookup(db)
    refresh, _ = ahrefs.request_report(db, "bakulcatering.com", "subdomains", refresh=True)
    view = ahrefs.client_view(db, "bakulcatering.com")
    assert view["report_id"] == rid and view["backlinks"]["value"] == "883" and view["refresh"]["status"] == "queued"
    ahrefs.run_report(db, refresh.id, lambda d, m: {"error": "captcha"})  # the refresh failed: the old data stays
    view = ahrefs.client_view(db, "bakulcatering.com")
    assert view["report_id"] == rid and view["refresh"]["status"] == "failed"
    new, _ = lookup(db, refresh=True, runner=lambda d, m: SAMPLE | {"backlinks": {"value": "900", "dofollow": "40%"}})
    view = ahrefs.client_view(db, "bakulcatering.com")
    assert view["report_id"] == new and view["backlinks"]["value"] == "900" and view["refresh"] is None
    with db.session() as s:
        assert s.query(AhrefsReport).filter_by(domain="bakulcatering.com", status="done").count() == 2  # every day's snapshot is kept
    assert ahrefs.client_view(db, "never.com") is None


def test_run_report_runs_concurrently_up_to_the_cap(db):
    """Several lookups started at once (as real users would trigger them) must actually overlap in time, not run one after another, but never
    more of them at once than AHREFS_MAX_CONCURRENT."""
    import threading
    import time

    cap = ahrefs.max_concurrent()
    n = cap + 2  # more jobs than the cap, so some are forced to wait for a slot
    active, max_active = 0, 0
    state_lock = threading.Lock()

    def slow_runner(d, m):
        nonlocal active, max_active
        with state_lock:
            active += 1
            max_active = max(max_active, active)
        time.sleep(0.3)
        with state_lock:
            active -= 1
        return SAMPLE | {"domain": d}

    reports = [ahrefs.request_report(db, f"site{i}.example", "subdomains")[0] for i in range(n)]
    threads = [threading.Thread(target=ahrefs.run_report, args=(db, r.id, slow_runner)) for r in reports]
    start = time.monotonic()
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)
    elapsed = time.monotonic() - start

    assert max_active == cap, f"expected exactly {cap} lookups running at once at the peak, saw {max_active}"
    # fully serial would take n * 0.3s; running `cap` at a time takes about ceil(n / cap) * 0.3s
    assert elapsed < (n - 1) * 0.3, f"took {elapsed:.2f}s, no faster than running them one at a time"
    for r in reports:
        view = ahrefs.report_view(db, r.id)
        assert view["status"] == "done" and view["domain"] == r.domain  # every concurrent write landed on the right row


def test_scheduler_queues_businesses_and_runs_them(db, monkeypatch):
    import asyncio
    monkeypatch.setattr(ahrefs, "business_domains", lambda: ["one.com", "two.com"])
    monkeypatch.setattr(ahrefs, "run_scraper", lambda d, m, timeout=None: SAMPLE | {"domain": d})
    monkeypatch.setattr(ahrefs, "pause_seconds", lambda: 0)

    async def scenario():
        stop = asyncio.Event()
        task = asyncio.create_task(ahrefs.scheduler(db, stop, look_every=0.05))
        for _ in range(100):
            await asyncio.sleep(0.05)
            if ahrefs.latest_report_id(db, "two.com", status="done"):
                break
        stop.set()
        await asyncio.wait_for(task, 5)
    asyncio.run(scenario())
    assert ahrefs.client_view(db, "one.com")["status"] == "done" and ahrefs.client_view(db, "two.com")["status"] == "done"
