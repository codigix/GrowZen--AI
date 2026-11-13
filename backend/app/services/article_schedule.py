"""Articles scheduled inside GrowZen: Draft -> Scheduled -> Publishing -> Published / Failed.

A completed article that is not on a website is a Draft (it lives only in GrowZen). Scheduling stores ONE row in
`scheduled_posts` (the time, in UTC, and the destination: a SiteIntegration method such as "wordpress", or "react").
The backend scheduler publishes due rows through services/article_publishing.py (the same code as the Publish
buttons), so nothing depends on a browser being open, and the rows survive a restart.

No duplicates: a row is claimed with a conditional UPDATE (pending -> publishing) before anything is sent, so two
scheduler runs can never publish it twice; and publishing an article that is already on the website updates that post
(its stored post id) instead of creating another one. Rescheduling moves the same row.
"""
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Article, Business, ScheduledPost
from . import article_publishing as ap, featured_images as fi, react_site as rs, site_publish as sp

log = logging.getLogger("seo.schedule")

RETRIES = 3  # tries before a scheduled post is marked failed
RETRY_AFTER = timedelta(minutes=10)
STUCK_AFTER = timedelta(minutes=15)  # a row left "publishing" this long was interrupted (server stopped mid-publish)
ACTIVE = ("pending", "publishing", "failed")
DEFAULT_TZ = "Asia/Kolkata"


class ScheduleError(Exception):
    def __init__(self, message: str, code: int = 409):
        super().__init__(message)
        self.code = code


class _Gone(Exception):
    """The destination or the article is gone: retrying cannot help."""


def tz_name() -> str:
    name = (get_settings().publish_timezone or "").strip() or DEFAULT_TZ
    try:
        ZoneInfo(name)
        return name
    except (ZoneInfoNotFoundError, ValueError):
        return DEFAULT_TZ


def _tz() -> ZoneInfo:
    return ZoneInfo(tz_name())


def _utc(d: datetime | None) -> datetime | None:
    return d if d is None or d.tzinfo else d.replace(tzinfo=timezone.utc)


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── what the page shows ─────────────────────────────────────────────────────────

def latest_by_article(db: Session, business_id: int, article_id: int | None = None) -> dict[int, ScheduledPost]:
    """Each article's most recent schedule row."""
    q = select(ScheduledPost).where(ScheduledPost.business_id == business_id)
    if article_id is not None:
        q = q.where(ScheduledPost.article_id == article_id)
    out: dict[int, ScheduledPost] = {}
    for p in db.scalars(q.order_by(ScheduledPost.id)):
        out[p.article_id] = p  # the last one wins
    return out


def _schedule_view(p: ScheduledPost) -> dict:
    due = _utc(p.due_at)
    local = due.astimezone(_tz())
    return {"id": p.id, "destination": p.method, "status": p.status, "due_at": due.isoformat(), "date": local.strftime("%Y-%m-%d"),
            "time": local.strftime("%H:%M"), "timezone": tz_name(), "attempts": p.attempts, "error": p.error,
            "url": (p.result or {}).get("url"), "post_id": (p.result or {}).get("id"), "direct": bool((p.result or {}).get("direct")),
            "finished_at": _utc(p.finished_at).isoformat() if p.finished_at else None}


def state_of(a: Article, p: ScheduledPost | None) -> dict:
    """The article's publishing status for the list and the calendar: draft | scheduled | publishing | published | failed
    (None while it is still being written), plus its schedule."""
    if p and p.status == "pending":
        status = "scheduled"
    elif p and p.status == "publishing":
        status = "publishing"
    elif p and p.status == "failed":
        status = "failed"
    elif a.wp_status == "publish" or a.react_status == "publish" or (p and p.status == "published"):
        status = "published"
    elif a.status == "completed":
        status = "draft"
    else:
        status = None
    show = p if p and p.status in (*ACTIVE, "published") else None
    return {"publishing_status": status, "schedule": _schedule_view(show) if show else None}


