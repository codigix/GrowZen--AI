"""Lighthouse audits: SSRF checks, both engines, report normalisation, sitemap discovery, and the
API end to end (fallback, duplicates, downloads, site audits). DNS and HTTP are faked: no network."""
import copy
import ipaddress
import json
import os
import socket
import subprocess
import time
from collections import defaultdict, deque

import httpx
import pytest

from app.audit import lighthouse, lighthouse_report, pagespeed, url_safety
from app.audit.sitemap import SitemapDiscoveryError, discover_site_urls
from app.audit.url_safety import SSRFValidationError, resolve_and_validate, validate_url_shape
from app.config import get_settings

PUBLIC_IP = "93.184.215.14"

LIGHTHOUSE_RESULT = {
    "lighthouseVersion": "13.5.0",
    "requestedUrl": "https://example.com/", "finalUrl": "https://example.com/", "finalDisplayedUrl": "https://example.com/",
    "fetchTime": "2026-01-01T00:00:00.000Z", "userAgent": "Mozilla/5.0",
    "categories": {
        "performance": {"id": "performance", "title": "Performance", "score": 0.93, "auditRefs": [
            {"id": "first-contentful-paint", "weight": 10, "group": "metrics"},
            {"id": "largest-contentful-paint", "weight": 25, "group": "metrics"},
            {"id": "speed-index", "weight": 10, "group": "metrics"},
            {"id": "total-blocking-time", "weight": 30, "group": "metrics"},
            {"id": "cumulative-layout-shift", "weight": 15, "group": "metrics"},
            {"id": "render-blocking-resources", "weight": 0, "group": "load-opportunities"},
            {"id": "uses-long-cache-ttl", "weight": 0, "group": "diagnostics"},
            {"id": "unused-javascript", "weight": 0, "group": "diagnostics"}]},
        "accessibility": {"id": "accessibility", "title": "Accessibility", "score": 0.88, "auditRefs": [
            {"id": "image-alt", "weight": 10, "group": "a11y-names-labels"},
            {"id": "color-contrast", "weight": 3, "group": "a11y-color-contrast"}]},
        "best-practices": {"id": "best-practices", "title": "Best Practices", "score": 1.0, "auditRefs": [{"id": "is-on-https", "weight": 1}]},
        "seo": {"id": "seo", "title": "SEO", "score": 0.75, "auditRefs": [{"id": "document-title", "weight": 1}, {"id": "meta-description", "weight": 1}]},
    },
    "audits": {
        "first-contentful-paint": {"id": "first-contentful-paint", "title": "First Contentful Paint", "description": "FCP marks the time...", "score": 0.95,
                                   "scoreDisplayMode": "numeric", "displayValue": "1.2 s", "numericValue": 1200, "numericUnit": "millisecond"},
        "largest-contentful-paint": {"id": "largest-contentful-paint", "title": "Largest Contentful Paint", "description": "LCP marks the time...", "score": 0.9,
                                     "scoreDisplayMode": "numeric", "displayValue": "1.8 s", "numericValue": 1800, "numericUnit": "millisecond"},
        "speed-index": {"id": "speed-index", "title": "Speed Index", "description": "Speed Index shows...", "score": 0.92,
                        "scoreDisplayMode": "numeric", "displayValue": "1.5 s", "numericValue": 1500, "numericUnit": "millisecond"},
        "total-blocking-time": {"id": "total-blocking-time", "title": "Total Blocking Time", "description": "Sum of all time periods...", "score": 0.99,
                                "scoreDisplayMode": "numeric", "displayValue": "20 ms", "numericValue": 20, "numericUnit": "millisecond"},
        "cumulative-layout-shift": {"id": "cumulative-layout-shift", "title": "Cumulative Layout Shift", "description": "CLS measures...", "score": 1.0,
                                    "scoreDisplayMode": "numeric", "displayValue": "0.001", "numericValue": 0.001, "numericUnit": "unitless"},
        "render-blocking-resources": {"id": "render-blocking-resources", "title": "Eliminate render-blocking resources", "description": "Resources are blocking...",
                                      "score": 0.4, "scoreDisplayMode": "numeric", "displayValue": "Potential savings of 300 ms",
                                      "details": {"type": "opportunity", "overallSavingsMs": 300, "items": [{"url": "https://example.com/a.css"}]}},
        "uses-long-cache-ttl": {"id": "uses-long-cache-ttl", "title": "Uses efficient cache policy", "description": "A long cache lifetime...", "score": 0.5,
                                "scoreDisplayMode": "numeric", "details": {"items": [{"url": "https://example.com/a.js"}]}},
        "unused-javascript": {"id": "unused-javascript", "title": "Reduce unused JavaScript", "description": "Reduce unused JavaScript...", "score": None,
                              "scoreDisplayMode": "informative", "details": {"items": []}},
        "image-alt": {"id": "image-alt", "title": "Image elements have [alt] attributes", "description": "Informative elements...", "score": 0,
                      "scoreDisplayMode": "binary", "details": {"items": [{"node": {"snippet": "<img src=x>"}}]}},
        "color-contrast": {"id": "color-contrast", "title": "Background and foreground colors have sufficient contrast", "description": "Low-contrast text...",
                           "score": 1, "scoreDisplayMode": "binary"},
        "is-on-https": {"id": "is-on-https", "title": "Uses HTTPS", "description": "All sites should be protected...", "score": 1, "scoreDisplayMode": "binary"},
        "document-title": {"id": "document-title", "title": "Document has a <title> element", "description": "The title gives...", "score": 1, "scoreDisplayMode": "binary"},
        "meta-description": {"id": "meta-description", "title": "Document has a meta description", "description": "Meta descriptions...", "score": 0, "scoreDisplayMode": "binary"},
    },
}


