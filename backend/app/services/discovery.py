"""Find a business from an email address (no Google sign-in): public data only.

  1. The email's domain -> the business website (free mailboxes like gmail.com have none:
     then the business name is needed).
  2. The website is read for the business facts: schema.org LocalBusiness data, tel: links,
     address with PIN code, meta description, social profiles.
  3. Google Maps (Places API, needs GOOGLE_PLACES_API_KEY) is searched by name + city and by
     the website's domain, giving the real listing: Place ID, rating, review count, category,
     hours, map pin and up to 5 recent reviews.

Read-only: managing the profile (posts, replies) still needs the owner's Google sign-in.
"""
import json
import re
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from ..config import get_settings
from .net import site_client

FREE_MAIL = {"gmail.com", "googlemail.com", "yahoo.com", "yahoo.in", "yahoo.co.in", "outlook.com", "hotmail.com", "live.com", "msn.com",
             "icloud.com", "me.com", "rediffmail.com", "rediff.com", "aol.com", "protonmail.com", "proton.me", "zoho.com", "zohomail.in", "gmx.com", "yandex.com"}
UA = "Mozilla/5.0 (compatible; CodigixSEOAuditBot/1.0; +https://codigixinfotech.com)"
PLACES = "https://places.googleapis.com/v1"
SEARCH_FIELDS = ",".join(f"places.{f}" for f in ["id", "displayName", "formattedAddress", "nationalPhoneNumber", "internationalPhoneNumber", "websiteUri", "rating",
                                                  "userRatingCount", "primaryTypeDisplayName", "types", "location", "googleMapsUri", "businessStatus", "regularOpeningHours"])
DETAIL_FIELDS = "id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,websiteUri,rating,userRatingCount,primaryTypeDisplayName,location,googleMapsUri,regularOpeningHours,reviews,photos,editorialSummary,addressComponents"
PHONE_RE = re.compile(r"(?:\+?91[\s-]?)?(?:0)?([6-9]\d{4}[\s-]?\d{5}|[2-9]\d{1,3}[\s-]?\d{6,8})")
PIN_RE = re.compile(r"\b[1-9]\d{5}\b")
LOCALBUSINESS_HINT = re.compile(r"LocalBusiness|Organization|Store|Clinic|Dentist|Physician|Restaurant|Salon|Gym|Hotel|Service|Contractor|School", re.I)


APP_ROOT = re.compile(r'<div[^>]+id=["\'](root|app|__next|__nuxt)["\']', re.I)


def renders_with_javascript(html: str, word_count: int) -> bool:
    """A single-page app: the raw HTML is an empty shell filled in by JavaScript."""
    return word_count < 60 and bool(APP_ROOT.search(html or ""))


class DiscoveryError(RuntimeError):
    pass


def email_domain(email: str) -> str:
    m = re.match(r"^[^@\s]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$", (email or "").strip())
    if not m:
        raise DiscoveryError("That doesn't look like an email address.")
    return m.group(1).lower()


def _digits(s: str | None) -> str:
    return re.sub(r"\D", "", s or "")[-10:]


def _norm_phone(raw: str | None) -> str | None:
    d = _digits(raw)
    return f"+91 {d[:5]} {d[5:]}" if len(d) == 10 else (raw.strip() if raw else None)


# ── 2. the website ─────────────────────────────────────────────────────────────
def _schema_nodes(soup: BeautifulSoup) -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = []
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
        except (ValueError, TypeError):
            continue
        stack = data if isinstance(data, list) else [data]
        while stack:
            n = stack.pop()
            if isinstance(n, dict):
                if "@graph" in n:
                    stack.extend(n["@graph"] if isinstance(n["@graph"], list) else [n["@graph"]])
                nodes.append(n)
            elif isinstance(n, list):
                stack.extend(n)
    return nodes


