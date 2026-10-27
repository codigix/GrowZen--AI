"""Shared route dependencies."""
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from .auth import User, current_user
from .db import SessionLocal, get_db
from .models import Business


def get_business(business_id: int, db: Session = Depends(get_db), _: User = Depends(current_user)) -> Business:
    b = db.get(Business, business_id)
    if not b:
        raise HTTPException(404, "Business not found")
    return b


def in_background(fn, *args):
    """Run fn(db, *args) after the response with its own session (FastAPI BackgroundTasks)."""
    def job():
        db = SessionLocal()
        try:
            fn(db, *args)
        finally:
            db.close()
    return job
