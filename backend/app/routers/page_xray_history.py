"""Page X-Ray history and the whole-site scan.

POST   /businesses/{id}/page-xray/save              save an X-Ray the browser just received (the browser report is replaced by our own cached copy when we have it)
GET    /businesses/{id}/page-xray/history?url=&limit=   saved runs, newest first, with the change since the run before
GET    /businesses/{id}/page-xray/history/trend?url=    the three scores per run, oldest first, for a chart
GET    /businesses/{id}/page-xray/history/{run_id}      one saved run with its full report
DELETE /businesses/{id}/page-xray/history/{run_id}
POST   /businesses/{id}/page-xray/site                  start a scan of the project's whole website (background)
GET    /businesses/{id}/page-xray/site                  the latest scan (progress and results) or null
GET    /businesses/{id}/page-xray/site/{job_id}         one scan
"""
import time
from collections import defaultdict, deque
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import get_business, in_background
from ..models import Business, PageXRayJob
from ..services import page_xray_history as hist, ratelimit
from . import page_xray as xray_router

router = APIRouter(prefix="/businesses/{business_id}/page-xray", tags=["page-xray-history"])

SAVE_LIMIT, SAVE_WINDOW = 120, 3600
_saves = ratelimit.Hits("page_xray_save")


def _fail(exc: hist.HistoryError) -> HTTPException:
    return HTTPException(exc.status, exc.message)


class SaveIn(BaseModel):
    report: dict[str, Any]


@router.post("/save", status_code=201)
def save(body: SaveIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    if not _saves.hit(str(user.id), SAVE_LIMIT, SAVE_WINDOW):
        raise HTTPException(429, "Too many saves. Try again later.")
    try:
        report = hist.validate_report(body.report)
        source = "client"
        mine = hist.server_copy(str(user.id), report, getattr(xray_router, "_cache", {}))
        if mine is not None:  # our own copy of the same X-Ray wins over what the browser sent
            report, source = hist.validate_report(mine), "server"
        row = hist.save_run(db, b, report, source=source)
    except hist.HistoryError as exc:
        raise _fail(exc) from exc
    return hist._row_summary(row)


@router.get("/history")
def list_history(url: str | None = None, limit: int = Query(50, ge=1, le=200), b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return hist.history(db, b, url, limit)


@router.get("/history/trend")
def history_trend(url: str, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return hist.trend(db, b, url)


@router.get("/history/{run_id}")
def one_run(run_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    r = hist.get_run(db, b, run_id)
    if not r:
        raise HTTPException(404, "That saved X-Ray was not found.")
    return {**hist._row_summary(r), "report": r.report}


@router.delete("/history/{run_id}")
def delete_run(run_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    r = hist.get_run(db, b, run_id)
    if not r:
        raise HTTPException(404, "That saved X-Ray was not found.")
    db.delete(r)
    db.commit()
    return {"ok": True}


class SiteScanIn(BaseModel):
    max_pages: int = Field(default=25, ge=5, le=hist.MAX_PAGES)


@router.post("/site", status_code=202)
def start_scan(body: SiteScanIn, background: BackgroundTasks, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    try:
        job = hist.start_site_scan(db, b, body.max_pages, user.name)
    except hist.HistoryError as exc:
        raise _fail(exc) from exc
    background.add_task(in_background(hist.run_site_scan, job.id))
    return hist.job_view(db, job)


@router.get("/site")
def latest_scan(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    job = hist.latest_job(db, b)
    return hist.job_view(db, job) if job else None


@router.get("/site/{job_id}")
def one_scan(job_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    job = db.scalar(select(PageXRayJob).where(PageXRayJob.id == job_id, PageXRayJob.business_id == b.id))
    if not job:
        raise HTTPException(404, "That scan was not found.")
    return hist.job_view(db, job)
