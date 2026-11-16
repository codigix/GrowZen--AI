"""GET /businesses/{id}/flow: the journey (ten steps in order, what each needs first, and the next thing to do), from stored data only."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import get_business, my_business_ids
from ..models import Business
from ..services import flow, website_health

router = APIRouter(prefix="/businesses/{business_id}/flow", tags=["flow"])


@router.get("")
def get_flow(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return flow.evaluate(db, b)


@router.get("/website-health", include_in_schema=True)
def website_health_view(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """The site audit and Page X-Ray, merged by topic (stored results only)."""
    return website_health.build(db, b)


projects_router = APIRouter(prefix="/flow", tags=["flow"])


@projects_router.get("/projects")
def projects_journey(db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Where each of the user's projects stands on its own journey: steps done, the step it is on now and its address."""
    ids = my_business_ids(db, user)
    q = select(Business).order_by(Business.id)
    if ids is not None:
        q = q.where(Business.id.in_(ids))
    out = {}
    for b in db.scalars(q):
        try:
            f = flow.evaluate(db, b)
        except Exception:  # noqa: BLE001 - one project's problem must not hide the others
            db.rollback()
            continue
        nxt = f.get("next")
        out[b.id] = {"done": f["done"], "total": f["total"], "percent": f["percent"], "next": {"order": next((s["order"] for s in f["steps"] if s["key"] == nxt["key"]), None), "title": nxt["title"], "link": nxt["link"]} if nxt else None}
    return {"projects": out}
