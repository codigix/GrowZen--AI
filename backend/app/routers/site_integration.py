"""How a business's own website receives blog posts: detect its platform, connect it, check the connection."""
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_business
from ..models import Business, SiteIntegration
from ..services import crypto, site_publish as sp

router = APIRouter(prefix="/businesses/{business_id}/site-integration", tags=["site-integration"])


class DetectIn(BaseModel):
    url: str | None = Field(default=None, max_length=500)  # defaults to the business's website


class ConnectIn(BaseModel):
    method: Literal["wordpress", "webhook"]
    url: str = Field(min_length=3, max_length=500)  # WordPress site URL, or the webhook endpoint
    username: str | None = Field(default=None, max_length=255)
    secret: str | None = Field(default=None, max_length=500)  # application password / webhook signing secret
    save: bool = True  # false: only run the checks


def get_row(db: Session, b: Business) -> SiteIntegration | None:
    return db.scalar(select(SiteIntegration).where(SiteIntegration.business_id == b.id))


def public(row: SiteIntegration | None, b: Business) -> dict:
    if not row:
        return {"status": "not_connected", "website": b.website, "platform": None, "method": None, "detected": None}
    return {"status": row.status, "website": b.website, "platform": row.platform, "method": row.method, "base_url": row.base_url, "username": row.username,
            "detected": row.detected, "last_checked_at": row.last_checked_at, "last_error": row.last_error}


@router.get("")
def get_integration(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return public(get_row(db, b), b)


@router.post("/detect")
def detect(body: DetectIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    url = body.url or b.website
    if not url:
        raise HTTPException(400, "This business has no website address yet. Add it in the business settings.")
    try:
        found = sp.detect(url)
    except sp.PublishError as exc:
        raise HTTPException(400, str(exc))
    row = get_row(db, b)
    if not row:
        row = SiteIntegration(business_id=b.id)
        db.add(row)
    row.detected, row.platform = found, found["platform"]
    if row.status != "connected":  # never overwrite a working connection's method
        row.method = found["method"]
    db.commit()
    return public(row, b)


@router.post("/connect")
def connect(body: ConnectIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Run the connection checks; when they all pass (and save is true) keep the credentials, encrypted."""
    try:
        if body.method == "wordpress":
            if not (body.username and body.secret):
                raise HTTPException(400, "Enter the WordPress username and application password.")
            steps, info = sp.verify_wordpress(body.url, body.username, body.secret)
        else:
            if not body.secret:
                raise HTTPException(400, "Enter the signing secret that the website will use to check the requests.")
            steps, info = sp.verify_webhook(body.url, body.secret)
    except sp.PublishError as exc:
        raise HTTPException(400, str(exc))
    ok = info is not None
    row = get_row(db, b)
    if not row:
        row = SiteIntegration(business_id=b.id)
        db.add(row)
    row.last_checked_at = datetime.now(timezone.utc)
    if ok and body.save:
        row.method, row.base_url = body.method, sp.normalize_url(body.url)
        row.username = body.username if body.method == "wordpress" else None
        row.secret_enc = crypto.seal(" ".join((body.secret or "").split()) if body.method == "wordpress" else body.secret)
        row.platform = row.platform if row.platform not in (None, "unknown") else body.method
        row.status, row.last_error = "connected", None
    elif not ok:
        row.status = "error" if row.secret_enc else "not_connected"
        row.last_error = next((s["detail"] for s in steps if not s["ok"]), None)
    db.commit()
    return {"ok": ok, "steps": steps, "info": info, "integration": public(row, b)}


@router.post("/check")
def recheck(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Re-run the checks with the saved credentials."""
    row = get_row(db, b)
    if not row or not row.secret_enc:
        raise HTTPException(409, "The website is not connected yet.")
    secret = crypto.unseal(row.secret_enc)
    steps, info = sp.verify_wordpress(row.base_url, row.username or "", secret) if row.method == "wordpress" else sp.verify_webhook(row.base_url, secret)
    row.last_checked_at = datetime.now(timezone.utc)
    row.status = "connected" if info else "error"
    row.last_error = None if info else next((s["detail"] for s in steps if not s["ok"]), None)
    db.commit()
    return {"ok": bool(info), "steps": steps, "info": info, "integration": public(row, b)}


@router.delete("", status_code=204)
def disconnect(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    row = get_row(db, b)
    if row:
        row.method = row.base_url = row.username = row.secret_enc = row.last_error = None
        row.status = "not_connected"
        db.commit()
