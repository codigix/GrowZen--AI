"""GET /businesses/{id}/flow: the journey (ten steps in order, what each needs first, and the next thing to do), from stored data only."""
import threading
import time
from app.services.fanout import ThreadPoolExecutor

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import SessionLocal, get_db
from ..deps import get_business, my_business_ids
from ..models import Business
from ..services import flow, lifecycle, website_health

router = APIRouter(prefix="/businesses/{business_id}/flow", tags=["flow"])


@router.get("")
def get_flow(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return flow.evaluate(db, b)


@router.get("/website-health", include_in_schema=True)
def website_health_view(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """The site audit and Page X-Ray, merged by topic (stored results only)."""
    return website_health.build(db, b)


projects_router = APIRouter(prefix="/flow", tags=["flow"])


_journeys: dict[int, tuple[float, dict | None]] = {}  # business id -> (when it was worked out, its journey)
_FRESH, _KEEP = 300, 3600  # seconds a journey is used as it is, and how long an old one may still be shown while a new one is worked out
_refreshing: set[int] = set()
_journey_lock = threading.Lock()


def _journey_of(business_id: int) -> dict | None:
    """One project's journey, worked out in its own database session (several run side by side). A project whose journey cannot be worked out is left out."""
    db = SessionLocal()
    try:
        b = db.get(Business, business_id)
        if b is None:
            return None
        f = flow.evaluate(db, b)
        nxt = f.get("next")
        return {"done": f["done"], "total": f["total"], "percent": f["percent"],
                "next": {"order": next((x["order"] for x in f["steps"] if x["key"] == nxt["key"]), None), "title": nxt["title"], "link": nxt["link"]} if nxt else None}
    except Exception:  # noqa: BLE001 - one project's problem must not hide the others
        return None
    finally:
        db.close()


WARM_MAX = 200  # the start-up head start covers the most recent projects only


def _work_out(ids: list[int]) -> None:
    now = time.time()
    with ThreadPoolExecutor(max_workers=6) as pool:
        for bid, j in zip(ids, pool.map(_journey_of, ids)):
            with _journey_lock:
                _journeys[bid] = (now, j)
                _refreshing.discard(bid)


@projects_router.get("/projects")
def projects_journey(db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Where each of the user's projects stands on its own journey: steps done, the step it is on now and its address.
    Each journey is kept for 5 minutes. A project never worked out is worked out now (side by side); an older one is shown at once and refreshed in the background."""
    ids = my_business_ids(db, user)
    q = select(Business.id).order_by(Business.id)
    if ids is not None:
        q = q.where(Business.id.in_(ids))
    mine = list(db.scalars(q))
    now = time.time()
    with _journey_lock:
        missing = [i for i in mine if i not in _journeys or now - _journeys[i][0] > _KEEP]
        stale = [i for i in mine if i not in missing and now - _journeys[i][0] > _FRESH and i not in _refreshing]
        _refreshing.update(stale)
    if missing:
        _work_out(missing)
    if stale and not lifecycle.run_single("flow-refresh", _work_out, stale):  # one refresh at a time in this process; the ones asked for now are asked again by the next page load
        with _journey_lock:
            _refreshing.difference_update(stale)
    out = {i: _journeys[i][1] for i in mine if i in _journeys and _journeys[i][1]}
    return {"projects": out}
