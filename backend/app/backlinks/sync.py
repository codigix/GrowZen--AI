"""Keeps the backlink targets in step with the rest of the platform: the business's own website and the competitors saved in Competitor Research
become tracked domains, so the same list of rivals drives rankings, audits and backlinks."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, Competitor
from .models import BiTrackedTarget
from .repository import get_domain
from .urls import host_of, registrable_domain


def _domain_of(website: str | None) -> str | None:
    host = host_of(website or "")
    if not host or "." not in host:
        return None
    return registrable_domain(host)


def sync_targets(db: Session, b: Business) -> dict:
    """Add the business's site and its saved competitors as targets. Never removes or changes anything the user added by hand."""
    have = {t.domain: t for t in db.scalars(select(BiTrackedTarget).where(BiTrackedTarget.business_id == b.id))}
    added: list[dict] = []

    def add(domain: str | None, name: str | None, competitor: bool) -> None:
        if not domain or domain in have:
            return
        t = BiTrackedTarget(business_id=b.id, domain=domain, name=name, is_competitor=competitor)
        db.add(t)
        have[domain] = t
        get_domain(db, domain)
        added.append({"domain": domain, "name": name, "is_competitor": competitor})

    own = _domain_of(b.website)
    add(own, b.name, False)
    for c in db.scalars(select(Competitor).where(Competitor.business_id == b.id).order_by(Competitor.id)):
        d = _domain_of(c.website)
        if d and d != own:
            add(d, c.name, True)
    db.commit()
    return {"added": added, "total": len(have)}
