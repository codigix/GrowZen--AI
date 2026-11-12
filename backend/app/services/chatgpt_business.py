"""Your business, in ChatGPT: the data and the text this software prepares for OpenAI's Business Hub.

The claim, the verification and the Persona identity check happen on OpenAI's own site, done by a person. This module only keeps track of where
each business stands, holds the copy to paste in, hosts a product/service feed the Hub can read, and writes the JSON-LD and the Business Agent
guidelines. Everything is built from the project's real data; nothing is invented (no rating unless Google reported one, no price unless it was given).
"""
import csv
import hashlib
import hmac
import io
import re
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any
from urllib.parse import quote

from ..config import get_settings
from ..models import Business, CatalogItem, ChatGPTBusiness

CLAIM_STATUSES = ("Unclaimed", "Claim_Pending", "Claim_Approved", "Disputed")
VERIFICATION_METHODS = ("DNS_TXT", "Shopify", "Business_Email", "Business_Phone")
AVAILABILITY = ("in_stock", "out_of_stock", "preorder", "limited")
DESCRIPTION_MAX, POLICY_MAX, INSTRUCTIONS_MAX, CATALOG_MAX, BATCH_MAX = 500, 4000, 4000, 1000, 500
MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
SKU = re.compile(r"^[A-Za-z0-9._-]{1,80}$")
SCHEMA_AVAILABILITY = {"in_stock": "https://schema.org/InStock", "out_of_stock": "https://schema.org/OutOfStock", "preorder": "https://schema.org/PreOrder", "limited": "https://schema.org/LimitedAvailability"}
CURRENCY_OF = {"IN": "INR", "US": "USD", "GB": "GBP", "AE": "AED", "CA": "CAD", "AU": "AUD", "SG": "SGD", "OM": "OMR", "SA": "SAR", "NZ": "NZD"}


# ---------- the public feed address
def token_for(business_id: int) -> str:
    mac = hmac.new(get_settings().secret_key.encode(), f"chatgpt-feed:{business_id}".encode(), hashlib.sha256).hexdigest()[:16]
    return f"{business_id}-{mac}"


def business_id_of(token: str) -> int | None:
    """The business a feed token belongs to, or None for any token that is not exactly ours (no hint about which part was wrong)."""
    try:
        raw, _ = token.split("-", 1)
        bid = int(raw)
    except ValueError:
        return None
    return bid if hmac.compare_digest(token_for(bid), token) else None


def feed_urls(business_id: int) -> dict[str, str]:
    s = get_settings()
    base = f"{s.public_base_url.rstrip('/')}{s.api_prefix}/public/feeds/chatgpt/{token_for(business_id)}"
    return {"csv_url": f"{s.public_base_url.rstrip('/')}{s.api_prefix}/chatgpt-business/public/feed/{token_for(business_id)}.csv", "json_url": f"{base}.json"}


# ---------- validation
def clean_url(value: Any, field: str) -> str | None:
    v = str(value or "").strip()
    if not v:
        return None
    if len(v) > 1000 or re.search(r"\s", v) or not re.match(r"^https?://[^\s/]+\.[^\s]+$|^https?://localhost(:\d+)?(/.*)?$", v, re.I):
        raise ValueError(f"{field} must be a full web address starting with https:// (http:// also works).")
    return v


def trim_description(text: str | None, limit: int = DESCRIPTION_MAX) -> str:
    """The text cut to `limit` characters at the end of a sentence if one is near the end, else at a word, never in the middle of a word."""
    t = " ".join(str(text or "").split())
    if len(t) <= limit:
        return t
    cut = t[:limit]
    ends = [m.end() for m in re.finditer(r"[.!?](?:\s|$)", cut)]
    if ends and ends[-1] >= limit * 0.5:
        return cut[:ends[-1]].strip()
    return cut[:cut.rfind(" ")].rstrip(" ,;:-") if " " in cut else cut


