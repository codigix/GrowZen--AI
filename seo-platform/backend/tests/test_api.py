"""API: login, business CRUD, the onboarding pipeline end to end, approvals, reports."""
import time

import jwt
from fastapi.testclient import TestClient

from app.main import app

EMAIL = {
    "from_addr": "sales@codigixinfotech.com",
    "subject": "New client onboarding: Sai Dental Care",
    "body": "Business: Sai Dental Care\nWebsite: https://saidentalcare.in\nPhone: +91 98505 22140\nAddress: Shop 12, ITI Road, Aundh, Pune 411007\nCategory: Dentist\nPackage: Growth\nMain services: implants, root canal",
}


def test_needs_login():
    assert TestClient(app).get("/api/v1/businesses").status_code == 401


def test_rejects_bad_token():
    c = TestClient(app)
    c.cookies.set("crm_session", jwt.encode({"sub": "1", "exp": int(time.time()) + 60}, "wrong-secret-0123456789-abcdefghijklmn", algorithm="HS256"))
    assert c.get("/api/v1/businesses").status_code == 401


def test_business_crud(client):
    r = client.post("/api/v1/businesses", json={"name": "IronCore Fitness", "primary_category": "Gym", "phone": "+91 90110 55667"})
    assert r.status_code == 201
    bid = r.json()["id"]
    assert client.patch(f"/api/v1/businesses/{bid}", json={"area": "Wakad"}).json()["area"] == "Wakad"
    score = client.get(f"/api/v1/businesses/{bid}/gbp/score").json()
    assert 0 <= score["score"] < 60 and score["top_fixes"]
    assert client.delete(f"/api/v1/businesses/{bid}").status_code == 204


def test_onboarding_pipeline_end_to_end(client):
    r = client.post("/api/v1/intake/emails", json=EMAIL)
    assert r.status_code == 201
    em = client.get(f"/api/v1/intake/emails/{r.json()['id']}").json()
    assert em["status"] == "done", em.get("error")
    assert [s["id"] for s in em["steps"]] == ["extract", "profile", "gbp_match", "audits", "plan", "report", "schedule", "notify"]
    assert all(s["status"] == "done" for s in em["steps"])
    bid = em["business_id"]

    b = client.get(f"/api/v1/businesses/{bid}").json()
    assert b["name"] == "Sai Dental Care" and b["plan"] == "Growth" and b["last_audit_score"] is not None

    kinds = {a["kind"]: a for a in client.get(f"/api/v1/businesses/{bid}/audits").json()}
    assert set(kinds) == {"gbp", "rankings", "technical", "onpage", "backlinks", "citations"}
    assert kinds["rankings"]["data_source"] == "sample" and kinds["technical"]["data_source"] == "live"

    schedules = {s["job"]: s["every"] for s in client.get(f"/api/v1/businesses/{bid}/schedules").json()}
    assert schedules["rank_scan"] == "weekly" and schedules["geo"] == "off"  # Growth plan

    tasks = client.get(f"/api/v1/tasks?business_id={bid}").json()
    assert tasks and all(t["status"] == "pending" for t in tasks)
    t = tasks[0]
    done = client.post(f"/api/v1/tasks/{t['id']}/approve").json()
    assert done["status"] in ("applied", "failed")
    assert client.post(f"/api/v1/tasks/{t['id']}/approve").status_code == 409

    report = client.get(f"/api/v1/businesses/{bid}/report").json()
    assert report["business"] == "Sai Dental Care" and report["plain_words"]
    pdf = client.get(f"/api/v1/businesses/{bid}/report.pdf")
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"

    # Same email again: refused as a duplicate; same business again: matched, not duplicated.
    assert client.post("/api/v1/intake/emails", json=EMAIL | {"message_id": "x1"}).status_code == 201
    names = [x["name"] for x in client.get("/api/v1/businesses").json()]
    assert names.count("Sai Dental Care") == 1


def test_missing_details_are_asked_not_guessed(client):
    r = client.post("/api/v1/intake/emails", json={"from_addr": "sales@codigixinfotech.com", "subject": "Onboard: Apex Interiors", "body": "Apex Interiors, Hinjewadi. No website. Package Pro."})
    em = client.get(f"/api/v1/intake/emails/{r.json()['id']}").json()
    assert em["status"] == "needs_info" and em["missing"] == ["phone"]


def test_unknown_sender_rejected(client):
    r = client.post("/api/v1/intake/emails", json=EMAIL | {"from_addr": "someone@gmail.com", "message_id": "x2"})
    assert r.json()["status"] == "rejected"


def test_webhook_needs_token(client):
    assert client.post("/api/v1/intake/webhook", json=EMAIL | {"message_id": "x3"}).status_code == 401
    ok = client.post("/api/v1/intake/webhook", json=EMAIL | {"message_id": "x4"}, headers={"X-Intake-Token": "hook-token"})
    assert ok.status_code == 202


def test_rank_scan_and_keywords(client):
    bid = client.post("/api/v1/businesses", json={"name": "Glow Studio", "lat": 18.559, "lng": 73.786}).json()["id"]
    assert client.post(f"/api/v1/businesses/{bid}/rank-scans", json={"keyword": "salon in baner", "grid_size": 5}).status_code == 202
    scans = client.get(f"/api/v1/businesses/{bid}/rank-scans").json()
    assert scans and len(scans[0]["points"]) == 25
    ideas = client.post(f"/api/v1/businesses/{bid}/keywords/ideas", json={"seed": "hair salon"}).json()
    assert ideas["data_source"] == "sample" and ideas["ideas"]
    assert client.post(f"/api/v1/businesses/{bid}/keywords", json=[{"keyword": "Hair Salon  Baner"}]).json()["added"] == 1
    assert client.get(f"/api/v1/businesses/{bid}/keywords").json()["keywords"][0]["keyword"] == "hair salon baner"


def test_playbook_and_status(client):
    pb = client.get("/api/v1/playbook").json()
    assert pb["approval_rules"]["profile_edit"] is True
    assert client.put("/api/v1/playbook", json={"tone": "Warm"}).json()["tone"] == "Warm"
    st = client.get("/api/v1/status").json()
    assert st["ai"]["configured"] is False and st["dataforseo"] is False
