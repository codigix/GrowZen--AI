"""Page X-Ray history (save, list, trend, delete, prune) and the whole-site scan, with no network."""
import time

import pytest

from app.db import SessionLocal
from app.models import Business, PageXRayJob, PageXRayRun
from app.routers import page_xray as xray_router
from app.services import page_xray, page_xray_history as hist


def report(url="https://shop.example/", seo=70, aeo=20, geo=40, failed=("title",), words=500):
    def area(score, keys):
        return {"score": score, "passed": 3, "total": 5, "checks": [{"key": k, "label": k, "passed": k not in failed, "weight": 1, "detail": "", "fix": "fix " + k} for k in keys]}
    return {"url": url, "final_url": url, "status": 200, "fetched_at": "2026-11-12T10:00:00Z", "content": {"word_count": words, "outline": [{"level": 1, "text": "Hi"}]},
            "scores": {"seo": area(seo, ["title", "h1"]), "aeo": area(aeo, ["faq"]), "geo": area(geo, ["llms"])},
            "summary": [{"area": "seo", "label": "Fix the title", "fix": "Write one"}], "notes": []}


def _project(client, website="https://shop.example/"):
    r = client.post("/api/v1/businesses", json={"name": "Shop Co", "website": website, "city": "Pune"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.fixture(autouse=True)
def _clean():
    xray_router._cache.clear()
    yield
    xray_router._cache.clear()


def test_save_list_change_trend_get_delete(client):
    bid = _project(client)
    base = f"/api/v1/businesses/{bid}/page-xray"
    r1 = client.post(f"{base}/save", json={"report": report(seo=60, aeo=10, geo=30)})
    assert r1.status_code == 201 and r1.json()["seo"] == 60 and r1.json()["source"] == "client"
    r2 = client.post(f"{base}/save", json={"report": report(seo=72, aeo=10, geo=25)})
    assert r2.status_code == 201
    other = client.post(f"{base}/save", json={"report": report(url="https://shop.example/about", seo=50)})
    assert other.status_code == 201
    lst = client.get(f"{base}/history", params={"url": "https://shop.example/"}).json()
    assert [x["seo"] for x in lst] == [72, 60] and lst[0]["change"] == {"seo": 12, "aeo": 0, "geo": -5} and lst[1]["change"] is None
    assert all("report" not in x for x in lst)  # the list is light
    assert len(client.get(f"{base}/history").json()) == 3  # every page
    tr = client.get(f"{base}/history/trend", params={"url": "https://shop.example/"}).json()
    assert [t["seo"] for t in tr] == [60, 72] and tr[0]["at"]
    one = client.get(f"{base}/history/{lst[0]['id']}").json()
    assert one["report"]["url"] == "https://shop.example/" and one["passed"]["seo"] == [3, 5] and one["word_count"] == 500
    assert client.delete(f"{base}/history/{lst[0]['id']}").json() == {"ok": True}
    assert client.get(f"{base}/history/{lst[0]['id']}").status_code == 404
    assert len(client.get(f"{base}/history", params={"url": "https://shop.example/"}).json()) == 1


def test_a_bad_report_is_refused_and_our_own_copy_wins(client):
    bid = _project(client)
    url = f"/api/v1/businesses/{bid}/page-xray/save"
    assert client.post(url, json={"report": {"nope": 1}}).status_code == 422
    bad = report(); bad["scores"]["seo"]["score"] = 150
    assert client.post(url, json={"report": bad}).status_code == 422
    # the browser sends an inflated score; the server still has its own copy of that X-Ray in its cache
    real = report(seo=40)
    uid = client.get("/api/v1/me").json()["id"]
    xray_router._cache[(str(uid), "https://shop.example/")] = (time.time(), real)
    forged = report(seo=99)
    got = client.post(url, json={"report": forged}).json()
    assert got["seo"] == 40 and got["source"] == "server"


def test_history_is_capped_per_project(client, monkeypatch):
    monkeypatch.setattr(hist, "MAX_RUNS", 5)
    bid = _project(client)
    for i in range(8):
        assert client.post(f"/api/v1/businesses/{bid}/page-xray/save", json={"report": report(seo=i)}).status_code == 201
    seos = [x["seo"] for x in client.get(f"/api/v1/businesses/{bid}/page-xray/history").json()]
    assert len(seos) == 5 and seos[0] == 7 and 0 not in seos  # the oldest were dropped


def test_oversized_report_keeps_the_scores_and_drops_the_bulk(client):
    bid = _project(client)
    big = report()
    big["content"]["outline"] = [{"level": 2, "text": "x" * 100}] * 4000
    r = client.post(f"/api/v1/businesses/{bid}/page-xray/save", json={"report": big})
    assert r.status_code == 201
    one = client.get(f"/api/v1/businesses/{bid}/page-xray/history/{r.json()['id']}").json()
    assert one["seo"] == 70 and "outline" not in (one["report"] or {}).get("content", {})


def test_history_is_private_to_the_owner(client):
    from test_security import login, user
    user("px1@x.in", "editor")
    user("px2@x.in", "editor")
    a, _ = login("px1@x.in")
    o, _ = login("px2@x.in")
    bid = a.post("/api/v1/businesses", json={"name": "Mine Co", "website": "https://mine.example/"}).json()["id"]
    base = f"/api/v1/businesses/{bid}/page-xray"
    run = a.post(f"{base}/save", json={"report": report()}).json()
    assert a.get(f"{base}/history").status_code == 200
    for method, path, kw in [("get", "/history", {}), ("get", f"/history/{run['id']}", {}), ("delete", f"/history/{run['id']}", {}), ("get", "/history/trend?url=x", {}),
                             ("post", "/save", {"json": {"report": report()}}), ("post", "/site", {"json": {"max_pages": 5}}), ("get", "/site", {})]:
        assert getattr(o, method)(f"{base}{path}", **kw).status_code == 404, (method, path)
    # a run of project A cannot be read through project B of the same user
    bid2 = a.post("/api/v1/businesses", json={"name": "Second Co", "website": "https://second.example/"}).json()["id"]
    assert a.get(f"/api/v1/businesses/{bid2}/page-xray/history/{run['id']}").status_code == 404


def _fake_site(monkeypatch, urls, boom=None):
    seen = []
    monkeypatch.setattr(hist.crawler, "crawl", lambda start, max_pages=25, **kw: {"pages": [{"url": u, "status": 200} for u in urls]})  # a crawler that over-delivers: the service filters and caps

    def fake_run(url, render=False):
        seen.append((url, render))
        if boom and url == boom:
            raise page_xray.XrayError(502, "could not fetch: timeout")
        return report(url=url, seo=70 if url.endswith("/") else 55)
    monkeypatch.setattr(page_xray, "run", fake_run)
    return seen


def test_site_scan_lifecycle_own_host_only_and_cap(client, monkeypatch):
    bid = _project(client)
    base = f"/api/v1/businesses/{bid}/page-xray/site"
    urls = ["https://shop.example/", "https://shop.example/a", "https://shop.example/b", "https://other.example/x", "https://www.shop.example/c", "https://blog.shop.example/z"] + [f"https://shop.example/p{i}" for i in range(20)]
    seen = _fake_site(monkeypatch, urls, boom="https://shop.example/b")
    assert client.get(base).json() is None  # nothing scanned yet
    r = client.post(base, json={"max_pages": 8})
    assert r.status_code == 202 and r.json()["status"] in ("running", "done")
    job = client.get(base).json()  # the test client has already run the background task
    assert job["status"] == "done" and job["phase"] == "scanning" and job["total"] == 8 and job["done"] == 8
    got = [p["url"] for p in job["pages"]]
    assert all("other.example" not in u and "blog.shop.example" not in u for u in got)  # own host only (www counts as the same host)
    assert len(got) == 8 and all(render is False for _, render in seen)
    bad = next(p for p in job["pages"] if p["url"].endswith("/b"))
    assert bad["error"] == "could not fetch: timeout" and bad["run_id"] is None
    good = next(p for p in job["pages"] if p["url"] == "https://shop.example/")
    assert good["seo"] == 70 and good["top_fix"] == "Fix the title" and client.get(f"/api/v1/businesses/{bid}/page-xray/history/{good['run_id']}").json()["source"] == "site"
    assert client.get(f"{base}/{job['id']}").json()["id"] == job["id"] and client.get(f"{base}/99999").status_code == 404
    # bounds
    assert client.post(base, json={"max_pages": 3}).status_code == 422 and client.post(base, json={"max_pages": 101}).status_code == 422


def test_one_scan_at_a_time_hourly_cap_missing_website_and_restart(client, monkeypatch):
    bid = _project(client)
    base = f"/api/v1/businesses/{bid}/page-xray/site"
    _fake_site(monkeypatch, ["https://shop.example/"])
    # a scan that is still running blocks a second one
    with SessionLocal() as db:
        db.add(PageXRayJob(business_id=bid, status="running", phase="scanning", pages=[]))
        db.commit()
        jid = db.query(PageXRayJob).filter_by(business_id=bid).one().id
    hist._ACTIVE.add(jid)
    assert client.post(base, json={"max_pages": 5}).status_code == 409
    # the same row after a restart (not active in this process) is reported failed, not running for ever
    hist._ACTIVE.discard(jid)
    stale = client.get(base).json()
    assert stale["status"] == "failed" and "restarted" in stale["error"]
    # the hourly cap
    monkeypatch.setattr(hist, "SCANS_PER_HOUR", 2)
    assert client.post(base, json={"max_pages": 5}).status_code == 202  # 2nd job in the hour
    assert client.post(base, json={"max_pages": 5}).status_code == 429
    # no website: nothing to scan
    nb = client.post("/api/v1/businesses", json={"name": "No Site Co"}).json()["id"]
    r = client.post(f"/api/v1/businesses/{nb}/page-xray/site", json={"max_pages": 5})
    assert r.status_code == 422 and "website" in r.json()["detail"].lower()


def test_memo_is_removed_after_a_scan_and_a_crawl_failure_is_reported(client, monkeypatch):
    bid = _project(client)
    original = page_xray.rdap_lookup
    def boom(*a, **k):
        raise RuntimeError("crawler down")
    monkeypatch.setattr(hist.crawler, "crawl", boom)
    assert client.post(f"/api/v1/businesses/{bid}/page-xray/site", json={"max_pages": 5}).status_code == 202
    job = client.get(f"/api/v1/businesses/{bid}/page-xray/site").json()
    assert job["status"] == "failed" and "crawler down" in job["error"]
    assert page_xray.rdap_lookup is original  # nothing stays patched
    # and the per-site memo asks the registry once however many pages there are
    calls = []
    monkeypatch.setattr(page_xray, "rdap_lookup", lambda d: calls.append(d) or {"age_days": 1})
    with hist._SiteMemo():
        for _ in range(5):
            page_xray.rdap_lookup("shop.example")
    assert calls == ["shop.example"]
