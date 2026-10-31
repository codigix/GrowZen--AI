"""Competitor intelligence for one business, Semrush-style, from live Google data.

For the business's keywords: who ranks on Google (organic top 10 and the Maps results), each
competitor's visibility and positions, what the top competitors do on their own sites (the
keywords and services their pages target, location pages, blog, schema, content depth), where
they are listed and linked from, and -- against all that -- the business's own gaps and what to
do first.

Sources: Serper.dev for Google results (SERPER_API_KEY), a short scan of each site, and
no backlink index (Google offers no API for one). "Link sources"
are the sites Google shows listing or mentioning the competitor (directories, social, press) --
not a full backlink index, and the result says so.
"""
from __future__ import annotations

import re
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Callable
from urllib.parse import urljoin, urlparse

import httpx

from ..config import get_settings
from ..services.crawler import analyse_html
from ..services.keywords import CITIES, METRO, NOISE, default_seeds, other_cities
from ..services import countries, market
from ..services.net import site_client

SERPER = "https://google.serper.dev"
CACHE_SECONDS = 12 * 3600

# Share of clicks by position (industry averages): turns positions into "visibility".
CTR = {1: 0.28, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.07, 6: 0.05, 7: 0.04, 8: 0.03, 9: 0.025, 10: 0.02}
LOCAL_CTR = {1: 0.35, 2: 0.2, 3: 0.15, 4: 0.08, 5: 0.06}

# Listing sites, marketplaces and social networks: they rank, but they are places to be listed on,
# not businesses to outrank.
DIRECTORIES = {
    "practo.com", "justdial.com", "sulekha.com", "indiamart.com", "apollo247.com", "lybrate.com", "credihealth.com", "timesmed.com",
    "docprime.com", "healthgrades.com", "clinicspots.com", "mfine.co", "tradeindia.com", "exportersindia.com", "yellowpages.in",
    "facebook.com", "instagram.com", "youtube.com", "linkedin.com", "twitter.com", "x.com", "pinterest.com", "quora.com", "reddit.com",
    "wikipedia.org", "google.com", "maps.google.com", "tripadvisor.in", "tripadvisor.com", "zomato.com", "swiggy.com", "magicpin.in",
    "urbancompany.com", "housing.com", "99acres.com", "magicbricks.com", "nobroker.in", "makemytrip.com", "booking.com", "yelp.com",
    "clutch.co", "goodfirms.co", "glassdoor.co.in", "ambitionbox.com", "naukri.com", "grotal.com", "asklaila.com", "nearbuy.com",
    "bajajfinservhealth.in", "medibuddy.in", "1mg.com", "pharmeasy.in", "netmeds.com", "amazon.in", "flipkart.com", "shiksha.com",
    # elsewhere
    "yelp.ca", "yelp.co.uk", "yelp.ie", "yellowpages.ca", "bbb.org", "angi.com", "thumbtack.com", "houzz.com", "nextdoor.com", "trustpilot.com",
    "yell.com", "thomsonlocal.com", "checkatrade.com", "goldenpages.ie", "yellowpages.com.au", "truelocal.com.au", "hotfrog.com.au", "yellow.co.nz",
    "yellowpages.com.om", "yellowpages-uae.com", "connect.ae", "dubizzle.com", "bayut.com", "propertyfinder.ae", "daleeli.com", "yellowpages.com.sa",
    "qatcom.com", "yellowpages.com.kw", "bahrainyellowpages.com", "talabat.com", "deliveroo.co.uk", "ubereats.com", "doordash.com", "opentable.com",
    "doctoralia.com", "healthgrades.com", "zocdoc.com", "fresha.com", "booksy.com", "edarabia.com", "foursquare.com", "apple.com", "bing.com",
    "yellowpages.com.sg", "yellowpages.my", "brabys.com", "snupit.co.za", "alibaba.com", "kompass.com",
}
GENERIC_LINKS = {
    "home", "about", "about us", "contact", "contact us", "blog", "blogs", "gallery", "careers", "privacy policy", "terms", "terms and conditions",
    "login", "sign in", "sign up", "register", "read more", "learn more", "more", "click here", "here", "book appointment", "book now",
    "faq", "faqs", "testimonials", "reviews", "our team", "team", "sitemap", "menu", "skip to content", "call now", "get directions",
    "enquire now", "enquiry", "submit", "search", "view all", "know more", "next", "previous", "back", "english", "close",
    "view more", "see more", "show more", "our story", "our services", "services", "our doctor", "our doctors", "doctors", "updates", "news",
    "more information", "information", "before & after", "before and after", "academics", "events", "media", "press", "awards", "partners",
    "locations", "branches", "clinics", "products", "solutions", "shop", "cart", "account", "my account", "pricing", "plans", "offers",
    "patients", "patient stories", "success stories", "case studies", "resources", "downloads", "help", "support", "feedback", "photos", "videos",
}
# Words that make a title phrase a call to action or site furniture, not a keyword.
JUNK_WORDS = {"quote", "about", "testimonial", "testimonials", "gallery", "blog", "login", "cart", "menu", "careers", "updates", "news", "welcome", "homepage", "home", "page", "official", "website",
              "click", "subscribe", "newsletter", "cookie", "cookies", "privacy", "policy", "terms", "copyright", "rights", "reserved", "404"}
