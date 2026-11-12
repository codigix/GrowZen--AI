"""The service area of a Google Business Profile: the places a business serves, and whether its street address is shown beside them.

GET /businesses/{id}/gbp/service-area      what is saved (and whether the area lookup is set up)
PUT /businesses/{id}/gbp/service-area      look the area names up on Google Places, then write them to the profile
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..config import get_settings
from ..db import get_db
from ..deps import get_business
from ..models import Business
from ..schemas import SERVICE_AREA_TYPES
from ..services import gbp
from ..services.activity import log

router = APIRouter(prefix="/businesses/{business_id}/gbp", tags=["gbp-location"])


class ServiceAreaIn(BaseModel):
    type: str = "CUSTOMER_AND_BUSINESS_LOCATION"
    areas: list[str] = Field(default_factory=list, max_length=20)


def _state(b: Business) -> dict:
    return {"type": b.service_area_type or "CUSTOMER_AND_BUSINESS_LOCATION", "areas": b.service_area_places or [],
            "linked": bool(b.connection and b.gbp_location), "lookup_ready": bool(get_settings().google_places_api_key)}


@router.get("/service-area")
def get_service_area(b: Business = Depends(get_business)):
    return _state(b)


@router.put("/service-area")
def set_service_area(body: ServiceAreaIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    if body.type not in SERVICE_AREA_TYPES:
        raise HTTPException(422, f"Type must be one of {', '.join(SERVICE_AREA_TYPES)}.")
    names: list[str] = []
    for a in body.areas:
        n = " ".join(a.split())[:200]
        if n and n.lower() not in (x.lower() for x in names):
            names.append(n)
    if body.type == "CUSTOMER_LOCATION_ONLY" and not names:
        raise HTTPException(422, "Add at least one area you serve when you hide your address.")
    known = {(p.get("name") or "").lower(): p for p in (b.service_area_places or []) if p.get("place_id")}
    resolved: list[dict[str, str]] = [known[n.lower()] for n in names if n.lower() in known]
    todo = [n for n in names if n.lower() not in known]
    unresolved: list[str] = []
    linked = bool(b.connection and b.gbp_location)
    if linked:
        if todo:
            key = get_settings().google_places_api_key
            if not key:
                raise HTTPException(503, "Looking up areas needs a Google Places API key (GOOGLE_PLACES_API_KEY) on the server.")
            try:
                found, unresolved = gbp.resolve_places(todo, key, b.country or "in")
            except gbp.GbpError as exc:
                raise HTTPException(502, str(exc)) from exc
            resolved += found
        if body.type == "CUSTOMER_LOCATION_ONLY" and not resolved:
            raise HTTPException(422, "Google could not find any of those areas. Try a more specific name, e.g. \"Wagholi, Pune\".")
        try:  # Google first: if it refuses, nothing is saved here
            gbp.GbpClient(b.connection).update_location(b.gbp_location, gbp.service_area_body(body.type, resolved))
        except gbp.GbpError as exc:
            raise HTTPException(502, f"Google did not accept the service area, so nothing was saved: {exc}") from exc
    else:
        resolved = [{"name": n, "place_id": ""} for n in names]
    b.service_area_type, b.service_area_places = body.type, resolved
    log(db, user.name, "gbp_service_area_updated", b.id, areas=len(resolved))
    db.commit()
    return _state(b) | {"unresolved": unresolved}
