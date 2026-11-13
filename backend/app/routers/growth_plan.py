"""Growth Plan API: daily, weekly and monthly targets and tasks that raise a business's online presence, with every task checked against live data.

GET  /businesses/{id}/growth                     the whole plan (stored rows, no network)
POST /businesses/{id}/growth/refresh             measure live, then make sure the current day/week/month exist  (6 per user per hour)
POST /businesses/{id}/growth/actions/{aid}/done  {note?}   a person says it is done: it is NOT verified until the live check passes
POST /businesses/{id}/growth/actions/{aid}/skip  {reason}  at least 5 characters
POST /businesses/{id}/growth/actions/{aid}/verify          re-check against live data  (30 per user per hour)
GET  /growth/overview                            every project the user may see
"""
from typing import Any

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import get_business, my_business_ids
from ..models import Business, GrowthAction, GrowthReport
from ..services import localtime
from ..services import growth_content, growth_drafts, growth_solutions, growth_issues, growth_report, growth_start
from ..services import growth_plan as plan
from ..services.activity import log

router = APIRouter(prefix="/businesses/{business_id}/growth", tags=["growth-plan"])
overview_router = APIRouter(prefix="/growth", tags=["growth-plan"])

_refresh_limit = plan.RateLimit(6, name="growth_refresh")
_verify_limit = plan.RateLimit(30, name="growth_verify")
_scan_limit = plan.RateLimit(6, name="growth_scan")
_start_limit = plan.RateLimit(4, name="growth_start")
_send_limit = plan.RateLimit(6, name="growth_send")
_draft_limit = plan.RateLimit(20, name="growth_draft")
_solution_limit = plan.RateLimit(40, name="growth_solution")


def _action(db: Session, b: Business, action_id: int) -> GrowthAction:
    a = db.get(GrowthAction, action_id)
    if not a or a.business_id != b.id:  # another project's task is "not found", never "forbidden"
        raise HTTPException(404, "Task not found")
    return a


