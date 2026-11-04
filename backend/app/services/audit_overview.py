"""The Site Audit project table: one row per audited website with its health figures and how each moved since the audit before.
Every figure is computed from the saved audit (crawl + Lighthouse): nothing here is estimated."""
import re
from typing import Any

ERROR_LEVELS = {"error", "serious", "critical", "high"}
WARN_LEVELS = {"warning", "medium"}


def _pct(n: int, d: int) -> int | None:
    return round(n / d * 100) if d else None


def _num(v: Any) -> float | None:
    m = re.search(r"[\d.]+", str(v or "").replace(",", ""))
    return float(m.group()) if m else None


def metrics(result: dict, issues: list[dict], score: int | None) -> dict[str, Any]:
    crawl = (result or {}).get("crawl") or {}
    ps = (result or {}).get("pagespeed") or {}
    pages = crawl.get("pages") or []
    n = len(pages)
    errors = sum(1 for i in issues if str(i.get("level")).lower() in ERROR_LEVELS)
    warnings = sum(1 for i in issues if str(i.get("level")).lower() in WARN_LEVELS)

    # Crawlability: pages Google can fetch and index, and the site-wide files that guide it
    ok = sum(1 for p in pages if (p.get("status") or 0) < 400 and not p.get("noindex"))
    crawlability = _pct(ok, n)
    if crawlability is not None:
        if crawl.get("robots_blocks_all"):
            crawlability = 0
        else:
            crawlability = max(0, crawlability - (0 if crawl.get("robots_txt") else 5) - (0 if crawl.get("sitemap") else 5))

    https = _pct(sum(1 for p in pages if str(p.get("url", "")).startswith("https://")), n) if crawl.get("https") else (0 if n else None)

    # International SEO: only when the site declares language versions (hreflang)
    intl = _pct(sum(1 for p in pages if (p.get("hreflang") or 0) > 0), n) or None

    marks = _pct(sum(1 for p in pages if p.get("schema_types")), n) or None
    linked = _pct(sum(1 for p in pages if (p.get("inbound") or 0) > 0 or p.get("url") == crawl.get("start_url")), n)

    # AI search health: the on-page facts answer engines rely on (clear title, description, one H1, structured data, crawl access)
    checks: list[bool] = []
    for p in pages:
        checks += [bool(p.get("title_length")), bool(p.get("meta_description_length")), p.get("h1_count") == 1, bool(p.get("schema_types")), bool(p.get("canonical"))]
    checks += [bool(crawl.get("robots_txt")) and not crawl.get("robots_blocks_all"), bool(crawl.get("sitemap")), bool(crawl.get("https"))]
    ai = _pct(sum(checks), len(checks)) if pages else None

    m = ps.get("metrics") or {}
    lcp, cls, tbt = _num(m.get("lcp")), _num(m.get("cls")), _num(m.get("tbt"))
    vitals = [lcp <= 2.5 if lcp is not None else None, cls <= 0.1 if cls is not None else None, tbt <= 200 if tbt is not None else None]
    known = [v for v in vitals if v is not None]
    return {
        "pages": crawl.get("crawled", n), "limit": crawl.get("max_pages"), "health": score, "ai": ai, "errors": errors, "warnings": warnings,
        "crawlability": crawlability, "https": https, "intl": intl, "performance": (ps.get("scores") or {}).get("performance"),
        "linking": linked, "markups": marks, "vitals": {"pass": sum(known), "of": len(known), "lcp": m.get("lcp"), "cls": m.get("cls"), "tbt": m.get("tbt")} if known else None,
    }


def row(latest: Any, prev: Any | None) -> dict[str, Any]:
    now = metrics(latest.result, latest.issues or [], latest.score)
    before = metrics(prev.result, prev.issues or [], prev.score) if prev else None
    diff = {k: (now[k] - before[k] if before and isinstance(now[k], (int, float)) and isinstance(before[k], (int, float)) else None)
            for k in ("health", "ai", "errors", "warnings", "crawlability", "https", "performance", "linking")}
    return {"id": latest.id, "target": latest.target, "finished_at": latest.finished_at.isoformat() if latest.finished_at else None, **now, "diff": diff}