# Structured-data types that tell Google "this is a local business" (LocalBusiness and its common subtypes).
LOCAL_SCHEMA = {"LocalBusiness", "MedicalClinic", "Dentist", "Physician", "Hospital", "Pharmacy", "Optician", "Restaurant", "CafeOrCoffeeShop",
                "Store", "ProfessionalService", "LegalService", "Attorney", "AccountingService", "RealEstateAgent", "AutoRepair", "HomeAndConstructionBusiness",
                "HealthAndBeautyBusiness", "BeautySalon", "DaySpa", "HairSalon", "SportsActivityLocation", "ExerciseGym", "LodgingBusiness", "Hotel",
                "EducationalOrganization", "School", "TravelAgency", "FinancialService", "InsuranceAgency", "EmploymentAgency", "VeterinaryCare"}


def is_local_schema(t: str) -> bool:
    return t in LOCAL_SCHEMA or t.endswith("Business") or t.endswith("Store")


# Words seen in addresses that are not place names.
NOT_PLACE = {"road", "near", "opposite", "opp", "behind", "floor", "office", "shop", "building", "complex", "tower", "plaza", "society", "lane",
             "chowk", "nagar", "colony", "street", "marg", "sector", "phase", "block", "wing", "plot", "above", "below", "next", "main", "hall",
             "clinic", "hospital", "centre", "center", "skin", "hair", "dental", "care", "health", "medical", "maharashtra", "india"}


class IntelError(RuntimeError):
    pass


def serper_enabled() -> bool:
    return bool(get_settings().serper_api_key)


def host_of(url: str | None) -> str:
    try:
        return (urlparse(url or "").hostname or "").lower().removeprefix("www.")
    except ValueError:
        return ""


def is_directory(host: str) -> bool:
    return any(host == d or host.endswith(f".{d}") for d in DIRECTORIES)


def site_of(host: str) -> str:
    """A listing site by its main domain: "in.linkedin.com" -> "linkedin.com"."""
    return next((d for d in DIRECTORIES if host == d or host.endswith(f".{d}")), host)


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", (text or "").lower())


# ── Google results (Serper) ─────────────────────────────────────────────
_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_lock = threading.Lock()


