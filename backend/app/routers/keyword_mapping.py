"""Keyword mapping and the competitors' top pages."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import get_business
from ..models import Business
from ..services import competitor_pages, keyword_mapping, page_meta
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
