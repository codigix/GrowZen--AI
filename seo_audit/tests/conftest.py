from __future__ import annotations

import copy
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


SAMPLE_LIGHTHOUSE_RESULT = {
    "lighthouseVersion": "13.5.0",
    "requestedUrl": "https://example.com/",
    "finalUrl": "https://example.com/",
    "finalDisplayedUrl": "https://example.com/",
    "fetchTime": "2026-01-01T00:00:00.000Z",
    "userAgent": "Mozilla/5.0",
    "categories": {
        "performance": {
            "id": "performance",
            "title": "Performance",
            "score": 0.93,
            "auditRefs": [
                {"id": "first-contentful-paint", "weight": 10, "group": "metrics"},
                {"id": "largest-contentful-paint", "weight": 25, "group": "metrics"},
                {"id": "speed-index", "weight": 10, "group": "metrics"},
                {"id": "total-blocking-time", "weight": 30, "group": "metrics"},
                {"id": "cumulative-layout-shift", "weight": 15, "group": "metrics"},
                {"id": "render-blocking-resources", "weight": 0, "group": "load-opportunities"},
                {"id": "uses-long-cache-ttl", "weight": 0, "group": "diagnostics"},
                {"id": "unused-javascript", "weight": 0, "group": "diagnostics"},
            ],
        },
        "accessibility": {
            "id": "accessibility",
            "title": "Accessibility",
            "score": 0.88,
            "auditRefs": [
                {"id": "image-alt", "weight": 10, "group": "a11y-names-labels"},
                {"id": "color-contrast", "weight": 3, "group": "a11y-color-contrast"},
            ],
        },
        "best-practices": {
            "id": "best-practices",
            "title": "Best Practices",
            "score": 1.0,
            "auditRefs": [{"id": "is-on-https", "weight": 1}],
        },
        "seo": {
            "id": "seo",
            "title": "SEO",
            "score": 0.75,
            "auditRefs": [
                {"id": "document-title", "weight": 1},
                {"id": "meta-description", "weight": 1},
            ],
        },
    },
    "audits": {
        "first-contentful-paint": {
            "id": "first-contentful-paint", "title": "First Contentful Paint",
            "description": "FCP marks the time...", "score": 0.95,
            "scoreDisplayMode": "numeric", "displayValue": "1.2 s",
            "numericValue": 1200, "numericUnit": "millisecond",
        },
        "largest-contentful-paint": {
            "id": "largest-contentful-paint", "title": "Largest Contentful Paint",
            "description": "LCP marks the time...", "score": 0.9,
            "scoreDisplayMode": "numeric", "displayValue": "1.8 s",
            "numericValue": 1800, "numericUnit": "millisecond",
        },
        "speed-index": {
            "id": "speed-index", "title": "Speed Index", "description": "Speed Index shows...",
            "score": 0.92, "scoreDisplayMode": "numeric", "displayValue": "1.5 s",
            "numericValue": 1500, "numericUnit": "millisecond",
        },
        "total-blocking-time": {
            "id": "total-blocking-time", "title": "Total Blocking Time",
            "description": "Sum of all time periods...", "score": 0.99,
            "scoreDisplayMode": "numeric", "displayValue": "20 ms",
            "numericValue": 20, "numericUnit": "millisecond",
        },
        "cumulative-layout-shift": {
            "id": "cumulative-layout-shift", "title": "Cumulative Layout Shift",
            "description": "CLS measures...", "score": 1.0,
            "scoreDisplayMode": "numeric", "displayValue": "0.001",
            "numericValue": 0.001, "numericUnit": "unitless",
        },
        "render-blocking-resources": {
            "id": "render-blocking-resources", "title": "Eliminate render-blocking resources",
            "description": "Resources are blocking...", "score": 0.4,
            "scoreDisplayMode": "numeric", "displayValue": "Potential savings of 300 ms",
            "details": {"type": "opportunity", "overallSavingsMs": 300, "items": [{"url": "https://example.com/a.css"}]},
        },
        "uses-long-cache-ttl": {
            "id": "uses-long-cache-ttl", "title": "Uses efficient cache policy",
            "description": "A long cache lifetime...", "score": 0.5,
            "scoreDisplayMode": "numeric", "details": {"items": [{"url": "https://example.com/a.js"}]},
        },
        "unused-javascript": {
            "id": "unused-javascript", "title": "Reduce unused JavaScript",
            "description": "Reduce unused JavaScript...", "score": None,
            "scoreDisplayMode": "informative", "details": {"items": []},
        },
        "image-alt": {
            "id": "image-alt", "title": "Image elements have [alt] attributes",
            "description": "Informative elements...", "score": 0, "scoreDisplayMode": "binary",
            "details": {"items": [{"node": {"snippet": "<img src=x>"}}]},
        },
        "color-contrast": {
            "id": "color-contrast", "title": "Background and foreground colors have sufficient contrast",
            "description": "Low-contrast text...", "score": 1, "scoreDisplayMode": "binary",
        },
        "is-on-https": {
            "id": "is-on-https", "title": "Uses HTTPS", "description": "All sites should be protected...",
            "score": 1, "scoreDisplayMode": "binary",
        },
        "document-title": {
            "id": "document-title", "title": "Document has a <title> element",
            "description": "The title gives...", "score": 1, "scoreDisplayMode": "binary",
        },
        "meta-description": {
            "id": "meta-description", "title": "Document has a meta description",
            "description": "Meta descriptions...", "score": 0, "scoreDisplayMode": "binary",
        },
    },
}


def sample_lighthouse_result() -> dict:
    return copy.deepcopy(SAMPLE_LIGHTHOUSE_RESULT)


@pytest.fixture
def lighthouse_result():
    return sample_lighthouse_result()


@pytest.fixture
def app_env(tmp_path, monkeypatch):
    """Point the app at an isolated, temporary SQLite DB and reports dir."""
    db_path = tmp_path / "test_audits.db"
    reports_dir = tmp_path / "reports"
    reports_dir.mkdir()

    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("REPORTS_DIR", str(reports_dir))
    monkeypatch.setenv("PAGESPEED_API_KEY", "test-key")
    monkeypatch.setenv("PAGESPEED_ENABLED", "true")
    monkeypatch.setenv("LOCAL_LIGHTHOUSE_ENABLED", "true")
    monkeypatch.setenv("MAX_CONCURRENT_AUDITS", "2")
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "1000")

    from app.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def fresh_app(app_env):
    """Import a brand-new app.main (and its dependency modules) so the
    FastAPI app, AuditManager and SQLAlchemy engine all pick up the
    environment configured by ``app_env`` instead of state cached from a
    previous test/import.
    """
    for name in list(sys.modules):
        if name == "app" or name.startswith("app."):
            del sys.modules[name]

    import app.main as main_module

    return main_module


@pytest.fixture
def client(fresh_app):
    from starlette.testclient import TestClient

    with TestClient(fresh_app.app) as test_client:
        yield test_client
