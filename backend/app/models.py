"""Database tables of the SEO platform (its own database; nothing shared with the CRM).

One business = one client profile. Everything else hangs off it: Google connection, audits,
reviews, posts, keywords, rank scans, leads, schedules and the AI agent's tasks. Lighthouse audits
of any URL stand on their own (no business needed).
"""
from datetime import date, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
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
    # Two-step verification (authenticator app). The secret is sealed (services/crypto); while totp_enabled is false it is only a pending setup.
    totp_secret: Mapped[str | None] = mapped_column(Text)
    totp_enabled: Mapped[bool | None] = mapped_column(Boolean, default=False)
    totp_last_step: Mapped[int | None] = mapped_column(Integer)  # the last accepted 30-second step: a code works once


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
    country: Mapped[str | None] = mapped_column(String(2))  # ISO code (IN, OM, AE, US…); see services/countries.py
    timezone: Mapped[str | None] = mapped_column(String(40))  # IANA name (Asia/Kolkata); empty = the country's main one (services/localtime.py)
    lat: Mapped[float | None] = mapped_column(Float)
    lng: Mapped[float | None] = mapped_column(Float)
    service_area: Mapped[str | None] = mapped_column(String(500))
    target_scope: Mapped[str | None] = mapped_column(String(15))  # local | national | international: who the business wants customers from (services/market.py)
    target_countries: Mapped[list[str]] = mapped_column(JSON, default=list)  # ISO codes, for international
    target_areas: Mapped[list[str]] = mapped_column(JSON, default=list)  # "Aundh, Pune", for local
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
    audit_config: Mapped[dict | None] = mapped_column(JSON)  # Site Audit settings: pages to crawl, limit, rules, schedule (routers/businesses.py)
    track_config: Mapped[dict | None] = mapped_column(JSON)  # Position Tracking targeting: engine, device, location, language (routers/seo.py)
    gbp_account: Mapped[str | None] = mapped_column(String(120))  # "accounts/123"
    gbp_location: Mapped[str | None] = mapped_column(String(120), unique=True)  # "locations/456"
    place_id: Mapped[str | None] = mapped_column(String(200))
    verification: Mapped[str] = mapped_column(String(20), default="unknown")  # verified | pending | unverified | suspended | disabled | conflict | unknown
    gbp_status: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # live listing state from Google: open status, pending edits, links, checked_at
    duplicate_listing: Mapped[bool] = mapped_column(Boolean, default=False)
    rating: Mapped[float | None] = mapped_column(Float)
    review_count: Mapped[int | None] = mapped_column(Integer)
    photo_count: Mapped[int | None] = mapped_column(Integer)
    cover_photo: Mapped[str | None] = mapped_column(String(500))
    logo: Mapped[str | None] = mapped_column(String(500))
    growth_notify: Mapped[dict | None] = mapped_column(JSON)  # Growth Plan emails: {email, weekly, monthly, alerts, to, last_alert}: who is told, and about what
    local_competitors: Mapped[dict | None] = mapped_column(JSON)  # GBP competitor analysis: {at, keyword, items: [{id, name, rating, reviews, website, maps_link, source}]}
    citation_listings: Mapped[dict | None] = mapped_column(JSON)  # listing management: {site key: {url, status, note, found, checked_at}} entered or checked by a person
    booking_url: Mapped[str | None] = mapped_column(String(500))  # the Book-an-appointment link (mirrors action_links[APPOINTMENT])
    additional_phones: Mapped[list[str] | None] = mapped_column(JSON)  # up to 2 more numbers shown on the Google profile
    action_links: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON)  # Google place-action links: [{type: APPOINTMENT|ONLINE_APPOINTMENT|..., url}]
    open_status: Mapped[str | None] = mapped_column(String(30))  # OPEN | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY (Google openInfo.status)
    opening_date: Mapped[str | None] = mapped_column(String(10))  # "YYYY-MM-DD": when the business opened or will open (Google openInfo.openingDate)
    more_hours: Mapped[dict[str, Any] | None] = mapped_column(JSON)  # {hoursTypeId: [period, ...]}: delivery, pickup, kitchen, happy hour...
    labels: Mapped[list[str] | None] = mapped_column(JSON)  # internal labels, visible only to the profile's managers
    service_area_type: Mapped[str | None] = mapped_column(String(40))  # CUSTOMER_AND_BUSINESS_LOCATION | CUSTOMER_LOCATION_ONLY
    service_area_places: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON)  # [{name, place_id}]: the areas served
    modules: Mapped[list[str] | None] = mapped_column(JSON)  # services the project is onboarded for: subset of seo/geo/aeo/gmb; NULL = derive (services/project_services.py)
    social_accounts: Mapped[dict | None] = mapped_column(JSON)  # {facebook, instagram, meta_business_id}: linked by address (no Meta login yet), normalised by schemas.clean_social
    created_by: Mapped[str | None] = mapped_column(String(120))
    owner_id: Mapped[str | None] = mapped_column(String(64), index=True)  # the signed-in user (User.id) whose project this is; others never see it, admins see all (deps.can_access)
    last_audit_score: Mapped[int | None] = mapped_column(Integer)

    connection: Mapped[GoogleConnection | None] = relationship()