@pytest.fixture()
def result():
    return copy.deepcopy(LIGHTHOUSE_RESULT)


@pytest.fixture(autouse=True)
def fake_dns(monkeypatch):
    """IP literals resolve to themselves, localhost to loopback, *.invalid fails, rebind.test has a
    private address among public ones, every other name is public."""
    def getaddrinfo(host, port, *args, **kwargs):
        host = host.strip("[]")
        if host.endswith(".invalid"):
            raise socket.gaierror("not found")
        ips = {"localhost": ["127.0.0.1"], "rebind.test": [PUBLIC_IP, "10.0.0.7"]}.get(host)
        if ips is None:
            try:
                ips = [str(ipaddress.ip_address(host))]
            except ValueError:
                ips = [PUBLIC_IP]
        return [(socket.AF_INET6 if ":" in ip else socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port)) for ip in ips]
    monkeypatch.setattr(url_safety.socket, "getaddrinfo", getaddrinfo)


@pytest.fixture()
def lh(client, monkeypatch, tmp_path):
    """API client with both engines on and a PageSpeed key."""
    s = get_settings()
    monkeypatch.setattr(s, "pagespeed_api_key", "test-key")
    monkeypatch.setattr(s, "lighthouse_pagespeed_enabled", True)
    monkeypatch.setattr(s, "lighthouse_local_enabled", True)
    monkeypatch.setattr(s, "lighthouse_reports_dir", str(tmp_path / "reports"))
    return client


def psi_ok(monkeypatch, result, delay=0.0):
    def fake(url, strategy="mobile", timeout=90):
        time.sleep(delay)
        return {"lighthouseResult": result, "loadingExperience": {}}
    monkeypatch.setattr(pagespeed, "fetch", fake)


def psi_fails(monkeypatch, message="boom"):
    def fake(url, strategy="mobile", timeout=90):
        raise pagespeed.PageSpeedError(message)
    monkeypatch.setattr(pagespeed, "fetch", fake)


