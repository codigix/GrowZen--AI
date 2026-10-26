"""One-off audit of any website (no business needed): PageSpeed + a short crawl."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import in_background
from ..models import Audit
from ..schemas import WebsiteAuditIn
from ..serialize import row, rows
from ..services import audits

router = APIRouter(prefix="/website-audits", tags=["website"])


def _run(db: Session, audit_id: int, url: str, strategy: str, pages: int) -> None:
    audits.website_audit(db, url, strategy, pages, audit=db.get(Audit, audit_id))


@router.post("", status_code=202)
def start(body: WebsiteAuditIn, tasks: BackgroundTasks, db: Session = Depends(get_db), _: User = Depends(current_user)):
    queued = Audit(kind="website", target=str(body.url), status="queued")
    db.add(queued)
    db.commit()
    tasks.add_task(in_background(_run, queued.id, str(body.url), body.strategy, body.crawl_pages))
    return {"id": queued.id, "status": "queued", "url": str(body.url)}  # poll GET /website-audits/{id}


@router.get("")
def history(url: str | None = None, db: Session = Depends(get_db), _: User = Depends(current_user)):
    q = select(Audit).where(Audit.kind == "website")
    if url:
        q = q.where(Audit.target == url)
    return rows(db.scalars(q.order_by(Audit.created_at.desc()).limit(50)), exclude={"result"})


@router.get("/{audit_id}")
def get_one(audit_id: int, db: Session = Depends(get_db), _: User = Depends(current_user)):
    a = db.get(Audit, audit_id)
    if not a or a.kind != "website":
        raise HTTPException(404, "Audit not found")
    return row(a)
