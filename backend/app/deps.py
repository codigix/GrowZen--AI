"""Shared route dependencies."""
from fastapi import Depends, HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .auth import User, current_user
from .db import SessionLocal, get_db
from .models import Business, BusinessManager, GoogleConnection


def _mine_clause(user: User):
    """A project is the user's when they own it, or their sign-in email has manager access to it: it is the email of the Google account
    linked to the project, the project's contact email, or one added to the project's managers."""
    me = (user.email or "").strip().lower()
    parts = [Business.owner_id == user.id]
    if me:
        parts += [
            func.lower(Business.contact_email) == me,
            Business.id.in_(select(BusinessManager.business_id).where(BusinessManager.email == me)),
            Business.connection_id.in_(select(GoogleConnection.id).where(func.lower(GoogleConnection.email) == me)),
        ]
    return or_(*parts)


def can_access(user: User, b: Business | None, db: Session | None = None) -> bool:
    """A project belongs to its owner and to the emails with manager access to it. Admins see all of them."""
    if b is None:
        return False
    if user.sees_all or b.owner_id == user.id:
        return True
    me = (user.email or "").strip().lower()
    if not me:
        return False
    if (b.contact_email or "").strip().lower() == me or (b.connection and (b.connection.email or "").strip().lower() == me):
        return True
    from sqlalchemy.orm import object_session
    s = db or object_session(b)
    return bool(s and s.scalar(select(BusinessManager.id).where(BusinessManager.business_id == b.id, BusinessManager.email == me)))


def only_mine(stmt, user: User):
    """Limit a `select(Business)` / `select(Business.x)` to the projects this user may open."""
    return stmt if user.sees_all else stmt.where(_mine_clause(user))


def my_business_ids(db: Session, user: User) -> list[int] | None:
    """Ids of the user's projects, or None for 'all' (admin): use it to scope tables that only carry business_id."""
    return None if user.sees_all else list(db.scalars(select(Business.id).where(_mine_clause(user))))


def owned_business(db: Session, user: User, business_id: int | None) -> Business | None:
    """db.get(Business, id) that answers 404 for a project the user does not own (same answer as for one that does not exist)."""
    if business_id is None:
        return None
    b = db.get(Business, business_id)
    if not can_access(user, b, db):
        raise HTTPException(404, "Business not found")
    return b


def backfill_owners(db: Session) -> None:
    """Projects made before ownership existed belong to the first admin account (they were all created by it); nothing is left ownerless."""
    from .models import AppUser
    orphans = list(db.scalars(select(Business).where(Business.owner_id.is_(None))))
    if not orphans:
        return
    admin = db.scalar(select(AppUser).where(AppUser.role == "admin", AppUser.active.is_(True)).order_by(AppUser.id))
    if not admin:
        return
    for b in orphans:
        b.owner_id = str(admin.id)
    db.commit()


def get_business(business_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> Business:
    return owned_business(db, user, business_id)


def in_background(fn, *args):
    """Run fn(db, *args) after the response with its own session (FastAPI BackgroundTasks)."""
    def job():
        db = SessionLocal()
        try:
            fn(db, *args)
        finally:
            db.close()
    return job
