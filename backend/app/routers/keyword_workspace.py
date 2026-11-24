"""The keyword workspace of a project: every keyword from every source in one list, with where it came from; collect, compare, pick."""
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..auth import User, current_user
from ..deps import get_business
from ..models import Business
from ..services import keyword_workspace as kw
from ..services.activity import log

router = APIRouter(prefix="/businesses/{business_id}/keyword-workspace", tags=["keyword-workspace"])


class CollectIn(BaseModel):
    sources: list[str] | None = None


class IdsIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=500)


@router.get("")
def workspace(source: str = "", tag: str = "", q: str = Query("", max_length=80), show: str = Query("open", pattern="^(open|picked|dismissed|all)$"), b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return kw.overview(db, b, source=source, tag=tag, q=q, show=show)


@router.get("/locations")
def keyword_by_location(keyword: str = Query(min_length=2, max_length=120), extra: str = Query("", max_length=200), b: Business = Depends(get_business)):
    """One keyword place by place (country, city, the project's areas, and places added in `extra`, comma separated): searches per month, competition index, cost and the last 12 months."""
    from ..services import keyword_locations
    return keyword_locations.for_keyword(b, keyword, [x.strip() for x in extra.split(",") if x.strip()][:3])


@router.get("/summary")
def summary(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return kw.summary(db, b)


class IdeasIn(BaseModel):
    ideas: list[dict] = Field(min_length=1, max_length=200)
    label: str = Field(default="Check One Keyword", max_length=60)


@router.post("/add")
def add(body: IdeasIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return {"added": kw.add_ideas(db, b, body.ideas, body.label)}


@router.post("/collect")
def collect(body: CollectIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Read the chosen sources (all when none are named) and file the keywords they give. A source that cannot run says why."""
    report = kw.collect(db, b, body.sources)
    log(db, user.name, "keywords_collected", b.id, sources=",".join(report), new=sum(r["new"] for r in report.values()))
    db.commit()
    return {"report": report, **kw.overview(db, b)}


@router.post("/pick")
def pick(body: IdsIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    out = kw.pick(db, b, body.ids)
    log(db, user.name, "keywords_picked", b.id, added=out["picked"])
    db.commit()
    return out | kw.overview(db, b)


@router.post("/dismiss")
def dismiss(body: IdsIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return {"dismissed": kw.dismiss(db, b, body.ids, True)} | kw.overview(db, b)


@router.post("/restore")
def restore(body: IdsIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return {"restored": kw.dismiss(db, b, body.ids, False)} | kw.overview(db, b)