# What each issue code means in plain words (the issue list's own titles name one page each)
ISSUES = {
    "duplicate_titles": ("Duplicate title tags", "Add a unique and concise title for every page"),
    "missing_title": ("Missing title tag", "Add a unique 50-60 character title to every page"),
    "title_length": ("Title tag length", "Keep titles between 25 and 60 characters"),
    "missing_meta_description": ("Missing meta description", "Add a concise meta description for every page"),
    "h1_count": ("Missing or multiple H1", "Use exactly one relevant H1 heading per page"),
    "thin_content": ("Low word count", "Use at least 300 words for your on-page content"),
    "missing_alt": ("Images without alt text", "Add short descriptive alt text to every image"),
    "no_viewport": ("No viewport tag", "Add a viewport meta tag so pages work on mobile"),
    "noindex": ("Pages blocked from indexing", "Remove noindex from pages that should rank"),
    "http_error": ("Broken pages", "Fix the page or redirect it to the closest live page"),
    "javascript_only": ("Content only appears with JavaScript", "Use server-side rendering or pre-rendering so search engines see the text"),
    "no_https": ("Site not served over HTTPS", "Install a certificate and redirect http to https"),
    "no_sitemap": ("No XML sitemap", "Publish /sitemap.xml and submit it in Search Console"),
    "robots_blocks_all": ("robots.txt blocks the whole site", "Remove 'Disallow: /' for all crawlers"),
    "no_localbusiness_schema": ("No LocalBusiness structured data", "Add LocalBusiness JSON-LD to the home and contact pages"),
}


def kind_of(level: str | None) -> str:
    lv = str(level or "").lower()
    return "error" if lv in ERROR_LEVELS else "warning" if lv in WARN_LEVELS else "notice"


def _views(crawl: dict, issues: list[dict]) -> tuple[list[dict], list[dict]]:
    """Issues grouped by type (errors first) and the pages with the most issues."""
    from . import crawler
    pages = crawl.get("pages") or []
    groups: dict[str, dict[str, Any]] = {}
    for i in issues:
        code = i.get("code") or i.get("title", "")[:40]
        label, fix = ISSUES.get(code, (i.get("title"), i.get("fix")))
        g = groups.setdefault(code, {"code": code, "title": label, "fix": fix or i.get("fix"), "kind": kind_of(i.get("level")), "area": i.get("area"), "count": 0})
        g["count"] += len(i.get("pages") or []) or 1
    order = {"error": 0, "warning": 1, "notice": 2}
    top = sorted(groups.values(), key=lambda g: (order[g["kind"]], -g["count"], g["title"] or ""))
    dup = {u for i in issues if i.get("code") == "duplicate_titles" for u in (i.get("pages") or [])}
    improve = []
    for p in pages:
        found = crawler.page_issues(p) if p.get("status") is not None and p.get("title_length") is not None else []
        items = [{"title": ISSUES.get(f["code"], (f["title"],))[0], "kind": kind_of(f["level"])} for f in found]
        if p.get("url") in dup or p.get("title") in dup:
            items.insert(0, {"title": ISSUES["duplicate_titles"][0], "kind": "error"})
        if items:
            improve.append({"url": p["url"], "issues": len(items), "items": items})
    improve.sort(key=lambda r: -r["issues"])
    return top, improve[:50]


def _page(target: str, finished_at: Any, now: dict, prev: dict | None, crawl: dict, issues: list[dict], trend: list[dict], strategy: str | None, audit_id: int | None) -> dict[str, Any]:
    pages = crawl.get("pages") or []
    top, improve = _views(crawl, issues)
    broken = sum(1 for p in pages if (p.get("status") or 0) >= 400)
    return {"id": audit_id, "target": target, "finished_at": finished_at.isoformat() if finished_at else None, "strategy": strategy, **now, "previous": prev, "broken": broken,
            "with_issues": len(improve), "crawled": len(pages), "top_issues": top, "pages_to_improve": improve, "trend": trend,
            "robots": {"found": bool(crawl.get("robots_txt")), "blocks_all": bool(crawl.get("robots_blocks_all"))}, "sitemap": bool(crawl.get("sitemap")), "total_issues": sum(g["count"] for g in top)}


