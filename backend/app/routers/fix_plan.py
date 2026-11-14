"""The fix plan: /businesses/{id}/fix-plan (every change to make, by area, with scores) and a re-check that raises the scores once fixes are confirmed."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import get_business
from ..models import Business
from ..services import fix_plan
from ..services.activity import log

router = APIRouter(prefix="/businesses/{business_id}/fix-plan", tags=["growth"])


@router.get("")
def get_plan(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return fix_plan.overview(db, b)


@router.post("/check")
def check_fixes(b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Scan the homepage again: tasks whose check passes now are closed and the scores are read again."""
    try:
        out = fix_plan.check(db, b)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    log(db, user.name, "fix_plan_checked", b.id, scores={k: v["after"] for k, v in out["result"]["areas"].items()})
    db.commit()
    return out
