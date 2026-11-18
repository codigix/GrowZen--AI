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
from ..services import discovery, maps_public
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
