"""Database tables of the SEO platform (its own database; nothing shared with the CRM).

One business = one client profile. Everything else hangs off it: Google connection, audits,
reviews, posts, keywords, rank scans, leads, schedules and the AI agent's tasks.
"""
from datetime import date, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, TimestampMixin, utcnow


class AppUser(TimestampMixin, Base):
    """The platform's own accounts (email + password)."""
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="editor")  # admin | editor | viewer
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class GoogleConnection(TimestampMixin, Base):
    """A Google account connected with the business.manage permission."""
    __tablename__ = "google_connections"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    display_name: Mapped[str | None] = mapped_column(String(255))
    refresh_token_enc: Mapped[str | None] = mapped_column(Text)  # encrypted (Fernet)
    scopes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | revoked | error
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    connected_by: Mapped[str | None] = mapped_column(String(120))


class Business(TimestampMixin, Base):
    __tablename__ = "businesses"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    primary_category: Mapped[str | None] = mapped_column(String(160))
    secondary_categories: Mapped[list[str]] = mapped_column(JSON, default=list)
    description: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(String(40), index=True)
    website: Mapped[str | None] = mapped_column(String(500))
    address: Mapped[str | None] = mapped_column(String(500))
    area: Mapped[str | None] = mapped_column(String(120))
    city: Mapped[str | None] = mapped_column(String(120))
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    service_area: Mapped[str | None] = mapped_column(String(500))
    services: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)  # [{name, price, description}]
    attributes: Mapped[list[str]] = mapped_column(JSON, default=list)
    hours: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    special_hours: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    faqs: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, default=list)  # [{q, a}] for Q&A, FAQ schema
    tone: Mapped[str | None] = mapped_column(String(255))
    usps: Mapped[str | None] = mapped_column(Text)
    languages: Mapped[str | None] = mapped_column(String(120))
    # Client details from onboarding
    plan: Mapped[str | None] = mapped_column(String(40))  # Starter | Growth | Pro | Agency
    contact_name: Mapped[str | None] = mapped_column(String(160))
    contact_email: Mapped[str | None] = mapped_column(String(255))
    source: Mapped[str] = mapped_column(String(20), default="manual")  # email | google | search | manual
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | needs_approval | paused
    # Google Business Profile link
    connection_id: Mapped[int | None] = mapped_column(ForeignKey("google_connections.id", ondelete="SET NULL"))
    gbp_account: Mapped[str | None] = mapped_column(String(120))  # "accounts/123"
    gbp_location: Mapped[str | None] = mapped_column(String(120), unique=True)  # "locations/456"
    place_id: Mapped[str | None] = mapped_column(String(200))
    verification: Mapped[str] = mapped_column(String(20), default="unknown")  # verified | unverified | suspended | unknown
    duplicate_listing: Mapped[bool] = mapped_column(Boolean, default=False)
    rating: Mapped[float | None] = mapped_column(Float)
    review_count: Mapped[int | None] = mapped_column(Integer)
    photo_count: Mapped[int | None] = mapped_column(Integer)
    cover_photo: Mapped[str | None] = mapped_column(String(500))
    logo: Mapped[str | None] = mapped_column(String(500))
    booking_url: Mapped[str | None] = mapped_column(String(500))
    created_by: Mapped[str | None] = mapped_column(String(120))
    last_audit_score: Mapped[int | None] = mapped_column(Integer)

    connection: Mapped[GoogleConnection | None] = relationship()


class IntakeEmail(TimestampMixin, Base):
    """An onboarding email from the forwarding mailbox (or the inbound webhook)."""
    __tablename__ = "intake_emails"
    id: Mapped[int] = mapped_column(primary_key=True)
    message_id: Mapped[str] = mapped_column(String(500), unique=True)
    from_addr: Mapped[str] = mapped_column(String(255))
    subject: Mapped[str | None] = mapped_column(String(500))
    body: Mapped[str] = mapped_column(Text)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    status: Mapped[str] = mapped_column(String(20), default="waiting")  # waiting | processing | done | needs_info | failed | rejected
    extracted: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    missing: Mapped[list[str]] = mapped_column(JSON, default=list)
    steps: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)  # pipeline progress
    error: Mapped[str | None] = mapped_column(Text)
    business_id: Mapped[int | None] = mapped_column(ForeignKey("businesses.id", ondelete="SET NULL"))


