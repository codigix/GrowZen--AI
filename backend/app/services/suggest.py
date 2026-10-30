"""Business-name suggestions while typing, the full details of the one chosen, and map pins.

Sources, merged into one list:
  - the platform's own projects (so a client is never onboarded twice);
  - Google Maps: Places Autocomplete, then Place Details (needs GOOGLE_PLACES_API_KEY);
  - OpenStreetMap, no key: Photon for type-ahead, then a Nominatim lookup when a result is chosen
    (address, pin, phone, website, email, hours, social links and attributes when mapped).
    Nominatim also turns a typed address into a pin and a dragged pin back into an address.
    OSM_LOOKUP_ENABLED=false turns OpenStreetMap off.
After choosing, the business's website (if any) is read to fill in what the map didn't have.

OpenStreetMap's usage policy is respected: an identifying User-Agent, at most one Nominatim request
per second (requests queue behind a lock), and answers cached so the same search isn't sent twice.
"""
import logging
import threading
import time
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Business
from . import countries
from .discovery import PLACES, UA, DiscoveryError, _norm_phone, place_details, place_to_candidate, places_enabled, places_key, read_website, website_domain

log = logging.getLogger("seo.suggest")

PHOTON = "https://photon.komoot.io/api/"
NOMINATIM = "https://nominatim.openstreetmap.org"
NOMINATIM_LOOKUP = f"{NOMINATIM}/lookup"
INDIA_BBOX = "68.1,6.5,97.4,35.7"  # min lon, min lat, max lon, max lat (results stay in India, like the Places region)
NOT_A_BUSINESS = {"place", "boundary", "highway", "railway", "landuse", "natural", "waterway", "route", "building"}
OSM_KINDS = {"N": "node", "W": "way", "R": "relation"}
HEADERS = {"User-Agent": UA, "Accept-Language": "en"}
# OSM tags that map to Google Business Profile style attributes.
ATTRIBUTES = {
    ("wheelchair", "yes"): "Wheelchair accessible", ("delivery", "yes"): "Delivery", ("takeaway", "yes"): "Takeaway",
    ("drive_through", "yes"): "Drive-through", ("outdoor_seating", "yes"): "Outdoor seating", ("air_conditioning", "yes"): "Air-conditioned",
    ("internet_access", "wlan"): "Free Wi-Fi", ("internet_access", "yes"): "Wi-Fi", ("payment:cards", "yes"): "Accepts cards",
    ("payment:upi", "yes"): "Accepts UPI", ("parking", "yes"): "Parking",
}

_cache: dict[tuple, tuple[float, Any]] = {}
_cache_lock = threading.Lock()
_nominatim_lock = threading.Lock()
_nominatim_last = [0.0]


def _cached(key: tuple, ttl: float, fetch):
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1]
    value = fetch()
    with _cache_lock:
        if len(_cache) > 1000:  # small and bounded: drop everything rather than track usage
            _cache.clear()
        _cache[key] = (now + ttl, value)
    return value


def _nominatim(path: str, params: dict[str, Any]) -> Any:
    """GET a Nominatim endpoint: never more than one request per second, cached for a day."""
    def fetch():
        with _nominatim_lock:
            wait = 1.0 - (time.monotonic() - _nominatim_last[0])
            if wait > 0:
                time.sleep(wait)
            try:
                r = httpx.get(f"{NOMINATIM}/{path}", params=params, headers=HEADERS, timeout=10)
            finally:
                _nominatim_last[0] = time.monotonic()
        r.raise_for_status()
        return r.json()
    return _cached(("nominatim", path, tuple(sorted(params.items()))), 24 * 3600, fetch)


def _label(value: str | None) -> str | None:
    return value.replace("_", " ").capitalize() if value else None


