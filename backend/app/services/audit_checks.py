"""Site Audit checks: the list of things the audit looks for, each counted from the saved crawl (page facts and site-wide files).

Only checks the crawl can really measure are listed; a check that needs data we do not collect (page speed of each file, HSTS headers,
external links...) is not listed, so a 0 here always means "checked and clean", never "not looked at".
Page-level checks count pages; site-level checks count 1 (or the number of broken links).
"""
from collections import Counter
from typing import Any, Callable
from urllib.parse import urlparse

# (code, severity, category, label, how to fix, page test or None, site test or None)
Page = dict[str, Any]
Site = dict[str, Any]


def _ok(p: Page) -> bool:
    return (p.get("status") or 0) < 400


def _dupes(pages: list[Page], key: str) -> set[str]:
    c = Counter((p.get(key) or "").strip().lower() for p in pages if _ok(p))
    return {k for k, n in c.items() if k and n > 1}


CHECKS: list[tuple[str, str, str, str, str, Callable | None, Callable | None]] = [
    # Errors
    ("http_5xx", "error", "Crawlability", "5xx errors", "Fix the server error or redirect the page", lambda p, c: (p.get("status") or 0) >= 500, None),
    ("http_4xx", "error", "Crawlability", "4xx errors", "Fix the page or 301-redirect it to the closest live page", lambda p, c: 400 <= (p.get("status") or 0) < 500, None),
    ("missing_title", "error", "Meta tags", "Missing title tags", "Add a unique 50-60 character title to every page", lambda p, c: _ok(p) and not p.get("title_length"), None),
    ("duplicate_title", "error", "Meta tags", "Duplicate title tags", "Add a unique and concise title for every page", lambda p, c: _ok(p) and (p.get("title") or "").strip().lower() in c["dup_titles"], None),
    ("duplicate_meta", "error", "Meta tags", "Duplicate meta descriptions", "Write a unique meta description for every page", lambda p, c: _ok(p) and (p.get("meta_description") or "").strip().lower() in c["dup_meta"], None),
    ("viewport_missing", "error", "Mobile", "Viewport not configured", 'Add <meta name="viewport" content="width=device-width, initial-scale=1>', lambda p, c: _ok(p) and not p.get("has_viewport"), None),
    ("non_secure", "error", "HTTPS", "Non-secure pages", "Serve every page over HTTPS and redirect http to https", lambda p, c: str(p.get("url", "")).startswith("http://"), None),
    ("no_https", "error", "HTTPS", "HTTPS encryption not used", "Install a certificate and redirect http to https", None, lambda c: 0 if c.get("https") else 1),
    ("robots_blocks_all", "error", "Crawlability", "robots.txt blocks the whole site", "Remove 'Disallow: /' for all crawlers", None, lambda c: 1 if c.get("robots_blocks_all") else 0),
    ("broken_links", "error", "Crawlability", "Broken internal links", "Update or remove links to pages that do not load", None, lambda c: len(c.get("broken") or [])),
    ("js_only", "error", "Crawlability", "Content only appears with JavaScript", "Use server-side rendering or pre-rendering so search engines see the text", lambda p, c: bool(p.get("javascript_only")), None),
    # Warnings
    ("title_short", "warning", "Meta tags", "Short title element", "Use 25-60 characters so the title says what the page is about", lambda p, c: _ok(p) and 0 < (p.get("title_length") or 0) < 25, None),
    ("title_long", "warning", "Meta tags", "Long title element", "Keep titles within 60 characters so Google does not cut them", lambda p, c: _ok(p) and (p.get("title_length") or 0) > 60, None),
    ("missing_h1", "warning", "Content", "Missing h1", "Add a concise and relevant H1 heading to the page", lambda p, c: _ok(p) and p.get("h1_count") == 0, None),
    ("missing_meta", "warning", "Meta tags", "Missing meta description", "Add a concise meta description of 150-160 characters", lambda p, c: _ok(p) and not p.get("meta_description_length"), None),
    ("low_word_count", "warning", "Content", "Low word count", "Use at least 200 words of useful on-page content", lambda p, c: _ok(p) and 0 < (p.get("word_count") or 0) < 200, None),
    ("low_text_ratio", "warning", "Content", "Low text to HTML ratio", "Reduce code and add visible text", lambda p, c: _ok(p) and p.get("text_ratio") is not None and p["text_ratio"] < 10, None),
    ("missing_alt", "warning", "Content", "Missing ALT attributes", "Add short descriptive alt text to every image", lambda p, c: bool(p.get("images_missing_alt")), None),
    ("missing_canonical", "warning", "Meta tags", "Missing canonical tag", 'Add <link rel="canonical"> pointing at the preferred URL', lambda p, c: _ok(p) and not p.get("canonical"), None),
    ("missing_lang", "warning", "Meta tags", "Missing lang attribute", 'Add lang="en" (or the page language) to the <html> tag', lambda p, c: _ok(p) and "lang" in p and not p.get("lang"), None),
    ("no_sitemap", "warning", "Crawlability", "Sitemap.xml not found", "Publish /sitemap.xml and submit it in Search Console", None, lambda c: 0 if c.get("sitemap") else 1),
    ("no_localbusiness", "warning", "Markup", "No LocalBusiness structured data", "Add LocalBusiness JSON-LD to the home and contact pages", None, lambda c: 1 if c.get("_no_local") else 0),
    # Notices
    ("multiple_h1", "notice", "Content", "Multiple h1 tags", "Use exactly one H1 per page", lambda p, c: _ok(p) and (p.get("h1_count") or 0) > 1, None),
    ("no_robots", "notice", "Crawlability", "Robots.txt not found", "Add a robots.txt that points to your sitemap", None, lambda c: 0 if c.get("robots_txt") else 1),
    ("noindex_pages", "notice", "Crawlability", "Pages with noindex", "Remove noindex from pages that should rank", lambda p, c: bool(p.get("noindex")), None),
    ("one_inbound", "notice", "Links", "Pages with only one internal link", "Link to these pages from more related pages", lambda p, c: p.get("depth") != 0 and p.get("inbound") == 1, None),
    ("orphan", "notice", "Links", "Orphaned pages (no internal links)", "Link to these pages from a menu or related page", lambda p, c: p.get("depth") != 0 and p.get("inbound") == 0 and p is not c["first"], None),
    ("deep_pages", "notice", "Links", "Page crawl depth more than 3 clicks", "Link to deep pages from higher-level pages", lambda p, c: (p.get("depth") or 0) > 3, None),
    ("missing_og", "notice", "Markup", "Missing Open Graph tags", "Add og:title, og:description and og:image so shares look right", lambda p, c: _ok(p) and "og_title" in p and not p.get("og_title"), None),
    ("no_markup", "notice", "Markup", "Pages without structured data", "Add schema.org JSON-LD that describes the page", lambda p, c: _ok(p) and not p.get("schema_types"), None),
]
BY_CODE = {c[0]: c for c in CHECKS}
SEVERITIES = ("error", "warning", "notice")


