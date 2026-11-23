"""Page indexing: finding pages and the new and changed ones, IndexNow submissions, Google's verdicts, and the automatic run (network calls are replaced)."""
import pytest

from app.services import backlink_checker as bc
from app.services import gsc_access, indexing, sitemap


@pytest.fixture()
def bid(client):
    return client.post("/api/v1/businesses", json={"name": "Index Co", "website": "https://index.example/"}).json()["id"]



@pytest.fixture(autouse=True)
def _key_file_read_through_the_mocked_fetch(monkeypatch):
    """These tests describe the key file with the mocked page fetcher; the real key reader (plain text) is tested in test_indexnow_key_text.py."""
    monkeypatch.setattr(indexing, "_read_key_file", lambda url: (lambda r: (r[0], r[1], r[4]))(bc._fetch(url)))


def api(client, bid, path=""):
    return f"/api/v1/businesses/{bid}/indexing{path}"


def entries(monkeypatch, items):
    monkeypatch.setattr(sitemap, "discover_site_entries", lambda url, n, **k: list(items))


def no_google(monkeypatch):
    monkeypatch.setattr(gsc_access, "search_console", lambda db, b, host: ("not_connected", "No Google account is linked to this project.", None, None))


class FakeSC:
    def __init__(self, answers):
        self.answers = answers

    def inspect(self, site, url):
        a = self.answers[url]
        if isinstance(a, Exception):
            raise a
        return {"inspectionResult": {"inspectionResultLink": f"https://search.google.com/search-console/inspect?resource_id=x&id={url.rsplit('/', 1)[1]}", "indexStatusResult": a}}

    def sitemaps(self, site):
        return [{"path": "https://index.example/sitemap.xml", "lastSubmitted": "2026-11-10T10:00:00Z", "isPending": False, "errors": "0", "warnings": "1", "contents": [{"type": "web", "submitted": "40"}]}]

    def query(self, *a, **k):
        return []


def with_google(monkeypatch, answers):
    sc = FakeSC(answers)
    monkeypatch.setattr(gsc_access, "search_console", lambda db, b, host: ("ok", "owner@example.com", sc, "sc-domain:index.example"))
    return sc


def test_scan_finds_new_pages_then_the_changed_ones(client, bid, monkeypatch):
    no_google(monkeypatch)
    entries(monkeypatch, [("https://index.example/", "2026-11-01"), ("https://index.example/a", "2026-11-02")])
    r = client.post(api(client, bid, "/scan")).json()
    assert r["found"] == 2 and r["new"] == 2 and r["changed"] == 0
    entries(monkeypatch, [("https://index.example/", "2026-11-01"), ("https://index.example/a", "2026-11-18"), ("https://index.example/new", "2026-11-18")])
    r = client.post(api(client, bid, "/scan")).json()
    assert r["new"] == 1 and r["changed"] == 1  # /new is new, /a's lastmod moved
    o = client.get(api(client, bid)).json()
    assert o["counts"]["total"] == 3 and o["counts"]["pending"] == 3 and o["counts"]["new"] == 3
    assert next(p for p in o["pages"] if p["url"].endswith("/a"))["changed_at"]


def test_a_site_without_a_sitemap_is_explained(client, bid, monkeypatch):
    def none(url, n, **k):
        raise sitemap.SitemapDiscoveryError("No sitemap could be found for https://index.example.")

    monkeypatch.setattr(sitemap, "discover_site_entries", none)
    r = client.post(api(client, bid, "/scan"))
    assert r.status_code == 422 and "No sitemap" in r.json()["detail"]


def test_the_key_file_must_be_on_the_site_before_anything_is_sent(client, bid, monkeypatch):
    no_google(monkeypatch)
    entries(monkeypatch, [("https://index.example/a", None)])
    client.post(api(client, bid, "/scan"))
    r = client.post(api(client, bid, "/submit"), json={})
    assert r.status_code == 422 and "key file" in r.json()["detail"]
    key = client.get(api(client, bid, "/key-file")).text
    assert len(key) == 32 and key.isalnum()
    monkeypatch.setattr(bc, "_fetch", lambda url: (404, "", url, 5, None))
    bad = client.post(api(client, bid, "/verify-key")).json()
    assert bad["ok"] is False and f"{key}.txt" in bad["message"]
    monkeypatch.setattr(bc, "_fetch", lambda url: (200, key + "\n", url, 5, None))
    assert client.post(api(client, bid, "/verify-key")).json()["ok"] is True
    assert client.get(api(client, bid)).json()["key"]["ready"] is True


def _verified(client, bid, monkeypatch):
    key = client.get(api(client, bid, "/key-file")).text
    monkeypatch.setattr(bc, "_fetch", lambda url: (200, key, url, 5, None))
    assert client.post(api(client, bid, "/verify-key")).json()["ok"]
    return key


