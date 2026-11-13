"""Sign in / out and user management for the platform's own accounts."""
import logging
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone

import jwt

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import User, clear_session, current_user, issue_project_claim, issue_session, pw_fingerprint, require_admin
from ..config import Settings, get_settings
from ..db import get_db
from ..models import AppUser
from ..serialize import row
from ..services import crypto, ratelimit, totp
from ..services.activity import log as audit_log
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


_failures = ratelimit.FailureLog()  # wrong attempts per key, in the database (shared by every process, survives a restart)
log = logging.getLogger("seo.auth")


def _throttle(key: str, settings: Settings, record: bool = False, reset: bool = False, limit: int | None = None, raise_: bool = True) -> None:
    """Too many wrong attempts for one key (an address, an account, or both): locked for a while. The count is kept in the database, so a restart or a second process does not reset it."""
    window = settings.login_lockout_minutes * 60
    limit = limit or settings.login_max_failures
    now = time.time()
    if reset:
        _failures.reset(key)
        return
    if record:
        _failures.add(key)
    recent = _failures.recent(key, window)
    if raise_ and len(recent) >= limit:
        wait = max(1, int((window - (now - recent[0])) / 60) + 1)
        raise HTTPException(429, f"Too many attempts. Try again in {wait} minute{'s' if wait != 1 else ''}.")


def client_ip(request: Request, settings: Settings) -> str:
    """The caller's address. X-Forwarded-For is believed only when TRUST_PROXY_HEADERS is on (behind a proxy you control)."""
    if settings.trust_proxy_headers:
        fwd = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if fwd:
            return fwd[:64]
    return request.client.host if request.client else "-"


# A small list of passwords everybody tries first. Not a substitute for length: a long passphrase is the real protection.
COMMON_PASSWORDS = {
    "password", "password1", "password12", "password123", "passw0rd", "p@ssw0rd", "p@ssword", "pass@123", "pass@1234", "pass1234", "qwerty", "qwerty123", "qwertyuiop",
    "123456", "1234567", "12345678", "123456789", "1234567890", "12345678910", "12341234", "111111", "11111111", "1111111111", "000000", "0000000000", "abc123", "abcdefghij",
    "admin", "admin123", "admin@123", "admin1234", "administrator", "welcome", "welcome1", "welcome123", "letmein", "iloveyou", "monkey", "dragon", "football", "baseball",
    "changeme", "change-me", "seo@123", "seo@1234", "seo@12345", "india123", "india@123", "test1234", "default", "secret", "secret123", "1q2w3e4r5t", "qazwsxedc", "zaq12wsx",
    "codigix", "codigix123", "codigix@123", "growzen", "growzen123", "bevisibe", "bevisibe123",
}


def validate_password(password: str, email: str = "") -> None:
    """The rules for a password someone chooses: 10 to 200 characters, not an email, not a common password, not a repeated character."""
    p = password or ""
    low = p.lower()
    mail = (email or "").strip().lower()
    local = mail.split("@")[0] if mail else ""
    if len(p) < 10:
        raise HTTPException(400, "Choose a password of at least 10 characters.")
    if len(p) > 200:
        raise HTTPException(400, "That password is too long (200 characters at most).")
    if low in COMMON_PASSWORDS or low.isdigit() or len(set(low)) <= 3:
        raise HTTPException(400, "That password is too easy to guess. Use a longer phrase that is hard to guess.")
    letters = lambda t: "".join(ch for ch in t if ch.isalpha())  # noqa: E731
    if mail and (low == mail or (len(local) >= 4 and letters(low) == letters(local))):  # the email, or the name before @ with digits and signs added
        raise HTTPException(400, "The password must not be your email address (or that name with a few digits added).")
    if is_known_default(hash_password(p)):
        raise HTTPException(400, "Cannot use a known default password. Please choose a secure password.")


# The hash that is checked when the account does not exist, so a wrong email and a wrong password take the same time
_DUMMY_HASH = hash_password("not-a-real-account-password")


@router.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    email = body.email.strip().lower()[:254]
    ip = client_ip(request, settings)
    # Three counters: this address with this account, this address on any account, this account from any address.
    keys = [(f"{email}|{ip}", settings.login_max_failures), (f"ip|{ip}", settings.login_ip_max_failures), (f"acct|{email}", settings.login_account_max_failures)]
    try:
        for k, lim in keys:
            _throttle(k, settings, limit=lim)
    except HTTPException:
        log.warning("Sign-in locked out for %s from %s", email, ip)
        raise
    u = db.scalar(select(AppUser).where(func.lower(AppUser.email) == email))
    ok = verify_password(body.password, u.password_hash if u else _DUMMY_HASH)  # always one hash check: the same time whether or not the account exists
    if not u or not ok:
        for k, lim in keys:
            _throttle(k, settings, record=True, limit=lim, raise_=False)
        audit_log(db, email or "-", "login_failed", None, ip=ip)
        db.commit()
        raise HTTPException(401, "Wrong email or password.")  # the same answer for an unknown email and a wrong password
    for k, _ in (keys[0], keys[2]):
        _throttle(k, settings, reset=True)
    if not u.active:
        audit_log(db, u.name, "login_refused_disabled", None, ip=ip)
        db.commit()
        raise HTTPException(403, "This account is disabled.")
    u.last_login_at = datetime.now(timezone.utc)
    audit_log(db, u.name, "login_ok", None, ip=ip)
    db.commit()
    issue_session(response, u.id, settings, u.password_hash)
    return public(u) | {"must_change_password": is_known_default(u.password_hash), "totp_enabled": bool(u.totp_enabled)}


