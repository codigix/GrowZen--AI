"""The header bell and the Overview alerts: what happened on the user's own projects (new Google reviews, ...)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import can_access, my_business_ids
from ..models import Business, Notification
from ..serialize import row, rows

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _scope(db: Session, user: User, stmt, business_id: int | None):
    """Only the user's own projects; a project they may not open answers 404, like everywhere else."""
    if business_id is not None and not can_access(user, db.get(Business, business_id), db):
        raise HTTPException(404, "Business not found")
    ids = my_business_ids(db, user)
    if ids is not None:
        stmt = stmt.where(Notification.business_id.in_(ids))
    if business_id is not None:
        stmt = stmt.where(Notification.business_id == business_id)
    return stmt


@router.get("")
def list_notifications(business_id: int | None = None, unread: bool = False, limit: int = 50, db: Session = Depends(get_db), user: User = Depends(current_user)):
    q = _scope(db, user, select(Notification), business_id)
    if unread:
        q = q.where(Notification.read.is_(False))
    found = list(db.scalars(q.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(max(1, min(limit, 200)))))
    names = dict(db.execute(select(Business.id, Business.name).where(Business.id.in_({n.business_id for n in found}))).all()) if found else {}
    return [r | {"business_name": names.get(r["business_id"])} for r in rows(found)]


@router.post("/read-all")
def read_all(business_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ids = [n for n in db.scalars(_scope(db, user, select(Notification.id), business_id).where(Notification.read.is_(False)))]
    if ids:
        db.execute(update(Notification).where(Notification.id.in_(ids)).values(read=True))
        db.commit()
    return {"marked": len(ids)}


@router.post("/{notification_id}/read")
def mark_read(notification_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    n = db.scalar(_scope(db, user, select(Notification), None).where(Notification.id == notification_id))
    if not n:
        raise HTTPException(404, "Notification not found")
    n.read = True
    db.commit()
    return row(n)
