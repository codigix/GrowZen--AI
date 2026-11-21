"""Search and visitor insights API: what Search Console and Analytics 4 show about the project's site, alone and together (services/search_insights.py)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import get_business
from ..models import Business
from ..services import search_insights
from ..services.activity import log

router = APIRouter(prefix="/businesses/{business_id}/search-insights", tags=["search-insights"])


@router.get("")
def insights(b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """The stored Search Console and Analytics 4 insights at once, with when they were read. Old or missing results are refreshed in the background (poll until `refreshing` is false)."""
    return search_insights.snapshot(db, user, b, "insights")


@router.get("/speed")
def speed(b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Real-visitor Core Web Vitals (Chrome field data through PageSpeed Insights), stored and refreshed in the background."""
    return search_insights.snapshot(db, user, b, "speed")


@router.post("/refresh")
def refresh(kind: str = "all", b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Start a background refresh now (insights, files, speed, or all). Returns at once."""
    kinds = list(search_insights.TTL) if kind == "all" else [kind] if kind in search_insights.TTL else []
    if not kinds:
        raise HTTPException(422, "kind must be insights, files, speed or all")
    return {k: search_insights.snapshot(db, user, b, k, refresh=True)["refreshing"] for k in kinds}


class PageIn(BaseModel):
    url: str = Field(min_length=1, max_length=1000)


class KeywordsIn(BaseModel):
    keywords: list[str] = Field(min_length=1, max_length=50)


@router.post("/check-page")
def check_page(body: PageIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Read one page of the project's own website and list what to fix for search, beside what Google shows for it."""
    try:
        return search_insights.check_site_page(db, b, body.url)
    except search_insights.PageCheckError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/add-keywords")
def add_keywords(body: KeywordsIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Add searches that already showed the site on Google to My Keywords."""
    out = search_insights.add_keywords(db, b, body.keywords)
    log(db, user.name, "keywords_from_search_console", b.id, added=out["added"])
    db.commit()
    return out


@router.get("/site-files")
def site_files(b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """The site's sitemap, robots.txt and llms.txt as last read (refreshed in the background), and the pages the audits saw that the sitemap leaves out."""
    return search_insights.snapshot(db, user, b, "files")


@router.post("/llms")
def llms(b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Write llms.txt and llms-full.txt for the site from the profile, the business summary and what its pages say. Nothing is published: the files are returned to review and download."""
    try:
        return search_insights.build_llms(db, b)
    except search_insights.PageCheckError as exc:
        raise HTTPException(422, str(exc)) from exc
