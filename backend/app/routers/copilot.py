"""AI copilot across every client: the daily briefing, alerts, and monthly reports in one go."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..config import get_settings
from ..db import get_db
from ..models import Business
from ..schemas import AuditSummaryIn, PageRewriteIn
from ..services import ai, audit_ai, copilot, portfolio, reports
from ..services.activity import log

router = APIRouter(prefix="/copilot", tags=["copilot"])


@router.get("/status")
def status(_: User = Depends(current_user)):
    """Whether AI writing is on, and with which provider (no keys)."""
    s = get_settings()
    return {"ai": ai.is_configured(), "provider": s.ai_provider, "providers": sorted(ai.PROVIDERS)}


@router.get("/briefing")
def briefing(refresh: bool = False, db: Session = Depends(get_db), _: User = Depends(current_user)):
    """Today's top priorities across every client (cached for the day; refresh=true writes it again)."""
    return copilot.briefing(db, portfolio.summary(db), refresh)


@router.get("/alerts")
def alerts(db: Session = Depends(get_db), _: User = Depends(current_user)):
    """Problems worth acting on this week, each with a likely cause and next step."""
    found, source = copilot.explain_alerts(copilot.alerts(db))
    return {"source": source, "alerts": found}


@router.post("/audit-summary")
def audit_summary(body: AuditSummaryIn, _: User = Depends(current_user)):
    """A website audit in plain words: headline, what it means, the top 3 actions, and a message for the client."""
    return audit_ai.summary(body.model_dump())


@router.post("/rewrite-pages")
def rewrite_pages(body: PageRewriteIn, _: User = Depends(current_user)):
    """New titles or meta descriptions for every crawled page that needs one."""
    return audit_ai.rewrite(body.kind, body.business, body.pages)


@router.post("/reports")
def draft_reports(month: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """This month's report for every active client: the plain-words summary (AI-written with a key) and PDF link."""
    out = []
    for b in db.scalars(select(Business).where(Business.status != "paused").order_by(Business.name).limit(50)):
        s = reports.monthly_summary(db, b, month)
        out.append({"business_id": b.id, "business": b.name, "month": s["month"], "overall": s["overall"], "summary": s["plain_words"],
                    "calls": s["insights"]["calls"], "previous_calls": s["previous"]["calls"], "pdf": f"/businesses/{b.id}/report.pdf?month={s['month']}"})
    log(db, user.name, "reports_drafted", None, count=len(out), ai=ai.is_configured())
    db.commit()
    return {"ai": ai.is_configured(), "reports": out}