def local_ok(monkeypatch, result, tmp_path):
    json_path, html_path = tmp_path / "lh.report.json", tmp_path / "lh.report.html"
    json_path.write_text(json.dumps(result), encoding="utf-8")
    html_path.write_text("<html>original lighthouse report</html>", encoding="utf-8")
    monkeypatch.setattr(lighthouse, "run_audit", lambda **kw: {"raw_json": result, "json_path": str(json_path), "html_path": str(html_path)})


def local_fails(monkeypatch, message):
    def fake(**kw):
        raise lighthouse.LighthouseError(message)
    monkeypatch.setattr(lighthouse, "run_audit", fake)


def wait(c, path, timeout=5):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        data = c.get(path).json()
        if data["status"] in ("completed", "failed"):
            return data
        time.sleep(0.05)
    raise AssertionError(f"{path} did not finish in time")


def start(c, url="https://example.com", strategy="mobile", engine="pagespeed"):
    r = c.post("/api/v1/lighthouse/audits", json={"url": url, "strategy": strategy, "engine": engine})
    assert r.status_code == 201, r.text
    return r.json()["id"]


# URL / SSRF checks
@pytest.mark.parametrize("url", ["ftp://example.com", "javascript:alert(1)", "https://", "https://user:pass@example.com", "https://example.com/" + "a" * 3000])
def test_url_shape_rejected(url):
    with pytest.raises(SSRFValidationError):
        validate_url_shape(url)


def test_url_shape_accepted():
    assert validate_url_shape("https://example.com/path?q=1") == "https://example.com/path?q=1"
    assert validate_url_shape("  https://example.com  ") == "https://example.com"


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254", "10.0.0.5", "172.16.0.5", "192.168.1.1", "100.64.1.1", "[::1]", "rebind.test"])
def test_internal_hosts_blocked(host):
    with pytest.raises(SSRFValidationError):
        resolve_and_validate(f"http://{host}/")


def test_unresolvable_host_blocked():
    with pytest.raises(SSRFValidationError, match="resolve"):
        resolve_and_validate("http://no-such-host.invalid/")


def test_public_host_resolved():
    v = resolve_and_validate("https://example.com/")
    assert v.hostname == "example.com" and v.port == 443 and v.resolved_ips == (PUBLIC_IP,)


def test_safe_transport_pins_ip_and_keeps_host():
    seen = {}

    class Recorder(url_safety.SSRFSafeTransport):
        def handle_request(self, request):
            url_safety._pin(request)
            seen.update(host=request.url.host, header=request.headers["Host"], sni=request.extensions["sni_hostname"])
            return httpx.Response(200)

    httpx.Client(transport=Recorder()).get("https://example.com/x")
    assert seen == {"host": PUBLIC_IP, "header": "example.com", "sni": "example.com"}
    with pytest.raises(SSRFValidationError):
        httpx.Client(transport=Recorder()).get("http://127.0.0.1/")


# PageSpeed Insights
def _psi_response(monkeypatch, response=None, exc=None):
    def fake_get(*a, **kw):
        if exc:
            raise exc
        return response
    monkeypatch.setattr(pagespeed.httpx, "get", fake_get)


def test_psi_fetch_success(monkeypatch, result):
    _psi_response(monkeypatch, httpx.Response(200, json={"lighthouseResult": result}))
    assert pagespeed.fetch("https://example.com")["lighthouseResult"]["requestedUrl"] == "https://example.com/"


@pytest.mark.parametrize("status,body", [(429, {"error": {"message": "slow down"}}),
                                         (403, {"error": {"message": "Quota exceeded for quota metric", "status": "RESOURCE_EXHAUSTED"}})])
def test_psi_fetch_quota(monkeypatch, status, body):
    _psi_response(monkeypatch, httpx.Response(status, json=body))
    with pytest.raises(pagespeed.PageSpeedQuotaError):
        pagespeed.fetch("https://example.com")


