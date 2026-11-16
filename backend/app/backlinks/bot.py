"""Backlink sync state for a business. Nothing is crawled in this process: our own crawler server finds the links and crawler_sync.py reads them
(CRAWLER_URL + CRAWLER_API_KEY). This module keeps the per-business settings, the "already syncing" guard and the status shown in the app."""
import logging
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from ..config import get_settings
from ..db import utcnow
from .models import Backlink, BacklinkProvenance, BiBotConfig, BiDomain, BiPage, BiTrackedTarget

log = logging.getLogger("seo.backlinks.bot")
STALE_RUN = timedelta(minutes=15)
LIMITS = {"pages_per_run": (5, 500), "interval_minutes": (5, 1440), "max_hops": (0, 3)}


def crawler_mode() -> bool:
    return get_settings().crawler_enabled


def get_config(db: Session, business_id: int) -> BiBotConfig:
    cfg = db.scalar(select(BiBotConfig).where(BiBotConfig.business_id == business_id))
    if cfg is None:
        cfg = BiBotConfig(business_id=business_id)
        db.add(cfg)
        db.commit()
    return cfg


def is_running(cfg: BiBotConfig) -> bool:
    started = cfg.run_started_at
    if started is not None and started.tzinfo is None:
        started = started.replace(tzinfo=utcnow().tzinfo)
    return bool(cfg.running and started and utcnow() - started < STALE_RUN)  # a crashed run must not block the next one forever


def _my_domains(db: Session, business_id: int, only_enabled: bool = False) -> list[str]:
    q = select(BiTrackedTarget.domain).where(BiTrackedTarget.business_id == business_id)
    if only_enabled:
        q = q.where(BiTrackedTarget.monitoring_enabled.is_(True))
    return list(db.scalars(q))


def found_for(db: Session, domains: list[str], since=None, until=None) -> int:
    """Backlinks the bot recorded that point at `domains` (one business's tracked sites), optionally only those first recorded in [since, until].
    The bot records links to every project's domains on each page it reads, so a business's own count must be filtered like this."""
    if not domains:
        return 0
    q = (select(func.count(func.distinct(Backlink.id))).join(BacklinkProvenance, BacklinkProvenance.backlink_id == Backlink.id)
         .join(BiDomain, BiDomain.id == Backlink.target_domain_id).where(BacklinkProvenance.source == "codigix_crawler", BiDomain.registrable_domain.in_(domains)))
    if since is not None:
        q = q.where(BacklinkProvenance.imported_at >= since)
    if until is not None:
        q = q.where(BacklinkProvenance.imported_at <= until)
    return db.scalar(q) or 0


def run_cycle(db: Session, business_id: int) -> dict:
    """One sync of this business's links from our crawler server. When the crawler is not connected nothing happens and the status says so."""
    if not crawler_mode():
        return {"skipped": "crawler not connected", "error": "Our backlink crawler is not connected: set CRAWLER_URL and CRAWLER_API_KEY in the backend settings."}
    from . import crawler_sync
    return crawler_sync.run_cycle(db, business_id)


def run_due(db: Session) -> int:
    """Scheduler entry point: sync every business whose interval has elapsed (only when the crawler is connected)."""
    if not crawler_mode():
        return 0
    ran = 0
    now = utcnow()
    for cfg in list(db.scalars(select(BiBotConfig).where(BiBotConfig.enabled.is_(True)))):
        last = cfg.last_run_at
        if last is not None and last.tzinfo is None:
            last = last.replace(tzinfo=now.tzinfo)
        if is_running(cfg) or (last is not None and now - last < timedelta(minutes=cfg.interval_minutes)):
            continue
        if not db.scalar(select(func.count()).select_from(BiTrackedTarget).where(BiTrackedTarget.business_id == cfg.business_id)):
            continue
        run_cycle(db, cfg.business_id)
        ran += 1
    return ran


def status(db: Session, business_id: int) -> dict:
    """Settings, live state and totals for the sync panel. Totals are scoped to what this business tracks."""
    cfg = get_config(db, business_id)
    mine = _my_domains(db, business_id)
    found = found_for(db, mine)
    last = dict(cfg.last_stats) if cfg.last_stats else None
    if last and not last.get("skipped") and "new_backlinks_all" not in last and cfg.run_started_at and cfg.last_run_at:
        # saved before new_backlinks was scoped to this business: recount that run's window for this business's domains only
        last["new_backlinks_all"] = last.get("new_backlinks", 0)
        last["new_backlinks"] = found_for(db, mine, since=cfg.run_started_at, until=cfg.last_run_at)
    linking = pages_mine = 0
    if mine:
        SD, TD = aliased(BiDomain), aliased(BiDomain)
        linking = db.scalar(select(func.count(func.distinct(SD.registrable_domain))).select_from(Backlink).join(SD, SD.id == Backlink.source_domain_id)
                            .join(TD, TD.id == Backlink.target_domain_id).join(BacklinkProvenance, BacklinkProvenance.backlink_id == Backlink.id)
                            .where(BacklinkProvenance.source == "codigix_crawler", TD.registrable_domain.in_(mine))) or 0
        pages_mine = db.scalar(select(func.count()).select_from(BiPage).join(BiDomain, BiDomain.id == BiPage.domain_id)
                               .where(BiDomain.registrable_domain.in_(mine), BiPage.last_crawled_at.is_not(None))) or 0
    return {
        "source": "crawler" if crawler_mode() else "not_connected",
        "config": {"enabled": cfg.enabled, "pages_per_run": cfg.pages_per_run, "interval_minutes": cfg.interval_minutes, "max_hops": cfg.max_hops, "render_js": bool(cfg.render_js)},
        "running": is_running(cfg), "last_run_at": cfg.last_run_at, "last_stats": last,
        "totals": {"backlinks_found_by_bot": found},
        "mine": {"backlinks": found, "linking_domains": linking, "pages_crawled": pages_mine},
    }