def calendar(db: Session, b: Business, month: str | None) -> dict:
    """Every article scheduled in GrowZen in one month (YYYY-MM, in the publishing time zone) and its status."""
    zone = _tz()
    if month:
        try:
            start = datetime.strptime(month, "%Y-%m").replace(tzinfo=zone)
        except ValueError:
            raise ValueError("month must look like 2026-11") from None
    else:
        start = _now().astimezone(zone).replace(day=1, hour=0, minute=0, second=0, microsecond=0, tzinfo=zone)
    end = (start + timedelta(days=32)).replace(day=1)
    q = (select(ScheduledPost).where(ScheduledPost.business_id == b.id, ScheduledPost.status.in_((*ACTIVE, "published")),
                                     ScheduledPost.due_at >= start.astimezone(timezone.utc), ScheduledPost.due_at < end.astimezone(timezone.utc))
         .order_by(ScheduledPost.due_at))
    entries = []
    for p in db.scalars(q):
        a = db.get(Article, p.article_id)
        if not a:
            continue
        v = _schedule_view(p)
        entries.append({**v, "article_id": a.id, "title": a.title or a.keyword,
                        "publishing_status": {"pending": "scheduled"}.get(p.status, p.status)})
    return {"month": start.strftime("%Y-%m"), "timezone": tz_name(), "entries": entries}


# ── schedule / cancel / retry ───────────────────────────────────────────────────

def _check_destination(db: Session, b: Business, destination: str) -> None:
    ids = [d["id"] for d in ap.destinations(db, b)]
    if destination not in ids:
        raise ScheduleError(f"'{destination}' is not a connected publishing destination of this account"
                            + (f" (connected: {', '.join(ids)})." if ids else ". Connect a website first (Publish & Schedule)."))


def schedule(db: Session, b: Business, a: Article, date: str, time: str, destination: str) -> ScheduledPost:
    if a.status != "completed":
        raise ScheduleError("Only a completed article can be scheduled.")
    try:
        due = datetime.strptime(f"{date} {time}", "%Y-%m-%d %H:%M").replace(tzinfo=_tz()).astimezone(timezone.utc)
    except ValueError:
        raise ScheduleError("Enter a valid date and time.", 422) from None
    if due <= _now():
        raise ScheduleError(f"Pick a date and time in the future ({tz_name()} time).", 422)
    if get_settings().blog_featured_image_required and not fi.path_of(a.featured_image_path):
        raise ScheduleError("Add a featured image before scheduling (Featured image section, above the article body).", 422)
    _check_destination(db, b, destination)
    current = latest_by_article(db, b.id, a.id).get(a.id)
    if current and current.status == "publishing":
        raise ScheduleError("This article is being published right now. Try again in a minute.")
    if current and current.status in ("pending", "failed"):
        p = current  # reschedule: the same row moves (never a second schedule for one article)
    else:
        p = ScheduledPost(business_id=b.id, article_id=a.id)
        db.add(p)
    p.method, p.due_at, p.status, p.attempts, p.error, p.finished_at = destination, due, "pending", 0, None, None
    try:
        from . import blog_flow
        blog_flow.schedule_task(db, b, a, due)  # a task on that day; a failure here never blocks the schedule
    except Exception:  # noqa: BLE001
        log.exception("Could not add the publish-day task for article %s", a.id)
    db.commit()
    return p


def cancel(db: Session, a: Article) -> ScheduledPost:
    p = latest_by_article(db, a.business_id, a.id).get(a.id)
    if not p or p.status not in ("pending", "failed"):
        raise ScheduleError("This article is being published right now." if p and p.status == "publishing" else "This article is not scheduled.")
    p.status, p.finished_at = "cancelled", _now()
    try:
        from . import blog_flow
        blog_flow.cancel_task(db, db.get(Business, a.business_id), a)
    except Exception:  # noqa: BLE001
        log.exception("Could not close the publish-day task for article %s", a.id)
    db.commit()
    return p


def retry(db: Session, b: Business, a: Article) -> ScheduledPost:
    """Publish a failed scheduled article again, now (same row, same destination)."""
    p = latest_by_article(db, b.id, a.id).get(a.id)
    if not p or p.status != "failed":
        raise ScheduleError("Only a failed scheduled article can be retried.")
    _check_destination(db, b, p.method)
    p.status, p.attempts, p.error, p.due_at, p.finished_at = "pending", 0, None, _now(), None
    db.commit()
    if _claim(db, p.id):
        _run_one(db, p, _now())
    db.refresh(p)
    return p


# ── the scheduler ───────────────────────────────────────────────────────────────

