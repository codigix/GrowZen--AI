"""AI copilot: drafted changes with risk, low-risk bulk approval, alerts, daily briefing, bulk reports.
Each runs without an AI key (rules) and with one (a fake AI here)."""
from datetime import date, datetime, timedelta, timezone

from app.db import SessionLocal
from app.models import AgentTask, Audit, Business, InsightDay, Keyword, Review
from app.services import agent, ai, copilot, crawler


def seed_business(name, **kw):
    db = SessionLocal()
    b = Business(name=name, primary_category="Dentist", area="Aundh", city="Pune", phone="+91 98220 10099", website="https://sai.example", status="active", **kw)
    db.add(b)
    db.commit()
    page = crawler.analyse_html("https://sai.example/implants", 200, "<html><head><title>Implants</title></head><body><h1>Dental implants</h1><img src='x/smile-1.jpg'></body></html>")
    page.pop("links")
    db.add(Audit(business_id=b.id, kind="onpage", status="done", score=60, result={"pages": [page]}, issues=[], finished_at=datetime.now(timezone.utc)))
    db.commit()
    bid = b.id
    db.close()
    return bid


ISSUES = [{"area": "On-page", "level": "warning", "code": "missing_meta_description", "title": "/implants has no meta description", "fix": "Write 150-160 characters."},
          {"area": "Indexing", "level": "critical", "code": "noindex", "title": "/implants has noindex", "fix": "Remove noindex."},
          {"area": "GBP", "level": "serious", "key": "description", "title": "Business description", "fix": "Write a 750-character description."}]


def test_planned_tasks_carry_a_draft_and_risk(client):
    bid = seed_business("Draft Dental")
    db = SessionLocal()
    tasks = {t.title: t for t in agent.plan_from_audits(db, db.get(Business, bid), ISSUES)}
    meta = tasks["/implants has no meta description"].detail
    assert meta["risk"] == "low" and meta["draft"]["source"] == "rules" and meta["draft"]["page"] == "https://sai.example/implants"
    change = meta["draft"]["changes"][0]
    assert change["label"] == "Meta description" and change["before"] == "(none)" and "Draft Dental" in change["after"] and len(change["after"]) <= 160
    assert tasks["/implants has noindex"].detail["risk"] == "high"
    assert tasks["Business description"].detail["risk"] == "high" and tasks["Business description"].requires_approval
    db.close()

    # Approve all low-risk: only the meta description goes; the noindex fix and the profile edit wait.
    r = client.post(f"/api/v1/tasks/approve-low-risk?business_id={bid}").json()
    assert [t["title"] for t in r["tasks"]] == ["/implants has no meta description"] and r["tasks"][0]["status"] == "applied"
    left = {t["title"] for t in client.get(f"/api/v1/tasks?status=pending&business_id={bid}").json()}
    assert left == {"/implants has noindex", "Business description"}


def test_ai_drafts_and_may_only_raise_risk(client, monkeypatch):
    bid = seed_business("AI Dental")
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete_json", lambda system, user, **kw: {
        "summary": "Add a description that says what the page offers.", "risk": "medium",
        "changes": [{"label": "Meta description", "before": "(none)", "after": "Dental implants at AI Dental in Aundh, Pune. Book a consultation."}]})
    db = SessionLocal()
    t = agent.plan_from_audits(db, db.get(Business, bid), ISSUES[:1])[0]
    assert t.detail["draft"]["source"] == "ai" and t.detail["draft"]["changes"][0]["after"].startswith("Dental implants at AI Dental")
    assert t.detail["risk"] == "medium"  # the AI raised it from low
    db.close()
    # Redraft when the AI fails: the rule draft stands and says why.
    monkeypatch.setattr(ai, "complete_json", lambda system, user, **kw: (_ for _ in ()).throw(RuntimeError("quota")))
    out = client.post(f"/api/v1/tasks/{t.id}/redraft").json()
    assert out["detail"]["draft"]["source"] == "rules" and "quota" in out["detail"]["draft"]["ai_error"]


def test_old_tasks_get_drafts_when_listed(client):
    bid = seed_business("Old Task Dental")
    db = SessionLocal()
    db.add(AgentTask(business_id=bid, agent="audit", kind="website_fix", title="/implants has no meta description", detail={"fix": "Write one.", "code": "missing_meta_description"}))
    db.commit()
    db.close()
    listed = [t for t in client.get(f"/api/v1/tasks?business_id={bid}").json() if t["title"] == "/implants has no meta description"]
    assert listed and listed[0]["detail"]["draft"]["changes"][0]["label"] == "Meta description" and listed[0]["detail"]["risk"] == "low"


def test_alerts_from_rules(client):
    bid = seed_business("Alert Dental")
    db = SessionLocal()
    today = date.today()
    for d in range(35):  # about 21 actions a week before, 3 this week
        day = today - timedelta(days=d)
        db.add(InsightDay(business_id=bid, day=day, calls=3 if d >= 7 else 0, directions=0, website_clicks=0 if d >= 7 else 1 if d < 3 else 0))
    db.add(Review(business_id=bid, external_id="bad1", author="Ravi", rating=1, body="Long wait", reply_status="none", review_date=today - timedelta(days=2)))
    db.add(Keyword(business_id=bid, keyword="dentist aundh", rank=12, prev_rank=4))
    b = db.get(Business, bid)
    b.verification = "suspended"
    db.commit()
    db.close()
    r = client.get("/api/v1/copilot/alerts").json()
    mine = [a for a in r["alerts"] if a["business_id"] == bid]
    kinds = {a["type"]: a for a in mine}
    assert r["source"] == "rules" and set(kinds) == {"listing", "bad_review", "rank_drop", "actions_drop"}
    assert mine[0]["type"] == "listing" and mine[0]["level"] == "critical"  # most urgent first
    assert kinds["rank_drop"]["level"] == "serious" and "#4 to #12" in kinds["rank_drop"]["title"]
    assert kinds["actions_drop"]["title"].startswith("Customer actions down") and kinds["bad_review"]["why"] and kinds["bad_review"]["next"]


def test_briefing_rules_then_ai_and_cached(client, monkeypatch):
    bid = seed_business("Brief Dental")
    copilot._cache.clear()
    r = client.get("/api/v1/copilot/briefing").json()
    assert r["source"] == "rules" and r["headline"] and len(r["priorities"]) <= 5
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete_json", lambda system, user, **kw: {"headline": "Two clients need you today.", "priorities": [
        {"business_id": bid, "title": "Publish the meta descriptions", "why": "Pages show random text in Google.", "action": "approvals"},
        {"business_id": 999999, "title": "Not a real client", "why": "", "action": "audit"}]})
    assert client.get("/api/v1/copilot/briefing").json()["source"] == "rules"  # cached for the day
    r = client.get("/api/v1/copilot/briefing?refresh=true").json()
    assert r["source"] == "ai" and r["headline"] == "Two clients need you today."
    assert [p["business_id"] for p in r["priorities"]] == [bid] and r["priorities"][0]["business"] == "Brief Dental"  # unknown ids dropped
    copilot._cache.clear()


def test_bulk_reports_and_status(client):
    seed_business("Report Dental")
    r = client.post("/api/v1/copilot/reports").json()
    rep = next(x for x in r["reports"] if x["business"] == "Report Dental")
    assert r["ai"] is False and rep["summary"] and rep["pdf"].startswith(f"/businesses/{rep['business_id']}/report.pdf")
    s = client.get("/api/v1/copilot/status").json()
    assert s["ai"] is False and "deepseek" in s["providers"]
