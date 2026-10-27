"""Request bodies (responses are plain dicts built by `serialize`)."""
from typing import Any, Literal

from pydantic import BaseModel, Field, HttpUrl


class BusinessIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    primary_category: str | None = None
    secondary_categories: list[str] = []
    description: str | None = Field(default=None, max_length=750)
    phone: str | None = None
    website: str | None = None
    address: str | None = None
    area: str | None = None
    city: str | None = None
    lat: float | None = None
    lng: float | None = None
    service_area: str | None = None
    services: list[dict[str, Any]] = []
    attributes: list[str] = []
    hours: dict[str, Any] = {}
    tone: str | None = None
    usps: str | None = None
    plan: str | None = None
    contact_name: str | None = None
    contact_email: str | None = None
    booking_url: str | None = None


class BusinessPatch(BaseModel):
    model_config = {"extra": "forbid"}
    name: str | None = None
    primary_category: str | None = None
    secondary_categories: list[str] | None = None
    description: str | None = Field(default=None, max_length=750)
    phone: str | None = None
    website: str | None = None
    address: str | None = None
    area: str | None = None
    city: str | None = None
    lat: float | None = None
    lng: float | None = None
    service_area: str | None = None
    services: list[dict[str, Any]] | None = None
    attributes: list[str] | None = None
    hours: dict[str, Any] | None = None
    special_hours: list[dict[str, Any]] | None = None
    faqs: list[dict[str, Any]] | None = None
    tone: str | None = None
    usps: str | None = None
    plan: str | None = None
    status: Literal["active", "needs_approval", "paused"] | None = None
    contact_name: str | None = None
    contact_email: str | None = None
    booking_url: str | None = None
    cover_photo: str | None = None
    logo: str | None = None


class DiscoverIn(BaseModel):
    email: str = Field(min_length=3)
    name: str = ""
    city: str = ""


class DiscoverImportIn(BaseModel):
    email: str = ""
    candidate: dict[str, Any]
    plan: str | None = None


class IntakeEmailIn(BaseModel):
    from_addr: str
    subject: str = ""
    body: str = Field(min_length=1)
    message_id: str | None = None


class AuditRunIn(BaseModel):
    kinds: list[Literal["gbp", "rankings", "technical", "onpage", "backlinks", "citations"]] | None = None


class WebsiteAuditIn(BaseModel):
    url: HttpUrl
    strategy: Literal["mobile", "desktop"] = "mobile"
    crawl_pages: int = Field(default=10, ge=1, le=50)


class ImportLocationsIn(BaseModel):
    locations: list[str] = Field(min_length=1)  # "locations/123"


class ScheduleIn(BaseModel):
    job: Literal["full_audit", "rank_scan", "reviews", "posts", "technical", "report", "geo"]
    every: Literal["daily", "weekly", "fortnightly", "monthly", "off"]


class PostIn(BaseModel):
    post_type: Literal["Update", "Offer", "Event"] = "Update"
    title: str | None = None
    body: str = Field(min_length=1, max_length=1500)
    cta_type: str | None = None
    cta_url: str | None = None
    image_url: str | None = None
    scheduled_for: str | None = None


class ReplyIn(BaseModel):
    text: str | None = None
    language: Literal["English", "Hindi", "Marathi"] = "English"


class KeywordIn(BaseModel):
    keyword: str = Field(min_length=1, max_length=255)
    volume: int | None = None
    difficulty: int | None = Field(default=None, ge=0, le=100)
    cpc: float | None = None
    intent: str | None = None
    cluster: str | None = None
    target_url: str | None = None
    priority: Literal["High", "Medium", "Low"] = "Medium"


class KeywordIdeasIn(BaseModel):
    seed: str = Field(min_length=1)
    location: str = ""


class RankScanIn(BaseModel):
    keyword: str = Field(min_length=1)
    grid_size: int = Field(default=7, ge=3, le=13)
    radius_km: float = Field(default=5.0, gt=0, le=50)


class GeoPromptIn(BaseModel):
    prompt: str = Field(min_length=3, max_length=500)


class LeadIn(BaseModel):
    lead_type: Literal["call", "whatsapp", "form", "direction", "booking", "other"] = "call"
    name: str | None = None
    contact: str | None = None
    message: str | None = None
    source: str | None = "Google Business Profile"
    lead_date: str | None = None


class DecisionIn(BaseModel):
    note: str | None = None


class PlaybookIn(BaseModel):
    steps: list[str] | None = None
    tone: str | None = None
    languages: str | None = None
    alert_rules: dict[str, Any] | None = None
    approval_rules: dict[str, bool] | None = None
    plan_schedules: dict[str, dict[str, str]] | None = None
