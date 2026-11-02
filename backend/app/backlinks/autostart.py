"""Starts backlink discovery for a project without anyone opening the bot page: the business's website and saved competitors become tracked
domains, the discovery bot is switched on (so the scheduler keeps running it), and a first run can start straight away. Everything the bot
finds is stored in the backlink tables and shown on Backlink Intelligence, the Domain Overview and Top Pages."""
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Business
from . import bot, sync
from .models import BiTrackedTarget

log = logging.getLogger("seo.backlinks.autostart")


def enable(db: Session, b: Business) -> dict:
    """Track the site and competitors and turn the bot on. Safe to call again; says why when there is nothing to track."""
    if not (b.website or "").strip():
        return {"enabled": False, "reason": "This project has no website yet, so there is no domain to track backlinks for."}
    out = sync.sync_targets(db, b)
    targets = list(db.scalars(select(BiTrackedTarget).where(BiTrackedTarget.business_id == b.id)))
    if not targets:
        return {"enabled": False, "reason": "The website address could not be read as a domain."}
    cfg = bot.get_config(db, b.id)
    cfg.enabled = True
    db.commit()
    return {"enabled": True, "targets": len(targets), "domains": [t.domain for t in targets], "added": [a["domain"] for a in out["added"]],
            "interval_minutes": cfg.interval_minutes}


def first_run(db: Session, business_id: int) -> None:
    """The first exploration run (a background job). Later runs come from the scheduler; a failure here never affects onboarding."""
    if not get_settings().backlink_autostart:
        return
    from .router import get_fetcher  # imported here: the router imports this package
    try:
        bot.run_cycle(db, get_fetcher(), business_id)
    except Exception:  # noqa: BLE001 - the scheduler retries on its next tick
        db.rollback()
        log.exception("First backlink discovery run failed for business %s", business_id)
