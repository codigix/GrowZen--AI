"""The backlink numbers shown outside the Backlink Intelligence page (dashboard, Domain Overview, assistant): what our own bot has found."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import analytics
from .models import BiTrackedTarget


def own_site_links(db: Session, business_id: int) -> dict | None:
    """None when the business tracks no site of its own; otherwise the live-link totals for it (zeros until the bot has found links)."""
    t = db.scalar(select(BiTrackedTarget).where(BiTrackedTarget.business_id == business_id, BiTrackedTarget.is_competitor.is_(False)).order_by(BiTrackedTarget.id))
    if t is None:
        return None
    s = analytics.counts(db, t.domain)
    return {"domain": t.domain, "backlinks": s["backlinks"], "referring_domains": s["referring_domains"], "crawler_verified": s["crawler_verified"]}
