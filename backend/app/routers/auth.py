"""Sign in / out and user management for the platform's own accounts."""
import logging
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone

import jwt

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import User, clear_session, current_user, issue_project_claim, issue_session, require_admin
from ..config import Settings, get_settings
from ..db import get_db
from ..models import AppUser
from ..serialize import row
from ..services import crypto, totp
from ..services.passwords import hash_password, is_known_default, verify_password

router = APIRouter(tags=["auth"])
ROLES = ("admin", "editor", "viewer")


class LoginIn(BaseModel):
    email: str
    password: str


class UserIn(BaseModel):
    email: str = Field(min_length=3)
    name: str = Field(min_length=1)
    password: str = Field(min_length=10)
    role: str = "editor"


class UserPatch(BaseModel):
    name: str | None = None
    role: str | None = None
    active: bool | None = None
    password: str | None = Field(default=None, min_length=10)
    reset_2fa: bool | None = None  # an admin switches off a user's two-step verification (lost phone); the user sets it up again


def public(u: AppUser) -> dict:
    return row(u, exclude={"password_hash"})


_failures: dict[str, list[float]] = {}
_failures_lock = threading.Lock()
log = logging.getLogger("seo.auth")


def _throttle(key: str, settings: Settings, record: bool = False, reset: bool = False) -> None:
    """Too many wrong passwords from one address for one email: locked for a while (in memory: a restart clears it)."""
    window = settings.login_lockout_minutes * 60
    now = time.time()
    with _failures_lock:
        recent = [t for t in _failures.get(key, []) if now - t < window]
        if reset:
            _failures.pop(key, None)
            return
        if record:
            recent.append(now)
        _failures[key] = recent
        if len(recent) >= settings.login_max_failures:
            wait = max(1, int((window - (now - recent[0])) / 60) + 1)
            raise HTTPException(429, f"Too many wrong passwords. Try again in {wait} minute{'s' if wait != 1 else ''}.")


@router.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    key = f"{body.email.strip().lower()}|{request.client.host if request.client else '-'}"
    _throttle(key, settings)
    u = db.scalar(select(AppUser).where(func.lower(AppUser.email) == body.email.strip().lower()))
    if not u or not verify_password(body.password, u.password_hash):
        _throttle(key, settings, record=True)
        raise HTTPException(401, "Wrong email or password.")
    _throttle(key, settings, reset=True)
    if not u.active:
        raise HTTPException(403, "This account is disabled.")
    u.last_login_at = datetime.now(timezone.utc)
    db.commit()
    issue_session(response, u.id, settings)
    return public(u) | {"must_change_password": is_known_default(u.password_hash), "totp_enabled": bool(u.totp_enabled)}


class PasswordIn(BaseModel):
    current: str
    new: str = Field(min_length=10, max_length=200)


class ForgotPasswordIn(BaseModel):
    email: str


class ResetPasswordIn(BaseModel):
    token: str
    password: str = Field(min_length=10, max_length=200)


