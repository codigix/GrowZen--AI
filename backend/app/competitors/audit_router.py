"""Batch SEO audit of competitor websites (no business attached): PageSpeed + a short crawl per URL,
run in the background and saved so a specific one can be looked up later by id -- including an
HTML report page covering every page the crawl visited, not just the home page's score."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import in_background
from ..models import Audit, LighthouseAudit
from ..schemas import CompetitorAuditIn
from ..serialize import row, rows
from ..services import audits
from .report import render_competitor_report

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
    """One report page for this competitor: the Lighthouse scores plus every page the crawl
    visited (title, meta, H1, word count, images, issues) -- all `crawl_pages` worth, not just one."""
    a = db.get(Audit, audit_id)
    if not a or a.kind != "competitor":
        raise HTTPException(404, "Competitor audit not found")
    if a.status != "done":
        raise HTTPException(409, f"This audit is still {a.status}; try again once it finishes.")
    if not (a.result or {}).get("crawl"):
        raise HTTPException(404, a.error or "No crawl data is available for this audit.")
    lh_id = ((a.result or {}).get("pagespeed") or {}).get("lighthouse_audit_id")
    lh = db.get(LighthouseAudit, lh_id) if lh_id else None
    return HTMLResponse(render_competitor_report(a, lh))
