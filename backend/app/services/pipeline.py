"""Onboarding pipeline: one email in -> an audited, planned and scheduled client profile out.

Steps (progress saved on the email so the UI can show it live):
  extract -> profile -> gbp_match -> audits -> plan -> report -> schedule -> notify
If required details are missing, the AI asks the sender instead of guessing (status needs_info).
"""
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, GoogleConnection, IntakeEmail
from . import agent, audits, extraction, gbp, reports, schedules
from .activity import log
from .notify import send_email

STEPS = [
    ("extract", "AI reads the email and extracts the business"),
    ("profile", "Client profile created"),
    ("gbp_match", "Google Business Profile matched"),
    ("audits", "GBP, rankings, technical, on-page, backlinks and citations audited"),
    ("plan", "Fixes planned as agent tasks"),
    ("report", "Audit report written"),
    ("schedule", "Schedule created for the plan"),
    ("notify", "Team and client notified"),
]


def _digits(s: str | None) -> str:
    return re.sub(r"\D", "", s or "")[-10:]


def _domain(url: str | None) -> str:
    return urlparse(url if (url or "").startswith("http") else f"https://{url}").netloc.removeprefix("www.") if url else ""


def _step(db: Session, em: IntakeEmail, key: str, status: str, note: str = "") -> None:
    steps = {s["id"]: s for s in (em.steps or [])}
    label = dict(STEPS)[key]
    steps[key] = {"id": key, "label": label, "status": status, "note": note, "at": datetime.now(timezone.utc).isoformat()}
    em.steps = [steps[k] for k, _ in STEPS if k in steps]
    db.commit()


def find_existing(db: Session, f: dict[str, Any]) -> Business | None:
    """Same business already on file? Match by phone, then website domain, then exact name."""
    phone, domain = _digits(f.get("phone")), _domain(f.get("website"))
    for b in db.scalars(select(Business)):
        if phone and _digits(b.phone) == phone:
            return b
        if domain and _domain(b.website) == domain:
            return b
    return db.scalar(select(Business).where(Business.name == f.get("name"))) if f.get("name") else None


def match_gbp(db: Session, b: Business) -> str:
    """Link the business to a location under a connected Google account (by phone, then name)."""
    if b.gbp_location:
        return f"Already linked ({b.gbp_location})"
    for conn in db.scalars(select(GoogleConnection).where(GoogleConnection.status == "active")):
        try:
            for loc in gbp.GbpClient(conn).all_locations():
                f = gbp.location_to_fields(loc)
                if (_digits(f.get("phone")) and _digits(f.get("phone")) == _digits(b.phone)) or (f.get("name") or "").lower() == b.name.lower():
                    for k, v in f.items():
                        if v not in (None, "", [], {}) and not getattr(b, k, None):
                            setattr(b, k, v)
                    b.gbp_location, b.gbp_account, b.connection_id = f["gbp_location"], f["gbp_account"], conn.id
                    db.commit()
                    try:
                        gbp.sync_business(db, b)
                    except gbp.GbpError:
                        pass
                    return f"Matched under {conn.email}"
        except gbp.GbpError as exc:
            conn.last_error = str(exc)[:500]
            db.commit()
    return "No connected Google account manages it yet: ask the owner to add us as a manager"


def onboard(db: Session, em: IntakeEmail, actor: str = "pipeline") -> IntakeEmail:
    em.status, em.error = "processing", None
    db.commit()
    try:
        _step(db, em, "extract", "running")
        fields, missing, method = extraction.extract(em.subject or "", em.body)
        em.extracted, em.missing = fields, missing
        if missing:
            _step(db, em, "extract", "needs_info", f"Missing: {', '.join(missing)}")
            em.status = "needs_info"
            send_email(em.from_addr, f"Re: {em.subject}", f"Hi,\n\nTo onboard this client we still need: {', '.join(missing)}.\nPlease reply with the details.\n\nThanks,\nSEO automation")
            db.commit()
            return em
        _step(db, em, "extract", "done", f"Read by {method}")

        _step(db, em, "profile", "running")
        b = find_existing(db, fields) or Business(source="email", created_by=actor)
        for src, dst in [("name", "name"), ("website", "website"), ("phone", "phone"), ("address", "address"), ("area", "area"), ("city", "city"),
                         ("category", "primary_category"), ("contact_name", "contact_name"), ("contact_email", "contact_email"), ("plan", "plan")]:
            if fields.get(src) and not getattr(b, dst, None):
                setattr(b, dst, fields[src])
        if fields.get("services") and not b.services:
            b.services = [{"name": s, "price": "", "description": ""} for s in fields["services"]]
        db.add(b)
        db.commit()
        em.business_id = b.id
        log(db, actor, "business_created" if b.source == "email" else "business_updated", b.id, email_id=em.id)
        _step(db, em, "profile", "done", f"{b.name} (#{b.id})")

        _step(db, em, "gbp_match", "running")
        _step(db, em, "gbp_match", "done", match_gbp(db, b))

        _step(db, em, "audits", "running")
        found = audits.run_all(db, b)
        failed = [a.kind for a in found if a.status == "failed"]
        _step(db, em, "audits", "done", f"Overall {b.last_audit_score if b.last_audit_score is not None else '—'}/100" + (f"; failed: {', '.join(failed)}" if failed else ""))

        _step(db, em, "plan", "running")
        tasks = agent.plan_from_audits(db, b, [i for a in found if a.status == "done" for i in a.issues])
        _step(db, em, "plan", "done", f"{len(tasks)} tasks ({sum(1 for t in tasks if t.requires_approval)} need approval)")

        _step(db, em, "report", "running")
        summary = reports.monthly_summary(db, b)
        _step(db, em, "report", "done", summary["plain_words"][:300])

        _step(db, em, "schedule", "running")
        rows = schedules.create_for_plan(db, b)
        _step(db, em, "schedule", "done", ", ".join(f"{r.job} {r.every}" for r in rows if r.every != "off"))

        _step(db, em, "notify", "running")
        sent = send_email(em.from_addr, f"Onboarded: {b.name}", f"{b.name} is audited and scheduled.\n\n{summary['plain_words']}", [(f"{b.name}-audit.pdf", reports.pdf(summary), "application/pdf")])
        _step(db, em, "notify", "done", "Emailed the sender" if sent else "SMTP not set up: report available in the app")
        b.status = "needs_approval" if any(t.requires_approval and t.status == "pending" for t in tasks) else "active"
        em.status = "done"
        db.commit()
    except Exception as exc:
        db.rollback()
        em.status, em.error = "failed", str(exc)[:1000]
        db.commit()
    return em


def process_waiting(db: Session, limit: int = 5) -> int:
    rows = list(db.scalars(select(IntakeEmail).where(IntakeEmail.status == "waiting").order_by(IntakeEmail.received_at).limit(limit)))
    for em in rows:
        onboard(db, em)
    return len(rows)
