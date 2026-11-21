"""Competitor analysis for the Google Business Profile: who ranks around this business on Google Maps, and how the profile compares.

GET    /businesses/{id}/gbp/competitors           you vs the saved competitors, with the gaps and what to do
POST   /businesses/{id}/gbp/competitors/search    find the top businesses of the same kind in the same area (Google Places) and save them
POST   /businesses/{id}/gbp/competitors           add one by hand (name, rating, reviews, website)
DELETE /businesses/{id}/gbp/competitors/{cid}     remove one
"""
import secrets
import statistics
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..competitors import service
from ..db import get_db
from ..deps import get_business
from ..models import Business
from ..services.activity import log
from ..services.url_safety import validate_url_shape

router = APIRouter(prefix="/businesses/{business_id}/gbp/competitors", tags=["gbp-competitors"])


def _store(b: Business) -> dict[str, Any]:
    d = b.local_competitors or {}
    return {"at": d.get("at"), "keyword": d.get("keyword"), "items": list(d.get("items") or [])}


def _area(b: Business) -> str:
    """Where to look: the locality and city, but not a whole address line pasted into the area field."""
    area = (b.area or "").strip()
    return ", ".join(x for x in [area if 0 < len(area) <= 40 else "", b.city] if x) or (b.address or "")


def _you(b: Business) -> dict[str, Any]:
    return {"name": b.name, "rating": b.rating, "reviews": b.review_count or 0, "photos": b.photo_count or 0, "website": b.website, "phone": b.phone,
            "address": b.address, "maps_link": (b.gbp_status or {}).get("maps_url"), "you": True}


