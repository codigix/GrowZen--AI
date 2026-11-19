"""The public Google Maps view of a project's listing.

GET  /businesses/{id}/maps-public         what anyone sees on Maps, set against what the project has saved (?fresh=1 skips the 10-minute cache)
POST /businesses/{id}/maps-public/apply   {fields:[...]} copy the chosen Maps values into the project (not for profiles connected to Google)
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_business
from ..models import Business
from ..services import discovery, gbp_public, maps_public
from ..services.activity import log

router = APIRouter(prefix="/businesses/{business_id}/maps-public", tags=["maps-public"])
# project field -> (label, key in the Maps basics)
FIELDS = {"name": ("Name", "name"), "primary_category": ("Main category", "category"), "address": ("Address", "address"), "phone": ("Phone", "phone"),
          "website": ("Website", "website"), "description": ("Description", "summary")}


def _same(a, b) -> bool:
    def norm(v):
        return "".join(ch for ch in str(v or "").lower() if ch.isalnum())
    return norm(a) == norm(b)


@router.get("")
def show(fresh: bool = False, b: Business = Depends(get_business)):
    if not b.place_id:
        return {"state": "no_place", "message": "This project is not linked to a Google Maps listing yet. Find it by name or email on the connect screen."}
    if not discovery.places_enabled():
        return {"state": "no_key", "message": "Reading Google Maps needs a Places API key: add GOOGLE_PLACES_API_KEY to the backend settings."}
    try:
        d = maps_public.read(b.place_id, fresh)
    except discovery.DiscoveryError as exc:
        return {"state": "error", "message": str(exc)}
    except Exception:  # noqa: BLE001
        return {"state": "error", "message": "Google Maps could not be reached. Try again in a minute."}
    compare = []
    for key, (label, mk) in FIELDS.items():
        maps_v = d["basics"].get(mk)
        if maps_v in (None, ""):
            continue
        mine = getattr(b, key, None)
        compare.append({"field": key, "label": label, "maps": maps_v, "yours": mine, "same": _same(maps_v, mine)})
    return {"state": "ok", **d, "compare": compare, "linked": bool(b.gbp_location),
            "not_public": ["Services and prices", "Posts and offers", "Questions and answers", "Every review (Maps shares only the five most relevant)"]}


class ApplyIn(BaseModel):
    fields: list[str] = Field(min_length=1, max_length=10)


@router.post("/apply")
def apply(body: ApplyIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    if b.gbp_location:
        raise HTTPException(409, "This profile is connected to Google, so Google is the source: edit it in the cards below.")
    if not b.place_id:
        raise HTTPException(422, "This project is not linked to a Google Maps listing.")
    try:
        d = maps_public.read(b.place_id)
    except discovery.DiscoveryError as exc:
        raise HTTPException(502, str(exc)) from exc
    done = []
    for f in body.fields:
        if f not in FIELDS:
            continue
        v = d["basics"].get(FIELDS[f][1])
        if v in (None, ""):
            continue
        setattr(b, f, v[:750] if f == "description" and isinstance(v, str) else v)
        done.append(f)
    if "address" in done and d["basics"].get("lat") is not None:
        b.lat, b.lng = d["basics"]["lat"], d["basics"]["lng"]
    if "hours" in body.fields and d["hours"]:
        b.hours = {"weekdayDescriptions": d["hours"]}
        done.append("hours")
    log(db, "system", "maps_profile_applied", b.id, fields=done)
    db.commit()
    return {"applied": done}


# ------------------------------------------------------------------------------------------------------------------------ the profile as Google shows it, its analysis and Search Console
def _guard(b: Business) -> None:
    if not b.place_id:
        raise HTTPException(422, "This project is not linked to a Google Maps listing yet. Find it by name or email on the connect screen.")
    if not discovery.places_enabled():
        raise HTTPException(422, "Reading Google Maps needs a Places API key: add GOOGLE_PLACES_API_KEY to the backend settings.")


def _compare(db: Session, b: Business, p: dict) -> dict | None:
    """You against the nearby businesses chosen as competitors for this project (their rating and review count as Google showed them when they were saved). Nothing is shown unless at least two were chosen."""
    from sqlalchemy import select

    from ..models import Competitor
    rows = db.scalars(select(Competitor).where(Competitor.business_id == b.id, Competitor.selected.is_(True), Competitor.rating.is_not(None)).order_by(Competitor.rating.desc()).limit(6)).all()
    if len(rows) < 2 or not p.get("rating"):
        return None
    return {"you": {"name": b.name, "rating": p.get("rating"), "reviews": p.get("votes")}, "others": [{"name": c.name, "rating": c.rating, "reviews": c.reviews} for c in rows],
            "rank": 1 + sum(1 for c in rows if (c.rating or 0) > (p.get("rating") or 0))}


@router.get("/profile")
def profile(fresh: bool = False, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """The profile as Google shows it (Places API), set against the connected profile's own saved data when there is one, and how the website does in Google Search (Search Console)."""
    if not b.place_id:
        return {"state": "no_place", "message": "This project is not linked to a Google Maps listing yet. Find it by name or email on the connect screen."}
    if not discovery.places_enabled():
        return {"state": "no_key", "message": "Reading Google Maps needs a Places API key: add GOOGLE_PLACES_API_KEY to the backend settings."}
    try:
        p = gbp_public.enrich_from_connection(gbp_public.info(b.place_id, fresh), b, db)
    except gbp_public.GbpError as exc:
        return {"state": "error", "message": str(exc)}
    posts = gbp_public.saved_posts(b, db)
    sc = gbp_public.search(db, b)
    return {"state": "ok", "profile": p, "posts": posts, "search": sc, "analysis": gbp_public.analyse(p, b, posts, sc), "compare": _compare(db, b, p)}


