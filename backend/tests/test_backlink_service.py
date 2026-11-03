"""Backlink service (Seed Backlink Finder): no network and no PostgreSQL. Pages come from httpx.MockTransport and the
bl_* tables live in a throwaway SQLite file (the ORM code is the same; the upsert dialect is picked from the engine)."""
import asyncio
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app.backlink_service import business_sync, lifecycle, slots, trigger
from app.backlink_service import repository as repo
from app.backlink_service.config import Settings, parse_offpeak
from app.backlink_service.crawler import index_matchers, page_backlinks
from app.backlink_service.db import Database
from app.backlink_service.extract import parse_page
from app.backlink_service.models import Backlink, Seed, Slot, Target
from app.backlink_service.urls import TargetMatcher
from app.backlink_service.worker import Worker

SEED_HOME = """<html><head><title>Seed Site</title></head><body>
<a href="/about">About</a> <a href="https://other-site.com/">Other</a> <a href="https://pinterest.com/x">pin</a>
<footer>Website Designed by <a href="https://www.codigix.co/">Codigix Infotech</a></footer>
</body></html>"""
SEED_ABOUT = """<html><head><title>About</title></head><body>
<a rel="nofollow sponsored" href="https://codigix.co/services/">Services</a>
<script>var t = '<a rel=\\"ugc\\" href=\\"https://blog.codigix.co/post\\">Blog post</a>';</script></body></html>"""
OTHER_HOME = '<html><head><title>Other</title></head><body><a href="https://codigix.co/blog">read</a></body></html>'
PAGES = {("seed-site.com", "/"): SEED_HOME, ("seed-site.com", "/about"): SEED_ABOUT, ("other-site.com", "/"): OTHER_HOME}


def handler(request: httpx.Request) -> httpx.Response:
    host = request.url.host.removeprefix("www.")
    if request.url.path == "/robots.txt":
        return httpx.Response(404)
    html = PAGES.get((host, request.url.path))
    if html is None:
        return httpx.Response(404)
    return httpx.Response(200, text=html, headers={"content-type": "text/html"})


@pytest.fixture()
def settings(tmp_path):
    seed_file = tmp_path / "seed.json"
    seed_file.write_text(json.dumps({"seed_urls": ["https://seed-site.com/"]}))
    return Settings(database_url=f"sqlite:///{tmp_path / 'bl.db'}", seed_file=seed_file, render_js="off", dns_check=False,
                    per_domain_delay=0.0, verbose=0, workers=1, auto_businesses=False, autostart=False)


@pytest.fixture()
def db(settings):
    database = Database(settings)
    database.create_tables()
    yield database
    database.dispose()


def run(db, settings, steps):
    """Run steps(worker) against a started fetcher with mocked HTTP."""
    async def scenario():
        worker = Worker(db, settings, httpx.MockTransport(handler))
        await worker.fetcher.start()
        try:
            return await steps(worker)
        finally:
            await worker.fetcher.close()
    return asyncio.run(scenario())


# ---- gating: crawling starts only after POST /backlinks/crawl --------------------------------

def test_crawler_waits_for_the_database_signal(db, settings):
    repo.load_seed_file(db, settings.seed_file)
    repo.register_target(db, "https://codigix.co/")  # a saved target alone must not start anything

    async def steps(worker):
        assert await worker.process_one() is False
        repo.set_crawl_enabled(db, True)
        assert await worker.process_one() is True
    run(db, settings, steps)
    assert repo.search_backlinks(db, "codigix.co")[1]


def test_worker_start_clears_the_signal_unless_autostart(db, settings):
    repo.set_crawl_enabled(db, True)

    async def start_stop(autostart):
        settings.autostart = autostart
        worker = Worker(db, settings, httpx.MockTransport(handler))
        await worker.start()
        await worker.stop()
    asyncio.run(start_stop(False))
    assert repo.crawl_enabled(db) is False
    asyncio.run(start_stop(True))
    assert repo.crawl_enabled(db) is True


# ---- continuous crawl end to end ---------------------------------------------------------------

