"""AI agent: the approval queue, activity log and playbook."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import get_business
from ..models import ActivityLog, AgentTask, Business
from ..schemas import DecisionIn, PlaybookIn
from ..serialize import row, rows
from ..services import activity as activity_log, agent, copilot
from ..services.playbook import get_playbook

router = APIRouter(tags=["agent"])


@router.get("/tasks")
def list_tasks(status: str | None = "pending", business_id: int | None = None, offset: int = 0, limit: int = 300, db: Session = Depends(get_db), _: User = Depends(current_user)):
    q = select(AgentTask).order_by(AgentTask.created_at.desc()).offset(max(0, offset)).limit(max(1, min(limit, 300)))
    if status:
        q = q.where(AgentTask.status == status)
    if business_id:
        q = q.where(AgentTask.business_id == business_id)
    found = list(db.scalars(q))
    # Tasks planned before drafts existed get the rule-based draft (no AI call here, so the list stays fast).
    missing = [t for t in found if t.status == "pending" and not (t.detail or {}).get("draft")]
    for t in missing:
        copilot.draft_for(db, db.get(Business, t.business_id), t, use_ai=False)
    if missing:
        db.commit()
    return rows(found)


class FollowUpIn(BaseModel):
    kind: Literal["website_fix", "profile_edit"]
    title: str = Field(min_length=3, max_length=300)
    fix: str = Field(default="", max_length=1000)
    code: str = Field(default="", max_length=60)
    impact: Literal["High", "Medium", "Low"] = "Medium"


@router.post("/businesses/{business_id}/tasks", status_code=201)
def add_follow_ups(body: list[FollowUpIn], b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Fixes found outside the app while onboarding (on the business's website or Google profile), added to the
    to-do list so they are followed up. A task already pending with the same title is not added twice."""
    pending = {t.title for t in db.scalars(select(AgentTask).where(AgentTask.business_id == b.id, AgentTask.status == "pending"))}
    added = []
    for f in body[:20]:
        if f.title in pending:
            continue
        t = AgentTask(business_id=b.id, agent="gbp" if f.kind == "profile_edit" else "audit", kind=f.kind, title=f.title, impact=f.impact,
                      detail={"fix": f.fix, "code": f.code, "source": "onboarding"}, requires_approval=True)
        db.add(t)
        db.flush()
        copilot.draft_for(db, b, t, use_ai=False)
        pending.add(f.title)
        added.append(t)
    if added:
        activity_log.log(db, user.name, "Onboarding follow-ups", b.id, added=len(added), titles=[t.title for t in added])
    db.commit()
    return {"added": len(added), "tasks": rows(added)}