def test_new_pages_are_sent_and_unfit_ones_are_skipped_with_the_reason(client, bid, monkeypatch):
    no_google(monkeypatch)
    entries(monkeypatch, [("https://index.example/good", "2026-11-01"), ("https://index.example/hidden", "2026-11-01"), ("https://index.example/gone", "2026-11-01")])
    client.post(api(client, bid, "/scan"))
    key = _verified(client, bid, monkeypatch)
    pages = {"https://index.example/good": (200, "<html><head><title>Good</title></head></html>"), "https://index.example/hidden": (200, '<meta name="robots" content="noindex, follow">'),
             "https://index.example/gone": (404, "")}
    monkeypatch.setattr(bc, "_fetch", lambda url: (pages[url][0], pages[url][1], url, 5, None) if url in pages else (200, key, url, 5, None))
    sent = {}
    monkeypatch.setattr(indexing, "indexnow", lambda host, k, loc, urls: (sent.update(host=host, key=k, loc=loc, urls=list(urls)) or (True, 200, "Accepted.")))
    r = client.post(api(client, bid, "/submit"), json={}).json()
    assert r["sent"] == 1 and sent["urls"] == ["https://index.example/good"] and sent["host"] == "index.example" and sent["loc"].endswith(f"/{key}.txt")
    assert {x["url"].rsplit("/", 1)[1]: x["reason"] for x in r["skipped"]} == {"hidden": "The page is marked noindex", "gone": "The page answers HTTP 404"}
    o = client.get(api(client, bid)).json()
    good = next(p for p in o["pages"] if p["url"].endswith("/good"))
    assert good["submitted_at"] and "Bing" in good["submitted_to"] and o["counts"]["sent"] == 1 and o["counts"]["skipped"] == 2 and o["counts"]["pending"] == 0
    assert client.post(api(client, bid, "/submit"), json={}).json()["message"] == "Nothing new to send."
    # the page changes: it goes out again
    entries(monkeypatch, [("https://index.example/good", "2026-11-19")])
    client.post(api(client, bid, "/scan"))
    assert client.get(api(client, bid)).json()["counts"]["pending"] == 1


def test_a_refused_submission_is_reported_and_the_page_stays_pending(client, bid, monkeypatch):
    no_google(monkeypatch)
    entries(monkeypatch, [("https://index.example/p", None)])
    client.post(api(client, bid, "/scan"))
    key = _verified(client, bid, monkeypatch)
    monkeypatch.setattr(bc, "_fetch", lambda url: (200, "<html></html>", url, 5, None))
    monkeypatch.setattr(indexing, "indexnow", lambda *a: (False, 403, "The key could not be found on your site: check the key file."))
    r = client.post(api(client, bid, "/submit"), json={}).json()
    assert r["sent"] == 0 and r["ok"] is False and "key could not be found" in r["message"]
    assert client.get(api(client, bid)).json()["counts"]["pending"] == 1 and key


def test_google_verdicts_come_with_a_reason_and_a_fix(client, bid, monkeypatch):
    no_google(monkeypatch)
    entries(monkeypatch, [("https://index.example/ok", None), ("https://index.example/meh", None), ("https://index.example/blocked", None), ("https://index.example/err", None)])
    client.post(api(client, bid, "/scan"))
    with_google(monkeypatch, {
        "https://index.example/ok": {"verdict": "PASS", "coverageState": "Submitted and indexed", "lastCrawlTime": "2026-11-10T08:00:00Z", "googleCanonical": "https://index.example/ok"},
        "https://index.example/meh": {"verdict": "NEUTRAL", "coverageState": "Crawled - currently not indexed", "lastCrawlTime": "2026-11-12T08:00:00Z"},
        "https://index.example/blocked": {"verdict": "FAIL", "coverageState": "Blocked by robots.txt", "robotsTxtState": "DISALLOWED"},
        "https://index.example/err": RuntimeError("quota"),
    })
    r = client.post(api(client, bid, "/inspect"), json={}).json()
    assert r["checked"] == 3 and r["indexed"] == 1 and r["not_indexed"] == 1 and r["blocked"] == 1 and r["error"] == "quota"
    assert r["pages"]["https://index.example/ok"] == {"state": "indexed", "link": "https://search.google.com/search-console/inspect?resource_id=x&id=ok"} and "https://index.example/err" not in r["pages"]
    assert r["pages"]["https://index.example/meh"]["state"] == "not_indexed" and r["pages"]["https://index.example/meh"]["link"].endswith("&id=meh")
    o = client.get(api(client, bid)).json()
    by = {p["url"].rsplit("/", 1)[1]: p for p in o["pages"]}
    assert by["ok"]["g_state"] == "indexed" and by["ok"]["g_last_crawl"] and by["ok"]["g_canonical"].endswith("/ok")
    assert by["meh"]["g_state"] == "not_indexed" and "not indexed" in by["meh"]["g_reason"].lower() and "link to it" in by["meh"]["g_advice"].lower()
    assert by["blocked"]["g_state"] == "blocked" and "robots.txt" in by["blocked"]["g_advice"]
    assert by["err"]["g_state"] is None and o["counts"]["indexed"] == 1 and o["counts"]["not_indexed"] == 2 and o["counts"]["unchecked"] == 1
    assert [p["url"] for p in client.get(api(client, bid) + "?status=not_indexed").json()["pages"]] and client.get(api(client, bid) + "?status=indexed").json()["shown"] == 1


