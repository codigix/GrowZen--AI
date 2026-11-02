"""Get-or-create helpers and the provenance-preserving link upsert used for links supplied from outside the crawler."""
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import utcnow
from .models import Backlink, BacklinkEvent, BacklinkObservation, BacklinkProvenance, BiDomain, BiPage
from .urls import host_of, normalize_url, registrable_domain, text_hash, url_hash


def get_domain(db: Session, host_or_url: str, now: datetime | None = None) -> BiDomain:
    host = host_of(host_or_url)
    if not host:
        raise ValueError(f"No hostname in {host_or_url!r}")
    d = db.scalar(select(BiDomain).where(BiDomain.host == host))
    if d is None:
        reg = registrable_domain(host)
        d = BiDomain(host=host, registrable_domain=reg, tld=reg.split(".", 1)[-1] if "." in reg else None, first_discovered_at=now or utcnow())
        db.add(d)
        db.flush()
    return d


def get_page(db: Session, url: str) -> BiPage:
    norm = normalize_url(url)
    domain = get_domain(db, norm)
    h = url_hash(norm)
    p = db.scalar(select(BiPage).where(BiPage.domain_id == domain.id, BiPage.url_hash == h))
    if p is None:
        p = BiPage(domain_id=domain.id, normalized_url=norm, url_hash=h)
        db.add(p)
        db.flush()
    return p


@dataclass
class LinkRecord:
    """A link claim from outside the crawler (a CSV import, a dataset, a manual entry)."""
    source_url: str
    target_url: str
    anchor_text: str | None = None
    rel_attributes: list[str] | None = None
    link_type: str | None = None
    placement: str | None = None
    first_seen: datetime | None = None
    last_seen: datetime | None = None
    is_lost: bool = False
    record_id: str | None = None
    instance: int = 0
    raw_ref: str | None = None


def upsert_imported_link(db: Session, rec: LinkRecord, source: str, license_class: str = "internal",
                         now: datetime | None = None) -> tuple[Backlink, bool]:
    """Insert or refresh a link supplied from outside the crawler. Records it as unverified (verification_status IMPORTED) and never touches
    the status of a link our crawler has verified. The same link from several sources stays one row with one provenance row per source."""
    now = now or utcnow()
    page = get_page(db, rec.source_url)
    target_norm = normalize_url(rec.target_url)
    target_domain = get_domain(db, target_norm)
    th = url_hash(target_norm)
    bl = db.scalar(select(Backlink).where(Backlink.source_page_id == page.id, Backlink.target_url_hash == th, Backlink.instance == rec.instance))
    created = bl is None
    if created:
        bl = Backlink(source_page_id=page.id, source_domain_id=page.domain_id, target_domain_id=target_domain.id, target_url=target_norm, target_url_hash=th,
                      instance=rec.instance, anchor_text=rec.anchor_text, anchor_hash=text_hash(rec.anchor_text), link_type=rec.link_type,
                      rel_attributes=sorted(rec.rel_attributes or []), placement=rec.placement, first_seen_at=rec.first_seen or now,
                      last_seen_at=rec.last_seen or now, current_status="UNKNOWN" if rec.is_lost else "NEW", verification_status="IMPORTED",
                      provider_status="LOST" if rec.is_lost else "LIVE", next_verify_at=now)
        db.add(bl)
        db.flush()
        if not rec.is_lost:
            db.add(BacklinkEvent(backlink_id=bl.id, event_type="NEW", new_value="NEW", event_at=now, previous_value=None))
    else:
        bl.provider_status = "LOST" if rec.is_lost else "LIVE"
        if bl.verification_status != "CRAWLER_VERIFIED":  # imported data fills gaps but never overrides our own evidence
            bl.last_seen_at = max(filter(None, [bl.last_seen_at, rec.last_seen]), default=bl.last_seen_at)
            bl.anchor_text = rec.anchor_text or bl.anchor_text
            bl.anchor_hash = text_hash(bl.anchor_text)
            bl.rel_attributes = sorted(rec.rel_attributes or bl.rel_attributes or [])
        if rec.first_seen and (bl.first_seen_at is None or rec.first_seen < bl.first_seen_at):
            bl.first_seen_at = rec.first_seen
    db.add(BacklinkObservation(backlink_id=bl.id, observation_type="import", observed_at=rec.last_seen or now, anchor_text=rec.anchor_text,
                               rel_attributes=sorted(rec.rel_attributes or []), link_found=not rec.is_lost, verification_method=source))
    prov = db.scalar(select(BacklinkProvenance).where(BacklinkProvenance.backlink_id == bl.id, BacklinkProvenance.source == source))
    if prov is None:
        db.add(BacklinkProvenance(backlink_id=bl.id, source=source, provider_record_id=rec.record_id, provider_observed_at=rec.last_seen, imported_at=now,
                                  license_class=license_class, raw_payload_ref=rec.raw_ref))
    else:
        prov.provider_record_id, prov.provider_observed_at, prov.imported_at = rec.record_id or prov.provider_record_id, rec.last_seen, now
    return bl, created
