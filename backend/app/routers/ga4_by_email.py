"""Website traffic (Google Analytics 4) for a connected Google account / website.

GET /analytics/ga4/start?email=...        -> Google sign-in URL that grants the Analytics permission (needed once per account)
GET /analytics/ga4/by-email?business_id=...  -> the GA4 overview of ONE project's own website (users, sessions, channels, countries, pages, devices, sources)
      optional: property_id=123456789  days=28
GET /analytics/ga4/realtime?business_id=...&property_id=...

Only a project whose access checklist is complete (see app/access.py) gets data: its website, the Google account linked to it, the Analytics
and Search Console permissions, a GA4 property that measures the site, and the site verified in Search Console. The website and the account
are the project's own: they cannot be typed in, so nothing about another site can be read through this route.
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
from ..conn_access import only_my_connections, owns_connection
from ..db import get_db
from ..deps import only_mine, owned_business
from .. import access
from ..models import Business, GoogleConnection
from ..serialize import row
from ..services import ga4, gbp
from ..services.gsc import host_of

router = APIRouter(prefix="/analytics/ga4", tags=["ga4-by-email"])


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
              "include_granted_scopes": "true", "scope": gbp.ALL_SCOPES, "state": state}
    if email:
        params["login_hint"] = email
    return {"url": f"{gbp.AUTH_URL}?{urlencode(params)}"}


@router.get("/by-email")
def ga4_by_email(business_id: int = Query(ge=1), property_id: str | None = Query(None, pattern=r"^\d{3,20}$"), days: int = Query(28, ge=7, le=365),
                 db: Session = Depends(get_db), user: User = Depends(current_user)):
    """The Google Analytics 4 report of the project's own website (a property that measures it), once the project's access checklist is complete."""
    b = owned_business(db, user, business_id)
    props = access.ga4_properties(db, user, b)  # 409 access_incomplete until every website step is done
    if property_id:
        props = [p for p in props if p["property"] == f"properties/{property_id}"]
        if not props:
            raise HTTPException(404, "That Analytics property does not measure this project's website.")
    conn = b.connection
    try:
        ga = ga4.Ga4(conn)
        reports = [{"property_name": p["name"], "account": p["account"], "websites": p["hosts"]} | ga4.report(ga, p["property"], days) for p in props[:5]]
    except ga4.Ga4Error as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"email": conn.email, "matched": True, "connection": {k: v for k, v in row(conn).items() if k in ("id", "email", "display_name", "status", "last_sync_at")},
            "businesses": [{"id": b.id, "name": b.name, "website": b.website}], "reports": reports}


@router.get("/realtime")
def ga4_realtime(business_id: int = Query(ge=1), property_id: str = Query(pattern=r"^\d{3,20}$"), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """GA4 Realtime overview + Realtime pages for one property of the project's website (the property id comes from /by-email)."""
    b = owned_business(db, user, business_id)
    if f"properties/{property_id}" not in {p["property"] for p in access.ga4_properties(db, user, b)}:
        raise HTTPException(404, "That Analytics property does not measure this project's website.")
    try:
        return ga4.realtime_report(ga4.Ga4(b.connection), f"properties/{property_id}")
    except ga4.Ga4Error as exc:
        raise HTTPException(502, str(exc)) from exc
