"""A SQLAlchemy session belongs to one thread. The backlink overview, the backlink comparison and the organic rankings used to hand the request's session to a worker thread
(to look up the Google account for Search Console). They now look the account up on the request's thread and give the workers plain values only; the workers still run side by side."""
import threading
from datetime import date

import pytest
from sqlalchemy import event, func, select

from app.backlinks import overview as bo
from app.db import SessionLocal, engine
from app.models import Business, GoogleConnection
from app.services import crypto, gsc, gsc_access, organic_rankings as orx, url_overview as uo
from app.services.gbp import GbpError
from app.services import google_ads_client as ads
from test_backlink_hub import ME, RIVAL, world  # noqa: F401  (the crawler is faked and the links are stored)

CLICKS = [{"keys": ["dentist in pune", "https://mydental.in/"], "clicks": 12, "impressions": 300, "position": 3.6, "ctr": 0.04}]


@pytest.fixture(autouse=True)
def _no_real_data_service(monkeypatch):
    from app.services import backlink_checker as bc
    monkeypatch.setattr(bc, "dfs_configured", lambda: False)


class Spy:
    """Records, for the statements of the engine and for the faked Google calls, which thread ran them."""

    def __init__(self):
        self.main = threading.get_ident()
        self.statement_threads: set[int] = set()
        self.lookup_threads: list[int] = []
        self.query_threads: list[int] = []

    def attach(self):
        self._listener = lambda conn, cur, stmt, *a: self.statement_threads.add(threading.get_ident())
        event.listen(engine, "before_cursor_execute", self._listener)

    def detach(self):
        event.remove(engine, "before_cursor_execute", self._listener)


class FakeSearchConsole:
    def __init__(self, spy):
        self.spy = spy

    def query(self, site, body):
        self.spy.query_threads.append(threading.get_ident())
        return CLICKS


@pytest.fixture()
def spy(monkeypatch):
    s = Spy()

    def search_console(db, b, host):
        s.lookup_threads.append(threading.get_ident())
        db.scalar(select(func.count()).select_from(Business))  # the real lookup reads the database with the session it is given
        return "ok", "owner@x.in", FakeSearchConsole(s), "sc-domain:mydental.in"
    monkeypatch.setattr(gsc_access, "search_console", search_console)
    s.attach()
    yield s
    s.detach()


def _business(client, name="Thread Dental", website="https://mydental.in"):
    return client.post("/api/v1/businesses", json={"name": name, "primary_category": "Dentist", "city": "Pune", "website": website}).json()["id"]


def _faked_google(monkeypatch):
    monkeypatch.setattr(uo, "_public", lambda u: u if "//" in u else "https://" + u)  # no DNS in the tests
    monkeypatch.setattr(uo, "authority", lambda site: {"da": 40, "rd": 10, "spam": 1, "ranking_keywords": 100})
    monkeypatch.setattr(uo, "page_analysis", lambda url: {"url": url, "title": "My page"})
    monkeypatch.setattr(uo, "phrases", lambda page, keyword: [])
    monkeypatch.setattr(ads, "geo_target_for", lambda country: "geo")
    monkeypatch.setattr(ads, "keyword_ideas", lambda *a, **k: [{"keyword": "dentist in pune", "avg_monthly_searches": 100, "competition_index": 10, "high_top_of_page_bid": 1.0}])
    monkeypatch.setattr(bo, "_ips", lambda domains: {})
    monkeypatch.setattr(bo, "_visits", lambda domain: {"visits": 1000})


# ── the session stays on its own thread ───────────────────────────────────────
def test_the_comparison_never_uses_the_session_from_a_worker_thread(world, spy, monkeypatch):
    _faked_google(monkeypatch)
    db = SessionLocal()
    try:
        out = bo.compare(db, db.get(Business, world), [RIVAL])
    finally:
        db.close()
    assert out["state"] == "ok" and out["profiles"][0]["organic_clicks"] == 12
    assert spy.lookup_threads == [spy.main]  # the Google account was looked up on the request's thread
    assert spy.statement_threads == {spy.main}  # every database statement ran on the request's thread
    assert spy.query_threads and all(t != spy.main for t in spy.query_threads)  # the Search Console read itself still ran in a worker