def _address_parts(a: dict[str, Any]) -> dict[str, Any]:
    """Nominatim address details -> street, area, city, PIN, state and a one-line address."""
    street = " ".join(x for x in (a.get("house_number"), a.get("road")) if x)
    area = a.get("suburb") or a.get("neighbourhood") or a.get("quarter") or a.get("city_district")
    city = a.get("city") or a.get("town") or a.get("village") or a.get("county")
    line = ", ".join(x for x in (street, area, city, a.get("state"), a.get("postcode")) if x)
    return {"address": line or None, "area": area, "city": city, "pincode": a.get("postcode"), "state": a.get("state")}


# ── suggestions ──────────────────────────────────────────────────────────────
def suggest(db: Session, q: str, near: str = "", session: str = "", country: str = "IN") -> dict[str, Any]:
    """Business names while typing, from existing projects, then Google Maps and OpenStreetMap in `country`."""
    country = countries.code(country)
    q = " ".join((q or "").split())
    s = get_settings()
    out: dict[str, Any] = {"query": q, "suggestions": [], "notes": [],
                           "sources": {"projects": True, "google_maps": places_enabled(), "openstreetmap": s.osm_lookup_enabled}}
    if len(q) < 2:
        return out
    for b in db.scalars(select(Business).where(func.lower(Business.name).contains(q.lower())).order_by(Business.name).limit(4)):
        out["suggestions"].append({"source": "project", "ref": str(b.id), "title": b.name,
                                   "subtitle": ", ".join(x for x in (b.primary_category, b.area, b.city) if x) or "Existing project"})
    text = f"{q} {near}".strip()
    google: list[dict[str, Any]] = []
    if places_enabled():
        try:
            google = _google(text, session, country)
        except (httpx.HTTPError, DiscoveryError, ValueError) as exc:
            out["notes"].append(f"Google Maps suggestions unavailable: {exc}")
    out["suggestions"] += google
    if s.osm_lookup_enabled:
        try:
            osm = _cached(("photon", country, text.lower()), 600, lambda: _osm(text, country))
            out["suggestions"] += osm[:3] if google else osm  # Google's listings are the better match; keep OSM as backup
        except (httpx.HTTPError, ValueError) as exc:
            out["notes"].append(f"OpenStreetMap suggestions unavailable: {exc}")
    return out


def _google(text: str, session: str = "", country: str = "IN") -> list[dict[str, Any]]:
    body: dict[str, Any] = {"input": text, "includedRegionCodes": [countries.gl(country)]}
    if session:
        body["sessionToken"] = session  # with the Place Details call that follows, billed as one session
    r = httpx.post(f"{PLACES}/places:autocomplete", json=body,
                   headers={"X-Goog-Api-Key": places_key()}, timeout=8)
    if r.status_code != 200:
        raise DiscoveryError(((r.json().get("error") or {}).get("message") if r.content else None) or f"HTTP {r.status_code}")
    found = []
    for item in r.json().get("suggestions", []):
        p = item.get("placePrediction")
        if not p:
            continue
        fmt = p.get("structuredFormat") or {}
        found.append({"source": "google_maps", "ref": p.get("placeId"), "title": (fmt.get("mainText") or {}).get("text") or (p.get("text") or {}).get("text"),
                      "subtitle": (fmt.get("secondaryText") or {}).get("text") or ""})
    return found[:6]


