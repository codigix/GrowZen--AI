"""Draft -> Scheduled -> Publishing -> Published / Failed for articles scheduled inside GrowZen (no network: the
React.js website and GitHub are simulated). Proves: a draft is never sent, the schedule is validated and stored once,
the calendar shows it, nothing is published early, the scheduler publishes it at the time exactly once, a failure is
kept with its error and Retry publishes it (updating the same post, no duplicate)."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import ActivityLog, Article, ReactSiteConnection, ScheduledPost, SiteIntegration
from app.services import article_schedule as asch, crypto, react_site as rs, site_publish as sp

HTML = "<h2>Why it works</h2><p>Teeth whitening is safe when a dentist does it.</p>"
IST = timezone(timedelta(hours=5, minutes=30))


@pytest.fixture()
def db():
    s = SessionLocal()
    for m in (ScheduledPost, ReactSiteConnection, SiteIntegration, Article):
        s.query(m).delete()
    s.commit()
    yield s
    s.rollback()
    for m in (ScheduledPost, ReactSiteConnection, SiteIntegration, Article):
        s.query(m).delete()
    s.commit()
    s.close()


class FakeReactSite:
    """Records every publish; the first `fail` calls fail. A post id, once created, is reused (as the real site does)."""

    def __init__(self, fail=0, auth=False):
        self.calls, self.fail, self.auth = [], fail, auth

    def __call__(self, conn, a, mode, when):
        self.calls.append((a.id, mode, a.react_post_id))
        if self.fail:
            self.fail -= 1
            raise (rs.AuthFailed if self.auth else rs.ReactSiteError)("The website refused the post (500): database is down")
        pid = a.react_post_id or str(40 + len(self.calls))
        return {"id": pid, "url": f"https://acme.com/blog/{a.id}", "status": "publish", "image_url": None, "steps": [{"step": "Send", "ok": True, "detail": "ok"}]}


def _setup(client, db, monkeypatch, fake):
    bid = client.post("/api/v1/businesses", json={"name": "Acme Dental", "website": "https://acme.com", "primary_category": "Dentist"}).json()["id"]
    db.add(ReactSiteConnection(business_id=bid, website_url="https://acme.com", api_base_url="https://acme.com", publish_endpoint="/api/blogs",
                               auth_endpoint="/api/login", auth_scheme="login", login_username="bot@acme.com", password_enc=crypto.seal("pw"), status="connected"))
    a = Article(business_id=bid, keyword="teeth whitening pune", title="Teeth whitening in Pune", body=HTML, meta_description="A short guide.", status="completed")
    db.add(a)
    db.commit()
    monkeypatch.setattr(rs, "publish", fake)
    return bid, a, f"/api/v1/businesses/{bid}/articles"


def _ist(dt: datetime) -> tuple[str, str]:
    local = dt.astimezone(IST)
    return local.strftime("%Y-%m-%d"), local.strftime("%H:%M")


def _listed(client, base, aid):
    return next(x for x in client.get(base).json()["articles"] if x["id"] == aid)


def test_a_completed_article_is_a_draft_and_is_never_sent_until_scheduled(client, db, monkeypatch):
    fake = FakeReactSite()
    bid, a, base = _setup(client, db, monkeypatch, fake)
    x = _listed(client, base, a.id)
    assert x["publishing_status"] == "draft" and x["schedule"] is None and x["created_at"]
    assert sp.run_due_scheduled(db, datetime.now(timezone.utc) + timedelta(days=365)) == 0 and not fake.calls  # drafts are never auto-published
    dest = client.get(f"{base}/destinations").json()
    assert dest["timezone"] == "Asia/Kolkata" and [d["id"] for d in dest["destinations"]] == ["react"]


def test_schedule_validates_stores_one_row_shows_on_the_calendar_and_publishes_once_at_the_time(client, db, monkeypatch):
    fake = FakeReactSite()
    bid, a, base = _setup(client, db, monkeypatch, fake)
    past_d, past_t = _ist(datetime.now(timezone.utc) - timedelta(minutes=5))
    assert client.put(f"{base}/{a.id}/schedule", json={"date": past_d, "time": past_t, "destination": "react"}).status_code == 422
    assert client.put(f"{base}/{a.id}/schedule", json={"date": "2030-01-01", "time": "10:00", "destination": "wordpress"}).status_code == 409  # not connected

    when = (datetime.now(timezone.utc) + timedelta(hours=2)).replace(second=0, microsecond=0)
    d, t = _ist(when)
    r = client.put(f"{base}/{a.id}/schedule", json={"date": d, "time": t, "destination": "react"})
    assert r.status_code == 200, r.text
    s = r.json()["article"]
    assert s["publishing_status"] == "scheduled" and s["schedule"]["date"] == d and s["schedule"]["time"] == t
    assert datetime.fromisoformat(s["schedule"]["due_at"]) == when  # entered in IST, stored in UTC
    # rescheduling moves the same row: never a second schedule (or article)
    later = when + timedelta(hours=1)
    client.put(f"{base}/{a.id}/schedule", json={"date": _ist(later)[0], "time": _ist(later)[1], "destination": "react"})
    rows = list(db.scalars(select(ScheduledPost).where(ScheduledPost.article_id == a.id)))
    assert len(rows) == 1 and rows[0].status == "pending" and asch._utc(rows[0].due_at) == later
    assert db.query(Article).filter(Article.business_id == bid).count() == 1

    cal = client.get(f"{base}/calendar", params={"month": _ist(later)[0][:7]}).json()
    assert [(e["article_id"], e["publishing_status"], e["title"]) for e in cal["entries"]] == [(a.id, "scheduled", "Teeth whitening in Pune")]

    assert sp.run_due_scheduled(db, later - timedelta(minutes=1)) == 0 and not fake.calls  # not before its time
    assert sp.run_due_scheduled(db, later + timedelta(seconds=30)) == 1 and fake.calls == [(a.id, "publish", None)]
    db.refresh(a)
    x = _listed(client, base, a.id)
    assert x["publishing_status"] == "published" and a.react_post_id == "41" and a.react_url == "https://acme.com/blog/" + str(a.id)
    assert x["schedule"]["url"] == a.react_url and x["schedule"]["post_id"] == "41" and x["schedule"]["finished_at"]
    assert sp.run_due_scheduled(db, later + timedelta(days=1)) == 0 and len(fake.calls) == 1  # never published twice
    assert db.scalar(select(ActivityLog).where(ActivityLog.action == "post_published", ActivityLog.business_id == bid))


def test_two_runners_cannot_publish_the_same_row(client, db, monkeypatch):
    fake = FakeReactSite()
    bid, a, base = _setup(client, db, monkeypatch, fake)
    p = ScheduledPost(business_id=bid, article_id=a.id, method="react", due_at=datetime.now(timezone.utc) - timedelta(minutes=1))
    db.add(p)
    db.commit()
    assert asch._claim(db, p.id) is True
    assert asch._claim(db, p.id) is False  # the second runner loses the claim
    assert sp.run_due_scheduled(db) == 0 and not fake.calls  # a claimed row is not picked up again


def test_cancel_returns_the_article_to_draft(client, db, monkeypatch):
    bid, a, base = _setup(client, db, monkeypatch, FakeReactSite())
    d, t = _ist(datetime.now(timezone.utc) + timedelta(days=1))
    client.put(f"{base}/{a.id}/schedule", json={"date": d, "time": t, "destination": "react"})
    r = client.delete(f"{base}/{a.id}/schedule").json()["article"]
    assert r["publishing_status"] == "draft" and r["schedule"] is None
    assert client.delete(f"{base}/{a.id}/schedule").status_code == 409  # nothing left to cancel
    assert client.get(f"{base}/calendar", params={"month": d[:7]}).json()["entries"] == []


def test_a_failure_is_retried_then_marked_failed_and_retry_publishes_the_same_post(client, db, monkeypatch):
    fake = FakeReactSite(fail=3)
    bid, a, base = _setup(client, db, monkeypatch, fake)
    when = datetime.now(timezone.utc) + timedelta(hours=1)
    d, t = _ist(when)
    client.put(f"{base}/{a.id}/schedule", json={"date": d, "time": t, "destination": "react"})
    now = when + timedelta(minutes=1)
    assert sp.run_due_scheduled(db, now) == 0
    x = _listed(client, base, a.id)
    assert x["publishing_status"] == "scheduled" and x["schedule"]["attempts"] == 1 and "database is down" in x["schedule"]["error"]  # retried in 10 min
    for i in (1, 2):
        sp.run_due_scheduled(db, now + timedelta(minutes=11 * i))
    x = _listed(client, base, a.id)
    assert x["publishing_status"] == "failed" and x["schedule"]["attempts"] == 3 and len(fake.calls) == 3
    r = client.post(f"{base}/{a.id}/schedule/retry").json()
    assert r["article"]["publishing_status"] == "published" and len(fake.calls) == 4
    db.refresh(a)
    pid = a.react_post_id
    # publishing again (reschedule after published) updates that post: the site receives its id, nothing new is created
    d2, t2 = _ist(datetime.now(timezone.utc) + timedelta(hours=3))
    client.put(f"{base}/{a.id}/schedule", json={"date": d2, "time": t2, "destination": "react"})
    sp.run_due_scheduled(db, datetime.now(timezone.utc) + timedelta(hours=4))
    assert fake.calls[-1] == (a.id, "publish", pid)


def test_a_refused_login_fails_at_once_and_a_disconnected_site_is_not_retried(client, db, monkeypatch):
    fake = FakeReactSite(fail=1, auth=True)
    bid, a, base = _setup(client, db, monkeypatch, fake)
    p = ScheduledPost(business_id=bid, article_id=a.id, method="react", due_at=datetime.now(timezone.utc) - timedelta(minutes=1))
    db.add(p)
    db.commit()
    sp.run_due_scheduled(db)
    db.refresh(p)
    assert p.status == "failed" and p.attempts == 1
    conn = db.scalar(select(ReactSiteConnection).where(ReactSiteConnection.business_id == bid))
    assert conn.status == "failed"  # shown as Authentication Failed on the connection
    p.status, p.attempts, p.due_at = "pending", 0, datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()
    sp.run_due_scheduled(db)  # the connection is no longer "connected": failed with a clear reason, not retried
    db.refresh(p)
    assert p.status == "failed" and "no longer connected" in p.error and len(fake.calls) == 1


def test_a_direct_publish_shows_on_the_calendar_once(client, db, monkeypatch):
    fake = FakeReactSite()
    bid, a, base = _setup(client, db, monkeypatch, fake)
    assert client.post(f"{base}/{a.id}/publish-react", json={"mode": "publish"}).status_code == 200
    assert client.post(f"{base}/{a.id}/publish-react", json={"mode": "publish"}).status_code == 200  # "Update and publish"
    rows = list(db.scalars(select(ScheduledPost).where(ScheduledPost.article_id == a.id)))
    assert len(rows) == 1 and rows[0].status == "published" and rows[0].result["direct"] is True  # one entry, moved to the last publish
    month = datetime.now(timezone.utc).astimezone(IST).strftime("%Y-%m")
    e = client.get(f"{base}/calendar", params={"month": month}).json()["entries"]
    assert [(x["article_id"], x["publishing_status"], x["direct"]) for x in e] == [(a.id, "published", True)]
    client.post(f"{base}/{a.id}/publish-react", json={"mode": "draft"})  # a website draft is not a publication
    assert db.query(ScheduledPost).filter(ScheduledPost.article_id == a.id).count() == 1
    # a scheduled publish keeps its own entry; the scheduler does not add a second one
    d, t = _ist(datetime.now(timezone.utc) + timedelta(hours=1))
    client.put(f"{base}/{a.id}/schedule", json={"date": d, "time": t, "destination": "react"})
    sp.run_due_scheduled(db, datetime.now(timezone.utc) + timedelta(hours=2))
    db.expire_all()
    kinds = sorted(bool((p.result or {}).get("direct")) for p in db.scalars(select(ScheduledPost).where(ScheduledPost.article_id == a.id)))
    assert kinds == [False, True]


def test_a_row_left_publishing_by_a_crash_becomes_failed_not_republished(client, db, monkeypatch):
    fake = FakeReactSite()
    bid, a, base = _setup(client, db, monkeypatch, fake)
    p = ScheduledPost(business_id=bid, article_id=a.id, method="react", due_at=datetime.now(timezone.utc) - timedelta(hours=1), status="publishing")
    db.add(p)
    db.commit()
    sp.run_due_scheduled(db, datetime.now(timezone.utc) + timedelta(minutes=20))
    db.refresh(p)
    assert p.status == "failed" and "interrupted" in p.error and not fake.calls
    assert _listed(client, base, a.id)["publishing_status"] == "failed"


def test_react_site_without_scheduling_is_held_by_growzen_and_published_at_the_time(client, db, monkeypatch):
    calls = []

    def fake(conn, a, mode, when):
        calls.append(mode)
        if mode == "schedule":
            raise rs.ScheduleHeldByGrowZen("This website has no scheduled posts of its own.")
        return {"id": "9", "url": "https://acme.com/blog/9", "status": "publish", "image_url": None, "steps": []}

    bid, a, base = _setup(client, db, monkeypatch, fake)
    when = datetime.now(timezone.utc) + timedelta(days=1)
    r = client.post(f"{base}/{a.id}/publish-react", json={"mode": "schedule", "scheduled_at": when.isoformat()})
    assert r.status_code == 200 and r.json()["held"] is True and calls == ["schedule"]
    p = db.query(ScheduledPost).filter_by(article_id=a.id).one()
    assert p.status == "pending" and p.method == "react"
    assert sp.run_due_scheduled(db, when + timedelta(minutes=1)) == 1
    assert calls == ["schedule", "publish"] and db.query(ScheduledPost).filter_by(article_id=a.id).one().status == "published"
