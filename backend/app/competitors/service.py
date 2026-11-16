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
    "places.id",
    "places.primaryTypeDisplayName",
])


class CompetitorSearchError(RuntimeError):
    pass


def competitors_enabled() -> bool:
    return bool(_key())


def find_competitors(business_type: str, location: str, own_firm_name: str = "", top_n: int = 10, region: str = "IN") -> list[dict[str, Any]]:
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
        "textQuery": f"{business_type} in {location}" if location.strip() else business_type,
        "regionCode": (region or "IN").upper()[:2],
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
            "place_id": p.get("id", ""),
            "category": (p.get("primaryTypeDisplayName") or {}).get("text", ""),
        })
        if len(results) == top_n:
            break
    return results


def places_search(query: str, region: str = "IN", lat: float | None = None, lng: float | None = None, radius_m: float = 5000.0, page_size: int = 20, language: str = "en") -> list[dict[str, Any]]:
    """Google Maps results for a search, in Google's own order, from the Places API (New). With a point, results are biased to a circle around it (the Maps view from that spot).
    Each item: {position, title, rating, ratingCount, category, address, website, phoneNumber, cid (the Google place id), maps_link}."""
    api_key = _key()
    if not api_key:
        raise CompetitorSearchError("Google Maps results are off: set GOOGLE_PLACES_API_KEY on the SEO backend.")
    body: dict[str, Any] = {"textQuery": query, "regionCode": (region or "IN").upper()[:2], "languageCode": language, "pageSize": max(1, min(int(page_size), 20))}
    if lat is not None and lng is not None:
        body["locationBias"] = {"circle": {"center": {"latitude": float(lat), "longitude": float(lng)}, "radius": float(max(1.0, min(radius_m, 50000.0)))}}
    try:
        resp = httpx.post(URL, headers={"Content-Type": "application/json", "X-Goog-Api-Key": api_key, "X-Goog-FieldMask": FIELDS}, json=body, timeout=30)
    except httpx.HTTPError as exc:
        raise CompetitorSearchError(f"Google Places did not answer: {exc}") from exc
    if resp.status_code != 200:
        msg = (resp.json().get("error") or {}).get("message", resp.text[:200]) if resp.content else f"HTTP {resp.status_code}"
        raise CompetitorSearchError(f"Google Places: {msg}")
    out = []
    for i, p in enumerate(resp.json().get("places", [])):
        if p.get("businessStatus") == "CLOSED_PERMANENTLY":
            continue
        out.append({"position": len(out) + 1, "title": p.get("displayName", {}).get("text", ""), "rating": p.get("rating"), "ratingCount": p.get("userRatingCount", 0),
                    "category": (p.get("primaryTypeDisplayName") or {}).get("text", ""), "address": p.get("formattedAddress", ""), "website": p.get("websiteUri", ""),
                    "phoneNumber": p.get("nationalPhoneNumber", ""), "cid": p.get("id", ""), "placeId": p.get("id", ""), "maps_link": p.get("googleMapsUri", "")})
    return out
