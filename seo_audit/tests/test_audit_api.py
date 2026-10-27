from __future__ import annotations

import time

import pytest


def _wait_for_terminal_status(client, audit_id, timeout=5):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        resp = client.get(f"/api/audits/{audit_id}")
        data = resp.json()
        if data["status"] in ("completed", "failed"):
            return data
        time.sleep(0.05)
    raise AssertionError("Audit did not reach a terminal status in time")


def _patch_pagespeed_success(monkeypatch, lighthouse_result):
    import app.audit_engines.pagespeed as pagespeed_engine

    async def fake_run(**kwargs):
        return {"lighthouseResult": lighthouse_result, "loadingExperience": {}}

    monkeypatch.setattr(pagespeed_engine, "run_pagespeed_audit", fake_run)
    return pagespeed_engine


def _patch_pagespeed_failure(monkeypatch, message="boom"):
    import app.audit_engines.pagespeed as pagespeed_engine
    from app.audit_engines.errors import EngineExecutionError

    async def fake_run(**kwargs):
        raise EngineExecutionError(message)

    monkeypatch.setattr(pagespeed_engine, "run_pagespeed_audit", fake_run)
    return pagespeed_engine


def _patch_lighthouse_success(monkeypatch, lighthouse_result, tmp_path):
    import app.audit_engines.lighthouse as lighthouse_engine

    json_path = tmp_path / "lh.report.json"
    html_path = tmp_path / "lh.report.html"
    html_path.write_text("<html>original lighthouse report</html>", encoding="utf-8")

    async def fake_run(**kwargs):
        return {"raw_json": lighthouse_result, "json_path": str(json_path), "html_path": str(html_path)}

    import json as json_module

    json_path.write_text(json_module.dumps(lighthouse_result), encoding="utf-8")
    monkeypatch.setattr(lighthouse_engine, "run_lighthouse_audit", fake_run)
    return lighthouse_engine


def test_invalid_url_rejected(client):
    resp = client.post("/api/audits", json={"url": "not-a-url", "strategy": "mobile", "engine": "pagespeed"})
    assert resp.status_code == 422  # pydantic scheme validation


def test_ssrf_blocked_url_rejected(client):
    resp = client.post("/api/audits", json={"url": "http://127.0.0.1:8000/", "strategy": "mobile", "engine": "pagespeed"})
    assert resp.status_code == 400
    assert "disallowed" in resp.json()["detail"].lower()


def test_invalid_strategy_rejected(client):
    resp = client.post("/api/audits", json={"url": "https://example.com", "strategy": "tablet", "engine": "pagespeed"})
    assert resp.status_code == 422


def test_invalid_engine_rejected(client):
    resp = client.post("/api/audits", json={"url": "https://example.com", "strategy": "mobile", "engine": "yolo"})
    assert resp.status_code == 422


def test_audit_not_found(client):
    resp = client.get("/api/audits/does-not-exist")
    assert resp.status_code == 404


def test_pagespeed_audit_completes_and_persists(client, monkeypatch, lighthouse_result):
    _patch_pagespeed_success(monkeypatch, lighthouse_result)

    create = client.post("/api/audits", json={"url": "https://example.com", "strategy": "mobile", "engine": "pagespeed"})
    assert create.status_code == 201
    audit_id = create.json()["id"]
    assert create.json()["status"] in ("queued", "running")

    final = _wait_for_terminal_status(client, audit_id)
    assert final["status"] == "completed"
    assert final["performance_score"] == 93
    assert final["seo_score"] == 75

    report = client.get(f"/api/audits/{audit_id}/report").json()
    assert report["scores"]["performance"] == 93
    assert report["report"]["categories"]["performance"]["score"] == 93

    history = client.get("/api/audits/history").json()
    assert history["total"] >= 1
    assert any(item["id"] == audit_id for item in history["items"])


def test_desktop_strategy_is_recorded(client, monkeypatch, lighthouse_result):
    _patch_pagespeed_success(monkeypatch, lighthouse_result)
    create = client.post("/api/audits", json={"url": "https://example.com", "strategy": "desktop", "engine": "pagespeed"})
    audit_id = create.json()["id"]
    _wait_for_terminal_status(client, audit_id)
    data = client.get(f"/api/audits/{audit_id}").json()
    assert data["strategy"] == "desktop"


def test_pagespeed_engine_failure_marks_audit_failed(client, monkeypatch):
    # Disable the local-Lighthouse fallback for this test so a PageSpeed
    # failure surfaces directly as a failed audit (fallback behavior is
    # covered separately by test_pagespeed_failure_falls_back_to_lighthouse).
    client.app.state.audit_manager.settings.local_lighthouse_enabled = False
    _patch_pagespeed_failure(monkeypatch, "PageSpeed Insights quota exceeded")
    create = client.post("/api/audits", json={"url": "https://example.com", "strategy": "mobile", "engine": "pagespeed"})
    audit_id = create.json()["id"]
    final = _wait_for_terminal_status(client, audit_id)
    assert final["status"] == "failed"
    assert "quota" in final["error_message"].lower()


