"""The journey: the order in which a business sets up and grows online, with what each step needs first.

Ten steps, each decided from the project's real stored data (no network, instant): is it done, what is left, which earlier step it waits for, and the page where it is done.
The pages show it as a "step bar" so a person always knows where they are, what must come before, and what comes next:
  1 Business details   2 Google profile   3 Website check   4 Keywords   5 Competitors   6 Fix problems   7 Posts and photos   8 Reviews   9 Backlinks   10 Report
A step is "blocked" only when an earlier step it truly depends on is not done yet (a post cannot be published before the Google profile is linked).
"""
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import AgentTask, Article, Audit, BacklinkCheck, Business, GrowthAction, GrowthReport, Keyword, Post, Review

STEPS: list[dict[str, Any]] = [
    # The order of a project's SEO: 1 business analysis, 2 competitors, 3 keywords, 4 keyword mapping, 5 website audit and fixes, 6 content, links and tracking.
    # A step with "module" only exists for a project that uses that service (a project that does SEO only never sees the Google profile steps).
    {"key": "details", "title": "Business details", "why": "What the business sells, to whom, where and why: every other step starts from it.", "link": "/onboarding", "requires": []},
    {"key": "competitors", "title": "Know your competitors", "why": "Competitors show which searches and links you are missing.", "link": "/competitor-finder", "requires": ["details"]},
    {"key": "keywords", "title": "Choose keywords", "why": "Keywords decide what content, pages and rankings aim at.", "link": "/keyword-management/workspace", "requires": ["details"]},
    {"key": "mapping", "title": "Map keywords to pages", "why": "Every keyword needs one page, and every page one main keyword; the rest are missing pages or blog posts.", "link": "/keyword-management/mapping", "requires": ["keywords", "website"]},
    {"key": "website", "title": "Check the website", "why": "A site audit finds what search engines cannot read or trust.", "link": "/website-audit", "requires": ["details"]},
    {"key": "fix", "title": "Fix the problems found", "why": "Open issues hold back rankings and trust. Each one has an exact fix.", "link": "/fix-plan", "requires": ["website"]},
    {"key": "content", "title": "Write content", "why": "Blog posts and pages from your keywords bring the searches in.", "link": "/ai-content-generation/blog", "requires": ["keywords"]},
    {"key": "links", "title": "Build and check backlinks", "why": "Links from real websites raise authority; broken or nofollow ones do not.", "link": "/backlink-checker", "requires": ["website"]},
    {"key": "report", "title": "Follow the weekly report", "why": "The report shows what moved and what to do next.", "link": "/growth#reports", "requires": ["details"]},
    {"key": "google", "module": "gmb", "title": "Connect the Google profile", "why": "Needed to read reviews and performance and to publish posts, replies and photos.", "link": "/gmb-profile/profile", "requires": ["details"]},
    {"key": "publish", "module": "gmb", "title": "Post and add photos", "why": "Fresh posts and photos keep the Google profile active.", "link": "/google-posts", "requires": ["google"]},
    {"key": "reviews", "module": "gmb", "title": "Get and answer reviews", "why": "Reviews are the strongest local trust signal.", "link": "/gmb-profile/reviews", "requires": ["google"]},
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _n(db: Session, q) -> int:
    return int(db.scalar(q) or 0)


def evaluate(db: Session, b: Business) -> dict[str, Any]:
    since = _now() - timedelta(days=30)
    state: dict[str, dict[str, Any]] = {}

    from . import project_services
    mods = project_services.enabled(b)
    seo_family = any(m in mods for m in ("seo", "geo", "aeo"))
    checks = [("name", b.name), ("services", b.services), ("goals", b.goals)]
    if seo_family:
        checks.append(("website", b.website))
    if "gmb" in mods:
        checks += [("category", b.primary_category), ("city", b.city), ("phone", b.phone)]
    elif (b.target_scope or "local") == "local":
        checks.append(("city or target areas", b.city or b.target_areas))
    missing = [lab for lab, v in checks if not (v if isinstance(v, (list, dict)) else (v or "").strip())]
    state["details"] = {"done": not missing, "detail": "All details are filled in." if not missing else f"Missing: {', '.join(missing)}.", "metric": f"{len(checks) - len(missing)} of {len(checks)} filled"}

    linked = bool(b.connection_id and b.gbp_account and b.gbp_location)
    state["google"] = {"done": linked, "detail": "The Google profile is connected." if linked else "Not connected yet.", "metric": "connected" if linked else "not connected"}

    # Only the score of the last site audit is needed here: not its crawl `result` (large). The crawl is read below, once, and only when there are keywords to map.
    onpage = db.execute(select(Audit.score).where(Audit.business_id == b.id, Audit.kind == "onpage", Audit.status == "done", Audit.data_source != "sample").order_by(Audit.id.desc()).limit(1)).first()
    state["website"] = {"done": onpage is not None, "detail": f"Last site audit scored {onpage.score}/100." if onpage is not None and onpage.score is not None else ("A site audit was run." if onpage is not None else "No site audit yet."), "metric": f"{onpage.score}/100" if onpage is not None and onpage.score is not None else "not run"}

    from . import keywords as kwsvc
    # The tracked keywords are read once, with only the columns the journey and the mapping use, and shared by both. The journey does not use the competitor-research
    # part of the keyword progress, so that (large) read is skipped.
    kw_rows = list(db.execute(select(Keyword.keyword, Keyword.volume, Keyword.intent, Keyword.cluster, Keyword.target_url, Keyword.rank_checked_at, Keyword.uses, Keyword.rank, Keyword.role)
                              .where(Keyword.business_id == b.id, Keyword.tracked.is_(True)).order_by(Keyword.id)))
    kp = kwsvc.progress(db, b, rows=kw_rows, check_research=False)
    ungrouped = kp["saved"] - kp["grouped"]
    kw_done = kp["saved"] >= kp["min"] and ungrouped == 0
    state["keywords"] = {"done": kw_done, "detail": f"{kp['saved']} keywords tracked" + (f", {ungrouped} not grouped yet." if ungrouped else ".") + ("" if kp["saved"] >= kp["min"] else f" Aim for at least {kp['min']}."), "metric": f"{kp['saved']} tracked"}

    try:
        from ..competitors import hygiene
        from ..models import Competitor
        from . import site_guard
        # Only the two columns that are used (not the large `listing`). The owner's other websites are read once for the whole project, not once for every competitor.
        found = [c for c in db.execute(select(Competitor.selected, Competitor.website).where(Competitor.business_id == b.id)) if c.selected is not False]
        siblings = site_guard.sibling_hosts(db, b) if found else []
        comps = [c for c in found if not hygiene.skip_reason(b, c.website, siblings=siblings)]
    except Exception:  # noqa: BLE001
        comps = []
    state["competitors"] = {"done": len(comps) >= 3, "detail": f"{len(comps)} real competitors saved." + ("" if len(comps) >= 3 else " Find at least 3."), "metric": f"{len(comps)} saved"}

    # Only the severity inside `evidence` is used (not the why / how / verify / note text of each action).
    open_fix = list(db.scalars(select(GrowthAction.evidence).where(GrowthAction.business_id == b.id, GrowthAction.period == "fix", GrowthAction.status.in_(("todo", "done", "unverified", "failed", "blocked")))))
    sev = lambda ev: (ev or {}).get("severity", "warning")  # noqa: E731
    hard = [ev for ev in open_fix if sev(ev) in ("critical", "serious")]

    # Every count of this project in one round trip (each keeps its own filter): fixes verified, posts, reviews, backlink checks, primary keywords, articles, approvals waiting.
    counts = db.execute(select(
        select(func.count(GrowthAction.id)).where(GrowthAction.business_id == b.id, GrowthAction.period == "fix", GrowthAction.status == "verified").scalar_subquery(),
        select(func.count(Post.id)).where(Post.business_id == b.id, Post.status == "published", Post.published_at >= since).scalar_subquery(),
        select(func.count(Review.id)).where(Review.business_id == b.id, Review.reply_status != "posted").scalar_subquery(),
        select(func.count(Review.id)).where(Review.business_id == b.id).scalar_subquery(),
        select(func.count(BacklinkCheck.id)).where(BacklinkCheck.business_id == b.id).scalar_subquery(),
        select(func.count(BacklinkCheck.id)).where(BacklinkCheck.business_id == b.id, BacklinkCheck.state == "working").scalar_subquery(),
        select(func.count(Keyword.id)).where(Keyword.business_id == b.id, Keyword.role == "primary").scalar_subquery(),
        select(func.count(Article.id)).where(Article.business_id == b.id).scalar_subquery(),
        select(func.count(AgentTask.id)).where(AgentTask.business_id == b.id, AgentTask.status == "pending", AgentTask.requires_approval.is_(True), AgentTask.kind.in_(("gbp_post", "review_reply", "profile_edit", "gbp_photo", "keyword_add"))).scalar_subquery(),
    )).one()
    verified, posts, unanswered, all_reviews, checked, working, primaries, arts, pending = (int(v or 0) for v in counts)

    scanned = bool(open_fix) or verified > 0
    state["fix"] = {"done": scanned and not hard, "detail": (f"{len(hard)} critical or serious problems open ({len(open_fix)} in all)." if hard else ("No critical or serious problems open." if scanned else "The problem scan has not run yet: press Start plan.")),
                    "metric": f"{len(open_fix)} open"}

    photos = int(b.photo_count or 0)
    state["publish"] = {"done": posts >= 4 and photos >= 10, "detail": f"{posts} posts in the last 30 days (aim for 4+), {photos} photos (aim for 10+).", "metric": f"{posts} posts · {photos} photos"}

    total = int(b.review_count or 0) or all_reviews
    state["reviews"] = {"done": total >= 10 and unanswered == 0, "detail": f"{total} reviews, {unanswered} without a reply." + ("" if total >= 10 else " Ask customers: aim for 10+."), "metric": f"{total} reviews"}

    state["links"] = {"done": working >= 5, "detail": f"{working} working backlinks confirmed out of {checked} checked." + ("" if working >= 5 else " Aim for 5+ confirmed."), "metric": f"{working} working"}

    rep = db.execute(select(GrowthReport.emailed_at).where(GrowthReport.business_id == b.id).order_by(GrowthReport.period_start.desc()).limit(1)).first()  # only whether it was emailed, not the report data
    emailed = rep.emailed_at if rep is not None else None
    state["report"] = {"done": bool(emailed), "detail": ("The latest report was emailed " + emailed.date().isoformat() + ".") if emailed else ("A report exists but was not emailed." if rep is not None else "No report yet: it is made every Monday."), "metric": "emailed" if emailed else "none"}

    from . import keyword_mapping
    if kw_rows:
        # The crawl is only needed to match keywords to pages. It is the newest finished site audit of the project (the same one `audits.latest` picks), read alone:
        # `audits.latest` would read the large result of every kind of audit. A sample crawl counts as no crawl, as before.
        last = db.execute(select(Audit.result, Audit.data_source, Audit.finished_at).where(Audit.business_id == b.id, Audit.kind == "onpage", Audit.status == "done")
                          .order_by(Audit.finished_at.desc(), Audit.id.desc()).limit(1)).first()
        crawl = {} if last is None or last.data_source == "sample" else {**(last.result or {}), "_found": last.finished_at.date().isoformat() if last.finished_at else None}
        mp = keyword_mapping.plan(db, b, kws=kw_rows, crawl=crawl)
    else:
        mp = {"keywords": 0}  # no tracked keywords: nothing to map, and the journey only says "Save keywords first"
    if not mp["keywords"]:
        state["mapping"] = {"done": False, "detail": "Save keywords first.", "metric": "no keywords"}
    elif not mp["crawled"]:
        state["mapping"] = {"done": False, "detail": "Scan the website first, so keywords can be matched to its pages.", "metric": "website not scanned"}
    else:
        state["mapping"] = {"done": mp["unmapped"] == 0 and primaries > 0, "detail": f"{mp['mapped']} of {mp['keywords']} keywords have a page; {len(mp['missing_pages'])} pages and {len(mp['blog_opportunities'])} posts are missing." + ("" if primaries else " Save the mapping to set each page's primary keyword."), "metric": f"{mp['mapped']}/{mp['keywords']} mapped"}
    state["content"] = {"done": arts >= 1, "detail": f"{arts} article{'s' if arts != 1 else ''} written." if arts else "No article yet: write one from your keywords.", "metric": f"{arts} articles"}

    active = [x for x in STEPS if x.get("module") is None or x["module"] in mods]
    steps, done_keys = [], {x["key"] for x in active if state[x["key"]]["done"]}
    by_key = {x["key"]: x for x in STEPS}
    for i, spec in enumerate(active, 1):
        st = state[spec["key"]]
        waiting = [r for r in spec["requires"] if r not in done_keys and any(a["key"] == r for a in active)]
        status = "done" if st["done"] else ("blocked" if waiting else "todo")
        steps.append({"key": spec["key"], "order": i, "title": spec["title"], "why": spec["why"], "link": spec["link"], "status": status, "detail": st["detail"], "metric": st["metric"],
                      "requires": [{"key": r, "title": by_key[r]["title"], "done": r in done_keys} for r in spec["requires"] if r in by_key and any(a["key"] == r for a in active)], "waiting_for": [{"key": r, "title": by_key[r]["title"], "link": by_key[r]["link"]} for r in waiting]})
    nxt = next((s for s in steps if s["status"] == "todo"), None) or next((s for s in steps if s["status"] == "blocked"), None)
    return {"steps": steps, "done": len(done_keys), "total": len(steps), "percent": round(len(done_keys) / len(steps) * 100), "next": {"key": nxt["key"], "title": nxt["title"], "link": nxt["link"], "detail": nxt["detail"],
            "blocked_by": nxt["waiting_for"]} if nxt else None, "approvals_waiting": pending}
