"""Persistent URL frontier (PRD 9.2): dedupe by URL hash, separate queues, per-domain fairness, bounded retries, dead letters."""
import random
import re
from collections.abc import Iterable
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import utcnow
from .models import BiDomain, FrontierUrl
from .repository import get_domain
from .urls import host_of, normalize_url, url_hash

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


def _upgrade(row: FrontierUrl, priority: float, queue: str, now: datetime, business_id: int | None) -> FrontierUrl:
    if priority > row.priority:
        row.priority = priority
    if queue == "verification" and row.queue != "verification" and row.status in ("pending", "done"):
        row.queue, row.status, row.next_eligible_at = "verification", "pending", now
    if row.business_id is None and business_id is not None:  # a shared row is adopted by the first business that reaches it
        row.business_id = business_id
    return row


def enqueue(db: Session, url: str, source: str = "link", depth: int = 0, discovered_from: str | None = None, priority: float = 0.0,
            queue: str = "discovery", now: datetime | None = None, hop: int = 0, business_id: int | None = None) -> FrontierUrl | None:
    """Add a URL unless it is already known, too deep, a likely trap, or its domain is over budget. A known URL keeps one row (it is never
    fetched twice for discovery, whichever business reaches it); a higher priority or the verification queue upgrades it.
    `business_id` is the business whose exploration found it: that business's runs work through it."""
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
        return _upgrade(row, priority, queue, now, business_id)
    domain = get_domain(db, norm, now)
    if db.scalar(select(func.count()).select_from(FrontierUrl).where(FrontierUrl.domain_id == domain.id)) >= MAX_URLS_PER_DOMAIN:
        return None
    row = FrontierUrl(domain_id=domain.id, url=norm, url_hash=h, queue=queue, source=source, discovered_from=discovered_from, priority=priority, depth=depth,
                      hop=hop, business_id=business_id, discovered_at=now, next_eligible_at=now)
    try:
        with db.begin_nested():  # several businesses crawl at once: another run may have queued the same URL a moment ago
            db.add(row)
            db.flush()
    except IntegrityError:
        row = db.scalar(select(FrontierUrl).where(FrontierUrl.url_hash == h))
        return _upgrade(row, priority, queue, now, business_id) if row is not None else None
    return row


_LOOKUP_CHUNK = 500  # URL hashes per IN (...) lookup: well under every driver's bind-parameter limit
_DOMAIN_LOCK_NAMESPACE = 7_274_002  # first key of the two-key advisory lock taken per domain (see enqueue_many)


def _domain_capacity_locks(db: Session, domain_ids: Iterable[int]) -> None:
    """Serialise capacity checks per domain across concurrent transactions (PostgreSQL advisory locks, released at commit/rollback).
    Without it two workers can both count 4,999 rows and both insert, passing MAX_URLS_PER_DOMAIN. Locks are taken in id order so two
    batches touching the same domains can never deadlock. SQLite has a single writer, so nothing is needed there."""
    if db.get_bind().dialect.name != "postgresql":
        return
    for did in sorted(set(domain_ids)):
        db.execute(select(func.pg_advisory_xact_lock(_DOMAIN_LOCK_NAMESPACE, did)))