class BusinessManager(TimestampMixin, Base):
    """An email address with manager access to a project: whoever signs in with it can open and fetch all of that project's data."""
    __tablename__ = "business_managers"
    __table_args__ = (UniqueConstraint("business_id", "email"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    email: Mapped[str] = mapped_column(String(255), index=True)  # lower-case


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
    competitor_id: Mapped[int | None] = mapped_column(ForeignKey("competitors.id", ondelete="SET NULL"), index=True)
    workspace_id: Mapped[int | None] = mapped_column(Integer, index=True)  # the project a website scan was run from (history only; it does not feed that project's scores)
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


class Competitor(TimestampMixin, Base):
    """A competitor registered against a business (from the Maps finder or added by hand), so its
    audits can be looked up again and compared with the business's own."""
    __tablename__ = "competitors"
    __table_args__ = (UniqueConstraint("business_id", "website"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    website: Mapped[str | None] = mapped_column(String(500))
    address: Mapped[str | None] = mapped_column(String(500))
    phone: Mapped[str | None] = mapped_column(String(40))
    rating: Mapped[float | None] = mapped_column(Float)
    reviews: Mapped[int | None] = mapped_column(Integer)
    maps_link: Mapped[str | None] = mapped_column(String(500))
    source: Mapped[str] = mapped_column(String(20), default="google_places")  # google_places | manual


class LighthouseSiteAudit(TimestampMixin, Base):
    """A batch of Lighthouse audits, one per page found in a site's sitemap."""
    __tablename__ = "lighthouse_site_audits"
    id: Mapped[int] = mapped_column(primary_key=True)
    base_url: Mapped[str] = mapped_column(String(2048))
    strategy: Mapped[str] = mapped_column(String(16))  # mobile | desktop
    engine: Mapped[str] = mapped_column(String(16))  # pagespeed | lighthouse
    max_pages: Mapped[int] = mapped_column(Integer)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    discovery_error: Mapped[str | None] = mapped_column(Text)


class LighthouseAudit(TimestampMixin, Base):
    """A full Lighthouse run of one URL (PageSpeed Insights or the local Lighthouse CLI)."""
    __tablename__ = "lighthouse_audits"
    id: Mapped[int] = mapped_column(primary_key=True)
    site_audit_id: Mapped[int | None] = mapped_column(ForeignKey("lighthouse_site_audits.id", ondelete="CASCADE"), index=True)
    submitted_url: Mapped[str] = mapped_column(String(2048))
    final_url: Mapped[str | None] = mapped_column(String(2048))
    strategy: Mapped[str] = mapped_column(String(16))  # mobile | desktop
    engine: Mapped[str] = mapped_column(String(16))  # pagespeed | lighthouse (as requested)
    engine_used: Mapped[str | None] = mapped_column(String(16))  # differs when PageSpeed failed and local Lighthouse ran
    fallback_reason: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="queued")  # queued | running | completed | failed
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    performance_score: Mapped[int | None] = mapped_column(Integer)
    accessibility_score: Mapped[int | None] = mapped_column(Integer)
    best_practices_score: Mapped[int | None] = mapped_column(Integer)
    seo_score: Mapped[int | None] = mapped_column(Integer)
    metrics: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    report: Mapped[dict[str, Any] | None] = mapped_column(JSON)  # normalised (lighthouse_report.normalize_report)
    raw_json_path: Mapped[str | None] = mapped_column(String(1024))
    html_report_path: Mapped[str | None] = mapped_column(String(1024))
    html_report_is_original: Mapped[bool] = mapped_column(Boolean, default=False)
    error_message: Mapped[str | None] = mapped_column(Text)


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
    review_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # when the customer posted it on Google (date and time)
    reply_text: Mapped[str | None] = mapped_column(Text)
    reply_status: Mapped[str] = mapped_column(String(20), default="none")  # none | draft | approved | posted
    reply_language: Mapped[str | None] = mapped_column(String(20))
    replied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sentiment: Mapped[str | None] = mapped_column(String(10))
    topics: Mapped[list[str]] = mapped_column(JSON, default=list)


class Notification(TimestampMixin, Base):
    """Something the owner should see: a new Google review, and later other alerts. Shown in the header bell and on the Overview page."""
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    owner_id: Mapped[str | None] = mapped_column(String(64), index=True)  # the project's owner when this was created
    kind: Mapped[str] = mapped_column(String(30), default="new_review")  # new_review | low_rating_review | ...
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(500))  # a frontend path, e.g. /gmb-profile?tab=reviews
    rating: Mapped[int | None] = mapped_column(Integer)
    review_id: Mapped[int | None] = mapped_column(Integer)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    emailed: Mapped[bool] = mapped_column(Boolean, default=False)


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
    starts_on: Mapped[date | None] = mapped_column(Date)  # Offer / Event: first day it is on
    ends_on: Mapped[date | None] = mapped_column(Date)
    start_time: Mapped[str | None] = mapped_column(String(5))  # Event only, 'HH:MM'
    end_time: Mapped[str | None] = mapped_column(String(5))
    coupon_code: Mapped[str | None] = mapped_column(String(60))  # Offer only
    redeem_url: Mapped[str | None] = mapped_column(String(500))
    terms: Mapped[str | None] = mapped_column(String(500))


class Article(TimestampMixin, Base):
    """A blog article drafted for one Google Trends keyword (AI Blog Studio)."""
    __tablename__ = "articles"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    topic: Mapped[str | None] = mapped_column(String(255))  # the trending topic the article was started from
    keyword: Mapped[str] = mapped_column(String(255))  # the primary keyword (the first one selected)
    secondary_keywords: Mapped[list[str]] = mapped_column(JSON, default=list)  # the other selected keywords
    rising_keywords: Mapped[list[str]] = mapped_column(JSON, default=list)  # those of them Google lists as rising
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | generating | completed | failed
    progress: Mapped[str | None] = mapped_column(String(255))  # the step being written, while generating
    length: Mapped[str | None] = mapped_column(String(10))  # short | standard | long
    stats: Mapped[dict | None] = mapped_column(JSON)  # time and Ollama calls per step, words written
    title: Mapped[str | None] = mapped_column(String(255))
    meta_description: Mapped[str | None] = mapped_column(String(500))
    suggested_keywords: Mapped[list[str]] = mapped_column(JSON, default=list)
    headings: Mapped[list[str]] = mapped_column(JSON, default=list)
    warnings: Mapped[list[str]] = mapped_column(JSON, default=list)
    body: Mapped[str | None] = mapped_column(Text)  # HTML: intro, sections, FAQs
    error: Mapped[str | None] = mapped_column(Text)
    model: Mapped[str | None] = mapped_column(String(80))
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    wp_post_id: Mapped[str | None] = mapped_column(String(40))
    wp_url: Mapped[str | None] = mapped_column(String(500))
    # The post on the business's website: publish | draft | pending | future (scheduled by the site) | scheduled (held by
    # GrowZen) | deleted. Post id and URL are kept after a delete so the history shows what was removed.
    wp_status: Mapped[str | None] = mapped_column(String(20))
    publish_method: Mapped[str | None] = mapped_column(String(20))  # wordpress | ghost | shopify | github | webhook
    wp_deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Featured image: the uploaded file is kept on the server (featured_image_path, relative to the uploads folder);
    # on publishing it is uploaded once to the WordPress media library (wp_media_id) and set as the post's featured image.
    featured_image_path: Mapped[str | None] = mapped_column(String(500))
    featured_image_alt: Mapped[str | None] = mapped_column(String(255))
    featured_image_url: Mapped[str | None] = mapped_column(String(500))  # the public URL on the website, once uploaded there
    # what was uploaded and what it became: {original_name, original_format, original_size, width, height, size, saved_percent, page, page_count, ...}
    featured_image_info: Mapped[dict | None] = mapped_column(JSON)
    # The same article on the React.js website (a separate destination; the wp_* fields stay WordPress-only)
    react_post_id: Mapped[str | None] = mapped_column(String(80))
    react_url: Mapped[str | None] = mapped_column(String(500))
    react_status: Mapped[str | None] = mapped_column(String(20))  # draft | publish | scheduled | deleted
    react_image_url: Mapped[str | None] = mapped_column(String(500))
    react_image_path: Mapped[str | None] = mapped_column(String(500))  # which local image react_image_url is a copy of
    wp_media_id: Mapped[str | None] = mapped_column(String(40))


class SiteIntegration(TimestampMixin, Base):
    """How a business's own website accepts blog posts: detected platform, and the credentials to publish to it (secrets encrypted)."""
    __tablename__ = "site_integrations"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), unique=True, index=True)
    platform: Mapped[str] = mapped_column(String(20), default="unknown")  # wordpress | nextjs | webhook | static | unknown
    method: Mapped[str | None] = mapped_column(String(20))  # wordpress | webhook: how posts are delivered
    base_url: Mapped[str | None] = mapped_column(String(500))  # WordPress site URL, or the webhook endpoint
    username: Mapped[str | None] = mapped_column(String(255))
    secret_enc: Mapped[str | None] = mapped_column(Text)  # WordPress application password / webhook signing secret (Fernet)
    detected: Mapped[dict | None] = mapped_column(JSON)  # what the detection found: platform, evidence, stack
    status: Mapped[str] = mapped_column(String(20), default="not_connected")  # not_connected | connected | error
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)
    config: Mapped[dict | None] = mapped_column(JSON)  # method settings that are not secrets: GitHub repo/branch/folder, Shopify blog, Ghost version...


