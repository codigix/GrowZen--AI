"""AI copilot across every client: the daily briefing, alerts, and monthly reports in one go."""
from app.services.fanout import ThreadPoolExecutor

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..config import get_settings
from ..db import get_db, release_connection
from ..deps import my_business_ids, only_mine
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
def briefing(refresh: bool = False, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Today's top priorities across every client (cached for the day; refresh=true writes it again)."""
    ids = my_business_ids(db, user)
    return copilot.briefing(db, lambda: portfolio.summary(db, ids), refresh, ids)  # the portfolio is built only when today's briefing is not cached


@router.get("/alerts")
def alerts(db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Problems worth acting on this week, each with a likely cause and next step."""
    found = copilot.alerts(db, owner_ids=my_business_ids(db, user))
    release_connection(db)  # the alerts are read: the connection is not held while the AI explains them
    found, source = copilot.explain_alerts(found)
    return {"source": source, "alerts": found}


@router.post("/audit-summary")
def audit_summary(body: AuditSummaryIn, db: Session = Depends(get_db), _: User = Depends(current_user)):
    """A website audit in plain words: headline, what it means, the top 3 actions, and a message for the client."""
    release_connection(db)  # signing in read the user: nothing more is needed from the database while the AI answers
    return audit_ai.summary(body.model_dump())


@router.post("/rewrite-pages")
def rewrite_pages(body: PageRewriteIn, db: Session = Depends(get_db), _: User = Depends(current_user)):
    """New titles or meta descriptions for every crawled page that needs one."""
    release_connection(db)
    return audit_ai.rewrite(body.kind, body.business, body.pages)


@router.post("/reports")
def draft_reports(month: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """This month's report for every active client: the plain-words summary (AI-written with a key) and PDF link."""
    # The figures of every report are read first (the database only); the connection is then released and the AI summaries are written side by side, a few at a time,
    # instead of one after another while the connection is held. The same texts come back in the same order.
    done = []
    for b in db.scalars(only_mine(select(Business), user).where(Business.status != "paused").order_by(Business.name).limit(50)):
        done.append((b.id, b.name, reports.monthly_summary(db, b, month, ai_words=False)))
    release_connection(db)
    if ai.is_configured() and len(done) > 1:
        with ThreadPoolExecutor(max_workers=4) as pool:
            words = list(pool.map(lambda x: reports.plain_words_text(x[1], x[0], x[2], use_ai=True), done))
    else:
        words = [reports.plain_words_text(name, bid, s, use_ai=True) for bid, name, s in done]
    out = []
    for (bid, name, s), text in zip(done, words):
        out.append({"business_id": bid, "business": name, "month": s["month"], "overall": s["overall"], "summary": text,
                    "calls": s["insights"]["calls"], "previous_calls": s["previous"]["calls"], "pdf": f"/businesses/{bid}/report.pdf?month={s['month']}"})
    log(db, user.name, "reports_drafted", None, count=len(out), ai=ai.is_configured())
    db.commit()
    return {"ai": ai.is_configured(), "reports": out}
