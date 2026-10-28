"""Competitor research for a business (see intel.py): start a run, follow its progress, read the
latest result. A run is saved on an Audit row (kind "intel", target "business:<id>") without a
business_id, so it never counts towards the business's own audit scores."""
from datetime import datetime, timezone
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


def _run(db: Session, audit_id: int, business_id: int, keywords: list[str], location: str | None) -> None:
    audit = db.get(Audit, audit_id)
    b = db.get(Business, business_id)
    if not audit or not b:
        return
    audit.status, audit.started_at = "running", datetime.now(timezone.utc)
    db.commit()

    def progress(event: dict) -> None:
        audit.result = {"progress": event}  # a new dict, so SQLAlchemy sees the JSON change
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
    a = db.scalar(select(Audit).where(Audit.kind == "intel", Audit.target == _target(b.id)).order_by(Audit.id.desc()))
    s = get_settings()
    return {
        "run": row(a) if a else None,
        "defaults": {"keywords": intel.default_keywords(b), "location": intel.default_location(b)},
        "setup": {"google_results": intel.serper_enabled(), "backlinks": s.dataforseo_enabled},
    }


@router.post("/businesses/{business_id}/competitor-research", status_code=202)
def start(body: ResearchIn, tasks: BackgroundTasks, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    if not intel.serper_enabled():
        raise HTTPException(400, "Competitor research needs Google results: set SERPER_API_KEY on the SEO backend (serper.dev).")
    busy = db.scalar(select(Audit).where(Audit.kind == "intel", Audit.target == _target(b.id), Audit.status.in_(("queued", "running"))))
    if busy:
        return row(busy)
    keywords = list(dict.fromkeys(k for k in body.keywords))
    a = Audit(kind="intel", target=_target(b.id), status="queued", result={"keywords": keywords})
    db.add(a)
    db.commit()
    tasks.add_task(in_background(_run, a.id, b.id, keywords, (body.location or "").strip() or None))
    return row(a)


@router.get("/competitor-research/{run_id}")
def get_run(run_id: int, db: Session = Depends(get_db), _: User = Depends(current_user)):
    a = db.get(Audit, run_id)
    if not a or a.kind != "intel":
        raise HTTPException(404, "Competitor research not found")
    return row(a)
