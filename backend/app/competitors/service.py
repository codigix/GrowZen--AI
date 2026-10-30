"""Find top competitors near a location using the Google Places API (New).

Ported from find_comp.py: same lookup, as an API call instead of a CLI script. The result is
returned to the caller only -- nothing here is written to disk or to the database.
"""
from typing import Any

import httpx

from ..config import get_settings


def _key() -> str:
    s = get_settings()
    return s.google_places_api_key or s.google_api_key  # same rule as the rest of the app (services/discovery.places_key)

URL = "https://places.googleapis.com/v1/places:searchText"

# Fields we want back (the field mask controls what you are billed for).
FIELDS = ",".join([
    "places.displayName",
    "places.formattedAddress",
    "places.rating",
    "places.userRatingCount",
    "places.websiteUri",
    "places.nationalPhoneNumber",
    "places.googleMapsUri",
    "places.businessStatus",
])


class CompetitorSearchError(RuntimeError):
    pass


def competitors_enabled() -> bool:
    return bool(_key())


def find_competitors(business_type: str, location: str, own_firm_name: str = "", top_n: int = 10) -> list[dict[str, Any]]:
    """Search Google Maps for `business_type` in `location` and return up to `top_n` results,
    excluding `own_firm_name` and permanently closed businesses."""
    api_key = _key()
    if not api_key:
        raise CompetitorSearchError("Competitor search is off: set GOOGLE_PLACES_API_KEY on the SEO backend.")

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": FIELDS,
    }
    body = {
        "textQuery": f"{business_type} in {location}",
        "regionCode": "IN",
        "languageCode": "en",
        "pageSize": 20,  # fetch extra so we can drop your own firm and still have top_n left
    }

    try:
        resp = httpx.post(URL, headers=headers, json=body, timeout=30)
    except httpx.HTTPError as exc:
        raise CompetitorSearchError(f"Google Places did not answer: {exc}") from exc
    if resp.status_code != 200:
        msg = (resp.json().get("error") or {}).get("message", resp.text[:200]) if resp.content else f"HTTP {resp.status_code}"
        raise CompetitorSearchError(f"Google Places: {msg}")

    results = []
    for p in resp.json().get("places", []):
        name = p.get("displayName", {}).get("text", "")
        if own_firm_name and own_firm_name.lower() in name.lower():
            continue
        if p.get("businessStatus") == "CLOSED_PERMANENTLY":
            continue
        results.append({
            "name": name,
            "rating": p.get("rating", ""),
            "reviews": p.get("userRatingCount", 0),
            "address": p.get("formattedAddress", ""),
            "phone": p.get("nationalPhoneNumber", ""),
            "website": p.get("websiteUri", ""),
            "maps_link": p.get("googleMapsUri", ""),
        })
        if len(results) == top_n:
            break
    return results
