"""The last batch of Phase 3 changes: more endpoints and jobs that hold no database connection while they wait, a cap on background jobs, per-item saving of scheduled Google posts,
and lighter article list reads."""
import threading
import time
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event

from app.db import SessionLocal, engine
from app.models import AgentTask, Article, Business, Keyword, Review, ScheduledPost
from app.services import ai, durable, keyword_metrics


def settle(seconds: float = 5.0) -> None:
    """Wait for connections that an earlier test's background thread may still hold, so a count taken during a test starts from an idle pool."""
    deadline = time.monotonic() + seconds
    while engine.pool.checkedout() and time.monotonic() < deadline:
        time.sleep(0.05)


class Seen:
    def __init__(self):
        self.counts: list[int] = []

    def record(self, value=None):
        def inner(*a, **k):
            self.counts.append(engine.pool.checkedout())
            return value() if callable(value) else value
        return inner


@pytest.fixture()
def seen():
    settle()
    return Seen()


@pytest.fixture()
def bid(client):
    b = client.post("/api/v1/businesses", json={"name": "Final Co", "website": "https://final.example", "city": "Pune", "primary_category": "Dentist"}).json()["id"]
    yield b
    db = SessionLocal()
    for model in (Keyword, Article, Review, ScheduledPost, AgentTask):
        db.query(model).filter(model.business_id == b).delete()
    db.query(Business).filter(Business.id == b).delete()
    db.commit()
    db.close()


def held(seen):
    assert seen.counts, "the outside call was never reached: the test proves nothing"
    if max(seen.counts):
        print("DIAG pool:", engine.pool.status(), "| threads:", sorted(t.name for t in threading.enumerate() if not t.name.startswith(("MainThread", "pytest", "anyio"))))
    return max(seen.counts)


# ── AI and Google endpoints ───────────────────────────────────────────────────
def test_profile_ai_endpoints_hold_no_connection_while_the_ai_writes(client, bid, seen, monkeypatch):
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete_json", seen.record({"title": "T", "body": "B", "hashtags": ["#a"], "faqs": [{"q": "Q?", "a": "A."}]}))
    monkeypatch.setattr(ai, "complete", seen.record("A short text."))
    base = f"/api/v1/businesses/{bid}"
    assert client.post(f"{base}/posts/compose", json={"topic": "x"}).status_code == 200
    assert client.post(f"{base}/ai/description").status_code == 200
    assert client.post(f"{base}/ai/faqs").status_code == 200
    db = SessionLocal()
    r = Review(business_id=bid, rating=5, body="Great", reply_status="none")
    db.add(r)
    db.commit()
    rid = r.id
    db.close()
    r2 = client.post(f"{base}/reviews/{rid}/draft", json={})
    assert r2.status_code == 200 and r2.json()["reply_text"] == "A short text." and r2.json()["reply_status"] == "draft"  # still saved
    assert len(seen.counts) == 4 and held(seen) == 0


def test_the_tools_hold_no_connection_while_google_ads_and_the_ai_answer(client, bid, seen, monkeypatch):
    from app.routers import tools
    from app.services import google_ads_client as ads
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(keyword_metrics, "enabled", lambda: True)
    monkeypatch.setattr(ads, "geo_target_for", lambda country: "geo")
    monkeypatch.setattr(tools, "_google", lambda b, q: (seen.counts.append(engine.pool.checkedout()), {})[1])
    monkeypatch.setattr(ai, "complete_json", seen.record({"posts": [], "ad_groups": [], "headlines": [], "descriptions": []}))
    base = f"/api/v1/businesses/{bid}/tools"
    client.post(f"/api/v1/businesses/{bid}/keywords", json=[{"keyword": "dentist in pune"}])
    for path, body in (("seo-brief", {"keyword": "dentist pune"}), ("social-posts", {"topic": "teeth whitening offer"}), ("ads-plan", {"goal": "calls"}), ("questions", {})):
        n = len(seen.counts)
        r = client.post(f"{base}/{path}", json=body)
        assert r.status_code in (200, 502), (path, r.text)
        assert len(seen.counts) > n, path
    assert held(seen) == 0


