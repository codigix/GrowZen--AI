"""Reliability: schema sync, runs that died with their process, honest task states, triage, sample data kept out of health,
pruning and diagnostics."""
import tempfile
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.db import Base, SessionLocal
from app.main import app
from app.models import AgentTask, AppUser, Audit, Business
from app.services import agent, audits, jobs, schema
from app.services.passwords import hash_password


def test_schema_sync_creates_a_missing_table_and_column_and_never_drops_anything():
    engine = create_engine(f"sqlite:///{tempfile.mkdtemp()}/drift.db")
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        s.add(Business(name="Keep Me"))
        s.commit()
    with engine.begin() as c:
        c.execute(text("DROP TABLE keyword_rank_log"))
        c.execute(text("ALTER TABLE businesses DROP COLUMN target_areas"))
    d = schema.drift(engine)
    assert d["missing_tables"] == ["keyword_rank_log"] and d["missing_columns"] == {"businesses": ["target_areas"]}
    done = schema.sync(engine)
    assert done["created_tables"] == ["keyword_rank_log"] and done["added_columns"] == ["businesses.target_areas"]
    assert schema.drift(engine) == {"missing_tables": [], "missing_columns": {}}
    with engine.connect() as c:
        assert c.execute(text("select name from businesses")).scalar() == "Keep Me"  # existing rows are untouched


def make_audit(kind="website", status="running", age_minutes=0, **kw):
    db = SessionLocal()
    a = Audit(kind=kind, target=f"https://t{datetime.now().timestamp()}.in", status=status, **kw)
    db.add(a)
    db.commit()
    db.execute(text("update audits set updated_at = :t where id = :i"), {"t": datetime.now(timezone.utc) - timedelta(minutes=age_minutes), "i": a.id})
    db.commit()
    aid = a.id
    db.close()
    return aid


def status_of(aid):
    db = SessionLocal()
    a = db.get(Audit, aid)
    out = (a.status, a.error)
    db.close()
    return out


def test_runs_that_died_with_their_process_are_failed_so_pages_stop_spinning():
    fresh, old, done = make_audit(age_minutes=1), make_audit(age_minutes=45), make_audit(status="done", age_minutes=60)
    db = SessionLocal()
    jobs.recover_stale(db)  # the periodic check only takes runs that stalled
    db.close()
    assert status_of(fresh)[0] == "running" and status_of(old)[0] == "failed" and "Run it again" in status_of(old)[1] and status_of(done)[0] == "done"
    db = SessionLocal()
    jobs.recover_stale(db, startup=True)  # at start-up nothing can still be running
    db.close()
    assert status_of(fresh)[0] == "failed"


def project(client, name="Triage Dental"):
    return client.post("/api/v1/businesses", json={"name": name, "primary_category": "Dentist", "city": "Pune", "website": "https://tri.in"}).json()["id"]


def add_task(bid, title, kind="website_fix", area="On-page", status="pending", **detail):
    db = SessionLocal()
    t = AgentTask(business_id=bid, agent="audit", kind=kind, title=title, impact="High", status=status, detail={"area": area, "code": detail.pop("code", None), **detail})
    db.add(t)
    db.commit()
    tid = t.id
    db.close()
    return tid


def task_status(tid):
    db = SessionLocal()
    t = db.get(AgentTask, tid)
    out = (t.status, (t.result or {}))
    db.close()
    return out


def test_a_fix_only_a_person_can_make_is_not_claimed_as_applied(client):
    bid = project(client)
    tid = add_task(bid, "No LocalBusiness schema on the site")
    out = client.post(f"/api/v1/tasks/{tid}/approve").json()
    assert out["status"] == "handoff" and out["result"]["handoff"] is True and out["applied_at"] is None


def test_the_next_audit_closes_the_tasks_whose_issue_is_gone(client):
    bid = project(client)
    gone = add_task(bid, "/about has no meta description", status="handoff")
    still = add_task(bid, "/contact has no title")
    other_area = add_task(bid, "Profile has no photos", kind="profile_edit", area="GBP")
    db = SessionLocal()
    b = db.get(Business, bid)
    n = agent.reconcile(db, b, [{"title": "/contact has no title", "area": "On-page", "level": "serious"}], audited=["onpage"])
    db.commit()
    db.close()
    assert n == 1 and task_status(gone)[0] == "resolved" and task_status(gone)[1]["verified"] is True
    assert task_status(still)[0] == "pending"
    assert task_status(other_area)[0] == "pending"  # the GBP area was not audited this time: never closed by an audit that did not look
    db = SessionLocal()
    assert agent.reconcile(db, db.get(Business, bid), [], audited=[]) == 0
    db.close()