def test_inspecting_without_search_console_says_why(client, bid, monkeypatch):
    no_google(monkeypatch)
    entries(monkeypatch, [("https://index.example/a", None)])
    client.post(api(client, bid, "/scan"))
    r = client.post(api(client, bid, "/inspect"), json={})
    assert r.status_code == 422 and "No Google account" in r.json()["detail"]
    assert client.get(api(client, bid, "/google")).json()["state"] == "not_connected"


def test_google_status_lists_the_sitemaps_google_knows(client, bid, monkeypatch):
    with_google(monkeypatch, {})
    g = client.get(api(client, bid, "/google")).json()
    assert g["state"] == "ok" and g["sitemaps"][0]["submitted"] == 40 and g["sitemaps"][0]["warnings"] == 1 and "search-console" in g["console_url"]


def test_the_daily_run_does_nothing_until_automatic_indexing_is_on_then_does_everything(client, bid, monkeypatch):
    entries(monkeypatch, [("https://index.example/a", "2026-11-01"), ("https://index.example/b", "2026-11-01")])
    with_google(monkeypatch, {"https://index.example/a": {"verdict": "PASS", "coverageState": "Submitted and indexed"}, "https://index.example/b": {"verdict": "NEUTRAL", "coverageState": "Discovered - currently not indexed"}})
    from app.db import SessionLocal
    from app.models import Business
    db = SessionLocal()
    try:
        assert indexing.run_auto(db, db.get(Business, bid)) == {"skipped": "off"}
    finally:
        db.close()
    key = _verified(client, bid, monkeypatch)
    monkeypatch.setattr(bc, "_fetch", lambda url: (200, key if url.endswith(".txt") else "<html></html>", url, 5, None))
    sent = []
    monkeypatch.setattr(indexing, "indexnow", lambda host, k, loc, urls: (sent.extend(urls) or (True, 202, "Accepted: the key will be checked.")))
    assert client.put(api(client, bid, "/settings"), json={"auto": True}).json()["auto"] is True
    db = SessionLocal()
    try:
        out = indexing.run_auto(db, db.get(Business, bid))
    finally:
        db.close()
    assert out["new"] == 2 and out["submitted"] == 2 and out["inspected"] == 2 and sorted(sent) == ["https://index.example/a", "https://index.example/b"]
    o = client.get(api(client, bid)).json()
    assert o["auto"] is True and o["last_scan"]["submitted"] == 2 and o["counts"]["indexed"] == 1 and o["counts"]["not_indexed"] == 1


def test_the_job_is_scheduled_daily_for_projects(client, bid):
    from app.services import schedules
    assert "indexing" in schedules.JOBS and schedules.JOB_DEFAULTS["indexing"] == "daily"


def test_a_page_published_by_the_app_is_recorded_and_sent_at_once_when_automatic(client, bid, monkeypatch):
    no_google(monkeypatch)
    key = _verified(client, bid, monkeypatch)
    from app.db import SessionLocal
    from app.models import Business
    started = []
    monkeypatch.setattr("threading.Thread", lambda target, args, daemon: type("T", (), {"start": lambda self: started.append(args)})())
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        indexing.on_published(db, b, "https://index.example/blog/new-post")
        assert started == []  # automatic indexing is still off: recorded only
        client.put(api(client, bid, "/settings"), json={"auto": True})
        indexing.on_published(db, b, "https://index.example/blog/second")
        indexing.on_published(db, b, "https://elsewhere.example/not-ours")  # another site's address is ignored
    finally:
        db.close()
    urls = [p["url"] for p in client.get(api(client, bid)).json()["pages"]]
    assert "https://index.example/blog/new-post" in urls and "https://index.example/blog/second" in urls and not any("elsewhere" in u for u in urls)
    assert started == [(bid, "https://index.example/blog/second")] and key


