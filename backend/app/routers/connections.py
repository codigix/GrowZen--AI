"""Connect Google accounts and import the Business Profiles they manage."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..config import get_settings
from ..db import get_db
from ..models import Business, GoogleConnection
from ..schemas import ImportLocationsIn
from ..serialize import row
from ..services import audits, gbp
from ..services.activity import log

router = APIRouter(prefix="/connections", tags=["connections"])


def _conn(db: Session, connection_id: int) -> GoogleConnection:
    c = db.get(GoogleConnection, connection_id)
    if not c:
        raise HTTPException(404, "Connection not found")
    return c


@router.get("")
def list_connections(db: Session = Depends(get_db), _: User = Depends(current_user)):
    out = []
    for c in db.scalars(select(GoogleConnection).order_by(GoogleConnection.email)):
        n = len(list(db.scalars(select(Business.id).where(Business.connection_id == c.id))))
        out.append(row(c) | {"businesses": n})
    return out


@router.get("/google/setup")
def google_setup(_: User = Depends(current_user)):
    """The Google Cloud settings Connect Google needs (redirect URI, APIs, access form)."""
    return gbp.setup_info()


@router.get("/google/start")
def google_start(user: User = Depends(current_user)):
    """Returns Google's sign-in URL; the frontend sends the browser there."""
    try:
        return {"url": gbp.auth_url(user.id)}
    except gbp.GbpError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/google/callback")
def google_callback(code: str = "", state: str = "", error: str = "", db: Session = Depends(get_db)):
    """Google redirects here after sign-in; we store the account and send the user back to the app."""
    front = get_settings().frontend_url.rstrip("/")
    if error or not code:
        return RedirectResponse(f"{front}/connect-result?error={error or 'cancelled'}")
    try:
        actor = gbp.read_state(state)
        conn = gbp.exchange_code(db, code, f"user {actor}")
        log(db, f"user {actor}", "google_connected", None, email=conn.email)
        db.commit()
    except gbp.GbpError as exc:
        return RedirectResponse(f"{front}/connect-result?error={str(exc)[:200]}")
    return RedirectResponse(f"{front}/connect-result?connection={conn.id}")


@router.get("/{connection_id}/locations")
def locations(connection_id: int, db: Session = Depends(get_db), _: User = Depends(current_user)):
    """Every business location the account owns or manages, marked if already imported."""
    c = _conn(db, connection_id)
    try:
        found = gbp.GbpClient(c).all_locations()
    except gbp.GbpError as exc:
        c.last_error = str(exc)[:500]
        db.commit()
        raise HTTPException(502, str(exc)) from exc
    imported = set(db.scalars(select(Business.gbp_location).where(Business.gbp_location.is_not(None))))
    return [gbp.location_to_fields(l) | {"imported": l.get("name") in imported, "account_role": l.get("account_role")} for l in found]


@router.post("/{connection_id}/import")
def import_locations(connection_id: int, body: ImportLocationsIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Import the chosen locations as businesses, sync them and run the GBP audit."""
    c = _conn(db, connection_id)
    try:
        wanted = {l["name"]: l for l in gbp.GbpClient(c).all_locations() if l.get("name") in set(body.locations)}
    except gbp.GbpError as exc:
        raise HTTPException(502, str(exc)) from exc
    out = []
    for name in body.locations:
        loc = wanted.get(name)
        if not loc:
            continue
        b = gbp.import_location(db, c, loc, user.name)
        db.commit()
        try:
            gbp.sync_business(db, b)
        except gbp.GbpError:
            pass
        audits.run(db, b, "gbp")
        log(db, user.name, "business_imported", b.id, location=name, email=c.email)
        db.commit()
        out.append(row(b))
    return out


@router.post("/{connection_id}/sync")
def sync_connection(connection_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    c = _conn(db, connection_id)
    done, failed = 0, []
    for b in db.scalars(select(Business).where(Business.connection_id == c.id)):
        try:
            gbp.sync_business(db, b)
            done += 1
        except gbp.GbpError as exc:
            failed.append({"business": b.name, "error": str(exc)[:200]})
    log(db, user.name, "connection_synced", None, email=c.email, done=done, failed=len(failed))
    db.commit()
    return {"synced": done, "failed": failed}


@router.delete("/{connection_id}", status_code=204)
def disconnect(connection_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    c = _conn(db, connection_id)
    c.status, c.refresh_token_enc = "revoked", None
    log(db, user.name, "google_disconnected", None, email=c.email)
    db.commit()
