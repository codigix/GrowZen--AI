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


def _wait_for_site_terminal_status(client, site_audit_id, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        resp = client.get(f"/api/site-audits/{site_audit_id}")
        data = resp.json()
        if data["status"] in ("completed", "failed"):
            return data
        time.sleep(0.05)
    raise AssertionError("Site audit did not reach a terminal status in time")


def _patch_discovery(monkeypatch, urls):
    import app.api.site_audits as site_audits_api

    async def fake_discover(url, max_pages):
        return urls[:max_pages]

    monkeypatch.setattr(site_audits_api, "discover_site_urls", fake_discover)


def _patch_lighthouse_success(monkeypatch, lighthouse_result):
    import app.audit_engines.lighthouse as lighthouse_engine

    async def fake_run(**kwargs):
        return {"raw_json": lighthouse_result, "json_path": None, "html_path": None}

    monkeypatch.setattr(lighthouse_engine, "run_lighthouse_audit", fake_run)


def test_site_audit_discovers_and_queues_pages(client, monkeypatch, lighthouse_result):
    _patch_discovery(monkeypatch, ["https://example.com/", "https://example.com/about"])
    _patch_lighthouse_success(monkeypatch, lighthouse_result)

    create = client.post(
        "/api/site-audits",
        json={"url": "https://example.com", "strategy": "mobile", "engine": "lighthouse", "max_pages": 10},
    )
    assert create.status_code == 201
    data = create.json()
    assert data["page_count"] == 2
    assert len(data["page_audit_ids"]) == 2

    final = _wait_for_site_terminal_status(client, data["id"])
    assert final["status"] == "completed"
    assert final["completed_count"] == 2
    assert final["failed_count"] == 0

    detail = client.get(f"/api/site-audits/{data['id']}").json()
    assert len(detail["pages"]) == 2
    assert all(p["performance_score"] == 93 for p in detail["pages"])


def test_site_audit_respects_max_pages_cap(client):
    resp = client.post(
        "/api/site-audits",
        json={"url": "https://example.com", "strategy": "mobile", "engine": "lighthouse", "max_pages": 500},
    )
    assert resp.status_code == 422  # exceeds the hard cap


def test_site_audit_discovery_failure_returns_422(client, monkeypatch):
    import app.api.site_audits as site_audits_api
    from app.services.sitemap_service import SitemapDiscoveryError

    async def fake_discover(url, max_pages):
        raise SitemapDiscoveryError("no sitemap found")

    monkeypatch.setattr(site_audits_api, "discover_site_urls", fake_discover)

    resp = client.post(
        "/api/site-audits",
        json={"url": "https://example.com", "strategy": "mobile", "engine": "lighthouse"},
    )
    assert resp.status_code == 422
    assert "no sitemap found" in resp.json()["detail"].lower()


def test_site_audit_ssrf_blocked_url_rejected(client):
    resp = client.post(
        "/api/site-audits",
        json={"url": "http://127.0.0.1/", "strategy": "mobile", "engine": "lighthouse"},
    )
    assert resp.status_code == 400


def test_site_audit_not_found(client):
    resp = client.get("/api/site-audits/does-not-exist")
    assert resp.status_code == 404


def test_site_audit_history(client, monkeypatch, lighthouse_result):
    _patch_discovery(monkeypatch, ["https://example.com/"])
    _patch_lighthouse_success(monkeypatch, lighthouse_result)

    create = client.post(
        "/api/site-audits",
        json={"url": "https://example.com", "strategy": "mobile", "engine": "lighthouse"},
    )
    site_audit_id = create.json()["id"]
    _wait_for_site_terminal_status(client, site_audit_id)

    history = client.get("/api/site-audits/history").json()
    assert history["total"] >= 1
    assert any(item["id"] == site_audit_id for item in history["items"])


def test_site_audit_partial_failure_still_reports_completed(client, monkeypatch, lighthouse_result):
    import app.audit_engines.lighthouse as lighthouse_engine
    from app.audit_engines.errors import EngineExecutionError

    _patch_discovery(monkeypatch, ["https://example.com/ok", "https://example.com/broken"])

    call_count = {"n": 0}

    async def flaky_run(**kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return {"raw_json": lighthouse_result, "json_path": None, "html_path": None}
        raise EngineExecutionError("Chrome crashed")

    monkeypatch.setattr(lighthouse_engine, "run_lighthouse_audit", flaky_run)

    create = client.post(
        "/api/site-audits",
        json={"url": "https://example.com", "strategy": "mobile", "engine": "lighthouse", "max_pages": 2},
    )
    site_audit_id = create.json()["id"]
    final = _wait_for_site_terminal_status(client, site_audit_id)

    assert final["status"] == "completed"
    assert final["completed_count"] == 1
    assert final["failed_count"] == 1
