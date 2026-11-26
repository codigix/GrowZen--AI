"""GET /businesses/{id}/articles/{article_id}/stream: the same server-sent events as before, but no database connection is held while the stream waits for its next look.

`old_gen` is a frozen copy of the loop the endpoint used to run (one session for the whole stream, db.refresh(a) every second): the tests compare the new stream with it."""
import asyncio
import json
import threading
import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.db import SessionLocal, engine
from app.main import app
from app.models import Article, Business
from app.routers import articles as ar
from test_flow_optimized import _forget, _login, _user

POLL = 0.05


@pytest.fixture(autouse=True)
def fast_polls(monkeypatch):
    monkeypatch.setattr(ar, "STREAM_POLL_SECONDS", POLL)


@pytest.fixture()
def project(client):
    bid = client.post("/api/v1/businesses", json={"name": "Stream Co", "website": "https://stream.example"}).json()["id"]
    made: list[int] = []
    yield bid, made
    db = SessionLocal()
    for aid in made:
        db.query(Article).filter(Article.id == aid).delete()
    db.query(Business).filter(Business.id == bid).delete()
    db.commit()
    db.close()


def article(bid, made, **kw):
    db = SessionLocal()
    a = Article(business_id=bid, keyword="stream keyword", **kw)
    db.add(a)
    db.commit()
    aid = a.id
    db.close()
    made.append(aid)
    return aid


def update(aid, **kw):
    db = SessionLocal()
    for k, v in kw.items():
        setattr(db.get(Article, aid), k, v)
    db.commit()
    db.close()


def events(chunks):
    return [json.loads(c[len("data: "):]) for c in chunks]


async def collect(resp):
    return [c if isinstance(c, str) else c.decode() async for c in resp.body_iterator]


def new_stream(bid, aid):
    """The endpoint called the way FastAPI calls it: with the project and the request's session."""
    db = SessionLocal()
    try:
        return ar.stream_article(aid, db.get(Business, bid), db), db
    except BaseException:
        db.close()
        raise


async def old_gen(db, a, max_polls, stats=None):
    """The loop as it was: one session for the whole stream, the whole row refreshed every second."""
    last_body_len, last_progress = 0, ""
    for _ in range(max_polls):
        await asyncio.sleep(POLL)
        try:
            db.refresh(a)
        except Exception:
            break
        if stats is not None:
            stats["body_bytes"] += len(a.body or "")
        prog = (a.progress or "").strip()
        if prog and prog != last_progress:
            last_progress = prog
            yield f"data: {json.dumps({'type': 'progress', 'text': prog})}\n\n"
        body = a.body or ""
        if len(body) > last_body_len:
            delta = body[last_body_len:]
            last_body_len = len(body)
            yield f"data: {json.dumps({'type': 'body', 'html': delta})}\n\n"
        if a.status in ("completed", "failed"):
            yield f"data: {json.dumps({'type': 'done', 'status': a.status, 'title': a.title or '', 'meta': a.meta_description or '', 'body': a.body or '', 'error': a.error or ''})}\n\n"
            break


def old_stream(bid, aid):
    db = SessionLocal()
    a = ar._get(db, db.get(Business, bid), aid)  # the request's own session did this and kept it for the whole stream
    return a, db


class Monitor:
    """Samples how many pooled connections are checked out, every few milliseconds."""

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

    @property
    def mean(self):
        return sum(self.samples) / max(1, len(self.samples))


