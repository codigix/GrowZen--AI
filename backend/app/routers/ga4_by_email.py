"""Website traffic (Google Analytics 4) for a connected Google account / website.

GET /analytics/ga4/start?email=...        -> Google sign-in URL that grants the Analytics permission (needed once per account)
GET /analytics/ga4/by-email?email=...     -> the GA4 overview (users, sessions, channels, countries, pages, devices, sources, realtime)
      optional: website=example.com  property_id=123456789  days=28

The GA4 property is found by matching the website of the businesses imported under that account (or `website`)
with the websites the account's GA4 properties measure. If none matches, the response lists the properties the
account can see so one can be chosen with `property_id`.
"""
import re
import secrets
import time
from typing import Any
from urllib.parse import urlencode

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..config import get_settings
from ..db import get_db
from ..models import Business, GoogleConnection
from ..serialize import row
from ..services import ga4, gbp
from ..services.gsc import host_of

router = APIRouter(prefix="/analytics/ga4", tags=["ga4-by-email"])


def _connection(db: Session, email: str) -> GoogleConnection:
    conn = db.scalar(select(GoogleConnection).where(func.lower(GoogleConnection.email) == email.strip().lower()))
    if not conn:
        raise HTTPException(404, "No connected Google account has this email. Connect it first (GET /analytics/ga4/start).")
    return conn


@router.get("/start")
def start(email: str | None = None, user: User = Depends(current_user)):
    """Google's sign-in URL asking for read-only Analytics access, on top of what the account already granted.
    The existing /connections/google/callback finishes it and stores the new permission on the same connection."""
    s = get_settings()
    if not s.google_oauth_enabled:
        raise HTTPException(400, "Google sign-in is not set up: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.")
    if not s.token_encryption_key:
        raise HTTPException(400, "Add TOKEN_ENCRYPTION_KEY to the backend settings first.")
    state = jwt.encode({"sub": user.id, "purpose": "ga4", "nonce": secrets.token_urlsafe(8), "exp": int(time.time()) + 600}, gbp._state_secret(), algorithm="HS256")
    params = {"client_id": s.google_client_id, "redirect_uri": gbp._redirect_uri(), "response_type": "code", "access_type": "offline", "prompt": "consent",
              "include_granted_scopes": "true", "scope": f"openid email profile {ga4.SCOPE}", "state": state}
    if email:
        params["login_hint"] = email
    return {"url": f"{gbp.AUTH_URL}?{urlencode(params)}"}


def _by_website(db: Session, host: str, days: int) -> dict[str, Any]:
    """No email given: look through every connected Google account that has Analytics access for the property that measures `host`."""
    conns = [c for c in db.scalars(select(GoogleConnection).where(GoogleConnection.status == "active", GoogleConnection.refresh_token_enc.is_not(None)).order_by(GoogleConnection.email)) if ga4.has_scope(c)]
    checked: list[str] = []
    skipped: dict[str, str] = {}
    for conn in conns:
        try:
            ga = ga4.Ga4(conn)
            chosen, _seen = ga4.match_properties(ga, {host})
            checked.append(conn.email)
            if not chosen:
                continue
            reports = [{"property_name": p["name"], "account": p["account"], "websites": p["hosts"]} | ga4.report(ga, p["property"], days) for p in chosen[:5]]
        except ga4.Ga4Error as exc:
            skipped[conn.email] = str(exc)[:200]
            continue
        businesses = list(db.scalars(select(Business).where(Business.connection_id == conn.id).order_by(Business.name)))
        return {"email": conn.email, "matched": True, "found_by": "website", "accounts_checked": checked,
                "connection": {k: v for k, v in row(conn).items() if k in ("id", "email", "display_name", "status", "last_sync_at")},
                "businesses": [{"id": b.id, "name": b.name, "website": b.website} for b in businesses], "reports": reports}
    return {"email": None, "matched": False, "found_by": "website", "websites_looked_for": [host], "accounts_checked": checked, "accounts_skipped": skipped,
            "message": (f"None of the {len(checked)} connected Google account(s) with Analytics access has a property for {host}. "
                        "Traffic can only be shown for sites whose Google Analytics a connected account can open: connect that account, or enter its email."
                        if checked else "No connected Google account has Analytics access yet. Connect the account that owns the site's Google Analytics first."),
            "properties_available": []}


@router.get("/by-email")
def ga4_by_email(email: str | None = Query(None, max_length=255), website: str | None = None, property_id: str | None = Query(None, pattern=r"^\d{3,20}$"),
                 days: int = Query(28, ge=7, le=365), db: Session = Depends(get_db), _: User = Depends(current_user)):
    if not (email or "").strip():
        host = host_of(website)
        if not host or property_id:
            raise HTTPException(400, "Give the Google account email, or a website / domain to search the connected accounts.")
        return _by_website(db, host, days)
    conn = _connection(db, email)
    if conn.status != "active" or not conn.refresh_token_enc:
        raise HTTPException(409, "This Google account is disconnected. Connect it again (GET /analytics/ga4/start).")
    if not ga4.has_scope(conn):
        raise HTTPException(409, "This Google account has not granted Analytics access yet. Open the URL from GET /analytics/ga4/start?email=... and approve it.")

    businesses = list(db.scalars(select(Business).where(Business.connection_id == conn.id).order_by(Business.name)))
    hosts = {h for h in (host_of(website), *(host_of(b.website) for b in businesses)) if h} if not property_id else set()
    try:
        ga = ga4.Ga4(conn)
        if property_id:
            chosen, seen = [{"property": f"properties/{property_id}", "name": None, "account": None, "hosts": []}], []
        else:
            chosen, seen = ga4.match_properties(ga, hosts)
        if not chosen:
            return {"email": conn.email, "matched": False, "websites_looked_for": sorted(hosts),
                    "message": "No GA4 property of this account measures that website. Pass property_id (or website) to choose one.",
                    "properties_available": seen}
        reports: list[dict[str, Any]] = []
        for p in chosen[:5]:
            reports.append({"property_name": p["name"], "account": p["account"], "websites": p["hosts"]} | ga4.report(ga, p["property"], days))
    except ga4.Ga4Error as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"email": conn.email, "matched": True, "connection": {k: v for k, v in row(conn).items() if k in ("id", "email", "display_name", "status", "last_sync_at")},
            "businesses": [{"id": b.id, "name": b.name, "website": b.website} for b in businesses], "reports": reports}


@router.get("/realtime")
def ga4_realtime(email: str = Query(min_length=3, max_length=255), property_id: str = Query(pattern=r"^\d{3,20}$"), db: Session = Depends(get_db), _: User = Depends(current_user)):
    """GA4 Realtime overview + Realtime pages for one property of a connected account (the property id comes from /by-email)."""
    conn = _connection(db, email)
    if conn.status != "active" or not conn.refresh_token_enc:
        raise HTTPException(409, "This Google account is disconnected. Connect it again.")
    if not ga4.has_scope(conn):
        raise HTTPException(409, "This Google account has not granted Analytics access yet.")
    try:
        return ga4.realtime_report(ga4.Ga4(conn), f"properties/{property_id}")
    except ga4.Ga4Error as exc:
        raise HTTPException(502, str(exc)) from exc