def test_the_overview_never_uses_the_session_from_a_worker_thread(world, spy, monkeypatch):
    _faked_google(monkeypatch)
    db = SessionLocal()
    try:
        out = bo.overview(db, db.get(Business, world))
    finally:
        db.close()
    assert out["state"] != "no_target" and out["authority"] is not None
    assert spy.lookup_threads == [spy.main] and spy.statement_threads == {spy.main}
    assert spy.query_threads and all(t != spy.main for t in spy.query_threads)


def test_the_organic_rankings_never_use_the_session_from_a_worker_thread(client, spy, monkeypatch):
    _faked_google(monkeypatch)
    bid = _business(client)
    spy.statement_threads.clear()  # the project was made through the API's own threads: only the call under test is measured
    db = SessionLocal()
    try:
        out = orx.summary(db, db.get(Business, bid), "https://mydental.in/", None, "IN")
    finally:
        db.close()
    assert out["search_console"]["own"] is True and out["search_console"]["totals"]["clicks"] == 12
    assert spy.lookup_threads == [spy.main] and spy.statement_threads == {spy.main}
    assert spy.query_threads and all(t != spy.main for t in spy.query_threads)
    assert out["keywords"] and out["authority"]["da"] == 40 and out["page"]["title"] == "My page"


# ── the workers still run side by side ────────────────────────────────────────
def test_the_comparison_still_runs_its_reads_at_the_same_time(world, spy, monkeypatch):
    """Authority and visits for both sites and the Search Console read: five calls that must all be in flight together (a barrier that only opens when all five have started)."""
    _faked_google(monkeypatch)
    gate = threading.Barrier(5, timeout=10)

    def wait(value):
        def inner(*a, **k):
            gate.wait()
            return value
        return inner
    monkeypatch.setattr(uo, "authority", wait({"da": 40, "rd": 10, "spam": 1, "ranking_keywords": 100}))
    monkeypatch.setattr(bo, "_visits", wait({"visits": 1}))
    monkeypatch.setattr(bo, "_ips", lambda domains: {})
    monkeypatch.setattr(FakeSearchConsole, "query", lambda self, site, body: (gate.wait(), CLICKS)[1])
    db = SessionLocal()
    try:
        out = bo.compare(db, db.get(Business, world), [RIVAL])
    finally:
        db.close()
    assert gate.broken is False and out["profiles"][0]["organic_clicks"] == 12


def test_the_organic_rankings_still_run_their_reads_at_the_same_time(client, spy, monkeypatch):
    _faked_google(monkeypatch)
    gate = threading.Barrier(6, timeout=10)  # authority, keyword ideas and the four Search Console reads
    monkeypatch.setattr(uo, "authority", lambda site: (gate.wait(), {"da": 1, "rd": 1, "spam": 0, "ranking_keywords": 1})[1])
    monkeypatch.setattr(ads, "keyword_ideas", lambda *a, **k: (gate.wait(), [])[1])
    monkeypatch.setattr(FakeSearchConsole, "query", lambda self, site, body: (gate.wait(), CLICKS)[1])
    bid = _business(client, "Gate Dental")
    db = SessionLocal()
    try:
        out = orx.summary(db, db.get(Business, bid), "https://mydental.in/", None, "IN")
    finally:
        db.close()
    assert out["search_console"]["own"] is True and gate.broken is False


# ── plain values ──────────────────────────────────────────────────────────────
def test_the_client_given_to_workers_holds_no_database_object(client):
    db = SessionLocal()
    conn = GoogleConnection(email="plain@x.in", refresh_token_enc=crypto.seal("refresh-token"), status="active", scopes="webmasters.readonly")
    db.add(conn)
    db.commit()
    try:
        real = gsc.SearchConsole(conn)
        plain = orx.plain_search_console(real)
        assert isinstance(plain, gsc.SearchConsole) and plain is not real
        assert not isinstance(plain.client.conn, GoogleConnection)  # not a database object: no session can be reached through it
        assert (plain.client.conn.id, plain.client.conn.email, plain.client.conn.refresh_token_enc) == (conn.id, "plain@x.in", conn.refresh_token_enc)
        fake = FakeSearchConsole(Spy())
        assert orx.plain_search_console(fake) is fake  # a test double or anything else is returned as it is
        assert orx.plain_search_console(None) is None
    finally:
        db.delete(conn)
        db.commit()
        db.close()


