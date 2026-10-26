"""Leads and daily insights for a business."""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_business
from ..models import Business, InsightDay, Lead
from ..schemas import LeadIn
from ..serialize import row, rows

router = APIRouter(prefix="/businesses/{business_id}", tags=["leads"])


@router.get("/leads")
def list_leads(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return rows(db.scalars(select(Lead).where(Lead.business_id == b.id).order_by(Lead.lead_date.desc().nullslast(), Lead.id.desc()).limit(500)))


@router.post("/leads", status_code=201)
def add_lead(body: LeadIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    data = body.model_dump()
    when = data.pop("lead_date")
    lead = Lead(business_id=b.id, **data, lead_date=date.fromisoformat(when) if when else date.today())
    db.add(lead)
    db.commit()
    return row(lead)


@router.patch("/leads/{lead_id}")
def set_lead_status(lead_id: int, status: str, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    if status not in ("new", "contacted", "won", "lost"):
        raise HTTPException(400, "Unknown status")
    lead = db.get(Lead, lead_id)
    if not lead or lead.business_id != b.id:
        raise HTTPException(404, "Lead not found")
    lead.status = status
    db.commit()
    return row(lead)


@router.get("/insights")
def insights(days: int = 30, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    since = date.today() - timedelta(days=min(max(days, 1), 540))
    return rows(db.scalars(select(InsightDay).where(InsightDay.business_id == b.id, InsightDay.day >= since).order_by(InsightDay.day)))
