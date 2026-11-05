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


def _run(db: Session, audit_id: int, url: str, strategy: str, pages: int, business_id: int | None = None, options: dict | None = None) -> None:
    web = audits.website_audit(db, url, strategy, pages, audit=db.get(Audit, audit_id), options=options)
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
    queued = Audit(kind="website", target=url, status="queued", workspace_id=body.workspace_id or body.business_id)
    db.add(queued)
    if body.business_id is not None:
        log(db, user.name, "audit_started", body.business_id, kinds=["technical", "onpage"])
    db.commit()
    tasks.add_task(in_background(_run, queued.id, url, body.strategy, body.crawl_pages, body.business_id, body.options))
    return {"id": queued.id, "status": "queued", "url": url}  # poll GET /website-audits/{id}


@router.get("/overview")
def overview(workspace_id: int | None = None, limit: int = 20, db: Session = Depends(get_db), _: User = Depends(current_user)):
    """The audited websites (a project sees only its own), each with its latest finished audit's figures and the change since the audit before."""
    from ..services import audit_overview
    q = select(Audit).where(Audit.kind == "website", Audit.status == "done").order_by(Audit.finished_at.desc(), Audit.id.desc())
    if workspace_id is not None:
        q = q.where(Audit.workspace_id == workspace_id)
    seen: dict[str, list[Audit]] = {}
    for a in db.scalars(q.limit(300)):
        seen.setdefault(a.target, [])
        if len(seen[a.target]) < 2:
            seen[a.target].append(a)
    rows = [audit_overview.row(v[0], v[1] if len(v) > 1 else None) for v in seen.values()][:max(1, min(limit, 50))]
    return rows


@router.get("/tech-stack")
def tech_stack(url: str, _: User = Depends(current_user)):
    """The technology behind any website (CMS or framework, language, hosting, CDN, plugins, analytics), read from its homepage, headers and cookies."""
    from ..services import site_publish
    try:
        return site_publish.detect(crawler.homepage(url))
    except (site_publish.PublishError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("")
def history(url: str | None = None, workspace_id: int | None = None, limit: int = 50, offset: int = 0, slim: bool = False, db: Session = Depends(get_db), _: User = Depends(current_user)):
    """Audits of websites, newest first, in slabs (`limit`/`offset`). `slim=true` drops the large per-audit lists and sends `issue_count`."""
    q = select(Audit).where(Audit.kind == "website")
    if workspace_id is not None:  # a project sees only the scans it ran itself
        q = q.where(Audit.workspace_id == workspace_id)
    if url:
        q = q.where(Audit.target == crawler.homepage(url))
    return audits.page(db, q, limit, offset, slim)


@router.get("/{audit_id}/overview")
def audit_overview_page(audit_id: int, db: Session = Depends(get_db), _: User = Depends(current_user)):
    from ..services import audit_overview
    a = db.get(Audit, audit_id)
    if not a or a.kind != "website" or a.status != "done":
        raise HTTPException(404, "Audit not found")
    return audit_overview.detail(db, a)


@router.get("/{audit_id}")
def get_one(audit_id: int, db: Session = Depends(get_db), _: User = Depends(current_user)):
    a = db.get(Audit, audit_id)
    if not a or a.kind != "website":
        raise HTTPException(404, "Audit not found")
    return row(a)
