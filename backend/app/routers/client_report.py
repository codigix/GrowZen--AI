"""A live report link for the client: the profile's results month by month, on a page that needs no sign-in.

Signed-in side:  GET    /businesses/{id}/gbp/reports/share     {enabled, url}
                 POST   /businesses/{id}/gbp/reports/share     make the link (or a NEW one: the old link stops working)
                 DELETE /businesses/{id}/gbp/reports/share     switch the link off
Public side:     GET    /public/client-report/{token}?month=YYYY-MM

The link carries a random key stored on the project, so it can be switched off or replaced at any time. The public page shows results only (numbers, growth, reviews,
search positions, what was done): never contact details, tasks, drafts or anything private. It reads the data when it is opened, so it is always current.
"""
import hmac
import re
import secrets
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..config import get_settings
from ..db import get_db
from ..deps import get_business
from ..models import ActivityLog, Business, Keyword, Lead, Post, Review
from ..services import reports
from ..services.activity import log

router = APIRouter(prefix="/businesses/{business_id}/gbp/reports/share", tags=["client-report"])
growth_router = APIRouter(prefix="/businesses/{business_id}/gbp/reports", tags=["client-report"])
public_router = APIRouter(prefix="/public/client-report", tags=["public-client-report"])
MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
MONTHS = 12

AREAS = (("post", r"post"), ("review", r"review|reply"), ("photo", r"media|photo|logo"), ("profile", r"business_updated|profile|category|address|hours|attribute|special"), ("sync", r"gbp_synced"))


def _url(b: Business) -> str | None:
    if not b.report_key:
        return None
    return f"{get_settings().site_url}/report/{b.id}-{b.report_key}"


def _shift(month: str, back: int) -> str:
    y, mo = map(int, month.split("-"))
    idx = y * 12 + (mo - 1) - back
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def growth(db: Session, b: Business, month: str, n: int = MONTHS) -> list[dict]:
    """The last `n` months up to `month`, oldest first: what customers did, reviews, posts and leads, each with its change against the month before."""
    rows: list[dict] = []
    first = _shift(month, n)  # one extra month at the start, only to measure the first change
    for back in range(n, -1, -1):
        m = _shift(month, back)
        start, end, _, _ = reports._month_range(m)
        s = reports._sums(db, b, start, end)
        rev = db.execute(select(func.count(Review.id), func.coalesce(func.avg(Review.rating), 0)).where(Review.business_id == b.id, Review.gone_at.is_(None), Review.review_date.between(start, end))).one()
        total = db.execute(select(func.count(Review.id), func.coalesce(func.avg(Review.rating), 0)).where(Review.business_id == b.id, Review.gone_at.is_(None), Review.review_date <= end)).one()
        posts = db.scalar(select(func.count(Post.id)).where(Post.business_id == b.id, Post.status == "published",
                                                           Post.published_at >= datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc),
                                                           Post.published_at < datetime.combine(end, datetime.max.time(), tzinfo=timezone.utc))) or 0
        leads = db.scalar(select(func.count(Lead.id)).where(Lead.business_id == b.id, Lead.lead_date.between(start, end))) or 0
        actions = s["calls"] + s["directions"] + s["website_clicks"]
        rows.append({"month": m, **s, "actions": actions, "new_reviews": int(rev[0]), "reviews_total": int(total[0]), "rating": round(float(total[1]), 2) if total[0] else None, "posts": posts, "leads": leads})
    for prev, cur in zip(rows, rows[1:]):
        cur["change"] = {k: (round((cur[k] - prev[k]) / prev[k] * 100) if prev[k] else (100 if cur[k] else 0)) for k in ("views", "calls", "directions", "website_clicks", "actions", "new_reviews")}
    return rows[1:] if rows and rows[0]["month"] == first else rows


def _did(db: Session, b: Business, month: str) -> dict[str, int]:
    start, end, _, _ = reports._month_range(month)
    a = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)
    z = datetime.combine(end, datetime.max.time(), tzinfo=timezone.utc)
    acts = [str(x) for x in db.scalars(select(ActivityLog.action).where(ActivityLog.business_id == b.id, ActivityLog.created_at.between(a, z)))]
    out = {k: sum(1 for x in acts if re.search(p, x)) for k, p in AREAS}
    return {k: v for k, v in out.items() if v}


def build(db: Session, b: Business, month: str) -> dict:
    s = reports.monthly_summary(db, b, month, ai_words=False)
    months = growth(db, b, month)
    kws = [{"keyword": k.keyword, "rank": k.rank, "prev_rank": k.prev_rank} for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.rank.is_not(None)).order_by(Keyword.rank).limit(12))]
    return {"business": {"name": b.name, "logo": b.logo, "category": b.primary_category, "city": b.city, "website": b.website},
            "month": month, "months": months, "current": months[-1] if months else None, "previous": months[-2] if len(months) > 1 else None,
            "plain_words": s["plain_words"], "keywords": kws, "did": _did(db, b, month), "generated_at": datetime.now(timezone.utc).isoformat()}


@growth_router.get("/growth")
def growth_view(month: str | None = None, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """The same month-by-month data the client's page shows, for the signed-in owner."""
    m = month or date.today().strftime("%Y-%m")
    if not MONTH.match(m):
        raise HTTPException(422, "Month must look like 2026-11.")
    return build(db, b, m)


@router.get("")
def status(b: Business = Depends(get_business)):
    return {"enabled": bool(b.report_key), "url": _url(b), "path": f"/report/{b.id}-{b.report_key}" if b.report_key else None,
            "public": not any(h in get_settings().site_url for h in ("localhost", "127.0.0.1", "192.168.", "10.", "172.16."))}


@router.post("")
def make(b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Create the link, or replace it with a new one (the old address stops working at once)."""
    renewed = bool(b.report_key)
    b.report_key = secrets.token_urlsafe(14)
    log(db, user.name, "client_report_link_renewed" if renewed else "client_report_link_created", b.id)
    db.commit()
    return status(b)


@router.delete("")
def switch_off(b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    b.report_key = None
    log(db, user.name, "client_report_link_off", b.id)
    db.commit()
    return status(b)


@public_router.get("/{token}")
def public(token: str, month: str | None = None, db: Session = Depends(get_db)):
    try:
        raw_id, key = token.split("-", 1)
        b = db.get(Business, int(raw_id))
    except ValueError:
        b = None
        key = ""
    if not b or not b.report_key or not hmac.compare_digest(b.report_key, key):
        raise HTTPException(404, "This report link is not valid, or it has been switched off.")
    m = month or date.today().strftime("%Y-%m")
    if not MONTH.match(m) or m > date.today().strftime("%Y-%m"):
        raise HTTPException(422, "Month must look like 2026-11 and not be in the future.")
    return build(db, b, m)