def detail(db: Any, a: Any) -> dict[str, Any]:
    """The Overview page of one website audit (the Site Audit tool's scans)."""
    from sqlalchemy import select

    from ..models import Audit
    crawl = (a.result or {}).get("crawl") or {}
    now = metrics(a.result, a.issues or [], a.score)
    prev = list(db.scalars(select(Audit).where(Audit.kind == "website", Audit.status == "done", Audit.target == a.target).order_by(Audit.finished_at.desc(), Audit.id.desc()).limit(30)))
    trend = []
    for x in reversed(prev):
        m = metrics(x.result, x.issues or [], x.score)
        trend.append({"date": x.finished_at.date().isoformat() if x.finished_at else None, "health": m["health"], "errors": m["errors"], "warnings": m["warnings"], "issues": len(x.issues or [])})
    before = next((x for x in prev if x.id != a.id and x.finished_at and a.finished_at and x.finished_at < a.finished_at), None)
    return _page(a.target, a.finished_at, now, metrics(before.result, before.issues or [], before.score) if before else None, crawl, a.issues or [], trend, ((a.result or {}).get("pagespeed") or {}).get("strategy"), a.id)


def for_project(db: Any, b: Any) -> dict[str, Any] | None:
    """The Overview page of a project: its latest on-page crawl and Lighthouse run, with the same figures as the Site Audit table."""
    from sqlalchemy import select

    from ..models import Audit, GeoResult
    from . import geo, site_health
    q = lambda kind: list(db.scalars(select(Audit).where(Audit.business_id == b.id, Audit.kind == kind, Audit.status == "done").order_by(Audit.id.desc()).limit(30)))  # noqa: E731
    onpage, tech = q("onpage"), q("technical")
    if not onpage and not tech:
        return None
    op, te = (onpage[0] if onpage else None), (tech[0] if tech else None)
    crawl = (op.result if op else None) or {}
    ps = (te.result if te else None) or {}

    def figures(o: Any, t: Any) -> dict[str, Any]:
        return site_health.breakdown(o.result if o else None, o.score if o else None, t.result if t else None, [i for x in (o, t) if x for i in (x.issues or [])])

    def mapped(f: dict, ai: Any) -> dict[str, Any]:
        return {"pages": f["pages_crawled"], "limit": crawl.get("max_pages"), "health": f["site_health"], "ai": ai, "errors": f["errors"], "warnings": f["warnings"], "crawlability": f["crawlability"],
                "https": f["https"], "intl": f["int_seo"], "performance": f["performance"], "linking": f["internal_linking"], "markups": f["markups"], "vitals": None}
    geo_rows = list(db.scalars(select(GeoResult).where(GeoResult.business_id == b.id).order_by(GeoResult.created_at.desc())))
    sov = geo.share_of_voice(db, b, geo_rows)
    ai = sov["overall"] if sov.get("data_source") else None
    now = mapped(figures(op, te), ai)
    mm = (ps.get("metrics") or {})
    lcp, cls, tbt = _num(mm.get("lcp")), _num(mm.get("cls")), _num(mm.get("tbt"))
    have = [x for x in (lcp, cls, tbt) if x is not None]
    if have:
        now["vitals"] = {"pass": sum(1 for v in ((lcp, 2.5), (cls, 0.1), (tbt, 200)) if v[0] is not None and v[0] <= v[1]), "of": len(have), "lcp": mm.get("lcp"), "cls": mm.get("cls"), "tbt": mm.get("tbt")}
    prev = None
    if len(onpage) > 1 or len(tech) > 1:
        prev = mapped(figures(onpage[1] if len(onpage) > 1 else None, tech[1] if len(tech) > 1 else None), None)
    issues = [i for x in (op, te) if x for i in (x.issues or [])]
    trend = []
    for o in reversed(onpage):
        t = next((x for x in tech if x.id <= o.id or (x.finished_at and o.finished_at and x.finished_at <= o.finished_at)), None)
        f = site_health.breakdown(o.result, o.score, t.result if t else None, [i for x in (o, t) if x for i in (x.issues or [])])
        upto = [g for g in geo_rows if o.finished_at and g.created_at and g.created_at <= o.finished_at]
        s = geo.share_of_voice(db, b, upto) if upto else None
        trend.append({"date": o.finished_at.date().isoformat() if o.finished_at else None, "health": f["site_health"], "ai": s["overall"] if s and s.get("data_source") else None,
                      "errors": f["errors"], "warnings": f["warnings"], "issues": len(o.issues or []) + (len(t.issues or []) if t else 0)})
    stamps = [x.finished_at for x in (op, te) if x and x.finished_at]
    return _page(b.website or b.name, max(stamps) if stamps else None, now, prev, crawl, issues, trend, ps.get("strategy"), op.id if op else None)