def parse_price(value: Any) -> Decimal:
    if isinstance(value, bool):
        raise ValueError("Price must be a number.")
    if isinstance(value, (int, float, Decimal)):
        d = Decimal(str(value))
    else:
        txt = str(value or "").strip().replace(",", "")
        txt = re.sub(r"^[^\d.\-]+", "", txt)  # a leading currency sign or "Rs."
        try:
            d = Decimal(txt)
        except InvalidOperation:
            raise ValueError("Price must be a number, for example 499 or 1,499.00.") from None
    if not d.is_finite() or d < 0:
        raise ValueError("Price cannot be negative.")
    if d >= Decimal("10000000000"):
        raise ValueError("Price is too large.")
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def clean_item(raw: dict[str, Any]) -> dict[str, Any]:
    """One catalog row, validated and normalised, or ValueError with the reason (shown to the person next to that row)."""
    if not isinstance(raw, dict):
        raise ValueError("Each item must be an object.")
    sku = str(raw.get("sku") or "").strip()
    if not SKU.match(sku):
        raise ValueError("SKU must be 1 to 80 characters: letters, numbers, dot, dash or underscore.")
    title = " ".join(str(raw.get("title") or "").split())
    if not 1 <= len(title) <= 200:
        raise ValueError("Title must be 1 to 200 characters.")
    description = str(raw.get("description") or "").strip()
    if len(description) > 2000:
        raise ValueError("Description can be 2000 characters at most.")
    currency = str(raw.get("currency") or "INR").strip().upper()
    if not re.fullmatch(r"[A-Z]{3}", currency):
        raise ValueError("Currency must be a 3-letter code such as INR or USD.")
    availability = str(raw.get("availability") or "in_stock").strip().lower()
    if availability not in AVAILABILITY:
        raise ValueError(f"Availability must be one of: {', '.join(AVAILABILITY)}.")
    url = clean_url(raw.get("product_url"), "Product link")
    if not url:
        raise ValueError("Product link is required.")
    image = clean_url(raw.get("image_url"), "Image link")
    return {"sku": sku, "title": title, "description": description or None, "price": parse_price(raw.get("price")), "currency": currency,
            "availability": availability, "product_url": url, "image_url": image}


def item_out(i: CatalogItem) -> dict[str, Any]:
    return {"sku": i.sku, "title": i.title, "description": i.description or "", "price": float(i.price or 0), "currency": i.currency, "availability": i.availability,
            "product_url": i.product_url, "image_url": i.image_url or ""}


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(text or "").lower()).strip("-")[:80]


def items_from_services(b: Business) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The project's services as catalog rows, plus the ones that cannot be listed (no price or no link): a price is never made up."""
    url = (b.website or b.booking_url or "").strip()
    currency = CURRENCY_OF.get((b.country or "IN").upper())
    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    for n, s in enumerate(b.services or [], start=1):
        name = " ".join(str((s or {}).get("name") or "").split())
        if not name:
            continue
        digits = re.search(r"\d[\d,]*(?:\.\d+)?", str((s or {}).get("price") or ""))
        cur = str((s or {}).get("currency") or "").upper() or currency
        why = ("Add a price to this service, then import again." if not digits else "Add the website or a booking link to the project first." if not url
               else "Set the currency for this service." if not cur else "")
        if why:
            errors.append({"row": n, "sku": slug(name), "error": why})
            continue
        rows.append({"sku": slug(name) or f"service-{n}", "title": name[:200], "description": str((s or {}).get("description") or "")[:2000], "price": digits.group(0),
                     "currency": cur, "availability": "in_stock", "product_url": url})
    return rows, errors


# ---------- the saved record and the project's own data
def profile_defaults(b: Business) -> dict[str, Any]:
    return {"business_name": b.name or "", "category": b.primary_category or "", "description": trim_description(b.description), "website_url": b.website or "",
            "logo_url": b.logo or "", "delivery_policy": "", "return_policy": ""}


def profile_of(row: ChatGPTBusiness | None) -> dict[str, Any]:
    r = row
    return {"business_name": (r.business_name if r else None) or "", "category": (r.category if r else None) or "", "description": (r.description if r else None) or "",
            "website_url": (r.website_url if r else None) or "", "logo_url": (r.logo_url if r else None) or "",
            "delivery_policy": (r.delivery_policy if r else None) or "", "return_policy": (r.return_policy if r else None) or ""}


def insights_out(row: ChatGPTBusiness | None) -> list[dict[str, Any]]:
    return sorted(({"month": i["month"], "mentions": int(i.get("mentions") or 0), "website_clicks": int(i.get("website_clicks") or 0), "topics": list(i.get("topics") or [])}
                   for i in ((row.insights if row else None) or [])), key=lambda x: x["month"])


# ---------- the feed
def _price_text(i: CatalogItem) -> str:
    return f"{Decimal(i.price or 0).quantize(Decimal('0.01'))} {i.currency}"


def feed_json(b: Business, items: list[CatalogItem]) -> dict[str, Any]:
    currencies = {i.currency for i in items}
    out: dict[str, Any] = {"business": {"name": b.name, "url": b.website or ""}, "generated_at": datetime.now(timezone.utc).isoformat()}
    if len(currencies) == 1:
        out["currency"] = next(iter(currencies))
    out["items"] = [{"id": i.sku, "title": i.title, "description": i.description or "", "link": i.product_url, "image_link": i.image_url or "", "price": _price_text(i),
                     "availability": i.availability} for i in items]
    return out


def _safe_cell(v: Any) -> str:
    s = str(v if v is not None else "")
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s  # a spreadsheet would run it as a formula


