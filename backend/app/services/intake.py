"""Onboarding email intake: read the dedicated mailbox over IMAP (or accept a webhook POST),
keep only emails from the team's addresses, and queue them for the pipeline."""
import email
import imaplib
import re
from email.header import decode_header, make_header
from email.utils import parseaddr

from bs4 import BeautifulSoup
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import IntakeEmail


def sender_allowed(addr: str) -> bool:
    allowed = get_settings().intake_sender_list
    a = addr.lower().strip()
    return not allowed or any(a == x or a.endswith("@" + x) or a.endswith("." + x) for x in allowed)


def _text_of(msg: email.message.Message) -> str:
    plain, html = [], []
    for part in msg.walk() if msg.is_multipart() else [msg]:
        if part.get_content_maintype() == "multipart" or part.get("Content-Disposition", "").startswith("attachment"):
            continue
        payload = part.get_payload(decode=True) or b""
        text = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
        (plain if part.get_content_type() == "text/plain" else html if part.get_content_type() == "text/html" else []).append(text)
    if plain:
        return "\n".join(plain).strip()
    return BeautifulSoup("\n".join(html), "html.parser").get_text("\n", strip=True)


def store(db: Session, from_addr: str, subject: str, body: str, message_id: str) -> IntakeEmail | None:
    """Queue one email (deduplicated by Message-ID). Returns None if it was already stored."""
    if db.scalar(select(IntakeEmail).where(IntakeEmail.message_id == message_id)):
        return None
    row = IntakeEmail(message_id=message_id, from_addr=from_addr, subject=subject[:500], body=body[:50000],
                      status="waiting" if sender_allowed(from_addr) else "rejected",
                      error=None if sender_allowed(from_addr) else "Sender is not on the allowed list")
    db.add(row)
    db.commit()
    return row


def poll_imap(db: Session, limit: int = 25) -> list[IntakeEmail]:
    s = get_settings()
    if not s.imap_enabled:
        return []
    new: list[IntakeEmail] = []
    with imaplib.IMAP4_SSL(s.intake_imap_host, s.intake_imap_port) as m:
        m.login(s.intake_imap_user, s.intake_imap_password)
        m.select(s.intake_imap_folder)
        _, data = m.search(None, "UNSEEN")
        for num in (data[0].split() if data and data[0] else [])[:limit]:
            _, parts = m.fetch(num, "(RFC822)")
            raw = parts[0][1] if parts and isinstance(parts[0], tuple) else None
            if not raw:
                continue
            msg = email.message_from_bytes(raw)
            subject = str(make_header(decode_header(msg.get("Subject", ""))))
            from_addr = parseaddr(msg.get("From", ""))[1]
            message_id = msg.get("Message-ID") or f"imap-{num.decode()}-{re.sub(r'[^a-z0-9]', '', subject.lower())[:40]}"
            row = store(db, from_addr, subject, _text_of(msg), message_id)
            if row:
                new.append(row)
            m.store(num, "+FLAGS", "\\Seen")
    return new
