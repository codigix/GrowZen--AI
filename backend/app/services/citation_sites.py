"""Business listings (citations): the sites that matter, where to add a business on each, and how a listing page is checked.

A citation is the business's name, address and phone (NAP) on another site. They must match the Google Business Profile exactly.
Listings are added by a person (the link of the listing) and the page is checked here: Google has no API that finds listings.
"""
import re
from typing import Any

from . import countries, site_guard
from .net import site_client

# key, label, domain, where to add the business, kind, countries it applies to (None = everywhere)
CATALOG: list[tuple[str, str, str, str, str, list[str] | None]] = [
    ("google", "Google Business Profile", "google.com", "https://business.google.com/create", "core", None),
    ("bing", "Bing Places", "bing.com", "https://www.bingplaces.com/", "core", None),
    ("apple", "Apple Business Connect", "apple.com", "https://businessconnect.apple.com/", "core", None),
    ("facebook", "Facebook", "facebook.com", "https://www.facebook.com/pages/create", "social", None),
    ("instagram", "Instagram", "instagram.com", "https://business.instagram.com/getting-started", "social", None),
    ("linkedin", "LinkedIn", "linkedin.com", "https://www.linkedin.com/company/setup/new/", "social", None),
    ("justdial", "Justdial", "justdial.com", "https://www.justdial.com/Free-Listing", "directory", ["IN"]),
    ("sulekha", "Sulekha", "sulekha.com", "https://www.sulekha.com/post-free-business-listing", "directory", ["IN"]),
    ("indiamart", "IndiaMART", "indiamart.com", "https://seller.indiamart.com/", "directory", ["IN"]),
    ("tradeindia", "TradeIndia", "tradeindia.com", "https://www.tradeindia.com/seller-registration/", "directory", ["IN"]),
    ("magicpin", "magicpin", "magicpin.in", "https://magicpin.in/merchant/", "directory", ["IN"]),
    ("yellowpages", "Yellow Pages", "yellowpages.com", "https://www.yellowpages.com/claim", "directory", ["US", "CA"]),
    ("yelp", "Yelp", "yelp.com", "https://biz.yelp.com/signup", "directory", ["US", "CA", "GB", "AU"]),
    ("foursquare", "Foursquare", "foursquare.com", "https://foursquare.com/add-place", "directory", None),
]
BY_KEY = {c[0]: c for c in CATALOG}
KINDS = {"core": "Core listing", "social": "Social profile", "directory": "Directory"}
STATUSES = ("listed", "inconsistent", "missing", "pending")


def key_of(label: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (label or "").lower())


def search_url(label: str, name: str) -> str:
    from urllib.parse import quote_plus
    return f"https://www.google.com/search?q={quote_plus(f'add business to {label} {name}'.strip())}"


