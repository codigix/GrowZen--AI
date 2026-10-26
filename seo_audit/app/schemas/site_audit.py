"""Pydantic request/response schemas for site-wide (multi-page) audits."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.audit import AuditSummary

DEFAULT_MAX_PAGES = 10
HARD_MAX_PAGES = 50


class SiteAuditCreateRequest(BaseModel):
    url: str = Field(..., description="Base URL of the site to discover pages from (its sitemap.xml is used)")
    strategy: Literal["mobile", "desktop"] = "mobile"
    engine: Literal["pagespeed", "lighthouse"] = "lighthouse"
    max_pages: int = Field(default=DEFAULT_MAX_PAGES, ge=1, le=HARD_MAX_PAGES)


class SiteAuditCreateResponse(BaseModel):
    id: str
    base_url: str
    page_count: int
    page_audit_ids: list[str]
    status_url: str


class SiteAuditSummary(BaseModel):
    id: str
    base_url: str
    strategy: str
    engine: str
    max_pages: int
    page_count: int
    created_at: datetime
    status: str
    completed_count: int
    failed_count: int
    discovery_error: str | None = None

    model_config = {"from_attributes": True}


class SiteAuditDetailResponse(SiteAuditSummary):
    pages: list[AuditSummary]


class SiteAuditHistoryResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[SiteAuditSummary]