class Audit(TimestampMixin, Base):
    __tablename__ = "audits"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int | None] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # gbp | technical | onpage | rankings | backlinks | citations | geo | website
    target: Mapped[str | None] = mapped_column(String(500))  # URL for website audits
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued | running | done | failed
    score: Mapped[int | None] = mapped_column(Integer)
    data_source: Mapped[str] = mapped_column(String(20), default="live")  # live | sample
    result: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    issues: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)  # [{area, level, title, fix, count}]
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Review(TimestampMixin, Base):
    __tablename__ = "reviews"
    __table_args__ = (UniqueConstraint("business_id", "external_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    external_id: Mapped[str | None] = mapped_column(String(255))  # Google review name
    author: Mapped[str | None] = mapped_column(String(160))
    rating: Mapped[int] = mapped_column(Integer)
    body: Mapped[str | None] = mapped_column(Text)
    review_date: Mapped[date | None] = mapped_column(Date)
    reply_text: Mapped[str | None] = mapped_column(Text)
    reply_status: Mapped[str] = mapped_column(String(20), default="none")  # none | draft | approved | posted
    reply_language: Mapped[str | None] = mapped_column(String(20))
    replied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sentiment: Mapped[str | None] = mapped_column(String(10))
    topics: Mapped[list[str]] = mapped_column(JSON, default=list)


class Post(TimestampMixin, Base):
    __tablename__ = "posts"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    post_type: Mapped[str] = mapped_column(String(20), default="Update")  # Update | Offer | Event
    title: Mapped[str | None] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    cta_type: Mapped[str | None] = mapped_column(String(30))
    cta_url: Mapped[str | None] = mapped_column(String(500))
    image_url: Mapped[str | None] = mapped_column(String(1000))
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft | scheduled | published | failed
    external_id: Mapped[str | None] = mapped_column(String(255))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ai_generated: Mapped[bool] = mapped_column(Boolean, default=False)


class Keyword(TimestampMixin, Base):
    __tablename__ = "keywords"
    __table_args__ = (UniqueConstraint("business_id", "keyword"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    keyword: Mapped[str] = mapped_column(String(255))
    volume: Mapped[int | None] = mapped_column(Integer)
    difficulty: Mapped[int | None] = mapped_column(Integer)
    cpc: Mapped[float | None] = mapped_column(Float)
    intent: Mapped[str | None] = mapped_column(String(20))
    cluster: Mapped[str | None] = mapped_column(String(160))
    target_url: Mapped[str | None] = mapped_column(String(500))
    rank: Mapped[int | None] = mapped_column(Integer)
    prev_rank: Mapped[int | None] = mapped_column(Integer)
    rank_checked_at: Mapped[date | None] = mapped_column(Date)
    priority: Mapped[str] = mapped_column(String(10), default="Medium")
    tracked: Mapped[bool] = mapped_column(Boolean, default=True)


class RankScan(TimestampMixin, Base):
    __tablename__ = "rank_scans"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    keyword: Mapped[str] = mapped_column(String(255))
    grid_size: Mapped[int] = mapped_column(Integer)
    radius_km: Mapped[float] = mapped_column(Float)
    points: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)  # [{x, y, lat, lng, rank}]
    avg_rank: Mapped[float | None] = mapped_column(Float)
    top3: Mapped[int] = mapped_column(Integer, default=0)
    found: Mapped[int] = mapped_column(Integer, default=0)
    competitors: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    data_source: Mapped[str] = mapped_column(String(20), default="sample")


class GeoPrompt(TimestampMixin, Base):
    __tablename__ = "geo_prompts"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    prompt: Mapped[str] = mapped_column(String(500))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class GeoResult(TimestampMixin, Base):
    __tablename__ = "geo_results"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    prompt_id: Mapped[int] = mapped_column(ForeignKey("geo_prompts.id", ondelete="CASCADE"), index=True)
    engine: Mapped[str] = mapped_column(String(40))
    mentioned: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int | None] = mapped_column(Integer)
    sentiment: Mapped[str | None] = mapped_column(String(10))
    competitors: Mapped[list[str]] = mapped_column(JSON, default=list)
    cited_urls: Mapped[list[str]] = mapped_column(JSON, default=list)
    answer_excerpt: Mapped[str | None] = mapped_column(Text)
    data_source: Mapped[str] = mapped_column(String(20), default="live")


class Lead(TimestampMixin, Base):
    __tablename__ = "leads"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    lead_type: Mapped[str] = mapped_column(String(20), default="call")  # call | whatsapp | form | direction | booking
    name: Mapped[str | None] = mapped_column(String(160))
    contact: Mapped[str | None] = mapped_column(String(160))
    message: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str | None] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(20), default="new")  # new | contacted | won | lost
    lead_date: Mapped[date | None] = mapped_column(Date)