def report_for_project(db: Any, b: Any) -> dict[str, Any] | None:
    """Everything the Site Audit tabs show for a project: each check's result, the audit history (for Compare and Progress), the crawled pages
    with the checks each fails, the statistics and the JavaScript dependence."""
    from sqlalchemy import select

    from ..models import Audit
    from . import audit_checks, site_health
    q = lambda kind: list(db.scalars(select(Audit).where(Audit.business_id == b.id, Audit.kind == kind, Audit.status == "done").order_by(Audit.id.desc()).limit(30)))  # noqa: E731
    onpage, tech = q("onpage"), q("technical")
    if not onpage:
        return None
    history = []
    for o in onpage:
        t = next((x for x in tech if x.id <= o.id or (x.finished_at and o.finished_at and x.finished_at <= o.finished_at)), None)
        res = audit_checks.run(o.result, o.issues)
        f = site_health.breakdown(o.result, o.score, t.result if t else None, [i for x in (o, t) if x for i in (x.issues or [])])
        history.append({"id": o.id, "date": o.finished_at.isoformat() if o.finished_at else None, "pages": len(((o.result or {}).get("pages")) or []), "health": f["site_health"],
                        "totals": audit_checks.totals(res), "counts": {c: r["count"] for c, r in res.items()}, "limit": (o.result or {}).get("max_pages")})
    latest = onpage[0]
    crawl = latest.result or {}
    res = audit_checks.run(crawl, latest.issues)
    per_page = audit_checks.page_issues(crawl, latest.issues)
    pages = [{"url": p["url"], "title": p.get("title"), "status": p.get("status"), "depth": p.get("depth"), "inbound": p.get("inbound"), "out": p.get("internal_out"), "words": p.get("word_count"),
              "h1": p.get("h1_count"), "canonical": p.get("canonical"), "schema": p.get("schema_types") or [], "text_ratio": p.get("text_ratio"), "js_only": bool(p.get("javascript_only")),
              "images": p.get("images"), "meta": p.get("meta_description_length"), "issues": per_page.get(p["url"], [])} for p in (crawl.get("pages") or [])]
    ps = next((x.result for x in tech if x.result), None) or {}
    js_pages = [p for p in pages if p["js_only"]]
    return {"project": b.name, "target": b.website or "", "finished_at": history[0]["date"], "strategy": ps.get("strategy"), "pages_crawled": len(pages), "limit": crawl.get("max_pages"),
            "checks": audit_checks.catalog(), "results": res, "totals": audit_checks.totals(res), "health": history[0]["health"], "history": history, "pages": pages,
            "statistics": audit_checks.statistics(crawl),
            "js": {"pages": len(pages), "js_only": len(js_pages), "urls": [p["url"] for p in js_pages][:100], "avg_words": round(sum(p["words"] or 0 for p in pages) / len(pages)) if pages else 0},
            "site": {"https": bool(crawl.get("https")), "sitemap": bool(crawl.get("sitemap")), "robots": bool(crawl.get("robots_txt")), "sitemap_pages": crawl.get("sitemap_pages") or 0}}
