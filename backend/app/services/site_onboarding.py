"""Reading a business's website when it is onboarded (or its address changes) and remembering what was found, so the Blog tab already knows how to publish."""
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Business, SiteIntegration
from . import site_publish

log = logging.getLogger("seo.site")


def autodetect_enabled() -> bool:
    return bool(get_settings().site_autodetect)


def detect_and_store(db: Session, b: Business, url: str | None = None) -> dict | None:
    """Detect the site's technology and save it on the business's integration row. A working connection's method is never overwritten.
    Returns the detection, or None when there is no website or it cannot be read."""
    target = url or b.website
    if not target:
        return None
    try:
        found = site_publish.detect(target)
    except site_publish.PublishError as exc:
        log.info("Site detection skipped for business %s: %s", b.id, exc)
        return None
    row = db.scalar(select(SiteIntegration).where(SiteIntegration.business_id == b.id))
    if row is None:
        row = SiteIntegration(business_id=b.id)
        db.add(row)
    row.detected, row.platform = found, found["platform"]
    if row.status != "connected":
        row.method = found["method"]
    db.commit()
    return found


def detect_in_background(db: Session, business_id: int) -> None:
    """Background-task entry point: never raises (a slow or broken website must not affect creating the business)."""
    try:
        b = db.get(Business, business_id)
        if b is not None:
            detect_and_store(db, b)
    except Exception:
        db.rollback()
        log.exception("Background site detection failed for business %s", business_id)
