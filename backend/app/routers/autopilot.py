"""Autopilot API: what is prepared, what waits for approval, what is scheduled, and the one-click decisions.

GET  /businesses/{id}/autopilot                     settings, the approval inbox, the schedule, results
PUT  /businesses/{id}/autopilot/settings
POST /businesses/{id}/autopilot/generate            {what: posts|replies|profile|all}   prepare drafts now (AI)
POST /businesses/{id}/autopilot/photos              {files: [{name, data, category}]}   queue photos
GET  /businesses/{id}/autopilot/photos/{task_id}    the queued photo (to preview)
PATCH /businesses/{id}/autopilot/items/{id}         edit the text or the time of a waiting item
POST /businesses/{id}/autopilot/items/{id}/approve  {publish_at?, now?}   approve ONE item
POST /businesses/{id}/autopilot/items/{id}/reject | unschedule | retry
POST /businesses/{id}/autopilot/approve-posts       {ids}   approve several posts, each at its own proposed time
Nothing reaches Google except through an approval of that exact item.
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import get_business
from ..models import AgentTask, Business, InsightDay, Post, Review, Schedule
from ..services import agent, autopilot as ap, localtime
from ..services import growth_plan as plan
from ..services.activity import log

router = APIRouter(prefix="/businesses/{business_id}/autopilot", tags=["autopilot"])
_gen_limit = plan.RateLimit(10, name="autopilot_generate")
_photo_limit = plan.RateLimit(20, name="autopilot_photos")
OPEN = ("pending", "scheduled")


def _task(db: Session, b: Business, tid: int) -> AgentTask:
    t = db.get(AgentTask, tid)
    if not t or t.business_id != b.id or t.kind not in ap.GATED_KINDS:
        raise HTTPException(404, "Item not found")
    return t


def _item(db: Session, b: Business, t: AgentTask) -> dict[str, Any]:
    d = t.detail or {}
    out: dict[str, Any] = {"id": t.id, "kind": t.kind, "status": t.status, "title": t.title, "publish_at": d.get("publish_at"), "approved_by": d.get("approved_by"), "approved_at": d.get("approved_at"),
                           "created_at": t.created_at.isoformat() if t.created_at else None, "result": t.result or {}, "source": d.get("source") or "agent"}
    if t.kind == "gbp_post":
        p = db.get(Post, d.get("post_id"))
        out |= {"text": (p.body if p else d.get("body")) or "", "headline": p.title if p else None, "cta": p.cta_type if p else None, "topic": d.get("topic"), "post_id": d.get("post_id"),
                "published_at": p.published_at.isoformat() if p and p.published_at else None}
    elif t.kind == "review_reply":
        r = db.get(Review, d.get("review_id"))
        when = (r.review_at or r.review_date) if r else None
        out |= {"text": (r.reply_text if r and r.reply_text else d.get("text")) or "", "review": {"author": r.author, "rating": r.rating, "text": r.body, "at": str(when) if when else None} if r else None}
    elif t.kind == "profile_edit":
        out |= {"changes": d.get("changes"), "before": d.get("before"), "added_services": d.get("added_services"), "editable": bool(d.get("changes"))}
    elif t.kind == "gbp_photo":
        out |= {"category": d.get("category"), "name": d.get("name"), "width": d.get("width"), "height": d.get("height"), "preview": f"/businesses/{b.id}/autopilot/photos/{t.id}"}
    return out


def _results(db: Session, b: Business) -> dict[str, Any]:
    today = localtime.today(b)
    a0, p0 = today - timedelta(days=29), today - timedelta(days=59)

    def total(lo, hi):
        row = db.execute(select(func.coalesce(func.sum(InsightDay.calls), 0), func.coalesce(func.sum(InsightDay.directions), 0), func.coalesce(func.sum(InsightDay.website_clicks), 0),
                                func.coalesce(func.sum(InsightDay.views_search + InsightDay.views_maps), 0)).where(InsightDay.business_id == b.id, InsightDay.day >= lo, InsightDay.day <= hi)).one()
        return {"calls": int(row[0]), "directions": int(row[1]), "website_clicks": int(row[2]), "views": int(row[3])}
    now_, before = total(a0, today), total(p0, a0 - timedelta(days=1))
    since = datetime.now(timezone.utc) - timedelta(days=30)
    by = {"gbp_post": 0, "review_reply": 0, "gbp_photo": 0, "profile_edit": 0}
    for t in db.scalars(select(AgentTask).where(AgentTask.business_id == b.id, AgentTask.status == "applied", AgentTask.kind.in_(ap.GATED_KINDS), AgentTask.applied_at >= since)):
        by[t.kind] = by.get(t.kind, 0) + 1
    return {"period_days": 30, "now": now_, "before": before, "sent": by, "has_insights": any(now_.values()) or any(before.values()),
            "reviews": {"total": b.review_count, "rating": float(b.rating) if b.rating else None, "unanswered": db.query(Review).filter(Review.business_id == b.id, Review.reply_status != "posted").count()}}


@router.get("")
def overview(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    from ..services import ai
    rows = list(db.scalars(select(AgentTask).where(AgentTask.business_id == b.id, AgentTask.kind.in_(ap.GATED_KINDS)).order_by(AgentTask.id.desc()).limit(300)))
    items = [_item(db, b, t) for t in rows]
    order = {"gbp_post": 0, "review_reply": 1, "profile_edit": 2, "gbp_photo": 3}
    inbox = sorted([i for i in items if i["status"] == "pending"], key=lambda i: (order.get(i["kind"], 9), i["publish_at"] or "9"))
    scheduled = sorted([i for i in items if i["status"] == "scheduled"], key=lambda i: i["publish_at"] or "")
    recent = [i for i in items if i["status"] in ("applied", "failed", "rejected", "handoff")][:25]
    nxt = db.scalar(select(Schedule.next_run_at).where(Schedule.business_id == b.id, Schedule.job == "autopilot"))
    return {"rule": ap.RULE, "settings": ap.settings(b), "ai_ready": ai.is_configured(), "linked": ap.linked(b), "timezone": str(localtime.tz_of(b)), "today": localtime.today(b).isoformat(), "inbox": inbox,
            "counts": {"inbox": len(inbox), "scheduled": len(scheduled)}, "scheduled": scheduled, "recent": recent, "results": _results(db, b), "next_run": nxt.isoformat() if nxt else None,
            "limits": {"max_posts": 3, "max_photos": 3}}


class SettingsIn(BaseModel):
    enabled: bool | None = None
    posts_per_week: int | None = Field(default=None, ge=0, le=3)
    post_days: list[str] | None = None
    post_time: str | None = Field(default=None, max_length=5)
    replies: bool | None = None
    profile: bool | None = None
    photos_per_week: int | None = Field(default=None, ge=0, le=3)
    photo_days: list[str] | None = None
    photo_time: str | None = Field(default=None, max_length=5)
    language: str | None = Field(default=None, max_length=30)


@router.put("/settings")
def put_settings(body: SettingsIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    out = ap.save_settings(db, b, body.model_dump(exclude_unset=True))
    if out["enabled"]:  # make sure the daily job exists and runs soon
        from ..services import schedules
        schedules.ensure_jobs(db, b)
        s = db.scalar(select(Schedule).where(Schedule.business_id == b.id, Schedule.job == "autopilot"))
        if s:
            if s.every == "off":
                s.every = "daily"
            s.next_run_at = datetime.now(timezone.utc)
    log(db, user.name, "autopilot_settings", b.id, enabled=out["enabled"])
    db.commit()
    return out


class GenerateIn(BaseModel):
    what: Literal["posts", "replies", "profile", "all"] = "all"


@router.post("/generate")
def generate(body: GenerateIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Prepare drafts now. Only drafts: each one waits for approval."""
    if not _gen_limit.hit(user.id):
        raise HTTPException(429, "Too many requests: each one uses the AI service. Try again in a while.")
    out: dict[str, Any] = {}
    if body.what in ("posts", "all"):
        out["posts"] = ap.plan_posts(db, b)
    if body.what in ("replies", "all"):
        out["replies"] = ap.draft_replies(db, b)
    if body.what in ("profile", "all"):
        out["profile"] = ap.propose_profile(db, b, force=body.what == "profile")
    log(db, user.name, "autopilot_generate", b.id, what=body.what)
    db.commit()
    return out


