"""Client profiles, their audits, schedules and reports."""
from datetime import date, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import User, current_user, require_admin
from ..db import get_db
from ..deps import get_business, in_background
from ..models import AgentTask, Audit, Business, InsightDay, Lead, Review, Schedule
from ..schemas import AuditRunIn, BusinessIn, BusinessPatch, ScheduleIn
from ..serialize import row, rows
from ..services import agent, audits, discovery, gbp, reports, schedules, site_onboarding
from ..services import analytics as analytics_service, portfolio as portfolio_service, site_health
from ..services.activity import log
from ..services.profile_score import score_profile

router = APIRouter(prefix="/businesses", tags=["businesses"])


@router.get("")
def list_businesses(db: Session = Depends(get_db), _: User = Depends(current_user)):
    out = []
    for b in db.scalars(select(Business).order_by(Business.name)):
        pending = db.scalar(select(func.count(AgentTask.id)).where(AgentTask.business_id == b.id, AgentTask.status == "pending")) or 0
        nxt = db.scalar(select(func.min(Schedule.next_run_at)).where(Schedule.business_id == b.id, Schedule.every != "off"))
        out.append(row(b) | {"pending_tasks": pending, "next_run_at": nxt.isoformat() if nxt else None})
    return out


@router.get("/analytics")
def analytics(weeks: int = 12, db: Session = Depends(get_db), _: User = Depends(current_user)):
    """Weekly growth across every client (health, rankings, customer actions, leads, reviews, AI work, projects)."""
    return analytics_service.summary(db, weeks)


@router.get("/site-audit")
def site_audit_table(db: Session = Depends(get_db), _: User = Depends(current_user)):
    """Every project's site health broken into crawlability, HTTPS, performance, markups, Core Web Vitals and more."""
    return site_health.table(db)


@router.get("/portfolio")
def portfolio(db: Session = Depends(get_db), _: User = Depends(current_user)):
    """Every client with its status, plan, health, running services and what needs attention (dashboard)."""
    return portfolio_service.summary(db)


@router.post("", status_code=201)
def create_business(body: BusinessIn, background: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(current_user)):
    b = Business(**body.model_dump(), source="manual", created_by=user.name)
    db.add(b)
    db.commit()
    log(db, user.name, "business_created", b.id)
    db.commit()
    if b.website and site_onboarding.autodetect_enabled():
        background.add_task(in_background(site_onboarding.detect_in_background, b.id))  # reads the website's technology without making the user wait
    return row(b)


@router.get("/{business_id}")
def get_one(b: Business = Depends(get_business)):
    return row(b)