class Serper:
    """Serper.dev calls with a 12-hour cache (same query + place = same answer), counting credits."""

    def __init__(self, country: str | None = None) -> None:
        self.key = get_settings().serper_api_key
        self.gl = countries.gl(country)  # Google's results for the business's country
        if not self.key:
            raise IntelError("Competitor research needs Google results: set SERPER_API_KEY on the SEO backend (serper.dev).")
        self.credits = 0

    def call(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        ck = f"{path}|{sorted(body.items())}"
        with _lock:
            hit = _cache.get(ck)
            if hit and time.time() - hit[0] < CACHE_SECONDS:
                return hit[1]
        try:
            r = httpx.post(f"{SERPER}{path}", headers={"X-API-KEY": self.key, "Content-Type": "application/json"}, json=body, timeout=30)
        except httpx.HTTPError as exc:
            raise IntelError(f"Google results (Serper) did not answer: {exc}") from exc
        if r.status_code in (401, 403):
            raise IntelError("The Serper API key was refused. Check SERPER_API_KEY.")
        if r.status_code == 429 or (r.status_code == 400 and "credit" in r.text.lower()):
            raise IntelError("Serper credits are used up or rate-limited. Top up at serper.dev or try later.")
        if r.status_code != 200:
            raise IntelError(f"Serper: {(r.json() if r.content else {}).get('message') or f'HTTP {r.status_code}'}")
        data = r.json()
        self.credits += int(data.get("credits") or 1)
        with _lock:
            _cache[ck] = (time.time(), data)
        return data

    def search(self, q: str, location: str | None) -> dict[str, Any]:
        body = {"q": q, "gl": self.gl, "hl": "en", "num": 10}
        if location:
            body["location"] = location
        return self.call("/search", body)

    def places(self, q: str, location: str | None) -> dict[str, Any]:
        body = {"q": q, "gl": self.gl, "hl": "en"}
        if location:
            body["location"] = location
        return self.call("/places", body)


# ── Keywords ────────────────────────────────────────────────────────────
GENERIC_CATEGORIES = {"doctor", "store", "shop", "company", "business", "service", "services", "building", "establishment", "office",
                      "point of interest", "corporate office", "organization", "local business"}


def default_keywords(b: Any) -> list[str]:
    """The searches a customer would type to find this business, with the place in them (Google
    localises 'near me' by the searcher's own location, which a server does not have)."""
    # A generic Google category ("Doctor", "Store") finds everyone; specific ones (services, other categories) first.
    seeds = default_seeds(b)
    seeds = ([s for s in seeds if s not in GENERIC_CATEGORIES] + [s for s in seeds if s in GENERIC_CATEGORIES])[:3]
    if market.scope(b) == "national":  # customers anywhere in the country: no city in the search
        out = []
        for i, s in enumerate(seeds):
            out += [s, f"best {s}"] if i == 0 else [s]
        return list(dict.fromkeys(out))[:6]
    if market.scope(b) == "international":  # one search per target country
        names = [countries.name(c) for c in market.target_countries(b)][:3]
        out = [f"{seeds[0]} in {n}" for n in names] if seeds else []
        return (out + ([f"best {seeds[0]}"] if seeds else []))[:6]
    area = (b.area or "").split(",")[0].strip()
    city = (b.city or "").strip()
    out: list[str] = []
    for i, s in enumerate(seeds):
        if area:
            out.append(f"{s} in {area}")
        if city:
            out.append(f"{s} in {city}")
            if i == 0:
                out.append(f"best {s} in {city}")
        if not area and not city:
            out.append(s)
    seen: list[str] = []
    for k in out:
        if k.lower() not in [x.lower() for x in seen]:
            seen.append(k)
    return seen[:6]


def default_location(b: Any) -> str:
    return market.search_location(b)


# ── Site scan ───────────────────────────────────────────────────────────
SERVICEISH = re.compile(r"/(services?|treatments?|solutions?|products?|specialit|what-we-do|procedures?|offerings?)/?", re.I)
BLOGISH = re.compile(r"/(blog|blogs|articles?|news|insights|resources|knowledge)(/|$)", re.I)


def scan_site(url: str, max_pages: int = 5, timeout: float = 10) -> dict[str, Any]:
    """The home page plus a few internal pages (service-like links first), with each page's links."""
    start = url if url.startswith("http") else f"https://{url}"
    client = site_client(timeout)
    pages: list[dict[str, Any]] = []
    try:
        try:
            r = client.get(start)
        except httpx.HTTPError as exc:
            return {"url": start, "error": str(exc)[:160], "pages": []}
        if "text/html" not in r.headers.get("content-type", ""):
            return {"url": start, "error": f"Not a web page (HTTP {r.status_code})", "pages": []}
        home = analyse_html(str(r.url), r.status_code, r.text)
        pages.append(home)
        host = host_of(str(r.url))
        internal = []
        for link in home.get("links", []):
            href = link["href"]
            if host_of(href) == host and href.split("#")[0].rstrip("/") != str(r.url).split("#")[0].rstrip("/"):
                internal.append(link)
        internal.sort(key=lambda l: (0 if SERVICEISH.search(l["href"]) else 1 if BLOGISH.search(l["href"]) else 2))
        seen = {str(r.url).rstrip("/")}
        for link in internal:
            if len(pages) > max_pages:
                break
            u = link["href"].split("#")[0].rstrip("/")
            if u in seen or re.search(r"\.(pdf|jpe?g|png|gif|webp|zip|docx?)$", u, re.I):
                continue
            seen.add(u)
            try:
                pr = client.get(u)
            except httpx.HTTPError:
                continue
            if "text/html" in pr.headers.get("content-type", "") and pr.status_code < 400:
                pages.append(analyse_html(str(pr.url), pr.status_code, pr.text))
        return {"url": str(r.url), "host": host, "pages": pages}
    finally:
        client.close()


def brand_words_of(domain: str, name: str = "") -> set[str]:
    """A brand as joined-up strings: its domain label ("rubyhall") and its name ("skin101")."""
    return {(domain or "").split(".")[0].replace("-", ""), "".join(_words(name))} - {""}


def strip_brand(ws: list[str], brand: set[str]) -> list[str]:
    """Drops the brand from a phrase: runs of words that join up into the domain label or the name
    ("ruby hall" -> "rubyhall", "dr akshay mirajkar" -> "drakshaymirajkar"). Generic words that merely
    appear inside a label ("skin" in "skinhairsurgery") are kept."""
    out, i = [], 0
    while i < len(ws):
        for j in range(min(len(ws), i + 5), i, -1):
            if "".join(w for w in ws[i:j] if w != "and") in brand and (j - i >= 2 or len(ws[i]) >= 5):
                i = j
                break
        else:
            out.append(ws[i])
            i += 1
    return out


def site_profile(site: dict[str, Any], brand_words: set[str], places: set[str], away: set[str], city: frozenset[str] = frozenset()) -> dict[str, Any]:
    """What a site targets: keyword phrases from titles/H1s, its service and location pages (from its
    own navigation), blog, schema and how much it writes. `places` are the business's localities,
    `city` its city's words ("Botox treatment in Pune" is a service page for the city; "Dentist in
    Aundh" a location page), `away` other cities (someone else's market)."""
    pages = site.get("pages") or []
    if not pages:
        return {"scanned": False, "error": site.get("error") or "The site did not load."}
    phrases: Counter[str] = Counter()
    for p in pages:
        for part in re.split(r"\s[|\-–—:•]\s|\s\|\s|[|]", f"{p.get('title', '')}|{p.get('h1', '')}"):
            ws = strip_brand(_words(part), brand_words)
            while ws and ws[0] in ("dr", "by", "at", "the", "with"):
                ws = ws[1:]
            phrase = " ".join(ws)
            if 2 <= len(ws) <= 7 and not any(w in NOISE or w in JUNK_WORDS or w in away for w in ws) and phrase not in GENERIC_LINKS:
                phrases[phrase] += 1
    links: Counter[str] = Counter()
    labels: dict[str, str] = {}
    location_pages: set[str] = set()
    places = places - brand_words
    blog = False
    host = site.get("host")
    for p in pages:
        if BLOGISH.search(p.get("url", "")):
            blog = True
        for link in p.get("links", []):
            text = " ".join((link.get("text") or "").split()).strip()
            if BLOGISH.search(link["href"]) and host_of(link["href"]) == host:
                blog = True
            text = text.rstrip(" →»›>").strip()
            low = text.lower()
            ws = _words(low)
            if (host_of(link["href"]) != host or len(low) < 4 or low in GENERIC_LINKS or len(low) > 48 or len(ws) > 6 or not re.search(r"[a-z]", low)
                    or "@" in low or "protected" in low or low.endswith("?") or any(w in JUNK_WORDS for w in ws)
                    or ws[0] in ("more", "our", "meet", "why", "dr", "about", "view", "read", "explore") or re.match(r"^(dr|mr|mrs|ms)\.?\s", low)):
                continue
            if set(ws) <= (CITIES | set(METRO)) or set(ws) & away:
                continue  # another city's branch is not a service
            m = re.search(r"\b(?:in|near)\s+([a-z][a-z ,.-]{2,40})$", low)
            tail = set(_words(m.group(1))) if m else set()
            if set(ws) & (places - city) or (tail and not tail <= city and not tail & {"other", "all", "cities", "city", "india", "locations"}):
                location_pages.add(text)  # e.g. "Dermatologist in Baner", "Baner Clinic", "Dentist in Aundh"
                continue
            links[low] += 1
            labels.setdefault(low, text)
    words = [p.get("word_count", 0) for p in pages]
    schema = sorted({t for p in pages for t in p.get("schema_types", [])})
    return {
        "scanned": True,
        "pages_scanned": len(pages),
        "avg_words": round(sum(words) / len(words)) if words else 0,
        "target_keywords": [k for k, _ in phrases.most_common(10)],
        "services": [labels[t] for t, _ in links.most_common(12)],
        "location_pages": sorted(location_pages)[:10],
        "blog": blog,
        "schema": schema,
        "titles": [{"url": p["url"], "title": p.get("title") or ""} for p in pages[:6]],
        "javascript_only": bool(pages[0].get("javascript_only")),
    }


def link_sources(serper: Serper, query: str, own_host: str, brand: set[str]) -> list[dict[str, str]]:
    """Other sites Google shows for a business's name: where it is listed, linked or talked about.
    A result only counts when it is about the brand (names it or links its domain)."""
    data = serper.search(query, None)
    names = {x for x in brand if len(x) >= 4}
    out: dict[str, dict[str, str]] = {}
    for o in data.get("organic", []):
        h = host_of(o.get("link"))
        compact = re.sub(r"[^a-z0-9]", "", f"{o.get('title', '')} {o.get('snippet', '')} {o.get('link', '')}".lower())
        about = any(n in compact for n in names)
        if h and about and h != own_host and not h.endswith(f".{own_host}") and h not in out:
            out[h] = {"domain": h, "url": o.get("link", ""), "title": o.get("title", ""), "type": "directory" if is_directory(h) else "site"}
    return list(out.values())


# ── The analysis ────────────────────────────────────────────────────────
def _norm_name(s: str) -> str:
    return " ".join(_words(s))


def _is_me_place(p: dict[str, Any], b: Any, my_host: str) -> bool:
    if my_host and host_of(p.get("website")) == my_host:
        return True
    a, n = _norm_name(p.get("title", "")), _norm_name(b.name or "")
    if n and a and (a == n or (len(n) > 4 and (n in a or a in n))):
        return True
    return countries.same_phone(p.get("phoneNumber"), b.phone, countries.of(b))


def _locality(address: str | None) -> str:
    """The locality in an Indian address: "..., Baner, Pune, Maharashtra 411069" -> "Baner"."""
    parts = [x.strip() for x in (address or "").split(",")]
    return parts[-3] if len(parts) >= 3 else ""


def _visibility(positions: dict[str, int], n_keywords: int, ctr: dict[int, float]) -> float:
    if not n_keywords:
        return 0.0
    return round(100 * sum(ctr.get(p, 0) for p in positions.values()) / (n_keywords * ctr[1]), 1)


def _strategy(domain: str, comp: dict[str, Any], prof: dict[str, Any], local: dict[str, Any] | None, sources: list[dict[str, str]], keywords: list[str]) -> list[str]:
    out = []
    best = min(comp["positions"].items(), key=lambda kv: kv[1]) if comp["positions"] else None
    if best:
        out.append(f"Ranks on Google's first page for {len(comp['positions'])} of {len(keywords)} keywords; best #{best[1]} for \"{best[0]}\".")
    if local:
        out.append(f"In the Google Maps results for {local['appearances']} keyword{'s' if local['appearances'] != 1 else ''} (best #{local['best']})"
                   + (f", {local['rating']}★ from {local['reviews']:,} reviews." if local.get("reviews") else "."))
    if prof.get("scanned"):
        if prof["services"]:
            out.append(f"Separate pages for its services: {', '.join(prof['services'][:5])}.")
        if prof["location_pages"]:
            out.append(f"Location pages for areas: {', '.join(prof['location_pages'][:4])}.")
        if prof["avg_words"] >= 700:
            out.append(f"Long, detailed pages (about {prof['avg_words']:,} words each).")
        elif prof["avg_words"] and prof["avg_words"] < 250:
            out.append(f"Thin pages (about {prof['avg_words']} words each): beatable with fuller content.")
        if prof["blog"]:
            out.append("Publishes a blog / articles, which brings in question searches.")
        local_schema = [s for s in prof["schema"] if s not in ("WebSite", "WebPage", "Organization", "BreadcrumbList", "ImageObject", "SiteNavigationElement")]
        if local_schema:
            out.append(f"Uses structured data ({', '.join(local_schema[:3])}), so Google understands what and where it is.")
        title_hits = [t["title"] for t in prof["titles"] if any(k.split(" in ")[0] in t["title"].lower() for k in keywords)]
        if title_hits:
            out.append(f"Puts the service in its page titles, e.g. \"{title_hits[0][:80]}\".")
    dirs = list(dict.fromkeys(site_of(s["domain"]) for s in sources if s["type"] == "directory"))
    if dirs:
        out.append(f"Listed on {', '.join(dirs[:5])}.")
    return out


def _organic_rollup(serps: list[dict[str, Any]], n_keywords: int) -> list[dict[str, Any]]:
    """Organic competitors across the keyword results so far, by visibility."""
    domains: dict[str, dict[str, Any]] = {}
    for s in serps:
        for o in s["organic"]:
            if o["mine"] or not o["domain"]:
                continue
            d = domains.setdefault(o["domain"], {"domain": o["domain"], "type": o["type"], "positions": {}, "urls": {}, "title": o["title"]})
            if s["keyword"] not in d["positions"]:
                d["positions"][s["keyword"]] = o["position"]
                d["urls"][s["keyword"]] = o["url"]
    for d in domains.values():
        d["visibility"] = _visibility(d["positions"], n_keywords, CTR)
        d["keywords_top10"] = len(d["positions"])
        d["keywords_top3"] = sum(1 for p in d["positions"].values() if p <= 3)
        d["avg_position"] = round(sum(d["positions"].values()) / len(d["positions"]), 1)
    return sorted(domains.values(), key=lambda d: (-d["visibility"], d["avg_position"]))


def _local_rollup(serps: list[dict[str, Any]], n_keywords: int) -> list[dict[str, Any]]:
    """Google Maps competitors across the keyword results so far, by visibility."""
    places: dict[str, dict[str, Any]] = {}
    for s in serps:
        for p in s["local"]:
            if p["mine"]:
                continue
            key = str(p.get("cid") or _norm_name(p["name"]))
            e = places.setdefault(key, {k: p.get(k) for k in ("name", "rating", "reviews", "category", "address", "website", "phone")} | {"positions": {}})
            e["positions"].setdefault(s["keyword"], p["position"])
    for e in places.values():
        e["appearances"] = len(e["positions"])
        e["best"] = min(e["positions"].values())
        e["avg_position"] = round(sum(e["positions"].values()) / len(e["positions"]), 1)
        e["visibility"] = _visibility(e["positions"], n_keywords, LOCAL_CTR)
        e["domain"] = host_of(e.get("website"))
    return sorted(places.values(), key=lambda e: (-e["visibility"], -(e.get("reviews") or 0)))


def analyse(b: Any, keywords: list[str], location: str | None, on_progress: Callable[[dict[str, Any]], None] = lambda e: None) -> dict[str, Any]:
    serper = Serper(market.serp_country(b))
    settings = get_settings()
    my_host = host_of(b.website)
    keywords = [k.strip() for k in keywords if k.strip()][:10]
    total_steps = len(keywords) + 6
    step = 0

    def progress(label: str, found: dict[str, Any] | None = None) -> None:
        nonlocal step
        step += 1
        event = {"step": label, "done": min(step, total_steps), "total": total_steps}
        if found is not None:
            event["found"] = found  # shown by the page while the research is still running
        on_progress(event)

    def update(label: str, found: dict[str, Any]) -> None:
        """Another result arrived inside the current step."""
        on_progress({"step": label, "done": min(step, total_steps), "total": total_steps, "found": found})

    def live(profiles_done: dict[str, Any] | None = None) -> dict[str, Any]:
        """What is known so far: the keywords done, the competitors and Maps businesses found, their site profiles."""
        n = len(keywords)
        return {
            "keywords": [{"keyword": x["keyword"], "you_organic": x["you_organic"], "you_local": x["you_local"], "first": x["organic"][0]["domain"] if x["organic"] else None} for x in serps],
            "competitors": [{k: d[k] for k in ("domain", "type", "visibility", "keywords_top10", "keywords_top3", "avg_position")} for d in _organic_rollup(serps, n)[:12]],
            "maps": [{k: e.get(k) for k in ("name", "rating", "reviews", "best", "appearances", "visibility", "website")} for e in _local_rollup(serps, n)[:10]],
            "sites": profiles_done or {},
        }

    # 1. Google results for every keyword: the organic top 10 and the Maps results.
    serps: list[dict[str, Any]] = []
    for kw in keywords:
        progress(f"Google results for \"{kw}\"", live() if serps else None)
        org = serper.search(kw, location)
        try:
            plc = serper.places(kw, location)
        except IntelError:
            plc = {}
        organic = []
        for o in org.get("organic", [])[:10]:
            h = host_of(o.get("link"))
            organic.append({"position": o.get("position"), "domain": h, "url": o.get("link"), "title": o.get("title", ""),
                            "snippet": o.get("snippet", ""), "type": "directory" if is_directory(h) else "business", "mine": bool(my_host) and h == my_host})
        local = []
        for p in plc.get("places", [])[:10]:
            local.append({"position": p.get("position"), "name": p.get("title", ""), "rating": p.get("rating"), "reviews": p.get("ratingCount") or 0,
                          "category": p.get("category"), "address": p.get("address"), "website": p.get("website"), "phone": p.get("phoneNumber"),
                          "cid": p.get("cid"), "mine": _is_me_place(p, b, my_host)})
        serps.append({
            "keyword": kw, "organic": organic, "local": local,
            "questions": [q.get("question") for q in org.get("peopleAlsoAsk", []) if q.get("question")][:6],
            "related": [q.get("query") for q in org.get("relatedSearches", []) if q.get("query")][:8],
            "you_organic": next((o["position"] for o in organic if o["mine"]), None),
            "you_local": next((p["position"] for p in local if p["mine"]), None),
        })

    # 2. Who competes: organic domains and Maps businesses, by visibility across all keywords.
    organic_competitors = _organic_rollup(serps, len(keywords))
    local_competitors = _local_rollup(serps, len(keywords))

    # 3. Deep look at the top competing businesses (not directories), and at the business itself.
    # Place words (the business's area and city, and localities in competitors' addresses) mark
    # location pages and are left out of service names.
    seen_localities: Counter[str] = Counter()
    for s in serps:
        for p in s["local"]:
            for w in set(_words(_locality(p.get("address")))):
                if len(w) > 3 and w not in NOT_PLACE and not w.isdigit():
                    seen_localities[w] += 1
    places_words = {w for w in _words(f"{b.area or ''} {b.city or ''}") if len(w) > 2} | {w for w, n in seen_localities.items() if n >= 2}
    away = other_cities(places_words, countries.of(b))
    targets = [d for d in organic_competitors if d["type"] == "business"][:4]
    progress("Scanning competitors' websites", live())
    profiles: dict[str, dict[str, Any]] = {}

    def scan(d: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        brand = brand_words_of(d["domain"], d.get("name", ""))
        try:
            return d["domain"], site_profile(scan_site(f"https://{d['domain']}"), brand, places_words, away, frozenset(_words(b.city or "")))
        except Exception as exc:  # one slow or broken site must not stop the report
            return d["domain"], {"scanned": False, "error": str(exc)[:160]}

    jobs = targets + ([{"domain": my_host, "name": b.name}] if my_host else [])
    with ThreadPoolExecutor(max_workers=5) as pool:
        for fut in as_completed([pool.submit(scan, j) for j in jobs]):
            dom, prof = fut.result()
            profiles[dom] = prof
            update(f"Scanned {dom}", live({k: {"scanned": v.get("scanned"), "services": (v.get("services") or [])[:6], "avg_words": v.get("avg_words"), "blog": v.get("blog")} for k, v in profiles.items() if k != my_host}))
    my_profile = profiles.pop(my_host, None) if my_host else None

    progress("Finding where competitors are listed and linked")
    local_by_host = {e["domain"]: e for e in local_competitors if e.get("domain")}
    sources: dict[str, list[dict[str, str]]] = {}
    for d in targets:
        try:
            loc = local_by_host.get(d["domain"])
            name = loc["name"] if loc else d["domain"].split(".")[0]
            sources[d["domain"]] = link_sources(serper, f"{name} {b.city or ''}".strip(), d["domain"], brand_words_of(d["domain"], loc["name"] if loc else ""))
        except IntelError:
            sources[d["domain"]] = []
    my_sources: list[dict[str, str]] = []
    try:
        my_sources = link_sources(serper, f"{b.name} {b.city or ''}".strip(), my_host or "-", brand_words_of(my_host, b.name))
    except IntelError:
        pass
    backlinks: dict[str, Any] = {}  # full backlink counts are not available from Google; only the listings it surfaces (link_sources)

    # 4. Per-competitor profile with its strategy in plain words.
    local_by_domain = {e["domain"]: e for e in local_competitors if e.get("domain")}
    competitor_profiles = []
    for d in targets:
        prof = profiles.get(d["domain"]) or {"scanned": False}
        loc = local_by_domain.get(d["domain"])
        competitor_profiles.append({
            "domain": d["domain"], "visibility": d["visibility"], "positions": d["positions"], "urls": d["urls"],
            "local": loc and {k: loc[k] for k in ("name", "rating", "reviews", "appearances", "best")},
            "site": prof, "link_sources": sources.get(d["domain"], []), "backlinks": backlinks.get(d["domain"]),
            "strategy": _strategy(d["domain"], d, prof, loc, sources.get(d["domain"], []), keywords),
        })

    # 5. The business's own position and gaps.
    my_positions = {s["keyword"]: s["you_organic"] for s in serps if s["you_organic"]}
    my_local = {s["keyword"]: s["you_local"] for s in serps if s["you_local"]}
    keyword_gaps = []
    for s in serps:
        rivals = [{"domain": o["domain"], "position": o["position"]} for o in s["organic"] if o["type"] == "business" and not o["mine"]][:3]
        if not s["you_organic"] and rivals:
            keyword_gaps.append({"keyword": s["keyword"], "competitors": rivals, "you_local": s["you_local"]})
    my_source_hosts = {site_of(x["domain"]) for x in my_sources}
    listing_count: Counter[str] = Counter()
    for d, lst in sources.items():
        for x in {site_of(x["domain"]) for x in lst if x["type"] == "directory"}:
            listing_count[x] += 1
    for s in serps:  # listing sites that rank for the keywords themselves are worth being on too
        for x in {site_of(o["domain"]) for o in s["organic"] if o["type"] == "directory"}:
            listing_count[x] += 1
    not_listings = {"google.com", "maps.google.com", "wikipedia.org", "quora.com", "reddit.com", "youtube.com"}
    listing_gaps = [{"domain": d, "seen": n} for d, n in listing_count.most_common() if d not in my_source_hosts and d not in not_listings][:8]

    top_local = local_competitors[0] if local_competitors else None
    my_rating, my_reviews = b.rating, b.review_count or 0
    for s in serps:
        me = next((p for p in s["local"] if p["mine"]), None)
        if me:
            my_rating, my_reviews = me.get("rating") or my_rating, me.get("reviews") or my_reviews
            break

    actions = _actions(b, keywords, serps, keyword_gaps, listing_gaps, competitor_profiles, my_profile, top_local, my_reviews)
    progress("Done")
    return {
        "business": {"id": b.id, "name": b.name, "domain": my_host or None, "rating": my_rating, "reviews": my_reviews},
        "location": location, "keywords": keywords,
        "summary": {
            "visibility": _visibility(my_positions, len(keywords), CTR),
            "local_visibility": _visibility(my_local, len(keywords), LOCAL_CTR),
            "keywords_ranked": len(my_positions), "keywords_top3": sum(1 for p in my_positions.values() if p <= 3),
            "local_ranked": len(my_local), "keywords_total": len(keywords),
            "competitors": len([d for d in organic_competitors if d["type"] == "business"]),
            "leader": organic_competitors and next(({"domain": d["domain"], "visibility": d["visibility"]} for d in organic_competitors if d["type"] == "business"), None),
            "local_leader": top_local and {"name": top_local["name"], "visibility": top_local["visibility"], "reviews": top_local.get("reviews")},
        },
        "serps": serps,
        "organic_competitors": organic_competitors[:15],
        "local_competitors": local_competitors[:12],
        "profiles": competitor_profiles,
        "you": {"positions": my_positions, "local": my_local, "site": my_profile, "link_sources": my_sources, "backlinks": backlinks.get(my_host) if my_host else None},
        "gaps": {"keywords": keyword_gaps, "listings": listing_gaps},
        "ideas": {
            "questions": list(dict.fromkeys(q for s in serps for q in s["questions"]))[:10],
            "related": list(dict.fromkeys(q for s in serps for q in s["related"]))[:12],
            "competitor_keywords": list(dict.fromkeys(k for c in competitor_profiles for k in (c["site"].get("target_keywords") or [])
                                                      if not set(k.split()) & away))[:20],
        },
        "actions": actions,
        "sources": {"google": "serper", "backlinks": "google_mentions", "credits": serper.credits},
        "analysed_at": datetime.now(timezone.utc).isoformat(),
    }


def _actions(b, keywords, serps, keyword_gaps, listing_gaps, profiles, my_site, top_local, my_reviews) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not b.website:
        out.append({"priority": "high", "title": "Get a website", "why": "Every competitor on Google's first page has one; without a site you can only appear in Maps.", "to": "/website-builder"})
    for g in keyword_gaps[:4]:
        lead = g["competitors"][0]
        out.append({"priority": "high", "title": f"Build or improve a page for \"{g['keyword']}\"",
                    "why": f"{len(g['competitors'])} competitor{'s' if len(g['competitors']) != 1 else ''} rank on page 1 ({lead['domain']} is #{lead['position']}); you are not in the top 10. Put the service and area in the title, H1 and first paragraph.",
                    "to": "/website-audit"})
    if top_local and (top_local.get("reviews") or 0) > (my_reviews or 0):
        out.append({"priority": "high" if (top_local.get("reviews") or 0) > 2 * (my_reviews or 0) else "medium", "title": "Close the review gap",
                    "why": f"{top_local['name']} leads the Maps results with {top_local.get('reviews', 0):,} reviews; you have {my_reviews or 0:,}. Reviews are one of the strongest Maps ranking signals.",
                    "to": "/reviews"})
    if listing_gaps:
        out.append({"priority": "medium", "title": f"Get listed on {', '.join(x['domain'] for x in listing_gaps[:4])}",
                    "why": "Competitors are listed there and those sites rank for your keywords. Each listing is a link and a citation with your name, address and phone.",
                    "to": "/off-page-seo"})
    scanned = [p["site"] for p in profiles if p["site"].get("scanned")]
    if scanned and my_site and my_site.get("scanned"):
        avg = round(sum(s["avg_words"] for s in scanned) / len(scanned))
        if avg > 1.4 * max(my_site["avg_words"], 1):
            out.append({"priority": "medium", "title": "Write fuller pages", "why": f"Competitors' pages average about {avg:,} words; yours about {my_site['avg_words']:,}. Add details, prices, FAQs and photos.", "to": "/ai-content-generation"})
        if sum(1 for s in scanned if s["location_pages"]) >= 1 and not my_site["location_pages"]:
            out.append({"priority": "medium", "title": "Add area pages", "why": "Competitors have pages for the localities they serve; you have none. One useful page per area you really serve.", "to": "/website-builder"})
        if sum(1 for s in scanned if s["blog"]) >= 2 and not my_site["blog"]:
            out.append({"priority": "low", "title": "Start answering questions in a blog", "why": "Most top competitors publish articles, which win question searches and links.", "to": "/ai-content-generation"})
        comp_schema = {t for s in scanned for t in s["schema"]}
        if any(is_local_schema(t) for t in comp_schema) and not any(is_local_schema(t) for t in my_site["schema"]):
            out.append({"priority": "medium", "title": "Add LocalBusiness structured data", "why": "Competitors tell Google their type, address and hours with schema; your site does not.", "to": "/website-audit?tab=schema"})
    questions = [q for s in serps for q in s["questions"]]
    if questions:
        out.append({"priority": "low", "title": "Answer what people ask", "why": f"Google shows questions like \"{questions[0]}\". Answer them in FAQs and posts.", "to": "/ai-content-generation"})
    return out
