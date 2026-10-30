"""bevisibe Assistant: chat about the selected project and the platform (services/assistant.py)."""
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import get_business
from ..models import Business
from ..deps import in_background
from ..services import assistant, assistant_actions

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
    result = assistant.answer(db, b, body.message.strip(), [t.model_dump() for t in body.history], body.topic)
    action = assistant_actions.propose(body.message)
    if action and result.get("mode") != "scope":  # a question about another project is declined, never turned into an action
        result["action"] = action
        result["answer"] = f"{result['answer']}\n\nI can do that for you: **{action['label']}**. {action['does']} Nothing happens until you confirm."
    return result


class ActionIn(BaseModel):
    action: str = Field(max_length=40)
    params: dict[str, Any] = Field(default_factory=dict)


@router.post("/actions")
def run_action(body: ActionIn, background: BackgroundTasks, b: Business = Depends(get_business), db: Session = Depends(get_db), _: User = Depends(current_user)):
    """Carry out ONE action the assistant proposed, after the user confirmed it. Only actions in assistant_actions.ACTIONS can run."""
    from ..backlinks import bot as bl_bot, router as bl_router

    def start(business_id: int) -> None:
        background.add_task(in_background(lambda s, bid: bl_bot.run_cycle(s, bl_router.get_fetcher(), bid), business_id))
    try:
        return assistant_actions.execute(db, b, body.action, body.params, start)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/suggestions")
def suggestions(b: Business = Depends(get_business), db: Session = Depends(get_db), _: User = Depends(current_user)):
    return {"project": b.name, "suggestions": assistant.suggestions(db, b)}
