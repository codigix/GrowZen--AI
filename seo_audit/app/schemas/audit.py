"""Pydantic request/response schemas for the audit API."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import AnyUrl, BaseModel, Field, field_validator


class AuditCreateRequest(BaseModel):
    url: str = Field(..., description="Publicly accessible http(s) URL to audit")
    strategy: Literal["mobile", "desktop"] = "mobile"
    engine: Literal["pagespeed", "lighthouse"] = "lighthouse"

    @field_validator("url")
    @classmethod
    def validate_scheme(cls, v: str) -> str:
        v = v.strip()
        parsed = AnyUrl(v)
        if parsed.scheme not in ("http", "https"):
            raise ValueError("Only http:// and https:// URLs are supported")
        return v


class AuditCreateResponse(BaseModel):
    id: str
    status: str
    status_url: str


class AuditSummary(BaseModel):
    id: str
    submitted_url: str
    final_url: str | None
    strategy: str
    engine: str
    status: str
    created_at: datetime
    completed_at: datetime | None
    performance_score: float | None
    accessibility_score: float | None
    best_practices_score: float | None
    seo_score: float | None
    error_message: str | None = None
    engine_used: str | None = None
    fallback_reason: str | None = None

    model_config = {"from_attributes": True}


class AuditReportResponse(BaseModel):
    id: str
    status: str
    submitted_url: str
    final_url: str | None
    strategy: str
    engine: str
    created_at: datetime
    completed_at: datetime | None
    scores: dict[str, float | None]
    metrics: dict[str, Any] | None
    report: dict[str, Any] | None
    has_raw_json: bool
    has_html_report: bool
    html_report_is_original: bool
    error_message: str | None = None
    engine_used: str | None = None
    fallback_reason: str | None = None


class AuditHistoryResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[AuditSummary]


class HealthResponse(BaseModel):
    status: str
    pagespeed_configured: bool
    pagespeed_enabled: bool
    local_lighthouse_enabled: bool
    local_lighthouse_available: bool
    max_concurrent_audits: int
    max_concurrent_pagespeed_audits: int
    active_audits: int
