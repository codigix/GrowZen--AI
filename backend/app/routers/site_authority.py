"""DA, PA and spam score of the project's own website (shown in the Website audit's Scores row). Only the audited site, never a competitor.

GET  /businesses/{id}/site-authority   the saved figures (no cost) and whether they are under 24 h old
POST /businesses/{id}/site-authority   fetch them (Apify). A site asked about in the last 24 h is answered from the saved figures: nothing is paid twice.
"""
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..backlinks.models import BiDomainMetric
from ..backlinks.urls import registrable_domain
from ..db import get_db
from ..deps import get_business
from ..models import Business
from ..services import apify_metrics as am
from ..services import growth_plan as plan

router = APIRouter(prefix="/businesses/{business_id}/site-authority", tags=["site-authority"])
_limit = plan.RateLimit(20, name="site_authority")


def _domain(b: Business) -> str:
    raw = (b.website or "").strip()
    if not raw:
        return ""
    host = urlsplit(raw if "//" in raw else "//" + raw).hostname or ""
    return registrable_domain(host)


def _view(db: Session, b: Business, note: str | None = None) -> dict[str, Any]:
    dom = _domain(b)
    out: dict[str, Any] = {"domain": dom or None, "configured": am.configured(), "scores": None, "fetched_at": None, "fresh": False, "note": note}
    m = db.scalar(select(BiDomainMetric).where(BiDomainMetric.domain == dom)) if dom else None
    if m and m.da is not None:
        at = m.fetched_at if m.fetched_at is None or m.fetched_at.tzinfo else m.fetched_at.replace(tzinfo=timezone.utc)
        out.update(scores={"da": m.da, "pa": m.pa, "spam": m.spam_score, "source": m.source}, fetched_at=at.isoformat() if at else None,
                   fresh=bool(at and datetime.now(timezone.utc) - at < am.ttl()))
    return out


@router.get("")
def get_authority(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return _view(db, b)


@router.post("")
def fetch_authority(b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    dom = _domain(b)
    if not dom:
        raise HTTPException(422, "This project has no website saved.")
    if not am.configured():
        raise HTTPException(422, "DA, PA and spam score need a data service: add APIFY_KEY_1 to the backend settings.")
    if not _limit.hit(user.id):
        raise HTTPException(429, "Too many requests: try again in a while.")
    res = am.check([dom])[0]
    db.expire_all()  # check() saved its answer in its own session
    return _view(db, b, None if res.get("scores") else res.get("error"))
