"""Telling the person when Google shows the changes they made.

A profile edit sent to Google is reviewed before it goes live on Search and Maps (minutes to a few days). While that review runs the Business Information API already returns the new
values, so the only reliable signal is Google's own flag on the profile: metadata.hasPendingEdits. When an edit reaches Google, `record` keeps what was sent on the project
(google_watch); the scheduler calls `run_due`, which asks Google now and then, and when the flag is gone the person gets a notification (bell) and an email."""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Business, Notification
from . import gbp

log = logging.getLogger("seo.google_changes")

CHECK_EVERY = timedelta(minutes=10)
GIVE_UP_AFTER = timedelta(days=5)
LINK = "/gmb-profile?tab=profile&sub=edit"

LABELS = {"title": "name", "phoneNumbers": "phone numbers", "websiteUri": "website", "profile": "description", "regularHours": "opening hours", "specialHours": "special hours",
          "serviceItems": "services", "labels": "labels", "openInfo": "opening status", "moreHours": "more hours", "placeActionLinks": "booking or order links",
          "categories": "categories", "storefrontAddress": "address", "serviceArea": "service area"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def describe(fields: list[str]) -> str:
    names = [LABELS.get(f, f) for f in fields]
    return ", ".join(dict.fromkeys(names)) or "your changes"


# What Google calls a field -> the saved fields of the project that hold it. While Google is still reviewing an edit its copy may be the OLD value, so a sync must not write it over what the owner just saved.
HELD = {"phoneNumbers": ("phone", "additional_phones"), "title": ("name",), "websiteUri": ("website",), "profile": ("description",)}


def held_fields(b: Business) -> set[str]:
    """Saved fields a sync must leave alone: an edit to them was sent to Google and is still being reviewed."""
    w = b.google_watch or {}
    if not w or w.get("notified"):
        return set()
    try:
        if _now() - datetime.fromisoformat(w["since"]) > GIVE_UP_AFTER:
            return set()
    except Exception:  # noqa: BLE001
        return set()
    return {f for k in (w.get("fields") or []) for f in HELD.get(k, ())}


def record(b: Business, pushed: list[str], sent: dict | None = None) -> None:
    """An edit just reached Google: start waiting for it to go live. Edits sent while one is already waiting are added to it. `sent` is what was sent, so the result can be compared. The caller commits."""
    if not pushed:
        return
    w = dict(b.google_watch or {})
    fields = sorted({*(w.get("fields") or []), *pushed})
    keep = {**(w.get("sent") or {}), **{k: v for k, v in (sent or {}).items() if k in HELD}}
    b.google_watch = {"since": w.get("since") or _now().isoformat(), "last_sent": _now().isoformat(), "fields": fields, "sent": keep, "last_check": None, "notified": False}


def _live(b: Business, seen: dict | None = None) -> bool | None:
    """True when Google has finished reviewing (nothing pending), False while it is still reviewing, None when Google could not be asked. Google's copy is put in `seen`."""
    try:
        loc = gbp.GbpClient(b.connection).location(b.gbp_location)
    except gbp.GbpError as exc:
        log.warning("Could not ask Google about project %s: %s", b.id, exc)
        return None
    if seen is not None:
        seen.update(loc)
    return not bool((loc.get("metadata") or {}).get("hasPendingEdits"))


def _shown(label: str, loc: dict) -> str:
    key = {"phone": ("phoneNumbers", "primaryPhone"), "website": ("websiteUri", None), "name": ("title", None), "description": ("profile", "description")}.get(label)
    if not key:
        return "something else"
    v = loc.get(key[0])
    v = v.get(key[1]) if key[1] and isinstance(v, dict) else v
    return str(v or "nothing")[:80]


def _notify(db: Session, b: Business, title: str, body: str) -> None:
    db.add(Notification(business_id=b.id, owner_id=b.owner_id, kind="google_changes", title=title, body=body, link=LINK))
    db.flush()
    try:
        from . import notify
        to = notify._recipient(db, b)
        s = get_settings()
        if to and s.smtp_host and s.smtp_from:
            notify.send_email(to, title, f"{body}\n\nOpen the profile: {s.frontend_url.rstrip('/')}{LINK}")
    except Exception:  # noqa: BLE001 - the in-app notification stays whatever happens to the email
        log.warning("Google changes email for project %s was not sent", b.id, exc_info=True)


def check(db: Session, b: Business, force: bool = False) -> str:
    """One check of a project that is waiting: 'live', 'waiting', 'stale' or 'skipped'. Commits."""
    w = dict(b.google_watch or {})
    if not w or w.get("notified") or not (b.connection and b.gbp_location):
        return "skipped"
    last = w.get("last_check")
    if not force and last and _now() - datetime.fromisoformat(last) < CHECK_EVERY:
        return "skipped"
    what = describe(w.get("fields") or [])
    seen: dict = {}
    state = _live(b, seen)
    w["last_check"] = _now().isoformat()
    refused = gbp.unconfirmed(w.get("sent") or {}, seen) if state else []
    if state and refused:  # the review is over and Google does not hold what was sent: say so, and the saved copy goes back to what Google shows
        shown = ", ".join(f"{LABELS.get(k, k)} (Google shows: {_shown(k, seen)})" for k in refused)
        _notify(db, b, f"Google did not keep your change: {b.name}", f"Google finished reviewing, but your edit to {shown} was not accepted. Check that the number or text is valid and belongs to the business, then save it again.")
        w["notified"] = True
        b.google_watch = None
        result = "live"
    elif state:
        _notify(db, b, f"Google now shows your changes: {b.name}", f"Google finished reviewing your edit to {what}. It is live on your Business Profile.")
        w["notified"] = True
        b.google_watch = None
        result = "live"
    elif _now() - datetime.fromisoformat(w["since"]) > GIVE_UP_AFTER:
        _notify(db, b, f"Google has not shown your changes yet: {b.name}", f"Your edit to {what} was sent more than {GIVE_UP_AFTER.days} days ago and Google still lists it as under review. "
                "Open your profile on Google and check for a message about it (Google sometimes asks for proof, or declines an edit).")
        b.google_watch = None
        result = "stale"
    else:
        b.google_watch = w
        result = "waiting"
    db.commit()
    return result


def run_due(db: Session, limit: int = 30) -> int:
    """The scheduler's pass: every project that is waiting for Google and was not asked in the last 10 minutes."""
    n = 0
    for b in db.scalars(select(Business).where(Business.google_watch.is_not(None))).all()[:limit]:
        try:
            if check(db, b) in ("live", "stale"):
                n += 1
        except Exception:  # noqa: BLE001 - one project must not stop the others
            db.rollback()
            log.warning("Google changes check failed for project %s", b.id, exc_info=True)
    return n
