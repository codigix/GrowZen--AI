"""Which projects each person can open (admin only).

A person always has the projects they added (they are the owner). An admin can give them more by ticking projects, and take them away again: that is
a manager entry on the project for the person's sign-in email (BusinessManager), the same access the project's "managers" list gives, so everything
else (the project list, every project page, deleting) already follows it. Admins see every project without being ticked anywhere.

GET /users/{id}/projects   every project with how this person has it: owner | shared | by email (contact or Google account, set on the project) | none
PUT /users/{id}/projects   {business_ids: [...]}: exactly these projects are shared with this person (the ones they own stay theirs)
GET /projects-access       every project with its owner and the people it is shared with (the admin's overview)"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import User, require_admin
from ..db import get_db
from ..models import AppUser, Business, BusinessManager
from ..services.activity import log

router = APIRouter(tags=["access"])


class AccessIn(BaseModel):
    business_ids: list[int] = Field(default_factory=list, max_length=1000)


def _person(db: Session, user_id: int) -> AppUser:
    u = db.get(AppUser, user_id)
    if not u:
        raise HTTPException(404, "User not found")
    return u


def _owner_names(db: Session) -> dict[str, str]:
    return {str(u.id): u.name for u in db.scalars(select(AppUser))}


def _how(b: Business, me: AppUser) -> str:
    email = (me.email or "").strip().lower()
    if me.role == "admin":
        return "admin"
    if b.owner_id == str(me.id):
        return "owner"
    via_contact = (b.contact_email or "").strip().lower() == email
    via_google = bool(b.connection and (b.connection.email or "").strip().lower() == email)
    if email and (via_contact or via_google):
        return "email"
    return "none"


@router.get("/users/{user_id}/projects")
def person_projects(user_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)) -> dict:
    me = _person(db, user_id)
    email = (me.email or "").strip().lower()
    shared = set(db.scalars(select(BusinessManager.business_id).where(BusinessManager.email == email))) if email else set()
    owners = _owner_names(db)
    rows = []
    for b in db.scalars(select(Business).order_by(func.lower(Business.name), Business.id)):
        how = _how(b, me)
        if how in ("none", "email") and b.id in shared:
            how = "shared"
        rows.append({"id": b.id, "name": b.name, "website": b.website, "owner": owners.get(b.owner_id or "", b.created_by or "—"), "access": how,
                     # an owner (or an admin) has it without being ticked; "email" comes from the project's contact or Google account, changed on the project itself
                     "locked": how in ("owner", "admin", "email")})
    return {"user": {"id": me.id, "name": me.name, "email": me.email, "role": me.role}, "projects": rows,
            "note": "An admin opens every project." if me.role == "admin" else None}


@router.put("/users/{user_id}/projects")
def set_person_projects(user_id: int, body: AccessIn, db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> dict:
    me = _person(db, user_id)
    email = (me.email or "").strip().lower()
    if not email:
        raise HTTPException(422, "This person has no email, so projects cannot be shared with them.")
    if me.role == "admin":
        raise HTTPException(422, "An admin already opens every project: there is nothing to give.")
    known = set(db.scalars(select(Business.id)))
    unknown = sorted(set(body.business_ids) - known)
    if unknown:
        raise HTTPException(422, f"Not a project: {unknown[:5]}")
    owned = set(db.scalars(select(Business.id).where(Business.owner_id == str(me.id))))
    want = set(body.business_ids) - owned  # what they own is theirs already
    have = {m.business_id: m for m in db.scalars(select(BusinessManager).where(BusinessManager.email == email))}
    for bid, m in have.items():
        if bid not in want:
            db.delete(m)
    for bid in want - set(have):
        db.add(BusinessManager(business_id=bid, email=email))
    log(db, admin.name, "user_projects_changed", None, user=me.email, shared=len(want))
    db.commit()
    return {"ok": True, "shared": len(want), "owned": len(owned)}


@router.get("/projects-access")
def projects_overview(db: Session = Depends(get_db), _: User = Depends(require_admin)) -> list[dict]:
    owners = _owner_names(db)
    by_project: dict[int, list[str]] = {}
    for m in db.scalars(select(BusinessManager).order_by(BusinessManager.email)):
        by_project.setdefault(m.business_id, []).append(m.email)
    return [{"id": b.id, "name": b.name, "website": b.website, "owner": owners.get(b.owner_id or "", b.created_by or "—"), "shared_with": by_project.get(b.id, [])}
            for b in db.scalars(select(Business).order_by(func.lower(Business.name), Business.id))]
