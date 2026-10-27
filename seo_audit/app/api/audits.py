from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.audit import Audit, AuditStatus
from app.schemas.audit import (
    AuditCreateRequest,
    AuditCreateResponse,
    AuditHistoryResponse,
    AuditReportResponse,
    AuditSummary,
)
from app.security.url_validation import SSRFValidationError
from app.services import audit_service, report_service

router = APIRouter(prefix="/api/audits", tags=["audits"])


def _manager(request: Request) -> audit_service.AuditManager:
    return request.app.state.audit_manager


@router.post("", response_model=AuditCreateResponse, status_code=201)
async def create_audit(
    payload: AuditCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AuditCreateResponse:
    manager = _manager(request)
    try:
        audit = await manager.create_and_queue(
            db, url=payload.url, strategy=payload.strategy, engine=payload.engine
        )
    except SSRFValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return AuditCreateResponse(id=audit.id, status=audit.status, status_url=f"/api/audits/{audit.id}")


@router.post("/{audit_id}/rerun", response_model=AuditCreateResponse, status_code=201)
async def rerun_audit(audit_id: str, request: Request, db: Session = Depends(get_db)) -> AuditCreateResponse:
    original = db.get(Audit, audit_id)
    if original is None:
        raise HTTPException(status_code=404, detail="Audit not found")

    manager = _manager(request)
    new_audit = Audit(
        submitted_url=original.submitted_url,
        strategy=original.strategy,
        engine=original.engine,
        status=AuditStatus.QUEUED.value,
    )
    db.add(new_audit)
    db.commit()
    db.refresh(new_audit)
    manager.submit(new_audit.id, new_audit.engine)
    return AuditCreateResponse(id=new_audit.id, status=new_audit.status, status_url=f"/api/audits/{new_audit.id}")


@router.get("/history", response_model=AuditHistoryResponse)
async def audit_history(page: int = 1, page_size: int = 20, db: Session = Depends(get_db)) -> AuditHistoryResponse:
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)

    total = db.query(Audit).count()
    items = (
        db.query(Audit)
        .order_by(Audit.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return AuditHistoryResponse(
        total=total,
        page=page,
        page_size=page_size,
        items=[AuditSummary.model_validate(a) for a in items],
    )


def _get_audit_or_404(audit_id: str, db: Session) -> Audit:
    audit = db.get(Audit, audit_id)
    if audit is None:
        raise HTTPException(status_code=404, detail="Audit not found")
    return audit


@router.get("/{audit_id}", response_model=AuditSummary)
async def get_audit(audit_id: str, db: Session = Depends(get_db)) -> AuditSummary:
    audit = _get_audit_or_404(audit_id, db)
    return AuditSummary.model_validate(audit)


@router.get("/{audit_id}/report", response_model=AuditReportResponse)
async def get_audit_report(audit_id: str, db: Session = Depends(get_db)) -> AuditReportResponse:
    audit = _get_audit_or_404(audit_id, db)
    normalized = audit_service.load_normalized_report(audit)
    metrics = json.loads(audit.metrics_json) if audit.metrics_json else None

    return AuditReportResponse(
        id=audit.id,
        status=audit.status,
        submitted_url=audit.submitted_url,
        final_url=audit.final_url,
        strategy=audit.strategy,
        engine=audit.engine,
        created_at=audit.created_at,
        completed_at=audit.completed_at,
        scores={
            "performance": audit.performance_score,
            "accessibility": audit.accessibility_score,
            "best_practices": audit.best_practices_score,
            "seo": audit.seo_score,
        },
        metrics=metrics,
        report=normalized,
        has_raw_json=bool(audit.raw_json_path and Path(audit.raw_json_path).is_file()),
        has_html_report=bool(
            (audit.html_report_path and Path(audit.html_report_path).is_file()) or normalized is not None
        ),
        html_report_is_original=audit.html_report_is_original,
        error_message=audit.error_message,
        engine_used=audit.engine_used,
        fallback_reason=audit.fallback_reason,
    )


@router.get("/{audit_id}/download/json")
async def download_json(audit_id: str, db: Session = Depends(get_db)) -> Response:
    audit = _get_audit_or_404(audit_id, db)
    if not audit.raw_json_path or not Path(audit.raw_json_path).is_file():
        raise HTTPException(status_code=404, detail="Raw JSON report is not available for this audit")
    content = Path(audit.raw_json_path).read_text(encoding="utf-8")
    filename = f"lighthouse-{audit.id}.report.json"
    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{audit_id}/download/html")
async def download_html(audit_id: str, db: Session = Depends(get_db)) -> Response:
    audit = _get_audit_or_404(audit_id, db)

    if audit.html_report_path and Path(audit.html_report_path).is_file():
        content = Path(audit.html_report_path).read_text(encoding="utf-8")
        filename = f"lighthouse-{audit.id}.report.html"
        return HTMLResponse(content=content, headers={"Content-Disposition": f'attachment; filename="{filename}"'})

    normalized = audit_service.load_normalized_report(audit)
    if normalized is None:
        raise HTTPException(status_code=404, detail="No report is available for this audit")

    summary_html = report_service.render_summary_html(
        normalized,
        {
            "url": audit.submitted_url,
            "strategy": audit.strategy,
            "engine": audit.engine,
            "completed_at": audit.completed_at,
        },
    )
    filename = f"audit-summary-{audit.id}.html"
    return HTMLResponse(content=summary_html, headers={"Content-Disposition": f'attachment; filename="{filename}"'})
