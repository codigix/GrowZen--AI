"""Site Audit table figures: crawlability, HTTPS, markups, internal linking, Core Web Vitals and their gaps."""
from app.services import site_health


def page(url, **kw):
    return {"url": url, "status": 200, "noindex": False, "javascript_only": False, "schema_types": [], **kw}


CRAWL = {"https": True, "sitemap": True, "robots_blocks_all": False, "pages": [
    page("https://x.in/", schema_types=["LocalBusiness"], lang="en", inbound=3, internal_out=4),
    page("https://x.in/a", lang="en", inbound=1, internal_out=2),
    page("https://x.in/b", lang="", inbound=0, internal_out=0, status=404),
    page("http://x.in/c", lang="en", inbound=1, internal_out=1, noindex=True)]}
PS = {"scores": {"seo": 100, "performance": 61}, "metrics": {"lcp": "3.9 s", "cls": "0.003", "tbt": "150 ms"}}


def test_breakdown_from_a_crawl_and_a_lighthouse_run():
    b = site_health.breakdown(CRAWL, 80, PS, [{"level": "critical"}, {"level": "serious"}, {"level": "warning"}, {"level": "info"}])
    assert b["pages_crawled"] == 4 and b["site_health"] == 90 and b["errors"] == 2 and b["warnings"] == 1
    assert b["crawlability"] == 50  # the 404 and the noindex page are not crawlable/indexable
    assert b["https"] == 75 and b["markups"] == 25 and b["performance"] == 61
    assert b["int_seo"] == 75  # three of four pages declare a language
    assert b["internal_linking"] == 67  # of the 3 inner pages, the orphan is the one without inbound links
    assert b["core_web_vitals"] == 67  # CLS and TBT pass, LCP (3.9 s) does not


def test_figures_an_old_audit_cannot_support_stay_empty():
    old = {"https": True, "sitemap": False, "robots_blocks_all": False, "pages": [page("https://x.in/"), page("https://x.in/a")]}
    b = site_health.breakdown(old, 70, None, [])
    assert b["int_seo"] is None and b["internal_linking"] is None  # no language / link data recorded then
    assert b["performance"] is None and b["core_web_vitals"] is None
    assert b["crawlability"] == 95  # no sitemap costs 5
    assert site_health.breakdown(None, None, None, [])["crawlability"] is None


def test_robots_blocking_everything_is_zero_crawlability():
    assert site_health.breakdown(CRAWL | {"robots_blocks_all": True}, 80, PS, [])["crawlability"] == 0