def _osm(text: str, country: str = "IN") -> list[dict[str, Any]]:
    params: dict[str, Any] = {"q": text, "limit": 15, "lang": "en"}
    if country == "IN":
        params["bbox"] = INDIA_BBOX  # Photon has no country filter; elsewhere results are filtered by country below
    r = httpx.get(PHOTON, params=params, headers=HEADERS, timeout=8)
    r.raise_for_status()
    # Photon matches loosely: keep names that contain the first word typed (its first 5 letters).
    first = next((w for w in text.lower().split() if len(w) >= 3), text.lower())[:5]
    found, seen = [], set()
    for f in r.json().get("features", []):
        p = f.get("properties") or {}
        if (not p.get("name") or p.get("osm_key") in NOT_A_BUSINESS or p.get("osm_type") not in OSM_KINDS
                or str(p.get("countrycode", country)).upper() != country or first not in p["name"].lower()):
            continue
        where = ", ".join(x for x in (p.get("district") or p.get("locality"), p.get("city") or p.get("county"), p.get("state")) if x)
        key = (p["name"].lower(), where.lower())
        if key in seen:
            continue
        seen.add(key)
        found.append({"source": "openstreetmap", "ref": f"{p['osm_type']}{p['osm_id']}", "title": p["name"],
                      "subtitle": ", ".join(x for x in (_label(p.get("osm_value")), where) if x)})
    return found[:6]


# ── details of the chosen suggestion ─────────────────────────────────────────
def resolve(source: str, ref: str, session: str = "") -> dict[str, Any]:
    """The chosen suggestion as a full candidate (same shape as /discover candidates, plus area, city, pincode)."""
    if source == "google_maps":
        if not places_enabled():
            raise DiscoveryError("Google Maps lookup is off: set GOOGLE_PLACES_API_KEY.")
        c = _from_google(place_details(ref, session))
    elif source == "openstreetmap":
        _require_osm()
        c = _from_osm(ref)
    else:
        raise DiscoveryError("Unknown suggestion source.")
    return _with_website_facts(c)


def _require_osm() -> None:
    if not get_settings().osm_lookup_enabled:
        raise DiscoveryError("OpenStreetMap lookup is turned off (OSM_LOOKUP_ENABLED).")


def _component(components: list[dict[str, Any]], *types: str) -> str | None:
    for t in types:
        for comp in components:
            if t in (comp.get("types") or []):
                return comp.get("longText") or comp.get("shortText")
    return None


def _from_google(d: dict[str, Any]) -> dict[str, Any]:
    c = place_to_candidate(d, "chosen from Google Maps suggestions")
    comps = d.get("addressComponents") or []
    c.update(area=_component(comps, "sublocality_level_1", "sublocality", "neighborhood"), city=_component(comps, "locality", "administrative_area_level_3"),
             pincode=_component(comps, "postal_code"), state=_component(comps, "administrative_area_level_1"),
             description=(d.get("editorialSummary") or {}).get("text"), photo_count=len(d.get("photos") or []), confidence="high")
    return c


def _from_osm(ref: str) -> dict[str, Any]:
    if ref[:1] not in OSM_KINDS or not ref[1:].isdigit():
        raise DiscoveryError("Not an OpenStreetMap reference.")
    items = _nominatim("lookup", {"osm_ids": ref, "format": "jsonv2", "addressdetails": 1, "extratags": 1})
    if not items:
        raise DiscoveryError("OpenStreetMap has no details for this place any more.")
    item = items[0]
    ex = item.get("extratags") or {}
    socials = [v for k in ("contact:facebook", "facebook", "contact:instagram", "instagram", "contact:youtube", "contact:linkedin") if (v := ex.get(k))]
    speciality = ex.get("healthcare:speciality") or ex.get("cuisine")
    country = countries.code((item.get("address") or {}).get("country_code"))
    return {
        "source": "openstreetmap", "match": "chosen from OpenStreetMap suggestions", "confidence": "high", "place_id": None, "country": country,
        "name": item.get("name") or (item.get("display_name") or "").split(",")[0], "category": _label(item.get("type")),
        **_address_parts(item.get("address") or {}),
        "phone": _norm_phone(ex.get("phone") or ex.get("contact:phone") or ex.get("contact:mobile"), country),
        "website": ex.get("website") or ex.get("contact:website"), "email": ex.get("email") or ex.get("contact:email"),
        "hours": [ex["opening_hours"]] if ex.get("opening_hours") else None,
        "attributes": sorted({label for (tag, val), label in ATTRIBUTES.items() if str(ex.get(tag, "")).lower() == val}),
        "services": [s.strip().replace("_", " ").capitalize() for s in speciality.split(";")] if speciality else [],
        "socials": socials or None,
        "lat": float(item["lat"]) if item.get("lat") else None, "lng": float(item["lon"]) if item.get("lon") else None,
        "maps_url": f"https://www.openstreetmap.org/{OSM_KINDS[ref[0]]}/{ref[1:]}", "rating": None, "review_count": None,
    }


