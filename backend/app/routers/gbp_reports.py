"""Reports for the Google Business Profile: one month at a glance, the last six months, who it was sent to, and the PDF/CSV/email of it.

GET  /businesses/{id}/gbp/reports/overview?month=YYYY-MM     the month vs the one before, six-month trend, send history
GET  /businesses/{id}/gbp/reports/summary?month=YYYY-MM      the same month with the plain-words summary written by AI (when AI is set up)
POST /businesses/{id}/gbp/reports/send                       email the PDF report ({month, to}); needs SMTP
The files themselves come from /businesses/{id}/report.pdf and report.csv.
"""
import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..config import get_settings
from ..db import get_db
from ..deps import get_business
from ..models import ActivityLog, Business, Review
from ..services import reports
from ..services.activity import log
from ..services.notify import send_email

router = APIRouter(prefix="/businesses/{business_id}/gbp/reports", tags=["gbp-reports"])
MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def _month(m: str | None) -> str:
    m = m or date.today().strftime("%Y-%m")
    if not MONTH.match(m):
        raise HTTPException(422, "Month must look like 2026-11.")
    return m


def _shift(month: str, back: int) -> str:
    y, mo = map(int, month.split("-"))
    idx = y * 12 + (mo - 1) - back
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def trend(db: Session, b: Business, month: str, n: int = 6) -> list[dict]:
    out = []
    for back in range(n - 1, -1, -1):
        m = _shift(month, back)
        start, end, _, _ = reports._month_range(m)
        s = reports._sums(db, b, start, end)
        new_reviews = db.scalar(select(func.count(Review.id)).where(Review.business_id == b.id, Review.review_date.between(start, end))) or 0
        out.append({"month": m, **s, "new_reviews": new_reviews})
    return out


def history(db: Session, b: Business, limit: int = 10) -> list[dict]:
    q = select(ActivityLog).where(ActivityLog.business_id == b.id, ActivityLog.action.in_(("report_sent", "report_built"))).order_by(ActivityLog.created_at.desc()).limit(limit)
    return [{"at": a.created_at.isoformat(), "by": a.actor, "month": (a.detail or {}).get("month"), "to": (a.detail or {}).get("to"), "emailed": a.action == "report_sent"} for a in db.scalars(q)]


@router.get("/overview")
def overview(month: str | None = None, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    m = _month(month)
    s = get_settings()
    return {"summary": reports.monthly_summary(db, b, m, ai_words=False), "trend": trend(db, b, m), "history": history(db, b),
            "can_email": bool(s.smtp_host and s.smtp_from), "recipient": b.contact_email, "linked": bool(b.gbp_location)}


@router.get("/summary")
def summary(month: str | None = None, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    m = _month(month)
    return {"plain_words": reports.monthly_summary(db, b, m, ai_words=True)["plain_words"]}


class SendIn(BaseModel):
    month: str | None = None
    to: str | None = Field(default=None, max_length=254)


@router.post("/send")
def send(body: SendIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    m = _month(body.month)
    to = (body.to or b.contact_email or "").strip()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", to):
        raise HTTPException(422, "Enter the email address to send the report to.")
    s = get_settings()
    if not (s.smtp_host and s.smtp_from):
        raise HTTPException(503, "Email is not set up on the server yet (SMTP_HOST and SMTP_FROM).")
    data = reports.monthly_summary(db, b, m)
    try:
        sent = send_email(to, f"{b.name}: your Google profile report for {m}", data["plain_words"], [(f"{b.name}-{m}.pdf", reports.pdf(data), "application/pdf")])
    except Exception as exc:  # noqa: BLE001 - SMTP errors vary; the person needs the reason, not a stack trace
        raise HTTPException(502, f"The email could not be sent: {str(exc)[:160]}") from exc
    if not sent:
        raise HTTPException(502, "The email could not be sent. Check the SMTP settings.")
    log(db, user.name, "report_sent", b.id, month=m, to=to)
    db.commit()
    return {"sent": True, "to": to}