def test_psi_fetch_errors(monkeypatch):
    _psi_response(monkeypatch, httpx.Response(400, json={"error": {"message": "Invalid URL"}}))
    with pytest.raises(pagespeed.PageSpeedError, match="Invalid URL"):
        pagespeed.fetch("https://example.com")
    _psi_response(monkeypatch, exc=httpx.ReadTimeout("timed out"))
    with pytest.raises(pagespeed.PageSpeedTimeoutError):
        pagespeed.fetch("https://example.com", timeout=1)
    _psi_response(monkeypatch, httpx.Response(200, json={"captchaResult": "blocked"}))
    with pytest.raises(pagespeed.PageSpeedError, match="no Lighthouse result"):
        pagespeed.fetch("https://example.com")


# Local Lighthouse CLI
def test_cli_missing_without_node(monkeypatch):
    monkeypatch.setattr(lighthouse.shutil, "which", lambda name: None)
    assert lighthouse.resolve_cli() is None and not lighthouse.is_available()


def test_run_audit_not_configured(monkeypatch, tmp_path):
    monkeypatch.setattr(lighthouse, "resolve_cli", lambda: None)
    with pytest.raises(lighthouse.LighthouseNotConfiguredError):
        lighthouse.run_audit(url="https://example.com", strategy="mobile", timeout_seconds=5, reports_dir=tmp_path, audit_id=1)


class FakeProcess:
    def __init__(self, returncode=0, stderr=b"", timeout=False):
        self.returncode, self.stderr, self.timeout, self.killed = returncode, stderr, timeout, False

    def communicate(self, timeout=None):
        if self.timeout and not self.killed:
            raise subprocess.TimeoutExpired(cmd="lighthouse", timeout=timeout)
        return b"", self.stderr

    def kill(self):
        self.killed = True


@pytest.fixture()
def fake_cli(monkeypatch):
    monkeypatch.setattr(lighthouse, "resolve_cli", lambda: lighthouse.LighthouseCli(node_path="node", cli_js_path="cli.js"))


def test_run_audit_process_failure(monkeypatch, tmp_path, fake_cli):
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **kw: FakeProcess(returncode=1, stderr=b"Chrome could not be found"))
    with pytest.raises(lighthouse.LighthouseError, match="Chrome could not be found"):
        lighthouse.run_audit(url="https://example.com", strategy="mobile", timeout_seconds=5, reports_dir=tmp_path, audit_id=1)


def test_run_audit_timeout_kills_process(monkeypatch, tmp_path, fake_cli):
    proc = FakeProcess(timeout=True)
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **kw: proc)
    with pytest.raises(lighthouse.LighthouseTimeoutError):
        lighthouse.run_audit(url="https://example.com", strategy="mobile", timeout_seconds=0.05, reports_dir=tmp_path, audit_id=1)
    assert proc.killed


def test_run_audit_args_and_runtime_error(monkeypatch, tmp_path, fake_cli):
    seen = {}

    def popen(args, *rest, **kw):
        seen["args"] = args
        base = next(a.split("=", 1)[1] for a in args if a.startswith("--output-path="))
        with open(base + ".report.json", "w", encoding="utf-8") as f:
            f.write('{"runtimeError": {"code": "ERRORED_DOCUMENT_REQUEST", "message": "Request to the root page failed (403)"}}')
        return FakeProcess()

    monkeypatch.setattr(subprocess, "Popen", popen)
    v = resolve_and_validate("https://example.com/")
    with pytest.raises(lighthouse.LighthouseError, match="bot/WAF protection"):
        lighthouse.run_audit(url=v.url, strategy="desktop", timeout_seconds=5, reports_dir=tmp_path, audit_id=1, validated=v)
    args = seen["args"]
    assert args[:3] == ["node", "cli.js", "https://example.com/"]  # argv list, never a shell string
    assert "--preset=desktop" in args
    assert any(f"--host-resolver-rules=MAP example.com {PUBLIC_IP}" in a for a in args)  # DNS pinned


