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


# ------------------------------------------------------------------------------------------------------------------------ the full public profile (DataForSEO) and its analysis
def _guard(b: Business) -> None:
    if not b.place_id:
        raise HTTPException(422, "This project is not linked to a Google Maps listing yet. Find it by name or email on the connect screen.")
    if not gbp_public.configured():
        raise HTTPException(422, "Reading the full public profile needs DATAFORSEO_AUTH in the backend settings.")


@router.get("/profile")
def profile(fresh: bool = False, b: Business = Depends(get_business)):
    """The public profile as Google shows it (description, every category, photo count, claimed, hours, services, what customers mention) and the analysis."""
    if not b.place_id:
        return {"state": "no_place", "message": "This project is not linked to a Google Maps listing yet. Find it by name or email on the connect screen."}
    if not gbp_public.configured():
        return {"state": "no_key", "message": "Reading the full public profile needs DATAFORSEO_AUTH in the backend settings."}
    try:
        p = gbp_public.info(b.place_id, b.country, fresh)
    except gbp_public.GbpError as exc:
        return {"state": "error", "message": str(exc)}
    cached = gbp_public._posts.get(b.place_id)
    posts = cached[1] if cached else None
    mine = [x.get("name", "") for x in (b.services or []) if isinstance(x, dict)]
    return {"state": "ok", "profile": p, "posts": posts, "analysis": gbp_public.analyse(p, b, posts), "service_ideas": gbp_public.service_ideas(p, mine)}


@router.post("/report")
def report(fresh: bool = False, b: Business = Depends(get_business)):
    """The same, with the recent posts read as well (takes about 20 seconds), so the report covers posting."""
    _guard(b)
    try:
        p = gbp_public.info(b.place_id, b.country, fresh)
        posts = gbp_public.posts(b.place_id, b.country, fresh)
    except gbp_public.GbpError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"state": "ok", "profile": p, "posts": posts, "analysis": gbp_public.analyse(p, b, posts)}


class ApplyProfileIn(BaseModel):
    fields: list[str] = Field(min_length=1, max_length=6)


@router.post("/apply-profile")
def apply_profile(body: ApplyProfileIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Copy the chosen values of the public profile into the project (not for profiles connected to Google: Google is the source there)."""
    if b.gbp_location:
        raise HTTPException(409, "This profile is connected to Google, so Google is the source: edit it in the cards below.")
    _guard(b)
    try:
        p = gbp_public.info(b.place_id, b.country)
    except gbp_public.GbpError as exc:
        raise HTTPException(502, str(exc)) from exc
    done = []
    for f in body.fields:
        if f == "primary_category" and p.get("category"):
            b.primary_category = p["category"][:160]
        elif f == "secondary_categories" and p.get("additional_categories"):
            b.secondary_categories = list(p["additional_categories"])[:9]
        elif f == "description" and p.get("description"):
            b.description = p["description"][:750]
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
    depth: int = Field(default=100, ge=10, le=200)


@router.post("/import-reviews")
def import_reviews(body: ReviewsIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Read the listing's public reviews and add the ones not saved yet. An owner reply Google already shows is kept as a posted reply."""
    from datetime import datetime

    from sqlalchemy import select

    from ..models import Review
    if b.gbp_location:
        raise HTTPException(409, "This profile is connected to Google: reviews arrive with the Google sync.")
    _guard(b)
    try:
        got = gbp_public.reviews(b.place_id, b.country, body.depth)
    except gbp_public.GbpError as exc:
        raise HTTPException(502, str(exc)) from exc

    def when(v):
        try:
            return datetime.fromisoformat(str(v).replace(" +00:00", "+00:00")) if v else None
        except ValueError:
            return None

    have = {(r.external_id) for r in db.scalars(select(Review).where(Review.business_id == b.id))}
    seen = {((r.author or "").lower(), r.rating, r.review_date) for r in db.scalars(select(Review).where(Review.business_id == b.id))}
    added = skipped = 0
    for x in got:
        ext = f"dfs:{x['id']}"[:250]
        at = when(x["at"])
        key = ((x["author"] or "").lower(), x["rating"], at.date() if at else None)
        if ext in have or key in seen:
            skipped += 1
            continue
        rep_at = when(x["reply_at"])
        db.add(Review(business_id=b.id, external_id=ext, author=(x["author"] or "")[:160], rating=x["rating"], body=x["text"] or None, review_date=at.date() if at else None, review_at=at,
                      reply_text=x["reply"] or None, reply_status="posted" if x["reply"] else "none", replied_at=rep_at,
                      sentiment="positive" if x["rating"] >= 4 else "negative" if x["rating"] <= 2 else "neutral"))
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
