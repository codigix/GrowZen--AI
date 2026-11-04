"""Load-time fixes: grouped queries instead of one per client, slim and paged lists, newest-audit-per-kind reads."""
from sqlalchemy import event

from app import models
from app.db import SessionLocal, engine
from app.services import audits


def _business(client, **extra):
    return client.post("/api/v1/businesses", json={"name": "Perf Co", **extra}).json()["id"]


def _audit(db, bid, kind, score, issues=None, n=0):
    a = models.Audit(business_id=bid, kind=kind, status="done", score=score, issues=issues or [], result={"big": "x" * 50}, data_source="live",
                     finished_at=models.utcnow() if hasattr(models, "utcnow") else None)
    db.add(a)
    db.commit()
    return a


def test_business_list_drops_the_raw_google_payload_and_keeps_the_counts(client):
    bid = _business(client)
    with SessionLocal() as db:
        b = db.get(models.Business, bid)
        b.gbp_status = {"open_status": "open", "live": {"media": ["x" * 5000]}}
        db.add(models.AgentTask(business_id=bid, agent="audit", kind="website_fix", title="Fix it", status="pending"))
        db.commit()
    listed = next(b for b in client.get("/api/v1/businesses").json() if b["id"] == bid)
    assert listed["gbp_status"] == {"open_status": "open"}  # `live` is served by /gbp/live only
    assert listed["pending_tasks"] == 1 and "next_run_at" in listed


def test_business_list_runs_a_fixed_number_of_queries(client):
    for i in range(6):
        _business(client)
    n = {"q": 0}

    def count(*_a):
        n["q"] += 1
    event.listen(engine, "before_cursor_execute", count)
    try:
        assert client.get("/api/v1/businesses").status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", count)
    assert n["q"] <= 6, n["q"]  # session + business list + two grouped queries, whatever the number of clients


def test_latest_reads_only_the_newest_audit_of_each_kind():
    from datetime import datetime, timedelta, timezone
    with SessionLocal() as db:
        b = models.Business(name="Latest Co", website="https://latest.example")
        db.add(b)
        db.commit()
        now = datetime.now(timezone.utc)
        for kind, score, ago in (("onpage", 40, 5), ("onpage", 70, 1), ("technical", 55, 3), ("gbp", 10, 9), ("gbp", 90, 2)):
            db.add(models.Audit(business_id=b.id, kind=kind, status="done", score=score, issues=[], result={"p": 1}, data_source="live", finished_at=now - timedelta(days=ago)))
        db.add(models.Audit(business_id=b.id, kind="citations", status="failed", score=None, issues=[], result={}, data_source="live", finished_at=now))
        db.commit()
        found = audits.latest(db, b)
        assert {k: a.score for k, a in found.items()} == {"onpage": 70, "technical": 55, "gbp": 90}
        light = audits.latest(db, b, with_result=False)
        assert {k: a.score for k, a in light.items()} == {"onpage": 70, "technical": 55, "gbp": 90}
        assert audits.overall(db, b) == round((70 + 55 + 90) / 3)


def test_audit_history_comes_in_slim_slabs(client):
    bid = _business(client, website="https://perf.example")
    with SessionLocal() as db:
        for i in range(5):
            db.add(models.Audit(business_id=bid, kind="website", status="done", score=50 + i, target="https://perf.example/", data_source="live",
                                issues=[{"title": f"issue {j}", "level": "warning"} for j in range(i)], result={"pages": ["x" * 100]}))
        db.commit()
    slim = client.get("/api/v1/website-audits?url=https://perf.example&slim=true&limit=2").json()
    assert len(slim) == 2 and all("issues" not in a and "result" not in a for a in slim)
    assert [a["issue_count"] for a in slim] == [4, 3]  # newest first
    rest = client.get("/api/v1/website-audits?url=https://perf.example&slim=true&limit=2&offset=2").json()
    assert [a["issue_count"] for a in rest] == [2, 1]
    full = client.get("/api/v1/website-audits?url=https://perf.example").json()  # the default still carries the issues, for existing callers
    assert len(full) == 5 and "issues" in full[0] and "result" not in full[0]
    mine = client.get(f"/api/v1/businesses/{bid}/audits?kind=website&slim=true&limit=3").json()
    assert len(mine) == 3 and "issues" not in mine[0] and "issue_count" in mine[0]


def test_task_counts_give_the_totals_the_paged_list_no_longer_shows(client):
    bid = _business(client)
    with SessionLocal() as db:
        for i in range(5):
            db.add(models.AgentTask(business_id=bid, agent="audit", kind="website_fix", title=f"t{i}", status="pending" if i < 3 else "applied"))
        db.commit()
    c = client.get(f"/api/v1/tasks/counts?business_id={bid}").json()
    assert c == {"pending": 3, "applied": 2}
    assert len(client.get(f"/api/v1/tasks?status=pending&business_id={bid}&limit=2").json()) == 2
    assert len(client.get(f"/api/v1/tasks?status=pending&business_id={bid}&limit=2&offset=2").json()) == 1


def test_alerts_still_find_the_problems_with_the_batched_queries(client):
    from datetime import date, timedelta
    bid = _business(client)
    with SessionLocal() as db:
        db.add(models.Keyword(business_id=bid, keyword="dentist pune", rank=14, prev_rank=6))
        for d in range(8, 36):  # a healthy earlier month, then nothing this week
            db.add(models.InsightDay(business_id=bid, day=date.today() - timedelta(days=d), calls=5, directions=2, website_clicks=3))
        db.commit()
    alerts = client.get("/api/v1/copilot/alerts").json()["alerts"]
    mine = [a for a in alerts if a["business_id"] == bid]
    assert {a["type"] for a in mine} >= {"rank_drop", "actions_drop"}