def test_crawl_stores_backlinks_and_discovers_seeds(db, settings):
    repo.load_seed_file(db, settings.seed_file)
    repo.register_target(db, "https://codigix.co/")
    repo.set_crawl_enabled(db, True)

    async def steps(worker):
        assert await worker.process_one() is True   # seed-site.com
        assert await worker.process_one() is True   # other-site.com, discovered
        assert await worker.process_one() is False  # nothing else due
    run(db, settings, steps)
    _, found = repo.search_backlinks(db, "codigix.co")
    assert {(b.source_url, b.target_url) for b in found} == {
        ("https://seed-site.com/", "https://www.codigix.co/"), ("https://seed-site.com/about", "https://codigix.co/services"),
        ("https://seed-site.com/about", "https://blog.codigix.co/post"), ("https://other-site.com/", "https://codigix.co/blog")}
    by_target = {b.target_url: b for b in found}
    assert by_target["https://blog.codigix.co/post"].found_in == "script" and by_target["https://blog.codigix.co/post"].rel == ["ugc"]
    with db.session() as s:
        sites = {x.site_key: x.source for x in s.query(Seed)}
    assert sites == {"seed-site.com": "seed", "other-site.com": "discovered"}  # not pinterest (platform), not codigix.co (target)


# ---- seeds ------------------------------------------------------------------------------------

def test_user_seeds_bulk(db):
    repo.add_seeds(db, ["https://found-site.net/"], "discovered")
    out = repo.add_user_seeds(db, ["a-site.com", "https://www.a-site.com/x", "b-site.org ", "https://found-site.net", "nonsense", "pinterest.com"])
    assert out == {"added": 2, "promoted": 1, "already_existing": 0, "rejected": ["nonsense", "pinterest.com"]}
    with db.session() as s:
        assert {x.site_key: x.source for x in s.query(Seed)} == {"a-site.com": "seed", "b-site.org": "seed", "found-site.net": "seed"}
    assert repo.add_user_seeds(db, ["a-site.com"])["already_existing"] == 1


def test_new_user_seed_is_claimed_before_discovered_ones(db):
    repo.add_seeds(db, ["https://old-seed.com"], "seed")
    repo.add_seeds(db, ["https://disc-1.net", "https://disc-2.net"], "discovered")
    running = repo.claim_seed(db)
    repo.add_user_seeds(db, ["https://added-midway.com"])  # added while a crawl is running
    repo.finish_seed(db, running.id, 5, None, 86400, 3600)
    assert repo.claim_seed(db).site_key == "added-midway.com"


# ---- matching, scheduling, load ------------------------------------------------------------------

def test_matchers_are_looked_up_by_site():
    matchers = [TargetMatcher("https://codigix.co/"), TargetMatcher("https://shop-two.com/"), TargetMatcher("https://www.exact.com/page")]
    index = index_matchers(matchers)
    assert set(index) == {"codigix.co", "shop-two.com", "exact.com"}
    page = parse_page("https://seed.com/", '<a href="https://blog.codigix.co/x">a</a><a href="https://exact.com/other">b</a>'
                      '<a href="https://www.exact.com/page/">c</a><a href="https://elsewhere.com/">d</a>')
    assert {r["target_url"] for r in page_backlinks(page, index, 0)} == {"https://blog.codigix.co/x", "https://www.exact.com/page"}
    own = parse_page("https://codigix.co/", '<a href="https://codigix.co/x">own</a>')
    assert page_backlinks(own, index, 0) == []


def test_offpeak_window(db, settings):
    assert parse_offpeak("22-6") == (22, 6) and parse_offpeak("") is None and parse_offpeak("x") is None and parse_offpeak("5-5") is None
    settings.workers, settings.daytime_workers = 8, 2
    worker = Worker(db, settings)
    assert worker.allowed_workers() == 8  # no window: full speed all day
    settings.offpeak_hours = "22-6"
    assert worker.allowed_workers(datetime(2026, 11, 3, 23)) == 8
    assert worker.allowed_workers(datetime(2026, 11, 3, 3)) == 8
    assert worker.allowed_workers(datetime(2026, 11, 3, 14)) == 2
    settings.offpeak_hours = "9-17"
    assert worker.allowed_workers(datetime(2026, 11, 3, 10)) == 8 and worker.allowed_workers(datetime(2026, 11, 3, 20)) == 2


