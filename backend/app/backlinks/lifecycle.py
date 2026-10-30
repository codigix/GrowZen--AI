"""Backlink status lifecycle (PRD 10.2): evidence in, state + history events out.

Rules that matter most:
- A source page that could not be fetched properly (timeout, 403, 429, 5xx, robots-blocked, truncated) is *not* evidence the
  link is gone: the last confirmed state is kept and only an observation is recorded.
- Absence on a complete fetch moves the link to LOST_PENDING; LOST_CONFIRMED needs `LOST_CONFIRM_AFTER` consecutive absences.
- rel attributes (nofollow, sponsored, ugc) are properties of a live link, never a reason to call it lost.
"""
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from ..db import utcnow
from .models import Backlink, BacklinkEvent, BacklinkObservation
from .urls import text_hash

LOST_CONFIRM_AFTER = 2  # consecutive successful fetches without the link
REVERIFY_LIVE = timedelta(days=7)
REVERIFY_PENDING = timedelta(days=1)
REVERIFY_LOST = timedelta(days=14)

# States in which the link is present on the page (counted as current backlinks).
LIVE_STATES = frozenset({"NEW", "LIVE", "RESTORED", "CHANGED", "BROKEN_TARGET", "REDIRECTED_SOURCE"})
LOST_STATES = frozenset({"LOST_PENDING", "LOST_CONFIRMED"})
ALL_STATES = LIVE_STATES | LOST_STATES | {"SOURCE_UNAVAILABLE", "UNKNOWN"}

# HTTP statuses on the source page that say "the page is gone" rather than "we failed to read it".
GONE_STATUSES = frozenset({404, 410})


@dataclass
class LinkEvidence:
    """What a successful fetch of the source page showed for one link."""
    anchor_text: str | None = None
    rel_attributes: list[str] = field(default_factory=list)
    placement: str | None = None
    link_type: str | None = None


@dataclass
class FetchEvidence:
    source_http_status: int | None  # None = no response (timeout, DNS, blocked by robots/SSRF policy)
    complete: bool = True  # False when the body was truncated/size-capped
    link: LinkEvidence | None = None  # the link as found, None = absent from the page
    target_http_status: int | None = None
    redirected_to: str | None = None  # source page resolved through a redirect to this URL
    method: str = "http_fetch"
    error_code: str | None = None

    @property
    def readable(self) -> bool:
        s = self.source_http_status
        return bool(self.complete and s is not None and (200 <= s < 300 or s in GONE_STATUSES))


def _event(db: Session, bl: Backlink, kind: str, now: datetime, obs: BacklinkObservation | None, prev: str | None = None, new: str | None = None,
           confirmations: int = 0) -> BacklinkEvent:
    ev = BacklinkEvent(backlink_id=bl.id, event_type=kind, previous_value=prev, new_value=new, event_at=now, confirmation_count=confirmations,
                       evidence_observation_id=obs.id if obs else None)
    db.add(ev)
    return ev


def next_verify_delay(status: str) -> timedelta:
    if status == "LOST_PENDING":
        return REVERIFY_PENDING
    if status == "LOST_CONFIRMED":
        return REVERIFY_LOST
    return REVERIFY_LIVE


def apply_crawl_observation(db: Session, bl: Backlink, ev: FetchEvidence, now: datetime | None = None) -> Backlink:
    """Record one source-page observation and move the backlink through its lifecycle. Caller commits."""
    now = now or utcnow()
    obs = BacklinkObservation(backlink_id=bl.id, observation_type="crawler", observed_at=now, source_http_status=ev.source_http_status,
                              target_http_status=ev.target_http_status, anchor_text=ev.link.anchor_text if ev.link else None,
                              rel_attributes=list(ev.link.rel_attributes) if ev.link else None,
                              link_found=(ev.link is not None) if ev.readable else None, verification_method=ev.method,
                              detail={k: v for k, v in {"error_code": ev.error_code, "redirected_to": ev.redirected_to, "complete": ev.complete}.items() if v is not None})
    db.add(obs)
    db.flush()
    bl.last_verified_at = now
    prior = bl.current_status

    if not ev.readable:
        # No evidence either way. Retain the last confirmed state; only a never-established link is marked unavailable.
        if prior in ("UNKNOWN", None):
            bl.current_status = "SOURCE_UNAVAILABLE"
        bl.next_verify_at = now + timedelta(days=1)
        return bl

    if ev.link is None or ev.source_http_status in GONE_STATUSES:
        bl.absent_count = (bl.absent_count or 0) + 1
        if prior == "LOST_CONFIRMED":
            pass
        elif bl.absent_count >= LOST_CONFIRM_AFTER:
            bl.current_status = "LOST_CONFIRMED"
            _event(db, bl, "LOST_CONFIRMED", now, obs, prior, "LOST_CONFIRMED", bl.absent_count)
        elif prior != "LOST_PENDING":
            bl.current_status = "LOST_PENDING"
            _event(db, bl, "LOST_PENDING", now, obs, prior, "LOST_PENDING", bl.absent_count)
        bl.verification_status = "CRAWLER_VERIFIED"
        bl.next_verify_at = now + next_verify_delay(bl.current_status)
        return bl

    # Link present on a readable page.
    link = ev.link
    bl.absent_count = 0
    bl.last_seen_at = now
    bl.verification_status = "CRAWLER_VERIFIED"
    if bl.first_seen_at is None:
        bl.first_seen_at = now

    status = "LIVE"
    if prior == "LOST_CONFIRMED":
        status = "RESTORED"
        _event(db, bl, "RESTORED", now, obs, prior, "RESTORED")
    elif prior == "LOST_PENDING":
        _event(db, bl, "LOST_CANCELLED", now, obs, prior, "LIVE")
    elif prior in ("UNKNOWN", None, "SOURCE_UNAVAILABLE"):
        status = "NEW"
        _event(db, bl, "NEW", now, obs, None, "NEW")

    changed = False
    old_rel, new_rel = sorted(bl.rel_attributes or []), sorted(link.rel_attributes or [])
    if prior not in ("UNKNOWN", None, "SOURCE_UNAVAILABLE"):  # first sight has nothing to compare with
        if (bl.anchor_text or "") != (link.anchor_text or "") and (link.anchor_text is not None or bl.anchor_text is not None):
            _event(db, bl, "ANCHOR_CHANGED", now, obs, bl.anchor_text, link.anchor_text)
            changed = True
        if old_rel != new_rel:
            _event(db, bl, "REL_CHANGED", now, obs, ",".join(old_rel), ",".join(new_rel))
            changed = True
        if bl.placement and link.placement and bl.placement != link.placement:
            _event(db, bl, "PLACEMENT_CHANGED", now, obs, bl.placement, link.placement)
            changed = True
    bl.anchor_text, bl.anchor_hash = link.anchor_text, text_hash(link.anchor_text)
    bl.rel_attributes = list(link.rel_attributes or [])
    bl.placement = link.placement or bl.placement
    bl.link_type = link.link_type or bl.link_type

    if ev.redirected_to:
        _event(db, bl, "REDIRECT_CHANGED", now, obs, None, ev.redirected_to)
    if changed and status == "LIVE":
        status = "CHANGED"
    if ev.target_http_status is not None and ev.target_http_status >= 400:
        status = "BROKEN_TARGET"
        if prior != "BROKEN_TARGET":
            _event(db, bl, "BROKEN_TARGET", now, obs, None, str(ev.target_http_status))
    elif ev.redirected_to and status == "LIVE":
        status = "REDIRECTED_SOURCE"
    bl.current_status = status
    bl.next_verify_at = now + next_verify_delay(status)
    return bl