def _context(crawl: Site, issues: list[dict]) -> dict[str, Any]:
    pages = crawl.get("pages") or []
    return {**crawl, "dup_titles": _dupes(pages, "title"), "dup_meta": _dupes(pages, "meta_description"), "first": pages[0] if pages else None,
            "_no_local": any(i.get("code") == "no_localbusiness_schema" for i in issues)}


def run(crawl: Site | None, issues: list[dict] | None = None) -> dict[str, Any]:
    """Every check's result for one crawl: {code: {count, urls}} (urls are the affected pages; site-level checks have none)."""
    crawl = crawl or {}
    pages = crawl.get("pages") or []
    ctx = _context(crawl, issues or [])
    out: dict[str, dict[str, Any]] = {}
    for code, _sev, _cat, _label, _fix, page_test, site_test in CHECKS:
        if page_test:
            urls = [p["url"] for p in pages if page_test(p, ctx)]
            out[code] = {"count": len(urls), "urls": urls[:200]}
        else:
            out[code] = {"count": int(site_test(ctx)), "urls": []}
    return out


def totals(result: dict[str, dict[str, Any]]) -> dict[str, int]:
    t = {s: 0 for s in SEVERITIES}
    for code, r in result.items():
        t[BY_CODE[code][1]] += r["count"]
    return {"errors": t["error"], "warnings": t["warning"], "notices": t["notice"], "issues": sum(t.values())}


