"""bevisibe Assistant: chat about the selected project and the platform (services/assistant.py)."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import get_business
from ..models import Business
from ..services import assistant

router = APIRouter(prefix="/businesses/{business_id}/assistant", tags=["assistant"])


class Turn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    text: str = Field(max_length=4000)


class AskIn(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    history: list[Turn] = Field(default_factory=list, max_length=12)
    topic: str | None = Field(default=None, max_length=30)


@router.post("")
def ask(body: AskIn, b: Business = Depends(get_business), db: Session = Depends(get_db), _: User = Depends(current_user)):
    return assistant.answer(db, b, body.message.strip(), [t.model_dump() for t in body.history], body.topic)


@router.get("/suggestions")
def suggestions(b: Business = Depends(get_business), db: Session = Depends(get_db), _: User = Depends(current_user)):
    return {"project": b.name, "suggestions": assistant.suggestions(db, b)}