def enqueue_many(db: Session, urls: Iterable[str], source: str = "link", depth: int = 0, discovered_from: str | None = None, priority: float = 0.0,
                 queue: str = "discovery", now: datetime | None = None, hop: int = 0, business_id: int | None = None) -> list[FrontierUrl]:
    """`enqueue` for many URLs sharing one set of attributes, in a constant number of queries instead of several per URL.

    Same rules as `enqueue`: a known URL keeps its one row (upgraded by a higher priority or the verification queue), a new one is dropped when it
    is too deep, a likely trap, or its domain is at MAX_URLS_PER_DOMAIN. Returns the row of every URL that is queued afterwards (known or new), in
    input order, so `len(result)` is what a per-URL `if enqueue(...)` loop would have counted.

    1. normalise and drop duplicates in memory; 2. one lookup for the rows that already exist; 3. one lookup (plus creation of the missing ones)
    for the domains; 4. under a per-domain lock, one GROUP BY for how full each domain is; 5. one INSERT ... ON CONFLICT DO NOTHING per batch."""
    now = now or utcnow()
    candidates: dict[bytes, str] = {}
    for url in urls:
        try:
            norm = normalize_url(url)
        except ValueError:
            continue
        if depth > MAX_DEPTH or (is_crawl_trap(norm) and source != "user"):
            continue
        candidates.setdefault(url_hash(norm), norm)
    if not candidates:
        return []

    existing: dict[bytes, FrontierUrl] = {}
    hashes = list(candidates)
    for i in range(0, len(hashes), _LOOKUP_CHUNK):
        for row in db.scalars(select(FrontierUrl).where(FrontierUrl.url_hash.in_(hashes[i:i + _LOOKUP_CHUNK]))):
            existing[row.url_hash] = _upgrade(row, priority, queue, now, business_id)
    fresh = {h: u for h, u in candidates.items() if h not in existing}

    if fresh:
        by_host: dict[str, list[bytes]] = {}
        for h, u in fresh.items():
            by_host.setdefault(host_of(u), []).append(h)
        domains = {d.host: d for d in db.scalars(select(BiDomain).where(BiDomain.host.in_(list(by_host))))}
        for host in by_host:
            if host not in domains:
                domains[host] = get_domain(db, host, now)
        _domain_capacity_locks(db, (d.id for d in domains.values()))
        used = dict(db.execute(select(FrontierUrl.domain_id, func.count()).where(FrontierUrl.domain_id.in_([d.id for d in domains.values()]))
                               .group_by(FrontierUrl.domain_id)).all())  # counted after the lock: other batches' committed rows are included
        values = []
        for host, host_hashes in by_host.items():
            domain = domains[host]
            for h in host_hashes[:max(0, MAX_URLS_PER_DOMAIN - used.get(domain.id, 0))]:
                values.append({"domain_id": domain.id, "url": fresh[h], "url_hash": h, "queue": queue, "source": source, "discovered_from": discovered_from,
                               "priority": priority, "depth": depth, "hop": hop, "business_id": business_id, "attempts": 0, "status": "pending",
                               "discovered_at": now, "next_eligible_at": now})
        if values:
            dialect = db.get_bind().dialect.name
            insert = pg_insert if dialect == "postgresql" else sqlite_insert
            for i in range(0, len(values), _LOOKUP_CHUNK):
                db.execute(insert(FrontierUrl).values(values[i:i + _LOOKUP_CHUNK]).on_conflict_do_nothing(index_elements=["url_hash"]))
            for i in range(0, len(values), _LOOKUP_CHUNK):  # the ORM rows, so callers see what a single enqueue() returns
                for row in db.scalars(select(FrontierUrl).where(FrontierUrl.url_hash.in_([v["url_hash"] for v in values[i:i + _LOOKUP_CHUNK]]))):
                    existing[row.url_hash] = row
    return [existing[h] for h in candidates if h in existing]


def claimable(business_id: int, tracked: Iterable[str] = ()):
    """Which frontier rows one business's run may take (needs a join to BiDomain): its own, shared ones, and any row on a domain it tracks.
    The last part matters when businesses overlap (a client is another client's competitor): each can crawl its own site on its own turn."""
    cond = (FrontierUrl.business_id == business_id) | (FrontierUrl.business_id.is_(None))
    tracked = list(tracked)
    return cond | BiDomain.registrable_domain.in_(tracked) if tracked else cond


def take_next(db: Session, limit: int = 10, queues: tuple[str, ...] = QUEUE_ORDER, now: datetime | None = None,
              business_id: int | None = None, tracked: Iterable[str] = ()) -> list[FrontierUrl]:
    """Claim up to `limit` ready URLs: queues in priority order, best priority first, at most one URL per domain per call
    (fairness) and only for domains whose politeness delay has passed. Claimed rows become in_progress.
    With `business_id`, only rows that business may take are claimed (see `claimable`), and a claimed row becomes that business's,
    so the pages found on it are explored on that business's turns."""
    now = now or utcnow()
    picked: list[FrontierUrl] = []
    domains: set[int] = set()
    for q in queues:
        if len(picked) >= limit:
            break
        stmt = (select(FrontierUrl).join(BiDomain, BiDomain.id == FrontierUrl.domain_id)
                .where(FrontierUrl.queue == q, FrontierUrl.status == "pending", FrontierUrl.next_eligible_at <= now,
                       (BiDomain.next_crawl_at.is_(None)) | (BiDomain.next_crawl_at <= now)))
        if business_id is not None:
            stmt = stmt.where(claimable(business_id, tracked))
        # PostgreSQL: rows another run is claiming right now are skipped instead of claimed twice (SQLite ignores this; it has one writer)
        rows = db.scalars(stmt.order_by(FrontierUrl.priority.desc(), FrontierUrl.id).limit(limit * 5).with_for_update(skip_locked=True, of=FrontierUrl))
        for r in rows:
            if r.domain_id in domains:
                continue
            domains.add(r.domain_id)
            r.status, r.next_eligible_at = "in_progress", now  # next_eligible_at doubles as the claim time for stale detection
            if business_id is not None:
                r.business_id = business_id
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


def stats(db: Session, business_id: int | None = None, tracked: Iterable[str] = ()) -> dict[str, dict[str, int]]:
    """Row counts by queue and status: the whole shared frontier, or with `business_id` only that business's rows and rows on the domains it tracks."""
    out: dict[str, dict[str, int]] = {}
    stmt = select(FrontierUrl.queue, FrontierUrl.status, func.count())
    if business_id is not None:
        tracked = list(tracked)
        cond = FrontierUrl.business_id == business_id
        stmt = stmt.join(BiDomain, BiDomain.id == FrontierUrl.domain_id).where(cond | BiDomain.registrable_domain.in_(tracked) if tracked else cond)
    for q, s, n in db.execute(stmt.group_by(FrontierUrl.queue, FrontierUrl.status)):
        out.setdefault(q, {})[s] = n
    return out
