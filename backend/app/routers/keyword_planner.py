"""Google Ads Keyword Planner: search volume, competition and CPC bid ranges for a keyword."""
from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth import current_user
from ..services import google_ads_client as ads

router = APIRouter(prefix="/keyword-planner", tags=["keyword-planner"], dependencies=[Depends(current_user)])


@router.get("/metrics")
def keyword_metrics(
    keyword: str = Query(..., description="Seed keyword to look up"),
    limit: int = Query(50, ge=1, le=1000, description="Max number of keyword ideas to return"),
    include_monthly: bool = Query(False, description="Include per-month search volume history (larger payload)"),
):
    try:
        ideas = ads.keyword_ideas([keyword], limit=limit, include_monthly=include_monthly)
    except ads.GoogleAdsNotConfigured as exc:
        raise HTTPException(503, str(exc)) from exc
    except ads.GoogleAdsRequestError as exc:
        raise HTTPException(502, {"error": exc.code, "messages": exc.details}) from exc

    if not ideas:
        raise HTTPException(404, "No data found for this keyword")

    return {"seed_keyword": keyword, "returned": len(ideas), "limit": limit, "keywords": ideas}