def page_issues(crawl: Site, issues: list[dict] | None = None) -> dict[str, list[dict]]:
    """For each crawled page the checks it fails, worst first."""
    pages = crawl.get("pages") or []
    ctx = _context(crawl, issues or [])
    out: dict[str, list[dict]] = {}
    order = {s: i for i, s in enumerate(SEVERITIES)}
    for p in pages:
        found = [{"code": c[0], "severity": c[1], "label": c[3], "fix": c[4]} for c in CHECKS if c[5] and c[5](p, ctx)]
        found.sort(key=lambda f: order[f["severity"]])
        out[p["url"]] = found
    return out


def catalog() -> list[dict[str, str]]:
    return [{"code": c[0], "severity": c[1], "category": c[2], "label": c[3], "fix": c[4], "scope": "page" if c[5] else "site"} for c in CHECKS]


def statistics(crawl: Site) -> dict[str, Any]:
    """Distributions over the crawled pages for the Statistics tab."""
    pages = crawl.get("pages") or []
    n = len(pages)
    pct = lambda k: round(k / n * 100) if n else 0  # noqa: E731
    by_class = Counter(f"{(p.get('status') or 0) // 100}xx" if p.get("status") else "none" for p in pages)
    listed = {u.rstrip("/").lower() for u in (crawl.get("sitemap_urls") or [])}
    in_sitemap = sum(1 for p in pages if p["url"].rstrip("/").lower() in listed) if listed else None
    depth = Counter(min(p["depth"], 4) if p.get("depth") is not None else None for p in pages)
    inbound = Counter("0" if (p.get("inbound") or 0) == 0 else "1" if p["inbound"] == 1 else "2-5" if p["inbound"] <= 5 else "6-15" if p["inbound"] <= 15 else "16-50" if p["inbound"] <= 50 else "51+" for p in pages)
    host = urlparse(crawl.get("start_url", "")).netloc.removeprefix("www.")
    canon = Counter()
    for p in pages:
        c = p.get("canonical")
        canon["none" if not c else "self" if c.rstrip("/").lower() == p["url"].rstrip("/").lower() else "other"] += 1
    return {
        "pages": n,
        "http": {"bad": pct(by_class["4xx"] + by_class["5xx"]), **{k: pct(by_class[k]) for k in ("5xx", "4xx", "3xx", "2xx", "1xx", "none")}},
        "sitemap": {"listed": crawl.get("sitemap_pages") or 0, "found_in_sitemap": pct(in_sitemap) if in_sitemap is not None else None, "not_in_sitemap": 100 - pct(in_sitemap) if in_sitemap is not None else None},
        "depth": {"deep": pct(sum(v for k, v in depth.items() if k is not None and k > 3)), "levels": {str(k): pct(v) for k, v in sorted(depth.items(), key=lambda x: (x[0] is None, x[0])) if k is not None}, "unknown": pct(depth[None])},
        "inbound": {"one": pct(inbound["1"]), "zero": pct(inbound["0"]), **{k: pct(inbound[k]) for k in ("2-5", "6-15", "16-50", "51+")}},
        "markup": {"none": pct(sum(1 for p in pages if not p.get("schema_types"))), "json_ld": pct(sum(1 for p in pages if p.get("schema_types"))), "open_graph": pct(sum(1 for p in pages if p.get("og_title"))),
                   "twitter": pct(sum(1 for p in pages if p.get("twitter_card")))},
        "canonical": {"missing": pct(canon["none"]), "other": pct(canon["other"]), "self": pct(canon["self"])},
        "content": {"avg_words": round(sum(p.get("word_count") or 0 for p in pages) / n) if n else 0, "thin": pct(sum(1 for p in pages if 0 < (p.get("word_count") or 0) < 200)),
                    "with_h1": pct(sum(1 for p in pages if p.get("h1_count") == 1)), "with_meta": pct(sum(1 for p in pages if p.get("meta_description_length"))),
                    "with_title": pct(sum(1 for p in pages if p.get("title_length")))},
        "host": host,
    }