def test_parse_inspection_and_advice():
    p = indexing.parse_inspection({"inspectionResult": {"indexStatusResult": {"verdict": "PASS", "coverageState": "Submitted and indexed", "lastCrawlTime": "2026-11-10T08:00:00Z"}}})
    assert p["state"] == "indexed" and p["last_crawl"].year == 2026
    assert indexing.parse_inspection({"inspectionResult": {"indexStatusResult": {"verdict": "FAIL", "coverageState": "Excluded by 'noindex' tag"}}})["state"] == "not_indexed"
    assert indexing.parse_inspection({})["state"] == "unknown"
    assert "canonical" in indexing.advice("Duplicate without user-selected canonical") and indexing.advice("something new") is None


def test_the_key_is_also_given_as_json_for_the_download_button(client, bid):
    k = client.get(api(client, bid, "/key")).json()
    assert k["name"] == k["content"] + ".txt" and k["url"] == f"https://index.example/{k['content']}.txt"
    assert client.get(api(client, bid, "/key")).json()["content"] == k["content"]  # the same key every time


def test_the_page_indexing_report_link_and_a_pages_own_link_comes_from_google():
    from app.services import indexing
    for site in ("sc-domain:shop.example", "https://shop.example/"):
        l = indexing.console_links(site)
        assert list(l) == ["index_url"] and l["index_url"].startswith("https://search.google.com/search-console/index?resource_id=")
        assert ":" not in l["index_url"].split("resource_id=")[1] and "/" not in l["index_url"].split("resource_id=")[1]
    # a page's own link is the one Google returns with the inspection, never one we build
    got = indexing.parse_inspection({"inspectionResult": {"inspectionResultLink": "https://search.google.com/search-console/inspect?resource_id=sc-domain%3Ashop.example&id=AbC123", "indexStatusResult": {"verdict": "PASS", "coverageState": "Submitted and indexed"}}})
    assert got["state"] == "indexed" and got["link"].endswith("&id=AbC123")
    assert indexing.parse_inspection({"inspectionResult": {"indexStatusResult": {"verdict": "FAIL"}}})["link"] is None


def test_the_daily_counts_are_kept_and_give_back_the_last_days_oldest_first(client):
    from datetime import timedelta
    from app.db import SessionLocal
    from app.models import Business, IndexStatDay
    from app.services import indexing
    db = SessionLocal()
    try:
        b = Business(name="Stats Shop", website="https://stats.example")
        db.add(b)
        db.commit()
        today = indexing._now().date()
        for i, n in ((3, 5), (1, 8)):
            db.add(IndexStatDay(business_id=b.id, day=today - timedelta(days=i), stats={"indexed": n}))
        db.commit()
        h = indexing.record_stats(db, b, {"indexed": 11, "total": 20})
        assert [x["indexed"] for x in h] == [5, 8, 11] and h[-1]["total"] == 20 and h[-1]["day"] == today.isoformat()
        h = indexing.record_stats(db, b, {"indexed": 12, "total": 20})  # looking again the same day replaces that day's numbers
        assert [x["indexed"] for x in h] == [5, 8, 12] and len(h) == 3
    finally:
        db.query(IndexStatDay).filter(IndexStatDay.business_id == b.id).delete()
        db.query(Business).filter(Business.id == b.id).delete()
        db.commit()
        db.close()


def test_one_page_in_full_shows_googles_answer_and_a_live_test(client, bid, monkeypatch):
    url = "https://index.example/blog/post"
    with_google(monkeypatch, {url: {"verdict": "NEUTRAL", "coverageState": "Crawled - currently not indexed", "robotsTxtState": "ALLOWED", "pageFetchState": "SUCCESSFUL", "crawledAs": "MOBILE", "lastCrawlTime": "2026-11-23T07:14:23Z"}})
    monkeypatch.setattr(indexing, "live_test", lambda u: {"ok": True, "status": 200, "html": "<html></html>", "check": {"verdict": "indexable", "reasons": []}})
    r = client.post(api(client, bid, "/page-detail"), json={"url": url})
    assert r.status_code == 200
    d = r.json()
    assert d["google"]["state"] == "not_indexed" and d["google"]["coverage"] == "Crawled - currently not indexed" and d["google"]["crawled_as"] == "MOBILE" and d["google_error"] is None
    assert d["live"]["status"] == 200
    assert client.post(api(client, bid, "/page-detail"), json={"url": "https://other.example/x"}).status_code == 422  # only this project's own website


def test_the_page_detail_still_gives_the_live_test_when_google_is_not_connected(client, bid, monkeypatch):
    no_google(monkeypatch)
    monkeypatch.setattr(indexing, "live_test", lambda u: {"ok": True, "status": 200, "html": "", "check": {"verdict": "indexable", "reasons": []}})
    d = client.post(api(client, bid, "/page-detail"), json={"url": "https://index.example/a"}).json()
    assert d["google"] is None and "No Google account" in d["google_error"] and d["live"]["ok"]