def test_live_lighthouse_audit(tmp_path):
    """Real Node + Lighthouse + Chrome against example.com. Opt in with RUN_LIVE_TESTS=1."""
    if os.environ.get("RUN_LIVE_TESTS") != "1":
        pytest.skip("Set RUN_LIVE_TESTS=1 to run the live Lighthouse test")
    if not lighthouse.is_available():
        pytest.skip("Local Lighthouse CLI is not installed")
    out = lighthouse.run_audit(url="https://example.com", strategy="mobile", timeout_seconds=120, reports_dir=tmp_path, audit_id="live")
    assert "categories" in out["raw_json"]


# Report normalisation
def test_normalize_scores_and_metrics(result):
    n = lighthouse_report.normalize_report(result)
    assert lighthouse_report.extract_scores(n) == {"performance": 93, "accessibility": 88, "best_practices": 100, "seo": 75}
    assert n["metrics"]["first-contentful-paint"]["display_value"] == "1.2 s"
    assert n["metrics"]["cumulative-layout-shift"]["numeric_value"] == 0.001


def test_normalize_classifies_audits(result):
    by = lighthouse_report.normalize_report(result)["audits_by_category"]
    ids = lambda cat, bucket: {a["id"] for a in by[cat][bucket]}  # noqa: E731
    assert "render-blocking-resources" in ids("performance", "opportunities")
    assert "uses-long-cache-ttl" in ids("performance", "diagnostics")
    assert "unused-javascript" in ids("performance", "informational")
    assert "image-alt" in ids("accessibility", "failed") and "color-contrast" in ids("accessibility", "passed")
    assert "meta-description" in ids("seo", "failed") and "document-title" in ids("seo", "passed")


def test_normalize_missing_scores_are_none_not_zero():
    n = lighthouse_report.normalize_report({"categories": {"performance": {"id": "performance", "title": "Performance", "score": None, "auditRefs": []}}, "audits": {}})
    scores = lighthouse_report.extract_scores(n)
    assert scores["performance"] is None and scores["accessibility"] is None
    assert lighthouse_report.normalize_report({"categories": {}, "audits": {}})["metrics"] == {}


def test_normalize_crux_field_data(result):
    n = lighthouse_report.normalize_report(result, field_data={"overall_category": "FAST", "metrics": {"LARGEST_CONTENTFUL_PAINT_MS": {"category": "FAST", "percentile": 1500}}})
    assert n["field_data"]["overall_category"] == "FAST"
    assert n["field_data"]["metrics"]["largest-contentful-paint"]["percentile"] == 1500


def test_summary_html_says_it_is_not_original(result):
    html = lighthouse_report.render_summary_html(lighthouse_report.normalize_report(result), {"url": "https://example.com", "strategy": "mobile", "engine": "pagespeed", "completed_at": None})
    assert "generated summary report" in html and "not the original Lighthouse-generated HTML report" in html and "example.com" in html


# Sitemap discovery
URLSET = b"""<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://example.com/</loc></url><url><loc>https://example.com/about</loc></url>
<url><loc>https://example.com/contact</loc></url><url><loc>https://not-example.com/evil</loc></url></urlset>"""
INDEX = b"""<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap></sitemapindex>"""


def site(pages: dict[str, bytes]) -> httpx.Client:
    """A plain client serving `pages` (path -> body); 404 for anything else. (The real SSRF-safe
    transport is covered above.)"""
    return httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=pages[r.url.path]) if r.url.path in pages else httpx.Response(404)))


def test_sitemap_urlset_same_host_only():
    urls = discover_site_urls("https://example.com/", 10, client=site({"/sitemap.xml": URLSET}))
    assert urls == ["https://example.com/", "https://example.com/about", "https://example.com/contact"]


def test_sitemap_max_pages():
    assert len(discover_site_urls("https://example.com/", 2, client=site({"/sitemap.xml": URLSET}))) == 2


