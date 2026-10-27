"""The AI agent: a planner turns audit results into tasks; workers draft the changes; a person
approves (or the playbook's autopilot rules do); approved tasks are applied through the APIs.

Nothing reaches Google or the website from here without passing `needs_approval` first.
"""
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import AgentTask, Business, Post, Review
from . import ai, gbp
from .activity import log
from .playbook import get_playbook

IMPACT = {"critical": "High", "serious": "High", "warning": "Medium", "info": "Low"}
# Kinds that change what the public sees always ask, whatever the playbook says.
ALWAYS_ASK = {"profile_edit"}


def needs_approval(db: Session, kind: str, detail: dict[str, Any] | None = None) -> bool:
    if kind in ALWAYS_ASK:
        return True
    rules = get_playbook(db).approval_rules or {}
    if kind == "review_reply" and detail is not None:
        return bool(rules.get("review_reply_low" if (detail.get("rating") or 5) <= 3 else "review_reply_high", True))
    return bool(rules.get(kind, True))


def _task(db: Session, b: Business, agent: str, kind: str, title: str, impact: str, **detail: Any) -> AgentTask:
    existing = db.scalar(select(AgentTask).where(AgentTask.business_id == b.id, AgentTask.kind == kind, AgentTask.title == title, AgentTask.status == "pending"))
    if existing:
        return existing
    t = AgentTask(business_id=b.id, agent=agent, kind=kind, title=title, impact=impact, detail=detail, requires_approval=needs_approval(db, kind, detail))
    db.add(t)
    return t


def plan_from_audits(db: Session, b: Business, issues: list[dict[str, Any]]) -> list[AgentTask]:
    """Planner: one task per actionable issue, highest impact first, capped per run."""
    order = {"critical": 0, "serious": 1, "warning": 2, "info": 3}
    tasks: list[AgentTask] = []
    for i in sorted(issues, key=lambda x: order.get(x.get("level"), 9))[:10]:
        area = i.get("area", "")
        kind = "profile_edit" if area == "GBP" else "website_fix" if area in ("Technical", "On-page", "Structured data", "Crawlability", "Indexing", "Mobile", "Security", "Speed", "Images") else "outreach_email" if area in ("Backlinks", "Citations") else "profile_edit"
        tasks.append(_task(db, b, {"profile_edit": "gbp", "website_fix": "audit", "outreach_email": "outreach"}[kind], kind, i["title"], IMPACT.get(i.get("level"), "Medium"), fix=i.get("fix", ""), area=area))
    db.commit()
    return tasks


def draft_review_replies(db: Session, b: Business, language: str = "English") -> int:
    """Review agent: draft a reply for every unanswered review."""
    drafted = 0
    for r in db.scalars(select(Review).where(Review.business_id == b.id, Review.reply_status == "none").limit(20)):
        text = ai.complete(
            f"You reply to Google reviews for the business owner.\n{ai.RULES}\n- Never offer anything in exchange for reviews.\n- For negative reviews: thank, acknowledge the issue, invite them to contact the business offline.",
            f"Business profile:\n{ai.profile_text(b)}\n\nReview ({r.rating} stars) by {r.author or 'a customer'}:\n\"{r.body or '(rating only)'}\"\n\nWrite the owner's reply in {language}, 40-90 words. Return only the reply.",
            max_tokens=400) if ai.is_configured() else None
        if not text:
            continue
        r.reply_text, r.reply_status, r.reply_language = text, "draft", language
        _task(db, b, "review", "review_reply", f"Reply to {r.rating}★ review by {r.author or 'a customer'}", "High" if r.rating <= 3 else "Medium", review_id=r.id, rating=r.rating, text=text)
        drafted += 1
    db.commit()
    return drafted


def draft_weekly_post(db: Session, b: Business, topic: str = "") -> AgentTask | None:
    """GBP agent: draft this week's post."""
    if not ai.is_configured():
        return None
    out = ai.complete_json(f"You write Google Business Profile posts.\n{ai.RULES}",
                           f"Business profile:\n{ai.profile_text(b)}\n\nWrite one Update post{' about: ' + topic if topic else ' about one main service'}, under 1200 characters. Return JSON {{\"title\": \"\", \"body\": string, \"cta_type\": \"BOOK\"|\"LEARN_MORE\"|\"CALL\"}}.")
    post = Post(business_id=b.id, post_type="Update", title=out.get("title") or None, body=str(out.get("body", ""))[:1500], cta_type=out.get("cta_type"), cta_url=b.booking_url or b.website, status="draft", ai_generated=True)
    db.add(post)
    db.flush()
    task = _task(db, b, "gbp", "gbp_post", f"Weekly post: {post.body[:60]}…", "Medium", post_id=post.id, body=post.body)
    db.commit()
    return task


def decide(db: Session, task: AgentTask, approve: bool, actor: str) -> AgentTask:
    task.status = "approved" if approve else "rejected"
    task.decided_by, task.decided_at = actor, datetime.now(timezone.utc)
    log(db, actor, "task_approved" if approve else "task_rejected", task.business_id, task_id=task.id, title=task.title)
    db.commit()
    if approve:
        apply(db, task, actor)
    return task


def apply(db: Session, task: AgentTask, actor: str = "agent") -> AgentTask:
    """Carry out an approved task. Google writes need the business linked to a connected account."""
    b = db.get(Business, task.business_id)
    try:
        if task.kind == "review_reply":
            r = db.get(Review, task.detail.get("review_id"))
            if b.connection and b.gbp_account and r and r.external_id:
                gbp.GbpClient(b.connection).reply_review(b.gbp_account, b.gbp_location, r.external_id, task.detail.get("text") or r.reply_text)
                r.reply_status, r.replied_at = "posted", datetime.now(timezone.utc)
                task.result = {"posted": True}
            else:
                task.result = {"posted": False, "note": "Not linked to Google: reply saved, post it manually."}
        elif task.kind == "gbp_post":
            p = db.get(Post, task.detail.get("post_id"))
            if p and b.connection and b.gbp_account:
                created = gbp.GbpClient(b.connection).create_post(b.gbp_account, b.gbp_location, {"post_type": p.post_type, "title": p.title, "body": p.body, "cta_type": p.cta_type, "cta_url": p.cta_url, "image_url": p.image_url})
                p.status, p.external_id, p.published_at = "published", created.get("name"), datetime.now(timezone.utc)
                task.result = {"published": True}
            else:
                task.result = {"published": False, "note": "Not linked to Google."}
        else:
            # Profile edits, website fixes and outreach are handed to a person with the drafted fix.
            task.result = {"handoff": True, "note": "Assigned for the team to carry out."}
        task.status, task.applied_at = "applied", datetime.now(timezone.utc)
        log(db, actor, "task_applied", task.business_id, task_id=task.id, kind=task.kind, result=task.result)
    except Exception as exc:
        task.status, task.result = "failed", {"error": str(exc)[:500]}
        log(db, actor, "task_failed", task.business_id, task_id=task.id, error=str(exc)[:200])
    db.commit()
    return task


def auto_apply_pending(db: Session) -> int:
    """Autopilot: apply pending tasks whose kind doesn't need approval."""
    n = 0
    for t in db.scalars(select(AgentTask).where(AgentTask.status == "pending", AgentTask.requires_approval.is_(False))):
        t.status = "approved"
        t.decided_by = "autopilot"
        apply(db, t, "autopilot")
        n += 1
    return n