def test_governor_pauses_extra_workers_but_not_the_first(db, settings, monkeypatch):
    worker = Worker(db, settings)
    monkeypatch.setattr(worker, "overloaded", lambda: True)
    repo.load_seed_file(db, settings.seed_file)
    repo.register_target(db, "codigix.co")
    repo.set_crawl_enabled(db, True)
    settings.workers, settings.idle_sleep = 2, 0.01

    async def go():
        await worker.fetcher.start()
        worker.fetcher.transport = None
        tasks = [asyncio.create_task(worker._run(1))]  # worker 1 is paused by the governor: never claims a seed
        await asyncio.sleep(0.1)
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await worker.fetcher.close()
    asyncio.run(go())
    with db.session() as s:
        assert s.query(Seed).one().status == "pending"


# ---- time slots: groups of businesses, each searched for a few hours ---------------------------------

class T:  # a stand-in for a Target row
    def __init__(self, id):
        self.id, self.domain = id, f"biz{id}.com"


def test_groups_of_five_rotate():
    targets = [T(i) for i in range(1, 13)]  # 12 businesses: groups of 5, 5, 2
    sizes = [len(slots.group_for_slot(targets, 5, i)[0]) for i in range(4)]
    assert sizes == [5, 5, 2, 5]  # wraps around after the last group
    group, n_groups = slots.group_for_slot(list(reversed(targets)), 5, 1)
    assert n_groups == 3 and [t.id for t in group] == [6, 7, 8, 9, 10]  # ordered by id, whatever the input order
    assert slots.plain_mode(5, 5, 3) and not slots.plain_mode(6, 5, 3) and slots.plain_mode(50, 5, 0)


def test_slot_state_survives_and_advances(db):
    now = datetime(2026, 11, 3, 10, tzinfo=timezone.utc)
    assert repo.current_slot(db, 10800, now) == (0, now, True)                           # first start: slot 1 begins now
    assert repo.current_slot(db, 10800, now + timedelta(hours=2)) == (0, now, False)     # still inside 3 h
    index, started, advanced = repo.current_slot(db, 10800, now + timedelta(hours=3, minutes=5))
    assert (index, advanced) == (1, True) and started == now + timedelta(hours=3)
    index, started, advanced = repo.current_slot(db, 10800, now + timedelta(hours=30))    # crawler was off for a day
    assert index == 2 and advanced and started == now + timedelta(hours=30)               # next group, no group skipped


def test_each_slot_searches_only_its_group_of_businesses(db, settings):
    pages = {("seed-site.com", "/"): '<a href="https://biz-one.com/">1</a><a href="https://biz-two.com/">2</a>'
                                     '<a href="https://biz-three.com/">3</a>'}

    def h(request):
        html = pages.get((request.url.host.removeprefix("www."), request.url.path))
        if request.url.path == "/robots.txt" or html is None:
            return httpx.Response(404)
        return httpx.Response(200, text=html, headers={"content-type": "text/html"})

    settings.slot_businesses, settings.slot_hours, settings.discover_seeds = 2, 3.0, False
    repo.add_seeds(db, ["https://seed-site.com/"], "seed")
    repo.add_targets(db, ["biz-one.com", "biz-two.com", "biz-three.com"])  # groups: [one, two] then [three]
    with db.session() as s:  # onboarded long ago: they wait for their slot like everyone else
        s.query(Target).update({Target.created_at: datetime.now(timezone.utc) - timedelta(hours=10)})

    async def one_pass():
        worker = Worker(db, settings, httpx.MockTransport(h))
        await worker.fetcher.start()
        try:
            while await worker.process_one():
                pass
        finally:
            await worker.fetcher.close()

    def found():
        with db.session() as s:
            return {b.target_host for b in s.query(Backlink)}

    repo.set_crawl_enabled(db, True)
    asyncio.run(one_pass())
    assert found() == {"biz-one.com", "biz-two.com"}                  # slot 1: first group only
    asyncio.run(one_pass())
    assert found() == {"biz-one.com", "biz-two.com"}                  # nothing due until the slot ends
    with db.session() as s:
        long_ago = datetime.now(timezone.utc) - timedelta(hours=3, minutes=1)  # pretend 3 h passed
        s.get(Slot, 1).started_at = long_ago
        s.query(Seed).update({Seed.last_crawled_at: long_ago + timedelta(minutes=30)})
    asyncio.run(one_pass())                                            # slot 2: new pass over the seeds, second group
    assert found() == {"biz-one.com", "biz-two.com", "biz-three.com"}


