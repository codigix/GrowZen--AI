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
