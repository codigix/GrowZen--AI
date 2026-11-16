"""Backlink Checker API.

GET    /businesses/{id}/backlink-check              saved checks, summary, and whether Moz is configured
GET    /businesses/{id}/backlink-check/candidates   pages our own crawler found linking to the project (to check them live)
POST   /businesses/{id}/backlink-check              {target?, sources:[page urls]}  check up to 25 pages now (live) and save the result
DELETE /businesses/{id}/backlink-check/{check_id}
"""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import get_business
from ..models import BacklinkCheck, Business
from ..services import backlink_checker as bc
from ..services import growth_plan as plan
from ..services.activity import log

router = APIRouter(prefix="/businesses/{business_id}/backlink-check", tags=["backlink-check"])
_limit = plan.RateLimit(12, name="backlink_check")


def _own_target(b: Business) -> str:
    return (b.website or "").strip()


def _out(r: BacklinkCheck) -> dict[str, Any]:
    d = dict(r.data or {})
    d.update(id=r.id, target=r.target, state=r.state, checks=r.checks, was_working=r.was_working, lost=bool(r.was_working and r.state != "working"),
             checked_at=d.get("checked_at") or (r.updated_at.isoformat() if r.updated_at else None))
    return d


@router.get("")
def list_checks(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    rows = [_out(r) for r in db.scalars(select(BacklinkCheck).where(BacklinkCheck.business_id == b.id).order_by(BacklinkCheck.updated_at.desc(), BacklinkCheck.id.desc()).limit(500))]
    return {"rows": rows, "summary": bc.summarise(rows), "moz": bc.moz_configured(), "default_target": _own_target(b), "limit": bc.MAX_SOURCES}


@router.get("/candidates")
def candidates(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Linking pages found by the software's own crawler for the project's website (the ones not checked yet first)."""
    from ..backlinks.lifecycle import LIVE_STATES
    from ..backlinks.models import Backlink, BiDomain, BiPage, BiTrackedTarget
    from ..services import growth_content
    mine = db.scalar(select(BiTrackedTarget.domain).where(BiTrackedTarget.business_id == b.id, BiTrackedTarget.is_competitor.is_(False)).order_by(BiTrackedTarget.id))
    if not mine:
        return {"urls": [], "note": "The website is not tracked in Backlink Intelligence yet."}
    try:
        growth_content.bounded(db, 15)  # the link graph is large: a slow read must not hang the page
        rows = db.execute(select(BiPage.normalized_url).join(Backlink, Backlink.source_page_id == BiPage.id).join(BiDomain, BiDomain.id == Backlink.target_domain_id)
                          .where(BiDomain.registrable_domain == mine, Backlink.current_status.in_(LIVE_STATES)).group_by(BiPage.normalized_url).limit(200)).all()
    except Exception:  # noqa: BLE001
        db.rollback()
        return {"urls": [], "note": "The link data could not be read right now."}
    done = {r.source_url for r in db.scalars(select(BacklinkCheck).where(BacklinkCheck.business_id == b.id))}
    urls = sorted((u for (u,) in rows), key=lambda u: u in done)[: bc.MAX_SOURCES * 2]
    return {"urls": urls, "note": None if urls else "Our crawler has not found links to your website yet."}


class CheckIn(BaseModel):
    target: str | None = Field(default=None, max_length=500)
    sources: list[str] = Field(min_length=1, max_length=60)


@router.post("")
def run_check(body: CheckIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    if not _limit.hit(user.id):
        raise HTTPException(429, "Too many checks: each one opens live pages. Try again in a while.")
    target = (body.target or _own_target(b)).strip()
    if not target:
        raise HTTPException(422, "Enter the website the links should point to (the project has no website saved).")
    try:
        tgt = bc.target_of(target)
        rows, note = bc.check_many(body.sources[: bc.MAX_SOURCES], target)
    except bc.CheckError as exc:
        raise HTTPException(422, str(exc)) from exc
    saved = []
    for r in rows:
        row = db.scalar(select(BacklinkCheck).where(BacklinkCheck.business_id == b.id, BacklinkCheck.source_url == r["source_url"], BacklinkCheck.target == tgt["label"]))
        if row is None:
            row = BacklinkCheck(business_id=b.id, source_url=r["source_url"], target=tgt["label"], state=r["state"], data=r, checks=1)
            db.add(row)
        else:
            row.was_working, row.state, row.data, row.checks = (row.state == "working"), r["state"], r, (row.checks or 0) + 1
        db.flush()
        saved.append(_out(row))
    log(db, user.name, "backlinks_checked", b.id, count=len(saved))
    db.commit()
    return {"rows": saved, "summary": bc.summarise(saved), "note": note, "moz": bc.moz_configured(), "target": tgt["label"]}


@router.delete("/{check_id}", status_code=204)
def delete_check(check_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    r = db.get(BacklinkCheck, check_id)
    if not r or r.business_id != b.id:
        raise HTTPException(404, "Check not found")
    db.delete(r)
    db.commit()
