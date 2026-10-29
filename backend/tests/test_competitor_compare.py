"""Competitor registration, competitor audits tied to a business, and the audit-vs-audit
comparison endpoint (app/services/competitor_compare.py). PageSpeed and the crawler are faked by
the `client` fixture (conftest.py): scores seo=83/performance=54/accessibility=88/best_practices=92,
metrics lcp="4.1 s", one crawled page per site ("/", title "Home", h1 "Hi")."""
from app.competitors import service


def _register(client, monkeypatch, business_id, found):
    monkeypatch.setattr(service, "find_competitors", lambda *a, **k: found)
    return client.post("/api/v1/competitors", json={"business_type": "dentist", "location": "Pune", "business_id": business_id})


FOUND = [
    {"name": "Rival Dental", "rating": 4.5, "reviews": 120, "address": "Pune", "phone": "123", "website": "https://rival.example/", "maps_link": "https://maps.example/rival"},
    {"name": "No Website Clinic", "rating": 4.0, "reviews": 10, "address": "Pune", "phone": "456", "website": ""},
]


def _business(client, **extra):
    return client.post("/api/v1/businesses", json={"name": "Compare Test Dental", "website": "https://example.in/", **extra}).json()["id"]


def test_register_dedupes_and_skips_no_website(client, monkeypatch):
    bid = _business(client)
    r = _register(client, monkeypatch, bid, FOUND)
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 2  # raw search still returns both
    assert [c["website"] for c in body["registered"]] == ["https://rival.example/"]  # the one without a website isn't saved

    # Running it again with an updated rating must update the row, not duplicate it.
    updated = [dict(FOUND[0], rating=4.9)]
    r2 = _register(client, monkeypatch, bid, updated)
    saved = client.get(f"/api/v1/competitors?business_id={bid}").json()
    assert len(saved) == 1 and saved[0]["rating"] == 4.9

    assert _register(client, monkeypatch, 999999, FOUND).status_code == 404  # unknown business


def test_competitor_audit_reuses_recent_result(client, monkeypatch):
    bid = _business(client)
    comp_id = _register(client, monkeypatch, bid, FOUND).json()["registered"][0]["id"]

    r1 = client.post("/api/v1/audit/competitors", json={"urls": ["https://rival.example/"], "business_id": bid, "competitor_id": comp_id})
    assert r1.status_code == 202
    first = r1.json()[0]
    assert first["status"] == "queued" and first["reused"] is False  # matches the started-audit shape; the background task has since finished
    audit = client.get(f"/api/v1/audit/competitors/{first['id']}").json()
    assert audit["business_id"] == bid and audit["competitor_id"] == comp_id and audit["status"] == "done"

    r2 = client.post("/api/v1/audit/competitors", json={"urls": ["https://rival.example/"], "business_id": bid, "competitor_id": comp_id})
    assert r2.json()[0] == {"id": first["id"], "url": "https://rival.example/", "status": "done", "reused": True}

    # A URL audited for a different (or no) business/competitor is not reused -- it would silently repoint someone else's record.
    unattached = client.post("/api/v1/audit/competitors", json={"urls": ["https://rival.example/"]}).json()[0]
    assert unattached["id"] != first["id"] and unattached["reused"] is False

    # reuse_existing=false always queues a fresh one, even for the same business/competitor.
    r3 = client.post("/api/v1/audit/competitors", json={"urls": ["https://rival.example/"], "business_id": bid, "competitor_id": comp_id, "reuse_existing": False})
    assert r3.json()[0]["id"] != first["id"]

    history = client.get(f"/api/v1/audit/competitors?business_id={bid}").json()
    assert {a["id"] for a in history} == {first["id"], r3.json()[0]["id"]}  # the unattached one is excluded


def test_compare_our_website_audit_against_competitor(client, monkeypatch):
    bid = _business(client)
    comp_id = _register(client, monkeypatch, bid, FOUND).json()["registered"][0]["id"]
    our = client.post("/api/v1/website-audits", json={"url": "https://example.in/", "business_id": bid}).json()["id"]
    client.post("/api/v1/audit/competitors", json={"urls": ["https://rival.example/"], "business_id": bid, "competitor_id": comp_id})

    r = client.post("/api/v1/audit/competitors/compare", json={"our_audit_id": our, "competitor_ids": [comp_id]})
    assert r.status_code == 200
    body = r.json()
    comparison = body["comparisons"][0]
    assert comparison["compatibility"]["compatible"] is True
    scores = {m["key"]: m for m in comparison["overall"]["scores"]}
    assert scores["performance"]["ours"] == 54 and scores["performance"]["competitor"] == 54 and scores["performance"]["difference"] == 0
    assert scores["seo"]["better"] == "tie"
    vitals = {m["key"]: m for m in comparison["overall"]["core_web_vitals"]}
    assert vitals["lcp"]["ours"] == 4100.0 and vitals["lcp"]["direction"] == "lower_is_better"
    checks = comparison["technical_seo"]["checks"]
    assert checks and checks[0]["status"] in ("both_pass", "both_fail", "ours_fail_competitor_pass", "ours_pass_competitor_fail")
    assert comparison["pages"]["matched"][0]["path"] == "/"
    gaps = comparison["keywords_and_content_gaps"]
    assert gaps["on_page"]["available"] is True  # both sites were crawled, so on-page keywords are extracted with no external API
    assert gaps["search"]["available"] is False  # no competitor-research (Serper) run exists