class ApplyProfileIn(BaseModel):
    fields: list[str] = Field(min_length=1, max_length=6)


@router.post("/apply-profile")
def apply_profile(body: ApplyProfileIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Copy the chosen values of the Maps listing into the project (not for profiles connected to Google: Google is the source there)."""
    if b.gbp_location:
        raise HTTPException(409, "This profile is connected to Google, so Google is the source: edit it in the cards below.")
    _guard(b)
    try:
        p = gbp_public.info(b.place_id)
    except gbp_public.GbpError as exc:
        raise HTTPException(502, str(exc)) from exc
    done = []
    for f in body.fields:
        if f == "primary_category" and p.get("category"):
            b.primary_category = p["category"][:160]
        elif f == "phone" and p.get("phone"):
            b.phone = p["phone"]
        elif f == "name" and p.get("title"):
            b.name = p["title"]
        else:
            continue
        done.append(f)
    log(db, "system", "gbp_public_applied", b.id, fields=done)
    db.commit()
    return {"applied": done}


class ReviewsIn(BaseModel):
    depth: int = Field(default=5, ge=1, le=200)  # kept for older callers: Google shows five


@router.post("/import-reviews")
def import_reviews(body: ReviewsIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Save the reviews the Maps listing shows (Google shares the five most relevant) that are not saved yet. An owner reply Google already shows is kept as a posted reply."""
    from datetime import datetime

    from sqlalchemy import select

    from ..models import Review
    if b.gbp_location:
        raise HTTPException(409, "This profile is connected to Google: all its reviews arrive with the Google sync.")
    _guard(b)
    try:
        got = maps_public.fetch(b.place_id, fresh=True).get("reviews") or []
    except discovery.DiscoveryError as exc:
        raise HTTPException(502, str(exc)) from exc

    def when(v):
        try:
            return datetime.fromisoformat(str(v).replace("Z", "+00:00")) if v else None
        except ValueError:
            return None

    have = {r.external_id for r in db.scalars(select(Review).where(Review.business_id == b.id))}
    seen = {((r.author or "").lower(), r.rating, r.review_date) for r in db.scalars(select(Review).where(Review.business_id == b.id))}
    added = skipped = 0
    for x in got:
        ext = (x.get("name") or "")[:250]
        author = ((x.get("authorAttribution") or {}).get("displayName") or "")[:160]
        rating = int(x.get("rating") or 0)
        at = when(x.get("publishTime"))
        key = (author.lower(), rating, at.date() if at else None)
        if not ext or ext in have or key in seen:
            skipped += 1
            continue
        db.add(Review(business_id=b.id, external_id=ext, author=author, rating=rating, body=((x.get("text") or {}).get("text") or None), review_date=at.date() if at else None, review_at=at,
                      sentiment="positive" if rating >= 4 else "negative" if rating <= 2 else "neutral"))
        seen.add(key)
        added += 1
    log(db, "system", "public_reviews_imported", b.id, added=added)
    db.commit()
    return {"added": added, "skipped": skipped, "read": len(got)}


@router.get("/reviews")
def saved_reviews(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """The reviews saved for this project (read from the public listing). Unlike the Google reviews page, this needs no Google sign-in."""
    from sqlalchemy import select

    from ..models import Review
    from ..serialize import rows
    found = list(db.scalars(select(Review).where(Review.business_id == b.id).order_by(Review.review_date.desc().nullslast(), Review.id.desc())))
    return {"reviews": rows(found)}
