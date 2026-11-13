"""GET /businesses/{id}/flow: the journey (ten steps in order, what each needs first, and the next thing to do), from stored data only."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_business
from ..models import Business
from ..services import flow

router = APIRouter(prefix="/businesses/{business_id}/flow", tags=["flow"])


@router.get("")
def get_flow(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return flow.evaluate(db, b)
