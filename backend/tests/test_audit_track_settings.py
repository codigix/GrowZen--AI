"""Site Audit settings (crawl rules, schedule) and Position Tracking campaigns (targeting, keywords, home table)."""
from datetime import date, timedelta

from app.db import SessionLocal
from app.models import KeywordRankLog
from app.services import crawler, organic


class _Resp:
    def __init__(self, url, text="", status=200, ctype="text/html"):
        self.url, self.text, self.status_code, self.headers, self.content = url, text, status, {"content-type": ctype}, text.encode()


def _site(monkeypatch, pages: dict[str, str]):
    """A fake website: address -> HTML. robots.txt and sitemap.xml are absent unless given."""
    class Client:
        def get(self, url, *a, **k):
            u = url.split("#")[0]
            if u in pages:
                return _Resp(u, pages[u])
            return _Resp(u, "", 404, "text/plain")

        def close(self):
            pass
    monkeypatch.setattr(crawler, "site_client", lambda timeout=15, ua=None: Client())


PAGE = lambda title, links: f"<html lang='en'><head><title>{title} page title here ok</title><meta name='viewport' content='width=device-width'></head><body><h1>{title}</h1>" + "".join(f"<a href='{h}'>x</a>" for h in links) + "</body></html>"  # noqa: E731


def _urls(site):
    return sorted(p["url"] for p in site["pages"])


def test_crawl_rules_limit_which_pages_are_fetched(monkeypatch):
    base = "https://rules.example"
    _site(monkeypatch, {f"{base}/": PAGE("Home", ["/a", "/private/x", "/b?utm_source=z", "/b?utm_source=y", "/docs/one"]), f"{base}/a": PAGE("A", []), f"{base}/private/x": PAGE("P", []),
                        f"{base}/b": PAGE("B", []), f"{base}/docs/one": PAGE("D", [])})
    everything = crawler.crawl(f"{base}/", max_pages=20)
    assert f"{base}/private/x" in _urls(everything)
    ruled = crawler.crawl(f"{base}/", max_pages=20, options={"disallow": ["/private"], "ignore_params": ["utm_source"]})
    got = _urls(ruled)
    assert f"{base}/private/x" not in got and got.count(f"{base}/b") == 1 and not any("utm_source" in u for u in got)
    only = crawler.crawl(f"{base}/", max_pages=20, options={"allow": ["/docs/*"]})
    assert _urls(only) == [f"{base}/", f"{base}/docs/one"]  # the homepage is always where a crawl starts


def test_pages_to_crawl_modes(monkeypatch):
    base = "https://modes.example"
    _site(monkeypatch, {f"{base}/": PAGE("Home", ["/a"]), f"{base}/a": PAGE("A", ["/a/deep"]), f"{base}/a/deep": PAGE("Deep", []),
                        f"{base}/blog/": PAGE("Blog", ["/blog/p1", "/a"]), f"{base}/blog/p1": PAGE("P1", [])})
    assert f"{base}/a/deep" in _urls(crawler.crawl(f"{base}/", max_pages=20))
    sub = crawler.crawl(f"{base}/blog/", max_pages=20, options={"pages_to_crawl": "subfolder"})
    assert _urls(sub) == [f"{base}/blog/", f"{base}/blog/p1"]  # starts inside the folder and stays in it
    only_home = crawler.crawl(f"{base}/", max_pages=20, options={"pages_to_crawl": "sitemap"})
    assert _urls(only_home) == [f"{base}/"]  # no sitemap here, and links are not followed


def test_subdomain_scope(monkeypatch):
    _site(monkeypatch, {"https://scope.example/": PAGE("Home", ["https://blog.scope.example/post"]), "https://blog.scope.example/post": PAGE("Post", [])})
    assert _urls(crawler.crawl("https://scope.example/", max_pages=10)) == ["https://scope.example/"]
    assert "https://blog.scope.example/post" in _urls(crawler.crawl("https://scope.example/", max_pages=10, options={"subdomains": True}))


