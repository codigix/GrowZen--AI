from datetime import datetime, timezone

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# JSONB on PostgreSQL, plain JSON elsewhere (tests run on SQLite).
JsonType = JSON().with_variant(JSONB(), "postgresql")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    """Own metadata: these tables never mix with the platform's Alembic-managed ones (all are prefixed bl_)."""


class Seed(Base):
    """A website the crawler reads for outgoing links. Starts from seed.json, grows as new sites are discovered."""
    __tablename__ = "bl_seeds"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    url: Mapped[str] = mapped_column(String(2048))
    site_key: Mapped[str] = mapped_column(String(255), unique=True)       # registrable domain: one row per website
    source: Mapped[str] = mapped_column(String(16), default="seed")       # seed (seed.json) | discovered
    status: Mapped[str] = mapped_column(String(16), default="pending")    # pending | crawling | done | failed
    next_crawl_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_crawled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    crawl_count: Mapped[int] = mapped_column(Integer, default=0)
    pages_crawled: Mapped[int] = mapped_column(Integer, default=0)        # pages read in the last crawl
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (Index("ix_bl_seeds_due", "status", "next_crawl_at"),)


class Target(Base):
    """A site/page the user wants backlinks for. The crawler checks every page it reads against all targets."""
    __tablename__ = "bl_targets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    target: Mapped[str] = mapped_column(String(2048), unique=True)        # canonical form, e.g. https://codigix.co/
    match_mode: Mapped[str] = mapped_column(String(8))                    # domain (incl. subdomains) | exact (one page)
    domain: Mapped[str] = mapped_column(String(255))                      # without www.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Control(Base):
    """One row (id 1): the signal between the API process and the crawler process."""
    __tablename__ = "bl_control"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    crawl_enabled: Mapped[bool] = mapped_column(Boolean, default=False)   # set by POST /backlinks/crawl, cleared when the crawler starts
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Slot(Base):
    """One row (id 1): which group of businesses is being searched, and since when (survives restarts)."""
    __tablename__ = "bl_slot"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slot_index: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Backlink(Base):
    """One link from a page on another site to a target. Unique per (source page, target page)."""
    __tablename__ = "bl_backlinks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    link_hash: Mapped[str] = mapped_column(String(32), unique=True)       # md5(source_url|target_key): keeps the unique index small
    source_url: Mapped[str] = mapped_column(String(2048))
    source_site: Mapped[str] = mapped_column(String(255), index=True)     # site_key of the linking page
    source_title: Mapped[str] = mapped_column(String(255), default="")
    target_url: Mapped[str] = mapped_column(String(2048))                 # as linked (normalized)
    target_key: Mapped[str] = mapped_column(String(2048))                 # host(no www)+path+query: www / trailing-slash safe
    target_host: Mapped[str] = mapped_column(String(255))                 # host without www.
    target_site: Mapped[str] = mapped_column(String(255), index=True)     # site_key of the target
    anchor_text: Mapped[str] = mapped_column(String(255), default="")
    context: Mapped[str] = mapped_column(Text, default="")
    found_in: Mapped[str] = mapped_column(String(8), default="html")      # html | script
    link_type: Mapped[str] = mapped_column(String(8), default="dofollow") # dofollow | nofollow
    rel: Mapped[list] = mapped_column(JsonType, default=list)
    crawl_depth: Mapped[int] = mapped_column(Integer, default=0)
    discovered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        Index("ix_bl_backlinks_target_host", "target_host"),
    )


class AhrefsReport(Base):
    """One lookup of a domain on the Ahrefs free Backlink Checker (run through the Fortress browser). A new row per lookup, so earlier
    snapshots stay as history. The numbers are kept as Ahrefs shows them (text) and as parsed numbers (for sorting and filtering)."""
    __tablename__ = "bl_ahrefs_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    domain: Mapped[str] = mapped_column(String(255))                      # without www.
    mode: Mapped[str] = mapped_column(String(12), default="subdomains")   # subdomains | exact | prefix | domain
    status: Mapped[str] = mapped_column(String(10), default="queued")     # queued | running | done | failed
    error: Mapped[str | None] = mapped_column(Text)
    domain_rating: Mapped[float | None] = mapped_column(Float)
    backlinks_value: Mapped[str | None] = mapped_column(String(20))       # as shown, e.g. "883" or "1.2K"
    backlinks_count: Mapped[int | None] = mapped_column(BigInteger)
    backlinks_dofollow_pct: Mapped[int | None] = mapped_column(Integer)
    linking_websites_value: Mapped[str | None] = mapped_column(String(20))
    linking_websites_count: Mapped[int | None] = mapped_column(BigInteger)
    linking_websites_dofollow_pct: Mapped[int | None] = mapped_column(Integer)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("ix_bl_ahrefs_reports_lookup", "domain", "mode", "status"),)


class AhrefsPage(Base):
    """One row of the referring-pages table of an Ahrefs report (a page that links to the domain)."""
    __tablename__ = "bl_ahrefs_pages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("bl_ahrefs_reports.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)                        # order in Ahrefs' table
    dr: Mapped[int | None] = mapped_column(Integer)                       # Ahrefs Domain Rating of the linking site
    page_title: Mapped[str] = mapped_column(Text, default="")
    page_url: Mapped[str | None] = mapped_column(Text)
    anchor_text: Mapped[str] = mapped_column(Text, default="")
    target_url: Mapped[str | None] = mapped_column(Text)
    redirects: Mapped[list] = mapped_column(JsonType, default=list)
