"""Find competitors near a location (Google Maps). When `business_id` is set, competitors that
have a website are also saved against that business (deduped by website) so they can be audited
and compared later; without `business_id` this is read-only, same as before."""
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
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
from . import hygiene, service

router = APIRouter(prefix="/competitors", tags=["competitors"], dependencies=[Depends(current_user)])


def _upsert(db: Session, business_id: int, found: list[dict]) -> list[Competitor]:
    owner = db.get(Business, business_id)
    existing = {c.website: c for c in db.scalars(select(Competitor).where(Competitor.business_id == business_id)) if c.website}
    saved = []
    for item in found:
        website = (item.get("website") or "").strip()
        if not website:
            continue  # nothing to audit or compare without a website; keep it in the raw results only
        if hygiene.skip_reason(owner, website):
            continue  # the business itself, or a social / directory page: not a competitor's website
        c = existing.get(website)
        if not c:
            c = Competitor(business_id=business_id, website=website, source="google_places", selected=False)  # found, not yet chosen
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
    if saved and owner is not None:
        from ..backlinks import sync as backlink_sync
        backlink_sync.after_competitors_saved(db, owner)  # the new competitors are tracked and sent to the backlink crawler
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
    why = hygiene.skip_reason(b, website)
    if why:
        raise HTTPException(400, why)
    for c in db.scalars(select(Competitor).where(Competitor.business_id == b.id)):
        if _host(c.website) == host:
            if c.selected is False:  # typed in by hand: that is a choice
                c.selected = True
                db.commit()
            return row(c)
    c = Competitor(business_id=b.id, website=website, name=body.name.strip() or host, source="manual", selected=True)
    db.add(c)
    db.commit()
    db.refresh(c)
    from ..backlinks import sync as backlink_sync
    backlink_sync.after_competitors_saved(db, b)  # tracked for backlinks and sent to the backlink crawler
    return row(c)


MAX_CHOSEN = 8  # the weekly watch visits at most this many


class ChooseIn(BaseModel):
    selected: bool


@router.patch("/{competitor_id}")
def choose(competitor_id: int, body: ChooseIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Choose a found competitor for Competitor Watch and the keyword, traffic and link steps, or leave it out again."""
    c = db.get(Competitor, competitor_id)
    if c is None:
        raise HTTPException(404, "Competitor not found")
    b = owned_business(db, user, c.business_id)
    if body.selected and c.selected is False:
        chosen = sum(1 for x in db.scalars(select(Competitor).where(Competitor.business_id == b.id)) if x.selected is not False)
        if chosen >= MAX_CHOSEN:
            raise HTTPException(400, f"Choose up to {MAX_CHOSEN} competitors: the weekly watch visits that many. Leave one out first.")
    c.selected = body.selected
    from ..backlinks.models import BiTrackedTarget
    from ..backlinks import sync
    h = _host(c.website)
    for t in db.scalars(select(BiTrackedTarget).where(BiTrackedTarget.business_id == b.id, BiTrackedTarget.is_competitor.is_(True))):
        if _host("//" + (t.domain or "")) == h:
            t.monitoring_enabled = body.selected  # a competitor left out is no longer visited or counted
    db.commit()
    if body.selected:
        sync.after_competitors_saved(db, b)  # tracked for backlinks and sent to the backlink crawler, like one added by hand
    return row(c)


@router.delete("/{competitor_id}", status_code=204)
def remove(competitor_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Take a competitor off the project's list (its saved audits stay in the history)."""
    c = db.get(Competitor, competitor_id)
    if c is None:
        raise HTTPException(404, "Competitor not found")
    owned_business(db, user, c.business_id)  # 404 for another account's project
    db.delete(c)
    db.commit()


@router.get("")
def list_for_business(business_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Competitors already registered against a business, for picking one to audit or compare."""
    owned_business(db, user, business_id)
    q = select(Competitor).where(Competitor.business_id == business_id).order_by(Competitor.name)
    return rows(db.scalars(q))