def test_audit_settings_are_saved_per_project_and_set_the_schedule(client):
    bid = client.post("/api/v1/businesses", json={"name": "Cfg Co", "website": "https://cfg.example"}).json()["id"]
    d = client.get(f"/api/v1/businesses/{bid}/audit-config").json()
    assert d["limit"] == 100 and d["pages_to_crawl"] == "website" and d["schedule"] == "off" and d["email"] is False
    body = {"limit": 40, "pages_to_crawl": "sitemap", "subdomains": False, "user_agent": "mobile", "allow": [" /blog* "], "disallow": ["", "/admin"], "ignore_params": ["utm_source"], "schedule": "weekly", "email": True}
    saved = client.put(f"/api/v1/businesses/{bid}/audit-config", json=body).json()
    assert saved["allow"] == ["/blog*"] and saved["disallow"] == ["/admin"] and saved["schedule"] == "weekly"
    again = client.get(f"/api/v1/businesses/{bid}/audit-config").json()
    assert again["limit"] == 40 and again["user_agent"] == "mobile" and again["schedule"] == "weekly" and again["email"] is True
    assert client.put(f"/api/v1/businesses/{bid}/audit-config", json={**body, "limit": 5}).status_code == 422  # below the smallest audit
    scheds = {s["job"]: s for s in client.get(f"/api/v1/businesses/{bid}/schedules").json()}
    assert scheds["site_crawl"]["every"] == "weekly" and scheds["site_crawl"]["next_run_at"]


def test_a_tracking_campaign_saves_targeting_and_keywords(client, monkeypatch):
    seen = {}
    monkeypatch.setattr(organic, "check", lambda db, b, only=None: seen.update(loc=(b.track_config or {}).get("location")) or {"checked": 2, "credits": 2, "results": []})
    bid = client.post("/api/v1/businesses", json={"name": "Trk Co", "website": "https://trk.example", "city": "Pune"}).json()["id"]
    cfg = client.get(f"/api/v1/businesses/{bid}/seo/track-config").json()
    assert cfg["device"] == "desktop" and cfg["engines"] == ["google"] and cfg["location"] and isinstance(cfg["suggestions"], list)
    r = client.put(f"/api/v1/businesses/{bid}/seo/track-campaign", json={"engines": ["google", "chatgpt"], "device": "mobile", "location": "Pune, India", "language": "en", "keywords": ["Dental Clinic Pune", "implants"], "check_now": True}).json()
    assert r["keywords_added"] == 2 and r["checked"] == {"keywords": 2, "credits": 2} and "desktop" in r["note"] and "AI Search" in r["note"]
    assert seen["loc"] == "Pune, India"
    after = client.get(f"/api/v1/businesses/{bid}/seo/track-config").json()
    assert after["location"] == "Pune, India" and after["device"] == "mobile" and "dental clinic pune" in after["tracked"]
    assert client.put(f"/api/v1/businesses/{bid}/seo/track-campaign", json={"engines": ["bing"]}).status_code == 422


def test_the_tracking_home_table_summarises_each_project(client):
    bid = client.post("/api/v1/businesses", json={"name": "Home Tbl Co", "website": "https://www.hometbl.example"}).json()["id"]
    client.put(f"/api/v1/businesses/{bid}/seo/track-campaign", json={"keywords": ["alpha", "beta"], "location": "Pune, India"})
    db = SessionLocal()
    d1, d2 = date.today() - timedelta(days=3), date.today()
    for kw, a, z in (("alpha", 8, 2), ("beta", 3, 9)):
        db.add_all([KeywordRankLog(business_id=bid, keyword=kw, day=d1, rank=a), KeywordRankLog(business_id=bid, keyword=kw, day=d2, rank=z)])
    db.commit()
    db.close()
    row = next(x for x in client.get("/api/v1/businesses/rank-tracking").json() if x["id"] == bid)
    assert row["domain"] == "hometbl.example" and row["location"] == "Pune, India" and row["device"] == "desktop" and row["engines"] == ["Google"]
    seo = row["seo"]
    assert seo["keywords"] == 2 and seo["improved"] == 1 and seo["declined"] == 1 and seo["updated"] == d2.isoformat() and seo["visibility"] is not None and seo["diff"] is not None
