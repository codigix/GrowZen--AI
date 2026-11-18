"""Pitching a website for a backlink: find the public contact addresses of the site, send the owner's reviewed email, and remember what was sent.

Nothing is guessed or invented: contact addresses are only those the site itself publishes (mailto links and addresses on its contact, about or
write-for-us pages). Sending happens only when the owner presses Send on a message they could edit, never automatically."""
from __future__ import annotations

import html as htmllib
import logging
import re
from datetime import timezone
from urllib.parse import urljoin

import httpx
from sqlalchemy.orm import Session

from ..db import utcnow
from ..models import Business
from ..services import notify
from ..services.url_safety import SSRFSafeTransport, SSRFValidationError
from .models import BiOpportunity
from .playbook import DOMAIN, _row, set_status

log = logging.getLogger("seo.backlinks.pitch")
EMAIL = re.compile(r"[a-z0-9._%+-]{1,64}@(?:[a-z0-9-]{1,63}\.)+[a-z]{2,24}", re.I)
PATHS = ("/", "/contact", "/contact-us", "/contact.html", "/about", "/about-us", "/write-for-us", "/guest-post", "/advertise", "/submit")
JUNK = ("example.", "sentry", "wixpress", "domain.com", "email.com", "yourname", "name@", "user@", ".png", ".jpg", ".gif", ".webp", ".svg", ".js", ".css")
ROLE_RANK = {"editor": 0, "editorial": 0, "partnerships": 1, "press": 1, "contact": 1, "info": 2, "hello": 2, "advertise": 2, "admin": 3, "webmaster": 3, "team": 3, "support": 4}


def _clean(addr: str) -> str | None:
    a = (addr or "").strip().strip(".,;:()<>[]'\" ").lower()
    if any(j in a for j in JUNK) or not EMAIL.fullmatch(a):
        return None
    return a


def _aware(dt):
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def find_contacts(domain: str) -> dict:
    """The public contact addresses of a site, best first, each with the page it was found on."""
    domain = domain.lower().strip().removeprefix("www.")
    if not DOMAIN.match(domain):
        raise ValueError("That is not a website address")
    found: dict[str, dict] = {}
    pages_read = 0
    try:
        with httpx.Client(transport=SSRFSafeTransport(retries=0), timeout=10, follow_redirects=True,
                          headers={"User-Agent": "Mozilla/5.0 (compatible; GrowZenContactFinder/1.0)", "Accept": "text/html"}) as c:
            for path in PATHS:
                try:
                    r = c.get(urljoin(f"https://{domain}", path))
                except (httpx.HTTPError, SSRFValidationError):
                    if path == "/":
                        break  # the site itself does not answer
                    continue
                if r.status_code != 200 or "html" not in r.headers.get("content-type", "") or len(r.content) > 1_500_000:
                    continue
                pages_read += 1
                text = htmllib.unescape(r.text)
                for m in re.finditer(r"mailto:([^\"'?>\s]+)", text, re.I):
                    a = _clean(m.group(1))
                    if a:
                        found.setdefault(a, {"email": a, "page": str(r.url), "how": "mailto link"})
                for m in EMAIL.finditer(re.sub(r"<[^>]+>", " ", text)):
                    a = _clean(m.group(0))
                    if a:
                        found.setdefault(a, {"email": a, "page": str(r.url), "how": "written on the page"})
                if len(found) >= 8:
                    break
    except (httpx.HTTPError, SSRFValidationError) as exc:
        log.info("contact search failed for %s: %s", domain, exc.__class__.__name__)

    def rank(x: dict) -> tuple:
        local, host = x["email"].split("@", 1)
        return (0 if host.removeprefix("www.").endswith(domain) else 1, ROLE_RANK.get(local, 5), 0 if x["how"] == "mailto link" else 1)

    items = sorted(found.values(), key=rank)[:8]
    return {"domain": domain, "contacts": items, "pages_read": pages_read,
            "note": "" if items else "No public email address was found on the site. Open its contact page or look for a contact form: many sites only have a form."}


def send(db: Session, b: Business, domain: str, to: str, subject: str, body: str, name: str | None = None, source: str = "competitor") -> BiOpportunity:
    """Send the reviewed message, then record who it went to and when, and mark the place as contacted."""
    domain = domain.lower().strip().removeprefix("www.")
    to_clean = _clean(to)
    if not to_clean:
        raise ValueError("That is not an email address")
    subject, body = (subject or "").strip(), (body or "").strip()
    if not subject or len(body) < 30:
        raise ValueError("Write a subject and a message first")
    if "[add" in body.lower() or "[add" in subject.lower():
        raise ValueError("The message still has [add ...] parts to fill in")
    row = _row(db, b, domain)
    if row and row.emailed_at and row.contact_email == to_clean and (utcnow() - _aware(row.emailed_at)).total_seconds() < 60:
        raise ValueError("This was just sent to the same address")
    try:
        ok = notify.send_email(to_clean, subject[:200], body, reply_to=(b.contact_email or "").strip() or None)
    except Exception as exc:  # smtplib raises many kinds
        log.warning("pitch email failed: %s", exc.__class__.__name__)
        raise ValueError("The email could not be sent. Check the mail settings (SMTP) and try again.") from exc
    if not ok:
        raise ValueError("Email sending is not set up: add SMTP_HOST, SMTP_USER, SMTP_PASSWORD and SMTP_FROM to the backend settings.")
    row = set_status(db, b, domain, "contacted", None, source, name)
    row.contact_email, row.email_subject, row.emailed_at, row.email_count, row.replied_at = to_clean, subject[:200], utcnow(), (row.email_count or 0) + 1, None
    db.commit()
    return row


def mark_replied(db: Session, b: Business, domain: str, replied: bool = True) -> BiOpportunity:
    row = _row(db, b, domain.lower().strip().removeprefix("www."))
    if not row:
        raise ValueError("This place is not in your plan yet")
    row.replied_at = utcnow() if replied else None
    db.commit()
    return row