@router.get("")
def get_plan(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return plan.payload(db, b)


@router.post("/refresh")
def refresh(b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    if not _refresh_limit.hit(user.id):
        raise HTTPException(429, "Too many refreshes: each one measures the website and the Google profile live. Try again in a few minutes.")
    out = plan.refresh(db, b, user.name, live=True)
    log(db, user.name, "growth_refreshed", b.id)
    db.commit()
    return out


class DoneIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class SkipIn(BaseModel):
    reason: str = Field(min_length=5, max_length=500)


@router.post("/actions/{action_id}/done")
def done(action_id: int, body: DoneIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    a = _action(db, b, action_id)
    try:
        plan.mark_done(db, b, a, user.name, body.note)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    log(db, user.name, "growth_action_done", b.id, key=a.key)
    db.commit()
    return {"action": plan._action_out(a)}


@router.post("/actions/{action_id}/skip")
def skip(action_id: int, body: SkipIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    a = _action(db, b, action_id)
    try:
        plan.skip_action(db, b, a, body.reason, user.name)
    except ValueError as exc:
        raise HTTPException(409 if "verified" in str(exc) else 422, str(exc)) from exc
    log(db, user.name, "growth_action_skipped", b.id, key=a.key)
    db.commit()
    return {"action": plan._action_out(a)}


@router.post("/actions/{action_id}/verify")
def verify(action_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    a = _action(db, b, action_id)
    if a.status == "blocked":
        raise HTTPException(409, "This task is blocked: do the unblocking step first.")
    if not _verify_limit.hit(user.id):
        raise HTTPException(429, "Too many checks: each one reads live data. Try again in a few minutes.")
    result = plan.verify_action(db, b, a, live=True)
    log(db, user.name, "growth_action_verified", b.id, key=a.key, passed=result.get("passed"))
    db.commit()
    return {"action": plan._action_out(a), "result": result}


# ---- the issue sweep and its fix tasks
@router.get("/issues")
def get_issues(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return growth_issues.listing(db, b)


@router.post("/issues/scan")
def scan_issues(b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Look for every issue now (reads the website live) and make a fix task for each new one."""
    if not _scan_limit.hit(user.id):
        raise HTTPException(429, "Too many scans: each one reads the website live. Try again in a few minutes.")
    res = growth_issues.sweep(db, b, live=True)
    if res["new_critical"]:
        growth_report.alert_critical(db, b, res["new_critical"])
    log(db, user.name, "growth_issues_scanned", b.id, found=res["found"], created=res["created"])
    db.commit()
    return {"scan": res, **growth_issues.listing(db, b)}


@router.get("/content-plan")
def content_plan(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Every keyword topic against the website, profile, services, posts and blog: where it is used and where it is still missing."""
    return growth_content.content_plan(db, b)


# ---- start the plan
@router.post("/start")
def start(b: Business = Depends(get_business), user: User = Depends(current_user)):
    if not _start_limit.hit(user.id):
        raise HTTPException(429, "The plan was started several times already. Wait a while: each start runs real audits and checks.")
    if not growth_start.start_background(b.id, user.name):
        raise HTTPException(409, "The plan is already starting for this project.")
    return growth_start.status(b.id)


@router.get("/start/status")
def start_status(b: Business = Depends(get_business)):
    return growth_start.status(b.id)


# ---- reports and notification settings
class ReportIn(BaseModel):
    period: Literal["week", "month"]
    current: bool = False  # the period so far, instead of the last full one


@router.get("/reports")
def get_reports(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return {"reports": [growth_report.out(r, full=False) for r in growth_report.listing(db, b)], "settings": growth_report.public_prefs(db, b)}


def _report(db: Session, b: Business, report_id: int) -> GrowthReport:
    r = db.get(GrowthReport, report_id)
    if not r or r.business_id != b.id:
        raise HTTPException(404, "Report not found")
    return r


@router.post("/reports/generate")
def make_report(body: ReportIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    start_ = growth_report.current_window(body.period, localtime.today(b))[0] if body.current else None
    r = growth_report.generate(db, b, body.period, start_)
    log(db, user.name, "growth_report_generated", b.id, period=body.period)
    db.commit()
    return growth_report.out(r)


@router.get("/reports/{report_id}")
def read_report(report_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return growth_report.out(_report(db, b, report_id))


@router.get("/reports/{report_id}/html")
def report_html(report_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """The report as a page that prints well (everything in it is escaped)."""
    r = _report(db, b, report_id)
    return HTMLResponse(f"<!doctype html><meta charset=utf-8><title>Growth report</title><body style='margin:0;background:#fff'>{growth_report.render_html(r.data or {})}</body>",
                        headers={"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"})


@router.get("/reports/{report_id}/pdf")
def report_pdf(report_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    r = _report(db, b, report_id)
    name = f"growth-report-{r.period}-{r.period_start.isoformat()}.pdf"
    return Response(growth_report.render_pdf(r.data or {}), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}"', "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"})


@router.post("/reports/{report_id}/send")
def send_report(report_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    r = _report(db, b, report_id)
    if not _send_limit.hit(user.id):
        raise HTTPException(429, "Too many emails: try again later.")
    res = growth_report.send(db, b, r, force=True, interactive=True)
    log(db, user.name, "growth_report_sent", b.id, sent=res["sent"])
    db.commit()
    return {**res, "report": growth_report.out(r, full=False)}


class NotifyIn(BaseModel):
    email: bool | None = None
    weekly: bool | None = None
    monthly: bool | None = None
    alerts: bool | None = None
    to: str | None = Field(default=None, max_length=254)


@router.get("/notifications")
def get_notify(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return growth_report.public_prefs(db, b)


@router.put("/notifications")
def put_notify(body: NotifyIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    try:
        out = growth_report.save_prefs(db, b, body.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    log(db, user.name, "growth_notify_updated", b.id)
    db.commit()
    return out


@router.post("/actions/{action_id}/draft")
def write_draft(action_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Write an AI draft (title and description, profile text, a post or a blog plan) for a fix task, to be read and approved by a person."""
    a = _action(db, b, action_id)
    if not _draft_limit.hit(user.id):
        raise HTTPException(429, "Too many drafts: each one uses the AI service. Try again in a while.")
    try:
        d = growth_drafts.save(db, b, a)
    except growth_drafts.DraftError as exc:
        raise HTTPException(409, str(exc)) from exc
    log(db, user.name, "growth_draft_written", b.id, key=a.key)
    db.commit()
    return {"draft": d}


@router.get("/actions/{action_id}")
def get_action(action_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """One task with everything its fix page needs (the saved solution, if any)."""
    a = _action(db, b, action_id)
    ev = a.evidence or {}
    return {"action": plan._action_out(a), "severity": ev.get("severity"), "source": growth_issues.SOURCE_LABEL.get(ev.get("source"), ev.get("source")), "closes_when": growth_issues.closes_when(a.verify or {}),
            "solution": ev.get("solution"), "draft": ev.get("draft"), "website_side": growth_solutions.is_website_side(a)}


@router.post("/actions/{action_id}/solution")
def make_solution(action_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Work out the exact solution for this task (code or text for this site, where to put it, how to confirm). Uses AI only for wording."""
    a = _action(db, b, action_id)
    if not _solution_limit.hit(user.id):
        raise HTTPException(429, "Too many solutions requested: wait a few minutes.")
    try:
        sol = growth_solutions.save(db, b, a)
    except growth_solutions.SolutionError as exc:
        raise HTTPException(409, str(exc)) from exc
    log(db, user.name, "growth_solution_built", b.id, key=a.key)
    db.commit()
    return {"solution": sol}


@router.get("/handoff")
def handoff(b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """One brief for the person who edits the website: every open website-side fix with its exact code."""
    if not _solution_limit.hit(user.id):
        raise HTTPException(429, "Too many requests: wait a few minutes.")
    out = growth_solutions.handoff(db, b)
    db.commit()
    return out


@router.post("/actions/{action_id}/draft/apply")
def apply_draft(action_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Save a post draft as a draft post in Google Posts. It is not published."""
    a = _action(db, b, action_id)
    try:
        post = growth_drafts.apply_post(db, b, a)
    except growth_drafts.DraftError as exc:
        raise HTTPException(409, str(exc)) from exc
    log(db, user.name, "growth_draft_saved_as_post", b.id, post_id=post.id)
    db.commit()
    return {"post_id": post.id, "draft": (a.evidence or {}).get("draft")}


@overview_router.get("/overview")
def overview(db: Session = Depends(get_db), user: User = Depends(current_user)) -> list[dict[str, Any]]:
    ids = my_business_ids(db, user)
    q = select(Business).order_by(Business.name)
    if ids is not None:
        q = q.where(Business.id.in_(ids))
    return [plan.overview_row(db, b) for b in db.scalars(q)]
