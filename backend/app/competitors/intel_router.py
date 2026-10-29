"""Competitor research for a business (see intel.py): start a run, follow its progress, read the
latest result. A run is saved on an Audit row (kind "intel", target "business:<id>") without a
business_id, so it never counts towards the business's own audit scores."""
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..config import get_settings
from ..db import get_db
from ..deps import get_business, in_background
from ..models import Audit, Business
from ..serialize import row
from . import intel

router = APIRouter(tags=["competitor-research"])

Keyword = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)]


class ResearchIn(BaseModel):
    keywords: list[Keyword] = Field(min_length=1, max_length=10)
    location: str | None = Field(default=None, max_length=120)


def _target(business_id: int) -> str:
    return f"business:{business_id}"


STALE = timedelta(minutes=4)  # a run reports progress every few seconds; silence this long means its worker died


def _expire_stale(db: Session, a: Audit | None) -> Audit | None:
    """A run still "running" after its worker died (the server restarted or reloaded mid-run) would spin on the
    page forever and block new runs: mark it failed so the page shows the reason and a new run can start."""
    if a and a.status in ("queued", "running"):
        seen = a.updated_at or a.created_at
        if seen and datetime.now(timezone.utc) - (seen if seen.tzinfo else seen.replace(tzinfo=timezone.utc)) > STALE:
            a.status, a.error, a.finished_at = "failed", "The research was interrupted (the server restarted while it ran). Run it again.", datetime.now(timezone.utc)
            db.commit()
    return a


def _run(db: Session, audit_id: int, business_id: int, keywords: list[str], location: str | None) -> None:
    audit = db.get(Audit, audit_id)
    b = db.get(Business, business_id)
    if not audit or not b:
        return
    audit.status, audit.started_at = "running", datetime.now(timezone.utc)
    db.commit()

    def progress(event: dict) -> None:
        audit.result = {"keywords": keywords, "progress": event}  # a new dict, so SQLAlchemy sees the JSON change
        db.commit()

    try:
        result = intel.analyse(b, keywords, location, progress)
        audit.result, audit.status, audit.score = result, "done", round(result["summary"]["visibility"])
    except intel.IntelError as exc:
        audit.status, audit.error = "failed", str(exc)
    except Exception as exc:  # noqa: BLE001 - the page shows the reason instead of spinning forever
        audit.status, audit.error = "failed", f"The research stopped: {exc}"[:500]
    audit.finished_at = datetime.now(timezone.utc)
    db.commit()


@router.get("/businesses/{business_id}/competitor-research")
def latest(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """The latest run (done, running or failed) and the defaults for a new one."""
    a = _expire_stale(db, db.scalar(select(Audit).where(Audit.kind == "intel", Audit.target == _target(b.id)).order_by(Audit.id.desc())))
    s = get_settings()
    last_done = None
    if a and a.status != "done":  # a new run is going (or failed): the page keeps showing the last finished one
        last_done = db.scalar(select(Audit).where(Audit.kind == "intel", Audit.target == _target(b.id), Audit.status == "done").order_by(Audit.id.desc()))
    return {
        "run": row(a) if a else None,
        "last_done": row(last_done) if last_done else None,
        "defaults": {"keywords": intel.default_keywords(b), "location": intel.default_location(b)},
        "setup": {"google_results": intel.serper_enabled(), "backlinks": s.dataforseo_enabled},
    }


@router.post("/businesses/{business_id}/competitor-research", status_code=202)
def start(body: ResearchIn, tasks: BackgroundTasks, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    if not intel.serper_enabled():
        raise HTTPException(400, "Competitor research needs Google results: set SERPER_API_KEY on the SEO backend (serper.dev).")
    busy = _expire_stale(db, db.scalar(select(Audit).where(Audit.kind == "intel", Audit.target == _target(b.id), Audit.status.in_(("queued", "running")))))
    if busy and busy.status in ("queued", "running"):
        return row(busy)
    keywords = list(dict.fromkeys(k for k in body.keywords))
    a = Audit(kind="intel", target=_target(b.id), status="queued", result={"keywords": keywords})
    db.add(a)
    db.commit()
    tasks.add_task(in_background(_run, a.id, b.id, keywords, (body.location or "").strip() or None))
    return row(a)


@router.get("/competitor-research/{run_id}")
def get_run(run_id: int, db: Session = Depends(get_db), _: User = Depends(current_user)):
    a = _expire_stale(db, db.get(Audit, run_id))
    if not a or a.kind != "intel":
        raise HTTPException(404, "Competitor research not found")
    return row(a)