# ── the events ────────────────────────────────────────────────────────────────
def test_a_stream_sends_progress_then_the_growing_body_then_done(project):
    bid, made = project
    aid = article(bid, made, status="generating")

    def writer():
        time.sleep(0.12)
        update(aid, progress="Researching the topic")
        time.sleep(0.15)
        update(aid, progress="Writing", body="<p>One</p>")
        time.sleep(0.15)
        update(aid, body="<p>One</p><p>Two</p>")
        time.sleep(0.15)
        update(aid, status="completed", title="The title", meta_description="The meta", body="<p>One</p><p>Two</p><p>Three</p>")
    t = threading.Thread(target=writer)
    t.start()
    resp, db = new_stream(bid, aid)
    try:
        chunks = asyncio.run(collect(resp))
    finally:
        db.close()
        t.join()
    ev = events(chunks)
    assert all(c.startswith("data: ") and c.endswith("\n\n") for c in chunks)
    assert ev[-1]["type"] == "done" and [e["type"] for e in ev].count("done") == 1
    assert [e["text"] for e in ev if e["type"] == "progress"] == ["Researching the topic", "Writing"]
    assert "".join(e["html"] for e in ev if e["type"] == "body") == "<p>One</p><p>Two</p><p>Three</p>"  # deltas only, nothing sent twice
    assert ev[-1] == {"type": "done", "status": "completed", "title": "The title", "meta": "The meta", "body": "<p>One</p><p>Two</p><p>Three</p>", "error": ""}


@pytest.mark.parametrize("state", [
    dict(status="completed", progress="Done", body="<p>All of it</p>", title="T", meta_description="M"),
    dict(status="failed", progress="Writing", body="<p>Half</p>", error="The AI did not answer"),
    dict(status="failed", progress=None, body=None, error="Nothing was written"),
    dict(status="completed", progress="", body="<p>No progress text</p>", title=None, meta_description=None),
])
def test_a_finished_article_streams_exactly_what_it_streamed_before(project, state):
    bid, made = project
    aid = article(bid, made, **state)
    new, db1 = new_stream(bid, aid)
    a, db2 = old_stream(bid, aid)
    try:
        got_new = asyncio.run(collect(new))
        got_old = asyncio.run(collect(_Wrap(old_gen(db2, a, 5))))
    finally:
        db1.close()
        db2.close()
    assert got_new == got_old  # the same event strings in the same order
    assert events(got_new)[-1]["type"] == "done" and events(got_new)[-1]["status"] == state["status"]


class _Wrap:
    def __init__(self, gen):
        self.body_iterator = gen


def test_a_failed_article_ends_the_stream_with_its_error(project):
    bid, made = project
    aid = article(bid, made, status="generating", progress="Writing", body="<p>Part</p>")
    threading.Timer(0.15, update, args=(aid,), kwargs=dict(status="failed", error="The writer stopped")).start()
    resp, db = new_stream(bid, aid)
    try:
        ev = events(asyncio.run(collect(resp)))
    finally:
        db.close()
    assert ev[-1]["type"] == "done" and ev[-1]["status"] == "failed" and ev[-1]["error"] == "The writer stopped" and ev[-1]["body"] == "<p>Part</p>"


def test_the_response_headers_and_the_sse_framing_are_unchanged(project, client):
    bid, made = project
    aid = article(bid, made, status="completed", progress="Done", body="<p>Hi</p>", title="T", meta_description="M")
    with client.stream("GET", f"/api/v1/businesses/{bid}/articles/{aid}/stream") as r:
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream") and r.headers["cache-control"] == "no-cache" and r.headers["x-accel-buffering"] == "no"
        text = "".join(r.iter_text())
    blocks = [b for b in text.split("\n\n") if b]
    assert [json.loads(b[len("data: "):])["type"] for b in blocks] == ["progress", "body", "done"]


def test_a_stream_that_never_finishes_stops_after_its_maximum(project, monkeypatch):
    assert ar.STREAM_MAX_POLLS == 360  # the 6-minute maximum is kept (360 looks, one second apart; the one-second interval itself is only shortened by this file's fixture)
    monkeypatch.setattr(ar, "STREAM_MAX_POLLS", 4)
    bid, made = project
    aid = article(bid, made, status="generating", progress="Writing")
    resp, db = new_stream(bid, aid)
    try:
        t0 = time.monotonic()
        ev = events(asyncio.run(collect(resp)))
        took = time.monotonic() - t0
    finally:
        db.close()
    assert [e["type"] for e in ev] == ["progress"] and 4 * POLL <= took < 4 * POLL + 2  # no done event: the time ran out