def test_a_newly_onboarded_business_does_not_wait_for_its_slot(db, settings):
    pages = {("seed-site.com", "/"): '<a href="https://biz-one.com/">1</a><a href="https://biz-new.com/">new</a>'}

    def h(request):
        html = pages.get((request.url.host.removeprefix("www."), request.url.path))
        if request.url.path == "/robots.txt" or html is None:
            return httpx.Response(404)
        return httpx.Response(200, text=html, headers={"content-type": "text/html"})

    settings.slot_businesses, settings.slot_hours, settings.discover_seeds = 1, 3.0, False
    repo.add_seeds(db, ["https://seed-site.com/"], "seed")
    repo.add_targets(db, ["biz-one.com", "biz-old.com"])  # two groups of one: slot 1 = biz-one, slot 2 = biz-old
    with db.session() as s:
        s.query(Target).update({Target.created_at: datetime.now(timezone.utc) - timedelta(hours=10)})
    repo.add_targets(db, ["biz-new.com"])  # onboarded just now: third group, not its turn
    repo.set_crawl_enabled(db, True)

    async def one_pass():
        worker = Worker(db, settings, httpx.MockTransport(h))
        await worker.fetcher.start()
        try:
            while await worker.process_one():
                pass
        finally:
            await worker.fetcher.close()
    asyncio.run(one_pass())
    with db.session() as s:
        assert {b.target_host for b in s.query(Backlink)} == {"biz-one.com", "biz-new.com"}  # its turn is slot 3, but it ran at once


def test_fresh_targets_window():
    now = datetime(2026, 11, 3, 12, tzinfo=timezone.utc)

    class Tg:
        def __init__(self, id, hours_ago):
            self.id, self.created_at = id, now - timedelta(hours=hours_ago)
    group = [Tg(1, 50)]
    out = slots.fresh_targets([Tg(1, 0.1), Tg(2, 1), Tg(3, 5)], group, 3 * 3600, now)
    assert [t.id for t in out] == [2]  # 1 is in the group anyway, 3 is older than the window


# ---- onboarding triggers the search at once ----------------------------------------------------------

def test_onboarding_trigger_registers_the_site_and_starts(db, settings, monkeypatch):
    monkeypatch.setattr(lifecycle.state, "db", db)
    monkeypatch.setattr(lifecycle.state, "settings", settings)
    repo.add_seeds(db, ["https://seed-x.com"], "seed")
    repo.finish_seed(db, repo.claim_seed(db).id, 3, None, 86400, 3600)  # a finished seed...
    out = trigger.start_for_website("https://www.new-clinic.in/about-us")
    assert out == {"started": True, "target": "https://new-clinic.in/", "new": True}
    assert repo.crawl_enabled(db) is True
    assert [t.domain for t in repo.list_targets(db)] == ["new-clinic.in"]
    with db.session() as s:
        assert s.query(Seed).one().status == "pending"  # ...is read again for the new business
    assert trigger.start_for_website("new-clinic.in")["new"] is False  # onboarding again adds nothing
    assert trigger.start_for_website(None)["started"] is False and trigger.start_for_website("not a site")["started"] is False


def test_trigger_never_breaks_onboarding(monkeypatch):
    monkeypatch.setattr(lifecycle.state, "db", None)  # service not running (e.g. API-only tests)
    assert trigger.start_for_website("https://a-clinic.in")["started"] is False

    class Boom:
        def session(self):
            raise RuntimeError("database down")
    monkeypatch.setattr(lifecycle.state, "db", Boom())
    monkeypatch.setattr(lifecycle.state, "settings", Settings(database_url="sqlite://"))
    assert trigger.start_for_website("https://a-clinic.in") == {"started": False, "reason": "error"}


def test_the_platforms_onboarding_calls_the_trigger(client, monkeypatch):
    from app.routers import discover
    calls = []
    monkeypatch.setattr(discover.backlink_service_trigger, "start_for_website", lambda site: calls.append(site))
    monkeypatch.setattr(discover, "_onboard", lambda db, business_id: None)
    bid = client.post("/api/v1/businesses", json={"name": "Hook Clinic", "website": "https://hook-clinic.in/"}).json()["id"]
    assert calls == []  # creating a business alone does not start anything
    assert client.post(f"/api/v1/discover/onboard/{bid}").status_code == 202
    assert calls == ["https://hook-clinic.in/"]


# ---- businesses become targets automatically ---------------------------------------------------------

