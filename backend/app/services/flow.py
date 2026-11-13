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

from ..models import AgentTask, Audit, BacklinkCheck, Business, GrowthAction, GrowthReport, Keyword, Post, Review

STEPS: list[dict[str, Any]] = [
    {"key": "details", "title": "Business details", "why": "Name, category, address, phone and website are used by every other step.", "link": "/projects", "requires": []},
    {"key": "google", "title": "Connect the Google profile", "why": "Needed to read reviews and performance and to publish posts, replies and photos.", "link": "/gmb-profile/profile", "requires": ["details"]},
    {"key": "website", "title": "Check the website", "why": "A site audit finds what search engines cannot read or trust.", "link": "/website-audit", "requires": ["details"]},
    {"key": "keywords", "title": "Choose keywords", "why": "Keywords decide what content, posts and rankings aim at.", "link": "/keyword-management/discover", "requires": ["details"]},
    {"key": "competitors", "title": "Know your competitors", "why": "Competitors show which searches and links you are missing.", "link": "/competitor-finder", "requires": ["details"]},
    {"key": "fix", "title": "Fix the problems found", "why": "Open issues hold back rankings and trust. Each one has an exact fix.", "link": "/growth#issues", "requires": ["website"]},
    {"key": "publish", "title": "Post and add photos", "why": "Fresh posts and photos keep the Google profile active.", "link": "/google-posts", "requires": ["google"]},
    {"key": "reviews", "title": "Get and answer reviews", "why": "Reviews are the strongest local trust signal.", "link": "/gmb-profile/reviews", "requires": ["google"]},
    {"key": "links", "title": "Build and check backlinks", "why": "Links from real websites raise authority; broken or nofollow ones do not.", "link": "/backlink-checker", "requires": ["website"]},
    {"key": "report", "title": "Follow the weekly report", "why": "The report shows what moved and what to do next.", "link": "/growth#reports", "requires": ["details"]},
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _n(db: Session, q) -> int:
    return int(db.scalar(q) or 0)


def evaluate(db: Session, b: Business) -> dict[str, Any]:
    since = _now() - timedelta(days=30)
    state: dict[str, dict[str, Any]] = {}

    missing = [lab for lab, v in (("name", b.name), ("category", b.primary_category), ("address or city", b.address or b.city), ("phone", b.phone), ("website", b.website)) if not (v or "").strip()]
    state["details"] = {"done": not missing, "detail": "All details are filled in." if not missing else f"Missing: {', '.join(missing)}.", "metric": f"{5 - len(missing)} of 5 filled"}

    linked = bool(b.connection_id and b.gbp_account and b.gbp_location)
    state["google"] = {"done": linked, "detail": "The Google profile is connected." if linked else "Not connected yet.", "metric": "connected" if linked else "not connected"}

    onpage = db.scalar(select(Audit).where(Audit.business_id == b.id, Audit.kind == "onpage", Audit.status == "done", Audit.data_source != "sample").order_by(Audit.id.desc()).limit(1))
    state["website"] = {"done": bool(onpage), "detail": f"Last site audit scored {onpage.score}/100." if onpage and onpage.score is not None else ("A site audit was run." if onpage else "No site audit yet."), "metric": f"{onpage.score}/100" if onpage and onpage.score is not None else "not run"}

    from . import keywords as kwsvc
    kp = kwsvc.progress(db, b)
    ungrouped = kp["saved"] - kp["grouped"]
    kw_done = kp["saved"] >= kp["min"] and ungrouped == 0
    state["keywords"] = {"done": kw_done, "detail": f"{kp['saved']} keywords tracked" + (f", {ungrouped} not grouped yet." if ungrouped else ".") + ("" if kp["saved"] >= kp["min"] else f" Aim for at least {kp['min']}."), "metric": f"{kp['saved']} tracked"}

    try:
        from ..competitors import hygiene
        from ..models import Competitor
        comps = [c for c in db.scalars(select(Competitor).where(Competitor.business_id == b.id)) if not hygiene.skip_reason(b, c.website)]
    except Exception:  # noqa: BLE001
        comps = []
    state["competitors"] = {"done": len(comps) >= 3, "detail": f"{len(comps)} real competitors saved." + ("" if len(comps) >= 3 else " Find at least 3."), "metric": f"{len(comps)} saved"}

    open_fix = list(db.scalars(select(GrowthAction).where(GrowthAction.business_id == b.id, GrowthAction.period == "fix", GrowthAction.status.in_(("todo", "done", "unverified", "failed", "blocked")))))
    sev = lambda a: (a.evidence or {}).get("severity", "warning")  # noqa: E731
    hard = [a for a in open_fix if sev(a) in ("critical", "serious")]
    scanned = bool(open_fix) or _n(db, select(func.count(GrowthAction.id)).where(GrowthAction.business_id == b.id, GrowthAction.period == "fix", GrowthAction.status == "verified")) > 0
    state["fix"] = {"done": scanned and not hard, "detail": (f"{len(hard)} critical or serious problems open ({len(open_fix)} in all)." if hard else ("No critical or serious problems open." if scanned else "The problem scan has not run yet: press Start plan.")),
                    "metric": f"{len(open_fix)} open"}

    posts = _n(db, select(func.count(Post.id)).where(Post.business_id == b.id, Post.status == "published", Post.published_at >= since))
    photos = int(b.photo_count or 0)
    state["publish"] = {"done": posts >= 4 and photos >= 10, "detail": f"{posts} posts in the last 30 days (aim for 4+), {photos} photos (aim for 10+).", "metric": f"{posts} posts · {photos} photos"}

    unanswered = _n(db, select(func.count(Review.id)).where(Review.business_id == b.id, Review.reply_status != "posted"))
    total = int(b.review_count or 0) or _n(db, select(func.count(Review.id)).where(Review.business_id == b.id))
    state["reviews"] = {"done": total >= 10 and unanswered == 0, "detail": f"{total} reviews, {unanswered} without a reply." + ("" if total >= 10 else " Ask customers: aim for 10+."), "metric": f"{total} reviews"}

    checked = _n(db, select(func.count(BacklinkCheck.id)).where(BacklinkCheck.business_id == b.id))
    working = _n(db, select(func.count(BacklinkCheck.id)).where(BacklinkCheck.business_id == b.id, BacklinkCheck.state == "working"))
    state["links"] = {"done": working >= 5, "detail": f"{working} working backlinks confirmed out of {checked} checked." + ("" if working >= 5 else " Aim for 5+ confirmed."), "metric": f"{working} working"}

    rep = db.scalar(select(GrowthReport).where(GrowthReport.business_id == b.id).order_by(GrowthReport.period_start.desc()).limit(1))
    state["report"] = {"done": bool(rep and rep.emailed_at), "detail": ("The latest report was emailed " + rep.emailed_at.date().isoformat() + ".") if rep and rep.emailed_at else ("A report exists but was not emailed." if rep else "No report yet: it is made every Monday."), "metric": "emailed" if rep and rep.emailed_at else "none"}

    steps, done_keys = [], {k for k, v in state.items() if v["done"]}
    by_key = {s["key"]: s for s in STEPS}
    for i, spec in enumerate(STEPS, 1):
        st = state[spec["key"]]
        waiting = [r for r in spec["requires"] if r not in done_keys]
        status = "done" if st["done"] else ("blocked" if waiting else "todo")
        steps.append({"key": spec["key"], "order": i, "title": spec["title"], "why": spec["why"], "link": spec["link"], "status": status, "detail": st["detail"], "metric": st["metric"],
                      "requires": [{"key": r, "title": by_key[r]["title"], "done": r in done_keys} for r in spec["requires"]], "waiting_for": [{"key": r, "title": by_key[r]["title"], "link": by_key[r]["link"]} for r in waiting]})
    nxt = next((s for s in steps if s["status"] == "todo"), None) or next((s for s in steps if s["status"] == "blocked"), None)
    pending = _n(db, select(func.count(AgentTask.id)).where(AgentTask.business_id == b.id, AgentTask.status == "pending", AgentTask.requires_approval.is_(True), AgentTask.kind.in_(("gbp_post", "review_reply", "profile_edit", "gbp_photo", "keyword_add"))))
    return {"steps": steps, "done": len(done_keys), "total": len(steps), "percent": round(len(done_keys) / len(steps) * 100), "next": {"key": nxt["key"], "title": nxt["title"], "link": nxt["link"], "detail": nxt["detail"],
            "blocked_by": nxt["waiting_for"]} if nxt else None, "approvals_waiting": pending}