@router.post("/tasks/approve-low-risk")
def approve_low_risk(business_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Approve every pending task the copilot rated low risk (text and markup fixes, thank-you replies).
    Profile edits never count as low risk, so they always wait for a person."""
    q = select(AgentTask).where(AgentTask.status == "pending")
    if business_id:
        q = q.where(AgentTask.business_id == business_id)
    done = [agent.decide(db, t, True, user.name) for t in db.scalars(q).all() if (t.detail or {}).get("risk") == "low" and t.kind not in agent.ALWAYS_ASK]
    return {"approved": len(done), "tasks": rows(done)}


class BulkIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=200)
    action: Literal["approve", "reject"]


@router.post("/tasks/bulk")
def bulk(body: BulkIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Approve or reject several pending changes at once. Profile edits can't be approved in bulk: they always wait for a person."""
    done, skipped = [], 0
    for t in db.scalars(select(AgentTask).where(AgentTask.id.in_(body.ids), AgentTask.status == "pending")):
        if body.action == "approve" and t.kind in agent.ALWAYS_ASK:
            skipped += 1
            continue
        done.append(agent.decide(db, t, body.action == "approve", user.name))
    return {"done": len(done), "skipped": skipped, "action": body.action}


@router.post("/tasks/triage")
def triage(business_id: int | None = None, approve_low_risk: bool = False, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Clean the queue: close the changes the latest audit no longer reports (fixed), reject exact duplicates, and
    rank what is left by impact and age. With approve_low_risk, the changes rated low risk are approved too."""
    from ..services import audits as audit_service  # noqa: PLC0415

    q = select(Business) if not business_id else select(Business).where(Business.id == business_id)
    resolved = duplicates = 0
    for b in db.scalars(q):
        latest = audit_service.latest(db, b)
        done = [a for a in latest.values() if a and a.status == "done"]
        if done:
            resolved += agent.reconcile(db, b, [i for a in done for i in (a.issues or [])], [a.kind for a in done])
        seen: dict[tuple, AgentTask] = {}
        for t in db.scalars(select(AgentTask).where(AgentTask.business_id == b.id, AgentTask.status == "pending").order_by(AgentTask.created_at.desc())):
            key = (t.kind, " ".join(t.title.lower().split()))
            if key in seen:
                t.status, t.result = "rejected", {"note": "Duplicate of a newer change.", "by": "triage"}
                duplicates += 1
            else:
                seen[key] = t
    db.commit()
    pending = list(db.scalars(select(AgentTask).where(AgentTask.status == "pending", *( [AgentTask.business_id == business_id] if business_id else []))))
    weight = {"High": 3, "Medium": 2, "Low": 1}
    ranked = sorted(pending, key=lambda t: (-weight.get(t.impact, 1), t.created_at))
    approved = 0
    if approve_low_risk:
        approved = len([agent.decide(db, t, True, user.name) for t in pending if (t.detail or {}).get("risk") == "low" and t.kind not in agent.ALWAYS_ASK])
    activity_log.log(db, user.name, "tasks_triaged", business_id, resolved=resolved, duplicates=duplicates, approved=approved)
    db.commit()
    return {"resolved": resolved, "duplicates_rejected": duplicates, "approved_low_risk": approved, "remaining": len(pending) - approved,
            "top": [{"id": t.id, "title": t.title, "impact": t.impact, "business_id": t.business_id} for t in ranked[:10]]}


@router.post("/tasks/{task_id}/redraft")
def redraft(task_id: int, db: Session = Depends(get_db), _: User = Depends(current_user)):
    """Draft the change again (with AI when it's set up)."""
    t = _task(db, task_id)
    copilot.draft_for(db, db.get(Business, t.business_id), t)
    db.commit()
    return row(t)


def _task(db: Session, task_id: int) -> AgentTask:
    t = db.get(AgentTask, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    if t.status != "pending":
        raise HTTPException(409, f"Task is already {t.status}")
    return t


@router.post("/tasks/{task_id}/approve")
def approve(task_id: int, body: DecisionIn | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return row(agent.decide(db, _task(db, task_id), True, user.name))


@router.post("/tasks/{task_id}/reject")
def reject(task_id: int, body: DecisionIn | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    t = agent.decide(db, _task(db, task_id), False, user.name)
    if body and body.note:
        # A rejection with a reason is something the AI should learn from.
        pb = get_playbook(db)
        pb.learnt = [{"task": t.title, "kind": t.kind, "note": body.note, "by": user.name}, *(pb.learnt or [])][:50]
        db.commit()
    return row(t)


@router.get("/activity")
def activity(business_id: int | None = None, limit: int = 100, db: Session = Depends(get_db), _: User = Depends(current_user)):
    q = select(ActivityLog).order_by(ActivityLog.created_at.desc()).limit(min(limit, 500))
    if business_id:
        q = q.where(ActivityLog.business_id == business_id)
    return rows(db.scalars(q))


@router.get("/playbook")
def read_playbook(db: Session = Depends(get_db), _: User = Depends(current_user)):
    return row(get_playbook(db))


@router.put("/playbook")
def write_playbook(body: PlaybookIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    pb = get_playbook(db)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(pb, k, v)
    db.commit()
    return row(pb)