class ReactSiteConnection(TimestampMixin, Base):
    """A second publishing destination next to WordPress: a custom (React.js) website with its own blog API.
    The site's backend receives the article as JSON over an API key; the key is stored encrypted and never sent to the page."""
    __tablename__ = "react_site_connections"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), unique=True, index=True)
    website_name: Mapped[str | None] = mapped_column(String(160))
    website_url: Mapped[str | None] = mapped_column(String(500))
    blog_url: Mapped[str | None] = mapped_column(String(500))
    api_base_url: Mapped[str | None] = mapped_column(String(500))
    api_key_enc: Mapped[str | None] = mapped_column(Text)  # Fernet-encrypted
    auth_scheme: Mapped[str] = mapped_column(String(20), default="login")  # login (username+password -> token) | bearer / x-api-key (fixed key)
    # Login authentication: the website's integration user. Password and the current access token are Fernet-encrypted.
    login_username: Mapped[str | None] = mapped_column(String(255))
    password_enc: Mapped[str | None] = mapped_column(Text)
    auth_endpoint: Mapped[str | None] = mapped_column(String(300))  # POST {username/email, password} -> {token, expires_in?}
    token_enc: Mapped[str | None] = mapped_column(Text)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    health_endpoint: Mapped[str | None] = mapped_column(String(300))  # GET, must need the key (checks it)
    publish_endpoint: Mapped[str | None] = mapped_column(String(300))  # POST create, PUT/DELETE {endpoint}/{id}
    image_endpoint: Mapped[str | None] = mapped_column(String(300))  # POST multipart "image" -> {"url": ...}
    # Per-website image upload + field mapping (services/react_site.py DEFAULT_MAPPING): request format, file field,
    # response URL path, blog image/alt fields, max upload size. Lets one integration serve any site's backend.
    mapping: Mapped[dict | None] = mapped_column(JSON)
    default_status: Mapped[str] = mapped_column(String(20), default="draft")  # draft | publish | schedule
    status: Mapped[str] = mapped_column(String(20), default="not_connected")  # not_connected | connected | failed
    last_error: Mapped[str | None] = mapped_column(Text)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ScheduledPost(TimestampMixin, Base):
    """A post GrowZen publishes itself at a chosen time, for sites that cannot schedule natively (a Git repository has no 'publish later')."""
    __tablename__ = "scheduled_posts"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    article_id: Mapped[int] = mapped_column(ForeignKey("articles.id", ondelete="CASCADE"), index=True)
    method: Mapped[str] = mapped_column(String(20))
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    status: Mapped[str] = mapped_column(String(12), default="pending")  # pending | published | failed | cancelled
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    result: Mapped[dict | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DomainIntelCache(Base):
    """A Domain Overview fetched from the paid data provider, kept so a page view does not cost a new request."""
    __tablename__ = "domain_intel_cache"
    __table_args__ = (UniqueConstraint("domain", "key", "tier"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    domain: Mapped[str] = mapped_column(String(255), index=True)
    key: Mapped[str] = mapped_column(String(80))  # a country code, or "countries:IN,OM" for the per-market table
    tier: Mapped[str] = mapped_column(String(10))  # internal | client: the size of the data set fetched
    payload: Mapped[dict | list] = mapped_column(JSON)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


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


class KeywordRankLog(Base):
    """One checked Google position of a tracked keyword on a day (null rank = not in the top 20): the history behind the rank chart."""
    __tablename__ = "keyword_rank_log"
    __table_args__ = (UniqueConstraint("business_id", "keyword", "day"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    keyword: Mapped[str] = mapped_column(String(255))
    day: Mapped[date] = mapped_column(Date, index=True)
    rank: Mapped[int | None] = mapped_column(Integer)
    location: Mapped[str | None] = mapped_column(String(160))
    url: Mapped[str | None] = mapped_column(String(500))  # the page that ranked
    own_urls: Mapped[list[str] | None] = mapped_column(JSON)  # every page of the site in the results (more than one = cannibalization)
    serp: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON)  # [{d: domain, p: position}] of the results Google returned
    features: Mapped[list[str] | None] = mapped_column(JSON)  # SERP features present on the results page
    own_features: Mapped[list[str] | None] = mapped_column(JSON)  # of those, the ones the site appears in
    depth: Mapped[int | None] = mapped_column(Integer)  # how many Google results were read (20 for older checks, 100 now): a null rank means "not in the top <depth>"
    rank_page: Mapped[int | None] = mapped_column(Integer)  # the Google results page the site is on (ceil(rank / 10)); null = not found
    maps_rank: Mapped[int | None] = mapped_column(Integer)  # the business's position in the Google Maps / local results for the same search (null = not found)
    maps_total: Mapped[int | None] = mapped_column(Integer)  # how many Maps results Google returned (null = the Maps check was not made)
    maps_listing: Mapped[str | None] = mapped_column(String(255))  # the name of our listing as Maps shows it
    maps_first: Mapped[str | None] = mapped_column(String(255))  # the listing in Maps position 1
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # the moment of the last check (the row is one per day)



class SiteProfile(TimestampMixin, Base):
    """What the onboarding research learnt about a client's website: its technology, the metadata found on every crawled page,
    the site-wide checks, and the improvements that follow from them. One row per business, refreshed by each research run."""
    __tablename__ = "site_profiles"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued | running | done | failed
    stack: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # site_stack.detect() result
    site_checks: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # robots, sitemap, llms.txt, security headers, favicon
    metadata_audit: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # per-page metadata + coverage figures
    suggested_metadata: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)  # [{url, title, description, og_*...}]
    recommendations: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)  # [{key, area, title, why, how, impact, effort, source}]
    summary: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    scanned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WorkItem(TimestampMixin, Base):
    """One piece of work for one client in one week: a fix from an audit, an improvement from the site research, a recurring operation, or something added by hand."""
    __tablename__ = "work_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    week_start: Mapped[date] = mapped_column(Date, index=True)  # the Monday of the week it is planned for
    key: Mapped[str] = mapped_column(String(200), index=True)  # stable identity (e.g. "rec:add-og-tags"), so the same work is never planned twice
    area: Mapped[str] = mapped_column(String(30))  # gmb | seo | technical | metadata | content | backlinks | rankings | reviews | other
    title: Mapped[str] = mapped_column(String(500))
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # why, how, links to the audit issue / site recommendation / agent task
    source: Mapped[str] = mapped_column(String(20), default="manual")  # audit | research | operation | agent | manual
    priority: Mapped[int] = mapped_column(Integer, default=3)  # 1 (do first) .. 4
    impact: Mapped[str] = mapped_column(String(10), default="Medium")
    status: Mapped[str] = mapped_column(String(20), default="todo")  # todo | doing | done | skipped | backlog
    assignee: Mapped[str | None] = mapped_column(String(120))
    due_date: Mapped[date | None] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(Text)  # what was done / why it was skipped
    carried_from: Mapped[int | None] = mapped_column(Integer)  # id of the item in the previous week this one continues
    carry_count: Mapped[int] = mapped_column(Integer, default=0)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified: Mapped[bool] = mapped_column(Boolean, default=False)  # closed because the next audit no longer reports the issue


class WeeklyReport(TimestampMixin, Base):
    """A saved weekly or monthly report: what was done compared with the period before, what is planned next, and the future scope."""
    __tablename__ = "weekly_reports"
    __table_args__ = (UniqueConstraint("business_id", "period", "period_start"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    period: Mapped[str] = mapped_column(String(10))  # week | month
    period_start: Mapped[date] = mapped_column(Date, index=True)
    period_end: Mapped[date] = mapped_column(Date)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    narrative: Mapped[str | None] = mapped_column(Text)
    final: Mapped[bool] = mapped_column(Boolean, default=False)  # false while the period is still running

class ChatGPTBusiness(TimestampMixin, Base):
    """One project's "Your business, in ChatGPT" record: where its claim stands in OpenAI's Business Hub (claimed and verified there by a person),
    the profile copy to paste in, the Business Agent guidelines, and the months of insights logged from the Hub. Nothing here is sent to OpenAI by us."""
    __tablename__ = "chatgpt_businesses"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), unique=True, index=True)
    claim_status: Mapped[str] = mapped_column(String(20), default="Unclaimed")  # Unclaimed | Claim_Pending | Claim_Approved | Disputed
    verification_method: Mapped[str | None] = mapped_column(String(20))  # DNS_TXT | Shopify | Business_Email | Business_Phone
    dns_txt_record: Mapped[str | None] = mapped_column(String(500))
    persona_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    status_history: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)  # [{at, from, to, by}]
    business_name: Mapped[str | None] = mapped_column(String(255))
    category: Mapped[str | None] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(String(500))
    website_url: Mapped[str | None] = mapped_column(String(500))
    logo_url: Mapped[str | None] = mapped_column(String(500))
    delivery_policy: Mapped[str | None] = mapped_column(Text)
    return_policy: Mapped[str | None] = mapped_column(Text)
    agent_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    agent_instructions: Mapped[str | None] = mapped_column(Text)
    insights: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)  # [{month 'YYYY-MM', mentions, website_clicks, topics}]