def feed_csv(items: list[CatalogItem]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n", quoting=csv.QUOTE_MINIMAL)
    w.writerow(["id", "title", "description", "link", "image_link", "price", "availability"])
    for i in items:
        w.writerow([_safe_cell(x) for x in (i.sku, i.title, i.description or "", i.product_url, i.image_url or "", _price_text(i), i.availability)])
    return buf.getvalue()


# ---------- JSON-LD
SUBTYPES = [(r"dentist|dental", "Dentist"), (r"hospital", "Hospital"), (r"clinic|medical|doctor|physician", "MedicalClinic"), (r"physio", "Physiotherapy"), (r"restaurant", "Restaurant"),
            (r"cafe|coffee", "CafeOrCoffeeShop"), (r"bakery", "Bakery"), (r"hotel", "Hotel"), (r"gym|fitness", "ExerciseGym"), (r"salon|beauty|spa", "BeautySalon"),
            (r"lawyer|attorney|law firm", "Attorney"), (r"account", "AccountingService"), (r"school|coaching|tuition", "School"), (r"real estate", "RealEstateAgent"),
            (r"car repair|auto repair|garage", "AutoRepair"), (r"clothing|clothes|boutique|apparel|fashion", "ClothingStore"), (r"jewel", "JewelryStore"),
            (r"pharmacy|chemist", "Pharmacy"), (r"supermarket|grocery", "GroceryStore")]
DAYS = {"MONDAY": "Monday", "TUESDAY": "Tuesday", "WEDNESDAY": "Wednesday", "THURSDAY": "Thursday", "FRIDAY": "Friday", "SATURDAY": "Saturday", "SUNDAY": "Sunday"}


def _hhmm(t: dict[str, Any] | None) -> str:
    h, m = int((t or {}).get("hours") or 0), int((t or {}).get("minutes") or 0)
    return "23:59" if h >= 24 else f"{h:02d}:{m:02d}"


def _social_url(kind: str, v: Any) -> str | None:
    s = str(v or "").strip()
    if not s:
        return None
    if re.match(r"^https?://", s, re.I):
        return s
    s = s.lstrip("@").strip("/")
    return f"https://www.{kind}.com/{quote(s)}" if s else None


def _prune(x: Any) -> Any:
    if isinstance(x, dict):
        out = {k: _prune(v) for k, v in x.items()}
        return {k: v for k, v in out.items() if v not in (None, "", [], {})}
    if isinstance(x, list):
        return [v for v in (_prune(v) for v in x) if v not in (None, "", [], {})]
    return x


def jsonld(b: Business, row: ChatGPTBusiness | None, items: list[CatalogItem]) -> tuple[dict[str, Any], list[str]]:
    """Organization (no street address) or LocalBusiness for the claimed profile; saved copy first, then the project's data. Returns (schema, warnings)."""
    p = profile_of(row)
    name = p["business_name"] or b.name
    description = p["description"] or trim_description(b.description)
    url = p["website_url"] or b.website
    logo = p["logo_url"] or b.logo
    local = bool((b.address or "").strip())
    kind = "Organization"
    if local:
        kind = next((t for pattern, t in SUBTYPES if re.search(pattern, (p["category"] or b.primary_category or "").lower())), "LocalBusiness")
    data: dict[str, Any] = {"@context": "https://schema.org", "@type": kind, "name": name, "description": description, "url": url, "logo": logo, "telephone": b.phone,
                            "email": b.contact_email or None}
    if local:
        data["address"] = {"@type": "PostalAddress", "streetAddress": (b.address or "").strip(), "addressLocality": b.city, "addressCountry": (b.country or "").upper() or None}
        if b.lat is not None and b.lng is not None:
            data["geo"] = {"@type": "GeoCoordinates", "latitude": b.lat, "longitude": b.lng}
    spec = []
    for per in (b.hours or {}).get("periods", []) or []:
        day = DAYS.get(str(per.get("openDay") or "").upper())
        if day:
            spec.append({"@type": "OpeningHoursSpecification", "dayOfWeek": day, "opens": _hhmm(per.get("openTime")), "closes": _hhmm(per.get("closeTime"))})
    if spec:
        data["openingHoursSpecification"] = spec
    social = b.social_accounts or {}
    same = [(b.gbp_status or {}).get("maps_url"), _social_url("facebook", social.get("facebook")), _social_url("instagram", social.get("instagram"))]
    data["sameAs"] = [u for u in same if u]
    if items:
        data["hasOfferCatalog"] = {"@type": "OfferCatalog", "name": f"{name} catalog", "itemListElement": [
            {"@type": "Offer", "name": i.title, "price": f"{Decimal(i.price or 0).quantize(Decimal('0.01'))}", "priceCurrency": i.currency,
             "availability": SCHEMA_AVAILABILITY.get(i.availability), "url": i.product_url} for i in items]}
    if b.rating and (b.review_count or 0) > 0:  # only what Google reported
        data["aggregateRating"] = {"@type": "AggregateRating", "ratingValue": float(b.rating), "reviewCount": int(b.review_count)}
    data = _prune(data)
    warnings = []
    for key, msg in (("description", "Add a description."), ("logo", "Add a logo address."), ("url", "Add the website address."), ("telephone", "Add a phone number."),
                     ("sameAs", "Link the Google Business Profile or a social page (sameAs).")):
        if key not in data:
            warnings.append(msg)
    if local and "openingHoursSpecification" not in data:
        warnings.append("Add opening hours.")
    if not local:
        warnings.append("No street address on the project, so this is an Organization. Add the address to publish it as a LocalBusiness.")
    if not items:
        warnings.append("Add products or services to the feed to include an offer catalog.")
    return data, warnings


# ---------- the Business Agent
def agent_guidelines(b: Business, row: ChatGPTBusiness | None, items: list[CatalogItem]) -> str:
    p = profile_of(row)
    name = p["business_name"] or b.name
    category = p["category"] or b.primary_category or "business"
    services = [str((s or {}).get("name")).strip() for s in (b.services or []) if (s or {}).get("name")] or [i.title for i in items]
    contact = " or ".join(x for x in (b.phone, b.contact_email) if x)
    lines = [f"You are the assistant for {name}, a {category}" + (f" in {b.city}" if b.city else "") + ".",
             "Answer only from the information below and from this business's own website. If the answer is not here, say you are not sure and offer to hand over to the team.", "",
             "WHAT THE BUSINESS OFFERS", ", ".join(services[:20]) if services else "(add the services or products to the project)", "",
             "WHAT YOU HELP WITH", "Questions about the services above, opening hours, location, the prices that are listed, and how to book or order.", "",
             "POLICIES"]
    lines.append(f"Delivery: {p['delivery_policy']}" if p["delivery_policy"] else "Delivery: not provided. Do not make one up; say the team will confirm.")
    lines.append(f"Returns: {p['return_policy']}" if p["return_policy"] else "Returns: not provided. Do not make one up; say the team will confirm.")
    lines += ["", "RULES",
              "- Never invent prices, discounts, availability, delivery times or opening hours. Use only what is listed.",
              "- Do not give medical, legal or financial advice. Say a qualified person should be asked.",
              "- Keep answers short, polite and in plain words.",
              "- For refunds, complaints, damaged goods, payment problems or anything you do not know, hand over to a person.", "",
              "HAND OVER TO A PERSON"]
    lines.append(f"Ask them to contact {name} on {contact}." if contact else "Ask them to contact the business directly (add a phone number or email to the project).")
    return "\n".join(lines)


# ---------- readiness
def readiness(b: Business, row: ChatGPTBusiness | None, items: list[CatalogItem]) -> dict[str, Any]:
    """Four equal core items make the score (25% each); the rest are recommended extras that do not change it."""
    p = profile_of(row)
    _, warnings = jsonld(b, row, items)
    core = [
        ("profile", "Profile filled in", all(p[k] for k in ("business_name", "category", "description", "website_url")), "Business name, category, description and website, saved on the Profile tab."),
        ("policies", "Delivery and return policies", bool(p["delivery_policy"] and p["return_policy"]), "Write both policies so ChatGPT can answer these questions correctly."),
        ("feed", "Products or services in the feed", bool(items), "Add at least one item on the Feed tab."),
        ("verification", "Claimed, approved and verified", bool(row and row.claim_status == "Claim_Approved" and row.verification_method), "Claim it in OpenAI's Business Hub, choose how it was verified, and set the status to Claim_Approved here."),
    ]
    extra = [
        ("persona", "Persona identity check done", bool(row and row.persona_verified), "Complete the ID check in the Business Hub for the blue checkmark."),
        ("logo", "Logo set", bool(p["logo_url"]), "Add the logo address on the Profile tab."),
        ("jsonld", "Website structured data complete", not warnings, "; ".join(warnings[:2]) if warnings else "Complete."),
    ]
    if row and row.agent_enabled:
        extra.append(("agent", "Business Agent instructions written", bool((row.agent_instructions or "").strip()), "Write the rules the agent follows, or copy the starter."))
    score = round(sum(1 for _, _, d, _ in core if d) / len(core) * 100)
    return {"score": score, "items": [{"key": k, "label": label, "done": d, "hint": hint, "core": True} for k, label, d, hint in core]
            + [{"key": k, "label": label, "done": d, "hint": hint, "core": False} for k, label, d, hint in extra]}
