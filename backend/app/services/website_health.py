"""Website health, merged: what the site audit (whole site, plain HTML) and Page X-Ray (one page, can be read as a browser renders it) both say, grouped by topic.

Both tools check titles, descriptions, headings, images, links, indexing, security, structured data and speed, so their findings used to be shown twice (and sometimes disagree).
This groups them by topic, shows each tool's view side by side, lists a problem once, and says so when the two disagree and why: the audit crawler reads the plain HTML, so on a
site drawn with JavaScript it can report a problem a browser never sees. Nothing is re-run: it reads the latest saved audit and the latest saved Page X-Ray of the homepage.
"""
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, GrowthAction

TOPICS = [
    ("rendering", "Content readable without JavaScript"), ("titles", "Page titles"), ("descriptions", "Meta descriptions"), ("headings", "Headings"), ("content", "Content and readability"),
    ("images", "Images and alt text"), ("links", "Links"), ("indexing", "Indexing and crawling"), ("security", "HTTPS and security"), ("speed", "Speed and page weight"),
    ("mobile", "Mobile and page setup"), ("social", "Social sharing"), ("structured", "Structured data"), ("accessibility", "Accessibility"), ("ai", "AI and answer engines"),
]
LABEL = dict(TOPICS)
AUDIT_TOPIC = {
    "javascript_only": "rendering", "duplicate_titles": "titles", "missing_title": "titles", "title_length": "titles", "missing_meta_description": "descriptions", "h1_count": "headings", "thin_content": "content",
    "missing_alt": "images", "no_viewport": "mobile", "noindex": "indexing", "http_error": "links", "no_https": "security", "no_sitemap": "indexing", "robots_blocks_all": "indexing",
    "no_localbusiness_schema": "structured", "slow_mobile": "speed", "slow_desktop": "speed", "broken_links": "links",
}
XRAY_TOPIC = {
    "title": "titles", "descriptive_title": "titles", "description": "descriptions", "description_unique": "descriptions", "one_h1": "headings", "outline": "headings", "words": "content", "short_paragraphs": "content",
    "lists_tables": "content", "numbers": "content", "alt": "images", "a11y_img_alt": "images", "internal_links": "links", "outbound": "links", "redirects": "links", "status_200": "links", "canonical": "indexing",
    "single_canonical": "indexing", "indexable": "indexing", "not_noindex": "indexing", "sitemap": "indexing", "https": "security", "no_mixed_content": "security", "cert": "security", "page_weight": "speed",
    "response_time": "speed", "viewport": "mobile", "lang": "mobile", "favicon": "mobile", "og": "social", "twitter_card": "social", "faq_schema": "structured", "org_schema": "structured",
    "entity_consistent": "structured", "question_headings": "ai", "direct_answer": "ai", "date": "ai", "author": "ai", "eeat": "ai", "ai_crawlers": "ai", "llms_txt": "ai",
}
PAIR = {"no_localbusiness_schema": "org_schema", "missing_alt": "alt", "title_length": "title", "duplicate_titles": "title", "missing_title": "title", "missing_meta_description": "description", "h1_count": "one_h1",
        "thin_content": "words", "no_viewport": "viewport", "noindex": "indexable", "no_https": "https"}  # the same question asked by both tools
SEVERITY = {"critical": 0, "serious": 1, "warning": 2, "info": 3}


def _topic_of_xray(key: str) -> str:
    return "accessibility" if key.startswith("a11y_") and key != "a11y_img_alt" else XRAY_TOPIC.get(key, "content")


def _audit_issues(db: Session, b: Business) -> tuple[list[dict[str, Any]], dict[str, str | None]]:
    from . import audits
    latest = audits.latest(db, b, with_result=False)
    out: dict[tuple[str, str], dict[str, Any]] = {}
    dates: dict[str, str | None] = {}
    for kind in ("onpage", "technical"):
        a = latest.get(kind)
        if a is None or a.status != "done" or a.data_source == "sample":
            continue
        dates[kind] = a.finished_at.isoformat() if a.finished_at else None
        for i in a.issues or []:
            code = str(i.get("code") or "")
            if not code:
                continue
            k = (kind, code)
            row = out.setdefault(k, {"code": code, "level": i.get("level") or "warning", "title": i.get("title") or code, "fix": i.get("fix"), "count": 0, "kind": kind})
            row["count"] += max(1, int(i.get("count") or 1))
            if SEVERITY.get(i.get("level") or "warning", 2) < SEVERITY.get(row["level"], 2):
                row["level"] = i["level"]
    return list(out.values()), dates