class InsightDay(Base):
    """Daily Business Profile performance (calls, directions, clicks, views)."""
    __tablename__ = "insights_daily"
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    calls: Mapped[int] = mapped_column(Integer, default=0)
    directions: Mapped[int] = mapped_column(Integer, default=0)
    website_clicks: Mapped[int] = mapped_column(Integer, default=0)
    views_search: Mapped[int] = mapped_column(Integer, default=0)
    views_maps: Mapped[int] = mapped_column(Integer, default=0)
    bookings: Mapped[int] = mapped_column(Integer, default=0)


class Schedule(TimestampMixin, Base):
    __tablename__ = "schedules"
    __table_args__ = (UniqueConstraint("business_id", "job"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    job: Mapped[str] = mapped_column(String(30))  # full_audit | rank_scan | reviews | posts | technical | report | geo
    every: Mapped[str] = mapped_column(String(20), default="monthly")  # daily | weekly | fortnightly | monthly | off
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_status: Mapped[str | None] = mapped_column(String(20))
    last_error: Mapped[str | None] = mapped_column(Text)


class AgentTask(TimestampMixin, Base):
    """A change the AI agent proposes; applied only after approval (or by autopilot rules)."""
    __tablename__ = "agent_tasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    agent: Mapped[str] = mapped_column(String(40))  # planner | gbp | review | content | audit | outreach | reporter
    kind: Mapped[str] = mapped_column(String(40))  # gbp_post | review_reply | profile_edit | website_fix | blog_draft | outreach_email
    title: Mapped[str] = mapped_column(String(500))
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    impact: Mapped[str] = mapped_column(String(10), default="Medium")
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | approved | rejected | applied | failed
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=True)
    decided_by: Mapped[str | None] = mapped_column(String(120))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    result: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class ActivityLog(Base):
    __tablename__ = "activity_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int | None] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    actor: Mapped[str] = mapped_column(String(120))  # a person's name, or an agent
    action: Mapped[str] = mapped_column(String(80))
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Playbook(TimestampMixin, Base):
    """The SOP and rules the AI follows (one row)."""
    __tablename__ = "playbook"
    id: Mapped[int] = mapped_column(primary_key=True)
    steps: Mapped[list[str]] = mapped_column(JSON, default=list)
    tone: Mapped[str | None] = mapped_column(Text)
    languages: Mapped[str | None] = mapped_column(String(200))
    alert_rules: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    approval_rules: Mapped[dict[str, bool]] = mapped_column(JSON, default=dict)  # kind -> needs approval
    plan_schedules: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # plan -> {job: every}
    learnt: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)  # corrections the AI learnt from
