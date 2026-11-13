"""Website health: the site audit and Page X-Ray merged by topic, with the places they disagree explained."""
from datetime import datetime, timezone

from app.db import SessionLocal
from app.models import Audit, Business, PageXRayRun
from app.services import website_health as wh


def report(**over):
    checks = {"seo": [{"key": "title", "label": "Title", "passed": True, "detail": "ok"}, {"key": "alt", "label": "Alt", "passed": True}, {"key": "a11y_main", "label": "Main", "passed": False, "fix": "Wrap in <main>"}],
              "aeo": [{"key": "faq_schema", "label": "FAQ", "passed": False, "fix": "Add FAQ"}], "geo": [{"key": "org_schema", "label": "Org schema", "passed": True}]}
    r = {"url": "https://wh.example/", "final_url": "https://wh.example/", "fetched_at": "2026-11-13T00:00:00+00:00", "rendering": {"mode": "chrome", "js_required": True}, "content": {"word_count": 900},
         "scores": {a: {"score": 50, "checks": c} for a, c in checks.items()}}
    r.update(over)
    return r


def setup(client, issues, xray=None):
    bid = client.post("/api/v1/businesses", json={"name": "WH Co", "website": "https://wh.example"}).json()["id"]
    db = SessionLocal()
    db.add(Audit(business_id=bid, kind="onpage", status="done", score=44, data_source="live", result={}, issues=issues, finished_at=datetime.now(timezone.utc)))
    if xray is not None:
        db.add(PageXRayRun(business_id=bid, url="https://wh.example/", final_url="https://wh.example/", render=True, seo_score=50, aeo_score=50, geo_score=50, source="server", report=xray))
    db.commit()
    db.close()
    return bid


def topics(d):
    return {t["key"]: t for t in d["topics"]}


def test_findings_are_grouped_by_topic_once_and_counted_per_issue_type(client):
    issues = [{"code": "missing_alt", "level": "info", "title": "x"}] * 3 + [{"code": "duplicate_titles", "level": "warning", "title": "d"}]
    bid = setup(client, issues, report())
    d = client.get(f"/api/v1/businesses/{bid}/flow/website-health").json()
    t = topics(d)
    assert t["images"]["site"][0]["count"] == 3 and len(t["images"]["site"]) == 1  # three rows of one issue are one finding
    assert t["titles"]["site"][0]["title"] == "Duplicate title tags" and [p["key"] for p in t["accessibility"]["page"]] == ["a11y_main"]
    assert t["accessibility"]["notes"][0]["kind"] == "page_only" and d["summary"]["raw_audit_issues"] == 4


def test_a_problem_the_crawler_sees_but_the_rendered_page_does_not_is_marked_as_a_difference(client):
    issues = [{"code": "no_localbusiness_schema", "level": "serious", "title": "No schema"}, {"code": "javascript_only", "level": "critical", "title": "empty"}]
    bid = setup(client, issues, report())
    d = client.get(f"/api/v1/businesses/{bid}/flow/website-health").json()
    t = topics(d)
    assert t["structured"]["site"][0]["differs"].startswith("The audit crawler reads the plain HTML")  # the org schema check passes in the browser read
    assert "900 words" in t["rendering"]["site"][0]["differs"] and t["rendering"]["status"] == "warn"  # a warning to confirm, not a failure
    assert d["xray"]["rendered"] is True and d["summary"]["differs"] == 2


def test_without_a_rendered_read_a_passing_page_check_means_the_problem_is_on_other_pages(client):
    plain = report(rendering={"mode": "html", "js_required": False})
    bid = setup(client, [{"code": "missing_alt", "level": "info", "title": "x"}], plain)
    t = topics(client.get(f"/api/v1/businesses/{bid}/flow/website-health").json())
    assert "other pages of the site" in t["images"]["site"][0]["differs"] and t["images"]["status"] == "warn"


def test_each_tool_alone_still_works_and_scoping_holds(client):
    bid = setup(client, [{"code": "duplicate_titles", "level": "warning", "title": "d"}], None)
    d = client.get(f"/api/v1/businesses/{bid}/flow/website-health").json()
    assert d["xray"]["has"] is False and d["audit"]["has"] is True and topics(d)["titles"]["page"] == []
    assert client.get("/api/v1/businesses/987654/flow/website-health").status_code == 404
    empty = client.post("/api/v1/businesses", json={"name": "Empty"}).json()["id"]
    assert client.get(f"/api/v1/businesses/{empty}/flow/website-health").json()["topics"] == []