class EditIn(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=1500)
    publish_at: str | None = None
    description: str | None = Field(default=None, max_length=750)


@router.patch("/items/{task_id}")
def edit_item(task_id: int, body: EditIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    t = _task(db, b, task_id)
    if t.status != "pending":
        raise HTTPException(409, "Only an item that waits for approval can be edited. Unschedule it first.")
    d = dict(t.detail or {})
    try:
        when = ap.parse_when(body.publish_at) if body.publish_at else None
    except ap.AutopilotError as exc:
        raise HTTPException(422, str(exc)) from exc
    if body.text is not None:
        if t.kind == "gbp_post":
            p = db.get(Post, d.get("post_id"))
            if p:
                p.body = body.text
            d["body"] = body.text
        elif t.kind == "review_reply":
            r = db.get(Review, d.get("review_id"))
            if r:
                r.reply_text = body.text
            d["text"] = body.text
        else:
            raise HTTPException(422, "This item has no text to edit.")
    if body.description is not None and t.kind == "profile_edit" and d.get("changes"):
        d["changes"] = {**d["changes"], "description": " ".join(body.description.split())}
    if when:
        d["publish_at"] = when.isoformat()
    t.detail = d
    db.add(t)
    log(db, user.name, "autopilot_edited", b.id, task_id=t.id)
    db.commit()
    return _item(db, b, t)


class ApproveIn(BaseModel):
    publish_at: str | None = None
    now: bool = False


@router.post("/items/{task_id}/approve")
def approve_item(task_id: int, body: ApproveIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    t = _task(db, b, task_id)
    try:
        when = ap.parse_when(body.publish_at) if body.publish_at else None
        ap.approve(db, b, t, user.name, when, body.now)
    except ap.AutopilotError as exc:
        raise HTTPException(409, str(exc)) from exc
    db.refresh(t)
    return _item(db, b, t)


class ManyIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=12)


@router.post("/approve-posts")
def approve_posts(body: ManyIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Approve several posts at once, each for its OWN proposed time (the person chose these exact items)."""
    done, errors = [], []
    for tid in body.ids:
        try:
            t = _task(db, b, tid)
            if t.kind != "gbp_post":
                raise ap.AutopilotError("Only posts can be approved together.")
            ap.approve(db, b, t, user.name)
            done.append(tid)
        except (ap.AutopilotError, HTTPException) as exc:
            errors.append({"id": tid, "error": exc.detail if isinstance(exc, HTTPException) else str(exc)})
    return {"approved": done, "errors": errors}


class RejectIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)


@router.post("/items/{task_id}/reject")
def reject_item(task_id: int, body: RejectIn | None = None, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    t = _task(db, b, task_id)
    if t.status not in OPEN:
        raise HTTPException(409, f"This item is already {t.status}.")
    d = dict(t.detail or {})
    if t.kind == "gbp_post":
        p = db.get(Post, d.get("post_id"))
        if p and p.status != "published":
            p.status, p.approved_at, p.approved_by = "draft", None, None
    t.status = "pending"  # decide() works on a pending item
    agent.decide(db, t, False, user.name)
    if body and body.note:
        from ..services.playbook import get_playbook
        pb = get_playbook(db)
        pb.learnt = [{"task": t.title, "kind": t.kind, "note": body.note, "by": user.name}, *(pb.learnt or [])][:50]
        db.commit()
    return _item(db, b, t)


@router.post("/items/{task_id}/unschedule")
def unschedule(task_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Take an approved item back to 'waits for approval': nothing is sent."""
    t = _task(db, b, task_id)
    if t.status != "scheduled":
        raise HTTPException(409, "Only a scheduled item can be unscheduled.")
    d = dict(t.detail or {})
    d.pop("approved_by", None)
    d.pop("approved_at", None)
    t.detail, t.status, t.decided_by, t.decided_at = d, "pending", None, None
    p = db.get(Post, d.get("post_id")) if t.kind == "gbp_post" else None
    if p:
        p.status, p.approved_at, p.approved_by = "draft", None, None
    log(db, user.name, "autopilot_unscheduled", b.id, task_id=t.id)
    db.commit()
    return _item(db, b, t)


@router.post("/items/{task_id}/retry")
def retry(task_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Send an approved item that failed once more (it keeps its approval; without the approval record it must be approved again)."""
    t = _task(db, b, task_id)
    d = t.detail or {}
    if t.status != "failed" or not d.get("approved_by") or t.kind not in ("gbp_post", "gbp_photo"):
        raise HTTPException(409, "Only an approved item that failed can be retried; approve it again otherwise.")
    t.status, t.result = "scheduled", {}
    t.detail = {**d, "publish_at": datetime.now(timezone.utc).isoformat()}
    db.commit()
    ap.publish_due(db)
    db.refresh(t)
    return _item(db, b, t)


class PhotoFile(BaseModel):
    name: str = Field(max_length=120)
    data: str = Field(max_length=40_000_000)
    category: str = "ADDITIONAL"


class PhotosIn(BaseModel):
    files: list[PhotoFile] = Field(min_length=1, max_length=6)


@router.post("/photos", status_code=201)
def add_photos(body: PhotosIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    if not _photo_limit.hit(user.id):
        raise HTTPException(429, "Too many uploads: try again in a while.")
    try:
        out = ap.add_photos(db, b, [f.model_dump() for f in body.files])
    except ap.AutopilotError as exc:
        raise HTTPException(409, str(exc)) from exc
    log(db, user.name, "autopilot_photos_queued", b.id, count=len(out["added"]))
    db.commit()
    return out


@router.get("/photos/{task_id}")
def photo(task_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    t = _task(db, b, task_id)
    path = ap.photo_path((t.detail or {}).get("file")) if t.kind == "gbp_photo" else None
    if path is None:
        raise HTTPException(404, "Photo not found")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff"})
