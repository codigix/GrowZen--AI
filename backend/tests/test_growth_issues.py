"""The issue sweep (fix tasks that land on the right page), their real verification, the weekly/monthly growth reports and the emails (all offline)."""
from datetime import date, datetime, timedelta, timezone

import pytest

from app.db import SessionLocal
from app.models import Business, GrowthAction, GrowthReport, GrowthSnapshot
from app.services import growth_issues as gi, growth_plan as gp, growth_report as gr, notify

TODAY = date(2026, 11, 13)  # a Friday


def issue(key, severity="warning", area="seo", link="/website-audit", verify=None):
    return gi.make(key, area, "test", severity, f"Title {key}", "Because it is wrong", ["Do this"], 10, link, verify or {"type": "field", "field": "name"})


@pytest.fixture
def project(client):
    r = client.post("/api/v1/businesses", json={"name": "Issues Co", "city": "Pune", "website": "https://issues.example", "contact_email": "owner@issues.example"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.fixture
def sources(monkeypatch):
    """Replace every source with a controllable list."""
    state = {"issues": [], "skipped": []}

    def collect(db, b, live=False):
        return {"issues": list(state["issues"]), "skipped": list(state["skipped"]), "total_found": len(state["issues"])}
    monkeypatch.setattr(gi, "collect", collect)
    return state


def fix_rows(db, bid):
    return {a.key: a for a in db.query(GrowthAction).filter_by(business_id=bid, period="fix")}


# ------------------------------------------------------------------------------------------------------------------- the sweep
def test_each_issue_becomes_one_fix_task_with_a_landing_page_and_a_deadline_by_severity(project, sources):
    sources["issues"] = [issue("a", "critical", link="/page-xray?url=x"), issue("b", "serious"), issue("c", "info", "gmb", "/gmb-profile/reviews")]
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        res = gi.sweep(db, b, TODAY)
        assert res["created"] == 3 and res["new_critical"] == ["Title a"]
        rows = fix_rows(db, project)
        assert rows["fix.a"].due_on == TODAY + timedelta(days=3) and rows["fix.b"].due_on == TODAY + timedelta(days=7) and rows["fix.c"].due_on == TODAY + timedelta(days=30)
        assert rows["fix.a"].link == "/page-xray?url=x" and rows["fix.c"].link == "/gmb-profile/reviews" and rows["fix.a"].how == ["Do this"]
        assert gi.sweep(db, b, TODAY)["created"] == 0  # a second sweep never duplicates
        assert db.query(GrowthAction).filter_by(business_id=project, period="fix").count() == 3
    finally:
        db.close()


def test_a_fix_task_closes_when_the_issue_is_gone_but_not_when_a_source_failed(project, sources):
    sources["issues"] = [issue("a"), issue("b")]
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        gi.sweep(db, b, TODAY)
        sources["issues"] = [issue("a")]
        sources["skipped"] = ["website audits: boom"]
        assert gi.sweep(db, b, TODAY)["closed"] == 0  # a failed source is not "the issue went away"
        assert fix_rows(db, project)["fix.b"].status == "todo"
        sources["skipped"] = []
        assert gi.sweep(db, b, TODAY)["closed"] == 1
        row = fix_rows(db, project)["fix.b"]
        assert row.status == "verified" and row.evidence["passed"] is True
    finally:
        db.close()


def test_fix_tasks_stay_out_of_the_daily_weekly_monthly_lists_and_are_not_failed_when_overdue(project, sources):
    sources["issues"] = [issue("a", "critical")]
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        gi.sweep(db, b, TODAY)
        gp.settle_overdue(db, b, TODAY + timedelta(days=30))
        assert fix_rows(db, project)["fix.a"].status == "todo"  # shown as overdue, never silently failed
        payload = gp.payload(db, b, TODAY)
        assert all(a["key"] != "fix.a" for k in payload["actions"] for a in payload["actions"][k])
        listing = gi.listing(db, b, TODAY + timedelta(days=30))
        assert listing["open"][0]["overdue"] is True and listing["counts"]["critical"] == 1
    finally:
        db.close()


def test_a_persons_click_never_verifies_a_fix_task(project, sources):
    sources["issues"] = [issue("a", verify={"type": "field", "field": "booking_url"})]  # the project has no booking url
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        gi.sweep(db, b, TODAY)
        a = fix_rows(db, project)["fix.a"]
        gp.mark_done(db, b, a, "tester")
        res = gp.verify_action(db, b, a, live=False, today=TODAY)
        assert res["passed"] is False and a.status == "unverified"
        b.booking_url = "https://issues.example/book"
        assert gp.verify_action(db, b, a, live=False, today=TODAY)["passed"] is True and a.status == "verified"
    finally:
        db.close()


# ------------------------------------------------------------------------------------------------------------------- the rules behind each source
def test_a_javascript_built_site_does_not_get_unverified_crawler_findings_as_confirmed(project, monkeypatch):
    class Run:
        status, data_source, finished_at = "done", "live", datetime(2026, 11, 10, tzinfo=timezone.utc)
        issues = [{"code": "javascript_only", "level": "critical", "title": "/ is empty without JavaScript"},
                  {"code": "no_localbusiness_schema", "level": "serious", "title": "No LocalBusiness schema"},
                  {"code": "thin", "level": "warning", "title": "Thin content"}]
    from app.services import audits
    monkeypatch.setattr(audits, "latest", lambda db, b, with_result=True: {"onpage": Run()})
    report = {"rendering": {"js_required": True}, "scores": {"geo": {"checks": [{"key": "org_schema", "passed": True}]}}}
    db = SessionLocal()
    try:
        out = {i["key"]: i for i in gi._audit_issues(db, db.get(Business, project), report)}
        assert out["fix.onpage.javascript_only"]["severity"] == "critical" and out["fix.onpage.javascript_only"]["confidence"] == "confirmed"
        assert "fix.onpage.no_localbusiness_schema" not in out  # the rendered page has it
        assert out["fix.onpage.thin"]["confidence"] == "check_first" and out["fix.onpage.thin"]["severity"] == "info"
    finally:
        db.close()


def test_sample_audits_are_never_a_source(project, monkeypatch):
    class Run:
        status, data_source, finished_at = "done", "sample", None
        issues = [{"code": "x", "level": "critical", "title": "Fake"}]
    from app.services import audits
    monkeypatch.setattr(audits, "latest", lambda db, b, with_result=True: {"onpage": Run(), "technical": Run()})
    db = SessionLocal()
    try:
        assert gi._audit_issues(db, db.get(Business, project), None) == []
    finally:
        db.close()


def test_xray_failures_become_issues_that_land_on_page_xray_with_the_url(project):
    report = {"final_url": "https://issues.example/", "fetched_at": "2026-11-13T00:00:00+00:00",
              "scores": {"seo": {"checks": [{"key": "title", "label": "Title", "passed": False, "weight": 10, "detail": "none"}, {"key": "cert", "passed": False, "weight": 5}]}, "aeo": {"checks": []}, "geo": {"checks": []}},
              "ssl": {"days_left": 9}, "tech": {"security_headers": {"hsts": False, "csp": True}}}
    out = {i["key"]: i for i in gi._xray_issues(report, "https://issues.example/")}
    assert out["fix.xray.title"]["link"].startswith("/page-xray?url=https%3A%2F%2Fissues.example") and out["fix.xray.title"]["severity"] == "serious"
    assert out["fix.security.ssl_expiry"]["severity"] == "critical" and out["fix.security.hsts"]["verify"]["path"] == "tech.security_headers.hsts"
    assert "fix.xray.cert" not in out and "fix.security.csp" not in out


def test_xray_path_verification_reads_the_live_page(project):
    class Ctx:
        def xray(self, url):
            return {"tech": {"security_headers": {"hsts": True}}, "ssl": {"days_left": 5}}
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        ok = gi.verify_rule(db, b, {"type": "xray_path", "url": "u", "path": "tech.security_headers.hsts", "op": "==", "value": True}, Ctx(), TODAY)
        bad = gi.verify_rule(db, b, {"type": "xray_path", "url": "u", "path": "ssl.days_left", "op": ">=", "value": 30}, Ctx(), TODAY)
        none = gi.verify_rule(db, b, {"type": "xray_path", "url": "u", "path": "nope", "op": "==", "value": 1}, Ctx(), TODAY)
        assert ok["passed"] is True and bad["passed"] is False and none["passed"] is None
    finally:
        db.close()


# ------------------------------------------------------------------------------------------------------------------- reports
def snap(db, bid, day, presence, gmb):
    db.add(GrowthSnapshot(business_id=bid, day=day, metrics={"gmb.reviews_total": {"value": gmb, "available": True, "area": "gmb", "source": "t"}}, areas={"gmb": gmb, "seo": 50}, presence=presence, source="daily"))


def test_a_weekly_report_shows_the_real_movement_and_nothing_invented(project, sources):
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        snap(db, project, date(2026, 11, 1), 40, 1)    # before the week of 2 to 8 November
        snap(db, project, date(2026, 11, 8), 46, 4)
        db.commit()
        row = gr.generate(db, b, "week", None, date(2026, 11, 9))
        d = row.data
        assert (d["start"], d["end"]) == ("2026-11-02", "2026-11-08") and d["presence"] == {"start": 40, "end": 46, "delta": 6}
        assert "rose 6 points to 46" in d["headline"]
        assert next(a for a in d["areas"] if a["key"] == "gmb")["delta"] == 3
        assert next(m for m in d["metrics"] if m["key"] == "gmb.reviews_total")["delta"] == 3
        empty = gr.generate(db, b, "week", date(2026, 9, 7), date(2026, 11, 9)).data
        assert empty["presence"]["end"] is not None or "could not be measured" in empty["headline"]
    finally:
        db.close()


def test_a_single_measurement_is_a_level_not_a_movement(project, sources):
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        snap(db, project, date(2026, 11, 5), 47, 1)
        db.commit()
        d = gr.generate(db, b, "week", None, date(2026, 11, 9)).data
        assert d["presence"]["delta"] is None and "no earlier measurement" in d["headline"]
    finally:
        db.close()


def test_reports_are_emailed_once_to_the_registered_address(project, sources, monkeypatch):
    sent = []
    monkeypatch.setattr(notify, "send_email", lambda to, subject, body, attachments=None, html=None, **kw: sent.append((to, subject, body, html)) or True)
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        snap(db, project, date(2026, 10, 20), 40, 1)
        db.commit()
        first = gr.ensure_due(db, b, date(2026, 11, 9))
        assert {m["period"] for m in first} == {"week", "month"} and all(m["sent"] for m in first)
        assert sent[0][0] == "owner@issues.example" and "Weekly growth report" in sent[0][1] and "<html" not in sent[0][3] and "Issues Co" in sent[0][3]
        assert gr.ensure_due(db, b, date(2026, 11, 9)) == []  # nothing new, nothing re-sent
        assert len(sent) == 2 and db.query(GrowthReport).filter_by(business_id=project).count() == 2
    finally:
        db.close()


def test_a_project_not_measured_before_the_window_ended_gets_no_empty_report(project, sources, monkeypatch):
    sent = []
    monkeypatch.setattr(notify, "send_email", lambda *a, **k: sent.append(1) or True)
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        snap(db, project, date(2026, 11, 12), 47, 1)
        db.commit()
        assert gr.ensure_due(db, b, date(2026, 11, 9)) == [] and not sent
    finally:
        db.close()


def test_email_settings_decide_where_and_whether(project, sources, monkeypatch):
    sent = []
    monkeypatch.setattr(notify, "send_email", lambda to, *a, **k: sent.append(to) or True)
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        snap(db, project, date(2026, 10, 20), 40, 1)
        db.commit()
        gr.save_prefs(db, b, {"to": "reports@issues.example", "monthly": False})
        gr.ensure_due(db, b, date(2026, 11, 9))
        assert sent == ["reports@issues.example"]  # weekly only, to the chosen address
        with pytest.raises(ValueError):
            gr.save_prefs(db, b, {"to": "a@b.com\nBcc: x@y.com"})
        with pytest.raises(ValueError):
            gr.save_prefs(db, b, {"to": "not an email"})
    finally:
        db.close()


def test_a_mail_failure_is_recorded_not_raised_and_retried_later(project, sources, monkeypatch):
    def boom(*a, **k):
        raise OSError("smtp down: secret-host")
    monkeypatch.setattr(notify, "send_email", boom)
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        snap(db, project, date(2026, 10, 20), 40, 1)
        db.commit()
        made = gr.ensure_due(db, b, date(2026, 11, 9), ("week",))
        row = db.query(GrowthReport).filter_by(business_id=project, period="week").one()
        assert made[0]["sent"] is False and row.emailed_at is None and "OSError" in row.email_error and "secret-host" not in row.email_error
    finally:
        db.close()


def test_the_critical_alert_goes_out_at_most_once_a_day(project, monkeypatch):
    sent = []
    monkeypatch.setattr(notify, "send_email", lambda to, subject, body, attachments=None, html=None, **kw: sent.append(subject) or True)
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        assert gr.alert_critical(db, b, ["<script>x</script>"], TODAY) is True
        assert gr.alert_critical(db, b, ["another"], TODAY) is False
        assert gr.alert_critical(db, b, ["another"], TODAY + timedelta(days=1)) is True
        assert len(sent) == 2
        gr.save_prefs(db, b, {"alerts": False})
        assert gr.alert_critical(db, b, ["x"], TODAY + timedelta(days=5)) is False
    finally:
        db.close()


def test_report_html_escapes_everything():
    d = {"period": "week", "start": "2026-11-02", "end": "2026-11-08", "business": {"name": "<img src=x onerror=alert(1)>"}, "headline": "<b>h</b>", "narrative": ["<script>a</script>"], "metrics": [],
         "issues": {"top_open": [{"title": "<i>t</i>", "severity": "critical", "due_on": "2026-11-10", "link": "/growth"}]}, "next": {"tasks": [{"title": "<u>n</u>"}]}}
    out = gr.render_html(d)
    assert "<img" not in out and "<script" not in out and "<i>" not in out and "&lt;script&gt;" in out


# ------------------------------------------------------------------------------------------------------------------- the API
def test_the_issue_and_report_endpoints_work_and_stay_scoped(client, project, sources):
    sources["issues"] = [issue("a", "critical")]
    r = client.post(f"/api/v1/businesses/{project}/growth/issues/scan")
    assert r.status_code == 200 and r.json()["counts"]["critical"] == 1
    assert client.get(f"/api/v1/businesses/{project}/growth/issues").json()["open"][0]["link"] == "/website-audit"
    rep = client.post(f"/api/v1/businesses/{project}/growth/reports/generate", json={"period": "week", "current": True})
    assert rep.status_code == 200 and rep.json()["data"]["in_progress"] is True
    rid = rep.json()["id"]
    assert client.get(f"/api/v1/businesses/{project}/growth/reports").json()["reports"][0]["id"] == rid
    html = client.get(f"/api/v1/businesses/{project}/growth/reports/{rid}/html")
    assert html.status_code == 200 and "default-src 'none'" in html.headers["content-security-policy"]
    assert client.get(f"/api/v1/businesses/{project}/growth/reports/999999").status_code == 404
    bad = client.put(f"/api/v1/businesses/{project}/growth/notifications", json={"to": "nope"})
    assert bad.status_code == 422
    ok = client.put(f"/api/v1/businesses/{project}/growth/notifications", json={"weekly": False, "to": "me@issues.example"})
    assert ok.status_code == 200 and ok.json()["weekly"] is False and ok.json()["sends_to"] == "me@issues.example"
    assert client.post(f"/api/v1/businesses/{project}/growth/reports/{rid}/send").json()["sent"] in (True, False)
    assert client.get("/api/v1/businesses/987654/growth/issues").status_code == 404


def test_start_runs_in_the_background_once_and_reports_each_step(client, project, monkeypatch):
    from app.services import growth_start
    started = []
    monkeypatch.setattr(growth_start.threading, "Thread", lambda target, args, daemon, name: type("T", (), {"start": lambda self: started.append(args)})())
    growth_start._runs.pop(project, None)
    r = client.post(f"/api/v1/businesses/{project}/growth/start")
    assert r.status_code == 200 and r.json()["state"] == "running" and [s["key"] for s in r.json()["steps"]][0] == "measure" and started
    assert client.post(f"/api/v1/businesses/{project}/growth/start").status_code == 409  # one run at a time
    assert client.get(f"/api/v1/businesses/{project}/growth/start/status").json()["state"] == "running"
    growth_start._runs.pop(project, None)


def test_a_skipped_issue_stays_skipped_and_is_not_recreated(project, sources):
    sources["issues"] = [issue("a")]
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        gi.sweep(db, b, TODAY)
        a = fix_rows(db, project)["fix.a"]
        gp.skip_action(db, b, a, "We do not offer this", "tester")
        later = TODAY + timedelta(days=3)
        res = gi.sweep(db, b, later)
        assert res["created"] == 0 and res["closed"] == 0
        assert db.query(GrowthAction).filter_by(business_id=project, key="fix.a").count() == 1 and fix_rows(db, project)["fix.a"].status == "skipped"
        assert gi.listing(db, b, later)["open_total"] == 0  # not shown as open work
    finally:
        db.close()


def test_the_report_carries_what_competitor_watch_saw_that_week(project, sources):
    from datetime import datetime, timezone

    from app.backlinks.models import WatchReport
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        snap(db, project, date(2026, 11, 1), 40, 1)
        snap(db, project, date(2026, 11, 8), 46, 4)
        db.add(WatchReport(business_id=project, week_start=date(2026, 11, 2), source="rules", events=3, baseline=False, created_at=datetime.now(timezone.utc),
                           summary={"headline": "Rival Co added 2 new pages", "summary": "Rival Co published two service pages.", "actions": ["Write a page for the same service."], "highlights": ["rival.example: new page /braces"]}))
        db.add(WatchReport(business_id=project, week_start=date(2026, 10, 26), source="rules", events=0, baseline=True, created_at=datetime.now(timezone.utc), summary={"headline": "baseline"}))
        db.commit()
        d = gr.generate(db, b, "week", None, date(2026, 11, 9)).data
        assert d["competitors"]["events"] == 3 and d["competitors"]["weeks"] == 1  # the baseline visit reports no change
        assert any(x.startswith("Competitors: Rival Co added 2 new pages") for x in d["narrative"])
        assert "rival.example: new page /braces" in gr.render_text(d) and "What your competitors did" in gr.render_html(d)
        assert gr.render_pdf(d)[:4] == b"%PDF"
    finally:
        db.close()
