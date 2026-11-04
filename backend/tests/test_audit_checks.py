"""Site Audit checks: each is counted from the saved crawl; a 0 means checked and clean."""
from datetime import datetime, timedelta, timezone

from app.db import SessionLocal
from app.models import Audit
from app.services import audit_checks


def _page(url, **k):
    return {"url": url, "status": 200, "title": f"T {url}", "title_length": 40, "meta_description": f"d {url}", "meta_description_length": 150, "h1_count": 1, "word_count": 500, "images_missing_alt": 0,
            "has_viewport": True, "noindex": False, "canonical": url, "schema_types": ["Organization"], "og_title": "x", "lang": "en", "inbound": 3, "depth": 1, "text_ratio": 25.0, **k}


def _crawl(*pages, **site):
    pages = list(pages)
    pages[0]["depth"] = 0
    return {"start_url": pages[0]["url"], "https": True, "sitemap": True, "robots_txt": True, "pages": pages, "broken": [], **site}


def test_clean_site_has_no_issues():
    res = audit_checks.run(_crawl(_page("https://a.example/"), _page("https://a.example/x")))
    assert audit_checks.totals(res) == {"errors": 0, "warnings": 0, "notices": 0, "issues": 0}


def test_each_problem_is_counted_by_its_severity():
    crawl = _crawl(_page("https://a.example/"), _page("https://a.example/a", title="Same", meta_description="same", h1_count=0, word_count=50, title_length=70, images_missing_alt=2),
                   _page("https://a.example/b", title="Same", meta_description="same", h1_count=2, inbound=0, depth=2, schema_types=[]), _page("https://a.example/gone", status=404),
                   sitemap=False, https=False, broken=[{"url": "x", "error": "404"}])
    c = {k: v["count"] for k, v in audit_checks.run(crawl, [{"code": "no_localbusiness_schema"}]).items() if v["count"]}
    assert c["duplicate_title"] == 2 and c["duplicate_meta"] == 2 and c["http_4xx"] == 1 and c["no_https"] == 1 and c["broken_links"] == 1
    assert c["missing_h1"] == 1 and c["title_long"] == 1 and c["low_word_count"] == 1 and c["missing_alt"] == 1 and c["no_sitemap"] == 1 and c["no_localbusiness"] == 1
    assert c["multiple_h1"] == 1 and c["orphan"] == 1 and c["no_markup"] == 1
    t = audit_checks.totals(audit_checks.run(crawl, [{"code": "no_localbusiness_schema"}]))
    assert t["errors"] > 0 and t["warnings"] > 0 and t["notices"] > 0 and t["issues"] == t["errors"] + t["warnings"] + t["notices"]


def test_page_issues_and_statistics():
    crawl = _crawl(_page("https://a.example/"), _page("https://a.example/a", h1_count=0, canonical=None), sitemap_urls=["https://a.example/", "https://a.example/a"], sitemap_pages=2)
    per = audit_checks.page_issues(crawl)
    assert per["https://a.example/"] == [] and [i["code"] for i in per["https://a.example/a"]] == ["missing_h1", "missing_canonical"]
    s = audit_checks.statistics(crawl)
    assert s["http"]["2xx"] == 100 and s["sitemap"]["found_in_sitemap"] == 100 and s["canonical"] == {"missing": 50, "other": 0, "self": 50}


def test_audit_report_endpoint_gives_history_for_compare_and_progress(client):
    bid = client.post("/api/v1/businesses", json={"name": "Rep Co", "website": "https://rep.example"}).json()["id"]
    assert client.get(f"/api/v1/businesses/{bid}/audit-report").status_code == 404
    now = datetime.now(timezone.utc)
    db = SessionLocal()
    bad = _crawl(_page("https://rep.example/"), _page("https://rep.example/a", h1_count=0))
    good = _crawl(_page("https://rep.example/"), _page("https://rep.example/a"))
    db.add_all([Audit(business_id=bid, kind="onpage", target="https://rep.example", status="done", score=70, finished_at=now - timedelta(days=1), issues=[], result=bad),
                Audit(business_id=bid, kind="onpage", target="https://rep.example", status="done", score=90, finished_at=now, issues=[], result=good)])
    db.commit()
    db.close()
    r = client.get(f"/api/v1/businesses/{bid}/audit-report").json()
    assert len(r["history"]) == 2 and r["history"][0]["counts"]["missing_h1"] == 0 and r["history"][1]["counts"]["missing_h1"] == 1
    assert r["totals"]["issues"] == 0 and r["pages_crawled"] == 2 and {c["code"] for c in r["checks"]} >= {"missing_h1", "duplicate_title"}
    assert r["statistics"]["pages"] == 2 and r["js"]["js_only"] == 0
