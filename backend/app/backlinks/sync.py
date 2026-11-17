"""Keeps the backlink targets in step with the rest of the platform: the business's own website and the competitors saved in Competitor Research
become tracked domains, so the same list of rivals drives rankings, audits and backlinks."""
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Business, Competitor
from .models import BiTrackedTarget
from .repository import get_domain
from .urls import host_of, registrable_domain


def _domain_of(website: str | None) -> str | None:
    host = host_of(website or "")
    if not host or "." not in host:
        return None
    return registrable_domain(host)


from ..competitors import hygiene  # noqa: E402


def register_with_crawler(own_domain: str | None, own: list[str], competitors: list[str]) -> dict | None:
    """Tell our backlink crawler about newly tracked domains: the business's own site (POST /discovery/onboard) and its competitors, tied to the
    business (POST /businesses/{domain}/competitors). Does nothing when the crawler is not set up; never raises."""
    if not (own or competitors) or not get_settings().crawler_enabled:
        return None
    from . import crawler_sync  # imported here: crawler_sync imports this module
    out = crawler_sync.register_domains(own) if own else {"registered": [], "already_known": [], "failed": {}}
    if competitors and not out["failed"]:  # a crawler that is down or refused the key would fail the competitor call too
        out["competitors"] = crawler_sync.register_competitors(own_domain, competitors)
    return out


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
        if d and d != own and not hygiene.skip_reason(b, c.website):  # a competitor's Instagram or YouTube is not a site whose links mean anything
            add(d, c.name, True)
    db.commit()
    out = {"added": added, "total": len(have)}
    crawler = register_with_crawler(own or next((t.domain for t in have.values() if not t.is_competitor), None),
                                    [a["domain"] for a in added if not a["is_competitor"]], [a["domain"] for a in added if a["is_competitor"]])  # new domains reach the crawler right away
    if crawler is not None:
        out["crawler"] = crawler
    return out


def after_competitors_saved(db: Session, b: Business) -> None:
    """Called right after competitors are saved for a business: they become tracked domains and our backlink crawler is told who they are competitors of.
    Never raises, so saving a competitor can never fail because of the backlink side."""
    try:
        sync_targets(db, b)
        # Send the whole saved list, not only the domains that are new: ones saved earlier (before the crawler was set up, or while it was down)
        # would otherwise never be sent. The crawler ignores a competitor it already has.
        if get_settings().crawler_enabled:
            from . import crawler_sync
            own = _domain_of(b.website)
            rows = db.execute(select(BiTrackedTarget.domain, BiTrackedTarget.is_competitor).where(BiTrackedTarget.business_id == b.id, BiTrackedTarget.monitoring_enabled.is_(True))).all()
            comps = [d for d, c in rows if c]
            own = own or next((d for d, c in rows if not c), None)
            if own:
                crawler_sync.register_domains([own])
            crawler_sync.register_competitors(own, comps)
    except Exception:  # noqa: BLE001
        db.rollback()
        logging.getLogger("seo.backlinks").exception("Could not track the new competitors of business %s", b.id)
