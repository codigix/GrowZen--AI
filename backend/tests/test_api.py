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


def test_portfolio(client):
    from app.db import SessionLocal
    from app.models import Schedule

    bid = client.post("/api/v1/businesses", json={"name": "Portfolio Bakery", "city": "Pune", "plan": "Growth",
                                                  "services": [{"name": "Custom cakes"}, {"name": "Catering"}]}).json()["id"]
    p = next(x for x in client.get("/api/v1/businesses/portfolio").json()["projects"] if x["id"] == bid)
    assert p["status"] == "active" and p["plan"] == "Growth" and p["business_services"] == ["Custom cakes", "Catering"]
    assert not p["services_configured"] and p["services"] == [] and p["areas"] == {}
    assert {"Google profile not linked", "No website", "No services scheduled", "Never audited"} <= {a["text"] for a in p["attention"]}
    db = SessionLocal()
    assert db.query(Schedule).filter(Schedule.business_id == bid).count() == 0  # reading the portfolio creates nothing
    db.close()

    client.post(f"/api/v1/businesses/{bid}/audits", json={"kinds": ["gbp"]})
    client.put(f"/api/v1/businesses/{bid}/schedules", json={"job": "rank_scan", "every": "weekly"})
    data = client.get("/api/v1/businesses/portfolio").json()
    p = next(x for x in data["projects"] if x["id"] == bid)
    assert p["areas"]["gbp"]["status"] == "done" and p["health"] is not None and p["last_audit_at"]
    assert p["services"] == [{"job": "rank_scan", "label": "Rank tracking", "every": "weekly", "last_run_at": None, "last_status": None, "last_error": None, "next_run_at": p["services"][0]["next_run_at"]}]
    assert p["next_job"]["job"] == "rank_scan"
    t = data["totals"]
    assert t["projects"] >= 1 and t["by_status"]["active"] >= 1 and t["active_services"] >= 1
    assert data["coverage"]["rank_scan"]["projects"] >= 1 and data["areas"]["gbp"]["audited"] >= 1
    assert any(u["project_id"] == bid and u["job"] == "rank_scan" for u in data["upcoming"])

    # Google customer actions: per project and across the portfolio, last 30 days vs the 30 before.
    from datetime import date, timedelta

    from app.models import InsightDay
    db = SessionLocal()
    db.add_all([InsightDay(business_id=bid, day=date.today() - timedelta(days=1), calls=5, directions=2, website_clicks=1),
                InsightDay(business_id=bid, day=date.today() - timedelta(days=40), calls=3, directions=0, website_clicks=0)])
    db.commit()
    db.close()
    data = client.get("/api/v1/businesses/portfolio").json()
    p = next(x for x in data["projects"] if x["id"] == bid)
    assert p["actions_30"] == {"calls": 5, "directions": 2, "website_clicks": 1} and p["actions_prev_30"]["calls"] == 3
    assert data["insights"]["last_30"]["calls"] >= 5 and any(d["calls"] >= 5 for d in data["insights"]["daily"])

    # The AI side: provider status, autopilot rules and each agent's workload.
    a = data["ai"]
    assert a["engine"]["configured"] is False and "profile_edit" in a["autopilot"]["manual"] and "gbp_post" in a["autopilot"]["auto"]
    assert {"audit", "gbp", "review", "outreach"} <= set(a["agents"]) and a["agents"]["gbp"]["label"] == "Profile agent"
    assert all(v["pending"] >= 0 and v["proposed_30"] >= v["applied_30"] for v in a["agents"].values())


def test_playbook_and_status(client):
    pb = client.get("/api/v1/playbook").json()
    assert pb["approval_rules"]["profile_edit"] is True
    assert client.put("/api/v1/playbook", json={"tone": "Warm"}).json()["tone"] == "Warm"
    st = client.get("/api/v1/status").json()
    assert st["ai"]["configured"] is False and st["dataforseo"] is False
