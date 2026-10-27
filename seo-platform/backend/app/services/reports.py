"""Monthly client report: numbers vs last month, audit scores, top fixes, plain-words summary, PDF."""
import io
from datetime import date, timedelta
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Business, InsightDay, Keyword, Lead, Review
from . import ai, audits
from .activity import log
from .notify import send_email


def _month_range(month: str) -> tuple[date, date, date, date]:
    y, m = map(int, month.split("-"))
    start = date(y, m, 1)
    end = (date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1))
    prev_end = start - timedelta(days=1)
    return start, end, prev_end.replace(day=1), prev_end


def _sums(db: Session, b: Business, a: date, z: date) -> dict[str, int]:
    row = db.execute(select(func.coalesce(func.sum(InsightDay.calls), 0), func.coalesce(func.sum(InsightDay.directions), 0), func.coalesce(func.sum(InsightDay.website_clicks), 0),
                            func.coalesce(func.sum(InsightDay.views_search + InsightDay.views_maps), 0)).where(InsightDay.business_id == b.id, InsightDay.day.between(a, z))).one()
    return dict(zip(["calls", "directions", "website_clicks", "views"], map(int, row)))


def monthly_summary(db: Session, b: Business, month: str | None = None) -> dict[str, Any]:
    month = month or date.today().strftime("%Y-%m")
    start, end, pstart, pend = _month_range(month)
    cur, prev = _sums(db, b, start, end), _sums(db, b, pstart, pend)
    leads = db.scalar(select(func.count(Lead.id)).where(Lead.business_id == b.id, Lead.lead_date.between(start, end))) or 0
    new_reviews = db.scalar(select(func.count(Review.id)).where(Review.business_id == b.id, Review.review_date.between(start, end))) or 0
    latest = audits.latest(db, b)
    scores = {k: a.score for k, a in latest.items()}
    fixes = sorted((i for a in latest.values() for i in a.issues), key=lambda i: {"critical": 0, "serious": 1, "warning": 2}.get(i.get("level"), 3))[:5]
    kws = [{"keyword": k.keyword, "rank": k.rank, "prev_rank": k.prev_rank} for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.rank.is_not(None)).limit(10))]
    summary = {"business": b.name, "month": month, "insights": cur, "previous": prev, "leads": leads, "new_reviews": new_reviews,
               "scores": scores, "overall": audits.overall(db, b), "top_fixes": fixes, "keywords": kws}
    summary["plain_words"] = _plain_words(b, summary)
    return summary


def _plain_words(b: Business, s: dict[str, Any]) -> str:
    calls, prev = s["insights"]["calls"], s["previous"]["calls"]
    fallback = (f"This month {calls} people called {b.name} from Google ({'up' if calls >= prev else 'down'} from {prev}) and "
                f"{s['insights']['directions']} asked for directions. Overall score: {s['overall'] if s['overall'] is not None else 'not audited yet'}/100. "
                f"Next step: {s['top_fixes'][0]['title'] if s['top_fixes'] else 'keep posting weekly and replying to reviews'}.")
    if not ai.is_configured():
        return fallback
    try:
        return ai.complete(f"You write short monthly reports for small business owners. Plain words, no jargon, 4-6 sentences.\n{ai.RULES}",
                           f"Business: {b.name}\nData (use only this): {s}\nWrite the summary.", max_tokens=400)
    except Exception:
        return fallback


def pdf(summary: dict[str, Any], agency: str = "Codigix Infotech") -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title=f"{summary['business']} report {summary['month']}")
    st = getSampleStyleSheet()
    cur, prev = summary["insights"], summary["previous"]
    rows = [["", "This month", "Last month"]] + [[k.replace("_", " ").capitalize(), cur[k], prev[k]] for k in ("calls", "directions", "website_clicks", "views")]
    rows += [["Leads", summary["leads"], ""], ["New reviews", summary["new_reviews"], ""]]
    t = Table(rows, colWidths=[200, 120, 120])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2a78d6")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                           ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e1e0d9")), ("FONTSIZE", (0, 0), (-1, -1), 10)]))
    story = [Paragraph(f"{summary['business']}: monthly visibility report", st["Title"]), Paragraph(f"{summary['month']} · {agency}", st["Normal"]), Spacer(1, 12),
             Paragraph(summary["plain_words"], st["BodyText"]), Spacer(1, 12), t, Spacer(1, 12),
             Paragraph(f"Overall score: {summary['overall'] if summary['overall'] is not None else '—'}/100 · " + ", ".join(f"{k} {v}" for k, v in summary["scores"].items() if v is not None), st["Normal"]), Spacer(1, 12),
             Paragraph("Next steps", st["Heading2"])] + [Paragraph(f"• {f['title']}", st["BodyText"]) for f in summary["top_fixes"]]
    doc.build(story)
    return buf.getvalue()


def send_monthly(db: Session, b: Business) -> bool:
    s = monthly_summary(db, b)
    sent = send_email(b.contact_email or "", f"{b.name}: your monthly visibility report", s["plain_words"], [(f"{b.name}-{s['month']}.pdf", pdf(s), "application/pdf")]) if b.contact_email else False
    log(db, "reporter", "report_sent" if sent else "report_built", b.id, month=s["month"], emailed=sent)
    db.commit()
    return sent
