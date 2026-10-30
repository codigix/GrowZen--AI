"""FastAPI Endpoints for Keyword Discovery and Metrics."""

import csv
import io
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from ...config import settings
from ...schemas.keyword import (
    KeywordItem,
    KeywordSearchRequest,
    PlatformInfo,
)
from ...services.keyword_engine import keyword_engine
from ...services.platforms import PLATFORM_REGISTRY

router = APIRouter(prefix="/api/keywords", tags=["Keyword Explorer"])


@router.post(
    "",
    response_model=List[KeywordItem],
    status_code=status.HTTP_200_OK,
    summary="Discover Keywords Across Multi-Platform Suggestion Engines",
    description=(
        "Concurrently queries Google, YouTube, Bing, Amazon, DuckDuckGo, eBay, and App Stores. "
        "Returns a list containing exclusively: Keyword, Trend (12m), Search Volume, Intent, Competition, CPC, and Difficulty."
    ),
)
async def discover_keywords(payload: KeywordSearchRequest) -> List[KeywordItem]:
    """Execute keyword research across specified platforms and return the 7 core fields."""
    try:
        results = await keyword_engine.execute_search(payload)
        return results
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Keyword discovery engine failed: {str(exc)}",
        )


@router.get(
    "/platforms",
    response_model=List[PlatformInfo],
    summary="List Supported Keyword Discovery Platforms",
)
async def list_platforms() -> List[PlatformInfo]:
    """Retrieve catalog of all supported suggestion platforms."""
    platforms: List[PlatformInfo] = []
    seen = set()

    for pid, fetcher in PLATFORM_REGISTRY.items():
        if fetcher.platform_id in seen:
            continue
        seen.add(fetcher.platform_id)

        platforms.append(
            PlatformInfo(
                id=fetcher.platform_id,
                name=fetcher.display_name,
                category=fetcher.category,
                is_free=fetcher.is_free,
                status="active",
                description=fetcher.description,
            )
        )
    return platforms


@router.get(
    "/export",
    summary="Export Keyword Research Results as CSV",
    response_class=StreamingResponse,
)
async def export_keywords_csv(
    keyword: str = Query(..., min_length=2, description="Seed keyword"),
    country: str = Query(default="IN", min_length=2, max_length=2, description="Country code"),
    language: str = Query(default="en", min_length=2, max_length=8, description="Language code"),
    platforms: Optional[str] = Query(
        default="google,youtube,bing,amazon,duckduckgo",
        description="Comma-separated platform list",
    ),
    limit: int = Query(default=100, ge=1, le=500, description="Max keywords to return"),
) -> StreamingResponse:
    """Export keyword results directly to a downloadable CSV with the 7 core fields."""
    platform_list = [p.strip().lower() for p in (platforms or "").split(",") if p.strip()]
    if not platform_list:
        platform_list = ["google", "youtube", "bing", "amazon", "duckduckgo"]

    request = KeywordSearchRequest(
        keyword=keyword,
        country=country,
        language=language,
        platforms=platform_list,
        limit=limit,
    )

    items = await keyword_engine.execute_search(request)

    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow([
        "Keyword",
        "Trend (12m)",
        "Search Volume",
        "Intent",
        "Competition",
        "CPC",
        "Difficulty",
    ])

    for item in items:
        trend_str = ";".join(str(v) for v in item.trend) if item.trend else ""
        writer.writerow([
            item.keyword,
            trend_str,
            item.search_volume,
            item.intent,
            item.competition,
            item.cpc,
            item.difficulty,
        ])

    output.seek(0)
    safe_name = "".join(c if c.isalnum() else "_" for c in keyword.strip())
    filename = f"keywords_{safe_name}_{country.upper()}.csv"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
