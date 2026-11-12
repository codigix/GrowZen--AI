"""Business listings (citations): the sites that matter, where to add a business on each, and how a listing page is checked.

A citation is the business's name, address and phone (NAP) on another site. They must match the Google Business Profile exactly.
The automatic check (Serper) finds some listings; a person can add a listing's link by hand and have the page checked here.
"""
import re
from typing import Any

from . import countries
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


def check_listing(business: Any, url: str, page: tuple[int, str] | None = None) -> dict[str, Any]:
    """Open the listing page and compare it with the business: the name and the phone must be on it.
    Returns {status, found: {name, phone}, note}. status: listed (name and phone match), inconsistent (page found but the phone or name is not what the profile says), missing (the page does not mention the business)."""
    code, html = page if page is not None else fetch_page(url)
    if code >= 400:
        return {"status": "missing", "found": None, "note": f"The page answered with an error ({code}). Check the link."}
    text = re.sub(r"<[^>]+>", " ", html)
    flat = re.sub(r"[^a-z0-9]", "", text.lower())
    name_flat = re.sub(r"[^a-z0-9]", "", (business.name or "").lower())
    name_hit = bool(name_flat) and name_flat in flat
    country = getattr(business, "country", None)
    mine = countries.national(getattr(business, "phone", None), country)
    runs = re.findall(r"\+?\d[\d\s().-]{8,16}\d", text)
    phones = [m.strip() for m in runs if len(re.sub(r"\D", "", m)) >= 7]
    phone_hit = bool(mine) and any(countries.same_phone(mine, p, country) for p in phones)
    title = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    found = {"name": re.sub(r"\s+", " ", title.group(1)).strip()[:140] if title else None, "phone": next(iter(phones), None), "address": None}
    if not name_hit:
        return {"status": "missing", "found": found, "note": "The business name is not on this page. Check it is the right listing."}
    if mine and not phone_hit:
        return {"status": "inconsistent", "found": found, "note": "The page does not show the profile's phone number. Correct the listing."}
    return {"status": "listed", "found": found, "note": "The name" + (" and phone match" if mine else " matches") + " the profile."}
