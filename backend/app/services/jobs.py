"""Housekeeping for background work: runs that died with their process, and data that only grows.

Background work here runs inside the web process, so a restart or reload kills whatever was running. Its database
row says "running" forever and the page spins. These make that visible and recoverable.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Audit

STALE = timedelta(minutes=20)  # a run that has not touched its row for this long is dead
_last_prune: list[datetime | None] = [None]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def recover_stale(db: Session, startup: bool = False) -> int:
    """Mark runs whose worker is gone as failed so pages stop waiting for them. At start-up nothing that this
    process did not start can be running (one instance only), so every unfinished run is dead."""
    q = select(Audit).where(Audit.status.in_(("queued", "running")))
    n = 0
    for a in db.scalars(q):
        seen = a.updated_at or a.created_at
        if not startup and seen and (_now() - (seen if seen.tzinfo else seen.replace(tzinfo=timezone.utc))) < STALE:
            continue
        a.status = "failed"
        a.error = a.error or "Interrupted: the server restarted (or the run stalled) before it finished. Run it again."
        a.finished_at = _now()
        n += 1
    if n:
        db.commit()
    return n


def prune(db: Session, force: bool = False) -> int:
    """Old audits past the retention period go, but the newest few of each kind per project always stay."""
    last = _last_prune[0]
    if not force and last and _now() - last < timedelta(hours=23):
        return 0
    _last_prune[0] = _now()
    cutoff = _now() - timedelta(days=get_settings().audit_retention_days)
    keep: set[int] = set()
    seen: dict[tuple, int] = {}
    for a in db.scalars(select(Audit).order_by(Audit.id.desc())):
        k = (a.business_id, a.kind, a.target if a.business_id is None else None)
        seen[k] = seen.get(k, 0) + 1
        if seen[k] <= 5:
            keep.add(a.id)
    n = 0
    for a in db.scalars(select(Audit).where(Audit.created_at < cutoff)):
        if a.id not in keep:
            db.delete(a)
            n += 1
    if n:
        db.commit()
    return n
