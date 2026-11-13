"""The backlink workspace API: /businesses/{id}/backlink-hub/... (read from what the crawler stored; Moz figures only on request)."""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import current_user
from ..db import get_db
from ..deps import get_business
from ..models import Business
from . import hub, playbook

router = APIRouter(prefix="/businesses/{business_id}/backlink-hub", tags=["backlinks"], dependencies=[Depends(current_user)])


@router.get("/summary")
def summary(b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    return hub.summary(db, b)


@router.get("/links")
def links(b: Business = Depends(get_business), db: Session = Depends(get_db), status: str = Query("live", pattern="^(live|lost|all)$"), follow: str = Query("", pattern="^(|dofollow|nofollow|sponsored|ugc)$"),
          category: str = Query("", max_length=30), useful: str = Query("", pattern="^(|useful|neutral|risky|unscored)$"), q: str = Query("", max_length=200),
          sort: str = Query("recent", pattern="^(recent|domain|da)$"), limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0)) -> dict:
    return hub.links(db, b, status=status, follow=follow, category=category, useful=useful, q=q, sort=sort, limit=limit, offset=offset)


@router.get("/domains")
def domains(b: Business = Depends(get_business), db: Session = Depends(get_db), sort: str = Query("links", pattern="^(links|da|domain|risk|recent)$"), q: str = Query("", max_length=200),
            verdict: str = Query("", pattern="^(|useful|neutral|risky|unscored)$"), limit: int = Query(100, ge=1, le=300), offset: int = Query(0, ge=0)) -> dict:
    return hub.domains(db, b, sort=sort, q=q, verdict=verdict, limit=limit, offset=offset)


@router.get("/opportunities")
def opportunities(b: Business = Depends(get_business), db: Session = Depends(get_db), q: str = Query("", max_length=200), category: str = Query("", max_length=30), status: str = Query("", pattern="^(|new|planned|contacted|live|skipped)$"),
                  limit: int = Query(60, ge=1, le=200)) -> dict:
    return hub.opportunities(db, b, q=q, category=category, status=status, limit=limit)


@router.get("/audit")
def audit(b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    return hub.audit(db, b)


@router.post("/metrics/refresh")
def refresh_metrics(b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Ask Moz for DA, PA and spam score of this project's linking domains (and the best prospects) that have none yet."""
    me = hub.own_domain(db, b.id)
    names: list[str] = []
    if me:
        names = [d for d in dict.fromkeys(x["source_domain"] for x in hub.links(db, b, status="live", limit=200, sort="recent").get("links", []))]
        names += [x["domain"] for x in hub.opportunities(db, b, limit=30).get("opportunities", [])]
    return hub.refresh_metrics(db, list(dict.fromkeys(names)))


class StatusIn(BaseModel):
    domain: str = Field(min_length=4, max_length=255)
    status: str = Field(pattern="^(planned|contacted|live|skipped)$")
    note: str | None = Field(default=None, max_length=500)
    source: str = Field(default="competitor", pattern="^(competitor|ai)$")
    name: str | None = Field(default=None, max_length=160)


@router.get("/plan")
def plan(b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """The link-building plan: every place being worked on and how far along it is."""
    return playbook.plan(db, b)


@router.post("/plan")
def set_status(body: StatusIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    try:
        playbook.set_status(db, b, body.domain, body.status, body.note, body.source, body.name)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return playbook.plan(db, b)


class AdviceIn(BaseModel):
    domain: str = Field(min_length=4, max_length=255)
    refresh: bool = False


@router.post("/advice")
def advice(body: AdviceIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """What a link from this site would give the business and how to get it (AI when set up, plain rules otherwise)."""
    return playbook.advice(db, b, body.domain, body.refresh)


@router.post("/platforms/suggest")
def suggest_platforms(b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Websites where this kind of business could earn a link, suggested by AI (not tied to competitors)."""
    return playbook.suggest_platforms(db, b)