class CatalogItem(TimestampMixin, Base):
    """A product or service in the hosted feed that ChatGPT's Business Hub reads."""
    __tablename__ = "chatgpt_catalog_items"
    __table_args__ = (UniqueConstraint("business_id", "sku"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    sku: Mapped[str] = mapped_column(String(80))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(String(2000))
    price: Mapped[Any] = mapped_column(Numeric(12, 2), default=0)
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    availability: Mapped[str] = mapped_column(String(20), default="in_stock")  # in_stock | out_of_stock | preorder | limited
    product_url: Mapped[str] = mapped_column(String(1000))
    image_url: Mapped[str | None] = mapped_column(String(1000))



class PageXRayRun(TimestampMixin, Base):
    """One saved Page X-Ray of one page: its three scores and the full report, so a page's progress can be seen over time."""
    __tablename__ = "page_xray_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    url: Mapped[str] = mapped_column(String(1000), index=True)  # the address that was inspected (normalised)
    final_url: Mapped[str | None] = mapped_column(String(1000))
    render: Mapped[bool] = mapped_column(Boolean, default=False)  # read after JavaScript ran in Chrome
    seo_score: Mapped[int | None] = mapped_column(Integer)
    aeo_score: Mapped[int | None] = mapped_column(Integer)
    geo_score: Mapped[int | None] = mapped_column(Integer)
    passed: Mapped[dict[str, Any] | None] = mapped_column(JSON)  # {seo: [passed, total], aeo: [...], geo: [...]}
    failed_keys: Mapped[list[str] | None] = mapped_column(JSON)  # the checks that failed, for "what changed"
    word_count: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[int | None] = mapped_column(Integer)  # HTTP status of the page
    source: Mapped[str] = mapped_column(String(10), default="server")  # server (read by us) | client (the browser sent the report; checked against our cache when possible) | site (whole-site scan)
    report: Mapped[dict[str, Any] | None] = mapped_column(JSON)  # the whole X-Ray, capped at 300 KB


class PageXRayJob(TimestampMixin, Base):
    """A whole-website scan: every page of the project's own site is X-Rayed in the background."""
    __tablename__ = "page_xray_jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(10), default="running")  # running | done | failed
    max_pages: Mapped[int] = mapped_column(Integer, default=25)
    total: Mapped[int] = mapped_column(Integer, default=0)
    done: Mapped[int] = mapped_column(Integer, default=0)
    phase: Mapped[str | None] = mapped_column(String(40))  # discovering | scanning
    pages: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)  # [{url, run_id, seo, aeo, geo, status, top_fix, error}]
    error: Mapped[str | None] = mapped_column(Text)
    started_by: Mapped[str | None] = mapped_column(String(120))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

class GrowthSnapshot(TimestampMixin, Base):
    """One day's measurement of a project's presence (Growth Plan): every metric with its source, the area scores and the overall presence figure.
    A second measurement on the same day replaces the first; the series is what targets are set against and what progress is read from."""
    __tablename__ = "growth_snapshots"
    __table_args__ = (UniqueConstraint("business_id", "day"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    day: Mapped[date] = mapped_column(Date, index=True)
    metrics: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # the full growth_metrics.measure() dict
    areas: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # {area: score or null}
    presence: Mapped[int | None] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(20), default="daily")  # daily | manual | onboarding


class GrowthTarget(TimestampMixin, Base):
    """A measurable target for one metric of a project's online presence, for one day, week or month (services/growth_plan.py).
    The baseline is measured when the window opens, the target is capped to what is realistic, and the window closes as met or missed from real data."""
    __tablename__ = "growth_targets"
    __table_args__ = (UniqueConstraint("business_id", "metric", "period", "window_start"),)  # its index also serves the lookup by business, period and window
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    area: Mapped[str] = mapped_column(String(20))  # gmb | local | seo | aeo | geo | chatgpt
    metric: Mapped[str] = mapped_column(String(60))
    label: Mapped[str] = mapped_column(String(200))
    period: Mapped[str] = mapped_column(String(10))  # daily | weekly | monthly
    window_start: Mapped[date] = mapped_column(Date)
    window_end: Mapped[date] = mapped_column(Date)
    baseline: Mapped[float | None] = mapped_column(Float)
    target: Mapped[float | None] = mapped_column(Float)
    unit: Mapped[str | None] = mapped_column(String(20))
    direction: Mapped[str] = mapped_column(String(6), default="up")  # up | down | keep
    current: Mapped[float | None] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(10), default="open")  # open | met | missed | blocked
    feasibility: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # {cap, note, confidence}
    why: Mapped[str | None] = mapped_column(Text)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class GrowthAction(TimestampMixin, Base):
    """One task that serves a growth target. It only counts as done when a real check of the live data (or the live page) says so."""
    __tablename__ = "growth_actions"
    __table_args__ = (UniqueConstraint("business_id", "key", "due_on"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    target_id: Mapped[int | None] = mapped_column(ForeignKey("growth_targets.id", ondelete="SET NULL"))
    area: Mapped[str] = mapped_column(String(20))
    key: Mapped[str] = mapped_column(String(80))
    period: Mapped[str] = mapped_column(String(10))
    due_on: Mapped[date] = mapped_column(Date, index=True)
    title: Mapped[str] = mapped_column(String(300))
    why: Mapped[str | None] = mapped_column(Text)
    how: Mapped[list[str]] = mapped_column(JSON, default=list)
    est_minutes: Mapped[int] = mapped_column(Integer, default=10)
    mode: Mapped[str] = mapped_column(String(10), default="manual")  # manual | assisted | auto
    link: Mapped[str | None] = mapped_column(String(300))
    verify: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # the real check that decides whether the task counts
    status: Mapped[str] = mapped_column(String(12), default="todo")  # todo | done | verified | unverified | failed | skipped | blocked
    evidence: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    note: Mapped[str | None] = mapped_column(Text)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_by: Mapped[str | None] = mapped_column(String(120))


class GrowthReport(TimestampMixin, Base):
    """A saved weekly or monthly growth report (services/growth_report.py): what moved, what was done and checked, what is open and what comes next. Emailed once."""
    __tablename__ = "growth_reports"
    __table_args__ = (UniqueConstraint("business_id", "period", "period_start"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    period: Mapped[str] = mapped_column(String(8))  # week | month
    period_start: Mapped[date] = mapped_column(Date, index=True)
    period_end: Mapped[date] = mapped_column(Date)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    emailed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    emailed_to: Mapped[str | None] = mapped_column(String(254))
    email_error: Mapped[str | None] = mapped_column(Text)


class RateHit(Base):
    """A fixed-window counter shared by every server process (services/ratelimit.py): one row per limiter name, caller and time window."""
    __tablename__ = "rate_hits"
    __table_args__ = (UniqueConstraint("name", "caller", "window_start"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60))
    caller: Mapped[str] = mapped_column(String(120))
    window_start: Mapped[int] = mapped_column(Integer)  # seconds since the epoch // window length
    ends_at: Mapped[int] = mapped_column(Integer, index=True, default=0)  # epoch second the window is over: when the row can go
    count: Mapped[int] = mapped_column(Integer, default=0)


from .backlinks import models as _backlink_models  # noqa: E402,F401  (registers the backlink graph tables)
