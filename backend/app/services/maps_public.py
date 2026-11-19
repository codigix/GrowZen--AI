"""What anyone can see on a Google Maps listing, read through the Places API (no owner sign-in): basic info, location, hours, rating and review count,
photos, a few recent reviews and the amenities Google shows. Services and posts are not part of Google's public data, so they are not read here."""
import time
from typing import Any

import httpx

from . import discovery

FIELDS = ("id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,websiteUri,rating,userRatingCount,primaryType,primaryTypeDisplayName,types,location,googleMapsUri,"
          "regularOpeningHours,regularSecondaryOpeningHours,reviews,photos,editorialSummary,addressComponents,businessStatus,priceLevel,priceRange,plusCode,accessibilityOptions,parkingOptions,"
          "paymentOptions,delivery,dineIn,takeout,curbsidePickup,reservable,outdoorSeating,goodForChildren,goodForGroups,allowsDogs,restroom")
FLAGS = {"delivery": "Delivery", "dineIn": "Dine-in", "takeout": "Takeaway", "curbsidePickup": "Curbside pickup", "reservable": "Takes reservations", "outdoorSeating": "Outdoor seating",
         "goodForChildren": "Good for children", "goodForGroups": "Good for groups", "allowsDogs": "Dogs allowed", "restroom": "Restroom"}
PRICE = {"PRICE_LEVEL_FREE": "Free", "PRICE_LEVEL_INEXPENSIVE": "$", "PRICE_LEVEL_MODERATE": "$$", "PRICE_LEVEL_EXPENSIVE": "$$$", "PRICE_LEVEL_VERY_EXPENSIVE": "$$$$"}
_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def _get(place_id: str, fields: str) -> httpx.Response:
    return httpx.get(f"{discovery.PLACES}/places/{place_id}", timeout=25, headers={"X-Goog-Api-Key": discovery.places_key(), "X-Goog-FieldMask": fields})


def fetch(place_id: str, fresh: bool = False) -> dict[str, Any]:
    hit = _cache.get(place_id)
    if hit and hit[0] > time.monotonic() and not fresh:
        return hit[1]
    r = _get(place_id, FIELDS)
    if r.status_code == 400:  # a field this API version does not know: fall back to the basic set
        r = _get(place_id, discovery.DETAIL_FIELDS)
    if r.status_code != 200:
        msg = (r.json().get("error") or {}).get("message", "") if r.content else ""
        raise discovery.DiscoveryError("Google Maps did not return this listing" + (f": {msg[:160]}" if msg else f" (HTTP {r.status_code})."))
    _cache[place_id] = (time.monotonic() + 600, r.json())
    return _cache[place_id][1]


def _features(p: dict[str, Any]) -> list[str]:
    out = [label for key, label in FLAGS.items() if p.get(key) is True]
    if (p.get("accessibilityOptions") or {}).get("wheelchairAccessibleEntrance"):
        out.append("Wheelchair accessible entrance")
    po = p.get("paymentOptions") or {}
    out += [label for key, label in (("acceptsCreditCards", "Credit cards"), ("acceptsDebitCards", "Debit cards"), ("acceptsCashOnly", "Cash only"), ("acceptsNfc", "Contactless")) if po.get(key)]
    pk = p.get("parkingOptions") or {}
    out += [label for key, label in (("freeParkingLot", "Free parking lot"), ("paidParkingLot", "Paid parking lot"), ("freeStreetParking", "Free street parking"), ("valetParking", "Valet parking")) if pk.get(key)]
    return out


def _price(p: dict[str, Any]) -> str | None:
    if p.get("priceLevel") in PRICE:
        return PRICE[p["priceLevel"]]
    r = p.get("priceRange") or {}
    lo, hi = r.get("startPrice") or {}, r.get("endPrice") or {}
    if lo.get("units"):
        return f"{lo.get('units')}-{hi.get('units', '')} {lo.get('currencyCode', '')}".strip()
    return None


def read(place_id: str, fresh: bool = False) -> dict[str, Any]:
    p = fetch(place_id, fresh)
    loc = p.get("location") or {}
    types = [t.replace("_", " ").capitalize() for t in (p.get("types") or []) if t not in ("point_of_interest", "establishment")]
    country = discovery.countries.detect(p.get("addressComponents"), p.get("formattedAddress"), p.get("internationalPhoneNumber"))
    return {
        "basics": {"name": (p.get("displayName") or {}).get("text"), "category": (p.get("primaryTypeDisplayName") or {}).get("text"), "categories": types[:8],
                   "summary": (p.get("editorialSummary") or {}).get("text"), "address": discovery.clean_address(p.get("formattedAddress")),
                   "phone": discovery._norm_phone(p.get("internationalPhoneNumber") or p.get("nationalPhoneNumber"), country), "website": p.get("websiteUri"),
                   "status": discovery.OPEN_STATUS.get(p.get("businessStatus"), "unknown"), "price": _price(p),
                   "plus_code": (p.get("plusCode") or {}).get("globalCode"), "lat": loc.get("latitude"), "lng": loc.get("longitude")},
        "hours": (p.get("regularOpeningHours") or {}).get("weekdayDescriptions") or [],
        "more_hours": [{"name": (h.get("secondaryHoursType") or "").replace("_", " ").capitalize(), "days": h.get("weekdayDescriptions") or []} for h in (p.get("regularSecondaryOpeningHours") or [])],
        "reputation": {"rating": p.get("rating"), "count": p.get("userRatingCount"), "photos": len(p.get("photos") or []),
                       "reviews": [{"author": (rv.get("authorAttribution") or {}).get("displayName"), "rating": rv.get("rating"), "text": (rv.get("text") or {}).get("text"),
                                    "when": rv.get("relativePublishTimeDescription") or rv.get("publishTime")} for rv in (p.get("reviews") or [])]},
        "features": _features(p), "maps_url": p.get("googleMapsUri"), "review_url": discovery.review_link(p.get("id")),
    }