def test_active_businesses_become_targets(db, settings):
    settings.slot_hours = 0  # no time slots here: other tests leave businesses behind, which would form several groups
    from app.db import SessionLocal
    from app.models import Business
    made = []
    with SessionLocal() as s:
        for name, site, status in [("A", "https://www.alpha-biz.com/home", "active"), ("B", "beta-biz.in", "active"),
                                   ("C", "https://gamma-biz.com", "paused"), ("D", None, "active"), ("E", "https://alpha-biz.com/x", "active")]:
            b = Business(name=name, website=site, status=status)
            s.add(b)
            made.append(b)
        s.commit()
    try:
        assert {"https://alpha-biz.com/", "https://beta-biz.in/"} <= set(business_sync.business_targets())  # www/path/bare domain folded
        assert "https://gamma-biz.com/" not in business_sync.business_targets()  # paused
        repo.add_seeds(db, ["https://seed-x.com"], "seed")
        repo.finish_seed(db, repo.claim_seed(db).id, 3, None, 86400, 3600)  # a finished seed...
        assert business_sync.sync(db, settings) >= 2                                   # ...is due again once new targets arrive
        assert {t.domain for t in repo.list_targets(db)} >= {"alpha-biz.com", "beta-biz.in"}
        with db.session() as s:
            assert s.query(Seed).one().status == "pending"
        assert business_sync.sync(db, settings) == 0                                   # nothing new: no extra re-read
    finally:
        with SessionLocal() as s:
            for b in made:
                s.delete(s.get(Business, b.id))
            s.commit()


# ---- the routes ------------------------------------------------------------------------------------------

def test_routes_signal_through_the_database(client, db, settings, monkeypatch):
    monkeypatch.setattr(lifecycle.state, "db", db)
    monkeypatch.setattr(lifecycle.state, "settings", settings)
    monkeypatch.setattr(lifecycle.state, "worker", None)  # API-only process
    assert repo.crawl_enabled(db) is False
    r = client.post("/api/v1/backlinks/seeds", json={"seed_urls": ["a-site.com", "b-site.org", "nonsense"]})
    assert r.status_code == 202 and r.json()["added"] == 2 and r.json()["rejected"] == ["nonsense"]
    assert repo.crawl_enabled(db) is False  # saving seeds never starts the crawler
    r = client.post("/api/v1/backlinks/crawl", json={"target": "https://codigix.co/"})
    assert r.status_code == 202 and r.json()["status"] == "queued"
    assert repo.crawl_enabled(db) is True
    assert client.post("/api/v1/backlinks/crawl", json={"target": "nonsense"}).status_code == 422
    assert client.get("/api/v1/backlinks", params={"query": "codigix.co"}).json()["total"] == 0
    assert client.post("/api/v1/backlinks/seeds", json={"seed_urls": []}).status_code == 422
    with db.session() as s:
        s.add(Backlink(link_hash="h", source_url="https://a.com/p", source_site="a.com", target_url="https://codigix.co/",
                       target_key="codigix.co/", target_host="codigix.co", target_site="codigix.co", rel=[]))
    assert client.get("/api/v1/backlinks", params={"query": "codigix.co"}).json()["total"] == 1


def test_the_email_onboarding_pipeline_calls_the_trigger(client, monkeypatch):
    from app.services import pipeline
    calls = []
    monkeypatch.setattr(pipeline.backlink_service_trigger, "start_for_website", lambda site: calls.append(site))
    r = client.post("/api/v1/intake/emails", json={
        "from_addr": "sales@codigixinfotech.com", "subject": "New client onboarding: Trigger Dental", "message_id": "trigger-1",
        "body": "Business: Trigger Dental\nWebsite: https://triggerdental.in\nPhone: +91 98505 22141\nAddress: Shop 3, ITI Road, Aundh, Pune 411007\n"
                "Category: Dentist\nPackage: Growth\nMain services: implants, root canal"})
    assert r.status_code == 201
    assert client.get(f"/api/v1/intake/emails/{r.json()['id']}").json()["status"] == "done"
    assert calls == ["https://triggerdental.in"]


# ======================================================================================================
# Audit: edge cases of the crawler (each of these was checked before being called correct)
# ======================================================================================================
from app.backlink_service.crawler import backlink_row, crawl_site  # noqa: E402
from app.backlink_service.fetcher import Fetcher  # noqa: E402
from app.backlink_service.urls import site_key  # noqa: E402