def test_compare_falls_back_to_technical_and_onpage_audits(client, monkeypatch):
    """A business with no ad-hoc "website" audit, only the technical/onpage pair from a full audit."""
    bid = _business(client)
    comp_id = _register(client, monkeypatch, bid, FOUND).json()["registered"][0]["id"]
    client.post("/api/v1/audit/competitors", json={"urls": ["https://rival.example/"], "business_id": bid, "competitor_id": comp_id})
    assert client.post(f"/api/v1/businesses/{bid}/audits", json={"kinds": ["technical", "onpage"]}).status_code == 202

    r = client.post("/api/v1/audit/competitors/compare", json={"business_id": bid, "competitor_ids": [comp_id]})
    assert r.status_code == 200
    comparison = r.json()["comparisons"][0]
    assert comparison["overall"]["available"] is True
    assert comparison["pages"]["available"] is not False


def test_compare_strategy_mismatch_is_flagged(client, monkeypatch):
    bid = _business(client)
    comp_id = _register(client, monkeypatch, bid, FOUND).json()["registered"][0]["id"]
    our = client.post("/api/v1/website-audits", json={"url": "https://example.in/", "business_id": bid, "strategy": "mobile"}).json()["id"]
    client.post("/api/v1/audit/competitors", json={"urls": ["https://rival.example/"], "business_id": bid, "competitor_id": comp_id, "strategy": "desktop"})

    r = client.post("/api/v1/audit/competitors/compare", json={"our_audit_id": our, "competitor_ids": [comp_id]})
    comparison = r.json()["comparisons"][0]
    assert comparison["compatibility"]["compatible"] is False


def test_compare_missing_audit_reports_error_without_failing_whole_request(client, monkeypatch):
    bid = _business(client)
    our = client.post("/api/v1/website-audits", json={"url": "https://example.in/", "business_id": bid}).json()["id"]
    r = client.post("/api/v1/audit/competitors/compare", json={"our_audit_id": our, "competitor_audit_ids": [999999]})
    assert r.status_code == 200
    assert "error" in r.json()["comparisons"][0]

    assert client.post("/api/v1/audit/competitors/compare", json={"our_audit_id": 999999, "competitor_audit_ids": [1]}).status_code == 404
    assert client.post("/api/v1/audit/competitors/compare", json={"competitor_audit_ids": [1]}).status_code == 404  # neither our_audit_id nor business_id


def test_onpage_keyword_gap_from_crawled_content(client, monkeypatch):
    """No SERPER_API_KEY or competitor-research run needed: keyword gaps come straight from each
    site's own crawled pages (services/crawler.py's extract_keywords)."""
    from app.services import crawler

    def crawl_for(title, h1, body):
        return lambda url, max_pages=25, timeout=15, on_progress=None: {
            "start_url": url, "host": "x", "https": True, "robots_txt": True, "robots_blocks_all": False, "sitemap": False, "crawled": 1, "broken": [],
            "pages": [crawler.analyse_html(url, 200, f"<html><head><title>{title}</title></head><body><h1>{h1}</h1><p>{body}</p></body></html>")]}

    bid = _business(client)
    comp_id = _register(client, monkeypatch, bid, FOUND).json()["registered"][0]["id"]

    monkeypatch.setattr(crawler, "crawl", crawl_for("Dental Implants Pune", "Dental Implants", "dental implants dental implants dental implants surgery"))
    our = client.post("/api/v1/website-audits", json={"url": "https://example.in/", "business_id": bid}).json()["id"]

    monkeypatch.setattr(crawler, "crawl", crawl_for("Root Canal Treatment Pune", "Root Canal Treatment", "root canal treatment root canal treatment root canal pain relief"))
    client.post("/api/v1/audit/competitors", json={"urls": ["https://rival.example/"], "business_id": bid, "competitor_id": comp_id})

    r = client.post("/api/v1/audit/competitors/compare", json={"our_audit_id": our, "competitor_ids": [comp_id]})
    on_page = r.json()["comparisons"][0]["keywords_and_content_gaps"]["on_page"]
    assert on_page["available"] is True
    assert "dental implants" in on_page["ours_only_keywords"]
    assert "root canal treatment" in on_page["competitor_only_keywords"]
    assert "dental implants" not in on_page["competitor_only_keywords"]