def catalog_for(country: str | None, audit_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The listing sites to track for a business in this country, plus any site the automatic check reported that is not in the catalog."""
    c = countries.code(country)
    out = [{"key": k, "label": label, "domain": dom, "submit_url": url, "kind": kind} for k, label, dom, url, kind, only in CATALOG if only is None or c in only]
    known = {x["key"] for x in out}
    for r in audit_rows:
        k = key_of(r.get("directory"))
        if k and k not in known:
            known.add(k)
            out.append({"key": k, "label": r.get("directory"), "domain": "", "submit_url": None, "kind": "directory"})
    return out


def fetch_page(url: str) -> tuple[int, str]:
    """(status code, page text) of a listing page, fetched through the SSRF-safe client."""
    with site_client(timeout=12) as c:
        r = c.get(url)
        return r.status_code, r.text[:400_000]


def _brand_forms(name: str) -> list[str]:
    """The ways a business is really written on other sites: its full name, the part before a dash or colon ("Codigix Infotech – Healthcare Marketing Agency"
    is "Codigix Infotech"), and its first word ("Codigix"), each reduced to letters and digits."""
    flat = lambda t: re.sub(r"[^a-z0-9]", "", t.lower())
    head = re.split(r"\s[-–—|:]\s|[:|]", name or "")[0]
    words = re.findall(r"[A-Za-z0-9]+", head)
    forms = [flat(name), flat(head)]
    if len(words) >= 2:
        forms.append(flat(" ".join(words[:2])))
    if words and len(words[0]) >= 5:
        forms.append(flat(words[0]))
    return [f for f in dict.fromkeys(forms) if f]


def check_listing(business: Any, url: str, page: tuple[int, str] | None = None, others: tuple[str, ...] | list[str] = ()) -> dict[str, Any]:
    """Open the listing page and compare it with the business.
    Evidence: the business's name (as written in full, or as its short brand name), its website address, and its phone number. Page text and the page's own
    title and description are read, with entities decoded. A directory must also show the phone; a social profile needs only the name or the website
    (a profile's bio does not have to carry a number).
    Returns {status, found: {name, phone}, note}. status: listed, inconsistent (page found but the phone is not what the profile says), missing (the page does not mention the business)."""
    from html import unescape
    from urllib.parse import urlsplit
    code, html = page if page is not None else fetch_page(url)
    if code >= 400:
        return {"status": "missing", "found": None, "note": f"The page answered with an error ({code}). Check the link."}
    meta = " ".join(re.findall(r"""<meta[^>]+(?:name|property)=["'](?:description|og:description|og:title|twitter:description)["'][^>]+content=["']([^"']*)["']""", html, re.I))
    text = unescape(re.sub(r"<[^>]+>", " ", html) + " " + meta)
    flat = re.sub(r"[^a-z0-9]", "", text.lower())
    forms = _brand_forms(getattr(business, "name", "") or "")
    full, short = (forms[0] if forms else ""), forms[1:]
    host = (urlsplit(getattr(business, "website", None) or "").hostname or "").lower().removeprefix("www.")
    site_hit = site_guard.mentions_host(text, host)
    other = next((h for h in others if site_guard.mentions_host(text, h)), None)
    if other and not site_hit:  # the page is the listing of the owner's other website: the shared brand word or phone must not make it this project's
        return {"status": "missing", "found": {"name": None, "phone": None, "address": None}, "note": f"This page shows {other}, another of your websites, not {host or 'this project'}. Add this project's own listing."}
    country = getattr(business, "country", None)
    mine = countries.national(getattr(business, "phone", None), country)
    runs = re.findall(r"(?<!\d)\+?\d[\d\s().-]{6,17}\d(?!\d)", text)
    phones = [m.strip() for m in runs if 7 <= len(re.sub(r"\D", "", m)) <= 15]  # an 18-digit number is an id, not a phone
    phone_hit = bool(mine) and any(countries.same_phone(mine, p, country) for p in phones)
    name_hit = bool(full) and full in flat
    brand_hit = any(f in flat for f in short)  # the short brand name counts when the website or the phone confirms it is the same business
    title = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    found = {"name": re.sub(r"\s+", " ", unescape(title.group(1))).strip()[:140] if title else None, "phone": next(iter(phones), None), "address": None}
    is_social = any(c[4] == "social" and c[2] in (urlsplit(url).hostname or "") for c in CATALOG)
    if is_social:
        found["phone"] = next((p for p in phones if countries.same_phone(mine, p, country)), None) if mine else None  # a social page's stray numbers are ids, not its phone
    if not (name_hit or (brand_hit and (site_hit or phone_hit or is_social)) or (site_hit and is_social)):
        return {"status": "missing", "found": found, "note": "The business name is not on this page. Check it is the right listing."}
    how = "name" if name_hit else "brand name" + (" and website" if site_hit else " and phone" if phone_hit else "")
    if is_social:
        proof = name_hit or site_hit or phone_hit
        return {"status": "listed", "found": found, "note": f"The {how} match the profile."
                + ("" if proof else " Instagram, Facebook and LinkedIn do not show a website or phone to automatic checks, so make sure this profile is yours.")}
    if mine and not phone_hit:
        return {"status": "inconsistent", "found": found, "note": "The page does not show the profile's phone number. Correct the listing."}
    return {"status": "listed", "found": found, "note": "The " + how + (" and phone match" if mine else " matches") + " the profile."}
