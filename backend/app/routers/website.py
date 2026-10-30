"""One-off audit of any website (no business needed): PageSpeed + a short crawl."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import in_background
from ..models import Audit, Business
from ..schemas import WebsiteAuditIn
from ..serialize import row, rows
from ..services import agent, audits, crawler
from ..services.activity import log
from ..services.url_safety import SSRFValidationError, validate_url_shape

router = APIRouter(prefix="/website-audits", tags=["website"])


def _run(db: Session, audit_id: int, url: str, strategy: str, pages: int, business_id: int | None = None) -> None:
    web = audits.website_audit(db, url, strategy, pages, audit=db.get(Audit, audit_id))
    b = db.get(Business, business_id) if business_id else None
    if b and web.status == "done":
        # The business's own site: the same scan becomes its technical + on-page audits and plans the fixes.
        audits.record_for_business(db, b, web)
        agent.plan_from_audits(db, b, web.issues or [], audited=[k for k, present in (('technical', (web.result or {}).get('pagespeed')), ('onpage', (web.result or {}).get('crawl'))) if present])


@router.post("", status_code=202)
def start(body: WebsiteAuditIn, tasks: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if body.business_id is not None and not db.get(Business, body.business_id):
        raise HTTPException(404, "Business not found")
    url = crawler.homepage(str(body.url))  # audits always start at the homepage
    try:
        validate_url_shape(url)
    except SSRFValidationError as exc:
        raise HTTPException(400, str(exc)) from exc
    queued = Audit(kind="website", target=url, status="queued")
    db.add(queued)
    if body.business_id is not None:
        log(db, user.name, "audit_started", body.business_id, kinds=["technical", "onpage"])
    db.commit()
    tasks.add_task(in_background(_run, queued.id, url, body.strategy, body.crawl_pages, body.business_id))
    return {"id": queued.id, "status": "queued", "url": url}  # poll GET /website-audits/{id}


@router.get("")
def history(url: str | None = None, db: Session = Depends(get_db), _: User = Depends(current_user)):
    q = select(Audit).where(Audit.kind == "website")
    if url:
        q = q.where(Audit.target == crawler.homepage(url))
    return rows(db.scalars(q.order_by(Audit.created_at.desc()).limit(50)), exclude={"result"})


@router.get("/{audit_id}")
def get_one(audit_id: int, db: Session = Depends(get_db), _: User = Depends(current_user)):
    a = db.get(Audit, audit_id)
    if not a or a.kind != "website":
        raise HTTPException(404, "Audit not found")
    return row(a)