def test_triage_cleans_the_queue(client):
    bid = project(client, "Triage Two")
    fixed = add_task(bid, "/old has noindex", code="noindex")
    d1, d2 = add_task(bid, "Add alt text to images"), add_task(bid, "Add  alt text to IMAGES")
    keep = add_task(bid, "Write a title", status="pending")
    db = SessionLocal()
    db.add(Audit(business_id=bid, kind="onpage", status="done", score=80, issues=[{"title": "Write a title", "area": "On-page", "level": "warning"}, {"title": "Add alt text to images", "area": "On-page", "level": "info"}]))
    db.commit()
    db.close()
    r = client.post(f"/api/v1/tasks/triage?business_id={bid}").json()
    assert r["resolved"] == 1 and r["duplicates_rejected"] == 1 and r["remaining"] == 2
    assert task_status(fixed)[0] == "resolved" and {task_status(d1)[0], task_status(d2)[0]} == {"pending", "rejected"} and task_status(keep)[0] == "pending"
    assert r["top"][0]["impact"] == "High"
    rejected = client.post("/api/v1/tasks/bulk", json={"ids": [keep], "action": "reject"}).json()
    assert rejected == {"done": 1, "skipped": 0, "action": "reject"} and task_status(keep)[0] == "rejected"
    profile = add_task(bid, "Change the business description", kind="profile_edit", area="GBP")
    assert client.post("/api/v1/tasks/bulk", json={"ids": [profile], "action": "approve"}).json()["skipped"] == 1  # profile edits always wait for a person
    assert task_status(profile)[0] == "pending"


def test_sample_data_is_never_part_of_a_projects_health(client):
    bid = project(client, "Sample Health Co")
    db = SessionLocal()
    db.add_all([Audit(business_id=bid, kind="technical", status="done", score=90, data_source="live"), Audit(business_id=bid, kind="onpage", status="done", score=80, data_source="live"),
                Audit(business_id=bid, kind="rankings", status="done", score=10, data_source="sample"), Audit(business_id=bid, kind="backlinks", status="done", score=5, data_source="sample")])
    db.commit()
    assert audits.overall(db, db.get(Business, bid)) == 85  # (90 + 80) / 2: the two sample scores are left out
    db.close()


def test_old_audits_are_pruned_but_the_newest_stay():
    db = SessionLocal()
    biz = Business(name="Prune Co")
    db.add(biz)
    db.commit()
    ids = []
    for i in range(8):
        a = Audit(business_id=biz.id, kind="gbp", status="done", score=50)
        db.add(a)
        db.commit()
        db.execute(text("update audits set created_at = :t where id = :i"), {"t": datetime.now(timezone.utc) - timedelta(days=400 - i), "i": a.id})
        ids.append(a.id)
    db.commit()
    assert jobs.prune(db, force=True) == 3  # 8 old audits, the newest 5 are kept
    assert {a.id for a in db.query(Audit).filter(Audit.business_id == biz.id)} == set(ids[-5:])
    db.close()


def test_diagnostics_are_for_admins_and_say_what_is_wrong(client):
    db = SessionLocal()
    for email, role in (("diag-admin@x.in", "admin"), ("diag-viewer@x.in", "viewer")):
        db.query(AppUser).filter_by(email=email).delete()
        db.add(AppUser(email=email, name=role, role=role, password_hash=hash_password("a-long-enough-password")))
    db.commit()
    db.close()
    a = TestClient(app)
    a.post("/api/v1/auth/login", json={"email": "diag-admin@x.in", "password": "a-long-enough-password"})
    v = TestClient(app)
    v.post("/api/v1/auth/login", json={"email": "diag-viewer@x.in", "password": "a-long-enough-password"})
    assert v.get("/api/v1/system/diagnostics").status_code == 403
    d = a.get("/api/v1/system/diagnostics").json()
    assert {"problems", "stuck_runs", "failing_schedules", "tasks", "scheduler", "providers", "data", "schema_drift"} <= set(d)
    assert any("No AI model" in p for p in d["problems"]) and d["schema_drift"] == {"missing_tables": [], "missing_columns": {}}
