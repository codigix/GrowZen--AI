"""Keyword mapping and the competitors' top pages."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import get_business
from ..models import Business
from ..services import competitor_pages, keyword_mapping
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