# ── ownership ─────────────────────────────────────────────────────────────────
def test_only_the_projects_owner_can_stream_its_article(client):
    from app.routers import auth as auth_router
    auth_router._failures.clear()
    _user("stream-a@x.in")
    _user("stream-b@x.in")
    a, b = _login("stream-a@x.in"), _login("stream-b@x.in")
    mine = a.post("/api/v1/businesses", json={"name": "Stream A"}).json()["id"]
    theirs = b.post("/api/v1/businesses", json={"name": "Stream B"}).json()["id"]
    made: list[int] = []
    try:
        aid = article(mine, made, status="completed", body="<p>x</p>")
        assert a.get(f"/api/v1/businesses/{mine}/articles/{aid}/stream").status_code == 200
        assert b.get(f"/api/v1/businesses/{mine}/articles/{aid}/stream").status_code == 404  # another user's project
        assert b.get(f"/api/v1/businesses/{theirs}/articles/{aid}/stream").status_code == 404  # an article of another project, under one's own project
        assert a.get(f"/api/v1/businesses/{mine}/articles/987654/stream").status_code == 404
        assert TestClient(app).get(f"/api/v1/businesses/{mine}/articles/{aid}/stream").status_code == 401  # not signed in
    finally:
        db = SessionLocal()
        for x in made:
            db.query(Article).filter(Article.id == x).delete()
        db.commit()
        db.close()
        _forget(["stream-a@x.in", "stream-b@x.in"], [mine, theirs])
        auth_router._failures.clear()


# ── connections ───────────────────────────────────────────────────────────────
def test_the_requests_connection_is_released_before_the_stream_starts(project):
    bid, made = project
    aid = article(bid, made, status="generating")
    base = engine.pool.checkedout()
    resp, db = new_stream(bid, aid)
    try:
        assert engine.pool.checkedout() == base  # the ownership check's transaction is over: nothing is held while the stream waits
    finally:
        db.close()


def test_no_connection_is_held_between_two_looks_at_the_article(project):
    bid, made = project
    aid = article(bid, made, status="generating", progress="Writing")
    threading.Timer(0.5, update, args=(aid,), kwargs=dict(status="completed", body="<p>x</p>")).start()
    base = engine.pool.checkedout()
    new, db1 = new_stream(bid, aid)
    with Monitor() as m_new:
        asyncio.run(collect(new))
    db1.close()
    update(aid, status="generating", body=None)
    threading.Timer(0.5, update, args=(aid,), kwargs=dict(status="completed", body="<p>x</p>")).start()
    a, db2 = old_stream(bid, aid)
    with Monitor() as m_old:
        asyncio.run(collect(_Wrap(old_gen(db2, a, 20))))
    db2.close()
    print(f"\nCONNECTIONS in use during one stream: before min={min(m_old.samples)} mean={m_old.mean:.2f} | after min={min(m_new.samples)} mean={m_new.mean:.2f}")
    assert min(m_old.samples) == base + 1  # before: one connection for the whole stream, every moment
    assert min(m_new.samples) == base and max(m_new.samples) <= base + 2  # after: none between looks; one during a look (two if this test's own writer saves at the same moment)
    assert m_new.mean < m_old.mean / 2


