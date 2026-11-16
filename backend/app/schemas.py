"""Request bodies (responses are plain dicts built by `serialize`)."""
import re
from datetime import date, timedelta
from typing import Annotated, Any, Literal

from pydantic import AnyUrl, BaseModel, Field, HttpUrl, field_validator, model_validator


def clean_social(v: Any) -> dict[str, str] | None:
    """facebook: a facebook.com page address; instagram: a handle (an instagram.com link or @name is reduced to the name); meta_business_id: digits.
    Empty values are dropped; None/{} means 'none linked'. Raises ValueError for something that is not that kind of address."""
    import re
    if v is None:
        return None
    if not isinstance(v, dict):
        raise ValueError("social_accounts must be an object")
    out: dict[str, str] = {}
    fb = str(v.get("facebook") or "").strip()
    if fb:
        if not re.match(r"^https?://", fb, re.I):
            fb = "https://" + fb
        if not re.match(r"^https?://([a-z0-9-]+\.)?(facebook|fb)\.com/\S+", fb, re.I):
            raise ValueError("Facebook page must be a facebook.com address")
        out["facebook"] = fb.split("?")[0].rstrip("/") if "profile.php" not in fb else fb
    ig = str(v.get("instagram") or "").strip()
    if ig:
        m = re.match(r"^(?:https?://)?(?:www\.)?instagram\.com/([A-Za-z0-9._]+)/?", ig, re.I)
        handle = (m.group(1) if m else ig.lstrip("@")).strip()
        if not re.fullmatch(r"[A-Za-z0-9._]{1,30}", handle):
            raise ValueError("Instagram must be a handle like @yourbrand or an instagram.com link")
        out["instagram"] = handle
    mb = str(v.get("meta_business_id") or "").strip()
    if mb:
        if not re.fullmatch(r"\d{5,25}", mb):
            raise ValueError("Meta Business ID is a number")
        out["meta_business_id"] = mb
    return out


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
    country: str | None = Field(default=None, pattern=r"^[A-Za-z]{2}$")  # ISO code
    lat: float | None = None
    lng: float | None = None
    service_area: str | None = None
    target_scope: Literal["local", "national", "international"] | None = None
    target_countries: list[str] | None = None
    target_areas: list[str] | None = None
    services: list[dict[str, Any]] = []
    attributes: list[str] = []
    hours: dict[str, Any] = {}
    tone: str | None = None
    usps: str | None = None
    plan: str | None = None
    contact_name: str | None = None
    contact_email: str | None = None
    booking_url: str | None = None
    additional_phones: list[str] | None = None
    action_links: list[dict[str, Any]] | None = None
    social_accounts: dict[str, Any] | None = None

    @field_validator("social_accounts")
    @classmethod
    def _social(cls, v):
        return clean_social(v)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v):
        return clean_phone(v)

    @field_validator("booking_url")
    @classmethod
    def _booking(cls, v):
        return clean_url(v)

    @field_validator("additional_phones")
    @classmethod
    def _phones(cls, v):
        return clean_phones(v)

    @field_validator("action_links")
    @classmethod
    def _links(cls, v):
        return clean_action_links(v)


PLACE_ACTION_TYPES = {
    "APPOINTMENT": "Book an appointment", "ONLINE_APPOINTMENT": "Book online", "DINING_RESERVATION": "Reserve a table",
    "FOOD_ORDERING": "Order food", "FOOD_DELIVERY": "Food delivery", "FOOD_TAKEOUT": "Takeaway", "SHOP_ONLINE": "Shop online",
}


def clean_phone(v: str | None) -> str | None:
    """A phone number as typed, tidied: digits, a leading +, spaces, dashes and brackets only; at least 7 digits. Empty means "none"."""
    if v is None:
        return None
    s = " ".join(str(v).split())
    if not s:
        return ""
    if re.search(r"[^\d+()\-\s.]", s) or len(re.sub(r"\D", "", s)) < 7 or len(re.sub(r"\D", "", s)) > 15:
        raise ValueError("Enter a valid phone number: digits only, with the country code if it is not a local number (7 to 15 digits).")
    return s


def clean_url(v: str | None) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return ""
    if not re.match(r"^https?://[^\s/]+\.[^\s]+$", s, re.I):
        raise ValueError("Enter a full link that starts with https://")
    return s


def clean_phones(v: list[str] | None) -> list[str] | None:
    if v is None:
        return None
    out: list[str] = []
    for x in v:
        c = clean_phone(x)
        if c and c not in out:
            out.append(c)
    if len(out) > 2:
        raise ValueError("Google accepts one main number and up to two more.")
    return out