@router.post("/auth/forgot-password")
def forgot_password(body: ForgotPasswordIn, request: Request, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    email_clean = body.email.strip().lower()
    u = db.scalar(select(AppUser).where(func.lower(AppUser.email) == email_clean))

    token = None
    if u and u.active:
        exp = datetime.now(timezone.utc) + timedelta(hours=1)
        token = jwt.encode({"sub": str(u.id), "kind": "password_reset", "exp": exp}, settings.secret_key, algorithm="HS256")

        from ..services.notify import send_email
        reset_link = f"{settings.frontend_url}/?reset_token={token}"
        email_body = f"""Hello {u.name},

You requested to reset your password for your account on {settings.app_name}.

You can reset your password by opening the following link:
{reset_link}

Or enter this reset token in the platform:
{token}

If you did not request this password reset, please ignore this email.
"""
        sent = send_email(to=u.email, subject=f"Password Reset - {settings.app_name}", body=email_body)
        if sent:
            return {"ok": True, "message": f"Password reset instructions have been sent to {u.email}."}

    if u:
        return {
            "ok": True,
            "message": "Password reset request received. Since SMTP email service is not configured on this server, you can set a new password directly below or contact your administrator at info@codigixinfotech.com.",
            "token": token,
            "dev_mode": not bool(settings.smtp_host)
        }
    return {
        "ok": True,
        "message": "If an account with this email exists, password reset instructions have been processed."
    }


@router.post("/auth/reset-password")
def reset_password(body: ResetPasswordIn, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    try:
        claims = jwt.decode(body.token, settings.secret_key, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(400, "The reset link or token has expired. Please request a new one.")
    except jwt.InvalidTokenError:
        raise HTTPException(400, "Invalid reset token.")

    if claims.get("kind") != "password_reset":
        raise HTTPException(400, "Invalid token type.")

    user_id = claims.get("sub")
    u = db.get(AppUser, int(user_id)) if user_id and str(user_id).isdigit() else None
    if not u or not u.active:
        raise HTTPException(404, "User not found or account is disabled.")

    if is_known_default(hash_password(body.password)):
        raise HTTPException(400, "Cannot use a known default password. Please choose a secure password.")

    u.password_hash = hash_password(body.password)
    db.commit()
    return {"ok": True, "message": "Password updated successfully. You can now sign in with your new password."}


@router.post("/auth/change-password")
def change_password(body: PasswordIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Change your own password. The password that was published in the source can never be chosen again."""
    u = db.get(AppUser, int(user.id)) if user.source == "seo" and str(user.id).isdigit() else None
    if not u:
        raise HTTPException(400, "This account signs in through the CRM: change the password there.")
    if not verify_password(body.current, u.password_hash):
        raise HTTPException(403, "The current password is wrong.")
    if is_known_default(hash_password(body.new)) or body.new == body.current:
        raise HTTPException(400, "Choose a new password that is different from the old one and not the published default.")
    u.password_hash = hash_password(body.new)
    db.commit()
    return {"ok": True}


# ── two-step verification (authenticator app) ──────────────────────────────────
class CodeIn(BaseModel):
    code: str = Field(min_length=1, max_length=20)
    business_id: int | None = None  # enable: also open this project right away (the code just used cannot be used again)


class DisableIn(BaseModel):
    code: str = Field(min_length=1, max_length=20)
    password: str


class SwitchIn(BaseModel):
    business_id: int
    code: str = Field(min_length=1, max_length=20)


def _own_account(db: Session, user: User) -> AppUser:
    u = db.get(AppUser, int(user.id)) if user.source == "seo" and str(user.id).isdigit() else None
    if not u:
        raise HTTPException(400, "This account signs in through the CRM, so two-step verification is not available for it.")
    return u


def _check_code(db: Session, u: AppUser, code: str, settings: Settings, secret: str | None = None) -> None:
    """A wrong code counts against the account (locked for a while after too many); a right one works once."""
    key = f"2fa|{u.id}"
    _throttle(key, settings)
    secret = secret or (crypto.unseal(u.totp_secret) if u.totp_secret else "")
    step = totp.verify(secret, code) if secret else None
    if step is None or (u.totp_last_step is not None and step <= u.totp_last_step):
        _throttle(key, settings, record=True)
        raise HTTPException(400, "That code is not right or was already used. Wait for the next code in your app and try again.")
    _throttle(key, settings, reset=True)
    u.totp_last_step = step


@router.post("/auth/2fa/setup")
def two_factor_setup(db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Start enrolling an authenticator app: a new secret, shown once as a QR code and a manual key. Nothing is switched on until /enable."""
    u = _own_account(db, user)
    if u.totp_enabled:
        raise HTTPException(400, "Two-step verification is already on. Turn it off first to set it up again.")
    secret = totp.new_secret()
    u.totp_secret = crypto.seal(secret)
    db.commit()
    uri = totp.otpauth_uri(secret, u.email)
    return {"secret": secret, "uri": uri, "qr": totp.qr_data_uri(uri)}


@router.post("/auth/2fa/enable")
def two_factor_enable(body: CodeIn, response: Response, db: Session = Depends(get_db), user: User = Depends(current_user), settings: Settings = Depends(get_settings)):
    u = _own_account(db, user)
    if u.totp_enabled:
        raise HTTPException(400, "Two-step verification is already on.")
    if not u.totp_secret:
        raise HTTPException(400, "Start the setup first.")
    _check_code(db, u, body.code, settings)
    u.totp_enabled = True
    db.commit()
    if body.business_id is not None:
        from ..deps import can_access
        from ..models import Business
        if can_access(user, db.get(Business, body.business_id), db):
            issue_project_claim(response, u.id, body.business_id, settings)
    return {"ok": True, "totp_enabled": True}


@router.post("/auth/2fa/disable")
def two_factor_disable(body: DisableIn, response: Response, db: Session = Depends(get_db), user: User = Depends(current_user), settings: Settings = Depends(get_settings)):
    u = _own_account(db, user)
    if not u.totp_enabled:
        raise HTTPException(400, "Two-step verification is not on.")
    if not verify_password(body.password, u.password_hash):
        raise HTTPException(403, "The password is wrong.")
    _check_code(db, u, body.code, settings)
    u.totp_enabled, u.totp_secret, u.totp_last_step = False, None, None
    db.commit()
    return {"ok": True, "totp_enabled": False}


@router.post("/auth/switch-project")
def switch_project(body: SwitchIn, response: Response, db: Session = Depends(get_db), user: User = Depends(current_user), settings: Settings = Depends(get_settings)):
    """Switching the active project needs a fresh authenticator code. The answer is a cookie that opens that one project (and no other)."""
    from ..deps import can_access
    from ..models import Business
    u = _own_account(db, user)
    if not can_access(user, db.get(Business, body.business_id), db):
        raise HTTPException(404, "Business not found")
    if not u.totp_enabled:
        raise HTTPException(409, detail={"code": "totp_not_enabled", "message": "Set up your authenticator app first."})
    _check_code(db, u, body.code, settings)
    db.commit()
    issue_project_claim(response, u.id, body.business_id, settings)
    return {"ok": True, "business_id": body.business_id}


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
    if body.reset_2fa:
        u.totp_enabled, u.totp_secret, u.totp_last_step = False, None, None
    db.commit()
    return public(u)


def seed_admin(db: Session, settings: Settings) -> None:
    """First start: create the admin from ADMIN_EMAIL / ADMIN_PASSWORD when there are no users."""
    if not settings.admin_email or db.scalar(select(func.count(AppUser.id))):
        return
    password = settings.admin_password or secrets.token_urlsafe(12)
    db.add(AppUser(email=settings.admin_email.strip().lower(), name=settings.admin_name or "Admin", password_hash=hash_password(password), role="admin"))
    db.commit()
    if not settings.admin_password:  # shown once, here: there is no default to fall back on
        log.warning("First start: admin account %s created with the generated password %s . Change it after signing in.", settings.admin_email, password)