def test_keyword_grouping_and_suggestions_hold_no_connection_while_the_ai_answers(client, bid, seen, monkeypatch):
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    base = f"/api/v1/businesses/{bid}"
    client.post(f"{base}/keywords", json=[{"keyword": "dentist in pune"}, {"keyword": "root canal pune"}])
    db = SessionLocal()
    ids = [k.id for k in db.query(Keyword).filter(Keyword.business_id == bid)]
    db.close()
    monkeypatch.setattr(ai, "complete_json", seen.record({"items": [{"id": i, "cluster": "Dental care"} for i in ids]}))
    r = client.post(f"{base}/keywords/cluster")
    assert r.status_code == 200 and r.json()["updated"] == 2 and held(seen) == 0  # and the groups were saved
    db = SessionLocal()
    assert {k.cluster for k in db.query(Keyword).filter(Keyword.business_id == bid)} == {"Dental care"}
    db.close()
    seen.counts.clear()
    monkeypatch.setattr(ai, "complete_json", seen.record({"items": []}))
    assert client.post(f"{base}/keywords/ai-suggestions", json={}).status_code == 200 and held(seen) == 0


def test_rank_checks_ask_google_maps_with_no_connection_held_and_still_save_the_positions(client, bid, seen, monkeypatch):
    from app.services import google_rank, organic
    client.post(f"/api/v1/businesses/{bid}/keywords", json=[{"keyword": "dentist in pune"}, {"keyword": "root canal pune"}])
    monkeypatch.setattr(google_rank, "organic_positions", lambda db, b, kws: {k: {"position": 3.4, "url": "https://final.example/", "pages": [], "clicks": 5, "impressions": 90} for k in kws})
    monkeypatch.setattr(google_rank, "maps_enabled", lambda: True)
    monkeypatch.setattr(google_rank, "maps_results", seen.record([{"title": "Final Co"}, {"title": "Other"}]))
    db = SessionLocal()
    try:
        out = organic.check(db, db.get(Business, bid))
    finally:
        db.close()
    assert out["checked"] == 2 and all(r["rank"] == 3 for r in out["results"]) and all(r["maps_rank"] is not None for r in out["results"])
    assert len(seen.counts) == 2 and held(seen) == 0  # both Maps requests ran with no connection held
    db = SessionLocal()
    assert {(k.rank, k.rank_checked_at is not None) for k in db.query(Keyword).filter(Keyword.business_id == bid)} == {(3, True)}  # saved
    db.close()


def test_the_backlink_comparison_and_overview_hold_no_connection_while_moz_is_waited_for(world, monkeypatch):
    from app.backlinks import overview as bo
    from app.services import gsc_access, url_overview as uo
    counts: list[int] = []

    def authority(site):
        time.sleep(0.4)  # the main thread is waiting for this: it must hold no connection meanwhile
        counts.append(engine.pool.checkedout())
        return {"da": 30, "rd": 10, "spam": 1, "ranking_keywords": 50}
    monkeypatch.setattr(uo, "_public", lambda u: u if "//" in u else "https://" + u)
    monkeypatch.setattr(uo, "authority", authority)
    monkeypatch.setattr(bo, "_visits", lambda d: None)
    monkeypatch.setattr(bo, "_ips", lambda domains: {})
    monkeypatch.setattr(gsc_access, "search_console", lambda db, b, host: ("not_connected", "", None, None))
    db = SessionLocal()
    try:
        b = db.get(Business, world)
        out = bo.compare(db, b, ["rival-clinic.in"])
        assert out["state"] == "ok" and len(out["profiles"]) == 2
        assert counts and max(counts) == 0
        counts.clear()
        assert bo.overview(db, b)["state"] != "no_target" and counts and max(counts) == 0
    finally:
        db.close()


# ── background jobs ───────────────────────────────────────────────────────────
def test_background_jobs_run_a_few_at_a_time_and_all_finish(monkeypatch):
    monkeypatch.setattr(durable, "_slots", threading.BoundedSemaphore(3))
    active, peak, done = [0], [0], []
    lock = threading.Lock()

    def job(i):
        with lock:
            active[0] += 1
            peak[0] = max(peak[0], active[0])
        time.sleep(0.1)
        with lock:
            active[0] -= 1
            done.append(i)
    threads = [durable.spawn(job, i, name=f"t{i}") for i in range(12)]
    assert all(t.daemon for t in threads)  # a restart is never held up by them
    for t in threads:
        t.join(10)
    assert sorted(done) == list(range(12)) and peak[0] <= 3


