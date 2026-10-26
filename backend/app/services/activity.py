"""Activity log: every action a person or an agent takes."""
from typing import Any

from sqlalchemy.orm import Session

from ..models import ActivityLog


def log(db: Session, actor: str, action: str, business_id: int | None = None, **detail: Any) -> None:
    db.add(ActivityLog(actor=actor, action=action, business_id=business_id, detail=detail))