def clean_action_links(v: list[dict[str, Any]] | None) -> list[dict[str, Any]] | None:
    if v is None:
        return None
    out: list[dict[str, Any]] = []
    for x in v:
        t, u = str((x or {}).get("type") or "").upper(), clean_url((x or {}).get("url"))
        if not u:
            continue
        if t not in PLACE_ACTION_TYPES:
            raise ValueError(f"Link type must be one of {', '.join(PLACE_ACTION_TYPES)}.")
        if any(o["type"] == t for o in out):
            raise ValueError(f"Only one “{PLACE_ACTION_TYPES[t]}” link is allowed.")
        out.append({"type": t, "url": u})
    return out


OPEN_STATUSES = ("OPEN", "CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY")
SERVICE_AREA_TYPES = ("CUSTOMER_AND_BUSINESS_LOCATION", "CUSTOMER_LOCATION_ONLY")
MORE_HOURS_TYPES = {
    "DELIVERY": "Delivery", "PICKUP": "Pickup", "TAKEOUT": "Takeout", "DRIVE_THROUGH": "Drive-through", "KITCHEN": "Kitchen",
    "HAPPY_HOUR": "Happy hour", "BREAKFAST": "Breakfast", "LUNCH": "Lunch", "DINNER": "Dinner", "BRUNCH": "Brunch",
    "SENIOR_HOURS": "Senior hours", "ONLINE_SERVICE_HOURS": "Online service hours", "ACCESS": "Access",
}


def clean_status(v: str | None) -> str | None:
    if v is None or v == "":
        return v
    if v not in OPEN_STATUSES:
        raise ValueError(f"Status must be one of {', '.join(OPEN_STATUSES)}.")
    return v


def clean_opening_date(v: str | None) -> str | None:
    if v is None or v == "":
        return v
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", v):
        raise ValueError("Opening date must look like 2024-05-31.")
    from datetime import date
    try:
        date.fromisoformat(v)
    except ValueError:
        raise ValueError("That is not a real date.") from None
    return v


def clean_labels(v: list[str] | None) -> list[str] | None:
    if v is None:
        return None
    out: list[str] = []
    for x in v:
        t = " ".join(str(x).split())[:255]
        if t and t.lower() not in (o.lower() for o in out):
            out.append(t)
    if len(out) > 10:
        raise ValueError("Google allows up to 10 labels.")
    return out


def clean_more_hours(v: dict[str, Any] | None) -> dict[str, Any] | None:
    if v is None:
        return None
    out: dict[str, Any] = {}
    for k, periods in v.items():
        if k not in MORE_HOURS_TYPES:
            raise ValueError(f"Unknown hours type {k}.")
        if not isinstance(periods, list):
            raise ValueError("Hours must be a list of periods.")
        out[k] = periods
    return out


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
    country: str | None = Field(default=None, pattern=r"^[A-Za-z]{2}$")  # ISO code
    timezone: str | None = Field(default=None, max_length=40)  # IANA name such as Asia/Kolkata; empty = the country's main one

    @field_validator("timezone")
    @classmethod
    def _timezone(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        if not v:
            return None
        try:
            from zoneinfo import available_timezones
            known = available_timezones()
        except Exception:  # noqa: BLE001
            known = set()
        if (known and v not in known) or not re.fullmatch(r"[A-Za-z]+(/[A-Za-z0-9_+-]+){1,2}", v):
            raise ValueError("Choose a time zone from the list (for example Asia/Kolkata).")
        return v
    lat: float | None = None
    lng: float | None = None
    service_area: str | None = None
    target_scope: Literal["local", "national", "international"] | None = None
    target_countries: list[str] | None = None
    target_areas: list[str] | None = None
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
    additional_phones: list[str] | None = None
    action_links: list[dict[str, Any]] | None = None
    cover_photo: str | None = None
    logo: str | None = None
    social_accounts: dict[str, Any] | None = None

    open_status: str | None = None
    opening_date: str | None = None
    more_hours: dict[str, Any] | None = None
    labels: list[str] | None = None

    @field_validator("open_status")
    @classmethod
    def _status(cls, v):
        return clean_status(v)

    @field_validator("opening_date")
    @classmethod
    def _opening(cls, v):
        return clean_opening_date(v)

    @field_validator("more_hours")
    @classmethod
    def _more(cls, v):
        return clean_more_hours(v)

    @field_validator("labels")
    @classmethod
    def _labels(cls, v):
        return clean_labels(v)

    @field_validator("social_accounts")
    @classmethod
    def _social(cls, v):
        return clean_social(v)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v):
        return clean_phone(v)

    @field_validator("booking_url")
    @classmethod
    def _booking(cls, v):
        return clean_url(v)

    @field_validator("additional_phones")
    @classmethod
    def _phones(cls, v):
        return clean_phones(v)

    @field_validator("action_links")
    @classmethod
    def _links(cls, v):
        return clean_action_links(v)


