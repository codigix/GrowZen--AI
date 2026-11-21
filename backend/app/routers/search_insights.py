"""Search and visitor insights API: what Search Console and Analytics 4 show about the project's site, alone and together (services/search_insights.py)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import get_business
from ..models import Business
from ..services import search_insights

router = APIRouter(prefix="/businesses/{business_id}/search-insights", tags=["search-insights"])


@router.get("")
def insights(refresh: bool = False, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Search Console and Analytics 4 sections and the joined findings. Cached for 15 minutes."""
    return search_insights.build(db, user, b, refresh)


@router.get("/speed")
def speed(refresh: bool = False, b: Business = Depends(get_business), user: User = Depends(current_user)):
    """Real-visitor Core Web Vitals (Chrome field data through PageSpeed Insights). Slower, so separate."""
    return search_insights.speed(b, refresh)
