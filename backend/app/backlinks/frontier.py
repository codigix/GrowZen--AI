"""Persistent URL frontier (PRD 9.2): dedupe by URL hash, separate queues, per-domain fairness, bounded retries, dead letters."""
import random
import re
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import utcnow
from .models import BiDomain, FrontierUrl
from .repository import get_domain
from .urls import normalize_url, url_hash

MAX_DEPTH = 5
MAX_URL_LENGTH = 2000
MAX_QUERY_PARAMS = 4
MAX_URLS_PER_DOMAIN = 5000  # crawl budget per host; stops infinite URL spaces (calendars, faceted search)
MAX_ATTEMPTS = 4
STALE_AFTER = timedelta(minutes=15)
QUEUE_ORDER = ("verification", "discovery", "recrawl", "retry")

# Initial product hypotheses from PRD 9.5; every input is normalized to 0..1.
PRIORITY_WEIGHTS = {"relevance": 0.25, "update_frequency": 0.20, "graph_importance": 0.15, "previous_backlinks": 0.15,
                    "freshness": 0.10, "domain_reliability": 0.10, "discovery_recency": 0.05}


def crawl_priority(**signals: float) -> float:
    """0..100 scheduling priority. Missing signals count as 0. Used to order work, not as a claim of authority."""
    return round(100 * sum(PRIORITY_WEIGHTS[k] * min(1.0, max(0.0, float(signals.get(k, 0)))) for k in PRIORITY_WEIGHTS), 2)


_REPEATING_SEGMENT = re.compile(r"(/[^/]+)\1{2,}")


def is_crawl_trap(url: str) -> bool:
    if len(url) > MAX_URL_LENGTH:
        return True
    path, _, query = url.partition("?")
    if _REPEATING_SEGMENT.search(path):
        return True
    return query.count("&") + (1 if query else 0) > MAX_QUERY_PARAMS


def enqueue(db: Session, url: str, source: str = "link", depth: int = 0, discovered_from: str | None = None, priority: float = 0.0,
            queue: str = "discovery", now: datetime | None = None, hop: int = 0) -> FrontierUrl | None:
    """Add a URL unless it is already known, too deep, a likely trap, or its domain is over budget. A known URL keeps one row;
    a higher priority or the verification queue upgrades it."""
    now = now or utcnow()
    try:
        norm = normalize_url(url)
    except ValueError:
        return None
    if depth > MAX_DEPTH or (is_crawl_trap(norm) and source != "user"):
        return None
    h = url_hash(norm)
    row = db.scalar(select(FrontierUrl).where(FrontierUrl.url_hash == h))
    if row is not None:
        if priority > row.priority:
            row.priority = priority
        if queue == "verification" and row.queue != "verification" and row.status in ("pending", "done"):
            row.queue, row.status, row.next_eligible_at = "verification", "pending", now
        return row
    domain = get_domain(db, norm, now)
    if db.scalar(select(func.count()).select_from(FrontierUrl).where(FrontierUrl.domain_id == domain.id)) >= MAX_URLS_PER_DOMAIN:
        return None
    row = FrontierUrl(domain_id=domain.id, url=norm, url_hash=h, queue=queue, source=source, discovered_from=discovered_from, priority=priority, depth=depth,
                      hop=hop, discovered_at=now, next_eligible_at=now)
    db.add(row)
    db.flush()
    return row


def take_next(db: Session, limit: int = 10, queues: tuple[str, ...] = QUEUE_ORDER, now: datetime | None = None) -> list[FrontierUrl]:
    """Claim up to `limit` ready URLs: queues in priority order, best priority first, at most one URL per domain per call
    (fairness) and only for domains whose politeness delay has passed. Claimed rows become in_progress."""
    now = now or utcnow()
    picked: list[FrontierUrl] = []
    domains: set[int] = set()
    for q in queues:
        if len(picked) >= limit:
            break
        rows = db.scalars(select(FrontierUrl).join(BiDomain, BiDomain.id == FrontierUrl.domain_id)
                          .where(FrontierUrl.queue == q, FrontierUrl.status == "pending", FrontierUrl.next_eligible_at <= now,
                                 (BiDomain.next_crawl_at.is_(None)) | (BiDomain.next_crawl_at <= now))
                          .order_by(FrontierUrl.priority.desc(), FrontierUrl.id).limit(limit * 5))
        for r in rows:
            if r.domain_id in domains:
                continue
            domains.add(r.domain_id)
            r.status, r.next_eligible_at = "in_progress", now  # next_eligible_at doubles as the claim time for stale detection
            picked.append(r)
            if len(picked) >= limit:
                break
    db.flush()
    return picked


def complete(db: Session, row: FrontierUrl) -> None:
    row.status, row.last_error = "done", None


def fail(db: Session, row: FrontierUrl, error: str, retry_after: float | None = None, now: datetime | None = None, retryable: bool = True) -> None:
    """Bounded retries: exponential backoff with jitter (or the server's Retry-After); exhausted rows go to the dead-letter state."""
    now = now or utcnow()
    row.attempts += 1
    row.last_error = error[:200]
    if not retryable or row.attempts >= MAX_ATTEMPTS:
        row.status = "dead"
        return
    delay = retry_after if retry_after is not None else min(3600, 30 * 2 ** row.attempts) * random.uniform(0.8, 1.2)
    row.status, row.queue, row.next_eligible_at = "pending", "retry", now + timedelta(seconds=delay)


def recover_stale(db: Session, now: datetime | None = None) -> int:
    """A worker that crashed mid-fetch leaves rows in_progress; hand them back so the work is not lost."""
    now = now or utcnow()
    n = 0
    for r in db.scalars(select(FrontierUrl).where(FrontierUrl.status == "in_progress", FrontierUrl.next_eligible_at < now - STALE_AFTER)):
        r.status = "pending"
        n += 1
    return n


def stats(db: Session) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}
    for q, s, n in db.execute(select(FrontierUrl.queue, FrontierUrl.status, func.count()).group_by(FrontierUrl.queue, FrontierUrl.status)):
        out.setdefault(q, {})[s] = n
    return out
