"""Backlinks from our own deployed crawler (CRAWLER_URL / CRAWLER_API_KEY) into this platform's backlink tables.

For every domain a business tracks (its own site and its saved competitors) the crawler's links are read, page by page, and saved with the same
provenance (`codigix_crawler`) the local bot used, so the Overview, Backlink explorer, Competitor gap, scoring, disavow list and Growth Plan tasks
all read the crawler's data without any change. The crawler is the authority on whether a link is verified or lost: its status is copied, the
pages are not fetched again here. When the crawler is not set up, bot.run_cycle keeps using the local bot."""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import utcnow
from ..models import Business
from ..services import crawler_client as cc
from . import bot, sync, tasks
from .models import Backlink, BacklinkEvent, BiTrackedTarget
from .repository import LinkRecord, upsert_imported_link

log = logging.getLogger("seo.backlinks.crawler_sync")

SOURCE = "codigix_crawler"
PAGE = 500  # links asked from the crawler per call
MAX_PER_DOMAIN = 5000  # most links read for one domain in one sync (the crawler keeps the rest)
RECHECK = timedelta(days=7)  # the local verifier is not asked to fetch pages the crawler already verified

# the crawler's link_status -> this platform's lifecycle state
_STATE = {"verified": "LIVE", "live": "LIVE", "reappeared": "RESTORED", "restored": "RESTORED",
          "suspected_removed": "LOST_PENDING", "lost": "LOST_CONFIRMED", "removed": "LOST_CONFIRMED"}


def _when(value) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=timezone.utc) if " " in str(value) or "T" in str(value) else None
    except ValueError:
        return None


def _rels(rel) -> list[str]:
    if not rel:
        return []
    parts = rel if isinstance(rel, list) else str(rel).replace(",", " ").split()
    return sorted({p.strip().lower() for p in parts if p.strip()})


def _state_of(item: dict) -> str:
    active = item.get("is_active", True)
    st = _STATE.get(str(item.get("link_status") or "").lower())
    if not active:
        return st if st in ("LOST_PENDING", "LOST_CONFIRMED") else "LOST_PENDING"
    return st if st in ("LIVE", "RESTORED") else "NEW"


def save_link(db: Session, item: dict, now: datetime) -> tuple[Backlink, bool]:
    """Save one link of the crawler's answer. Returns (backlink, created)."""
    rels = _rels(item.get("rel"))
    state = _state_of(item)
    rec = LinkRecord(source_url=item["source_url"], target_url=item["destination_url"], anchor_text=item.get("anchor_text"), rel_attributes=rels,
                     link_type="nofollow" if "nofollow" in rels else "dofollow", first_seen=_when(item.get("first_seen")),
                     last_seen=_when(item.get("last_verified")), is_lost=state.startswith("LOST"))
    bl, created = upsert_imported_link(db, rec, SOURCE, "internal", now)
    if str(item.get("verification_status") or item.get("link_status") or "").lower() == "verified" or state.startswith("LOST"):
        bl.verification_status = "CRAWLER_VERIFIED"
        bl.last_verified_at = _when(item.get("last_verified")) or now
    if bl.current_status != state:
        prior = bl.current_status
        bl.current_status = state
        if not created and state in ("LOST_PENDING", "LOST_CONFIRMED", "RESTORED"):
            db.add(BacklinkEvent(backlink_id=bl.id, event_type=state, previous_value=prior, new_value=state, event_at=now))
    bl.absent_count = 0 if not state.startswith("LOST") else max(bl.absent_count or 0, 1)
    bl.next_verify_at = now + RECHECK
    return bl, created


def sync_domain(db: Session, domain: str, now: datetime | None = None) -> dict:
    """Read the crawler's links to `domain` and save them. Returns {read, created}."""
    now = now or utcnow()
    read = created = 0
    offset = 0
    while offset < MAX_PER_DOMAIN:
        page = cc.backlinks(domain, include_removed=True, limit=PAGE, offset=offset)
        items = page.get("backlinks") or []
        for item in items:
            if not item.get("source_url") or not item.get("destination_url"):
                continue
            try:
                with db.begin_nested():
                    _, new = save_link(db, item, now)
            except Exception:  # one bad row never stops the domain
                log.exception("Could not save a crawler link to %s", domain)
                continue
            read += 1
            created += 1 if new else 0
        db.commit()
        if len(items) < PAGE:
            break
        offset += PAGE
    return {"read": read, "created": created}


def run_cycle(db: Session, business_id: int, **_ignored) -> dict:
    """The crawler counterpart of bot.run_cycle: one sync for one business. Returns the same kind of stats."""
    cfg = bot.get_config(db, business_id)
    if bot.is_running(cfg):
        return {"skipped": "already running"}
    prior_run = cfg.last_run_at
    started = utcnow()
    cfg.running, cfg.run_started_at = True, started
    db.commit()
    stats = {"source": "crawler", "pages": 0, "errors": 0, "blocked": 0, "queued": 0, "new_backlinks": 0, "new_backlinks_all": 0, "seeded": 0, "rendered": 0,
             "links_read": 0, "domains": 0, "error": None}
    try:
        biz = db.get(Business, business_id)
        if biz is not None:
            sync.sync_targets(db, biz)  # the site and saved competitors are always among the targets
        mine = list(db.scalars(select(BiTrackedTarget.domain).where(BiTrackedTarget.business_id == business_id, BiTrackedTarget.monitoring_enabled.is_(True))))
        for domain in mine:
            try:
                r = sync_domain(db, domain, started)
            except cc.CrawlerError as exc:  # the crawler is down or refused: say so, keep what is saved
                stats["errors"] += 1
                stats["error"] = str(exc)
                break
            stats["domains"] += 1
            stats["links_read"] += r["read"]
            stats["new_backlinks_all"] += r["created"]
            stats["new_backlinks"] += r["created"]  # links to any domain this business tracks, as the local bot counted them
        if biz is not None and not stats["error"]:
            try:
                stats["handoff"] = tasks.after_run(db, biz, stats, since=prior_run)
            except Exception:  # scoring or task creation must never fail the sync
                db.rollback()
                log.exception("After-sync hand-off failed")
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        stats["errors"] += 1
        stats["error"] = f"{type(exc).__name__}: {exc}"
        log.exception("Crawler sync failed for business %s", business_id)
    finally:
        cfg = bot.get_config(db, business_id)
        cfg.running, cfg.last_run_at, cfg.last_stats = False, utcnow(), {**stats, "finished_at": utcnow().isoformat()}
        db.commit()
    return stats