def extract_facts(url: str, html: str) -> dict[str, Any]:
    """Business facts from one web page (pure function, used by tests)."""
    soup = BeautifulSoup(html or "", "html.parser")
    facts: dict[str, Any] = {"website": url}
    biz = next((n for n in _schema_nodes(soup) if LOCALBUSINESS_HINT.search(str(n.get("@type", "")))), None)
    if biz:
        t = biz.get("@type")
        facts["schema_type"] = t[0] if isinstance(t, list) else t
        facts["name"] = biz.get("name")
        facts["phone"] = _norm_phone(biz.get("telephone"))
        addr = biz.get("address")
        if isinstance(addr, dict):
            parts = [addr.get("streetAddress"), addr.get("addressLocality"), addr.get("addressRegion"), addr.get("postalCode")]
            facts["address"] = ", ".join(p for p in parts if p)
            facts["city"] = addr.get("addressLocality")
        elif isinstance(addr, str):
            facts["address"] = addr
        geo = biz.get("geo") or {}
        if isinstance(geo, dict) and geo.get("latitude"):
            facts["lat"], facts["lng"] = float(geo["latitude"]), float(geo["longitude"])
        if biz.get("openingHours"):
            facts["opening_hours"] = biz["openingHours"]
        facts["same_as"] = biz.get("sameAs") if isinstance(biz.get("sameAs"), list) else None
        facts["rating"] = (biz.get("aggregateRating") or {}).get("ratingValue") if isinstance(biz.get("aggregateRating"), dict) else None
    if not facts.get("name"):
        og = soup.find("meta", property="og:site_name")
        title = (soup.title.string or "").strip() if soup.title and soup.title.string else ""
        facts["name"] = (og.get("content") if og else None) or re.split(r"\s[|\-–:]\s", title)[0].strip() or None
    if not facts.get("phone"):
        tel = soup.find("a", href=re.compile(r"^tel:", re.I))
        if tel:
            facts["phone"] = _norm_phone(tel["href"][4:])
        else:
            m = PHONE_RE.search(soup.get_text(" ", strip=True))
            if m:
                facts["phone"] = _norm_phone(m.group(0))
    if not facts.get("address"):
        text = soup.get_text("\n", strip=True)
        line = next((ln for ln in text.split("\n") if PIN_RE.search(ln) and len(ln) < 200), None)
        if line:
            facts["address"] = line.strip()
    meta = soup.find("meta", attrs={"name": re.compile("^description$", re.I)})
    if meta and meta.get("content"):
        facts["description"] = meta["content"].strip()[:750]
    socials = {a["href"] for a in soup.find_all("a", href=True) if re.search(r"facebook\.com|instagram\.com|linkedin\.com|youtube\.com|x\.com|twitter\.com", a["href"])}
    if socials:
        facts["socials"] = sorted(socials)[:8]
    if renders_with_javascript(html, len(soup.get_text(" ", strip=True).split())):
        facts["javascript_only"] = True
    maps = soup.find("a", href=re.compile(r"google\.[a-z.]+/maps|maps\.app\.goo\.gl|g\.page", re.I))
    if maps:
        facts["maps_link"] = maps["href"]
    return {k: v for k, v in facts.items() if v not in (None, "", [])}


def read_website(domain: str) -> dict[str, Any] | None:
    """Fetch the home page (and the contact page if the home page has no phone/address)."""
    with site_client() as client:
        home = None
        for url in (f"https://{domain}", f"https://www.{domain}", f"http://{domain}"):
            try:
                r = client.get(url)
                if r.status_code < 400 and "html" in r.headers.get("content-type", ""):
                    home = r
                    break
            except httpx.HTTPError:
                continue
        if not home:
            return None
        facts = extract_facts(str(home.url), home.text)
        if not facts.get("phone") or not facts.get("address"):
            soup = BeautifulSoup(home.text, "html.parser")
            contact = next((a["href"] for a in soup.find_all("a", href=True) if re.search(r"contact", a["href"] + a.get_text(), re.I)), None)
            if contact:
                try:
                    c = client.get(urljoin(str(home.url), contact))
                    more = extract_facts(str(c.url), c.text) if c.status_code < 400 else {}
                    for k in ("phone", "address", "lat", "lng", "city"):
                        if more.get(k) and not facts.get(k):
                            facts[k] = more[k]
                except httpx.HTTPError:
                    pass
        facts["website"] = f"{urlparse(str(home.url)).scheme}://{urlparse(str(home.url)).netloc}"
        return facts


# ── 3. Google Maps (Places API) ────────────────────────────────────────────────
def places_enabled() -> bool:
    return bool(get_settings().google_places_api_key)


