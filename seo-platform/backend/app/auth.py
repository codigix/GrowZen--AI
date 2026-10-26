"""Login.

The platform has its own users (email + password, session cookie `seo_session`). A CRM session
cookie is also accepted when CRM_JWT_SECRET is set, so CRM users can open it without a second
account; their name/role come from the CRM's /auth/me over HTTP (never its database).
"""
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx
import jwt
from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .db import get_db


@dataclass
class User:
    id: str
    name: str
    email: str = ""
    role: str = ""
    department: str = ""
    source: str = "seo"  # seo | crm

    @property
    def is_admin(self) -> bool:
        return self.role.lower() in ("admin", "super admin")


# ── own sessions ───────────────────────────────────────────────────────────────
def issue_session(response: Response, user_id: int, settings: Settings) -> None:
    exp = datetime.now(timezone.utc) + timedelta(hours=settings.session_hours)
    token = jwt.encode({"sub": str(user_id), "kind": "seo", "exp": exp}, settings.secret_key, algorithm="HS256")
    response.set_cookie(settings.session_cookie, token, httponly=True, samesite="lax", secure=settings.cookie_secure,
                        max_age=settings.session_hours * 3600, path="/")


def clear_session(response: Response, settings: Settings) -> None:
    response.delete_cookie(settings.session_cookie, path="/")


def _seo_user(token: str, db: Session, settings: Settings) -> User | None:
    from .models import AppUser  # local import: models import db, which imports config
    try:
        claims = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return None
    if claims.get("kind") != "seo":
        return None
    u = db.get(AppUser, int(claims.get("sub", 0)))
    if not u or not u.active:
        return None
    return User(id=str(u.id), name=u.name, email=u.email, role=u.role, department="SEO Platform", source="seo")


# ── CRM sessions (optional) ────────────────────────────────────────────────────
_cache: dict[str, tuple[float, User]] = {}


def _crm_user(token: str, settings: Settings) -> User | None:
    if not settings.crm_jwt_secret:
        return None
    try:
        claims = jwt.decode(token, settings.crm_jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired. Please sign in again.") from exc
    except jwt.InvalidTokenError:
        return None
    hit = _cache.get(token)
    if hit and hit[0] > time.time():
        return hit[1]
    user_id = str(claims.get("sub", ""))
    user = User(id=f"crm:{user_id}", name=f"CRM user {user_id}", source="crm")
    if settings.crm_api_url:
        try:
            r = httpx.get(f"{settings.crm_api_url.rstrip('/')}/auth/me", cookies={settings.crm_session_cookie: token}, timeout=5)
            if r.status_code == 200:
                d = r.json()
                name = d.get("name") or f"{d.get('first_name') or ''} {d.get('last_name') or ''}".strip() or d.get("username") or user.name
                user = User(id=f"crm:{user_id}", name=name, email=d.get("email") or "", role=d.get("role_name") or d.get("role") or "", department=d.get("department") or "", source="crm")
            elif r.status_code in (401, 403):
                return None
        except httpx.HTTPError:
            pass
    dept = user.department.lower()
    if (user.role or user.department) and not (user.role.lower() in settings.allowed_role_list or any(x in dept for x in settings.allowed_department_list)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your CRM account has no access to the SEO platform.")
    _cache[token] = (time.time() + 300, user)
    return user


def current_user(request: Request, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)) -> User:
    auth = request.headers.get("authorization", "")
    bearer = auth[7:] if auth.lower().startswith("bearer ") else None
    for token in (request.cookies.get(settings.session_cookie), bearer):
        if token and (u := _seo_user(token, db, settings)):
            return u
    for token in (request.cookies.get(settings.crm_session_cookie), bearer):
        if token and (u := _crm_user(token, settings)):
            return u
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Please sign in.")


def require_admin(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admins only.")
    return user
