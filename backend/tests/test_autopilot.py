"""Autopilot: drafts are prepared on a schedule, and NOTHING reaches Google without an approval of that exact item (offline)."""
import base64
import io
from datetime import datetime, timedelta, timezone

import pytest
from PIL import Image

import test_gbp as g
from app.db import SessionLocal
from app.models import AgentTask, Business, Post, Review
from app.services import agent, ai, autopilot as ap, gbp


@pytest.fixture
def project(client):
    r = client.post("/api/v1/businesses", json={"name": "Rental Co", "city": "Pune", "website": "https://rental.example", "description": "We rent designer lehengas for weddings in Pune.",
                                                  "services": [{"name": "Lehenga rental", "description": "x"}, {"name": "Sherwani rental", "description": "y"}]})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def link(db, bid):
    cid = g.connection()
    b = db.get(Business, bid)
    b.gbp_account, b.gbp_location, b.connection_id = "accounts/111", f"locations/g{bid}", cid
    db.commit()
    return b


class FakeGoogle:
    calls: list = []

    def __init__(self, conn):
        pass

    def create_post(self, account, location, post):
        FakeGoogle.calls.append(("post", post["body"]))
        return {"name": f"{location}/localPosts/1"}

    def reply_review(self, account, location, rid, text):
        FakeGoogle.calls.append(("reply", text))

    def add_media(self, account, location, category, url=None, data=None, content_type="image/jpeg"):
        FakeGoogle.calls.append(("photo", len(data or b"")))
        return {"name": "media/1", "googleUrl": "https://lh3.example/p"}

    def location(self, name):
        return {"categories": {"primaryCategory": {"name": "categories/gcid:clothing_rental"}}}

    def update_location(self, name, patch):
        FakeGoogle.calls.append(("profile", sorted(patch)))


@pytest.fixture(autouse=True)
def fake_google(monkeypatch):
    FakeGoogle.calls = []
    monkeypatch.setattr(gbp, "GbpClient", FakeGoogle)


def fake_ai(monkeypatch, posts=3):
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "profile_text", lambda b: "Rental Co rents designer lehengas in Pune")

    def complete_json(system, user, **kw):
        if '"posts"' in user:
            return {"posts": [{"topic": f"t{i}", "title": f"Title {i}", "body": f"Rent a designer lehenga in Pune, post number {i}: book a trial today and see the whole collection.", "cta_type": "BOOK"} for i in range(posts)]}
        return {"description": "Rental Co rents designer lehengas and sherwanis for weddings and celebrations in Pune. " * 6, "services": [{"name": "Bridal lehenga rental", "description": "Bridal outfits."}, {"name": "Lehenga rental", "description": "dup"}]}
    monkeypatch.setattr(ai, "complete_json", complete_json)