def crawl(settings, h, start="https://seed-site.com/", limit=50, **kw):
    saved = []

    async def save(rows):
        saved.extend(rows)

    async def go():
        fetcher = Fetcher(settings, httpx.MockTransport(h))
        await fetcher.start()
        try:
            return await crawl_site(fetcher, start, limit, 50, [TargetMatcher("codigix.co")], save, **kw)
        finally:
            await fetcher.close()
    return asyncio.run(go()), saved


def site(pages, seen=None):
    def h(request):
        if seen is not None:
            seen.append(request.url.path + (f"?{request.url.query.decode()}" if request.url.query else ""))
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        body = pages.get(request.url.path)
        if body is None:
            return httpx.Response(404)
        if isinstance(body, tuple):  # (status, location)
            return httpx.Response(body[0], headers={"location": body[1]})
        return httpx.Response(200, text=body, headers={"content-type": "text/html"})
    return h


def links(*hrefs):
    return "<html><body>" + "".join(f'<a href="{h}">x</a>' for h in hrefs) + "</body></html>"


def aware(dt):
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


@pytest.mark.parametrize("slot_mode", [False, True])
def test_a_site_read_while_a_business_is_onboarded_is_read_again_soon(db, settings, slot_mode):
    """In-flight sites were read for the old set of businesses only; they must not wait a whole cycle for the new one."""
    repo.add_seeds(db, ["https://seed-site.com/"], "seed")
    repo.add_targets(db, ["codigix.co", "old-biz.com"])
    settings.slot_businesses, settings.slot_hours, settings.discover_seeds = (1 if slot_mode else 5), 3.0, False
    with db.session() as s:
        s.query(Target).update({Target.created_at: datetime.now(timezone.utc) - timedelta(hours=10)})
    repo.set_crawl_enabled(db, True)

    def h(request):
        if request.url.path == "/":
            repo.add_targets(db, ["late-biz.com"])  # onboarded while this site is being read
        return handler(request)

    async def go():
        worker = Worker(db, settings, httpx.MockTransport(h))
        await worker.fetcher.start()
        try:
            await worker.process_one()
        finally:
            await worker.fetcher.close()
    asyncio.run(go())
    with db.session() as s:
        seed = s.query(Seed).one()
        assert seed.status == "done" and aware(seed.next_crawl_at) <= datetime.now(timezone.utc) + timedelta(seconds=5)


def test_a_failure_after_the_crawl_never_leaves_the_site_stuck_in_crawling(db, settings, monkeypatch):
    repo.add_seeds(db, ["https://seed-site.com/"], "seed")
    repo.add_targets(db, ["codigix.co"])
    repo.set_crawl_enabled(db, True)
    monkeypatch.setattr(repo, "add_seeds", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("database hiccup")))

    async def go(worker):
        try:
            await worker.process_one()
        except Exception:
            pass
    run(db, settings, go)
    with db.session() as s:
        assert s.query(Seed).one().status != "crawling"


def test_nul_characters_are_removed_before_saving():
    page = parse_page("https://a.com/p", '<a href="https://codigix.co/">Cod\x00igix</a>')
    page.title = "Ti\x00tle"
    row = backlink_row(page, page.links[0], 0)
    assert all("\x00" not in v for v in row.values() if isinstance(v, str))


def test_one_page_that_cannot_be_saved_does_not_stop_the_site(settings):
    pages = {"/": links("/a", "/b", "https://codigix.co/"), "/a": links("https://codigix.co/a"), "/b": links("https://codigix.co/b")}
    saved, calls = [], []

    async def flaky(rows):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("cannot save this page")
        saved.extend(rows)

    async def go():
        fetcher = Fetcher(settings, httpx.MockTransport(site(pages)))
        await fetcher.start()
        try:
            return await crawl_site(fetcher, "https://seed-site.com/", 50, 50, [TargetMatcher("codigix.co")], flaky)
        finally:
            await fetcher.close()
    result = asyncio.run(go())
    assert result.pages == 3 and {r["target_url"] for r in saved} == {"https://codigix.co/a", "https://codigix.co/b"}


def test_query_string_variants_do_not_eat_the_page_budget(settings):
    seen = []
    pages = {"/": links(*[f"/services?autoplay=0&start={i}" for i in range(30)], "/about"), "/services": links(), "/about": links()}
    crawl(settings, site(pages, seen))
    assert sum(1 for p in seen if p.startswith("/services")) <= 5 and "/about" in seen


