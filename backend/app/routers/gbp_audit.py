"""The GMB audit of a project's Google Business Profile.

GET  /businesses/{id}/gbp-audit              the nine parameters, each scored from real data, with exact fixes (?fresh=1 skips the 10-minute cache of the Maps read)
POST /businesses/{id}/gbp-audit/suggestions  drafts written by AI from the same facts (description, service texts, photo ideas, review messages)
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_business
from ..models import Business
from ..services import gbp_audit
from ..services.activity import log

router = APIRouter(prefix="/businesses/{business_id}/gbp-audit", tags=["gbp-audit"])


@router.get("")
def show(fresh: bool = False, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return gbp_audit.audit(db, b, fresh)


@router.post("/suggestions")
def suggestions(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    out = gbp_audit.suggest(db, b)
    if out.get("state") == "ok":
        log(db, "system", "gbp_audit_suggestions", b.id)
        db.commit()
    return out