def test_many_streams_at_once_do_not_hold_connections(project):
    bid, made = project
    n = 8
    ids = [article(bid, made, status="generating", progress="Writing") for _ in range(n)]
    base = engine.pool.checkedout()

    def finish_all():  # one writer for all of them, so the measurement shows the streams and not the writers
        db = SessionLocal()
        for i in ids:
            a = db.get(Article, i)
            a.status, a.body = "completed", "<p>x</p>"
        db.commit()
        db.close()

    async def run_new():
        streams = [new_stream(bid, i) for i in ids]
        try:
            await asyncio.gather(*[collect(r) for r, _ in streams])
        finally:
            for _, d in streams:
                d.close()

    async def run_old():
        opened = [old_stream(bid, i) for i in ids]
        try:
            await asyncio.gather(*[collect(_Wrap(old_gen(d, a, 30))) for a, d in opened])
        finally:
            for _, d in opened:
                d.close()

    def middle(m):  # leave out the start (streams still opening) and the end (streams closing)
        k = len(m.samples) // 5
        return m.samples[k:-k]
    threading.Timer(0.8, finish_all).start()
    with Monitor() as m_new:
        asyncio.run(run_new())
    for i in ids:
        update(i, status="generating", body=None)
    threading.Timer(0.8, finish_all).start()
    with Monitor() as m_old:
        asyncio.run(run_old())
    old, new = middle(m_old), middle(m_new)
    print(f"\nCONNECTIONS with {n} streams at once (while they wait): before min={min(old)} mean={sum(old) / len(old):.2f} max={max(old)} | after min={min(new)} mean={sum(new) / len(new):.2f} max={max(new)}")
    assert min(old) >= base + n  # before: every stream pinned a connection for its whole life
    assert min(new) == base and sum(new) / len(new) < n / 3  # after: they are back in the pool between looks
    assert engine.pool.checkedout() == base


# ── queries ───────────────────────────────────────────────────────────────────
def test_query_counts_and_bytes_before_and_after(project):
    bid, made = project
    big = "<p>" + "x" * 100_000 + "</p>"
    aid = article(bid, made, status="generating", progress="Writing", body=big)
    polls = 12
    threading.Timer(polls * POLL * 0.8, update, args=(aid,), kwargs=dict(status="completed")).start()
    seen: list[str] = []
    listener = lambda conn, cur, stmt, *a: seen.append(stmt)  # noqa: E731
    sent = {"new": 0}
    real = ar._stream_row

    def counting(*args):
        row = real(*args)
        if row is not None:
            sent["new"] += len(row.body or "")
        return row
    ar._stream_row = counting
    event.listen(engine, "before_cursor_execute", listener)
    try:
        new, db1 = new_stream(bid, aid)
        asyncio.run(collect(new))
        db1.close()
    finally:
        ar._stream_row = real
        event.remove(engine, "before_cursor_execute", listener)
    new_statements = [s for s in seen if "FROM articles" in s]
    update(aid, status="generating")
    threading.Timer(polls * POLL * 0.8, update, args=(aid,), kwargs=dict(status="completed")).start()
    seen.clear()
    stats = {"body_bytes": 0}
    a, db2 = old_stream(bid, aid)
    event.listen(engine, "before_cursor_execute", listener)
    try:
        asyncio.run(collect(_Wrap(old_gen(db2, a, 30, stats))))
    finally:
        event.remove(engine, "before_cursor_execute", listener)
        db2.close()
    old_statements = [s for s in seen if "FROM articles" in s]
    print(f"\nQUERIES on articles: before={len(old_statements)} after={len(new_statements)} | body bytes read: before={stats['body_bytes']} after={sent['new']}")
    # one look = one statement, as before (the ownership check is one more in both); only how much each look reads differs
    assert abs(len(new_statements) - len(old_statements)) <= 3
    assert sent["new"] <= 3 * len(big) < stats["body_bytes"] / 2  # the body is read when it first appears and once more when the article is finished, not every second


def test_the_body_is_read_again_only_when_it_has_grown(project):
    bid, made = project
    aid = article(bid, made, status="generating", body="<p>abc</p>")
    seen: list[bool] = []
    real = ar._stream_row

    def spying(business_id, article_id, seen_len):
        row = real(business_id, article_id, seen_len)
        seen.append(row.body is not None)
        return row
    ar._stream_row = spying
    try:
        threading.Timer(0.5, update, args=(aid,), kwargs=dict(status="completed")).start()
        new, db = new_stream(bid, aid)
        asyncio.run(collect(new))
        db.close()
    finally:
        ar._stream_row = real
    assert seen[0] is True and seen[-1] is True  # the first look (new text) and the last (finished)
    assert not any(seen[1:-1])  # in between nothing grew: only a few bytes were read each time


