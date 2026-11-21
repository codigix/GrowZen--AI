"""Keyword mapping and the competitors' top pages."""
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import get_business
from ..models import Business
from ..services import competitor_pages, dev_brief, keyword_mapping, keyword_placement, page_meta
from ..services.activity import log

router = APIRouter(prefix="/businesses/{business_id}", tags=["keyword-mapping"])


@router.get("/keyword-mapping")
def get_mapping(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return keyword_mapping.plan(db, b)


@router.post("/keyword-mapping/apply")
def apply_mapping(b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    out = keyword_mapping.apply(db, b)
    log(db, user.name, "keyword_mapping_saved", b.id, mapped=out["mapped"])
    db.commit()
    return out | keyword_mapping.plan(db, b)


@router.get("/competitor-pages")
def get_competitor_pages(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return competitor_pages.report(db, b)


@router.post("/page-meta")
def write_page_meta(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """A title, description, heading and canonical address for every page of the site (current beside proposed), from the page's address, its main keyword and the profile."""
    out = page_meta.build(db, b)
    if not out["crawled"]:
        raise HTTPException(409, "The website has not been scanned yet: run the Website Audit first.")
    return out


class MetaRow(BaseModel):
    path: str = Field(max_length=300)
    title: str = Field(max_length=200)
    description: str = Field(max_length=400)
    h1: str = Field(default="", max_length=200)
    canonical: str = Field(default="", max_length=500)


class MetaFiles(BaseModel):
    pages: list[MetaRow] = Field(min_length=1, max_length=300)


@router.post("/page-meta/files")
def page_meta_files(body: MetaFiles, b: Business = Depends(get_business)):
    """The (edited) metadata as seo-meta.json and the React component that applies it."""
    return page_meta.files([r.model_dump() for r in body.pages])


@router.get("/keyword-placement")
def keyword_placement_overview(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Every picked keyword: the pages that already use it and where, the page it is meant for, and other pages that fit it (from the last site crawl)."""
    return keyword_placement.by_keyword(db, b)


class PlacementIn(BaseModel):
    url: str = Field(min_length=1, max_length=1000)
    focus: str | None = Field(default=None, max_length=200)


@router.post("/keyword-placement/page")
def keyword_placement_page(body: PlacementIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """One page of the site read live: what it says, which picked keywords it uses and where, and exactly where to add the missing ones (with a line to paste)."""
    try:
        return keyword_placement.page_detail(db, b, body.url, body.focus)
    except keyword_placement.PlacementError as exc:
        raise HTTPException(422, str(exc)) from exc


class BriefIn(BaseModel):
    format: str = Field(default="pdf", pattern="^(pdf|md)$")
    page: str | None = Field(default=None, max_length=1000)


@router.post("/keyword-mapping/dev-brief")
def developer_brief(body: BriefIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """A document for the developer: for each page with keywords mapped to it, what to replace or add (where, what is there now, what to change it to), the keywords that still need a page, and what to check
    afterwards. PDF to send, Markdown to paste into a ticket. Pass `page` for one page only."""
    data = dev_brief.collect(db, b, body.page)
    if not data["pages"]:
        raise HTTPException(409, "No keyword is mapped to a page yet. Map the keywords first (My Keywords > Map).")
    log(db, user.name, "dev_brief_made", b.id, pages=data["totals"]["pages"], changes=data["totals"]["changes"])
    db.commit()
    if body.format == "md":
        return Response(dev_brief.render_md(data).encode("utf-8"), media_type="text/markdown; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{dev_brief.filename(b, "md")}"'})
    return Response(dev_brief.render_pdf(data), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{dev_brief.filename(b, "pdf")}"'})
