"""Background work (the scheduler's jobs, scheduled publishing, GEO prompts, rank grid scans) must not hold a database connection while it waits on an outside service, and each
scheduled job runs in a session of its own."""
from datetime import datetime, timedelta, timezone

import time

import pytest

from app.db import SessionLocal, engine
from app.errors import DataUnavailable
from app.models import Article, Business, GeoResult, RankScan, Schedule, ScheduledPost
from app.services import geo, schedules


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
def project(client):
    bid = client.post("/api/v1/businesses", json={"name": "Background Co", "website": "https://background.example", "city": "Pune", "primary_category": "Dentist"}).json()["id"]
    yield bid
    db = SessionLocal()
    for model in (Schedule, ScheduledPost, GeoResult, RankScan, Article):
        db.query(model).filter(model.business_id == bid).delete()
    db.query(Business).filter(Business.id == bid).delete()
    db.commit()
    db.close()


def due(bid, job, minutes_ago=5):
    db = SessionLocal()
    s = Schedule(business_id=bid, job=job, every="weekly", next_run_at=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago))
    db.add(s)
    db.commit()
    sid = s.id
    db.close()
    return sid


def status_of(sid):
    db = SessionLocal()
    s = db.get(Schedule, sid)
    out = (s.last_status, s.last_error, s.last_run_at is not None, s.next_run_at > datetime.now(timezone.utc).replace(tzinfo=None) if s.next_run_at.tzinfo is None else s.next_run_at > datetime.now(timezone.utc))
    db.close()
    return out


# ── the scheduler ─────────────────────────────────────────────────────────────
def test_a_scheduled_job_runs_with_no_connection_held_and_its_result_is_saved(project, seen, monkeypatch):
    sid = due(project, "geo")
    monkeypatch.setattr(geo, "run_prompts", seen.record({"engines": []}))
    db = SessionLocal()
    try:
        assert schedules.run_due(db) >= 1
    finally:
        db.close()
    assert seen.counts and max(seen.counts) == 0  # the job's slow work started with no connection in use
    assert status_of(sid) == ("ok", None, True, True)  # saved, and the next run is planned


def test_each_job_has_its_own_session_so_one_failure_does_not_touch_the_others(project, monkeypatch):
    ids = [due(project, "geo", 30), due(project, "technical", 20), due(project, "report", 10)]
    calls = []

    def run_job(db, s):
        calls.append(s.job)
        if s.job == "technical":
            raise RuntimeError("the audit crashed")
        if s.job == "report":
            raise DataUnavailable("SMTP is not set up")
    monkeypatch.setattr(schedules, "run_job", run_job)
    db = SessionLocal()
    try:
        assert schedules.run_due(db, limit=50) >= 3
    finally:
        db.close()
    assert calls[-3:] == ["geo", "technical", "report"]  # oldest first, as before
    assert status_of(ids[0])[:2] == ("ok", None)
    assert status_of(ids[1]) == ("failed", "the audit crashed", True, True)
    assert status_of(ids[2]) == ("skipped", "SMTP is not set up", True, True)  # a missing key skips the job, as before


def test_the_time_budget_still_stops_new_jobs_from_starting(project, monkeypatch):
    a, b = due(project, "geo", 30), due(project, "technical", 20)
    monkeypatch.setattr(schedules, "run_job", lambda db, s: None)
    db = SessionLocal()
    try:
        ran = schedules.run_due(db, limit=50, budget_seconds=-1)  # already spent: only the first job runs
    finally:
        db.close()
    assert ran >= 1 and status_of(a)[0] == "ok"
    still_due = SessionLocal()
    assert still_due.get(Schedule, b).last_status is None  # not started: it stays due for the next tick
    still_due.close()


def test_the_callers_session_sees_what_the_jobs_saved(project, monkeypatch):
    sid = due(project, "geo")
    monkeypatch.setattr(schedules, "run_job", lambda db, s: None)
    db = SessionLocal()
    try:
        before = db.get(Schedule, sid)
        assert before.last_status is None
        schedules.run_due(db)
        assert db.get(Schedule, sid).last_status == "ok"  # read again, not the value loaded before
    finally:
        db.close()


# ── GEO prompts and rank grids ────────────────────────────────────────────────
def test_geo_prompts_hold_no_connection_while_the_ai_engines_answer_and_the_results_are_saved(project, seen, monkeypatch):
    monkeypatch.setattr(geo, "require_engines", lambda: {"chatgpt": ("x",), "gemini": ("y",)})
    monkeypatch.setattr(geo, "_ask", seen.record("Background Co is a good dentist in Pune."))
    db = SessionLocal()
    try:
        out = geo.run_prompts(db, db.get(Business, project))
        assert out is not None
    finally:
        db.close()
    assert seen.counts and max(seen.counts) == 0
    db = SessionLocal()
    saved = db.query(GeoResult).filter(GeoResult.business_id == project).count()
    db.close()
    assert saved == len(seen.counts) and saved >= 2  # one result per prompt and engine, saved at the end as before


def test_a_rank_grid_scan_holds_no_connection_while_google_is_searched_and_saves_the_scan(project, seen, monkeypatch):
    from app.routers import growth
    from app.services import providers

    class Fake:
        source = "test"

        def scan_grid(self, b, keyword, size, radius):
            seen.counts.append(engine.pool.checkedout())
            return {"grid_size": size, "points": [{"rank": 2}, {"rank": None}, {"rank": 5}], "competitors": []}
    monkeypatch.setattr(providers, "rank_provider", lambda: Fake())
    db = SessionLocal()
    try:
        growth._scan(db, project, "dentist pune", 3, 2.0)
    finally:
        db.close()
    assert seen.counts == [0]
    db = SessionLocal()
    scan = db.query(RankScan).filter(RankScan.business_id == project).one()
    db.close()
    assert scan.keyword == "dentist pune" and scan.found == 2 and scan.top3 == 1 and scan.avg_rank == 3.5


# ── scheduled publishing ──────────────────────────────────────────────────────
def test_scheduled_html_publishing_holds_no_connection_while_the_site_is_published(project, seen, monkeypatch):
    from app.services import article_publishing as ap, article_schedule as asch, blog_flow, html_publisher as hp
    db = SessionLocal()
    a = Article(business_id=project, keyword="k", status="completed", body="<p>x</p>")
    db.add(a)
    db.commit()
    post = ScheduledPost(business_id=project, article_id=a.id, method=ap.HTML, due_at=datetime.now(timezone.utc) - timedelta(minutes=1), status="pending")
    db.add(post)
    db.commit()
    monkeypatch.setattr(ap, "html_target", lambda db_, b: True)
    monkeypatch.setattr(hp, "publish_sync", seen.record({"id": "k", "url": "https://background.example/k", "status": "publish", "steps": []}))
    monkeypatch.setattr(blog_flow, "after_published", lambda *a, **k: None)
    try:
        assert asch._run_one(db, post, datetime.now(timezone.utc)) == 1
    finally:
        db.close()
    assert seen.counts == [0]
    db = SessionLocal()
    got = db.query(ScheduledPost).filter(ScheduledPost.business_id == project).one()
    db.close()
    assert got.status == "published" and got.result["url"] == "https://background.example/k"
