"""React.js website connection: a second blog publishing destination next to WordPress (settings, test, disconnect).
Authentication is the website's integration user (username + password -> access token, renewed automatically) or a
fixed API key. Password, key and token are stored encrypted and never returned to the page."""
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_business
from ..models import Business, ReactSiteConnection
from ..services import crypto, react_site as rs

router = APIRouter(prefix="/businesses/{business_id}/react-site", tags=["react-site"])


class ReactSiteIn(BaseModel):
    website_name: str | None = Field(default=None, max_length=160)
    website_url: str | None = Field(default=None, max_length=500)
    blog_url: str | None = Field(default=None, max_length=500)
    api_base_url: str = Field(min_length=4, max_length=500)
    auth_scheme: Literal["login", "bearer", "x-api-key"] = "login"
    login_username: str | None = Field(default=None, max_length=255)
    login_password: str | None = Field(default=None, max_length=500)  # empty: keep the saved password
    auth_endpoint: str | None = Field(default=None, max_length=300)
    api_key: str | None = Field(default=None, max_length=1000)  # key schemes only; empty: keep the saved key
    health_endpoint: str | None = Field(default=None, max_length=300)
    publish_endpoint: str = Field(min_length=1, max_length=300)
    image_endpoint: str | None = Field(default=None, max_length=300)
    default_status: Literal["draft", "publish", "schedule"] = "draft"
    # image upload + field mapping (see services/react_site.DEFAULT_MAPPING); missing keys keep their saved/default value
    mapping: dict | None = None


def _utc(d: datetime | None) -> str | None:
    if not d:
        return None
    return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).isoformat()


def get_conn(db: Session, b: Business) -> ReactSiteConnection | None:
    return db.scalar(select(ReactSiteConnection).where(ReactSiteConnection.business_id == b.id))


def public(conn: ReactSiteConnection | None) -> dict:
    """What the page needs. Never includes the password, key or token."""
    if not conn:
        return {"status": "not_connected", "auth_scheme": "login", "has_password": False, "has_key": False, "mapping": dict(rs.DEFAULT_MAPPING)}
    key = rs.key_of(conn) if conn.api_key_enc else None
    return {
        "status": conn.status, "website_name": conn.website_name, "website_url": conn.website_url, "blog_url": conn.blog_url,
        "api_base_url": conn.api_base_url, "auth_scheme": conn.auth_scheme or "login", "login_username": conn.login_username,
        "auth_endpoint": conn.auth_endpoint, "has_password": bool(conn.password_enc),
        "has_key": bool(key), "key_hint": f"••••{key[-4:]}" if key and len(key) >= 8 else None,
        "token_valid_until": _utc(conn.token_expires_at) if conn.token_enc else None,
        "health_endpoint": conn.health_endpoint, "publish_endpoint": conn.publish_endpoint, "image_endpoint": conn.image_endpoint,
        "default_status": conn.default_status, "last_error": conn.last_error, "mapping": rs.mapping_of(conn),
        "last_checked_at": _utc(conn.last_checked_at), "last_success_at": _utc(conn.last_success_at),
    }


def _apply(conn: ReactSiteConnection, body: ReactSiteIn) -> None:
    try:
        conn.api_base_url = rs.normalize_base(body.api_base_url)
        conn.website_url = rs.normalize_base(body.website_url) if body.website_url else None
        conn.blog_url = rs.normalize_base(body.blog_url) if body.blog_url else None
        conn.health_endpoint = rs.normalize_path(body.health_endpoint)
        conn.publish_endpoint = rs.normalize_path(body.publish_endpoint)
        conn.image_endpoint = rs.normalize_path(body.image_endpoint)
        conn.auth_endpoint = rs.normalize_path(body.auth_endpoint)
        if body.mapping is not None:
            conn.mapping = {**(conn.mapping or {}), **rs.clean_mapping(body.mapping)}
    except rs.ReactSiteError as exc:
        raise HTTPException(422, str(exc))
    changed_login = (body.login_username or "").strip() != (conn.login_username or "") or bool(body.login_password)
    conn.website_name = (body.website_name or "").strip() or None
    conn.auth_scheme, conn.default_status = body.auth_scheme, body.default_status
    conn.login_username = (body.login_username or "").strip() or None
    if body.login_password:
        conn.password_enc = crypto.seal(body.login_password)
    if body.api_key and body.api_key.strip():
        conn.api_key_enc = crypto.seal(body.api_key.strip())
    if changed_login:  # new credentials: the cached token belongs to the old ones
        conn.token_enc, conn.token_expires_at = None, None