def insights(you: dict[str, Any], comps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """What the numbers say, in plain words: where the profile is behind and the next step for each gap."""
    out: list[dict[str, Any]] = []
    if not comps:
        return out
    reviews = sorted(int(c.get("reviews") or 0) for c in comps)
    rated = [float(c["rating"]) for c in comps if isinstance(c.get("rating"), (int, float))]
    median, top = int(statistics.median(reviews)), reviews[-1]
    mine = int(you.get("reviews") or 0)
    if mine < median:
        out.append({"level": "critical" if mine < median / 2 else "warning", "title": f"You have {mine} review{'s' if mine != 1 else ''}; the typical competitor has {median}",
                    "fix": f"Ask happy customers for reviews with the review link or QR code: about {median - mine} more would put you level with the middle of the pack."})
    elif mine < top:
        out.append({"level": "info", "title": f"You are above the typical competitor ({mine} vs {median} reviews)", "fix": f"The leader has {top}. Keep asking after every visit."})
    else:
        out.append({"level": "good", "title": f"You have the most reviews of the {len(comps) + 1} businesses compared ({mine})", "fix": "Keep replying to every review to stay ahead."})
    if rated and isinstance(you.get("rating"), (int, float)):
        avg = round(sum(rated) / len(rated), 1)
        diff = round(float(you["rating"]) - avg, 1)
        if diff < 0:
            out.append({"level": "warning", "title": f"Your rating {you['rating']} is {abs(diff)} below the competitors' average ({avg})", "fix": "Reply politely to low reviews and ask satisfied customers to rate you."})
        else:
            out.append({"level": "good", "title": f"Your rating {you['rating']} is at or above the competitors' average ({avg})", "fix": "Protect it: reply fast to anything below 4 stars."})
    elif rated and not you.get("rating"):
        out.append({"level": "warning", "title": f"You have no rating yet; competitors average {round(sum(rated) / len(rated), 1)}", "fix": "Your first reviews matter most: share the review link with recent customers."})
    with_site = sum(1 for c in comps if c.get("website"))
    if with_site >= max(2, len(comps) // 2) and not you.get("website"):
        out.append({"level": "warning", "title": f"{with_site} of {len(comps)} competitors have a website; your profile has none", "fix": "Add the website on the profile (Contact step)."})
    strong = [c for c in comps if isinstance(c.get("rating"), (int, float)) and c["rating"] >= 4.5 and int(c.get("reviews") or 0) >= max(20, median)]
    if strong:
        out.append({"level": "info", "title": f"{len(strong)} competitor{'s' if len(strong) != 1 else ''} combine a 4.5+ rating with many reviews", "fix": "Study their profiles: photos, services and posts show what Google rewards here."})
    return out


def _chosen_extras(db: Session | None, b: Business, have: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Competitors chosen in the competitor finder that this page does not hold yet (a business with no website is one of them): their Google profile data is shown here too."""
    if db is None:
        return []
    from ..models import Competitor
    names = {(c.get("name") or "").strip().lower() for c in have}
    pids = {c.get("place_id") for c in have if c.get("place_id")}
    out = []
    for c in db.scalars(select(Competitor).where(Competitor.business_id == b.id).order_by(Competitor.id)):
        if c.selected is False or (c.name or "").strip().lower() in names or (c.place_id and c.place_id in pids):
            continue
        out.append({"id": f"c{c.id}", "name": c.name, "rating": c.rating, "reviews": int(c.reviews or 0), "address": c.address, "phone": c.phone, "website": c.website, "maps_link": c.maps_link,
                    "place_id": c.place_id, "source": "chosen"})
    return out


def overview(b: Business, db: Session | None = None) -> dict[str, Any]:
    st = _store(b)
    you = _you(b)
    comps = [*st["items"], *_chosen_extras(db, b, st["items"])]
    ranked = sorted([*comps, you], key=lambda c: (int(c.get("reviews") or 0), float(c.get("rating") or 0)), reverse=True)
    return {"you": you, "competitors": comps, "found_at": st["at"], "keyword": st["keyword"], "insights": insights(you, comps),
            "your_rank": next((i + 1 for i, c in enumerate(ranked) if c.get("you")), None), "total": len(ranked), "can_search": service.competitors_enabled(),
            "area": _area(b)}


@router.get("")
def get_competitors(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return overview(b, db)


@router.post("/analysis")
def analysis(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Compare this business's Google listing with each competitor's (saved here or chosen in the competitor finder, with or without a website): the checks, categories, services and advice."""
    from ..competitors import gbp_analysis
    from ..services import countries, market
    comps = gbp_analysis.competitors_for(db, b, _store(b)["items"])
    if not comps:
        raise HTTPException(409, "No competitors yet. Find them first.")
    return gbp_analysis.analyse(db, b, comps, countries.gl(market.serp_country(b)).upper() or "IN")


class SearchIn(BaseModel):
    keyword: str | None = Field(default=None, max_length=160)
    top_n: int = Field(default=10, ge=3, le=20)


def _share(db: Session, b: Business, items: list[dict], source: str = "google_places") -> None:
    """The competitors found here are also saved in the shared competitor list (the Competitors page, Competitor Watch, the backlink gap, the Growth Plan): one list, entered once."""
    from ..competitors.router import _upsert, upsert_without_website  # noqa: PLC0415
    rows = _upsert(db, b.id, [i for i in items if i.get("website")])
    upsert_without_website(db, b.id, [i for i in items if not i.get("website")])  # no website: still a competitor on Google Maps
    if source == "manual":
        for c in rows:
            c.source = "manual"
            c.selected = True  # added by hand: chosen


@router.post("/search")
def search(body: SearchIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    kind = (body.keyword or b.primary_category or "").strip()
    area = _area(b)
    if not kind:
        raise HTTPException(422, "Add the business category first (or type what to search for, e.g. clothing rental).")
    if not area:
        raise HTTPException(422, "Add the city or area on the profile first.")
    try:
        found = service.find_competitors(kind, area, b.name, body.top_n)
    except service.CompetitorSearchError as exc:
        raise HTTPException(503 if not service.competitors_enabled() else 502, str(exc)) from exc
    mine = (b.gbp_status or {}).get("maps_url") or ""
    manual = [c for c in _store(b)["items"] if c.get("source") == "manual"]
    items = []
    for f in found:
        if mine and f.get("maps_link") and f["maps_link"] == mine:
            continue  # the profile itself
        items.append({"id": secrets.token_hex(4), "name": f.get("name"), "rating": f.get("rating") if isinstance(f.get("rating"), (int, float)) else None,
                      "reviews": int(f.get("reviews") or 0), "address": f.get("address"), "phone": f.get("phone"), "website": f.get("website") or None,
                      "maps_link": f.get("maps_link"), "place_id": f.get("place_id") or None, "category": f.get("category") or None, "source": "maps"})
    b.local_competitors = {"at": datetime.now(timezone.utc).isoformat(), "keyword": kind, "items": [*items, *manual]}
    _share(db, b, items)
    log(db, user.name, "gbp_competitors_found", b.id, count=len(items))
    db.commit()
    return overview(b, db)


class ManualIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    rating: float | None = Field(default=None, ge=0, le=5)
    reviews: int | None = Field(default=None, ge=0, le=1_000_000)
    website: str | None = Field(default=None, max_length=500)
    maps_link: str | None = Field(default=None, max_length=500)


@router.post("", status_code=201)
def add(body: ManualIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    site = (body.website or "").strip()
    if site:
        if not site.lower().startswith(("http://", "https://")):
            site = f"https://{site}"
        try:
            validate_url_shape(site)
        except Exception as exc:  # noqa: BLE001 - the shape check raises its own readable message
            raise HTTPException(422, str(exc)) from exc
    st = _store(b)
    if any((c.get("name") or "").strip().lower() == body.name.strip().lower() for c in st["items"]):
        raise HTTPException(409, "That competitor is already in the list.")
    st["items"].append({"id": secrets.token_hex(4), "name": body.name.strip(), "rating": body.rating, "reviews": body.reviews or 0, "address": None, "phone": None,
                        "website": site or None, "maps_link": (body.maps_link or "").strip() or None, "source": "manual"})
    b.local_competitors = {"at": st["at"], "keyword": st["keyword"], "items": st["items"]}
    _share(db, b, [st["items"][-1]], source="manual")
    db.commit()
    return overview(b, db)


@router.delete("/{cid}")
def remove(cid: str, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Leave a competitor out of this comparison. One chosen in the competitor finder (id like c12) is left out of the shared list as well, so it does not come back."""
    from ..models import Competitor
    st = _store(b)
    gone = next((c for c in st["items"] if c.get("id") == cid), None)
    kept = [c for c in st["items"] if c.get("id") != cid]
    comp = db.get(Competitor, int(cid[1:])) if cid[:1] == "c" and cid[1:].isdigit() else None
    if comp is not None and comp.business_id != b.id:
        comp = None
    if gone is None and comp is None:
        raise HTTPException(404, "Competitor not found")
    if gone is not None:  # the same business in the shared list is left out too
        for c in db.scalars(select(Competitor).where(Competitor.business_id == b.id)):
            if (c.name or "").strip().lower() == (gone.get("name") or "").strip().lower() or (gone.get("place_id") and c.place_id == gone["place_id"]):
                c.selected = False
    if comp is not None:
        comp.selected = False
    b.local_competitors = {"at": st["at"], "keyword": st["keyword"], "items": kept}
    db.commit()
    return overview(b, db)