# ── cleanup and error handling ────────────────────────────────────────────────
def test_no_connection_is_left_checked_out(world, spy, monkeypatch):
    _faked_google(monkeypatch)
    pool = engine.pool
    if not hasattr(pool, "checkedout"):
        pytest.skip("this pool does not report checked-out connections")
    before = pool.checkedout()
    db = SessionLocal()
    try:
        bo.compare(db, db.get(Business, world), [RIVAL])
        bo.overview(db, db.get(Business, world))
    finally:
        db.close()
    assert pool.checkedout() == before


def test_a_failing_search_console_lookup_leaves_the_comparison_and_overview_answering(world, monkeypatch):
    _faked_google(monkeypatch)

    def broken(db, b, host):
        raise RuntimeError("google lookup failed")
    monkeypatch.setattr(gsc_access, "search_console", broken)
    db = SessionLocal()
    try:
        out = bo.compare(db, db.get(Business, world), [RIVAL])
        assert out["state"] == "ok" and out["profiles"][0]["organic_clicks"] is None
        assert bo.overview(db, db.get(Business, world))["state"] != "no_target"
    finally:
        db.close()


def test_organic_rankings_keep_their_answers_for_each_kind_of_lookup(client, monkeypatch):
    _faked_google(monkeypatch)
    bid = _business(client, "Answers Dental")
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        assert orx.summary(db, b, "https://another-site.example/page", None, "IN")["search_console"] == {"own": False}  # not the project's own site: no lookup
        monkeypatch.setattr(gsc_access, "search_console", lambda db, b, host: ("not_connected", "No Google account is linked to this project.", None, None))
        assert orx.summary(db, b, "https://mydental.in/", None, "IN")["search_console"] == {"own": True, "note": "No Google account is linked to this project."}

        def broken(db, b, host):
            raise RuntimeError("database or Google failure")
        monkeypatch.setattr(gsc_access, "search_console", broken)
        with pytest.raises(RuntimeError, match="database or Google failure"):  # an unexpected failure still reaches the caller, as before
            orx.summary(db, b, "https://mydental.in/", None, "IN")

        class Failing(FakeSearchConsole):
            def query(self, site, body):
                raise GbpError("Google refused access to Search Console")
        monkeypatch.setattr(gsc_access, "search_console", lambda db, b, host: ("ok", "o@x.in", Failing(Spy()), "sc-domain:mydental.in"))
        got = orx.summary(db, b, "https://mydental.in/", None, "IN")["search_console"]
        assert got["own"] is True and "refused access" in got["note"]  # Google's own message is still the reason
    finally:
        db.close()


def test_the_endpoints_still_answer_with_the_same_structure(client, world, monkeypatch):
    _faked_google(monkeypatch)
    monkeypatch.setattr(gsc_access, "search_console", lambda db, b, host: ("ok", "o@x.in", FakeSearchConsole(Spy()), "sc-domain:mydental.in"))
    r = client.get(f"/api/v1/businesses/{world}/backlink-hub/overview")
    assert r.status_code == 200 and {"state", "domain", "authority"} <= set(r.json())
    r = client.post(f"/api/v1/businesses/{world}/backlink-hub/compare", json={"domains": [RIVAL]})
    assert r.status_code == 200
    body = r.json()
    assert body["state"] == "ok" and body["you"] == ME and [p["domain"] for p in body["profiles"]] == [ME, RIVAL]
    assert body["profiles"][0]["organic_clicks"] == 12 and set(body["profiles"][0]) == {"domain", "you", "tracked", "read", "authority", "visits", "organic_clicks", "crawler"}
    assert "opportunities" in body and "tracked" in body
    bid = _business(client, "Endpoint Dental")
    r = client.post(f"/api/v1/businesses/{bid}/seo/organic-rankings", json={"url": "https://mydental.in/"})
    assert r.status_code == 200 and set(r.json()) == {"page", "site", "authority", "country", "keywords", "search_console"}


def test_the_guard_itself_catches_a_session_handed_to_a_worker(world, spy):
    """The way the code used to work: the session goes into a worker thread. The spy must see the worker running a statement, or the tests above would prove nothing."""
    from concurrent.futures import ThreadPoolExecutor
    db = SessionLocal()
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            pool.submit(bo._gsc_clicks, db, db.get(Business, world)).result()  # _gsc_clicks(db, b) is the old shape: it uses `db` itself
        assert spy.lookup_threads and spy.lookup_threads[0] != spy.main
        assert spy.statement_threads - {spy.main}  # a statement ran on a thread that does not own the session
    finally:
        db.close()
