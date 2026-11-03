"""React.js website connection: a second blog publishing destination next to WordPress (settings, test, disconnect).
The API key is stored encrypted and never returned to the page (only whether one is saved and its last 4 characters)."""
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
    api_key: str | None = Field(default=None, max_length=1000)  # empty: keep the saved key
    auth_scheme: Literal["bearer", "x-api-key"] = "bearer"
    health_endpoint: str | None = Field(default=None, max_length=300)
    publish_endpoint: str = Field(min_length=1, max_length=300)
    image_endpoint: str | None = Field(default=None, max_length=300)
    default_status: Literal["draft", "publish", "schedule"] = "draft"


def _utc(d: datetime | None) -> str | None:
    if not d:
        return None
    return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).isoformat()


def get_conn(db: Session, b: Business) -> ReactSiteConnection | None:
    return db.scalar(select(ReactSiteConnection).where(ReactSiteConnection.business_id == b.id))


def public(conn: ReactSiteConnection | None) -> dict:
    if not conn:
        return {"status": "not_connected", "has_key": False}
    key = rs.key_of(conn) if conn.api_key_enc else None
    return {
        "status": conn.status, "website_name": conn.website_name, "website_url": conn.website_url, "blog_url": conn.blog_url,
        "api_base_url": conn.api_base_url, "auth_scheme": conn.auth_scheme, "health_endpoint": conn.health_endpoint,
        "publish_endpoint": conn.publish_endpoint, "image_endpoint": conn.image_endpoint, "default_status": conn.default_status,
        "has_key": bool(key), "key_hint": f"••••{key[-4:]}" if key and len(key) >= 8 else ("••••" if key else None),
        "last_error": conn.last_error, "last_checked_at": _utc(conn.last_checked_at), "last_success_at": _utc(conn.last_success_at),
    }


def _apply(conn: ReactSiteConnection, body: ReactSiteIn) -> None:
    try:
        conn.api_base_url = rs.normalize_base(body.api_base_url)
        conn.website_url = rs.normalize_base(body.website_url) if body.website_url else None
        conn.blog_url = rs.normalize_base(body.blog_url) if body.blog_url else None
        conn.health_endpoint = rs.normalize_path(body.health_endpoint)
        conn.publish_endpoint = rs.normalize_path(body.publish_endpoint)
        conn.image_endpoint = rs.normalize_path(body.image_endpoint)
    except rs.ReactSiteError as exc:
        raise HTTPException(422, str(exc))
    conn.website_name = (body.website_name or "").strip() or None
    conn.auth_scheme, conn.default_status = body.auth_scheme, body.default_status
    if body.api_key and body.api_key.strip():
        conn.api_key_enc = crypto.seal(body.api_key.strip())


def _run_test(conn: ReactSiteConnection) -> list[dict]:
    steps, ok = rs.test(website_url=conn.website_url, api_base_url=conn.api_base_url, api_key=rs.key_of(conn), auth_scheme=conn.auth_scheme,
                        health_endpoint=conn.health_endpoint, publish_endpoint=conn.publish_endpoint)
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
    """Save the configuration (the key encrypted) and, by default, test it right away."""
    conn = get_conn(db, b)
    if not conn:
        conn = ReactSiteConnection(business_id=b.id)
        db.add(conn)
    _apply(conn, body)
    if not conn.api_key_enc:
        raise HTTPException(422, "Enter the API authentication key issued by the website's backend.")
    steps = _run_test(conn) if test else []
    if not test and conn.status == "not_connected":
        conn.status = "not_connected"
    db.commit()
    return {"ok": conn.status == "connected", "steps": steps, "connection": public(conn)}


@router.post("/test")
def test_connection(body: ReactSiteIn | None = None, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Test with the form as it is now (nothing saved), or with the saved settings when no body is sent."""
    saved = get_conn(db, b)
    if body is None:
        if not saved or not saved.api_key_enc:
            raise HTTPException(409, "Save the React.js website connection first.")
        steps = _run_test(saved)
        db.commit()
        return {"ok": saved.status == "connected", "steps": steps, "connection": public(saved)}
    probe = ReactSiteConnection(business_id=b.id, api_key_enc=saved.api_key_enc if saved else None)
    _apply(probe, body)
    steps, ok = rs.test(website_url=probe.website_url, api_base_url=probe.api_base_url, api_key=rs.key_of(probe) if probe.api_key_enc else None,
                        auth_scheme=probe.auth_scheme, health_endpoint=probe.health_endpoint, publish_endpoint=probe.publish_endpoint)
    return {"ok": ok, "steps": steps, "connection": public(saved)}


@router.delete("", status_code=204)
def disconnect(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Forget the key and mark the destination not connected (the other settings stay for reconnecting)."""
    conn = get_conn(db, b)
    if conn:
        conn.api_key_enc, conn.status, conn.last_error = None, "not_connected", None
        db.commit()