def test_sitemap_follows_index_and_robots():
    assert "https://example.com/about" in discover_site_urls("https://example.com/", 10, client=site({"/sitemap.xml": INDEX, "/sitemap-pages.xml": URLSET}))
    robots = b"User-agent: *\nSitemap: https://example.com/custom-sitemap.xml\n"
    assert "https://example.com/contact" in discover_site_urls("https://example.com/", 10, client=site({"/robots.txt": robots, "/custom-sitemap.xml": URLSET}))


def test_sitemap_nothing_found():
    with pytest.raises(SitemapDiscoveryError):
        discover_site_urls("https://example.com/", 10, client=site({}))


def test_sitemap_refuses_internal_target():
    with pytest.raises(SSRFValidationError):
        discover_site_urls("http://127.0.0.1/", 10)


# API
def test_needs_login():
    from fastapi.testclient import TestClient

    from app.main import app
    assert TestClient(app).post("/api/v1/lighthouse/audits", json={"url": "https://example.com"}).status_code == 401


@pytest.mark.parametrize("body", [{"url": "not-a-url"}, {"url": "https://example.com", "strategy": "tablet"}, {"url": "https://example.com", "engine": "yolo"}])
def test_invalid_request_422(lh, body):
    assert lh.post("/api/v1/lighthouse/audits", json=body).status_code == 422


def test_ssrf_target_400(lh):
    r = lh.post("/api/v1/lighthouse/audits", json={"url": "http://127.0.0.1:8000/", "engine": "pagespeed"})
    assert r.status_code == 400 and "disallowed" in r.json()["detail"].lower()


def test_audit_not_found(lh):
    assert lh.get("/api/v1/lighthouse/audits/999999").status_code == 404


def test_pagespeed_audit_completes(lh, monkeypatch, result):
    psi_ok(monkeypatch, result)
    aid = start(lh, strategy="desktop")
    final = wait(lh, f"/api/v1/lighthouse/audits/{aid}")
    assert final["status"] == "completed" and final["performance_score"] == 93 and final["seo_score"] == 75
    assert final["strategy"] == "desktop" and final["engine_used"] == "pagespeed"
    assert "raw_json_path" not in final and "report" not in final  # internals stay out of summaries

    report = lh.get(f"/api/v1/lighthouse/audits/{aid}/report").json()
    assert report["scores"]["performance"] == 93 and report["report"]["categories"]["performance"]["score"] == 93
    assert report["has_raw_json"] and report["has_html_report"] and not report["html_report_is_original"]

    assert lh.get(f"/api/v1/lighthouse/audits/{aid}/download/json").json()["lighthouseResult"]["lighthouseVersion"] == "13.5.0"
    html = lh.get(f"/api/v1/lighthouse/audits/{aid}/download/html")
    assert html.status_code == 200 and "not the original Lighthouse-generated HTML report" in html.text

    history = lh.get("/api/v1/lighthouse/audits/history?page_size=100").json()
    assert history["total"] >= 1 and any(i["id"] == aid for i in history["items"])


def test_local_audit_serves_original_html(lh, monkeypatch, result, tmp_path):
    local_ok(monkeypatch, result, tmp_path)
    aid = start(lh, url="https://example.com/local", engine="lighthouse")
    assert wait(lh, f"/api/v1/lighthouse/audits/{aid}")["status"] == "completed"
    assert lh.get(f"/api/v1/lighthouse/audits/{aid}/report").json()["html_report_is_original"] is True
    assert "original lighthouse report" in lh.get(f"/api/v1/lighthouse/audits/{aid}/download/html").text
    assert lh.get(f"/api/v1/lighthouse/audits/{aid}/download/json").status_code == 200


