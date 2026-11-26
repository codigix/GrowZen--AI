"""Portfolio and Copilot briefing: reads are limited to the user's projects, the newest audit per area is picked by the database,
and the briefing does not build the portfolio when today's briefing is cached."""
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import event

from app.db import SessionLocal, engine
from app.models import AgentTask, Audit, Business, InsightDay
from app.services import copilot, portfolio


def _business(db, name):
    b = Business(name=name, primary_category="Dentist", city="Pune", status="active")
    db.add(b)
    db.commit()
    return b.id


def _audit(db, bid, kind, status, score, issues, minutes_ago, **kw):
    when = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    db.add(Audit(business_id=bid, kind=kind, status=status, score=score, issues=issues, created_at=when, finished_at=when, **kw))


@pytest.fixture()
def two_projects():
    db = SessionLocal()
    mine, other = _business(db, "Scope Mine"), _business(db, "Scope Other")
    crit = [{"level": "critical", "title": "a"}, {"level": "serious", "title": "b"}]
    # Mine: an old done audit, a newer failed one (the failed one wins), and a newer done technical audit; a kind the dashboard ignores.
    _audit(db, mine, "gbp", "done", 50, crit, 30)
    _audit(db, mine, "gbp", "failed", None, [], 10, error="boom")
    _audit(db, mine, "technical", "done", 70, crit, 20)
    _audit(db, mine, "technical", "done", 80, [{"level": "critical", "title": "c"}], 5)  # newest technical
    _audit(db, mine, "website", "done", 99, crit, 1)
    _audit(db, other, "gbp", "done", 10, crit * 5, 5)
    for b in (mine, other):
        db.add(AgentTask(business_id=b, agent="audit", kind="website_fix", title="t", status="pending"))
        db.add(InsightDay(business_id=b, day=date.today() - timedelta(days=1), calls=4, directions=2, website_clicks=1))
    db.commit()
    db.close()
    yield mine, other
    db = SessionLocal()
    for b in (mine, other):  # the test database does not cascade deletes: remove the rows by hand so later tests never see them
        for model in (AgentTask, Audit, InsightDay):
            db.query(model).filter(model.business_id == b).delete()
        db.query(Business).filter(Business.id == b).delete()
    db.commit()
    db.close()


def test_the_newest_audit_of_each_area_is_used(two_projects):
    mine, _ = two_projects
    db = SessionLocal()
    p = next(x for x in portfolio.summary(db, [mine])["projects"] if x["id"] == mine)
    db.close()
    assert p["areas"]["gbp"]["status"] == "failed" and p["areas"]["gbp"]["error"] == "boom"  # newest of the area, even though it failed
    assert p["areas"]["technical"]["score"] == 80
    assert "website" not in p["areas"]
    assert p["issues"] == {"critical": 1, "serious": 0}  # only the newest done audit per area counts (the failed gbp one adds nothing)


def test_a_user_sees_only_their_own_projects_and_counts(two_projects):
    mine, other = two_projects
    db = SessionLocal()
    scoped = portfolio.summary(db, [mine])
    full = portfolio.summary(db, None)
    db.close()
    assert [p["id"] for p in scoped["projects"]] == [mine]
    assert scoped["totals"]["pending_tasks"] == 1 and scoped["ai"]["agents"]["audit"]["pending"] == 1  # not the other project's task
    assert scoped["insights"]["last_30"]["calls"] == 4
    assert {mine, other} <= {p["id"] for p in full["projects"]}  # an admin still sees every project
    assert full["totals"]["pending_tasks"] >= 2 and full["insights"]["last_30"]["calls"] >= 8
    assert next(p for p in full["projects"] if p["id"] == other)["issues"]["critical"] == 5


def test_a_user_with_no_projects_gets_an_empty_portfolio():
    db = SessionLocal()
    out = portfolio.summary(db, [])
    db.close()
    assert out["projects"] == [] and out["totals"]["projects"] == 0 and out["totals"]["pending_tasks"] == 0
    assert out["insights"]["last_30"] == {"calls": 0, "directions": 0, "website_clicks": 0}


def test_the_portfolio_never_reads_the_large_audit_result_column(two_projects):
    mine, _ = two_projects
    seen: list[str] = []

    def grab(conn, cursor, statement, *a):
        seen.append(statement)

    event.listen(engine, "before_cursor_execute", grab)
    try:
        db = SessionLocal()
        portfolio.summary(db, [mine])
        db.close()
    finally:
        event.remove(engine, "before_cursor_execute", grab)
    audit_reads = [s for s in seen if "FROM audits" in s]
    assert audit_reads and not any("audits.result" in s for s in audit_reads)
    assert len([s for s in audit_reads if "row_number" in s.lower()]) == 1  # the newest-per-area read is one windowed query


def test_the_briefing_does_not_build_the_portfolio_when_it_is_cached(client, monkeypatch):
    copilot._cache.clear()
    calls = []
    real = portfolio.summary
    monkeypatch.setattr(portfolio, "summary", lambda *a, **k: (calls.append(1), real(*a, **k))[1])
    first = client.get("/api/v1/copilot/briefing").json()
    assert len(calls) == 1
    again = client.get("/api/v1/copilot/briefing").json()
    assert len(calls) == 1 and again == first  # cached for the day: the portfolio was not built again
    client.get("/api/v1/copilot/briefing?refresh=true")
    assert len(calls) == 2  # refresh still rebuilds
    copilot._cache.clear()