def _claim(db: Session, pid: int) -> bool:
    """pending -> publishing in one statement: only one runner can win it."""
    r = db.execute(update(ScheduledPost).where(ScheduledPost.id == pid, ScheduledPost.status == "pending")
                   .values(status="publishing", updated_at=_now()))
    db.commit()
    return r.rowcount == 1


def recover_stuck(db: Session, now: datetime) -> int:
    """A row left 'publishing' (the server stopped mid-publish) is marked failed, not retried blindly: the post may
    already be on the website, so a person checks and clicks Retry (which updates that post if it is there)."""
    n = 0
    for p in db.scalars(select(ScheduledPost).where(ScheduledPost.status == "publishing", ScheduledPost.updated_at < now - STUCK_AFTER)):
        p.status, p.finished_at = "failed", now
        p.error = "Publishing was interrupted (the server stopped). Check the website, then click Retry."
        n += 1
    if n:
        db.commit()
    return n


def _run_one(db: Session, p: ScheduledPost, now: datetime) -> int:
    from .activity import log as activity
    a = db.get(Article, p.article_id)
    b = db.get(Business, p.business_id)
    try:
        if a is None or b is None:
            raise _Gone("The article was deleted.")
        if p.method == ap.REACT:
            conn = ap.react_target(db, b)
            if not conn:
                raise _Gone("The React.js website is no longer connected.")
            out = ap.publish_react(db, a, conn, "publish", None, record=False)  # this row is the record
        elif p.method == ap.HTML:
            from . import html_publisher as hp  # noqa: PLC0415
            if not ap.html_target(db, b):
                raise _Gone("The HTML website is no longer connected for publishing (its test deployment must pass).")
            out = hp.publish_sync(b.id, a.id, record=False)  # uploads, then verifies the live site; raises when not live
        else:
            row = ap.site_target(db, b)
            if row is None or row.method != p.method:
                raise _Gone("The website is no longer connected, or the article was deleted.")
            if row.method == "wordpress":
                out = ap.publish_site(db, b, a, row, "publish", None, record=False)  # featured image, post, permalink in the schema
            else:  # GitHub and the others: one publish, as before
                out = sp.publish(row, a, "publish", None)
                a.wp_post_id, a.wp_url = out["id"] or None, out["url"] or None
                a.wp_status, a.publish_method, a.wp_deleted_at = out.get("status") or "publish", row.method, None
        p.status, p.error, p.finished_at = "published", None, now
        p.result = {"id": out.get("id"), "url": out.get("url"), "status": out.get("status"), "steps": out.get("steps"), "published_at": now.isoformat()}
        activity(db, "scheduler", "post_published", p.business_id, article_id=p.article_id, url=out.get("url"), destination=p.method)
        db.commit()
        from . import blog_flow
        blog_flow.after_published(db, b, a)
        return 1
    except _Gone as exc:
        db.rollback()
        p.attempts += 1
        p.status, p.error, p.finished_at = "failed", str(exc), now
    except Exception as exc:  # noqa: BLE001 - publish errors are retried; a row must never stay "publishing"
        db.rollback()
        if not isinstance(exc, (sp.PublishError, rs.ReactSiteError)) and type(exc).__name__ not in ("PublishError", "DeployError"):
            log.exception("Scheduled post %s failed unexpectedly", p.id)
        p.attempts += 1
        p.error = str(exc)[:500] or exc.__class__.__name__
        if p.attempts >= RETRIES or isinstance(exc, rs.AuthFailed):
            p.status, p.finished_at = "failed", now
        else:
            p.status, p.due_at = "pending", now + RETRY_AFTER  # tried again in ten minutes
    if p.status == "failed":
        activity(db, "scheduler", "post_publish_failed", p.business_id, article_id=p.article_id, error=(p.error or "")[:200])
    db.commit()
    return 0


def run_due(db: Session, now: datetime | None = None, limit: int = 20) -> int:
    """Publish every scheduled article whose time has come. Returns how many were published."""
    now = now or _now()
    recover_stuck(db, now)
    ids = list(db.scalars(select(ScheduledPost.id).where(ScheduledPost.status == "pending", ScheduledPost.due_at <= now)
                          .order_by(ScheduledPost.due_at).limit(limit)))
    done = 0
    for pid in ids:
        if _claim(db, pid):
            done += _run_one(db, db.get(ScheduledPost, pid), now)
    return done