class DiscoverIn(BaseModel):
    """Any of: the client's email (its domain points to the website), the website itself, or name + city."""
    email: str = ""
    website: str = ""
    name: str = ""
    city: str = ""
    country: str = ""  # ISO code; Google is searched in this country (default India)


class AuditSummaryIn(BaseModel):
    """The essentials of a website audit report, as the report screen has them."""
    target: str = Field(max_length=2000)
    score: int | None = None
    scores: dict[str, int | None] = Field(default_factory=dict)
    pages: int = 0
    vitals: dict[str, str | None] = Field(default_factory=dict)
    issues: list[dict[str, Any]] = Field(default_factory=list, max_length=300)


class PageRewriteIn(BaseModel):
    kind: Literal["title", "meta"]
    business: dict[str, str | None] = Field(default_factory=dict)  # name, category, area, city, phone
    pages: list[dict[str, Any]] = Field(default_factory=list, max_length=200)


class OnboardAssistIn(BaseModel):
    """What the onboarding form holds so far, and the Maps listing it came from (if any)."""
    name: str = Field(default="", max_length=255)
    primary_category: str = Field(default="", max_length=160)
    description: str = Field(default="", max_length=1000)
    phone: str = Field(default="", max_length=40)
    website: str = Field(default="", max_length=300)
    address: str = Field(default="", max_length=500)
    area: str = Field(default="", max_length=120)
    city: str = Field(default="", max_length=120)
    services: list[Annotated[str, Field(max_length=120)]] = Field(default_factory=list, max_length=40)
    place_id: str | None = Field(default=None, max_length=300)
    country: str = Field(default="", max_length=2)
    fresh: bool = False  # re-fetch from Google Maps instead of the 10-minute cache (after the details were changed there)


class SuggestionIn(BaseModel):
    source: Literal["google_maps", "openstreetmap"]
    ref: str = Field(min_length=1, max_length=300)
    session: str = Field(default="", max_length=64)  # Google Autocomplete session token


class DiscoverImportIn(BaseModel):
    email: str = ""
    candidate: dict[str, Any]
    plan: str | None = None
    defer_audit: bool = False  # the caller saves more details first, then starts it with POST /discover/onboard/{id}


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
    crawl_pages: int = Field(default=10, ge=1, le=300)
    business_id: int | None = None  # set when this is the business's own site: the scan also updates its audits
    workspace_id: int | None = None  # the project the scan is run from: only that project lists it in its history
    options: dict | None = None  # Site Audit settings for this run: pages_to_crawl, subdomains, allow, disallow, ignore_params, user_agent


class CompetitorAuditIn(BaseModel):
    """Audit several competitor websites in one go. `business_id`/`competitor_id` are optional:
    set them to tie the audit to a business and a registered competitor for later comparison."""
    urls: list[HttpUrl] = Field(min_length=1, max_length=20)
    strategy: Literal["mobile", "desktop"] = "mobile"
    crawl_pages: int = Field(default=10, ge=1, le=300)
    business_id: int | None = None
    competitor_id: int | None = None
    reuse_existing: bool = Field(default=True, description="Skip queuing a URL that already has a finished audit of the same strategy, newer than max_age_hours")
    max_age_hours: int = Field(default=24, ge=1, le=24 * 30)


class CompetitorRegisterIn(BaseModel):
    """Find competitors near a location; optionally register them against a business."""
    business_type: str = Field(min_length=1, max_length=160)
    location: str = Field(min_length=1, max_length=200)
    own_firm_name: str = Field(default="", max_length=255)
    top_n: int = Field(default=10, ge=1, le=20)
    business_id: int | None = Field(default=None, description="When set, found competitors are saved against this business (deduped by website)")


class CompetitorManualIn(BaseModel):
    """Register a competitor by hand from its website URL or bare domain."""
    business_id: int
    url: str = Field(min_length=3, max_length=500)
    name: str = Field(default="", max_length=255)


class CompetitorCompareIn(BaseModel):
    """Compare the business's own audit against one or more competitor audits. Either pass the
    audit ids directly, or a business_id (+ optional strategy) to use each side's latest finished audit."""
    our_audit_id: int | None = None
    business_id: int | None = None
    competitor_audit_ids: list[int] = Field(default_factory=list, max_length=10)
    competitor_ids: list[int] = Field(default_factory=list, max_length=10)
    strategy: Literal["mobile", "desktop"] | None = None


