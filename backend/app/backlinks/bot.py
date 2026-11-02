"""The autonomous discovery bot: seeds itself from the domains a business tracks, then explores outward within a page, time and hop budget,
recording every link it finds to a tracked domain. It only follows public links, obeys robots.txt and per-host politeness, and never uses
another service's index. What it finds is limited by what it can reach: it explores neighbours of your sites, it does not index the whole web."""
import logging
import time
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import utcnow
from ..models import Business
from . import engine, frontier, renderer, stop, sync, tasks
from .models import Backlink, BacklinkProvenance, BiBotConfig, BiDomain, BiPage, BiTrackedTarget, CrawlAttempt, FrontierUrl
from .urls import registrable_domain

log = logging.getLogger("seo.backlinks.bot")
STALE_RUN = timedelta(minutes=15)
RECRAWL_AFTER = timedelta(hours=24)
TIME_BUDGET_SECONDS = 150
RENDERS_PER_RUN = 10  # pages one run may load in a real browser
LIMITS = {"pages_per_run": (5, 500), "interval_minutes": (5, 1440), "max_hops": (0, 3)}


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


def seed_targets(db: Session, business_id: int) -> int:
    """Queue the front door of every tracked domain (competitors a little lower). Already-crawled seeds come back after a day."""
    n = 0
    now = utcnow()
    for t in db.scalars(select(BiTrackedTarget).where(BiTrackedTarget.business_id == business_id, BiTrackedTarget.monitoring_enabled.is_(True))):
        row = frontier.enqueue(db, f"https://{t.domain}/", "seed", 0, None, priority=80.0 if t.is_competitor else 90.0, now=now)
        if row is None:
            continue
        if row.status == "done" and engine.aware(row.next_eligible_at) < now - RECRAWL_AFTER:
            row.status, row.queue, row.next_eligible_at, row.attempts = "pending", "recrawl", now, 0
        if row.status == "pending":
            n += 1
    db.commit()
    return n


def run_cycle(db: Session, fetcher: engine.PageFetcher, business_id: int, budget_seconds: float = TIME_BUDGET_SECONDS, clock=time.monotonic, sleep=time.sleep) -> dict:
    """One bounded exploration run. Safe to call from a scheduler or a request thread; returns what it did."""
    cfg = get_config(db, business_id)
    if is_running(cfg):
        return {"skipped": "already running"}
    prior_run = cfg.last_run_at
    cfg.running, cfg.run_started_at = True, utcnow()
    db.commit()
    stats = {"pages": 0, "errors": 0, "blocked": 0, "queued": 0, "new_backlinks": 0, "seeded": 0, "rendered": 0}
    budget = renderer.RenderBudget(RENDERS_PER_RUN) if cfg.render_js and renderer.available() else None
    deadline = clock() + budget_seconds
    idle = 0
    try:
        biz = db.get(Business, business_id)
        if biz is not None:
            sync.sync_targets(db, biz)  # the site and saved competitors are always among the targets
        stats["seeded"] = seed_targets(db, business_id)
        frontier.recover_stale(db)
        monitored = engine.tracked_domains(db)
        while stats["pages"] < cfg.pages_per_run and clock() < deadline and not stop.stopping():
            rows = frontier.take_next(db, min(10, cfg.pages_per_run - stats["pages"]))
            db.commit()
            if not rows:
                waiting = db.scalar(select(func.count()).select_from(FrontierUrl).where(FrontierUrl.status == "pending")) or 0
                idle += 1
                if not waiting or idle > 40:  # nothing left, or only rows that stay blocked: stop
                    break
                sleep(1.0)  # pending pages exist but their hosts are cooling down (politeness delay)
                continue
            idle = 0
            for row in rows:
                try:
                    out = engine.crawl_row(db, fetcher, row, monitored, max_hops=cfg.max_hops, render=budget)
                    stats["pages"] += 1
                    stats["queued"] += out.get("queued", 0)
                    stats["new_backlinks"] += out.get("new_backlinks", 0)
                    stats["rendered"] += 1 if out.get("rendered") else 0
                    if out.get("error_code") == "robots_disallowed":
                        stats["blocked"] += 1
                    elif out.get("error_code"):
                        stats["errors"] += 1
                except Exception as exc:  # one bad page never stops the run; the row is retried later
                    db.rollback()
                    row = db.merge(row)
                    frontier.fail(db, row, f"{type(exc).__name__}: {exc}")
                    stats["errors"] += 1
                    log.exception("Bot crawl of %s failed", row.url)
                db.commit()
                if clock() >= deadline or stop.stopping():
                    break
    finally:
        try:
            biz = db.get(Business, business_id)
            if biz is not None and stats["pages"]:
                stats["handoff"] = tasks.after_run(db, biz, stats, since=prior_run)
        except Exception:  # scoring or task creation must never fail the run itself
            db.rollback()
            log.exception("After-run hand-off failed")
        cfg = get_config(db, business_id)
        cfg.running, cfg.last_run_at, cfg.last_stats = False, utcnow(), {**stats, "finished_at": utcnow().isoformat()}
        db.commit()
    return stats


def run_due(db: Session, fetcher: engine.PageFetcher) -> int:
    """Scheduler entry point: run the bot for every business whose interval has elapsed."""
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
        run_cycle(db, fetcher, cfg.business_id)
        ran += 1
    return ran


def status(db: Session, business_id: int) -> dict:
    """Config, live state and totals for the bot panel. Totals are scoped to what this business tracks."""
    cfg = get_config(db, business_id)
    mine = [t.domain for t in db.scalars(select(BiTrackedTarget).where(BiTrackedTarget.business_id == business_id))]
    found = 0
    if mine:
        TD = BiDomain
        found = db.scalar(select(func.count(func.distinct(Backlink.id))).join(BacklinkProvenance, BacklinkProvenance.backlink_id == Backlink.id)
                          .join(TD, TD.id == Backlink.target_domain_id).where(BacklinkProvenance.source == "codigix_crawler", TD.registrable_domain.in_(mine))) or 0
    recent = db.execute(select(CrawlAttempt.url, CrawlAttempt.purpose, CrawlAttempt.http_status, CrawlAttempt.error_code, CrawlAttempt.started_at)
                        .where(CrawlAttempt.purpose != "robots").order_by(CrawlAttempt.id.desc()).limit(15)).all()
    return {
        "config": {"enabled": cfg.enabled, "pages_per_run": cfg.pages_per_run, "interval_minutes": cfg.interval_minutes, "max_hops": cfg.max_hops, "render_js": bool(cfg.render_js)},
        "render_available": renderer.available(),
        "running": is_running(cfg), "last_run_at": cfg.last_run_at, "last_stats": cfg.last_stats,
        "totals": {"pages_fetched": db.scalar(select(func.count()).select_from(CrawlAttempt).where(CrawlAttempt.purpose.in_(("discovery", "verification", "sitemap")))) or 0,
                   "pages_known": db.scalar(select(func.count()).select_from(BiPage)) or 0,
                   "domains_known": db.scalar(select(func.count(func.distinct(BiDomain.registrable_domain)))) or 0,
                   "backlinks_found_by_bot": found},
        "frontier": frontier.stats(db),
        "recent": [{"url": u, "purpose": p, "http_status": h, "error_code": e, "at": at} for u, p, h, e, at in recent],
    }
