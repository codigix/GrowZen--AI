"""Where the business shows on Google Maps, area by area and keyword by keyword.

GET    /businesses/{id}/area-ranks                   the areas, the keywords and the latest rank of each (with the one before it for the change)
POST   /businesses/{id}/area-ranks/areas             add an area ({name, lat, lng}; the page finds the pin by name)
DELETE /businesses/{id}/area-ranks/areas/{area_id}   remove an area and its records
POST   /businesses/{id}/area-ranks/scan              measure one area for chosen keywords ({area_id, keywords}); each keyword is one Google Places search from that area's centre

A rank is the position of the business in Google's Maps results for the keyword as seen from the centre of the area (1 = first), or empty when it is not in the first 20.
Every measurement is kept, so each area shows how it moved."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_business
from ..models import AreaRank, Business, Keyword, RankArea
from ..serialize import row

router = APIRouter(prefix="/businesses/{business_id}/area-ranks", tags=["area-ranks"])
MAX_KEYWORDS = 12
RADIUS_M = 3000.0


def _seed_names(b: Business) -> list[str]:
    names: list[str] = []
    for x in [*(b.target_areas or []), *[p.get("name") for p in (b.service_area_places or []) if isinstance(p, dict)], (b.area or "").split(",")[0], b.city]:
        x = " ".join(str(x or "").split())
        if x and x.lower() not in [n.lower() for n in names]:
            names.append(x)
    return names[:8]


def _seed(db: Session, b: Business) -> None:
    """The first time: the areas the project already targets (target areas, service area, its own area and city), each found on the map."""
    from ..services import suggest
    near = (b.city or "").strip()
    for name in _seed_names(b):
        try:
            found = suggest.areas(name.split(",")[0], "IN" if not b.country else b.country, near)
        except Exception:  # noqa: BLE001 - the map service may not answer: the area can be added by hand later
            continue
        if found:
            db.add(RankArea(business_id=b.id, name=name[:120], lat=found[0]["lat"], lng=found[0]["lng"], source="project"))
    db.commit()


def _cell(r: AreaRank | None) -> dict | None:
    return None if r is None else {"rank": r.rank, "top": r.top or [], "at": r.created_at.isoformat() if r.created_at else None}


@router.get("")
def overview(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    areas = list(db.scalars(select(RankArea).where(RankArea.business_id == b.id).order_by(RankArea.id)))
    cfg = dict(b.track_config or {})
    if not areas and not cfg.get("areas_seeded"):  # once: removing every area later does not bring them back
        _seed(db, b)
        b.track_config = {**cfg, "areas_seeded": True}
        db.commit()
        areas = list(db.scalars(select(RankArea).where(RankArea.business_id == b.id).order_by(RankArea.id)))
    records = list(db.scalars(select(AreaRank).where(AreaRank.business_id == b.id).order_by(AreaRank.created_at.desc(), AreaRank.id.desc()).limit(5000)))
    latest: dict[tuple[int, str], list[AreaRank]] = {}
    for r in records:
        latest.setdefault((r.area_id, r.keyword), []).append(r)
    cells = [{"area_id": a, "keyword": k, "now": _cell(v[0]), "before": _cell(v[1]) if len(v) > 1 else None} for (a, k), v in latest.items()]
    tracked = [k.keyword for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True)).order_by(Keyword.volume.desc().nulls_last(), Keyword.keyword))]
    candidates = [k.keyword for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_not(True)).order_by(Keyword.volume.desc().nulls_last()).limit(60))]
    from ..competitors import service
    return {"areas": [row(a) for a in areas], "cells": cells, "keywords": tracked, "more_keywords": candidates, "ready": service.competitors_enabled(),
            "region": (b.city or "")}


class AreaIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


@router.post("/areas", status_code=201)
def add_area(body: AreaIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    name = " ".join(body.name.split())
    if any(a.name.lower() == name.lower() for a in db.scalars(select(RankArea).where(RankArea.business_id == b.id))):
        raise HTTPException(409, "This area is already in the list.")
    if db.scalar(select(RankArea.id).where(RankArea.business_id == b.id).offset(14).limit(1)):
        raise HTTPException(409, "Up to 15 areas can be measured. Remove one first.")
    a = RankArea(business_id=b.id, name=name, lat=body.lat, lng=body.lng, source="manual")
    db.add(a)
    db.commit()
    return row(a)


@router.delete("/areas/{area_id}", status_code=204)
def remove_area(area_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    a = db.get(RankArea, area_id)
    if a is None or a.business_id != b.id:
        raise HTTPException(404, "Area not found")
    for r in db.scalars(select(AreaRank).where(AreaRank.area_id == a.id)):
        db.delete(r)
    db.delete(a)
    db.commit()


class ScanIn(BaseModel):
    area_id: int
    keywords: list[str] = Field(min_length=1, max_length=MAX_KEYWORDS)


@router.post("/scan")
def scan(body: ScanIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Measure one area: for each keyword, the business's position in Google Maps as seen from the area's centre. Each keyword is one Places request."""
    from ..competitors import service
    from ..services import countries
    from ..services.providers.google import same_place
    a = db.get(RankArea, body.area_id)
    if a is None or a.business_id != b.id:
        raise HTTPException(404, "Area not found")
    if not service.competitors_enabled():
        raise HTTPException(503, "Google Maps results are not set up on the server (GOOGLE_PLACES_API_KEY), so areas cannot be measured.")
    region = countries.of(b) or "IN"
    out = []
    for kw in dict.fromkeys(" ".join(k.split()) for k in body.keywords if k and k.strip()):
        try:
            places = service.places_search(kw, region, a.lat, a.lng, RADIUS_M)
        except Exception as exc:  # noqa: BLE001 - Google's reason (quota, key) is shown; the keywords done so far are kept
            db.commit()
            raise HTTPException(502, f"Google Maps did not answer for \"{kw}\": {str(exc)[:160]}") from exc
        rank = next((pl["position"] for pl in places if same_place(pl, b)), None)
        top = [pl["title"] for pl in places if pl.get("title") and not same_place(pl, b)][:3]
        db.add(AreaRank(business_id=b.id, area_id=a.id, area=a.name, keyword=kw, rank=rank if rank and rank <= 20 else None, top=top))
        out.append({"keyword": kw, "rank": rank if rank and rank <= 20 else None})
    db.commit()
    return {"area_id": a.id, "measured": out, "at": datetime.now(timezone.utc).isoformat()}