def test_pagespeed_failure_without_fallback(lh, monkeypatch):
    monkeypatch.setattr(get_settings(), "lighthouse_local_enabled", False)
    psi_fails(monkeypatch, "PageSpeed quota used up")
    aid = start(lh, url="https://example.com/nofallback")
    final = wait(lh, f"/api/v1/lighthouse/audits/{aid}")
    assert final["status"] == "failed" and "quota" in final["error_message"].lower()
    assert lh.get(f"/api/v1/lighthouse/audits/{aid}/download/json").status_code == 404
    assert lh.get(f"/api/v1/lighthouse/audits/{aid}/download/html").status_code == 404


def test_pagespeed_not_configured_falls_back(lh, monkeypatch, result, tmp_path):
    monkeypatch.setattr(get_settings(), "pagespeed_api_key", "")
    local_ok(monkeypatch, result, tmp_path)
    aid = start(lh, url="https://example.com/nokey")
    final = wait(lh, f"/api/v1/lighthouse/audits/{aid}")
    assert final["status"] == "completed" and final["engine_used"] == "lighthouse" and "not configured" in final["fallback_reason"]


def test_pagespeed_failure_falls_back_to_local(lh, monkeypatch, result, tmp_path):
    psi_fails(monkeypatch, "PageSpeed Insights error (403): blocked")
    local_ok(monkeypatch, result, tmp_path)
    aid = start(lh, url="https://example.com/fallback")
    final = wait(lh, f"/api/v1/lighthouse/audits/{aid}")
    assert final["status"] == "completed" and final["engine"] == "pagespeed" and final["engine_used"] == "lighthouse"
    assert "fell back" in final["fallback_reason"] and final["performance_score"] == 93
    assert lh.get(f"/api/v1/lighthouse/audits/{aid}/report").json()["html_report_is_original"] is True


def test_both_engines_fail(lh, monkeypatch):
    psi_fails(monkeypatch, "PageSpeed quota used up")
    local_fails(monkeypatch, "Chrome could not be launched")
    final = wait(lh, f"/api/v1/lighthouse/audits/{start(lh, url='https://example.com/bothfail')}")
    assert final["status"] == "failed"
    assert "quota used up" in final["error_message"].lower() and "chrome could not be launched" in final["error_message"].lower()


def test_duplicate_request_returns_running_audit(lh, monkeypatch, result):
    psi_ok(monkeypatch, result, delay=1)
    first = start(lh, url="https://example.com/dup")
    assert start(lh, url="https://example.com/dup") == first
    assert start(lh, url="https://example.com/dup", strategy="desktop") != first
    wait(lh, f"/api/v1/lighthouse/audits/{first}")


def test_rerun_makes_a_new_audit(lh, monkeypatch, result):
    psi_ok(monkeypatch, result)
    aid = start(lh, url="https://example.com/rerun")
    wait(lh, f"/api/v1/lighthouse/audits/{aid}")
    r = lh.post(f"/api/v1/lighthouse/audits/{aid}/rerun")
    assert r.status_code == 201 and r.json()["id"] != aid and r.json()["status_url"].endswith(f"/lighthouse/audits/{r.json()['id']}")
    again = wait(lh, f"/api/v1/lighthouse/audits/{r.json()['id']}")
    assert again["submitted_url"] == "https://example.com/rerun" and again["status"] == "completed"
    assert lh.post("/api/v1/lighthouse/audits/999999/rerun").status_code == 404


def test_rate_limit(lh, monkeypatch, result):
    from app.audit.routers import lighthouse as router
    monkeypatch.setattr(router, "_hits", defaultdict(deque))
    monkeypatch.setattr(get_settings(), "lighthouse_rate_limit_per_minute", 2)
    psi_ok(monkeypatch, result)
    for n in range(2):
        start(lh, url=f"https://example.com/rate{n}")
    r = lh.post("/api/v1/lighthouse/audits", json={"url": "https://example.com/rate3"})
    assert r.status_code == 429


def test_health_hides_secrets(lh):
    data = lh.get("/api/v1/lighthouse/health").json()
    assert data["pagespeed_configured"] is True and "local_lighthouse_available" in data
    assert "test-key" not in json.dumps(data)
    assert "lighthouse_local" in lh.get("/api/v1/status").json()


