"""Settings of a client's Google Business Profile: verification, who manages it on Google, and deleting it from Google."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import get_business
from ..models import Business
from ..services import gbp
from ..services.activity import log

router = APIRouter(prefix="/businesses/{business_id}/gbp", tags=["gbp-admin"])

METHODS = {"ADDRESS", "EMAIL", "PHONE_CALL", "SMS", "AUTO", "VETTED_PARTNER"}
ROLES = {"OWNER", "MANAGER", "SITE_MANAGER"}


def _client(b: Business) -> gbp.GbpClient:
    if not (b.connection and b.gbp_account and b.gbp_location):
        raise HTTPException(409, "This client is not linked to a Google Business Profile yet. Connect the Google account first.")
    return gbp.GbpClient(b.connection)


def _google(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except gbp.GbpError as exc:
        raise HTTPException(502, f"Google did not accept this: {exc}") from exc


# Verification
@router.get("/verification")
def verification(b: Business = Depends(get_business)):
    c = _client(b)
    out: dict = {"state": b.verification, "options": [], "history": [], "options_error": None}
    try:  # a verified profile has no options: Google answers with an error, which is not a failure here
        out["options"] = c.verification_options(b.gbp_location)
    except gbp.GbpError as exc:
        out["options_error"] = str(exc)
    try:
        out["history"] = c.verifications(b.gbp_location)
    except gbp.GbpError as exc:
        out["history_error"] = str(exc)
    return out


class VerifyStartIn(BaseModel):
    method: str
    email: str | None = None
    phone: str | None = None


@router.post("/verification/start")
def start_verification(body: VerifyStartIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    if body.method not in METHODS:
        raise HTTPException(400, f"Method must be one of {sorted(METHODS)}")
    if body.method == "EMAIL" and not (body.email and "@" in body.email):
        raise HTTPException(400, "Choose the email address Google offered.")
    if body.method in ("PHONE_CALL", "SMS") and not (body.phone or "").strip():
        raise HTTPException(400, "Choose the phone number Google offered.")
    v = _google(_client(b).start_verification, b.gbp_location, body.method, body.email, body.phone)
    log(db, user.name, "gbp_verification_started", b.id, method=body.method)
    db.commit()
    return v


class VerifyCompleteIn(BaseModel):
    verification_id: str = Field(min_length=1, max_length=300)
    pin: str = Field(min_length=3, max_length=20)


@router.post("/verification/complete")
def complete_verification(body: VerifyCompleteIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    name = body.verification_id if body.verification_id.startswith("locations/") else f"{b.gbp_location}/verifications/{body.verification_id}"
    if not name.startswith(f"{b.gbp_location}/verifications/"):
        raise HTTPException(400, "That verification does not belong to this client's profile.")
    v = _google(_client(b).complete_verification, name, body.pin.strip())
    if v.get("state") == "COMPLETED":
        b.verification = "verified"
    log(db, user.name, "gbp_verification_completed", b.id, state=v.get("state"))
    db.commit()
    return v


# Managers on the Google profile
def _admin_row(a: dict, own_email: str) -> dict:
    email = (a.get("admin") or "").lower()
    role = a.get("role")
    return {"name": a.get("name"), "email": a.get("admin"), "role": role, "pending": bool(a.get("pendingInvitation")),
            "removable": role != "PRIMARY_OWNER" and email != own_email}


@router.get("/managers")
def managers(b: Business = Depends(get_business)):
    c = _client(b)
    own = (b.connection.email or "").lower()
    return [_admin_row(a, own) for a in _google(c.admins, b.gbp_location)]


class ManagerIn(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    role: Literal["OWNER", "MANAGER", "SITE_MANAGER"] = "MANAGER"


@router.post("/managers", status_code=201)
def add_manager(body: ManagerIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    email = body.email.strip().lower()
    if "@" not in email or " " in email:
        raise HTTPException(400, "Enter a valid email address.")
    created = _google(_client(b).add_admin, b.gbp_location, email, body.role)
    log(db, user.name, "gbp_manager_added", b.id, role=body.role)
    db.commit()
    return _admin_row(created, (b.connection.email or "").lower())


@router.delete("/managers", status_code=204)
def remove_manager(name: str, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    c = _client(b)
    if not name.startswith(f"{b.gbp_location}/admins/"):
        raise HTTPException(400, "That person does not belong to this client's profile.")
    target = next((a for a in _google(c.admins, b.gbp_location) if a.get("name") == name), None)
    if not target:
        raise HTTPException(404, "That person is not on this profile any more.")
    if target.get("role") == "PRIMARY_OWNER":
        raise HTTPException(400, "The primary owner cannot be removed here. Transfer ownership on Google first.")
    if (target.get("admin") or "").lower() == (b.connection.email or "").lower():
        raise HTTPException(400, "This is the account connected to the software. Removing it would lock this client out.")
    _google(c.remove_admin, name)
    log(db, user.name, "gbp_manager_removed", b.id)
    db.commit()


# Deleting the profile on Google
class DeleteProfileIn(BaseModel):
    confirm_name: str


@router.delete("/profile")
def delete_profile(body: DeleteProfileIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Delete the listing on Google, then unlink this project from it. The project itself stays."""
    c = _client(b)
    if body.confirm_name.strip() != b.name.strip():
        raise HTTPException(400, "Type the business name exactly to confirm.")
    _google(c.delete_location, b.gbp_location)
    gone = b.gbp_location
    b.gbp_location = b.gbp_account = b.connection_id = b.place_id = None
    b.verification, b.gbp_status, b.duplicate_listing = "unknown", {}, False
    log(db, user.name, "gbp_profile_deleted", b.id, location=gone)
    db.commit()
    return {"deleted": gone, "linked": False}
