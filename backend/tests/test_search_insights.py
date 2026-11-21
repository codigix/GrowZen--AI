from app.services import search_insights as si


def test_path_of():
    assert si.path_of("https://x.com/a/b/?utm=1") == "/a/b"
    assert si.path_of("https://x.com") == "/" and si.path_of("/") == "/"


def test_low_ctr_finds_pages_that_earn_less_than_usual():
    rows = [{"key": "p1", "clicks": 3, "impressions": 1000, "ctr": 0.003, "position": 4.2},    # expected 8%: clearly low
            {"key": "p2", "clicks": 90, "impressions": 1000, "ctr": 0.09, "position": 4.0},   # fine
            {"key": "p3", "clicks": 0, "impressions": 20, "ctr": 0.0, "position": 5.0},       # too few impressions
            {"key": "p4", "clicks": 1, "impressions": 900, "ctr": 0.001, "position": 1.5}]    # top position: not this check
    out = si.low_ctr(rows, "page")
    assert [r["page"] for r in out] == ["p1"] and out[0]["clicks_missing"] > 60 and out[0]["expected_ctr"] == 8.0




def test_check_page_refuses_another_site():
    import types

    import pytest
    b = types.SimpleNamespace(website="https://mine.example/")
    with pytest.raises(si.PageCheckError):
        si.check_site_page(None, b, "https://other.example/page")


def test_norm_url_ignores_www_slash_and_query():
    assert si.norm_url("https://www.x.com/a/?q=1") == si.norm_url("http://x.com/a") == "x.com/a"
    assert si.norm_url("https://x.com") == "x.com/"


def test_read_robots_finds_blocks_sitemaps_and_ai_bots():
    txt = "User-agent: *\nDisallow: /private\n\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: https://x.com/sitemap.xml\n"
    r = si.read_robots(txt, 200, "x.com", ["https://x.com/", "https://x.com/private/a"])
    assert r["found"] and r["sitemaps"] == ["https://x.com/sitemap.xml"] and not r["blocks_google"]
    assert next(b for b in r["ai_bots"] if b["bot"] == "GPTBot")["allowed"] is False
    assert next(b for b in r["ai_bots"] if b["bot"] == "ClaudeBot")["allowed"] is True
    assert r["blocked_pages"] == ["https://x.com/private/a"]
    assert si.read_robots("", 404, "x.com", [])["found"] is False


def test_llms_files_follow_the_format(monkeypatch):
    import types
    pages = {"https://x.com/": {"url": "https://x.com/", "title": "X Shop", "description": "We sell x.", "h1": "", "text": "word " * 60, "words": 60},
             "https://x.com/products": {"url": "https://x.com/products", "title": "X Shop", "description": "We sell x.", "h1": "", "text": "", "words": 0},
             "https://x.com/privacy": {"url": "https://x.com/privacy", "title": "X Shop", "description": "We sell x.", "h1": "", "text": "", "words": 0}}
    monkeypatch.setattr(si, "read_sitemap", lambda b, host: {"found": True, "urls": [{"url": u} for u in pages]})
    monkeypatch.setattr(si, "_page_facts", lambda u: pages[u])
    b = types.SimpleNamespace(website="https://x.com/", name="X", description="X sells x in Pune.", business_brief=None, primary_category="Shop", services=[], phone="123", address="Pune", area=None, city=None, contact_email=None)
    out = si.build_llms(None, b)
    txt = out["llms_txt"]
    assert txt.startswith("# X\n\n> X sells x in Pune.") and "## Main pages" in txt and "## Optional" in txt
    assert "- [Products](https://x.com/products)" in txt and "- [Privacy](https://x.com/privacy)" in txt  # same title everywhere: named from the address
    assert out["llms_full_txt"].count("Source: https://x.com/") == 3 and any("same title" in n for n in out["notes"])


def test_snapshot_opens_from_storage_and_refreshes_in_the_background(client, monkeypatch):
    import time

    bid = client.post("/api/v1/businesses", json={"name": "Snap Co", "website": "https://snap.example/"}).json()["id"]
    calls = []
    monkeypatch.setattr(si, "build_fresh", lambda db, user, b: calls.append(1) or {"search_console": {"state": "ok"}, "built_at": "now"})
    url = f"/api/v1/businesses/{bid}/search-insights"
    first = client.get(url).json()
    assert first["data"] is None and first["refreshing"] is True  # nothing stored yet: answers at once, reads in the background
    for _ in range(50):
        time.sleep(0.1)
        again = client.get(url).json()
        if not again["refreshing"]:
            break
    assert again["data"]["built_at"] == "now" and again["fetched_at"] and len(calls) == 1
    assert client.get(url).json()["data"] and len(calls) == 1  # fresh: opens from storage, no new read
    assert client.post(url + "/refresh?kind=insights").json() == {"insights": True}