def test_lighthouse_engine_success_serves_original_html(client, monkeypatch, lighthouse_result, tmp_path):
    _patch_lighthouse_success(monkeypatch, lighthouse_result, tmp_path)
    create = client.post("/api/audits", json={"url": "https://example.com", "strategy": "mobile", "engine": "lighthouse"})
    audit_id = create.json()["id"]
    final = _wait_for_terminal_status(client, audit_id)
    assert final["status"] == "completed"

    report = client.get(f"/api/audits/{audit_id}/report").json()
    assert report["html_report_is_original"] is True

    html_resp = client.get(f"/api/audits/{audit_id}/download/html")
    assert html_resp.status_code == 200
    assert "original lighthouse report" in html_resp.text

    json_resp = client.get(f"/api/audits/{audit_id}/download/json")
    assert json_resp.status_code == 200


def test_pagespeed_download_html_is_generated_summary(client, monkeypatch, lighthouse_result):
    _patch_pagespeed_success(monkeypatch, lighthouse_result)
    create = client.post("/api/audits", json={"url": "https://example.com", "strategy": "mobile", "engine": "pagespeed"})
    audit_id = create.json()["id"]
    _wait_for_terminal_status(client, audit_id)

    html_resp = client.get(f"/api/audits/{audit_id}/download/html")
    assert html_resp.status_code == 200
    assert "not the original Lighthouse-generated HTML report" in html_resp.text


def test_download_missing_report_returns_404(client, monkeypatch):
    client.app.state.audit_manager.settings.local_lighthouse_enabled = False
    _patch_pagespeed_failure(monkeypatch, "simulated failure, no report produced")
    create = client.post("/api/audits", json={"url": "https://example.com", "strategy": "mobile", "engine": "pagespeed"})
    audit_id = create.json()["id"]
    _wait_for_terminal_status(client, audit_id)
    resp = client.get(f"/api/audits/{audit_id}/download/json")
    assert resp.status_code == 404


def test_duplicate_request_returns_existing_audit(client, monkeypatch, lighthouse_result):
    # Patch with a slow fake so the first audit is still queued/running when
    # the duplicate request arrives.
    import asyncio

    import app.audit_engines.pagespeed as pagespeed_engine

    async def slow_run(**kwargs):
        await asyncio.sleep(1)
        return {"lighthouseResult": lighthouse_result, "loadingExperience": {}}

    monkeypatch.setattr(pagespeed_engine, "run_pagespeed_audit", slow_run)

    first = client.post("/api/audits", json={"url": "https://example.com/dup", "strategy": "mobile", "engine": "pagespeed"})
    second = client.post("/api/audits", json={"url": "https://example.com/dup", "strategy": "mobile", "engine": "pagespeed"})
    assert first.json()["id"] == second.json()["id"]


def test_pagespeed_failure_falls_back_to_lighthouse(client, monkeypatch, lighthouse_result, tmp_path):
    _patch_pagespeed_failure(monkeypatch, "PageSpeed Insights API error (403): blocked")
    _patch_lighthouse_success(monkeypatch, lighthouse_result, tmp_path)

    create = client.post("/api/audits", json={"url": "https://example.com", "strategy": "mobile", "engine": "pagespeed"})
    audit_id = create.json()["id"]
    final = _wait_for_terminal_status(client, audit_id)

    assert final["status"] == "completed"
    assert final["engine"] == "pagespeed"
    assert final["engine_used"] == "lighthouse"
    assert "fell back" in final["fallback_reason"]
    assert final["performance_score"] == 93

    report = client.get(f"/api/audits/{audit_id}/report").json()
    assert report["html_report_is_original"] is True


def test_pagespeed_and_lighthouse_both_fail_reports_combined_error(client, monkeypatch):
    import app.audit_engines.lighthouse as lighthouse_engine
    from app.audit_engines.errors import EngineExecutionError

    _patch_pagespeed_failure(monkeypatch, "PageSpeed Insights quota exceeded")

    async def fake_lighthouse_fail(**kwargs):
        raise EngineExecutionError("Chrome could not be launched")

    monkeypatch.setattr(lighthouse_engine, "run_lighthouse_audit", fake_lighthouse_fail)

    create = client.post("/api/audits", json={"url": "https://example.com", "strategy": "mobile", "engine": "pagespeed"})
    audit_id = create.json()["id"]
    final = _wait_for_terminal_status(client, audit_id)

    assert final["status"] == "failed"
    assert "quota exceeded" in final["error_message"].lower()
    assert "chrome could not be launched" in final["error_message"].lower()


def test_health_endpoint_does_not_leak_secret(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert "pagespeed_configured" in data
    assert "PAGESPEED_API_KEY" not in str(data)
    assert "test-key" not in str(data)


def test_dashboard_served_at_root(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert "Website Audit Dashboard" in resp.text
