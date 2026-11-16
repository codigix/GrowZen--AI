"""The journey: ten steps from stored data, with what each waits for."""
from datetime import datetime, timezone

from app.db import SessionLocal
from app.models import Audit, Business, GrowthAction, Keyword, Post
from app.services import flow


def project(client, **extra):
    r = client.post("/api/v1/businesses", json={"name": "Flow Co", **extra})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def steps(d):
    return {s["key"]: s for s in d["steps"]}


def test_a_new_project_starts_at_the_details_and_everything_else_that_needs_them_is_blocked(client):
    bid = project(client)
    d = client.get(f"/api/v1/businesses/{bid}/flow").json()
    s = steps(d)
    assert [x["key"] for x in d["steps"]] == [x["key"] for x in flow.STEPS] and d["total"] == 10
    assert s["details"]["status"] == "todo" and "Missing" in s["details"]["detail"]
    assert s["google"]["status"] == "blocked" and s["google"]["waiting_for"][0]["key"] == "details"  # the dependency is named, with its link
    assert d["next"]["key"] == "details" and d["done"] == 0


def test_finishing_a_step_unblocks_the_ones_that_wait_for_it_and_moves_the_next_step(client):
    bid = project(client, primary_category="Clothing rental", city="Pune", phone="+919876543210", website="https://flow.example", address="12 MG Road")
    db = SessionLocal()
    try:
        d = flow.evaluate(db, db.get(Business, bid))
        s = steps(d)
        assert s["details"]["status"] == "done" and s["website"]["status"] == "todo" and s["google"]["status"] == "todo" and s["publish"]["status"] == "blocked"  # posting waits for Google
        assert s["publish"]["waiting_for"][0]["title"] == "Connect the Google profile" and s["fix"]["status"] == "blocked"  # fixing waits for the site check
        assert d["next"]["key"] == "google"
        db.add(Audit(business_id=bid, kind="onpage", status="done", score=61, data_source="live", result={}, issues=[]))
        db.commit()
        s = steps(flow.evaluate(db, db.get(Business, bid)))
        assert s["website"]["status"] == "done" and "61/100" in s["website"]["detail"] and s["fix"]["status"] == "todo"
    finally:
        db.close()


def test_fix_is_done_only_after_a_scan_and_with_no_critical_or_serious_issue_open(client):
    bid = project(client, primary_category="x", city="Pune", phone="+919876543210", website="https://flow.example")
    db = SessionLocal()
    try:
        db.add(Audit(business_id=bid, kind="onpage", status="done", score=50, data_source="live", result={}, issues=[]))
        db.commit()
        assert steps(flow.evaluate(db, db.get(Business, bid)))["fix"]["status"] == "todo"  # never scanned: not done
        a = GrowthAction(business_id=bid, area="seo", key="fix.x", period="fix", due_on=datetime.now(timezone.utc).date(), title="t", status="todo", evidence={"severity": "serious"})
        db.add(a)
        db.commit()
        s = steps(flow.evaluate(db, db.get(Business, bid)))
        assert s["fix"]["status"] == "todo" and "1 critical or serious" in s["fix"]["detail"]
        a.status = "verified"
        db.commit()
        assert steps(flow.evaluate(db, db.get(Business, bid)))["fix"]["status"] == "done"
    finally:
        db.close()


def test_keywords_need_eight_grouped_and_the_endpoint_is_scoped(client):
    bid = project(client)
    db = SessionLocal()
    try:
        for i in range(8):
            db.add(Keyword(business_id=bid, keyword=f"kw {i}", tracked=True))
        db.commit()
        assert steps(flow.evaluate(db, db.get(Business, bid)))["keywords"]["status"] == "blocked" or "not grouped" in steps(flow.evaluate(db, db.get(Business, bid)))["keywords"]["detail"]
        for k in db.query(Keyword).filter_by(business_id=bid):
            k.cluster = "Group"
        db.commit()
        assert "not grouped" not in steps(flow.evaluate(db, db.get(Business, bid)))["keywords"]["detail"]
    finally:
        db.close()
    assert client.get("/api/v1/businesses/987654/flow").status_code == 404


def test_keyword_progress_is_one_rule_for_the_page_and_the_journey(client):
    bid = client.post("/api/v1/businesses", json={"name": "Path Co", "website": "https://path.example", "city": "Pune"}).json()["id"]
    p = client.get(f"/api/v1/businesses/{bid}/keywords/progress").json()
    assert p["saved"] == 0 and p["next"]["key"] == "find" and not p["complete"] and [s["key"] for s in p["steps"]] == ["find", "save", "group", "use", "track"]
    client.post(f"/api/v1/businesses/{bid}/keywords", json=[{"keyword": f"dental service {i} pune", "tracked": True} for i in range(8)])
    p = client.get(f"/api/v1/businesses/{bid}/keywords/progress").json()
    assert p["steps"][4]["to"] == "/rank-tracking/positions" and p["saved"] == 8 and p["steps"][1]["done"] is True and p["next"]["key"] == "group" and p["next"]["to"] == "/keyword-management/topics"
    step = next(s for s in client.get(f"/api/v1/businesses/{bid}/flow").json()["steps"] if s["key"] == "keywords")
    assert step["status"] != "done" and "8 keywords tracked" in step["detail"]  # saved but not grouped: the journey agrees with the page