@router.patch("/{business_id}")
def update(body: BusinessPatch, background: BackgroundTasks, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    changes = body.model_dump(exclude_unset=True)
    old_site = b.website
    for k, v in changes.items():
        setattr(b, k, v)
    log(db, user.name, "business_updated", b.id, fields=list(changes))
    db.commit()
    if b.website and b.website != old_site and site_onboarding.autodetect_enabled():
        background.add_task(in_background(site_onboarding.detect_in_background, b.id))  # a new address means a possibly different technology
    return row(b)


@router.delete("/{business_id}", status_code=204)
def delete(b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(require_admin)):
    log(db, user.name, "business_deleted", None, name=b.name, id=b.id)
    db.delete(b)
    db.commit()
    return Response(status_code=204)


def _latest_failures(db: Session, b: Business) -> dict:
    """Kinds whose most recent run failed, with the reason."""
    seen, out = set(), {}
    for a in db.scalars(select(Audit).where(Audit.business_id == b.id, Audit.status.in_(["done", "failed"])).order_by(Audit.created_at.desc()).limit(60)):
        if a.kind in seen:
            continue
        seen.add(a.kind)
        if a.status == "failed":
            out[a.kind] = a.error
    return out


@router.get("/{business_id}/overview")
def overview(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Everything the Overview screen needs in one call."""
    latest = audits.latest(db, b)
    gbp_score = score_profile(b, audits.profile_stats(db, b))
    since = date.today() - timedelta(days=30)
    prev = since - timedelta(days=30)

    def sums(a, z):
        r = db.execute(select(func.coalesce(func.sum(InsightDay.calls), 0), func.coalesce(func.sum(InsightDay.directions), 0), func.coalesce(func.sum(InsightDay.website_clicks), 0))
                       .where(InsightDay.business_id == b.id, InsightDay.day > a, InsightDay.day <= z)).one()
        return {"calls": int(r[0]), "directions": int(r[1]), "website_clicks": int(r[2])}

    return {
        "business": row(b),
        "profile": {"score": gbp_score.score, "factors": gbp_score.factors, "top_fixes": gbp_score.top_fixes, "alerts": gbp_score.alerts},
        "areas": {k: {"score": a.score, "data_source": a.data_source, "finished_at": a.finished_at.isoformat() if a.finished_at else None} for k, a in latest.items()},
        "overall": audits.overall(db, b),
        "failed": _latest_failures(db, b),
        "insights": {"last_30": sums(since, date.today()), "previous_30": sums(prev, since)},
        "daily": rows(db.scalars(select(InsightDay).where(InsightDay.business_id == b.id, InsightDay.day > since).order_by(InsightDay.day))),
        "leads_30": db.scalar(select(func.count(Lead.id)).where(Lead.business_id == b.id, Lead.lead_date > since)) or 0,
        "pending_tasks": rows(db.scalars(select(AgentTask).where(AgentTask.business_id == b.id, AgentTask.status == "pending").order_by(AgentTask.created_at.desc()).limit(6))),
    }


@router.get("/{business_id}/gbp/score")
def gbp_score(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    r = score_profile(b, audits.profile_stats(db, b))
    return {"score": r.score, "factors": r.factors, "items": r.items, "alerts": r.alerts, "top_fixes": r.top_fixes}


@router.get("/{business_id}/gbp/live")
def gbp_live(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Everything read live from this project's Google Business Profile, in one call: the connection, the
    profile as Google holds it, the last 30 days of customer actions, reviews, photos, posts and search keywords."""
    since = date.today() - timedelta(days=30)
    totals = db.execute(select(func.coalesce(func.sum(InsightDay.calls), 0), func.coalesce(func.sum(InsightDay.directions), 0), func.coalesce(func.sum(InsightDay.website_clicks), 0),
                                func.coalesce(func.sum(InsightDay.views_search), 0), func.coalesce(func.sum(InsightDay.views_maps), 0), func.coalesce(func.sum(InsightDay.bookings), 0))
                        .where(InsightDay.business_id == b.id, InsightDay.day > since)).one()
    reviews = list(db.scalars(select(Review).where(Review.business_id == b.id).order_by(Review.review_date.desc().nullslast(), Review.id.desc())))
    c = b.connection
    status = dict(b.gbp_status or {})
    live = status.pop("live", None)
    return {
        "linked": bool(b.gbp_location),
        "connection": c and {"id": c.id, "email": c.email, "name": c.display_name, "status": c.status, "last_sync_at": c.last_sync_at.isoformat() if c.last_sync_at else None, "last_error": c.last_error},
        "status": status, "verification": b.verification,
        "profile": {"name": b.name, "primary_category": b.primary_category, "secondary_categories": b.secondary_categories or [], "description": b.description, "phone": b.phone,
                    "website": b.website, "address": b.address, "area": b.area, "city": b.city, "lat": b.lat, "lng": b.lng, "hours": b.hours or {}, "special_hours": b.special_hours or [],
                    "service_area": b.service_area, "place_id": b.place_id, "location": b.gbp_location, "account": b.gbp_account},
        "metrics": {"rating": b.rating, "review_count": b.review_count, "photo_count": b.photo_count, "unreplied_reviews": sum(1 for r in reviews if r.reply_status in ("none", "draft")),
                    "calls_30": int(totals[0]), "directions_30": int(totals[1]), "website_clicks_30": int(totals[2]), "views_search_30": int(totals[3]), "views_maps_30": int(totals[4]), "bookings_30": int(totals[5])},
        "rating_split": {str(n): sum(1 for r in reviews if r.rating == n) for n in (5, 4, 3, 2, 1)},
        "recent_reviews": [{"id": r.id, "author": r.author, "rating": r.rating, "body": r.body, "date": r.review_date.isoformat() if r.review_date else None, "replied": r.reply_status == "posted", "reply": r.reply_text} for r in reviews[:6]],
        "live": live,
    }


@router.post("/{business_id}/maps-refresh")
def maps_refresh(b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Re-read the listing's public state on Google Maps (open or closed, rating, reviews, photos):
    no Google sign-in needed, only the business's Maps listing (place_id)."""
    if not b.place_id:
        raise HTTPException(400, "This business isn't matched to a Google Maps listing yet. Find it by email first.")
    if not discovery.places_enabled():
        raise HTTPException(400, "Google Maps lookup is off: set GOOGLE_PLACES_API_KEY on the backend.")
    discovery._details_cache.pop(b.place_id, None)  # always fresh
    try:
        d = discovery.place_details(b.place_id)
    except discovery.DiscoveryError as exc:
        raise HTTPException(502, str(exc)) from exc
    status = discovery.public_status(d)
    b.rating, b.review_count = status["rating"] or b.rating, status["review_count"] or b.review_count
    b.photo_count = status["photos"] or b.photo_count
    if not b.gbp_location:
        b.gbp_status = status
    log(db, user.name, "maps_refreshed", b.id, open_status=status["open_status"])
    db.commit()
    return status


@router.post("/{business_id}/sync")
def sync(b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    try:
        out = gbp.sync_business(db, b)
    except gbp.GbpError as exc:
        raise HTTPException(400, str(exc)) from exc
    log(db, user.name, "gbp_synced", b.id, **out)
    db.commit()
    return out


# Audits
def _run_audits(db: Session, business_id: int, kinds: list[str] | None, plan: bool) -> None:
    b = db.get(Business, business_id)
    if not b:
        return
    found = audits.run_all(db, b, kinds)
    if plan:
        agent.plan_from_audits(db, b, [i for a in found if a.status == "done" for i in a.issues], audited=[a.kind for a in found if a.status == "done"])


@router.post("/{business_id}/audits", status_code=202)
def run_audits(body: AuditRunIn, tasks: BackgroundTasks, b: Business = Depends(get_business), user: User = Depends(current_user), db: Session = Depends(get_db)):
    log(db, user.name, "audit_started", b.id, kinds=body.kinds or audits.KINDS)
    db.commit()
    tasks.add_task(in_background(_run_audits, b.id, body.kinds, True))
    return {"queued": body.kinds or audits.KINDS}


@router.get("/{business_id}/audits")
def list_audits(kind: str | None = None, limit: int = 30, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    q = select(Audit).where(Audit.business_id == b.id)
    if kind:
        q = q.where(Audit.kind == kind)
    return rows(db.scalars(q.order_by(Audit.created_at.desc()).limit(min(limit, 200))), exclude={"result"})


@router.get("/{business_id}/audits/{audit_id}")
def get_audit(audit_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    a = db.get(Audit, audit_id)
    if not a or a.business_id != b.id:
        raise HTTPException(404, "Audit not found")
    return row(a)


# Schedules
@router.get("/{business_id}/schedules")
def get_schedules(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    found = list(db.scalars(select(Schedule).where(Schedule.business_id == b.id)))
    return rows(found or schedules.create_for_plan(db, b))


@router.put("/{business_id}/schedules")
def set_schedule(body: ScheduleIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    s = db.scalar(select(Schedule).where(Schedule.business_id == b.id, Schedule.job == body.job)) or Schedule(business_id=b.id, job=body.job)
    s.every, s.next_run_at = body.every, schedules.next_run(body.every)
    db.add(s)
    log(db, user.name, "schedule_changed", b.id, job=body.job, every=body.every)
    db.commit()
    return row(s)


# Reports
@router.get("/{business_id}/report")
def report(month: str | None = None, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return reports.monthly_summary(db, b, month)


@router.get("/{business_id}/report.pdf")
def report_pdf(month: str | None = None, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    s = reports.monthly_summary(db, b, month)
    return Response(reports.pdf(s), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{b.name}-{s["month"]}.pdf"'})
