"""Onboarding inbox: list emails, add one by hand or by webhook, run the pipeline."""
import secrets

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user, require_admin
from ..config import get_settings
from ..db import get_db
from ..deps import in_background, my_business_ids
from ..models import IntakeEmail
from ..schemas import IntakeEmailIn
from ..serialize import row, rows
from ..services import intake, pipeline

router = APIRouter(prefix="/intake", tags=["intake"])


def _onboard(db: Session, email_id: int, owner_id: str | None = None) -> None:
    em = db.get(IntakeEmail, email_id)
    if em:
        pipeline.onboard(db, em, owner_id=owner_id)


def _mine(db: Session, user: User, em: IntakeEmail | None) -> IntakeEmail:
    """The mailbox is shared, so a non-admin sees only the emails that became their own projects."""
    ids = my_business_ids(db, user)
    if not em or (ids is not None and em.business_id not in ids):
        raise HTTPException(404, "Email not found")
    return em


@router.get("/emails")
def list_emails(status: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    q = select(IntakeEmail).order_by(IntakeEmail.received_at.desc()).limit(200)
    ids = my_business_ids(db, user)
    if ids is not None:
        q = q.where(IntakeEmail.business_id.in_(ids))
    if status:
        q = q.where(IntakeEmail.status == status)
    return rows(db.scalars(q), exclude={"body"})


@router.get("/emails/{email_id}")
def get_email(email_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return row(_mine(db, user, db.get(IntakeEmail, email_id)))


@router.post("/emails", status_code=201)
def add_email(body: IntakeEmailIn, tasks: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Paste an onboarding email by hand (same path as the mailbox); it is processed straight away."""
    em = intake.store(db, body.from_addr, body.subject, body.body, body.message_id or f"manual-{secrets.token_hex(8)}")
    if not em:
        raise HTTPException(409, "This email was already received")
    if em.status == "waiting":
        tasks.add_task(in_background(_onboard, em.id, user.id))
    return row(em)


@router.post("/webhook", status_code=202)
def webhook(body: IntakeEmailIn, tasks: BackgroundTasks, x_intake_token: str = Header(default=""), db: Session = Depends(get_db)):
    """For mail-forwarding services that POST emails (instead of IMAP). Needs INTAKE_WEBHOOK_TOKEN."""
    token = get_settings().intake_webhook_token
    if not token or not secrets.compare_digest(x_intake_token, token):
        raise HTTPException(401, "Bad intake token")
    em = intake.store(db, body.from_addr, body.subject, body.body, body.message_id or f"hook-{secrets.token_hex(8)}")
    if em and em.status == "waiting":
        tasks.add_task(in_background(_onboard, em.id))
    return {"accepted": bool(em)}


@router.post("/emails/{email_id}/process", status_code=202)
def process(email_id: int, tasks: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(current_user)):
    em = db.get(IntakeEmail, email_id)
    if em and em.business_id is None and not user.sees_all:
        raise HTTPException(404, "Email not found")  # not yet anyone's project: only admins handle the shared mailbox
    em = _mine(db, user, em) if em and em.business_id is not None else em
    if not em:
        raise HTTPException(404, "Email not found")
    if em.status == "processing":
        raise HTTPException(409, "Already processing")
    em.status = "waiting"
    db.commit()
    tasks.add_task(in_background(_onboard, em.id, user.id))
    return {"queued": em.id}


@router.post("/poll")
def poll(tasks: BackgroundTasks, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """Read the mailbox now (the scheduler also does this every few minutes)."""
    if not get_settings().imap_enabled:
        raise HTTPException(400, "The onboarding mailbox is not set up (INTAKE_IMAP_*).")
    new = intake.poll_imap(db)
    for em in new:
        if em.status == "waiting":
            tasks.add_task(in_background(_onboard, em.id))
    return {"new": len(new)}
