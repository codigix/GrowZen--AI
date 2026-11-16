"""Page X-Ray: full page weight and colour contrast from a Lighthouse (PageSpeed Insights) result."""
from app.routers import page_xray_lighthouse as router
from app.services import page_xray_lighthouse as lh

PSI = {"lighthouseResult": {
    "requestedUrl": "https://asha.example/", "finalDisplayedUrl": "https://asha.example/", "fetchTime": "2026-11-12T10:00:00Z",
    "categories": {"accessibility": {"score": 0.9}, "performance": {"score": 0.42}},
    "audits": {
        "resource-summary": {"details": {"items": [
            {"resourceType": "total", "requestCount": 186, "transferSize": 3545000}, {"resourceType": "image", "requestCount": 72, "transferSize": 2463000},
            {"resourceType": "script", "requestCount": 37, "transferSize": 657000}, {"resourceType": "document", "requestCount": 2, "transferSize": 120000},
            {"resourceType": "third-party", "requestCount": 35, "transferSize": 585000}]}},
        "total-byte-weight": {"numericValue": 3545000, "details": {"items": [{"url": "https://asha.example/a.webp", "totalBytes": 203000}, {"url": "https://www.googletagmanager.com/gtag/js", "totalBytes": 202000}]}},
        "unused-javascript": {"details": {"overallSavingsBytes": 125000}}, "uses-optimized-images": {"details": {"overallSavingsBytes": 900}},
        "largest-contentful-paint": {"displayValue": "9.5 s"}, "total-blocking-time": {"displayValue": "460 ms"},
        "color-contrast": {"score": 0, "scoreDisplayMode": "binary", "details": {"items": [
            {"node": {"selector": "p.muted", "snippet": "<p class=\"muted\">", "nodeLabel": "Soft text",
                      "explanation": "Fix any of the following:\n  Element has insufficient color contrast of 2.41 (foreground color: #ffffff, background color: #f77f00, font size: 10.5pt (14px), font weight: normal). Expected contrast ratio of 4.5:1"}}]}},
    }}}


def test_weight_and_contrast_are_read_from_the_lighthouse_result():
    r = lh.extract(PSI, "mobile")
    w, c = r["weight"], r["contrast"]
    assert w["total_kb"] == 3461.9 and w["requests"] == 186 and w["third_party"] == {"requests": 35, "kb": 571.3}
    assert [t["type"] for t in w["by_type"]][:2] == ["Images", "JavaScript"] and "third-party" not in [t["key"] for t in w["by_type"]]
    assert w["heaviest"][0] == {"url": "https://asha.example/a.webp", "kb": 198.2}
    assert [s["id"] for s in w["savings"]] == ["unused-javascript"]  # a saving under 2 KB is not worth showing
    assert c["checked"] and c["passed"] is False and c["failing_count"] == 1
    f = c["failing"][0]
    assert (f["ratio"], f["expected"], f["fg"], f["bg"], f["selector"]) == (2.41, 4.5, "#ffffff", "#f77f00", "p.muted") and "14px" in f["font_size"]
    assert r["accessibility_score"] == 90 and r["performance_score"] == 42 and r["metrics"]["lcp"] == "9.5 s"


def test_missing_data_is_reported_as_not_tested_not_as_a_pass():
    bare = {"lighthouseResult": {"categories": {}, "audits": {"color-contrast": {"score": None, "scoreDisplayMode": "notApplicable"}}}}
    r = lh.extract(bare, "desktop")
    assert r["contrast"]["checked"] is False and r["contrast"]["passed"] is None and r["weight"]["total_bytes"] == 0
    assert any("contrast" in n.lower() for n in r["notes"]) and any("resource summary" in n for n in r["notes"])
    ok = {"lighthouseResult": {"categories": {}, "audits": {"color-contrast": {"score": 1, "scoreDisplayMode": "binary", "details": {"items": []}}}}}
    assert lh.extract(ok, "mobile")["contrast"] == {"checked": True, "passed": True, "score": 1, "failing_count": 0, "failing": []}


def test_endpoint_validates_caches_limits_and_maps_errors(client, monkeypatch):
    from app.services import pagespeed
    calls = []
    monkeypatch.setattr(lh, "measure", lambda url, strategy="mobile": calls.append((url, strategy)) or lh.extract(PSI, strategy))
    monkeypatch.setattr(router, "resolve_and_validate", lambda url: None)
    router._cache.clear()
    router._hits.clear()
    bid = client.post("/api/v1/businesses", json={"name": "Lh Co"}).json()["id"]
    url = f"/api/v1/businesses/{bid}/page-xray/lighthouse"
    r = client.post(url, json={"url": "asha.example", "strategy": "desktop"})
    assert r.status_code == 200 and r.json()["weight"]["requests"] == 186 and calls == [("https://asha.example", "desktop")]
    client.post(url, json={"url": "https://asha.example", "strategy": "desktop"})
    assert len(calls) == 1  # the same page and device is reused for 30 minutes
    assert client.post(url, json={"url": "x", "strategy": "tablet"}).status_code == 422
    assert client.post(url, json={"url": "javascript:alert(1)"}).status_code == 422
    assert client.post(url, json={"url": "file:///etc/passwd"}).status_code == 422
    monkeypatch.setattr(lh, "measure", lambda url, strategy="mobile": (_ for _ in ()).throw(pagespeed.PageSpeedQuotaError("quota")))
    assert client.post(url, json={"url": "https://other.example"}).status_code == 429
    monkeypatch.setattr(lh, "measure", lambda url, strategy="mobile": (_ for _ in ()).throw(pagespeed.PageSpeedTimeoutError("slow")))
    assert client.post(url, json={"url": "https://other2.example"}).status_code == 504
    monkeypatch.setattr(lh, "measure", lambda url, strategy="mobile": (_ for _ in ()).throw(pagespeed.PageSpeedError("blocked")))
    assert client.post(url, json={"url": "https://other3.example"}).status_code == 502
    router._hits.clear()
    monkeypatch.setattr(router, "LIMIT", 2)
    monkeypatch.setattr(lh, "measure", lambda url, strategy="mobile": lh.extract(PSI, strategy))
    for n in range(2):
        assert client.post(url, json={"url": f"https://lim{n}.example"}).status_code == 200
    assert client.post(url, json={"url": "https://lim9.example"}).status_code == 429
    router._hits.clear()


def test_internal_addresses_are_refused_and_other_users_get_404(client):
    from test_security import login, user
    bid = client.post("/api/v1/businesses", json={"name": "Lh Two"}).json()["id"]
    assert client.post(f"/api/v1/businesses/{bid}/page-xray/lighthouse", json={"url": "http://127.0.0.1/admin"}).status_code == 422
    assert client.post(f"/api/v1/businesses/{bid}/page-xray/lighthouse", json={"url": "http://169.254.169.254/"}).status_code == 422
    user("lh1@x.in", "editor")
    user("lh2@x.in", "editor")
    a, _ = login("lh1@x.in")
    o, _ = login("lh2@x.in")
    mine = a.post("/api/v1/businesses", json={"name": "Mine"}).json()["id"]
    assert o.post(f"/api/v1/businesses/{mine}/page-xray/lighthouse", json={"url": "https://example.com"}).status_code == 404
