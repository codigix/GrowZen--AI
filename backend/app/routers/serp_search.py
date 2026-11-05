"""Top organic Google results for a query, via Serper.dev, with an optional date range (like Google's own date filter)."""
from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth import current_user
from ..competitors import intel

router = APIRouter(prefix="/serp-search", tags=["serp-search"], dependencies=[Depends(current_user)])

# Google's "tbs" date-range codes (same ones Google's own "Date range" dropdown sends).
TBS_BY_RANGE = {"any": None, "day": "qdr:d", "week": "qdr:w", "month": "qdr:m", "year": "qdr:y"}


@router.get("/top-results")
def top_results(
    query: str = Query(..., min_length=2, max_length=200, description="Search query"),
    time_range: str = Query("any", pattern="^(any|day|week|month|year)$", description="any, day, week, month or year"),
    country: str | None = Query(None, description="Google country code (gl); omit to search globally, not restricted to one country"),
    top: int = Query(5, ge=1, le=50, description="How many organic results to return"),
):
    if not intel.serper_enabled():
        raise HTTPException(503, "Search needs Google results: set SERPER_API_KEY on the SEO backend (serper.dev).")

    tbs = TBS_BY_RANGE[time_range]
    organic: list[dict] = []
    try:
        serper = intel.Serper(country)
        # Google shows ~10 organic results per SERP page, so "num" alone can't get more than that -- page through.
        for page in range(1, (top + 9) // 10 + 1):
            body = {"q": query, "num": 10, "page": page}
            if country:
                body["gl"] = country
            if tbs:
                body["tbs"] = tbs
            data = serper.call("/search", body)
            page_results = data.get("organic") or []
            organic += page_results
            if len(page_results) < 10 or len(organic) >= top:
                break
    except intel.IntelError as exc:
        raise HTTPException(502, str(exc)) from exc

    results = [
        {
            "position": item.get("position"),
            "title": item.get("title"),
            "link": item.get("link"),
            "snippet": item.get("snippet"),
            "date": item.get("date"),
        }
        for item in organic[:top]
    ]

    return {"query": query, "time_range": time_range, "country": country or "global", "returned": len(results), "results": results}
