"""Lighthouse audits of any URL (no business needed): one page, or every page in a site's sitemap.
Scores, Core Web Vitals, opportunities, diagnostics and passed/failed audits, plus the raw JSON
and HTML reports. Audits run in the background; poll GET /lighthouse/audits/{id}."""
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...auth import User, current_user
from ...config import get_settings
from ...db import get_db
from ...models import LighthouseAudit, LighthouseSiteAudit
from ...serialize import row
from .. import lighthouse, lighthouse_report, lighthouse_runner
from ..schemas import LighthouseAuditIn, LighthouseSiteAuditIn
from ..sitemap import SitemapDiscoveryError, discover_site_urls
from ..url_safety import SSRFValidationError

router = APIRouter(prefix="/lighthouse", tags=["lighthouse"])

MAX_BODY_BYTES = 64 * 1024  # bodies here are a URL and a few options
INTERNAL = {"metrics", "report", "raw_json_path", "html_report_path", "html_report_is_original", "updated_at"}  # never in summaries

_hits: dict[str, deque] = defaultdict(deque)
_hits_lock = threading.Lock()


def rate_limited(request: Request, user: User = Depends(current_user)) -> User:
    """At most LIGHTHOUSE_RATE_LIMIT_PER_MINUTE new audits per user per minute (in memory, one instance)."""
    length = request.headers.get("content-length", "")
    if length.isdigit() and int(length) > MAX_BODY_BYTES:
        raise HTTPException(413, "Request body too large")
    now = time.monotonic()
    with _hits_lock:
        window = _hits[user.id]
        while window and now - window[0] > 60:
            window.popleft()
        if len(window) >= get_settings().lighthouse_rate_limit_per_minute:
            raise HTTPException(429, "Too many audit requests. Please wait a minute and try again.")
        window.append(now)
    return user


def _status_url(kind: str, id_: int) -> str:
    return f"{get_settings().api_prefix}/lighthouse/{kind}/{id_}"


def _get_audit(db: Session, audit_id: int) -> LighthouseAudit:
    a = db.get(LighthouseAudit, audit_id)
    if not a:
        raise HTTPException(404, "Audit not found")
    return a


def _page(page: int, page_size: int) -> tuple[int, int]:
    return max(page, 1), min(max(page_size, 1), 100)


@router.get("/health")
def health(_: User = Depends(current_user)):
    """Which engines are configured and available (no secrets)."""
    s = get_settings()
    return {
        "status": "ok",
        "pagespeed_configured": s.lighthouse_pagespeed_configured,
        "pagespeed_enabled": s.lighthouse_pagespeed_enabled,
        "local_lighthouse_enabled": s.lighthouse_local_enabled,
        "local_lighthouse_available": lighthouse.is_available(),
        "max_concurrent_audits": s.lighthouse_max_concurrent_local,
        "max_concurrent_pagespeed_audits": s.lighthouse_max_concurrent_pagespeed,
        "active_audits": lighthouse_runner.active_count(),
    }


# Single-page audits
@router.post("/audits", status_code=201)
def create_audit(body: LighthouseAuditIn, db: Session = Depends(get_db), _: User = Depends(rate_limited)):
    try:
        a = lighthouse_runner.create_and_queue(db, body.url, body.strategy, body.engine)
    except SSRFValidationError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"id": a.id, "status": a.status, "status_url": _status_url("audits", a.id)}


@router.get("/audits/history")
def audit_history(page: int = 1, page_size: int = 20, include_site_pages: bool = True, db: Session = Depends(get_db), _: User = Depends(current_user)):
    """include_site_pages=false: only single-page audits (site audit pages are listed under their site audit)."""
    page, page_size = _page(page, page_size)
    where = [] if include_site_pages else [LighthouseAudit.site_audit_id.is_(None)]
    total = db.scalar(select(func.count(LighthouseAudit.id)).where(*where)) or 0
    items = db.scalars(select(LighthouseAudit).where(*where).order_by(LighthouseAudit.created_at.desc(), LighthouseAudit.id.desc()).offset((page - 1) * page_size).limit(page_size))
    return {"total": total, "page": page, "page_size": page_size, "items": [row(a, INTERNAL) for a in items]}


@router.get("/audits/{audit_id}")
def get_audit(audit_id: int, db: Session = Depends(get_db), _: User = Depends(current_user)):
    return row(_get_audit(db, audit_id), INTERNAL)


@router.post("/audits/{audit_id}/rerun", status_code=201)
def rerun_audit(audit_id: int, db: Session = Depends(get_db), _: User = Depends(rate_limited)):
    """Same URL, strategy and engine, as a new audit."""
    old = _get_audit(db, audit_id)
    try:
        a = lighthouse_runner.create_and_queue(db, old.submitted_url, old.strategy, old.engine, check_duplicate=False)
    except SSRFValidationError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"id": a.id, "status": a.status, "status_url": _status_url("audits", a.id)}