def test_jobs_started_again_after_a_restart_cannot_take_every_place(monkeypatch):
    monkeypatch.setattr(durable, "_slots", threading.BoundedSemaphore(4))
    monkeypatch.setattr(durable, "_resume_slots", threading.BoundedSemaphore(2))
    active, peak = [0], [0]
    lock = threading.Lock()

    def job():
        with lock:
            active[0] += 1
            peak[0] = max(peak[0], active[0])
        time.sleep(0.1)
        with lock:
            active[0] -= 1
    resumed = [durable.spawn(job, name=f"r{i}", resumed=True) for i in range(8)]
    for t in resumed:
        t.join(10)
    assert peak[0] <= 2  # eight restarted jobs, never more than two at once


def test_scheduled_google_posts_are_saved_one_by_one(client, bid, monkeypatch):
    from app.services import agent, autopilot
    now = datetime.now(timezone.utc)
    db = SessionLocal()
    ids = []
    for i in range(3):
        t = AgentTask(business_id=bid, agent="gbp", kind="gbp_photo", title=f"p{i}", status="scheduled", requires_approval=True,
                      detail={"publish_at": (now - timedelta(minutes=5)).isoformat(), "approved_by": "me", "approved_at": now.isoformat()})
        db.add(t)
        db.flush()
        ids.append(t.id)
    db.commit()
    monkeypatch.setattr(autopilot, "linked", lambda b: True)
    calls = []

    def apply(db_, t, who):
        calls.append(t.id)
        if len(calls) == 2:
            raise RuntimeError("Google did not answer")
        t.status = "applied"
    monkeypatch.setattr(agent, "apply", apply)
    with pytest.raises(RuntimeError):
        autopilot.publish_due(db)
    db.close()
    check = SessionLocal()
    first = check.get(AgentTask, ids[0])
    assert first.status == "applied"  # saved at once: a later failure in the run cannot send it again
    assert check.get(AgentTask, ids[2]).status == "scheduled"  # not reached: it stays due
    check.close()
    assert calls == ids[:2]


# ── articles ──────────────────────────────────────────────────────────────────
def test_the_article_list_does_not_read_the_text_and_the_schedule_read_is_one_row_per_article(client, bid):
    from app.services import article_schedule as asch
    db = SessionLocal()
    a1 = Article(business_id=bid, keyword="k1", status="completed", body="<p>" + "x" * 50_000 + "</p>")
    a2 = Article(business_id=bid, keyword="k2", status="completed", body="<p>short</p>")
    db.add_all([a1, a2])
    db.commit()
    now = datetime.now(timezone.utc)
    for a, n in ((a1, 4), (a2, 1)):  # an article rescheduled and retried several times keeps every row
        for i in range(n):
            db.add(ScheduledPost(business_id=bid, article_id=a.id, method="wordpress", due_at=now + timedelta(days=i), status="failed" if i < n - 1 else "pending", attempts=i))
    db.commit()
    latest = asch.latest_by_article(db, bid)
    assert set(latest) == {a1.id, a2.id}
    assert latest[a1.id].attempts == 3 and latest[a1.id].status == "pending"  # the newest row of each, as before
    assert asch.latest_by_article(db, bid, a1.id).keys() == {a1.id}
    db.close()

    seen: list[str] = []
    listener = lambda conn, cur, stmt, *a: seen.append(stmt)  # noqa: E731
    event.listen(engine, "before_cursor_execute", listener)
    try:
        r = client.get(f"/api/v1/businesses/{bid}/articles")
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    assert r.status_code == 200 and len(r.json()["articles"]) == 2 and all("body" not in x for x in r.json()["articles"])
    reads = [s for s in seen if "FROM articles" in s and "articles.business_id" in s]
    assert reads and not any("articles.body" in s for s in reads)  # the text of every article is no longer read for the list
    sched = [s for s in seen if "FROM scheduled_posts" in s]
    assert len(sched) == 1 and "max(" in sched[0].lower()
    assert {x["publishing_status"] for x in r.json()["articles"]} <= {"draft", "scheduled", "publishing", "published", "failed", None}


# `world` (the stored backlinks of a project) comes from the backlink tests
from test_backlink_hub import world  # noqa: E402,F401