def build(db: Session, b: Business) -> dict[str, Any]:
    from . import audit_overview, growth_metrics
    issues, audit_dates = _audit_issues(db, b)
    try:
        report, why = growth_metrics._latest_xray(db, b)
    except Exception:  # noqa: BLE001
        report, why = None, "Page X-Ray could not be read."
    tasks = {a.key: a for a in db.scalars(select(GrowthAction).where(GrowthAction.business_id == b.id, GrowthAction.period == "fix", GrowthAction.key.like("fix.xray.%")))}
    rendered = bool(report and ((report.get("rendering") or {}).get("mode") == "chrome" or (report.get("rendering") or {}).get("js_required")))
    topics: dict[str, dict[str, Any]] = {k: {"key": k, "label": lab, "site": [], "page": [], "notes": []} for k, lab in TOPICS}
    for i in issues:
        t = AUDIT_TOPIC.get(i["code"], "content")
        plain = audit_overview.ISSUES.get(i["code"])
        topics[t]["site"].append({"code": i["code"], "title": plain[0] if plain else i["title"], "level": i["level"], "count": i["count"], "fix": (plain[1] if plain else i["fix"]), "kind": i["kind"]})
    for area in ("seo", "aeo", "geo"):
        for c in ((report or {}).get("scores", {}).get(area) or {}).get("checks", []):
            if c.get("key") == "cert" and c.get("passed"):
                pass
            t = _topic_of_xray(c["key"])
            task = tasks.get(f"fix.xray.{c['key']}")
            topics[t]["page"].append({"key": c["key"], "area": area, "label": c.get("label"), "passed": bool(c.get("passed")), "detail": c.get("detail"), "fix": None if c.get("passed") else c.get("fix"),
                                      "task_id": task.id if task else None, "task_status": task.status if task else None})
    out = []
    for k, _ in TOPICS:
        t = topics[k]
        if not t["site"] and not t["page"]:
            continue
        page_fail = [p for p in t["page"] if not p["passed"]]
        site_fail = t["site"]
        status = "fail" if (page_fail or any(s["level"] in ("critical", "serious") for s in site_fail)) else "warn" if site_fail else "ok"
        if not t["page"] and not site_fail:
            status = "ok"
        passed = {p["key"] for p in t["page"] if p["passed"]}
        for it in site_fail:
            pair = PAIR.get(it["code"])
            if pair and pair in passed:
                it["differs"] = ("The audit crawler reads the plain HTML of each page; Page X-Ray read the homepage as a browser shows it and this check passes. " if rendered else "Page X-Ray checked the homepage and this check passes, so the problem is on other pages of the site. ") + (
                    "On a site built with JavaScript the audit can report something a visitor never sees: confirm in Page X-Ray before fixing." if rendered else "Open the audit report to see which pages.")
                t["notes"].append({"kind": "differs", "text": f"“{it['title']}”: " + it["differs"]})
        if it_js := next((i for i in site_fail if i["code"] == "javascript_only"), None):
            words = int(((report or {}).get("content") or {}).get("word_count") or 0) if rendered else 0
            if words >= 100:
                it_js["differs"] = f"Page X-Ray, reading the homepage as a browser, found {words} words of real content: visitors and Google's renderer see the page. Crawlers that do not run JavaScript (many AI and social bots) still see it empty."
                t["notes"].append({"kind": "differs", "text": it_js["differs"]})
        if status == "fail" and site_fail and all(i.get("differs") for i in site_fail) and not page_fail:
            status = "warn"  # every audit finding here is contradicted by the rendered page: a warning to confirm, not a failure
        if page_fail and not site_fail and audit_dates and k in ("headings", "accessibility", "ai"):
            t["notes"].append({"kind": "page_only", "text": "Only Page X-Ray checks this (on the homepage): the audit's whole-site crawl does not."})
        t["status"], t["failing"] = status, len(page_fail) + len(site_fail)
        out.append(t)
    attention = [t for t in out if t["status"] in ("fail", "warn")]
    return {"topics": out, "audit": {"dates": audit_dates, "has": bool(audit_dates)}, "xray": {"has": bool(report), "url": (report or {}).get("final_url") or (report or {}).get("url"), "at": (report or {}).get("fetched_at"), "rendered": rendered,
            "scores": {a: ((report or {}).get("scores", {}).get(a) or {}).get("score") for a in ("seo", "aeo", "geo")}, "reason": None if report else why},
            "summary": {"topics": len(out), "need_attention": len(attention), "ok": len(out) - len(attention), "raw_audit_issues": sum(s["count"] for t in out for s in t["site"]), "raw_xray_failed": sum(1 for t in out for p in t["page"] if not p["passed"]),
                        "differs": sum(1 for t in out for n in t["notes"] if n["kind"] == "differs")}}