def _places_post(query: str) -> list[dict[str, Any]]:
    r = httpx.post(f"{PLACES}/places:searchText", json={"textQuery": query, "regionCode": "IN", "maxResultCount": 5},
                   headers={"X-Goog-Api-Key": get_settings().google_places_api_key, "X-Goog-FieldMask": SEARCH_FIELDS}, timeout=20)
    if r.status_code != 200:
        msg = (r.json().get("error") or {}).get("message", r.text[:200]) if r.content else f"HTTP {r.status_code}"
        if "not been used" in msg or "disabled" in msg.lower():
            raise DiscoveryError("Places API (New) is not enabled in the Google Cloud project for GOOGLE_PLACES_API_KEY.")
        raise DiscoveryError(f"Google Places: {msg}")
    return r.json().get("places", [])


def place_to_candidate(p: dict[str, Any], reason: str) -> dict[str, Any]:
    loc = p.get("location") or {}
    return {
        "source": "google_maps", "match": reason,
        "place_id": p.get("id"), "name": (p.get("displayName") or {}).get("text"),
        "address": p.get("formattedAddress"), "phone": _norm_phone(p.get("nationalPhoneNumber") or p.get("internationalPhoneNumber")),
        "website": p.get("websiteUri"), "rating": p.get("rating"), "review_count": p.get("userRatingCount"),
        "category": (p.get("primaryTypeDisplayName") or {}).get("text"), "lat": loc.get("latitude"), "lng": loc.get("longitude"),
        "maps_url": p.get("googleMapsUri"), "status": p.get("businessStatus"),
        "hours": (p.get("regularOpeningHours") or {}).get("weekdayDescriptions"),
    }


def place_details(place_id: str) -> dict[str, Any]:
    r = httpx.get(f"{PLACES}/places/{place_id}", headers={"X-Goog-Api-Key": get_settings().google_places_api_key, "X-Goog-FieldMask": DETAIL_FIELDS}, timeout=20)
    if r.status_code != 200:
        raise DiscoveryError(f"Google Places details: HTTP {r.status_code}")
    return r.json()


# ── putting it together ────────────────────────────────────────────────────────
def discover(email: str, name: str = "", city: str = "") -> dict[str, Any]:
    domain = email_domain(email)
    free = domain in FREE_MAIL
    out: dict[str, Any] = {"email": email, "domain": None if free else domain, "free_mailbox": free, "website": None,
                           "candidates": [], "places_enabled": places_enabled(), "notes": []}
    site = None
    if not free:
        site = read_website(domain)
        out["website"] = site
        if not site:
            out["notes"].append(f"No website answered at {domain}.")
        elif site.get("javascript_only"):
            out["notes"].append(f"{domain} builds its content with JavaScript, so only the name could be read from it (search engines and AI crawlers may see an empty page too). "
                                "Add the city, and the Google Maps lookup fills in the address, phone, rating and hours.")
    elif not name:
        out["notes"].append(f"{domain} is a personal mailbox, so it doesn't point to a website. Add the business name (and city) to search Google Maps.")

    query_name = name or (site or {}).get("name")
    query_city = city or (site or {}).get("city") or ""
    seen: set[str] = set()
    if places_enabled():
        queries = []
        if query_name:
            queries.append((f"{query_name} {query_city}".strip(), "name" + (" + city" if query_city else "")))
        if site and site.get("phone"):
            queries.append((site["phone"], "phone from the website"))
        if not free and not queries:
            queries.append((domain, "website domain"))
        for q, reason in queries:
            for p in _places_post(q):
                c = place_to_candidate(p, reason)
                if c["place_id"] in seen:
                    continue
                seen.add(c["place_id"])
                # A listing whose website or phone matches the email's business is the strongest match.
                if (domain and c.get("website") and domain in (c["website"] or "")) or (site and site.get("phone") and _digits(site["phone"]) == _digits(c.get("phone"))):
                    c["match"] = "website or phone matches"
                    c["confidence"] = "high"
                out["candidates"].append(c)
    else:
        out["notes"].append("Google Maps lookup is off: set GOOGLE_PLACES_API_KEY on the SEO backend to find the real listing (rating, reviews, category, hours).")
    if site and site.get("name"):
        out["candidates"].append({
            "source": "website", "match": "read from the website", "place_id": None, "name": site.get("name"), "address": site.get("address"),
            "phone": site.get("phone"), "website": site.get("website"), "rating": site.get("rating"), "review_count": None,
            "category": site.get("schema_type"), "lat": site.get("lat"), "lng": site.get("lng"), "maps_url": site.get("maps_link"),
            "description": site.get("description"), "socials": site.get("socials"),
        })
    out["candidates"].sort(key=lambda c: (c.get("confidence") != "high", c["source"] != "google_maps"))
    return out
