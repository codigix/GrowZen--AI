"""Tables of the backlink graph. Current link state (`backlinks`) is kept apart from the history behind it
(`backlink_observations`, `backlink_events`); source claims live in `backlink_provenance` (PRD 7.3, 10, 11)."""
from datetime import date, datetime
from typing import Any

from sqlalchemy import JSON, BigInteger, Date, DateTime, Float, ForeignKey, Index, Integer, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base, TimestampMixin

# BigInteger primary keys must be plain INTEGER on SQLite to autoincrement.
BigPK = BigInteger().with_variant(Integer, "sqlite")


class BiDomain(TimestampMixin, Base):
    __tablename__ = "bi_domains"
    id: Mapped[int] = mapped_column(BigPK, primary_key=True)
    host: Mapped[str] = mapped_column(String(255), unique=True)
    registrable_domain: Mapped[str] = mapped_column(String(255), index=True)
    tld: Mapped[str | None] = mapped_column(String(30))
    first_discovered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_crawled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_crawl_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    crawl_priority: Mapped[float] = mapped_column(Float, default=0.0)
    robots_status: Mapped[str | None] = mapped_column(String(20))  # ok | missing | unreachable | disallow_all
    robots_txt: Mapped[str | None] = mapped_column(Text)
    robots_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BiPage(TimestampMixin, Base):
    __tablename__ = "bi_pages"
    __table_args__ = (UniqueConstraint("domain_id", "url_hash"),)
    id: Mapped[int] = mapped_column(BigPK, primary_key=True)
    domain_id: Mapped[int] = mapped_column(ForeignKey("bi_domains.id", ondelete="CASCADE"), index=True)
    normalized_url: Mapped[str] = mapped_column(Text)
    url_hash: Mapped[bytes] = mapped_column(LargeBinary(32))
    title: Mapped[str | None] = mapped_column(String(500))
    snippet: Mapped[str | None] = mapped_column(String(600))  # meta description or the start of the visible text: what the quality scorer reads
    http_status: Mapped[int | None] = mapped_column(Integer)
    content_hash: Mapped[str | None] = mapped_column(String(64))
    last_crawled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BiTrackedTarget(TimestampMixin, Base):
    """A domain a business monitors: its own site or a competitor's. This is the tenant boundary for the shared graph."""
    __tablename__ = "bi_tracked_targets"
    __table_args__ = (UniqueConstraint("business_id", "domain"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    domain: Mapped[str] = mapped_column(String(255))  # registrable domain
    name: Mapped[str | None] = mapped_column(String(255))
    is_competitor: Mapped[bool] = mapped_column(default=False)
    monitoring_enabled: Mapped[bool] = mapped_column(default=True)


class Backlink(TimestampMixin, Base):
    __tablename__ = "backlinks"
    # Identity: source page + exact target + ordinal of the link among same-target links on that page.
    __table_args__ = (UniqueConstraint("source_page_id", "target_url_hash", "instance"),
                      Index("ix_backlinks_target_status", "target_domain_id", "current_status"))
    id: Mapped[int] = mapped_column(BigPK, primary_key=True)
    source_page_id: Mapped[int] = mapped_column(ForeignKey("bi_pages.id", ondelete="CASCADE"), index=True)
    source_domain_id: Mapped[int] = mapped_column(ForeignKey("bi_domains.id"), index=True)
    target_domain_id: Mapped[int] = mapped_column(ForeignKey("bi_domains.id"))
    target_url: Mapped[str] = mapped_column(Text)
    target_url_hash: Mapped[bytes] = mapped_column(LargeBinary(32))
    instance: Mapped[int] = mapped_column(Integer, default=0)
    anchor_text: Mapped[str | None] = mapped_column(Text)
    anchor_hash: Mapped[bytes | None] = mapped_column(LargeBinary(32))
    link_type: Mapped[str | None] = mapped_column(String(30))  # text | image | other
    rel_attributes: Mapped[list[str]] = mapped_column(JSON, default=list)
    placement: Mapped[str | None] = mapped_column(String(40))
    first_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_status: Mapped[str] = mapped_column(String(30), default="UNKNOWN", index=True)
    verification_status: Mapped[str] = mapped_column(String(30), default="IMPORTED")  # IMPORTED | CRAWLER_VERIFIED | UNVERIFIED
    provider_status: Mapped[str | None] = mapped_column(String(30))  # what a provider claims, never overwritten by our crawl
    absent_count: Mapped[int] = mapped_column(Integer, default=0)  # consecutive successful fetches without the link
    next_verify_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BacklinkProvenance(Base):
    __tablename__ = "backlink_provenance"
    __table_args__ = (UniqueConstraint("backlink_id", "source"),)
    id: Mapped[int] = mapped_column(BigPK, primary_key=True)
    backlink_id: Mapped[int] = mapped_column(ForeignKey("backlinks.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(40))  # codigix_crawler | manual_import | csv_import | ...
    provider_record_id: Mapped[str | None] = mapped_column(String(120))
    provider_observed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    license_class: Mapped[str] = mapped_column(String(30), default="internal")  # internal | restricted | public
    raw_payload_ref: Mapped[str | None] = mapped_column(String(500))


class BacklinkObservation(Base):
    __tablename__ = "backlink_observations"
    id: Mapped[int] = mapped_column(BigPK, primary_key=True)
    backlink_id: Mapped[int] = mapped_column(ForeignKey("backlinks.id", ondelete="CASCADE"), index=True)
    observation_type: Mapped[str] = mapped_column(String(30))  # crawler | import
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    source_http_status: Mapped[int | None] = mapped_column(Integer)
    target_http_status: Mapped[int | None] = mapped_column(Integer)
    anchor_text: Mapped[str | None] = mapped_column(Text)
    rel_attributes: Mapped[list[str] | None] = mapped_column(JSON)
    link_found: Mapped[bool | None] = mapped_column()
    verification_method: Mapped[str | None] = mapped_column(String(30))
    detail: Mapped[dict[str, Any] | None] = mapped_column(JSON)  # e.g. redirect chain, error code


class BacklinkEvent(Base):
    __tablename__ = "backlink_events"
    id: Mapped[int] = mapped_column(BigPK, primary_key=True)
    backlink_id: Mapped[int] = mapped_column(ForeignKey("backlinks.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(30), index=True)
    previous_value: Mapped[str | None] = mapped_column(Text)
    new_value: Mapped[str | None] = mapped_column(Text)
    event_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    confirmation_count: Mapped[int] = mapped_column(Integer, default=0)
    evidence_observation_id: Mapped[int | None] = mapped_column(ForeignKey("backlink_observations.id", ondelete="SET NULL"))


class FrontierUrl(Base):
    """Persistent URL frontier: deduplicated by URL hash, with queue, priority, depth and politeness timing (PRD 9.2)."""
    __tablename__ = "bi_frontier"
    __table_args__ = (Index("ix_frontier_ready", "queue", "status", "next_eligible_at"),)
    id: Mapped[int] = mapped_column(BigPK, primary_key=True)
    domain_id: Mapped[int] = mapped_column(ForeignKey("bi_domains.id", ondelete="CASCADE"), index=True)
    url: Mapped[str] = mapped_column(Text)
    url_hash: Mapped[bytes] = mapped_column(LargeBinary(32), unique=True)
    queue: Mapped[str] = mapped_column(String(20), default="discovery")  # discovery | recrawl | verification | retry
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | in_progress | done | dead | blocked
    source: Mapped[str] = mapped_column(String(30), default="link")  # seed | sitemap | link | recheck | common_crawl | user
    discovered_from: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[float] = mapped_column(Float, default=0.0)
    depth: Mapped[int] = mapped_column(Integer, default=0)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    hop: Mapped[int | None] = mapped_column(Integer, default=0)  # external-link hops from a tracked domain; bounds how far the bot wanders
    discovered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    next_eligible_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(String(200))


class CrawlAttempt(Base):
    __tablename__ = "bi_crawl_attempts"
    id: Mapped[int] = mapped_column(BigPK, primary_key=True)
    url: Mapped[str] = mapped_column(Text)
    domain_id: Mapped[int | None] = mapped_column(ForeignKey("bi_domains.id", ondelete="SET NULL"), index=True)
    purpose: Mapped[str] = mapped_column(String(20), default="discovery")  # discovery | verification | robots | sitemap
    http_status: Mapped[int | None] = mapped_column(Integer)
    response_time_ms: Mapped[int | None] = mapped_column(Integer)
    response_bytes: Mapped[int | None] = mapped_column(Integer)
    error_code: Mapped[str | None] = mapped_column(String(40))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class BiDomainReview(TimestampMixin, Base):
    """A business's decision about one referring domain: whitelist it, disavow it, or track an outreach to get it removed."""
    __tablename__ = "bi_domain_reviews"
    __table_args__ = (UniqueConstraint("business_id", "target_domain", "source_domain"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    target_domain: Mapped[str] = mapped_column(String(255))
    source_domain: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(20))  # whitelisted | disavow | to_contact | not_replied | replied | removed


class BiBotConfig(TimestampMixin, Base):
    """Settings and last-run state of the autonomous discovery bot, per business."""
    __tablename__ = "bi_bot_config"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), unique=True)
    enabled: Mapped[bool] = mapped_column(default=False)
    pages_per_run: Mapped[int] = mapped_column(Integer, default=50)
    interval_minutes: Mapped[int] = mapped_column(Integer, default=30)
    max_hops: Mapped[int] = mapped_column(Integer, default=2)
    render_js: Mapped[bool | None] = mapped_column(default=False)  # read JavaScript-built pages with headless Chrome (slow; capped per run)
    watch_enabled: Mapped[bool | None] = mapped_column(default=True)  # weekly competitor watch (None counts as on)
    watch_last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    watch_running: Mapped[bool | None] = mapped_column(default=False)
    watch_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    running: Mapped[bool] = mapped_column(default=False)
    run_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_stats: Mapped[dict[str, Any] | None] = mapped_column(JSON)


class BacklinkFinderTarget(TimestampMixin, Base):
    """A domain, subdomain or exact URL a business wants watched for backlinks, independent of the tracked-competitor set."""
    __tablename__ = "bi_finder_targets"
    __table_args__ = (UniqueConstraint("business_id", "normalized_value"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    raw_value: Mapped[str] = mapped_column(String(500))  # exactly what the user typed
    kind: Mapped[str] = mapped_column(String(10))  # domain | subdomain | url
    host: Mapped[str] = mapped_column(String(255), index=True)
    normalized_value: Mapped[str] = mapped_column(String(500))  # host (domain/subdomain) or normalized URL (url)
    active: Mapped[bool] = mapped_column(default=True)


class BacklinkFinderResult(Base):
    """One link found by the crawler pointing at a finder target."""
    __tablename__ = "bi_finder_results"
    __table_args__ = (UniqueConstraint("target_id", "source_url", "target_url"),)
    id: Mapped[int] = mapped_column(BigPK, primary_key=True)
    target_id: Mapped[int] = mapped_column(ForeignKey("bi_finder_targets.id", ondelete="CASCADE"), index=True)
    source_url: Mapped[str] = mapped_column(Text)
    source_domain: Mapped[str] = mapped_column(String(255))
    target_url: Mapped[str] = mapped_column(Text)
    anchor_text: Mapped[str | None] = mapped_column(Text)
    link_type: Mapped[str | None] = mapped_column(String(30))
    rel_attributes: Mapped[list[str]] = mapped_column(JSON, default=list)
    discovered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class BiDomainScore(TimestampMixin, Base):
    """How good a referring domain is for one business: relevance to its niche and spam risk, with the reason. Ours, not a third party's."""
    __tablename__ = "bi_domain_scores"
    __table_args__ = (UniqueConstraint("business_id", "source_domain"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    source_domain: Mapped[str] = mapped_column(String(255))
    relevance: Mapped[int] = mapped_column(Integer)  # 0-100: how well the linking site fits the business's niche
    risk: Mapped[int] = mapped_column(Integer)  # 0-100: how spammy or manipulative it looks
    verdict: Mapped[str] = mapped_column(String(10))  # good | ok | risky
    reason: Mapped[str] = mapped_column(String(400))
    method: Mapped[str] = mapped_column(String(10))  # ai | rules
    model: Mapped[str | None] = mapped_column(String(60))
    scored_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ActionOutcome(Base):
    """What an action changed. A baseline is taken when the action happens and measured again after 14 and 30 days."""
    __tablename__ = "action_outcomes"
    __table_args__ = (UniqueConstraint("business_id", "action_kind", "ref", "check_days"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    action_kind: Mapped[str] = mapped_column(String(40))  # outreach_email | website_fix | blog_draft | gbp_post | review_reply | removal_request ...
    ref: Mapped[str] = mapped_column(String(80))  # what it refers to, e.g. "task:12" or "domain:spammy.shop"
    title: Mapped[str] = mapped_column(String(300))
    check_days: Mapped[int] = mapped_column(Integer)  # 14 or 30
    baseline: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    measured: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    verdict: Mapped[str | None] = mapped_column(String(12))  # improved | flat | worse | unknown
    measured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WatchPage(Base):
    """The last known state of one page on a competitor's site; the next weekly visit is compared with it."""
    __tablename__ = "competitor_watch_pages"
    __table_args__ = (UniqueConstraint("business_id", "url_hash"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    domain: Mapped[str] = mapped_column(String(255), index=True)
    url: Mapped[str] = mapped_column(Text)
    url_hash: Mapped[bytes] = mapped_column(LargeBinary(32))
    title: Mapped[str | None] = mapped_column(String(500))
    h1: Mapped[str | None] = mapped_column(String(500))
    snippet: Mapped[str | None] = mapped_column(String(600))
    content_hash: Mapped[str | None] = mapped_column(String(64))
    words: Mapped[int] = mapped_column(Integer, default=0)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    missing_runs: Mapped[int] = mapped_column(Integer, default=0)  # consecutive visits where the sitemap no longer listed it
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # tombstone: gone (404/410); kept so a stale sitemap cannot make it "new" again


class WatchEvent(Base):
    __tablename__ = "competitor_watch_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    domain: Mapped[str] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(12))  # new_page | changed | removed
    url: Mapped[str] = mapped_column(Text)
    title: Mapped[str | None] = mapped_column(String(500))
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class WatchReport(Base):
    __tablename__ = "competitor_watch_reports"
    __table_args__ = (UniqueConstraint("business_id", "week_start"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    week_start: Mapped[date] = mapped_column(Date)
    summary: Mapped[dict[str, Any]] = mapped_column(JSON)  # headline, summary, what_it_means, actions, highlights
    source: Mapped[str] = mapped_column(String(10))  # ai | rules
    events: Mapped[int] = mapped_column(Integer, default=0)
    baseline: Mapped[bool] = mapped_column(default=False)  # the first visit only records what is there; it reports no changes
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
