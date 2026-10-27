from __future__ import annotations

from fastapi import APIRouter, Request

from app.audit_engines.lighthouse import is_lighthouse_available
from app.config import get_settings
from app.schemas.audit import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/api/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    settings = get_settings()
    manager = request.app.state.audit_manager
    return HealthResponse(
        status="ok",
        pagespeed_configured=settings.pagespeed_configured,
        pagespeed_enabled=settings.pagespeed_enabled,
        local_lighthouse_enabled=settings.local_lighthouse_enabled,
        local_lighthouse_available=is_lighthouse_available(),
        max_concurrent_audits=settings.max_concurrent_audits,
        max_concurrent_pagespeed_audits=settings.max_concurrent_pagespeed_audits,
        active_audits=manager.active_count,
    )