def _host(u: str | None) -> str:
    from urllib.parse import urlparse
    h = (urlparse(u if "//" in (u or "") else f"https://{u or ''}").hostname or "").lower()
    return h[4:] if h.startswith("www.") else h


def _hosts(*urls) -> set[str]:
    return {_host(u) for u in urls if u} - {""}


def _guard_owner(db: Session, b: Business, conn: ReactSiteConnection) -> None:
    """A website belongs to one account: refuse to save a website that another account already connected, unless it is
    this account's own registered website (then the other account's copy is the stray one)."""
    mine = _hosts(conn.website_url, conn.api_base_url)
    if not mine or mine & _hosts(b.website):
        return
    for other in db.scalars(select(ReactSiteConnection).where(ReactSiteConnection.business_id != b.id)):
        if mine & _hosts(other.website_url, other.api_base_url):
            owner = db.get(Business, other.business_id)
            raise HTTPException(409, f"{', '.join(sorted(mine))} is already connected to the account "
                                     f"'{owner.name if owner else other.business_id}'. Enter {b.name}'s own website here"
                                     f"{f' ({b.website})' if b.website else ''}.")


def _run_test(conn: ReactSiteConnection) -> list[dict]:
    steps, ok = rs.test(conn)
    now = datetime.now(timezone.utc)
    conn.last_checked_at = now
    conn.status = "connected" if ok else "failed"
    conn.last_error = None if ok else next((s["detail"] for s in steps if not s["ok"]), None)
    if ok:
        conn.last_success_at = now
    return steps


@router.get("")
def get_connection(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return public(get_conn(db, b))


@router.put("")
def save_connection(body: ReactSiteIn, test: bool = True, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Save the configuration (secrets encrypted) and, by default, test it right away."""
    conn = get_conn(db, b)
    if not conn:
        conn = ReactSiteConnection(business_id=b.id)
    _apply(conn, body)
    _guard_owner(db, b, conn)
    if conn not in db:
        db.add(conn)
    if not rs.has_credentials(conn):
        raise HTTPException(422, "Enter the login username/email and password." if conn.auth_scheme == "login" else "Enter the API key issued by the website's backend.")
    if conn.auth_scheme == "login" and not conn.auth_endpoint:
        raise HTTPException(422, "Enter the authentication (login) endpoint, for example /api/integrations/login.")
    steps = _run_test(conn) if test else []
    db.commit()
    return {"ok": conn.status == "connected", "steps": steps, "connection": public(conn)}


@router.post("/test")
def test_connection(body: ReactSiteIn | None = None, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Test Login with the form as it is now (nothing saved), or with the saved settings when no body is sent."""
    saved = get_conn(db, b)
    if body is None:
        if not saved or not rs.has_credentials(saved):
            raise HTTPException(409, "Save the React.js website connection first.")
        steps = _run_test(saved)
        db.commit()
        return {"ok": saved.status == "connected", "steps": steps, "connection": public(saved)}
    probe = ReactSiteConnection(business_id=b.id, password_enc=saved.password_enc if saved else None,
                                api_key_enc=saved.api_key_enc if saved else None, login_username=saved.login_username if saved else None)
    _apply(probe, body)
    _guard_owner(db, b, probe)
    steps, ok = rs.test(probe)
    return {"ok": ok, "steps": steps, "connection": public(saved)}


@router.post("/test-upload")
def test_image_upload(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Upload one small labelled test image with the saved settings (independent of any article) and report the URL."""
    conn = get_conn(db, b)
    if not conn or not rs.has_credentials(conn):
        raise HTTPException(409, "Save the React.js website connection first.")
    steps, url = rs.test_upload(conn)
    db.commit()  # keep a renewed access token
    return {"ok": bool(url) and all(s["ok"] for s in steps), "url": url, "steps": steps}


@router.delete("", status_code=204)
def disconnect(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Forget the password, key and token and mark the destination not connected (other settings stay for reconnecting)."""
    conn = get_conn(db, b)
    if conn:
        conn.password_enc = conn.api_key_enc = conn.token_enc = conn.token_expires_at = conn.last_error = None
        conn.status = "not_connected"
        db.commit()
