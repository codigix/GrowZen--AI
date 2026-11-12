"""GBP reports: the month vs the previous one, a six-month trend, emailing the PDF and the send history."""
from app.config import get_settings
from app.routers import gbp_reports as g


def _project(client, **extra):
    r = client.post("/api/v1/businesses", json={"name": "Asha Rentals", "city": "Pune", **extra})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_month_helpers():
    assert g._shift("2026-03", 0) == "2026-03" and g._shift("2026-03", 3) == "2025-12" and g._shift("2026-01", 1) == "2025-12"


def test_overview_has_the_month_a_six_month_trend_and_no_ai_call(client, monkeypatch):
    from app.services import ai
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete", lambda *a, **k: (_ for _ in ()).throw(AssertionError("the overview must not call AI")))
    bid = _project(client)
    d = client.get(f"/api/v1/businesses/{bid}/gbp/reports/overview", params={"month": "2026-11"}).json()
    assert d["summary"]["month"] == "2026-11" and set(d["summary"]["insights"]) == {"calls", "directions", "website_clicks", "views"}
    assert [t["month"] for t in d["trend"]] == ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]
    assert d["history"] == [] and "plain_words" in d["summary"] and isinstance(d["can_email"], bool)
    assert client.get(f"/api/v1/businesses/{bid}/gbp/reports/overview", params={"month": "11-2026"}).status_code == 422


def test_ai_summary_is_a_separate_call(client, monkeypatch):
    from app.services import ai
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete", lambda *a, **k: "A friendly summary.")
    bid = _project(client)
    assert client.get(f"/api/v1/businesses/{bid}/gbp/reports/summary").json()["plain_words"] == "A friendly summary."


def test_send_the_report_by_email(client, monkeypatch):
    bid = _project(client, contact_email="owner@asha.in")
    url = f"/api/v1/businesses/{bid}/gbp/reports/send"
    s = get_settings()
    monkeypatch.setattr(s, "smtp_host", "")
    assert client.post(url, json={}).status_code == 503  # email not set up
    monkeypatch.setattr(s, "smtp_host", "smtp.test")
    monkeypatch.setattr(s, "smtp_from", "reports@test.in")
    sent = []
    monkeypatch.setattr(g, "send_email", lambda to, subject, body, attachments=None: sent.append((to, subject, [a[0] for a in attachments])) or True)
    assert client.post(url, json={"to": "not an email"}).status_code == 422
    r = client.post(url, json={"month": "2026-10"})  # no address given: the project's contact email
    assert r.status_code == 200 and r.json() == {"sent": True, "to": "owner@asha.in"}
    assert sent[-1][0] == "owner@asha.in" and "2026-10" in sent[-1][1] and sent[-1][2] == ["Asha Rentals-2026-10.pdf"]
    h = client.get(f"/api/v1/businesses/{bid}/gbp/reports/overview").json()["history"]
    assert h and h[0]["to"] == "owner@asha.in" and h[0]["month"] == "2026-10" and h[0]["emailed"]
    monkeypatch.setattr(g, "send_email", lambda *a, **k: (_ for _ in ()).throw(OSError("connection refused")))
    assert client.post(url, json={}).status_code == 502


def test_reports_are_private(client):
    from test_security import login, user
    user("gr1@x.in", "editor")
    user("gr2@x.in", "editor")
    a, _ = login("gr1@x.in")
    o, _ = login("gr2@x.in")
    bid = a.post("/api/v1/businesses", json={"name": "Mine Co"}).json()["id"]
    assert a.get(f"/api/v1/businesses/{bid}/gbp/reports/overview").status_code == 200
    assert o.get(f"/api/v1/businesses/{bid}/gbp/reports/overview").status_code == 404
    assert o.post(f"/api/v1/businesses/{bid}/gbp/reports/send", json={}).status_code == 404
