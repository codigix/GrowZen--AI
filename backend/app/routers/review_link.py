"""Get more reviews: a share link, a QR code and a public page where a customer is helped to write their own review.

Signed-in side:  GET  /businesses/{id}/review-link
Public side:     GET  /public/review/{token}            what the customer page needs (no private data)
                 POST /public/review/{token}/suggest    an AI-worded review from what the customer picked

The platform never posts a review. The customer copies the wording, edits it and posts it on Google themselves.
Every rating is sent to Google the same way: nobody is filtered out by their stars.
"""
import hashlib
import hmac
import time
from collections import defaultdict, deque
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..deps import get_business
from ..models import Business
from ..services import ai

router = APIRouter(prefix="/businesses/{business_id}", tags=["reviews"])
public_router = APIRouter(prefix="/public/review", tags=["public-review"])

LANGUAGES = ["English", "Hindi", "Marathi"]
_hits: dict[str, deque] = defaultdict(deque)  # ip -> recent suggestion times
LIMIT, WINDOW = 15, 600  # 15 suggestions per 10 minutes per address: the page is public and every call costs an AI request


def token_for(business_id: int) -> str:
    key = get_settings().secret_key.encode()
    mac = hmac.new(key, f"review:{business_id}".encode(), hashlib.sha256).hexdigest()[:12]
    return f"{business_id}-{mac}"


def _business_for(db: Session, token: str) -> Business:
    try:
        raw_id, mac = token.split("-", 1)
        bid = int(raw_id)
    except ValueError:
        raise HTTPException(404, "This review link is not valid.") from None
    if not hmac.compare_digest(token_for(bid), f"{bid}-{mac}"):
        raise HTTPException(404, "This review link is not valid.")
    b = db.get(Business, bid)
    if not b:
        raise HTTPException(404, "This review link is not valid.")
    return b


def google_review_url(b: Business) -> str | None:
    """Google's own 'write a review' address: the one Google gave for the listing, else built from the place id."""
    url = ((b.gbp_status or {}).get("review_url") or "").strip()
    if url.startswith("https://"):
        return url
    return f"https://search.google.com/local/writereview?placeid={b.place_id}" if b.place_id else None


def profile_url(b: Business) -> str:
    """A link that opens the business on Google Maps and Search: the one Google gave for the listing, else a Maps search for its name and address."""
    maps = ((b.gbp_status or {}).get("maps_url") or "").strip()
    if maps.startswith("https://"):
        return maps
    query = " ".join(x for x in [b.name, b.address or ", ".join(y for y in [b.area, b.city] if y)] if x).strip()
    params = {"api": "1", "query": query or b.name}
    if b.place_id:
        params["query_place_id"] = b.place_id
    return f"https://www.google.com/maps/search/?{urlencode(params)}"


def _service_names(b: Business) -> list[str]:
    seen: list[str] = []
    for s in b.services or []:
        n = str((s or {}).get("name") or "").strip()
        if n and n not in seen:
            seen.append(n)
    return seen[:20]


@router.get("/review-link")
def review_link(b: Business = Depends(get_business)):
    s = get_settings()
    token = token_for(b.id)
    return {
        "token": token,
        "share_url": f"{s.frontend_url.rstrip('/')}/r/{token}",
        "google_url": google_review_url(b),
        "profile_url": profile_url(b),
        "services": _service_names(b),
        "public_site": not any(h in s.frontend_url for h in ("localhost", "127.0.0.1", "192.168.", "10.", "172.16.")),
    }


@public_router.get("/{token}")
def public_info(token: str, db: Session = Depends(get_db)):
    b = _business_for(db, token)
    return {"name": b.name, "logo": b.logo, "category": b.primary_category, "city": b.city,
            "services": _service_names(b), "google_url": google_review_url(b), "languages": LANGUAGES}


class SuggestIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    services: list[str] = Field(default_factory=list, max_length=8)
    notes: str = Field(default="", max_length=300)
    language: str = "English"


@public_router.post("/{token}/suggest")
def suggest(token: str, body: SuggestIn, request: Request, db: Session = Depends(get_db)):
    b = _business_for(db, token)
    if not ai.is_configured():
        raise HTTPException(503, "Review suggestions are not available right now. You can still write your own review.")
    ip = request.client.host if request.client else "?"
    now, q = time.time(), _hits[ip]
    while q and now - q[0] > WINDOW:
        q.popleft()
    if len(q) >= LIMIT:
        raise HTTPException(429, "Please wait a few minutes before asking for more suggestions.")
    q.append(now)
    known = _service_names(b)
    picked = [s for s in body.services if s in known][:5]
    language = body.language if body.language in LANGUAGES else "English"
    mood = {5: "very happy", 4: "happy", 3: "mixed, fair and honest", 2: "disappointed but polite", 1: "unhappy but polite and specific"}[body.rating]
    out = ai.complete_json(
        "You help a real customer put their own experience into words for a Google review.\n"
        "Rules: use ONLY what the customer told you below. Never invent staff names, prices, dates, discounts or results. "
        "Match the star rating honestly. Natural, first person, 2 to 4 short sentences, no hashtags, no links, no phone numbers, no emojis, "
        "not salesy. Do not copy the business description.",
        f"Business: {b.name}{' (' + b.primary_category + ')' if b.primary_category else ''}{', ' + b.city if b.city else ''}\n"
        f"Stars given: {body.rating} of 5 ({mood})\n"
        f"Services the customer used: {', '.join(picked) if picked else 'not specified'}\n"
        f"Customer's own note: {body.notes.strip() or 'none'}\n"
        f"Write the review in {language}. Return JSON {{\"text\": string}}.")
    text = str(out.get("text", "")).strip()[:900]
    if not text:
        raise HTTPException(502, "Could not write a suggestion. Please try again.")
    return {"text": text}
