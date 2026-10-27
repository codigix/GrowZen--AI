"""Find a business from an email address (public website + Google Maps), then add and audit it."""
import re
from datetime import datetime
from urllib.parse import urlparse

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import in_background
from ..models import Business, Review
from ..schemas import DiscoverImportIn, DiscoverIn
from ..serialize import row
from ..services import agent, audits, discovery, schedules
from ..services.activity import log

router = APIRouter(prefix="/discover", tags=["discover"])


@router.post("")
def find(body: DiscoverIn, _: User = Depends(current_user)):
    try:
        return discovery.discover(body.email, body.name.strip(), body.city.strip())
    except discovery.DiscoveryError as exc:
        raise HTTPException(400, str(exc)) from exc


def _digits(s: str | None) -> str:
    return re.sub(r"\D", "", s or "")[-10:]


def _domain(url: str | None) -> str:
    return urlparse(url if (url or "").startswith("http") else f"https://{url}").netloc.removeprefix("www.") if url else ""


def _existing(db: Session, c: dict) -> Business | None:
    if c.get("place_id"):
        b = db.scalar(select(Business).where(Business.place_id == c["place_id"]))
        if b:
            return b
    for b in db.scalars(select(Business)):
        if c.get("phone") and _digits(b.phone) and _digits(b.phone) == _digits(c["phone"]):
            return b
        if c.get("website") and _domain(b.website) and _domain(b.website) == _domain(c["website"]):
            return b
    return None


def _onboard(db: Session, business_id: int) -> None:
    """Full audit, planned fixes and the plan's schedule (same as the email pipeline)."""
    b = db.get(Business, business_id)
    if not b:
        return
    found = audits.run_all(db, b)
    tasks = agent.plan_from_audits(db, b, [i for a in found if a.status == "done" for i in a.issues])
    schedules.create_for_plan(db, b)
    b.status = "needs_approval" if any(t.requires_approval and t.status == "pending" for t in tasks) else "active"
    db.commit()


@router.post("/import", status_code=201)
def add(body: DiscoverImportIn, tasks: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(current_user)):
    c = body.candidate
    if not c.get("name"):
        raise HTTPException(400, "The chosen result has no business name.")
    b = _existing(db, c)
    created = b is None
    b = b or Business(name=c["name"], source="email", created_by=user.name)
    fields = {"name": c.get("name"), "address": c.get("address"), "phone": c.get("phone"), "website": c.get("website"), "lat": c.get("lat"), "lng": c.get("lng"),
              "primary_category": c.get("category"), "place_id": c.get("place_id"), "rating": c.get("rating"), "review_count": c.get("review_count"),
              "description": (c.get("description") or None)}
    for k, v in fields.items():
        if v not in (None, "") and not getattr(b, k, None):
            setattr(b, k, v[:750] if k == "description" and isinstance(v, str) else v)
    if c.get("hours") and not b.hours:
        b.hours = {"weekdayDescriptions": c["hours"]}
    if body.email and not b.contact_email:
        b.contact_email = body.email
    if not b.plan:
        b.plan = body.plan or "Starter"
    if b.address and not b.city:
        parts = [p.strip() for p in b.address.split(",") if p.strip()]
        city = next((p for p in reversed(parts) if not re.search(r"\d", p) and p.lower() not in ("india", "maharashtra")), None)
        if city:
            b.city = city
            b.area = b.area or (parts[-3] if len(parts) >= 3 and parts[-3] != city else None)
    db.add(b)
    db.commit()

    # Google Maps details: up to 5 recent reviews and the photo count.
    imported_reviews = 0
    if b.place_id and discovery.places_enabled():
        try:
            d = discovery.place_details(b.place_id)
            b.photo_count = b.photo_count or len(d.get("photos") or [])
            for rv in d.get("reviews") or []:
                ext = rv.get("name")
                if db.scalar(select(Review).where(Review.business_id == b.id, Review.external_id == ext)):
                    continue
                when = rv.get("publishTime")
                db.add(Review(business_id=b.id, external_id=ext, author=(rv.get("authorAttribution") or {}).get("displayName"), rating=int(rv.get("rating") or 0),
                              body=(rv.get("text") or {}).get("text"), review_date=datetime.fromisoformat(when.replace("Z", "+00:00")).date() if when else None,
                              sentiment="positive" if (rv.get("rating") or 0) >= 4 else "negative" if (rv.get("rating") or 0) <= 2 else "neutral"))
                imported_reviews += 1
            db.commit()
        except discovery.DiscoveryError:
            pass

    log(db, user.name, "business_found_by_email" if created else "business_updated_by_email", b.id, email=body.email, source=c.get("source"), place_id=b.place_id)
    db.commit()
    tasks.add_task(in_background(_onboard, b.id))
    return row(b) | {"created": created, "imported_reviews": imported_reviews}
