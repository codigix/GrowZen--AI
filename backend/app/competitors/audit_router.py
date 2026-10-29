"""Batch SEO audit of competitor websites: PageSpeed + a short crawl per URL, run in the
background and saved so a specific one can be looked up later by id -- including an HTML report
page covering every page the crawl visited, not just the home page's score.

Pass `business_id` (and, to tie it to a specific registered competitor, `competitor_id` --
see competitors/router.py) to associate the audit with a business for later comparison via
POST /audit/competitors/compare. Without them this behaves exactly as before: a one-off,
unattached competitor audit."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import in_background
from ..models import Audit, Business, Competitor, LighthouseAudit
from ..schemas import CompetitorAuditIn, CompetitorCompareIn
from ..serialize import row, rows
from ..services import audits, competitor_compare
from .report import render_competitor_report

router = APIRouter(prefix="/audit/competitors", tags=["competitor-audits"])


def _run(db: Session, audit_id: int, url: str, strategy: str, pages: int) -> None:
    audits.website_audit(db, url, strategy, pages, audit=db.get(Audit, audit_id))


def _reusable(db: Session, url: str, strategy: str, max_age_hours: int, business_id: int | None, competitor_id: int | None) -> Audit | None:
    """A finished audit of this exact URL+strategy, owned by the same business/competitor (or,
    with neither given, one that isn't owned by anyone) -- reusing another business's record
    would silently repoint its competitor_id."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
    q = select(Audit).where(Audit.kind == "competitor", Audit.target == url, Audit.status == "done", Audit.finished_at >= cutoff)
    if competitor_id is not None:
        q = q.where(Audit.competitor_id == competitor_id)
    elif business_id is not None:
        q = q.where(Audit.business_id == business_id)
    else:
        q = q.where(Audit.business_id.is_(None), Audit.competitor_id.is_(None))
    for a in db.scalars(q.order_by(Audit.finished_at.desc())):
        if ((a.result or {}).get("pagespeed") or {}).get("strategy") == strategy:
            return a
    return None


@router.post("", status_code=202)
def start(body: CompetitorAuditIn, tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Queue one audit per URL; poll GET /audit/competitors/{id} for each, or GET /audit/competitors for the list.
    A URL with a recent finished audit of the same strategy is reused instead of re-queued, unless `reuse_existing=false`."""
    if body.business_id is not None and not db.get(Business, body.business_id):
        raise HTTPException(404, "Business not found")
    if body.competitor_id is not None:
        comp = db.get(Competitor, body.competitor_id)
        if not comp or (body.business_id is not None and comp.business_id != body.business_id):
            raise HTTPException(404, "Competitor not found for this business")
    out = []
    for url in body.urls:
        existing = _reusable(db, str(url), body.strategy, body.max_age_hours, body.business_id, body.competitor_id) if body.reuse_existing else None
        if existing:
            out.append({"id": existing.id, "url": existing.target, "status": existing.status, "reused": True})
            continue
        a = Audit(kind="competitor", target=str(url), status="queued", business_id=body.business_id, competitor_id=body.competitor_id)
        db.add(a)
        db.commit()
        tasks.add_task(in_background(_run, a.id, a.target, body.strategy, body.crawl_pages))
        out.append({"id": a.id, "url": a.target, "status": "queued", "reused": False})
    return out


@router.get("")
def history(business_id: int | None = None, competitor_id: int | None = None, status: str | None = None,
            limit: int = 100, offset: int = 0, db: Session = Depends(get_db)):
    q = select(Audit).where(Audit.kind == "competitor")
    if business_id is not None:
        q = q.where(Audit.business_id == business_id)
    if competitor_id is not None:
        q = q.where(Audit.competitor_id == competitor_id)
    if status is not None:
        q = q.where(Audit.status == status)
    q = q.order_by(Audit.created_at.desc()).offset(max(0, offset)).limit(min(max(1, limit), 200))
    return rows(db.scalars(q), exclude={"result"})


@router.post("/compare")
def compare(body: CompetitorCompareIn, db: Session = Depends(get_db)):
    """Compare our website's existing audit against one or more competitors' existing audits.
    Does not run or re-run any audit -- only stored, finished audits are compared."""
    if not body.competitor_audit_ids and not body.competitor_ids:
        raise HTTPException(400, "Pass competitor_audit_ids or competitor_ids")
    try:
        ours = competitor_compare.resolve_our_side(db, audit_id=body.our_audit_id, business_id=body.business_id, strategy=body.strategy)
    except competitor_compare.CompareError as exc:
        raise HTTPException(404, str(exc)) from exc

    results = []
    for audit_id in body.competitor_audit_ids:
        try:
            theirs = competitor_compare.resolve_competitor_side(db, audit_id=audit_id, business_id=body.business_id, strategy=body.strategy)
            results.append(competitor_compare.compare(db, ours, theirs))
        except competitor_compare.CompareError as exc:
            results.append({"error": str(exc), "competitor_audit_id": audit_id})
    for competitor_id in body.competitor_ids:
        try:
            theirs = competitor_compare.resolve_competitor_side(db, competitor_id=competitor_id, business_id=body.business_id, strategy=body.strategy)
            results.append(competitor_compare.compare(db, ours, theirs))
        except competitor_compare.CompareError as exc:
            results.append({"error": str(exc), "competitor_id": competitor_id})
    return {"ours": {"audit_id": ours.audit_id, "business_id": ours.business_id, "target": ours.target, "strategy": ours.strategy}, "comparisons": results}


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
