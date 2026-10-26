from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.audit import Audit, AuditStatus
from app.models.site_audit import SiteAudit
from app.schemas.audit import AuditSummary
from app.schemas.site_audit import (
    SiteAuditCreateRequest,
    SiteAuditCreateResponse,
    SiteAuditDetailResponse,
    SiteAuditHistoryResponse,
    SiteAuditSummary,
)
from app.security.url_validation import SSRFValidationError
from app.services import audit_service
from app.services.sitemap_service import SitemapDiscoveryError, discover_site_urls

router = APIRouter(prefix="/api/site-audits", tags=["site-audits"])


def _manager(request: Request) -> audit_service.AuditManager:
    return request.app.state.audit_manager


def _child_audits(db: Session, site_audit_id: str) -> list[Audit]:
    return (
        db.query(Audit)
        .filter(Audit.site_audit_id == site_audit_id)
        .order_by(Audit.created_at.asc())
        .all()
    )


def _aggregate_status(site_audit: SiteAudit, children: list[Audit]) -> tuple[str, int, int]:
    if site_audit.discovery_error:
        return "failed", 0, 0

    completed = sum(1 for a in children if a.status == AuditStatus.COMPLETED.value)
    failed = sum(1 for a in children if a.status == AuditStatus.FAILED.value)
    in_progress = any(a.status in (AuditStatus.QUEUED.value, AuditStatus.RUNNING.value) for a in children)

    if not children:
        return "failed", completed, failed
    if in_progress:
        return "running", completed, failed
    return "completed", completed, failed


def _summary(db: Session, site_audit: SiteAudit) -> SiteAuditSummary:
    children = _child_audits(db, site_audit.id)
    status, completed, failed = _aggregate_status(site_audit, children)
    return SiteAuditSummary(
        id=site_audit.id,
        base_url=site_audit.base_url,
        strategy=site_audit.strategy,
        engine=site_audit.engine,
        max_pages=site_audit.max_pages,
        page_count=site_audit.page_count,
        created_at=site_audit.created_at,
        status=status,
        completed_count=completed,
        failed_count=failed,
        discovery_error=site_audit.discovery_error,
    )


@router.post("", response_model=SiteAuditCreateResponse, status_code=201)
async def create_site_audit(
    payload: SiteAuditCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> SiteAuditCreateResponse:
    try:
        page_urls = await discover_site_urls(payload.url, payload.max_pages)
    except SSRFValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SitemapDiscoveryError as exc:
        site_audit = SiteAudit(
            base_url=payload.url,
            strategy=payload.strategy,
            engine=payload.engine,
            max_pages=payload.max_pages,
            page_count=0,
            discovery_error=str(exc),
        )
        db.add(site_audit)
        db.commit()
        db.refresh(site_audit)
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    site_audit = SiteAudit(
        base_url=payload.url,
        strategy=payload.strategy,
        engine=payload.engine,
        max_pages=payload.max_pages,
        page_count=len(page_urls),
    )
    db.add(site_audit)
    db.commit()
    db.refresh(site_audit)

    manager = _manager(request)
    page_audit_ids: list[str] = []
    for page_url in page_urls:
        try:
            audit = await manager.create_and_queue(
                db,
                url=page_url,
                strategy=payload.strategy,
                engine=payload.engine,
                site_audit_id=site_audit.id,
                check_duplicate=False,
            )
            page_audit_ids.append(audit.id)
        except SSRFValidationError:
            # A page that fails SSRF validation (shouldn't normally happen
            # since discovery already enforces same-origin) is simply
            # skipped rather than aborting the whole site audit.
            continue

    return SiteAuditCreateResponse(
        id=site_audit.id,
        base_url=site_audit.base_url,
        page_count=len(page_audit_ids),
        page_audit_ids=page_audit_ids,
        status_url=f"/api/site-audits/{site_audit.id}",
    )


@router.get("/history", response_model=SiteAuditHistoryResponse)
async def site_audit_history(page: int = 1, page_size: int = 20, db: Session = Depends(get_db)) -> SiteAuditHistoryResponse:
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)

    total = db.query(SiteAudit).count()
    items = (
        db.query(SiteAudit)
        .order_by(SiteAudit.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return SiteAuditHistoryResponse(
        total=total,
        page=page,
        page_size=page_size,
        items=[_summary(db, s) for s in items],
    )


@router.get("/{site_audit_id}", response_model=SiteAuditDetailResponse)
async def get_site_audit(site_audit_id: str, db: Session = Depends(get_db)) -> SiteAuditDetailResponse:
    site_audit = db.get(SiteAudit, site_audit_id)
    if site_audit is None:
        raise HTTPException(status_code=404, detail="Site audit not found")

    children = _child_audits(db, site_audit_id)
    summary = _summary(db, site_audit)
    return SiteAuditDetailResponse(
        **summary.model_dump(),
        pages=[AuditSummary.model_validate(a) for a in children],
    )
