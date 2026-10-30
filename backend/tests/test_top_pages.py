"""Top Pages: one row per page from the crawl, Google rank checks, the data provider and AI answers (no network)."""
from datetime import date

from app.services.landscape import Obs
from app.services.top_pages import build, norm

D1, D2 = date(2026, 10, 1), date(2026, 10, 20)
ME = "mysite.com"


def _obs(kw, day, rank, url=None):
    return Obs(kw, day, rank, url, [url] if url else [], [], [], [])


def test_norm_makes_one_key_per_page():
    assert norm("https://www.MySite.com/blog/") == norm("http://mysite.com/blog") == "mysite.com/blog"
    assert norm("https://mysite.com/") == "mysite.com" and norm("https://mysite.com/blog?category=x") != norm("https://mysite.com/blog")


def test_sources_are_merged_per_page_and_missing_figures_stay_empty():
    crawl = [{"url": "https://mysite.com/a", "words": 900, "issues": 2, "schema": [], "mapped": [], "title": "A"}, {"url": "https://mysite.com/b", "words": 300, "issues": 0, "schema": [], "mapped": []}]
    obs = [_obs("kw1", D1, None), _obs("kw1", D2, 4, "https://www.mysite.com/a/"), _obs("kw2", D1, 3, "https://mysite.com/gone"), _obs("kw2", D2, None)]
    geo = [{"prompt_id": 1, "engine": "chatgpt", "urls": ["https://mysite.com/a", "https://other.com/x"], "day": "2026-10-20"}]
    r = build(crawl, obs, {"kw1": {"intent": "informational"}}, geo, {"pages": None, "indexed": None, "history": None}, ME, D1, D2, 3)
    by = {x["key"]: x for x in r["rows"]}
    a = by["mysite.com/a"]
    assert sorted(a["sources"]) == ["ai", "crawl", "google"] and a["avg_position"] == 4 and a["status"] == "new" and a["top_keyword"] == "kw1" and a["intent"] == "informational"
    assert a["llm_prompts"] == 1 and a["words"] == 900 and a["issues"] == 2 and a["traffic"] is None and a["ref_domains"] is None  # no provider: not estimated
    assert by["mysite.com/b"]["sources"] == ["crawl"] and by["mysite.com/b"]["keywords"] == 0
    assert by["mysite.com/gone"]["status"] == "lost" and "crawl" not in by["mysite.com/gone"]["sources"]
    assert r["new"] == 1 and r["lost"] == 1 and r["summary"]["cited_pages"] == 1 and r["summary"]["traffic"] is None and "other.com/x" not in by


def test_provider_traffic_shares_and_referring_domains():
    index = {"pages": [{"url": "https://mysite.com/a", "traffic": 30.0, "keywords": 4}, {"url": "https://mysite.com/b", "traffic": 10.0, "keywords": 1}],
             "indexed": [{"url": "https://mysite.com/a", "domains": 7, "backlinks": 20, "title": "A page"}], "history": [{"date": "2026-09", "traffic": 20.0}, {"date": "2026-10", "traffic": 40.0}]}
    r = build([], [], {}, [], index, ME, D1, D2, 0)
    a, b = r["rows"]
    assert a["key"] == "mysite.com/a" and a["traffic_share"] == 75.0 and b["traffic_share"] == 25.0 and a["ref_domains"] == 7 and b["ref_domains"] is None
    assert r["summary"]["traffic"] == 40.0 and r["summary"]["traffic_change"] == 100.0 and r["summary"]["organic_pages"] == 2 and a["keywords"] == 4


def test_endpoint(client):
    bid = client.post("/api/v1/businesses", json={"name": "Pages Co", "website": "https://pagesco.in"}).json()["id"]
    j = client.get(f"/api/v1/businesses/{bid}/seo/top-pages-report").json()
    assert j["state"] == "ok" and j["total"] == 0 and j["has"] == {"crawl": False, "index": False, "ranks": False, "ai": False, "ref_domains": False}
    nosite = client.post("/api/v1/businesses", json={"name": "No Site"}).json()["id"]
    assert client.get(f"/api/v1/businesses/{nosite}/seo/top-pages-report").json()["state"] == "no_website"