def _discovery(monkeypatch, urls=None, error=None):
    from app.audit.routers import lighthouse as router

    def fake(url, max_pages):
        if error:
            raise SitemapDiscoveryError(error)
        return urls[:max_pages]
    monkeypatch.setattr(router, "discover_site_urls", fake)


def test_site_audit_runs_every_page(lh, monkeypatch, result, tmp_path):
    _discovery(monkeypatch, ["https://example.com/", "https://example.com/about"])
    local_ok(monkeypatch, result, tmp_path)
    r = lh.post("/api/v1/lighthouse/site-audits", json={"url": "https://example.com", "engine": "lighthouse", "max_pages": 10})
    assert r.status_code == 201
    data = r.json()
    assert data["page_count"] == 2 and len(data["page_audit_ids"]) == 2
    final = wait(lh, f"/api/v1/lighthouse/site-audits/{data['id']}")
    assert final["status"] == "completed" and final["completed_count"] == 2 and final["failed_count"] == 0
    assert len(final["pages"]) == 2 and all(p["performance_score"] == 93 for p in final["pages"])
    history = lh.get("/api/v1/lighthouse/site-audits/history?page_size=100").json()
    assert any(i["id"] == data["id"] and i["status"] == "completed" for i in history["items"])
    singles = lh.get("/api/v1/lighthouse/audits/history?page_size=100&include_site_pages=false").json()["items"]
    assert not any(i["id"] in data["page_audit_ids"] for i in singles)
    everything = lh.get("/api/v1/lighthouse/audits/history?page_size=100").json()["items"]
    assert all(pid in {i["id"] for i in everything} for pid in data["page_audit_ids"])


def test_site_audit_partial_failure_still_completes(lh, monkeypatch, result):
    _discovery(monkeypatch, ["https://example.com/ok", "https://example.com/broken"])

    def flaky(**kw):
        if kw["url"].endswith("/broken"):
            raise lighthouse.LighthouseError("Chrome crashed")
        return {"raw_json": result, "json_path": None, "html_path": None}
    monkeypatch.setattr(lighthouse, "run_audit", flaky)
    sid = lh.post("/api/v1/lighthouse/site-audits", json={"url": "https://example.com", "engine": "lighthouse", "max_pages": 2}).json()["id"]
    final = wait(lh, f"/api/v1/lighthouse/site-audits/{sid}")
    assert final["status"] == "completed" and final["completed_count"] == 1 and final["failed_count"] == 1


def test_site_audit_errors(lh, monkeypatch):
    assert lh.post("/api/v1/lighthouse/site-audits", json={"url": "https://example.com", "max_pages": 500}).status_code == 422
    assert lh.post("/api/v1/lighthouse/site-audits", json={"url": "http://127.0.0.1/"}).status_code == 400
    assert lh.get("/api/v1/lighthouse/site-audits/999999").status_code == 404
    _discovery(monkeypatch, error="no sitemap found")
    r = lh.post("/api/v1/lighthouse/site-audits", json={"url": "https://example.com/nositemap"})
    assert r.status_code == 422 and "no sitemap found" in r.json()["detail"].lower()
    failed = lh.get("/api/v1/lighthouse/site-audits/history?page_size=100").json()["items"]
    assert any(i["base_url"] == "https://example.com/nositemap" and i["status"] == "failed" for i in failed)


def test_restart_marks_unfinished_audits_failed(lh):
    from app.db import SessionLocal
    from app.models import LighthouseAudit
    from app.audit import lighthouse_runner
    db = SessionLocal()
    a = LighthouseAudit(submitted_url="https://example.com/stuck", strategy="mobile", engine="lighthouse", status="running")
    db.add(a)
    db.commit()
    assert lighthouse_runner.recover_interrupted(db) >= 1
    db.refresh(a)
    assert a.status == "failed" and "restart" in a.error_message
    db.close()
