"""The SEO plan as six stages, from what the project already has: each stage is a list of checks read from real data, and the roadmap is the checks still open, in order.

1 Business analysis · 2 Competitor research · 3 Keyword research · 4 Keyword mapping · 5 Website SEO audit · 6 Strategy and execution.
Nothing here runs a scan or calls an outside service: it reads what is saved, so it is fast and always matches the other pages.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Article, Audit, Business, Keyword, KeywordCandidate
from . import audits, keyword_mapping, onboarding_plan

STAGES = [
    ("business", "Business analysis", "Know what you sell, to whom, where and why."),
    ("competitors", "Competitor research", "Find who you compete with on Google and what they win."),
    ("keywords", "Keyword research", "Collect the searches your customers use."),
    ("mapping", "Keyword mapping", "Give every keyword its page, and find the pages and posts you are missing."),
    ("audit", "Website SEO audit", "Technical, on-page, speed, indexing and links."),
    ("execution", "Strategy and execution", "Fix, write, link and track."),
]


def _s(key: str, title: str, done: bool, detail: str, to: str, action: str = "Open") -> dict[str, Any]:
    return {"key": key, "title": title, "done": bool(done), "detail": detail, "to": to, "action": action}


def _business(b: Business) -> list[dict[str, Any]]:
    svc = [s for s in (b.services or []) if s] or ([b.primary_category] if b.primary_category else [])
    areas = [x for x in (b.target_areas or []) if x] or [x for x in (b.target_countries or []) if x] or ([b.city] if b.city else [])
    return [
        _s("services", "Services and products", bool(svc), f"{len(svc)} listed" if svc else "Add what the business sells.", "/gmb-profile/profile?sub=edit", "Add services"),
        _s("audience", "Target audience", bool((b.target_audience or "").strip()), (b.target_audience or "")[:90] or "Who are the customers? Write it in the form below.", "/seo-journey#business", "Describe"),
        _s("locations", "Target locations", bool(areas), ", ".join(areas[:3]) or "Where do the customers live?", "/seo-journey#business", "Set"),
        _s("goals", "Business goals", bool(b.goals), ", ".join(b.goals or [])[:90] or "What should SEO bring: calls, bookings, leads, sales?", "/seo-journey#business", "Set"),
    ]


def _competitors(db: Session, b: Business) -> list[dict[str, Any]]:
    from ..competitors import hygiene
    doms = hygiene.saved_competitor_domains(db, b, limit=8)
    run = db.scalar(select(Audit).where(Audit.kind == "intel", Audit.target == f"business:{b.id}", Audit.status == "done").order_by(Audit.id.desc()))
    res = (run.result or {}) if run else {}
    gaps = len((res.get("gaps") or {}).get("keywords") or [])
    pages = any(o for s in res.get("serps") or [] for o in s.get("organic") or [] if not o.get("mine"))
    return [
        _s("list", "3 to 5 direct competitors", 3 <= len(doms) <= 8, f"{len(doms)} saved" + (": " + ", ".join(doms[:3]) if doms else ""), "/competitor-finder", "Find competitors"),
        _s("ranking", "Who ranks on Google for your keywords", bool(run), "Researched" if run else "Run the competitor research.", "/competitor-finder", "Run research"),
        _s("traffic", "Their organic traffic (estimate)", bool(run and pages), "Estimated from rankings and searches" if run and pages else "Needs the research above.", "/competitor-finder?tab=pages", "See traffic"),
        _s("pages", "Their top-ranking pages", bool(run and pages), "Pages in the top 10 are listed per competitor" if run and pages else "Needs the research above.", "/competitor-finder?tab=pages", "See pages"),
        _s("gaps", "Keyword gaps", bool(run), f"{gaps} found" if run else "Needs the research above.", "/keyword-management/workspace?tag=gap", "See gaps"),
    ]


def _keywords(db: Session, b: Business) -> list[dict[str, Any]]:
    cands = list(db.scalars(select(KeywordCandidate).where(KeywordCandidate.business_id == b.id)))
    saved = db.scalar(select(func.count(Keyword.id)).where(Keyword.business_id == b.id, Keyword.tracked.is_(True))) or 0
    kinds = {s.get("kind") for c in cands for s in c.sources or []}
    local = sum(1 for c in cands if c.intent == "local")
    longtail = sum(1 for c in cands if len(c.keyword.split()) >= 4)
    vol = sum(1 for c in cands if c.volume)
    diff = sum(1 for c in cands if c.difficulty is not None)
    w = "/keyword-management/workspace"
    return [
        _s("collect", "Primary and secondary keywords collected", len(kinds) >= 2 and len(cands) >= 20, f"{len(cands)} keywords from {len(kinds)} place{'s' if len(kinds) != 1 else ''}", w, "Collect"),
        _s("volume", "Search volume", vol > 0, f"{vol} with searches per month" if vol else "Connect Google Ads to get volumes.", "/google-integrations", "Connect"),
        _s("difficulty", "Keyword difficulty", diff > 0, f"{diff} with difficulty" if diff else "Comes with the Google Ads volumes.", "/google-integrations", "Connect"),
        _s("intent", "Search intent", bool(cands), "Every keyword has an intent (buy, compare, learn, local)" if cands else "Collect keywords first.", w, "Open"),
        _s("local", "Local keywords", local > 0, f"{local} found" if local else "None yet: add services with the city.", w, "Open"),
        _s("longtail", "Long-tail keywords", longtail > 0, f"{longtail} of 4 words or more" if longtail else "None yet.", w, "Open"),
        _s("picked", "Keywords picked for the project", saved >= 10, f"{saved} saved (aim for 10 or more)", w, "Pick"),
    ]


def _mapping(db: Session, b: Business) -> list[dict[str, Any]]:
    m = keyword_mapping.plan(db, b)
    roles = db.scalar(select(func.count(Keyword.id)).where(Keyword.business_id == b.id, Keyword.role == "primary")) or 0
    n = m["keywords"]
    to = "/keyword-mapping"
    if not n:
        wait = "Save keywords first."
        return [_s("map", "Keywords mapped to existing pages", False, wait, to), _s("primary", "Primary keyword for each page", False, wait, to), _s("missing", "Missing pages", False, wait, to), _s("blog", "Blog opportunities", False, wait, to)]
    if not m["crawled"]:
        wait = "Scan the website first (Website Audit)."
        return [_s("map", "Keywords mapped to existing pages", False, wait, "/website-audit"), _s("primary", "Primary keyword for each page", False, wait, "/website-audit"), _s("missing", "Missing pages", False, wait, "/website-audit"), _s("blog", "Blog opportunities", False, wait, "/website-audit")]
    return [
        _s("map", "Keywords mapped to existing pages", m["mapped"] == n, f"{m['mapped']} of {n} have a page", to, "Map"),
        _s("primary", "Primary keyword for each page", roles > 0 and roles >= m["primaries"], f"{roles} saved as primary" if roles else f"{m['primaries']} suggested: press Save the mapping.", to, "Save the mapping"),
        _s("missing", "Missing pages identified", not m["missing_pages"], f"{len(m['missing_pages'])} pages to create" if m["missing_pages"] else "No missing pages", to, "See"),
        _s("blog", "Blog opportunities identified", not m["blog_opportunities"], f"{len(m['blog_opportunities'])} post ideas" if m["blog_opportunities"] else "None open", "/ai-content-generation/blog", "Write"),
    ]


def _audit(db: Session, b: Business, latest: dict[str, Audit], phases: dict[str, Any]) -> list[dict[str, Any]]:
    web = phases.get("website") or {}
    steps = {s["key"]: s for s in web.get("steps", [])}
    readable = steps.get("readable", {})
    return [
        _s("onpage", "On-page SEO audit", "onpage" in latest, "Done" if "onpage" in latest else "Scan the website.", "/website-audit", "Scan"),
        _s("technical", "Technical SEO and Core Web Vitals", "technical" in latest, "Done" if "technical" in latest else "Run the speed test.", "/website-audit", "Run"),
        _s("index", "Indexing and crawlability", "onpage" in latest and readable.get("open", 1) == 0, f"{readable.get('open', 0)} to fix" if "onpage" in latest else "Scan the website first.", "/fix-plan", "Fix"),
        _s("backlinks", "Backlink analysis", "backlinks" in latest, "Done" if "backlinks" in latest else "Run the backlink audit.", "/backlinks/audit", "Run"),
    ]


def _execution(db: Session, b: Business, latest: dict[str, Audit], phases: dict[str, Any]) -> list[dict[str, Any]]:
    web = phases.get("website") or {}
    articles = db.scalar(select(func.count(Article.id)).where(Article.business_id == b.id)) or 0
    ranked = db.scalar(select(func.count(Keyword.id)).where(Keyword.business_id == b.id, Keyword.rank_checked_at.is_not(None))) or 0
    return [
        _s("pages", "Optimize website pages", web.get("status") == "done", f"{web.get('open', 0)} changes left" if web.get("open") else "Website steps are done", "/fix-plan", "Open Fix Plan"),
        _s("content", "Content strategy", articles >= 1, f"{articles} article{'s' if articles != 1 else ''} written" if articles else "Write the first blog post from your keywords.", "/ai-content-generation/blog", "Write"),
        _s("links", "Backlink plan", "backlinks" in latest, "Backlink audit done" if "backlinks" in latest else "Run the backlink audit, then plan outreach.", "/backlinks/opportunities", "Plan"),
        _s("tracking", "Ranking and traffic tracking", ranked > 0, f"{ranked} keywords checked on Google" if ranked else "Check where your keywords rank.", "/keyword-management/status", "Check ranks"),
    ]


def journey(db: Session, b: Business) -> dict[str, Any]:
    latest = audits.latest(db, b, with_result=False)
    try:
        phases = {p["key"]: p for p in onboarding_plan.plan(db, b)["phases"]}
    except Exception:  # noqa: BLE001 - the plan page's own data must not stop this page
        phases = {}
    built = {"business": _business(b), "competitors": _competitors(db, b), "keywords": _keywords(db, b), "mapping": _mapping(db, b), "audit": _audit(db, b, latest, phases), "execution": _execution(db, b, latest, phases)}
    stages, current = [], None
    for n, (key, title, goal) in enumerate(STAGES, 1):
        steps = built[key]
        done = sum(1 for s in steps if s["done"])
        status = "done" if done == len(steps) else "current" if current is None else "next"
        if status == "current":
            current = key
        stages.append({"n": n, "key": key, "title": title, "goal": goal, "steps": steps, "done": done, "total": len(steps), "status": status})
    roadmap = [{"stage": s["n"], "stage_title": s["title"], "title": st["title"], "detail": st["detail"], "to": st["to"], "action": st["action"]} for s in stages for st in s["steps"] if not st["done"]]
    return {"stages": stages, "current": current, "roadmap": roadmap[:14], "open": len(roadmap), "done": sum(s["done"] for s in stages), "total": sum(s["total"] for s in stages)}
