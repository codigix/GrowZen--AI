"""AI agent: the approval queue, activity log and playbook."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..models import ActivityLog, AgentTask
from ..schemas import DecisionIn, PlaybookIn
from ..serialize import row, rows
from ..services import agent
from ..services.playbook import get_playbook

router = APIRouter(tags=["agent"])


@router.get("/tasks")
def list_tasks(status: str | None = "pending", business_id: int | None = None, db: Session = Depends(get_db), _: User = Depends(current_user)):
    q = select(AgentTask).order_by(AgentTask.created_at.desc()).limit(300)
    if status:
        q = q.where(AgentTask.status == status)
    if business_id:
        q = q.where(AgentTask.business_id == business_id)
    return rows(db.scalars(q))


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
