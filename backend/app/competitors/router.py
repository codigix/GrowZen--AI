"""Find competitors near a location (Google Maps). When `business_id` is set, competitors that
have a website are also saved against that business (deduped by website) so they can be audited
and compared later; without `business_id` this is read-only, same as before."""
from datetime import datetime, timezone
from urllib.parse import urlsplit

from ..config import get_settings
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


def _add_source(c: Competitor, source: str) -> None:
    """Remember every way a competitor was found (Google Maps, organic search, typed in), and keep its domain clean."""
    c.discovery = sorted({*(c.discovery or []), source})
    if c.website and not c.domain:
        c.domain = _host(c.website) or None


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


def upsert_without_website(db: Session, business_id: int, found: list[dict]) -> list[Competitor]:
    """Competitors found on Google Maps that have no website: saved by their Google place, so they are compared through their Google Business Profile like the others."""
    have = list(db.scalars(select(Competitor).where(Competitor.business_id == business_id)))
    saved = []
    for item in found:
        if (item.get("website") or "").strip() or not (item.get("name") or "").strip():
            continue
        pid, name = item.get("place_id") or item.get("cid") or None, item["name"].strip()
        if any((pid and c.place_id == pid) or (not c.website and c.name == name) for c in have):
            continue
        c = Competitor(business_id=business_id, website=None, place_id=pid, name=name[:255], address=item.get("address"), phone=item.get("phone") or None,
                       rating=item.get("rating") if isinstance(item.get("rating"), (int, float)) else None, reviews=item.get("reviews"), maps_link=item.get("maps_link"),
                       source="google_places", selected=False)
        db.add(c)
        have.append(c)
        saved.append(c)
    db.commit()
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
            _add_source(c, "manual")
            db.commit()
            return row(c)
    c = Competitor(business_id=b.id, website=website, name=body.name.strip() or host, source="manual", selected=True, domain=host, discovery=["manual"])
    db.add(c)
    db.commit()
    db.refresh(c)
    from ..backlinks import sync as backlink_sync
    backlink_sync.after_competitors_saved(db, b)  # tracked for backlinks and sent to the backlink crawler
    return row(c)


class MapsCompetitorIn(BaseModel):
    business_id: int
    name: str
    address: str | None = None
    cid: str | None = None  # its Google place id
    phone: str | None = None
    rating: float | None = None
    reviews: int | None = None
    maps_link: str | None = None
    website: str | None = None


@router.post("/maps", status_code=201)
def add_from_maps(body: MapsCompetitorIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Save a business found on Google Maps as a competitor, whether or not it has a website (one without is read through its Google listing)."""
    b = owned_business(db, user, body.business_id)
    for c in db.scalars(select(Competitor).where(Competitor.business_id == b.id)):
        if (body.cid and c.place_id == body.cid) or (body.website and c.website and _host(c.website) == _host(body.website)) or (not c.website and not c.place_id and c.name == body.name):
            c.place_id = c.place_id or body.cid
            _add_source(c, "google_places")
            db.commit()
            return row(c, {"listing"})
    c = Competitor(business_id=b.id, website=(body.website or None), place_id=body.cid, name=body.name.strip()[:255] or "Competitor", address=body.address, phone=body.phone, rating=body.rating,
                   reviews=body.reviews, maps_link=body.maps_link, source="google_places", selected=True,
                   domain=_host(body.website) or None, discovery=["google_places"])
    db.add(c)
    db.commit()
    db.refresh(c)
    if c.website:
        from ..backlinks import sync as backlink_sync
        backlink_sync.after_competitors_saved(db, b)
    return row(c, {"listing"})


def _own(db: Session, user: User, competitor_id: int) -> tuple[Competitor, Business]:
    c = db.get(Competitor, competitor_id)
    if not c:
        raise HTTPException(404, "Competitor not found")
    return c, owned_business(db, user, c.business_id)


def _region(b: Business) -> str:
    from ..services import countries, market
    return countries.gl(market.serp_country(b)).upper() or "IN"


@router.post("/{competitor_id}/listing-audit")
def listing_audit(competitor_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Audit a competitor through its Google Maps listing (for one with no website): the listing is checked and the AI works out its services and keywords. Stored on the competitor."""
    from . import listing_audit as la
    c, b = _own(db, user, competitor_id)
    try:
        out = la.audit_competitor(c, _region(b), b.lat, b.lng)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, "Google Maps could not be read right now. Try again in a minute.") from exc
    c.place_id, c.listing, c.listing_at = out["place_id"], out, datetime.now(timezone.utc)
    db.commit()
    return {"id": c.id, "score": out["score"], "understanding": out["understanding"], "audited_at": out["audited_at"]}


@router.post("/{competitor_id}/listing-compare")
def listing_compare(competitor_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Compare a competitor's audited Google listing with this business: the checks, the services and the keywords."""
    from ..models import Keyword
    from ..services import business_understanding
    from . import listing_audit as la
    c, b = _own(db, user, competitor_id)
    if not c.listing:  # not audited yet: read its Google listing now, so Compare needs no earlier step
        try:
            out = la.audit_competitor(c, _region(b), b.lat, b.lng)
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from exc
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(502, "Google Maps could not be read right now. Try again in a minute.") from exc
        c.place_id, c.listing, c.listing_at = out["place_id"], out, datetime.now(timezone.utc)
        db.commit()
    ours = None
    if b.place_id:
        try:
            ours = la.audit_one(b.place_id)
        except Exception:  # noqa: BLE001 - the comparison still shows the services and keywords
            ours = None
    brief = b.business_brief or {}
    services = list(dict.fromkeys([*(s.get("name") for s in (b.services or []) if s.get("name")), *(brief.get("offerings") or [])]))
    keywords = list(dict.fromkeys([*(k for k in db.scalars(select(Keyword.keyword).where(Keyword.business_id == b.id).limit(80))), *business_understanding.search_terms(b)]))
    return la.compare(b, c, ours, services, keywords)


MAX_CHOSEN = 8  # default; the real limit is COMPETITOR_WATCH_MAX


class ChooseIn(BaseModel):
    selected: bool


class KindIn(BaseModel):
    kind: str | None = None  # direct | indirect | None to clear


@router.patch("/{competitor_id}/kind")
def set_kind(competitor_id: int, body: KindIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Mark a competitor as a direct or indirect one (or clear it). A business found on Google Maps is not automatically a direct organic competitor."""
    c, _b = _own(db, user, competitor_id)
    if body.kind not in (None, "direct", "indirect"):
        raise HTTPException(400, "kind must be direct, indirect or empty")
    c.kind = body.kind
    db.commit()
    return row(c, {"listing"})


@router.patch("/{competitor_id}")
def choose(competitor_id: int, body: ChooseIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Choose a found competitor for Competitor Watch and the keyword, traffic and link steps, or leave it out again."""
    c = db.get(Competitor, competitor_id)
    if c is None:
        raise HTTPException(404, "Competitor not found")
    b = owned_business(db, user, c.business_id)
    if body.selected and c.selected is False:
        chosen = sum(1 for x in db.scalars(select(Competitor).where(Competitor.business_id == b.id)) if x.selected is not False)
        limit = max(1, get_settings().competitor_watch_max)
        if chosen >= limit:
            raise HTTPException(400, f"{chosen} competitors are already chosen, and the weekly watch visits up to {limit}. Untick one first, or raise COMPETITOR_WATCH_MAX in the server settings.")
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
    out = []
    for c in db.scalars(q):
        r = row(c, {"listing"})
        r["listing_done"] = bool(c.listing)
        r["listing_score"] = (c.listing or {}).get("score")
        out.append(r)
    return out
