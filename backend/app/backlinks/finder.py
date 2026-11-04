"""Backlink Finder: a thin layer over the shared crawl graph. A business points it at a domain, subdomain or exact URL;
every link the crawler finds pointing at that exact target is recorded, independent of whether the target is also one
of the business's tracked competitors. It never runs its own crawl: it rides the existing discovery bot's crawl
(engine.process_source_page calls record_matches on every page it fetches), so it only finds what that crawl reaches."""
import logging
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import utcnow
from .models import BacklinkFinderResult, BacklinkFinderTarget
from .urls import host_of, normalize_url, registrable_domain

log = logging.getLogger("seo.backlinks.finder")


@dataclass(frozen=True)
class TargetSnapshot:
    """A finder target as plain, immutable data: safe to keep for a whole crawl run and to share between sessions or threads
    (an ORM row is bound to the session that loaded it and would be expired by the next commit)."""
    id: int
    kind: str
    host: str
    normalized_value: str


def load_targets(db: Session) -> tuple[TargetSnapshot, ...]:
    """Every active target (any business), read once. Pass the result as `targets=` to `record_matches` (via the engine) for each page of a run
    instead of reading the table per page; take a new snapshot at the start of the next run, which is when changes to the targets are picked up."""
    return tuple(TargetSnapshot(t.id, t.kind, t.host, t.normalized_value)
                 for t in db.scalars(select(BacklinkFinderTarget).where(BacklinkFinderTarget.active.is_(True)).order_by(BacklinkFinderTarget.id)))


@dataclass
class ParsedTarget:
    kind: str  # domain | subdomain | url
    host: str
    normalized_value: str


def parse_target(raw: str) -> ParsedTarget:
    """Classify what was given: an exact URL (has a path beyond the bare host), a bare registrable domain, or a subdomain of one."""
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("Enter a domain, subdomain or URL")
    host = host_of(raw)
    if not host or "." not in host:
        raise ValueError("Enter a valid domain, subdomain or URL, e.g. example.com, blog.example.com or example.com/page")
    probe = raw if "://" in raw else f"http://{raw}"
    path = (urlsplit(probe).path or "").rstrip("/")
    if path:
        return ParsedTarget(kind="url", host=host, normalized_value=normalize_url(raw))
    reg = registrable_domain(host)
    return ParsedTarget(kind=("domain" if host == reg else "subdomain"), host=host, normalized_value=host)


def matches(target: "BacklinkFinderTarget | TargetSnapshot", link_target_url: str) -> bool:
    if target.kind == "url":
        try:
            return normalize_url(link_target_url) == target.normalized_value
        except ValueError:
            return False
    host = host_of(link_target_url)
    if not host:
        return False
    if target.kind == "domain":
        return host == target.host or host.endswith("." + target.host)
    return host == target.host  # subdomain: exact host only, not its own children


def record_matches(db: Session, source_url: str, source_domain: str, found_links: list, now: datetime | None = None,
                   targets: "tuple[TargetSnapshot, ...] | None" = None) -> int:
    """Check every link found on a crawled page against active finder targets (any business). Stores new matches.
    Returns how many new matches were stored, so the caller can decide whether this source site is worth exploring further.
    `targets` is a snapshot from `load_targets`; without one the table is read now (one query per call)."""
    if not found_links:
        return 0
    targets = load_targets(db) if targets is None else targets
    if not targets:
        return 0
    now = now or utcnow()
    new = 0
    for ln in found_links:
        if ln.internal:
            continue
        for t in targets:
            if not matches(t, ln.target_url):
                continue
            exists = db.scalar(select(BacklinkFinderResult.id).where(
                BacklinkFinderResult.target_id == t.id,
                BacklinkFinderResult.source_url == source_url,
                BacklinkFinderResult.target_url == ln.target_url,
            ))
            if exists:
                continue
            db.add(BacklinkFinderResult(target_id=t.id, source_url=source_url, source_domain=source_domain, target_url=ln.target_url,
                                        anchor_text=ln.anchor_text, link_type=ln.link_type, rel_attributes=ln.rel_attributes, discovered_at=now))
            new += 1
            log.info("Finder match: target=%s found on %s -> %s (anchor=%r)", t.normalized_value, source_url, ln.target_url, ln.anchor_text)
    return new
