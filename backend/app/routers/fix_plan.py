"""The fix plan of one area: /businesses/{id}/fix-plan/{area} (the changes to make, their worth and the score) and a re-check that raises the score once fixes are confirmed."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import get_business
from ..models import Business
from ..services import fix_plan
from ..services.activity import log

router = APIRouter(prefix="/businesses/{business_id}/fix-plan", tags=["growth"])


@router.get("/{area}")
def get_plan(area: str, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    try:
        return fix_plan.plan(db, b, area)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/{area}/check")
def check_fixes(area: str, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Scan the homepage again: tasks whose check passes now are closed and the area's score is read again."""
    try:
        out = fix_plan.check(db, b, area)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    log(db, user.name, "fix_plan_checked", b.id, area=area, before=out["result"]["before"], after=out["result"]["after"])
    db.commit()
    return out