@router.get("/audits/{audit_id}/report")
def get_report(audit_id: int, db: Session = Depends(get_db), _: User = Depends(current_user)):
    """Normalised report: scores, metrics, audits by category and outcome, CrUX field data."""
    a = _get_audit(db, audit_id)
    return {
        "id": a.id, "status": a.status, "submitted_url": a.submitted_url, "final_url": a.final_url,
        "strategy": a.strategy, "engine": a.engine,
        "created_at": a.created_at.isoformat(), "completed_at": a.completed_at.isoformat() if a.completed_at else None,
        "scores": {"performance": a.performance_score, "accessibility": a.accessibility_score, "best_practices": a.best_practices_score, "seo": a.seo_score},
        "metrics": a.metrics,
        "report": a.report,
        "has_raw_json": bool(a.raw_json_path and Path(a.raw_json_path).is_file()),
        "has_html_report": bool((a.html_report_path and Path(a.html_report_path).is_file()) or a.report),
        "html_report_is_original": a.html_report_is_original,
        "error_message": a.error_message, "engine_used": a.engine_used, "fallback_reason": a.fallback_reason,
    }


@router.get("/audits/{audit_id}/download/json")
def download_json(audit_id: int, db: Session = Depends(get_db), _: User = Depends(current_user)):
    """The raw Lighthouse JSON (the full PageSpeed response for PageSpeed runs)."""
    a = _get_audit(db, audit_id)
    if not a.raw_json_path or not Path(a.raw_json_path).is_file():
        raise HTTPException(404, "Raw JSON report is not available for this audit")
    return Response(Path(a.raw_json_path).read_text(encoding="utf-8"), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="lighthouse-{a.id}.report.json"'})


@router.get("/audits/{audit_id}/download/html")
def download_html(audit_id: int, db: Session = Depends(get_db), _: User = Depends(current_user)):
    """The original Lighthouse HTML (local engine), else a generated summary that says it is one."""
    a = _get_audit(db, audit_id)
    if a.html_report_path and Path(a.html_report_path).is_file():
        return HTMLResponse(Path(a.html_report_path).read_text(encoding="utf-8"),
                            headers={"Content-Disposition": f'attachment; filename="lighthouse-{a.id}.report.html"'})
    if not a.report:
        raise HTTPException(404, "No report is available for this audit")
    html = lighthouse_report.render_summary_html(a.report, {"url": a.submitted_url, "strategy": a.strategy, "engine": a.engine, "completed_at": a.completed_at})
    return HTMLResponse(html, headers={"Content-Disposition": f'attachment; filename="audit-summary-{a.id}.html"'})


# Site audits: every page in the sitemap
def _site_summary(db: Session, s: LighthouseSiteAudit) -> tuple[dict, list[LighthouseAudit]]:
    pages = list(db.scalars(select(LighthouseAudit).where(LighthouseAudit.site_audit_id == s.id).order_by(LighthouseAudit.created_at, LighthouseAudit.id)))
    completed = sum(1 for p in pages if p.status == "completed")
    failed = sum(1 for p in pages if p.status == "failed")
    if s.discovery_error:
        status, completed, failed = "failed", 0, 0
    elif not pages:
        status = "failed"
    elif any(p.status in ("queued", "running") for p in pages):
        status = "running"
    else:
        status = "completed"  # also when some pages failed: see failed_count
    return row(s, {"updated_at"}) | {"status": status, "completed_count": completed, "failed_count": failed}, pages


@router.post("/site-audits", status_code=201)
def create_site_audit(body: LighthouseSiteAuditIn, db: Session = Depends(get_db), _: User = Depends(rate_limited)):
    try:
        urls = discover_site_urls(body.url, body.max_pages)
    except SSRFValidationError as exc:
        raise HTTPException(400, str(exc)) from exc
    except SitemapDiscoveryError as exc:
        db.add(LighthouseSiteAudit(base_url=body.url, strategy=body.strategy, engine=body.engine, max_pages=body.max_pages, page_count=0, discovery_error=str(exc)))
        db.commit()
        raise HTTPException(422, str(exc)) from exc

    s = LighthouseSiteAudit(base_url=body.url, strategy=body.strategy, engine=body.engine, max_pages=body.max_pages, page_count=len(urls))
    db.add(s)
    db.commit()
    ids = []
    for url in urls:
        try:
            ids.append(lighthouse_runner.create_and_queue(db, url, body.strategy, body.engine, site_audit_id=s.id).id)
        except SSRFValidationError:
            continue  # discovery keeps to the same host, so this is rare: skip the page, not the site
    return {"id": s.id, "base_url": s.base_url, "page_count": len(ids), "page_audit_ids": ids, "status_url": _status_url("site-audits", s.id)}


@router.get("/site-audits/history")
def site_audit_history(page: int = 1, page_size: int = 20, db: Session = Depends(get_db), _: User = Depends(current_user)):
    page, page_size = _page(page, page_size)
    total = db.scalar(select(func.count(LighthouseSiteAudit.id))) or 0
    items = db.scalars(select(LighthouseSiteAudit).order_by(LighthouseSiteAudit.created_at.desc(), LighthouseSiteAudit.id.desc()).offset((page - 1) * page_size).limit(page_size))
    return {"total": total, "page": page, "page_size": page_size, "items": [_site_summary(db, s)[0] for s in items]}


@router.get("/site-audits/{site_audit_id}")
def get_site_audit(site_audit_id: int, db: Session = Depends(get_db), _: User = Depends(current_user)):
    s = db.get(LighthouseSiteAudit, site_audit_id)
    if not s:
        raise HTTPException(404, "Site audit not found")
    summary, pages = _site_summary(db, s)
    return summary | {"pages": [row(p, INTERNAL) for p in pages]}