# ── cancel, disconnect, deletion, hiccups ─────────────────────────────────────
def test_a_cancelled_stream_leaves_no_connection_behind(project):
    bid, made = project
    aid = article(bid, made, status="generating", progress="Writing", body="<p>start</p>")
    base = engine.pool.checkedout()

    async def go():
        resp, db = new_stream(bid, aid)
        got = []

        async def consume():
            async for c in resp.body_iterator:
                got.append(c)
        task = asyncio.ensure_future(consume())
        await asyncio.sleep(POLL * 6)
        task.cancel()  # the client went away: the server cancels the response
        with pytest.raises(asyncio.CancelledError):
            await task
        db.close()
        return got
    got = asyncio.run(go())
    assert len(got) >= 1 and engine.pool.checkedout() == base


def test_closing_the_stream_early_leaves_no_connection_behind(project):
    bid, made = project
    aid = article(bid, made, status="generating", progress="Writing")
    base = engine.pool.checkedout()

    async def go():
        resp, db = new_stream(bid, aid)
        it = resp.body_iterator
        first = await it.__anext__()
        await it.aclose()
        db.close()
        return first
    assert events([asyncio.run(go())])[0]["type"] == "progress" and engine.pool.checkedout() == base


def test_an_article_deleted_while_streaming_ends_the_stream_quietly(project):
    bid, made = project
    aid = article(bid, made, status="generating", progress="Writing")

    def remove():
        db = SessionLocal()
        db.query(Article).filter(Article.id == aid).delete()
        db.commit()
        db.close()
    threading.Timer(0.2, remove).start()
    new, db = new_stream(bid, aid)
    try:
        ev = events(asyncio.run(collect(new)))
    finally:
        db.close()
    assert [e["type"] for e in ev] == ["progress"]  # as before: it ends, with no done event


def test_one_failed_look_is_tried_again_and_five_in_a_row_end_the_stream(project, monkeypatch):
    bid, made = project
    aid = article(bid, made, status="completed", progress="Done", body="<p>ok</p>")
    real = ar._stream_row
    calls = {"n": 0}

    def hiccup(*a):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("the database was busy")
        return real(*a)
    monkeypatch.setattr(ar, "_stream_row", hiccup)
    new, db = new_stream(bid, aid)
    try:
        assert events(asyncio.run(collect(new)))[-1]["type"] == "done"  # the next look worked
    finally:
        db.close()
    monkeypatch.setattr(ar, "_stream_row", lambda *a: (_ for _ in ()).throw(RuntimeError("down")))
    new, db = new_stream(bid, aid)
    try:
        assert asyncio.run(collect(new)) == []  # five failures in a row: the stream ends, without a done event
    finally:
        db.close()


def test_the_time_to_the_done_event_is_the_same_as_before(project):
    bid, made = project
    aid = article(bid, made, status="generating", progress="Writing")
    out = {}
    for name in ("new", "old"):
        update(aid, status="generating")
        flipped = {}

        def flip():
            flipped["t"] = time.monotonic()
            update(aid, status="completed", body="<p>x</p>")
        threading.Timer(0.3, flip).start()
        done = {}

        async def watch(gen):
            async for c in gen:
                if json.loads(c[len("data: "):])["type"] == "done":
                    done["t"] = time.monotonic()
        if name == "new":
            resp, db = new_stream(bid, aid)
            asyncio.run(watch(resp.body_iterator))
        else:
            a, db = old_stream(bid, aid)
            asyncio.run(watch(old_gen(db, a, 40)))
        db.close()
        out[name] = done["t"] - flipped["t"]
    print(f"\nLATENCY from the article finishing to the done event: before={out['old'] * 1000:.0f} ms, after={out['new'] * 1000:.0f} ms (poll every {POLL * 1000:.0f} ms)")
    assert out["new"] <= POLL + 0.3 and out["old"] <= POLL + 0.3
