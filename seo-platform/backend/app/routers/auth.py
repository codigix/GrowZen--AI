"""Sign in / out and user management for the platform's own accounts."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import User, clear_session, current_user, issue_session, require_admin
from ..config import Settings, get_settings
from ..db import get_db
from ..models import AppUser
from ..serialize import row
from ..services.passwords import hash_password, verify_password

router = APIRouter(tags=["auth"])
ROLES = ("admin", "editor", "viewer")


class LoginIn(BaseModel):
    email: str
    password: str


class UserIn(BaseModel):
    email: str = Field(min_length=3)
    name: str = Field(min_length=1)
    password: str = Field(min_length=8)
    role: str = "editor"


class UserPatch(BaseModel):
    name: str | None = None
    role: str | None = None
    active: bool | None = None
    password: str | None = Field(default=None, min_length=8)


def public(u: AppUser) -> dict:
    return row(u, exclude={"password_hash"})


@router.post("/auth/login")
def login(body: LoginIn, response: Response, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    u = db.scalar(select(AppUser).where(func.lower(AppUser.email) == body.email.strip().lower()))
    if not u or not verify_password(body.password, u.password_hash):
        raise HTTPException(401, "Wrong email or password.")
    if not u.active:
        raise HTTPException(403, "This account is disabled.")
    u.last_login_at = datetime.now(timezone.utc)
    db.commit()
    issue_session(response, u.id, settings)
    return public(u)


@router.post("/auth/logout")
def logout(response: Response, settings: Settings = Depends(get_settings)):
    clear_session(response, settings)
    return {"ok": True}


@router.get("/users")
def list_users(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return [public(u) for u in db.scalars(select(AppUser).order_by(AppUser.name))]


@router.post("/users", status_code=201)
def create_user(body: UserIn, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    if body.role not in ROLES:
        raise HTTPException(400, f"Role must be one of {', '.join(ROLES)}")
    if db.scalar(select(AppUser).where(func.lower(AppUser.email) == body.email.strip().lower())):
        raise HTTPException(409, "A user with this email exists")
    u = AppUser(email=body.email.strip().lower(), name=body.name.strip(), password_hash=hash_password(body.password), role=body.role)
    db.add(u)
    db.commit()
    return public(u)


@router.patch("/users/{user_id}")
def update_user(user_id: int, body: UserPatch, db: Session = Depends(get_db), me: User = Depends(require_admin)):
    u = db.get(AppUser, user_id)
    if not u:
        raise HTTPException(404, "User not found")
    if body.role is not None:
        if body.role not in ROLES:
            raise HTTPException(400, f"Role must be one of {', '.join(ROLES)}")
        u.role = body.role
    if body.name is not None:
        u.name = body.name.strip()
    if body.active is not None:
        if str(u.id) == me.id and not body.active:
            raise HTTPException(400, "You can't disable your own account")
        u.active = body.active
    if body.password:
        u.password_hash = hash_password(body.password)
    db.commit()
    return public(u)


def seed_admin(db: Session, settings: Settings) -> None:
    """First start: create the admin from ADMIN_EMAIL / ADMIN_PASSWORD when there are no users."""
    if not (settings.admin_email and settings.admin_password):
        return
    if db.scalar(select(func.count(AppUser.id))):
        return
    db.add(AppUser(email=settings.admin_email.strip().lower(), name=settings.admin_name or "Admin", password_hash=hash_password(settings.admin_password), role="admin"))
    db.commit()
