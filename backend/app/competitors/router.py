"""Find competitors near a location (Google Maps). When `business_id` is set, competitors that
have a website are also saved against that business (deduped by website) so they can be audited
and compared later; without `business_id` this is read-only, same as before."""
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import owned_business
from ..models import Business, Competitor
from ..schemas import CompetitorManualIn, CompetitorRegisterIn
from ..serialize import row, rows
from ..services.crawler import homepage
from ..services.url_safety import SSRFValidationError, validate_url_shape
from . import service

router = APIRouter(prefix="/competitors", tags=["competitors"], dependencies=[Depends(current_user)])


def _upsert(db: Session, business_id: int, found: list[dict]) -> list[Competitor]:
    existing = {c.website: c for c in db.scalars(select(Competitor).where(Competitor.business_id == business_id)) if c.website}
    saved = []
    for item in found:
        website = (item.get("website") or "").strip()
        if not website:
            continue  # nothing to audit or compare without a website; keep it in the raw results only
        c = existing.get(website)
        if not c:
            c = Competitor(business_id=business_id, website=website, source="google_places")
            db.add(c)
        c.name = item.get("name") or c.name or website
        c.address = item.get("address") or c.address
        c.phone = item.get("phone") or c.phone
        c.rating = item.get("rating") if isinstance(item.get("rating"), (int, float)) else c.rating
        c.reviews = item.get("reviews") or c.reviews
        c.maps_link = item.get("maps_link") or c.maps_link
        saved.append(c)
    db.commit()
    for c in saved:
        db.refresh(c)
    return saved


@router.post("")
def find(body: CompetitorRegisterIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Top competitors on Google Maps for a type of business near a location. Pass `business_id`
    to also register the ones with a website against that business."""
    try:
        results = service.find_competitors(body.business_type.strip(), body.location.strip(), body.own_firm_name.strip(), body.top_n)
    except service.CompetitorSearchError as exc:
        raise HTTPException(400, str(exc)) from exc
    out = {"business_type": body.business_type, "location": body.location, "count": len(results), "competitors": results}
    if body.business_id is not None:
        owned_business(db, user, body.business_id)
        saved = _upsert(db, body.business_id, results)
        out["registered"] = rows(saved)
    return out


def _host(url: str | None) -> str:
    host = (urlsplit(url or "").hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


@router.post("/manual", status_code=201)
def add_manual(body: CompetitorManualIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Register a competitor from a URL or domain the user typed. Returns the existing one when
    a competitor with the same host is already registered for this business."""
    b = owned_business(db, user, body.business_id)
    try:
        website = validate_url_shape(homepage(body.url.strip().lower()))  # homepage() keeps only scheme + host, so lowercasing is safe
    except SSRFValidationError as exc:
        raise HTTPException(400, str(exc)) from exc
    host = _host(website)
    if "." not in host:
        raise HTTPException(400, "Enter a full domain, e.g. example.com")
    if b.website and _host(homepage(b.website)) == host:
        raise HTTPException(400, "That is your own website")
    for c in db.scalars(select(Competitor).where(Competitor.business_id == b.id)):
        if _host(c.website) == host:
            return row(c)
    c = Competitor(business_id=b.id, website=website, name=body.name.strip() or host, source="manual")
    db.add(c)
    db.commit()
    db.refresh(c)
    return row(c)


@router.get("")
def list_for_business(business_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Competitors already registered against a business, for picking one to audit or compare."""
    owned_business(db, user, business_id)
    q = select(Competitor).where(Competitor.business_id == business_id).order_by(Competitor.name)
    return rows(db.scalars(q))