class PasswordIn(BaseModel):
    current: str
    new: str = Field(min_length=10, max_length=200)


class ForgotPasswordIn(BaseModel):
    email: str


class ResetPasswordIn(BaseModel):
    token: str
    password: str = Field(min_length=10, max_length=200)


GENERIC_RESET = "If an account with this email exists, reset instructions have been sent to it."


def _send_reset(to: str, name: str, token: str, settings: Settings) -> None:
    from ..services.notify import send_email
    link = f"{settings.frontend_url.rstrip('/')}/?reset_token={token}"
    try:
        sent = send_email(to=to, subject=f"Password reset - {settings.app_name}", body=(
            f"Hello {name},\n\nSomeone asked to reset the password of your {settings.app_name} account. Open this link within one hour to choose a new one:\n{link}\n\n"
            "The link works once. If you did not ask for this, ignore this email: your password stays as it is.\n"))
        if not sent:
            log.warning("A password reset was requested for %s but email is not set up (SMTP_HOST / SMTP_FROM). An admin can set a new password under Users.", to)
    except Exception:  # noqa: BLE001 - never tell the requester whether the email worked
        log.exception("Could not send the password reset email to %s", to)


@router.post("/auth/forgot-password")
def forgot_password(body: ForgotPasswordIn, request: Request, tasks: BackgroundTasks, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    """Always answers the same, whether or not the account exists, and never returns the token: it only goes to the mailbox."""
    email = body.email.strip().lower()[:254]
    ip = client_ip(request, settings)
    _throttle(f"reset|{ip}", settings, record=True, limit=settings.login_ip_max_failures)
    _throttle(f"reset|{email}", settings, record=True, limit=settings.login_max_failures)
    u = db.scalar(select(AppUser).where(func.lower(AppUser.email) == email))
    if u and u.active:
        exp = datetime.now(timezone.utc) + timedelta(hours=1)
        token = jwt.encode({"sub": str(u.id), "kind": "password_reset", "exp": exp, "pv": pw_fingerprint(u.password_hash)}, settings.secret_key, algorithm="HS256")
        tasks.add_task(_send_reset, u.email, u.name, token, settings)  # after the answer, so the response time does not tell either
        audit_log(db, u.name, "password_reset_requested", None, ip=ip)
        db.commit()
    return {"ok": True, "message": GENERIC_RESET}


@router.post("/auth/reset-password")
def reset_password(body: ResetPasswordIn, request: Request, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    ip = client_ip(request, settings)
    _throttle(f"resetuse|{ip}", settings, limit=settings.login_ip_max_failures)
    invalid = HTTPException(400, "This reset link is invalid or has expired. Request a new one.")  # one answer for every failure
    try:
        claims = jwt.decode(body.token, settings.secret_key, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        _throttle(f"resetuse|{ip}", settings, record=True, limit=settings.login_ip_max_failures, raise_=False)
        raise invalid
    user_id = claims.get("sub")
    u = db.get(AppUser, int(user_id)) if user_id and str(user_id).isdigit() else None
    # The token carries a fingerprint of the old password: once the password changes it no longer works (so it works once)
    if claims.get("kind") != "password_reset" or not u or not u.active or claims.get("pv") != pw_fingerprint(u.password_hash):
        _throttle(f"resetuse|{ip}", settings, record=True, limit=settings.login_ip_max_failures, raise_=False)
        raise invalid
    validate_password(body.password, u.email)
    u.password_hash = hash_password(body.password)
    audit_log(db, u.name, "password_reset_done", None, ip=ip)
    db.commit()
    return {"ok": True, "message": "Password updated successfully. You can now sign in with your new password."}


@router.post("/auth/change-password")
def change_password(body: PasswordIn, response: Response, db: Session = Depends(get_db), user: User = Depends(current_user), settings: Settings = Depends(get_settings)):
    """Change your own password. Every other session of the account stops working; this one carries on."""
    u = db.get(AppUser, int(user.id)) if user.source == "seo" and str(user.id).isdigit() else None
    if not u:
        raise HTTPException(400, "This account signs in through the CRM: change the password there.")
    key = f"pw|{u.id}"
    _throttle(key, settings)  # a stolen session cannot guess the current password without limit
    if not verify_password(body.current, u.password_hash):
        _throttle(key, settings, record=True, raise_=False)
        raise HTTPException(403, "The current password is wrong.")
    _throttle(key, settings, reset=True)
    if body.new == body.current:
        raise HTTPException(400, "Choose a new password that is different from the old one.")
    validate_password(body.new, u.email)
    u.password_hash = hash_password(body.new)
    audit_log(db, u.name, "password_changed", None)
    db.commit()
    issue_session(response, u.id, settings, u.password_hash)
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
    validate_password(body.password, body.email)
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
        validate_password(body.password, u.email)
        u.password_hash = hash_password(body.password)  # the user's other sessions stop working
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