class LighthouseAuditIn(BaseModel):
    url: str = Field(description="Publicly reachable http(s) URL")
    strategy: Literal["mobile", "desktop"] = "mobile"
    engine: Literal["pagespeed", "lighthouse"] = "lighthouse"

    @field_validator("url")
    @classmethod
    def http_only(cls, v: str) -> str:
        # Not HttpUrl: that rewrites the URL (e.g. adds a trailing slash), and the URL is kept as typed.
        v = v.strip()
        if AnyUrl(v).scheme not in ("http", "https"):
            raise ValueError("Only http:// and https:// URLs are supported")
        return v


class LighthouseSiteAuditIn(BaseModel):
    url: str = Field(description="Site whose sitemap.xml lists the pages to audit")
    strategy: Literal["mobile", "desktop"] = "mobile"
    engine: Literal["pagespeed", "lighthouse"] = "lighthouse"
    max_pages: int = Field(default=10, ge=1, le=50)


class ImportLocationsIn(BaseModel):
    locations: list[str] = Field(min_length=1)  # "locations/123"


class ScheduleIn(BaseModel):
    job: Literal["full_audit", "rank_scan", "reviews", "posts", "technical", "report", "geo", "weekly_plan", "site_research"]
    every: Literal["daily", "weekly", "fortnightly", "monthly", "off"]


POST_CTA_TYPES = {"BOOK", "ORDER", "SHOP", "LEARN_MORE", "SIGN_UP", "CALL"}
_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def check_post_dates(post_type: str, title: str | None, starts_on: date | None, ends_on: date | None, start_time: str | None = None, end_time: str | None = None) -> None:
    """The rules Google applies to Offer and Event posts, checked before anything is sent: an Event needs a title and both dates, an Offer a title."""
    today = date.today()
    if post_type in ("Offer", "Event") and not (title or "").strip():
        raise ValueError(f"A{'n' if post_type == 'Event' else 'n'} {post_type.lower()} needs a title.")
    if post_type == "Event" and not (starts_on and ends_on):
        raise ValueError("An event needs a start date and an end date.")
    if (starts_on and not ends_on and post_type == "Event") or (ends_on and not starts_on and post_type == "Event"):
        raise ValueError("An event needs a start date and an end date.")
    if starts_on and ends_on and ends_on < starts_on:
        raise ValueError("The end date cannot be before the start date.")
    for d in (starts_on, ends_on):
        if d and d > today + timedelta(days=366):
            raise ValueError("Dates can be at most one year ahead.")
    if ends_on and ends_on < today:
        raise ValueError("The end date is already in the past.")
    for t in (start_time, end_time):
        if t and not _HHMM.match(t):
            raise ValueError("Times must look like 09:30.")
    if start_time and end_time and starts_on and ends_on and starts_on == ends_on and end_time <= start_time:
        raise ValueError("On a one-day event the end time must be after the start time.")


class PostIn(BaseModel):
    post_type: Literal["Update", "Offer", "Event"] = "Update"
    title: str | None = None
    body: str = Field(min_length=1, max_length=1500)
    cta_type: str | None = None
    cta_url: str | None = None
    image_url: str | None = None
    scheduled_for: str | None = None
    starts_on: date | None = None
    ends_on: date | None = None
    start_time: str | None = None
    end_time: str | None = None
    coupon_code: str | None = Field(default=None, max_length=60)
    redeem_url: str | None = None
    terms: str | None = Field(default=None, max_length=500)

    @field_validator("redeem_url")
    @classmethod
    def _redeem(cls, v):
        return clean_url(v) or None

    @field_validator("cta_type")
    @classmethod
    def _cta(cls, v):
        if v and v not in POST_CTA_TYPES:
            raise ValueError(f"Button must be one of {', '.join(sorted(POST_CTA_TYPES))}.")
        return v or None

    @model_validator(mode="after")
    def _rules(self):
        if self.post_type == "Update":  # a plain update carries no schedule or offer details
            self.starts_on = self.ends_on = self.start_time = self.end_time = self.coupon_code = self.redeem_url = self.terms = None
            return self
        if self.post_type != "Event":
            self.start_time = self.end_time = None
        if self.post_type != "Offer":
            self.coupon_code = self.redeem_url = self.terms = None
        check_post_dates(self.post_type, self.title, self.starts_on, self.ends_on, self.start_time, self.end_time)
        return self


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
    uses: list[Literal["blog", "gmb_post", "aeo", "geo", "chatgpt", "website"]] | None = None
    source: dict | None = None


class KeywordIdeasIn(BaseModel):
    seed: str = Field(min_length=1)
    location: str = ""


class KeywordDiscoverIn(BaseModel):
    seeds: list[Annotated[str, Field(min_length=1, max_length=60)]] = Field(min_length=1, max_length=6)
    areas: list[Annotated[str, Field(max_length=60)]] = Field(default_factory=list, max_length=10)


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
