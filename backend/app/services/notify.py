"""Email notifications over SMTP (optional: does nothing when SMTP is not configured)."""
import logging
import smtplib
import time
from email.message import EmailMessage

from sqlalchemy.orm import Session

from ..config import get_settings

log = logging.getLogger("seo.notify")


def send_email(to: str, subject: str, body: str, attachments: list[tuple[str, bytes, str]] | None = None, html: str | None = None) -> bool:
    """Plain text always; `html` adds a formatted version (the caller escapes everything it puts in it)."""
    s = get_settings()
    if not (s.smtp_host and s.smtp_from and to):
        return False
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = s.smtp_from, to, subject
    msg.set_content(body)
    if html:
        msg.add_alternative(html, subtype="html")
    for name, data, mime in attachments or []:
        main, sub = mime.split("/", 1)
        msg.add_attachment(data, maintype=main, subtype=sub, filename=name)
    for attempt in (1, 2):  # Gmail sometimes drops a fresh connection: one retry is enough, a second failure is real
        try:
            with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=30) as smtp:
                smtp.starttls()
                if s.smtp_user:
                    smtp.login(s.smtp_user, s.smtp_password)
                smtp.send_message(msg)
            return True
        except (smtplib.SMTPServerDisconnected, smtplib.SMTPConnectError, TimeoutError, ConnectionError):
            if attempt == 2:
                raise
            time.sleep(2)
    return True


REVIEWS_LINK = "/gmb-profile?tab=reviews"
BULK = 5  # more than this many reviews arriving at once for a project with none stored is an import, not news


def _recipient(db: Session, b) -> str | None:
    """Who is emailed about the project: its contact email, else its owner's sign-in email."""
    if (b.contact_email or "").strip():
        return b.contact_email.strip()
    from ..models import AppUser
    try:
        owner = db.get(AppUser, int(b.owner_id)) if b.owner_id else None
    except (TypeError, ValueError):
        owner = None
    return owner.email if owner else None


def new_reviews(db: Session, b, fresh: list, had_none: bool) -> list:
    """One notification per new Google review (a summary instead when a project's first sync brings in many), then at most one email.
    Never raises: a notification problem must not break a sync. The caller commits."""
    from ..models import Notification
    made: list[Notification] = []
    try:
        if not fresh:
            return made
        if had_none and len(fresh) > BULK:
            made.append(Notification(business_id=b.id, owner_id=b.owner_id, kind="new_review", title=f"{len(fresh)} reviews imported from Google",
                                     body=f"The reviews already on {b.name}'s Google profile are now in the system.", link=REVIEWS_LINK))
        else:
            for r in fresh:
                n = int(r.rating or 0)
                made.append(Notification(business_id=b.id, owner_id=b.owner_id, kind="low_rating_review" if n <= 2 else "new_review",
                                         title=f"New {n}-star review" + (f" from {r.author}" if r.author else ""), body=(r.body or "")[:160] or None,
                                         link=REVIEWS_LINK, rating=n, review_id=r.id))
        db.add_all(made)
        db.flush()
        _email_once(db, b, made, fresh)
    except Exception:  # noqa: BLE001 - see the docstring
        log.exception("Could not create review notifications for project %s", getattr(b, "id", "?"))
    return made


def _email_once(db: Session, b, made: list, fresh: list) -> None:
    s = get_settings()
    if not (s.smtp_host and s.smtp_from) or not made:
        return
    to = _recipient(db, b)
    if not to:
        return
    first = fresh[0] if len(fresh) == 1 else None
    n = int(first.rating or 0) if first else 0
    subject = f"New {n}-star review for {b.name}" if first else f"{len(fresh)} new reviews for {b.name}"
    lines = [made[0].title + ".", ""]
    if first and first.body:
        lines += [f"\"{first.body[:400]}\"", ""]
    lines += ["Open Reviews & Reputation to read it and reply:", f"{s.frontend_url.rstrip('/')}{REVIEWS_LINK}"]
    try:
        if send_email(to, subject, chr(10).join(lines)):
            for x in made:
                x.emailed = True
    except Exception:  # noqa: BLE001 - SMTP down or refused: the in-app notification stays
        log.warning("Review email to %s was not sent", to, exc_info=True)