def _with_website_facts(c: dict[str, Any]) -> dict[str, Any]:
    """Fill what the map lacked (phone, description, address) from the business's own website."""
    if not c.get("website"):
        return c
    try:
        site = read_website(website_domain(c["website"])) or {}
    except (DiscoveryError, httpx.HTTPError) as exc:
        log.info("Website facts skipped for %s: %s", c.get("website"), exc)
        return c
    filled = [k for k in ("phone", "description", "address") if not c.get(k) and site.get(k)]
    for k in filled:
        c[k] = site[k]
    if site.get("socials"):
        c["socials"] = sorted(set(c.get("socials") or []) | set(site["socials"]))
    if filled:
        c["website_filled"] = filled
    return c


# ── address <-> map pin ──────────────────────────────────────────────────────
def geocode(q: str) -> list[dict[str, Any]]:
    """A typed address -> up to 5 map pins in India."""
    _require_osm()
    q = " ".join((q or "").split())
    if len(q) < 3:
        return []
    items = _nominatim("search", {"q": q, "format": "jsonv2", "addressdetails": 1, "limit": 5, "countrycodes": "in"})
    return [{"lat": float(i["lat"]), "lng": float(i["lon"]), "label": i.get("display_name"), **_address_parts(i.get("address") or {})} for i in items]


AREA_TYPES = {"suburb", "neighbourhood", "quarter", "city_district", "city", "town", "village", "borough", "municipality", "county", "state_district", "administrative", "locality", "hamlet"}


def areas(q: str, country: str = "IN", near: str = "") -> list[dict[str, Any]]:
    """Places to target (suburbs, towns, cities) matching what was typed, inside `country`, with the nearest
    to `near` (the business's city) first. Each is {label, area, city, state, lat, lng}."""
    _require_osm()
    q = " ".join((q or "").split())
    if len(q) < 2:
        return []
    items = _nominatim("search", {"q": q, "format": "jsonv2", "addressdetails": 1, "limit": 10, "countrycodes": countries.code(country).lower(), "accept-language": "en"})
    out, seen = [], set()
    for i in items:
        if i.get("category") not in ("place", "boundary") and i.get("type") not in AREA_TYPES:
            continue
        a = i.get("address") or {}
        p = _address_parts(a)
        name = i.get("name") or p["area"] or p["city"]
        if not name:
            continue
        city = p["city"] if p["city"] and p["city"] != name else None
        label = ", ".join(x for x in (name, city, p["state"] if not city else None) if x)
        if label.lower() in seen:
            continue
        seen.add(label.lower())
        out.append({"label": label, "area": name, "city": city, "state": p["state"], "lat": float(i["lat"]), "lng": float(i["lon"]),
                    "near": bool(near) and near.lower() in (i.get("display_name") or "").lower()})
    return sorted(out, key=lambda x: not x["near"])


def reverse(lat: float, lng: float) -> dict[str, Any]:
    """A map pin -> its address (street, area, city, PIN)."""
    _require_osm()
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise DiscoveryError("Those coordinates are not on the map.")
    item = _nominatim("reverse", {"lat": round(lat, 6), "lon": round(lng, 6), "format": "jsonv2", "addressdetails": 1, "zoom": 18})
    if not item or item.get("error"):
        raise DiscoveryError("No address found at this point.")
    return {"lat": lat, "lng": lng, "label": item.get("display_name"), **_address_parts(item.get("address") or {})}
