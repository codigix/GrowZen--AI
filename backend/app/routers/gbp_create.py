"""Create a brand-new Google Business Profile from a project that has none, and link it.

GET  /businesses/{id}/gbp/create/accounts?connection_id=   the Google accounts that can own a new profile
GET  /businesses/{id}/gbp/create/categories?connection_id=&q=   Google's own categories (a profile needs one of them)
POST /businesses/{id}/gbp/create   {connection_id, account, category, address, validate_only}
       validate_only=true asks Google to check the profile (duplicates, address, category) and creates nothing.

Google does not show a new profile until it is verified: the next step is Verification in Settings.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..conn_access import my_connection
from ..db import get_db
from ..deps import get_business
from ..models import Business
from ..services import gbp
from ..services.activity import log

router = APIRouter(prefix="/businesses/{business_id}/gbp/create", tags=["gbp-create"])


def _client(db: Session, user: User, connection_id: int) -> tuple[gbp.GbpClient, object]:
    c = my_connection(db, user, connection_id)  # 404 for another person's Google account
    return gbp.GbpClient(c), c


def _google(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except gbp.GbpError as exc:
        msg = str(exc)
        if any(w in msg.lower() for w in ("already exist", "duplicate", "already_exists")):
            raise HTTPException(409, f"Google says this business already exists, so it was not created. Find it with Connect Google account instead, so it is claimed and not duplicated. ({msg})") from exc
        raise HTTPException(502, f"Google did not accept this: {msg}") from exc


@router.get("/accounts")
def accounts(connection_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    client, _ = _client(db, user, connection_id)
    return [{"name": a["name"], "title": a.get("accountName") or a["name"], "type": a.get("type"), "role": a.get("role")} for a in _google(client.accounts)]


@router.get("/categories")
def categories(connection_id: int, q: str, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    if len(q.strip()) < 2:
        return []
    client, _ = _client(db, user, connection_id)
    return _google(client.search_categories, q.strip(), (b.country or "IN").upper())


class AddressIn(BaseModel):
    address_lines: list[str] = Field(min_length=1, max_length=3)
    locality: str = Field(min_length=1, max_length=120)
    administrative_area: str = Field(default="", max_length=120)
    postal_code: str = Field(default="", max_length=20)
    region_code: str = Field(pattern=r"^[A-Za-z]{2}$")


class CreateIn(BaseModel):
    connection_id: int
    account: str = Field(pattern=r"^accounts/[^/]+$")
    category: str = Field(pattern=r"^categories/")
    address: AddressIn
    validate_only: bool = False


def location_body(b: Business, category: str, a: AddressIn) -> dict:
    """The new profile, from what the project already holds."""
    lines = [x.strip() for x in a.address_lines if x and x.strip()]
    if not lines:
        raise HTTPException(422, "Add at least one address line.")
    address = {"regionCode": a.region_code.upper(), "languageCode": "en", "addressLines": lines, "locality": a.locality.strip()}
    if a.administrative_area.strip():
        address["administrativeArea"] = a.administrative_area.strip()
    if a.postal_code.strip():
        address["postalCode"] = a.postal_code.strip()
    body: dict = {"title": b.name.strip(), "languageCode": "en", "storefrontAddress": address, "categories": {"primaryCategory": {"name": category}}}
    if b.phone:
        body["phoneNumbers"] = gbp.phone_numbers_body(b.phone, b.additional_phones)
    if b.website:
        body["websiteUri"] = b.website
    if b.description:
        body["profile"] = {"description": b.description}
    if (b.hours or {}).get("periods"):
        body["regularHours"] = {"periods": b.hours["periods"]}
    return body


@router.post("", status_code=201)
def create(body: CreateIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    if b.gbp_location:
        raise HTTPException(409, "This project is already linked to a Google Business Profile.")
    if not (b.name or "").strip():
        raise HTTPException(422, "The project needs a business name first.")
    client, conn = _client(db, user, body.connection_id)
    if body.account not in {a["name"] for a in _google(client.accounts)}:
        raise HTTPException(400, "That Google account cannot create profiles under the chosen business account.")
    new = location_body(b, body.category, body.address)
    params = {"validateOnly": "true"} if body.validate_only else {"requestId": str(uuid.uuid5(uuid.NAMESPACE_URL, f"growzen-create-{b.id}-{b.name}-{body.account}"))}
    created = _google(client._req, "POST", f"{gbp.INFO}/{body.account}/locations", params=params, json=new)
    if body.validate_only:
        return {"ok": True, "message": "Google accepts these details. Nothing was created yet."}
    name = created.get("name")
    if not name:
        raise HTTPException(502, "Google did not return the new profile. Check the Google account, then try again.")
    b.gbp_account, b.gbp_location, b.connection_id, b.verification = body.account, name, conn.id, "unverified"
    log(db, user.name, "gbp_created", b.id, location=name)
    db.commit()
    try:
        gbp.sync_business(db, b)
    except gbp.GbpError:
        pass  # linked all the same; Sync now brings the rest in once Google has finished creating it
    db.refresh(b)
    return {"ok": True, "location": name, "verification": b.verification, "next": "verify"}
