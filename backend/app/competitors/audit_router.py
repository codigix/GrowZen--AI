"""Batch SEO audit of competitor websites (no business attached): PageSpeed + a short crawl per URL,
run in the background and saved so a specific one can be looked up later by id -- including the
same Lighthouse HTML report page the regular website audit shows on the frontend."""
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import in_background
from ..models import Audit, LighthouseAudit
from ..schemas import CompetitorAuditIn
from ..serialize import row, rows
from ..services import audits, lighthouse_report

router = APIRouter(prefix="/audit/competitors", tags=["competitor-audits"])


def _run(db: Session, audit_id: int, url: str, strategy: str, pages: int) -> None:
    audits.website_audit(db, url, strategy, pages, audit=db.get(Audit, audit_id))


@router.post("", status_code=202)
def start(body: CompetitorAuditIn, tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Queue one audit per URL; poll GET /audit/competitors/{id} for each, or GET /audit/competitors for the list."""
    queued = []
    for url in body.urls:
        a = Audit(kind="competitor", target=str(url), status="queued")
        db.add(a)
        queued.append(a)
    db.commit()
    for a in queued:
        tasks.add_task(in_background(_run, a.id, a.target, body.strategy, body.crawl_pages))
    return [{"id": a.id, "url": a.target, "status": "queued"} for a in queued]


@router.get("")
def history(db: Session = Depends(get_db)):
    q = select(Audit).where(Audit.kind == "competitor").order_by(Audit.created_at.desc()).limit(100)
    return rows(db.scalars(q), exclude={"result"})


@router.get("/{audit_id}")
def get_one(audit_id: int, db: Session = Depends(get_db)):
    a = db.get(Audit, audit_id)
    if not a or a.kind != "competitor":
        raise HTTPException(404, "Competitor audit not found")
    return row(a)


@router.get("/{audit_id}/html")
def get_html(audit_id: int, db: Session = Depends(get_db)):
    """The Lighthouse report page for this competitor's audit, to show on the frontend."""
    a = db.get(Audit, audit_id)
    if not a or a.kind != "competitor":
        raise HTTPException(404, "Competitor audit not found")
    lh_id = ((a.result or {}).get("pagespeed") or {}).get("lighthouse_audit_id")
    lh = db.get(LighthouseAudit, lh_id) if lh_id else None
    if not lh:
        raise HTTPException(404, "No Lighthouse report is available for this audit")
    if lh.html_report_path and Path(lh.html_report_path).is_file():
        return HTMLResponse(Path(lh.html_report_path).read_text(encoding="utf-8"))
    if not lh.report:
        raise HTTPException(404, "No report is available for this audit")
    html = lighthouse_report.render_summary_html(lh.report, {"url": lh.submitted_url, "strategy": lh.strategy, "engine": lh.engine, "completed_at": lh.completed_at})
    return HTMLResponse(html)