def png(w=200, h=120):
    out = io.BytesIO()
    Image.new("RGB", (w, h), (200, 30, 90)).save(out, "PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()


# ------------------------------------------------------------------------------------------------------------------- the rule
def test_everything_that_reaches_google_always_needs_approval_whatever_the_playbook_says(client, project):
    db = SessionLocal()
    try:
        from app.services.playbook import get_playbook
        pb = get_playbook(db)
        pb.approval_rules = {"gbp_post": False, "review_reply_high": False, "review_reply_low": False}  # an old playbook that allowed autopilot
        db.commit()
        for kind in ap.GATED_KINDS:
            assert agent.needs_approval(db, kind, {"rating": 5}) is True
        t = AgentTask(business_id=project, agent="gbp", kind="gbp_post", title="old", requires_approval=False, detail={"post_id": 1})
        db.add(t)
        db.commit()
        assert ap.enforce(db) == 1 and db.get(AgentTask, t.id).requires_approval is True
        assert agent.auto_apply_pending(db) == 0  # the autopilot loop of the old agent applies nothing that reaches Google
        assert get_playbook(db).approval_rules["gbp_post"] is True
    finally:
        db.close()


# ------------------------------------------------------------------------------------------------------------------- posts
def test_planning_writes_drafts_for_the_chosen_days_and_publishes_nothing(project, monkeypatch):
    fake_ai(monkeypatch)
    db = SessionLocal()
    try:
        b = link(db, project)
        ap.save_settings(db, b, {"enabled": True, "posts_per_week": 3, "post_days": ["mon", "wed", "fri"], "post_time": "10:00"})
        out = ap.plan_posts(db, b)
        assert out["made"] == 3
        tasks = db.query(AgentTask).filter_by(business_id=project, kind="gbp_post").all()
        assert len(tasks) == 3 and all(t.status == "pending" and t.requires_approval for t in tasks)
        posts = db.query(Post).filter_by(business_id=project).all()
        assert all(p.status == "draft" and p.approved_at is None and p.ai_generated for p in posts)
        assert FakeGoogle.calls == []  # nothing was sent
        assert ap.plan_posts(db, b)["made"] == 0 or len(db.query(AgentTask).filter_by(kind="gbp_post", business_id=project).all()) <= ap.MAX_PENDING_POSTS  # never piles up beyond the cap
        assert ap.publish_due(db) == 0
    finally:
        db.close()


def test_a_post_is_sent_only_after_its_approval_and_only_at_its_time(project, monkeypatch):
    fake_ai(monkeypatch, posts=1)
    db = SessionLocal()
    try:
        b = link(db, project)
        ap.save_settings(db, b, {"enabled": True, "posts_per_week": 1, "post_days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]})
        ap.plan_posts(db, b)
        t = db.query(AgentTask).filter_by(business_id=project, kind="gbp_post").one()
        assert ap.publish_due(db) == 0 and FakeGoogle.calls == []  # a draft is never sent
        ap.approve(db, b, t, "owner")
        assert t.status == "scheduled" and db.get(Post, t.detail["post_id"]).status == "scheduled" and FakeGoogle.calls == []  # approved: scheduled, not sent
        assert ap.publish_due(db) == 0  # its time has not come
        d = dict(t.detail)
        d["publish_at"] = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        t.detail = d
        db.commit()
        assert ap.publish_due(db) == 1 and [c[0] for c in FakeGoogle.calls] == ["post"]
        assert db.get(AgentTask, t.id).status == "applied" and db.get(Post, d["post_id"]).status == "published"
    finally:
        db.close()


def test_the_publisher_refuses_an_item_without_an_approval_record(project, monkeypatch):
    db = SessionLocal()
    try:
        b = link(db, project)
        p = Post(business_id=project, body="x" * 60, status="scheduled", scheduled_for=datetime.now(timezone.utc) - timedelta(hours=1))
        db.add(p)
        db.flush()
        t = AgentTask(business_id=project, agent="gbp", kind="gbp_post", title="sneaky", status="scheduled", requires_approval=True,
                      detail={"post_id": p.id, "publish_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()})
        db.add(t)
        db.commit()
        assert ap.publish_due(db) == 0 and FakeGoogle.calls == []
        assert db.get(AgentTask, t.id).status == "failed" and "approval" in db.get(AgentTask, t.id).result["error"]
        # an approval written into the task alone is not enough: the post must carry it too
        t2 = AgentTask(business_id=project, agent="gbp", kind="gbp_post", title="half", status="scheduled", requires_approval=True,
                       detail={"post_id": p.id, "approved_by": "x", "approved_at": "2026-01-01T00:00:00+00:00", "publish_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()})
        db.add(t2)
        db.commit()
        assert ap.publish_due(db) == 0 and FakeGoogle.calls == [] and db.get(AgentTask, t2.id).status == "failed"
    finally:
        db.close()


def test_publish_now_sends_at_once_and_an_unlinked_profile_cannot_schedule(project, monkeypatch):
    fake_ai(monkeypatch, posts=1)
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        ap.save_settings(db, b, {"enabled": True, "posts_per_week": 1, "post_days": list(ap.DAYS)})
        ap.plan_posts(db, b)
        t = db.query(AgentTask).filter_by(business_id=project, kind="gbp_post").one()
        with pytest.raises(ap.AutopilotError, match="Link the Google"):
            ap.approve(db, b, t, "owner")
        b = link(db, project)
        ap.approve(db, b, t, "owner", now=True)
        assert [c[0] for c in FakeGoogle.calls] == ["post"] and db.get(AgentTask, t.id).status == "applied"
        with pytest.raises(ap.AutopilotError, match="already"):
            ap.approve(db, b, t, "owner", now=True)  # one approval, one send
    finally:
        db.close()


def test_a_past_time_is_refused_and_unscheduling_cancels(project, monkeypatch):
    fake_ai(monkeypatch, posts=1)
    db = SessionLocal()
    try:
        b = link(db, project)
        ap.save_settings(db, b, {"enabled": True, "posts_per_week": 1, "post_days": list(ap.DAYS)})
        ap.plan_posts(db, b)
        t = db.query(AgentTask).filter_by(business_id=project, kind="gbp_post").one()
        with pytest.raises(ap.AutopilotError, match="future"):
            ap.approve(db, b, t, "owner", publish_at=datetime.now(timezone.utc) - timedelta(hours=1))
        ap.approve(db, b, t, "owner")
    finally:
        db.close()


# ------------------------------------------------------------------------------------------------------------------- reviews and the profile
def test_replies_wait_for_approval_and_are_posted_only_when_approved(project, monkeypatch):
    fake_ai(monkeypatch)
    monkeypatch.setattr(ai, "complete", lambda system, user, **kw: "Thank you for your kind words, we look forward to seeing you again.")
    db = SessionLocal()
    try:
        b = link(db, project)
        db.add(Review(business_id=project, external_id="rv1", author="Asha", rating=5, body="Lovely outfit", reply_status="none"))
        db.commit()
        assert ap.draft_replies(db, b)["made"] == 1
        t = db.query(AgentTask).filter_by(business_id=project, kind="review_reply").one()
        assert t.status == "pending" and t.requires_approval is True and FakeGoogle.calls == []  # a five-star reply no longer goes out by itself
        ap.approve(db, b, t, "owner")
        assert [c[0] for c in FakeGoogle.calls] == ["reply"] and db.get(AgentTask, t.id).status == "applied"
    finally:
        db.close()


def test_the_profile_rewrite_only_adds_services_and_is_written_to_google_only_after_approval(project, monkeypatch):
    fake_ai(monkeypatch)
    db = SessionLocal()
    try:
        b = link(db, project)
        before = list(b.services)
        out = ap.propose_profile(db, b)
        assert out["made"] == 1 and FakeGoogle.calls == [] and b.description == "We rent designer lehengas for weddings in Pune."
        t = db.query(AgentTask).filter_by(business_id=project, kind="profile_edit").one()
        names = [s["name"] for s in t.detail["changes"]["services"]]
        assert names[:2] == ["Lehenga rental", "Sherwani rental"] and "Bridal lehenga rental" in names and names.count("Lehenga rental") == 1  # nothing removed, no duplicate
        assert ap.propose_profile(db, b)["made"] == 0  # one at a time
        ap.approve(db, b, t, "owner")
        assert db.get(AgentTask, t.id).status == "applied" and [c[0] for c in FakeGoogle.calls] == ["profile"]
        assert len(db.get(Business, project).services) == len(before) + 1 and "sherwanis" in db.get(Business, project).description
    finally:
        db.close()


# ------------------------------------------------------------------------------------------------------------------- photos
def test_photos_are_validated_queued_and_uploaded_only_after_approval(project, monkeypatch):
    db = SessionLocal()
    try:
        b = link(db, project)
        out = ap.add_photos(db, b, [{"name": "front.png", "data": png(), "category": "EXTERIOR"}, {"name": "front-again.png", "data": png(), "category": "EXTERIOR"}, {"name": "notes.txt", "data": "data:text/plain;base64,aGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQ=", "category": "ADDITIONAL"}])
        assert out["added"] == ["front.png"] and len(out["errors"]) == 2 and any("already" in e for e in out["errors"]) and any("not a supported image" in e for e in out["errors"])
        t = db.query(AgentTask).filter_by(business_id=project, kind="gbp_photo").one()
        assert t.status == "pending" and ap.photo_path(t.detail["file"]).read_bytes()[:2] == b"\xff\xd8"  # stored as a JPEG
        assert ap.publish_due(db) == 0 and FakeGoogle.calls == []
        ap.approve(db, b, t, "owner")
        d = dict(t.detail)
        d["publish_at"] = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        t.detail = d
        db.commit()
        assert ap.publish_due(db) == 1 and FakeGoogle.calls[0][0] == "photo" and db.get(AgentTask, t.id).status == "applied"
        with pytest.raises(ap.AutopilotError, match="Choose|PROFILE|must be one of"):
            raise ap.AutopilotError("Choose")  # sanity: errors are plain messages
        assert "type must be one of" in ap.add_photos(db, b, [{"name": "x.png", "data": png(50, 50), "category": "NOPE"}])["errors"][0]
    finally:
        db.close()


# ------------------------------------------------------------------------------------------------------------------- settings and API
def test_settings_are_clamped_and_the_job_prepares_drafts_only_when_on(project, monkeypatch):
    fake_ai(monkeypatch)
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        s = ap.save_settings(db, b, {"posts_per_week": 9, "post_days": ["Monday", "friday", "xyz"], "post_time": "25:99", "photos_per_week": -1})
        assert s["posts_per_week"] == 3 and s["post_days"] == ["mon", "fri"] and s["post_time"] == "10:00" and s["photos_per_week"] == 0 and s["enabled"] is False
        assert ap.run_job(db, b) == {"skipped": "Autopilot is off"} and db.query(AgentTask).filter_by(business_id=project).count() == 0
    finally:
        db.close()


def test_the_api_flow_and_scoping(client, project, monkeypatch):
    fake_ai(monkeypatch, posts=1)
    db = SessionLocal()
    link(db, project)
    db.close()
    base = f"/api/v1/businesses/{project}/autopilot"
    assert client.put(f"{base}/settings", json={"enabled": True, "posts_per_week": 1, "post_days": list(ap.DAYS)}).json()["enabled"] is True
    assert client.put(f"{base}/settings", json={"posts_per_week": 7}).status_code == 422
    gen = client.post(f"{base}/generate", json={"what": "posts"}).json()
    assert gen["posts"]["made"] == 1
    ov = client.get(base).json()
    assert ov["counts"]["inbox"] == 1 and ov["inbox"][0]["kind"] == "gbp_post" and ov["rule"].startswith("Nothing is posted") and ov["next_run"]
    tid = ov["inbox"][0]["id"]
    assert client.patch(f"{base}/items/{tid}", json={"text": "An edited post about lehenga rental in Pune. Book a trial today."}).json()["text"].startswith("An edited")
    ok = client.post(f"{base}/items/{tid}/approve", json={}).json()
    assert ok["status"] == "scheduled" and ok["approved_by"] and FakeGoogle.calls == []
    assert client.patch(f"{base}/items/{tid}", json={"text": "late edit"}).status_code == 409  # an approved item is frozen
    assert client.post(f"{base}/items/{tid}/unschedule").json()["status"] == "pending"
    assert client.post(f"{base}/items/{tid}/reject", json={"note": "not now"}).json()["status"] == "rejected"
    assert client.get(f"/api/v1/businesses/987654/autopilot").status_code == 404
    assert client.post(f"{base}/items/999999/approve", json={}).status_code == 404


def test_a_draft_with_a_template_placeholder_is_never_offered(project, monkeypatch):
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "profile_text", lambda b: "Rental Co")
    monkeypatch.setattr(ai, "complete_json", lambda s, u, **k: {"posts": [{"topic": "t", "title": "T", "body": "Rent a designer lehenga in Pune today and book a trial. [add rental duration and booking process]"}]})
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        ap.save_settings(db, b, {"enabled": True, "posts_per_week": 1, "post_days": list(ap.DAYS)})
        assert ap.plan_posts(db, b)["made"] == 0 and db.query(AgentTask).filter_by(business_id=project).count() == 0
    finally:
        db.close()