def test_a_crawler_trap_cannot_fill_memory(settings):
    pages = {"/": links(*[f"/p{i}" for i in range(200)])}
    result, _ = crawl(settings, site(pages), max_queue=10)
    assert result.pages <= 11  # the queue is capped, not the whole infinite space


def test_a_redirect_to_a_page_already_read_is_not_counted_twice(settings):
    pages = {"/": links("/a", "/b"), "/a": (301, "/b"), "/b": links()}
    result, _ = crawl(settings, site(pages))
    assert result.pages == 2  # "/" and "/b"


def test_trailing_slash_redirects_cost_one_request_per_page_after_the_first(settings):
    seen = []
    pages = {"/": links("/about", "/contact", "/blog"), "/about": (301, "/about/"), "/about/": links(),
             "/contact": (301, "/contact/"), "/contact/": links(), "/blog": (301, "/blog/"), "/blog/": links()}
    crawl(settings, site(pages, seen))
    assert seen.count("/contact") + seen.count("/blog") <= 1  # learned after /about: this site wants the slash


def test_robots_rules_are_refreshed_after_the_ttl(settings):
    seen = []
    settings.robots_ttl = 0.0
    crawl(settings, site({"/": links("/a", "/b"), "/a": links(), "/b": links()}, seen))
    assert seen.count("/robots.txt") >= 2


def test_businesses_that_await_approval_are_still_targets(db, settings):
    from app.db import SessionLocal
    from app.models import Business
    made = []
    with SessionLocal() as s:
        for name, web, status in [("A", "https://needs-ok-biz.com", "needs_approval"), ("B", "https://paused-biz.com", "paused"), ("C", "https://active-biz.com", "active")]:
            b = Business(name=name, website=web, status=status)
            s.add(b)
            made.append(b)
        s.commit()
    try:
        got = set(business_sync.business_targets())
        assert {"https://needs-ok-biz.com/", "https://active-biz.com/"} <= got and "https://paused-biz.com/" not in got
    finally:
        with SessionLocal() as s:
            for b in made:
                s.delete(s.get(Business, b.id))
            s.commit()


def test_only_one_crawler_process_may_run(db, settings, monkeypatch):
    assert repo.acquire_crawler_lock(db) is True  # SQLite: nothing to lock
    monkeypatch.setattr(repo, "acquire_crawler_lock", lambda database: None)  # another crawler holds it
    with pytest.raises(RuntimeError, match="already running"):
        asyncio.run(Worker(db, settings, httpx.MockTransport(handler)).start())


def test_interrupted_sites_are_queued_again_on_start(db, settings):
    repo.add_seeds(db, ["https://seed-site.com/"], "seed")
    repo.claim_seed(db)  # status crawling: the process died here

    async def go():
        worker = Worker(db, settings, httpx.MockTransport(handler))
        await worker.start()
        await worker.stop()
    asyncio.run(go())
    with db.session() as s:
        assert s.query(Seed).one().status == "pending"


def test_hosting_platform_subdomains_are_separate_sites():
    assert site_key("alice.blogspot.com") != site_key("bob.blogspot.com")
    assert site_key("a.myshopify.com") == "a.myshopify.com" and site_key("www.example.co.uk") == "example.co.uk"
    assert site_key("blog.codigix.co") == "codigix.co"


def test_a_site_that_cannot_be_read_says_why(settings):
    def disallow(request):
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nDisallow: /")
        return httpx.Response(200, text=links(), headers={"content-type": "text/html"})
    result, _ = crawl(settings, disallow)
    assert result.pages == 0 and "robots.txt" in result.error

    def moved(request):
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        if request.url.host == "seed-site.com":
            return httpx.Response(301, headers={"location": "https://another-company.com/"})
        return httpx.Response(200, text=links(), headers={"content-type": "text/html"})
    result, _ = crawl(settings, moved)
    assert result.pages == 0 and "another" in result.error


def test_link_context_is_only_computed_for_links_that_are_saved():
    page = parse_page("https://a.com/", "<p>Website Designed by <a href='https://codigix.co/'>Codigix</a></p><p><a href='/x'>x</a></p>")
    assert all(link.context == "" for link in page.links)  # nothing computed while reading the page
    rows = page_backlinks(page, [TargetMatcher("codigix.co")], 0)
    assert len(rows) == 1 and "Designed by" in rows[0]["context"]
    assert page.links[1].context == ""  # the other link never paid for it
