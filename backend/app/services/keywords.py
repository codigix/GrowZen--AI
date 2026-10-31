"""Keyword discovery from what we know about the business: its category, services, area and the
localities around it, its website (from the latest on-page audit) and its competitors (rank scans).

Searches come from Google Autocomplete (real queries people type, free, no key): service, local,
"near me", question and fresh/seasonal searches. Each keyword gets a suggest-strength signal (how high
and how often Google suggests it), a group, an intent, and whether the website already covers it.
Monthly volume, CPC and trend need the Google Ads Keyword Planner API.
Nearby localities come from OpenStreetMap (Photon reverse search).
"""
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from . import countries, market
from ..models import Audit, Business, Keyword, RankScan
from .providers.base import intent_of
from .suggest import UA, _cached

AUTOCOMPLETE = "https://suggestqueries.google.com/complete/search"
PHOTON_REVERSE = "https://photon.komoot.io/reverse"
TRENDS_RSS = "https://trends.google.com/trending/rss"
DAY = 24 * 3600

STOP = {"a", "an", "the", "in", "near", "me", "for", "of", "and", "to", "at", "best", "top", "good", "cheap", "my", "with", "on", "is", "are",
        "how", "what", "which", "why", "can", "does", "do", "much", "cost", "price", "prices", "charges", "fees", "fee", "rate", "rates", "list",
        "nearby", "around", "open", "now", "today", "online", "service", "services", "centre", "center", "clinic", "shop", "store", "india"}
# Searches that aren't customers looking for the business (jobs, school work, memes...).
NOISE = {"costume", "costumes", "reddit", "quora", "meme", "memes", "cartoon", "drawing", "jobs", "job", "salary", "vacancy", "vacancies", "course",
         "courses", "college", "colleges", "degree", "syllabus", "exam", "png", "logo", "wallpaper", "game", "games", "quiz", "song", "songs", "movie",
         "images", "image", "pictures", "photos", "clipart", "quotes", "synonym", "meaning", "pdf", "ppt", "essay", "kya", "hai", "internship", "toy", "toys",
         "medicaid", "medicare", "neet", "cutoff", "cut"}
CITIES = {"mumbai", "delhi", "bangalore", "bengaluru", "hyderabad", "chennai", "kolkata", "ahmedabad", "pune", "jaipur", "surat", "lucknow", "kanpur",
          "nagpur", "indore", "thane", "bhopal", "visakhapatnam", "patna", "vadodara", "ghaziabad", "ludhiana", "agra", "nashik", "noida", "gurgaon",
          "gurugram", "faridabad", "rajkot", "meerut", "kalyan", "varanasi", "aurangabad", "amritsar", "ranchi", "coimbatore", "kochi", "chandigarh",
          "mysore", "mysuru", "goa", "dehradun", "bhubaneswar", "raipur", "guwahati", "navi", "kolhapur", "solapur", "dubai", "london", "usa", "uk"}
# Places inside a bigger city's metro area: searches naming the big city are local for them too.
METRO = {"pimpri": "pune", "chinchwad": "pune", "hinjewadi": "pune", "wakad": "pune", "hadapsar": "pune", "kharadi": "pune", "baner": "pune",
         "thane": "mumbai", "navi": "mumbai", "kalyan": "mumbai", "vashi": "mumbai", "panvel": "mumbai", "noida": "delhi", "gurgaon": "delhi",
         "gurugram": "delhi", "ghaziabad": "delhi", "faridabad": "delhi", "secunderabad": "hyderabad", "howrah": "kolkata"}


def other_cities(place_words: set[str], country: str = "IN") -> set[str]:
    """Cities whose searches aren't this business's customers: every known city except its own and its metro's.
    The city list is India's, so elsewhere nothing is filtered out."""
    if (country or "IN").upper() != "IN":
        return set()
    own = place_words | {METRO[w] for w in place_words if w in METRO}
    return CITIES - own


PER_GROUP = 40
QUESTION = re.compile(r"^(how|what|why|which|when|where|who|can|is|are|does|do|should|will)\b")
GROUPS = ["question", "near_me", "local", "fresh", "competitor", "brand", "service"]

_photon_lock = threading.Lock()


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", (text or "").lower())


def _core(text: str, places: set[str]) -> set[str]:
    """The words that carry the topic (no filler, no place names)."""
    return {w for w in _words(text) if w not in STOP and w not in places and len(w) > 1}


def autocomplete(query: str, gl: str = "in") -> list[tuple[str, int]]:
    """Google's suggestions for a query in a country (`gl`), best first, with Google's relevance where it gives one."""
    def fetch():
        try:
            r = httpx.get(AUTOCOMPLETE, params={"client": "chrome", "q": query, "hl": "en", "gl": gl}, headers={"User-Agent": UA}, timeout=6)
            data = r.json() if r.status_code == 200 else []
        except (httpx.HTTPError, ValueError):
            return []
        texts = data[1] if len(data) > 1 else []
        rel = (data[4].get("google:suggestrelevance") if len(data) > 4 and isinstance(data[4], dict) else None) or []
        return [(t, rel[i] if i < len(rel) else 0) for i, t in enumerate(texts) if isinstance(t, str)]
    return _cached(("autocomplete", gl, query.lower()), DAY, fetch)


def nearby_areas(b: Business, limit: int = 8) -> list[str]:
    """Localities around the business (OpenStreetMap), nearest first, without its own area."""
    if b.lat is None or b.lng is None:
        return []

    def fetch():
        found: list[str] = []
        for tag in ("place:suburb", "place:neighbourhood"):
            try:
                with _photon_lock:
                    r = httpx.get(PHOTON_REVERSE, params={"lat": b.lat, "lon": b.lng, "limit": 15, "radius": 6, "osm_tag": tag}, headers={"User-Agent": UA}, timeout=8)
                feats = r.json().get("features", []) if r.status_code == 200 else []
            except (httpx.HTTPError, ValueError):
                feats = []
            found += [f["properties"]["name"] for f in feats if (f.get("properties") or {}).get("name")]
            if len(found) >= limit:
                break
        return found
    own = {(b.area or "").split(",")[0].strip().lower(), (b.city or "").strip().lower()}
    out: list[str] = []
    for name in _cached(("nearby", round(b.lat, 3), round(b.lng, 3)), DAY, fetch):
        if name.lower() not in own and name not in out and len(name) <= 40:
            out.append(name)
    return out[:limit]


def trending_today(words: set[str], country: str = "IN") -> list[dict[str, Any]]:
    """Today's Google Trends searches in the country that mention the business's topics (usually none: the
    daily list is mostly news and sport, so only real matches are shown)."""
    geo = (country or "IN").upper()
    def fetch():
        try:
            r = httpx.get(TRENDS_RSS, params={"geo": geo}, headers={"User-Agent": UA}, timeout=8)
        except httpx.HTTPError:
            return []
        if r.status_code != 200:
            return []
        items = re.findall(r"<item>.*?<title>([^<]+)</title>.*?(?:<ht:approx_traffic>([^<]+)</ht:approx_traffic>)?", r.text, re.S)
        return [{"keyword": t.strip(), "traffic": (v or "").strip()} for t, v in items]
    return [t for t in _cached(("trends_rss", geo), 3600, fetch) if words & set(_words(t["keyword"]))][:10]


def _website(db: Session, b: Business) -> dict[str, Any] | None:
    a = db.scalar(select(Audit).where(Audit.business_id == b.id, Audit.kind == "onpage", Audit.status == "done").order_by(Audit.finished_at.desc()))
    if not a:
        return None
    pages = [p for p in (a.result or {}).get("pages", []) if (p.get("status") or 0) < 400]
    return {"audit_id": a.id, "score": a.score, "finished_at": a.finished_at.isoformat() if a.finished_at else None,
            "pages": [{"url": p["url"], "title": p.get("title") or "", "h1": p.get("h1") or ""} for p in pages][:60]}


def default_seeds(b: Business) -> list[str]:
    seeds: list[str] = []
    for s in [b.primary_category, *(b.secondary_categories or []), *[(x.get("name") if isinstance(x, dict) else x) for x in (b.services or [])]]:
        s = " ".join(str(s or "").lower().split())
        if s and len(s) <= 40 and s not in seeds:
            seeds.append(s)
    return seeds[:8]


def context(db: Session, b: Business) -> dict[str, Any]:
    site = _website(db, b)
    words: dict[str, int] = {}
    brand = set(_words(b.name))
    for p in (site or {}).get("pages", []):
        for w in _core(f"{p['title']} {p['h1']}", set()):
            if len(w) > 3 and not w.isdigit() and w not in brand:
                words[w] = words.get(w, 0) + 1
    tracked = list(db.scalars(select(Keyword).where(Keyword.business_id == b.id)))
    research = competitor_research(db, b)
    return {
        "business": {"name": b.name, "category": b.primary_category, "area": b.area, "city": b.city, "has_location": b.lat is not None,
                     "services": [x.get("name") if isinstance(x, dict) else x for x in (b.services or [])][:12]},
        "seeds": default_seeds(b),
        "areas": market.places(b),
        "nearby": nearby_areas(b) if market.scope(b) == "local" else [],
        "market": market.summary(b),
        "website": site and {k: v for k, v in site.items() if k != "pages"} | {"pages": len(site["pages"]), "topics": [w for w, _ in sorted(words.items(), key=lambda x: -x[1])[:12]]},
        "competitors": context_competitors(db, b)[:6],
        "competitor_research": research and {"analysed_at": research.get("analysed_at"), "competitors": research["summary"].get("competitors"),
                                             "ideas": len(competitor_ideas(research)), "keywords": research.get("keywords", [])},
        "tracked": len(tracked),
        "volumes": False,  # monthly volume needs the Google Ads Keyword Planner API (not connected)
    }


def _queries(seeds: list[str], areas: list[str], city: str) -> list[tuple[str, str]]:
    """(query, why) pairs: what we ask Google Autocomplete for."""
    year = date.today().year
    out: list[tuple[str, str]] = []
    for n, s in enumerate(seeds):
        out += [(s, "service"), (f"{s} near me", "near_me"), (f"best {s}", "service"), (f"{s} cost", "service")]
        out += [(f"{s} in {a}", "local") for a in (areas if n < 2 else areas[:2])]
        if city and city.lower() not in [a.lower() for a in areas]:
            out.append((f"{s} {city}", "local"))
        if n < 3:
            out += [(f"how {s}", "question"), (f"what {s}", "question"), (f"is {s}", "question")]
        if n < 2:
            out += [(f"{s} {year}", "fresh"), (f"latest {s}", "fresh"), (f"{s} offer", "fresh")]
    seen, unique = set(), []
    for q, why in out:
        if q.lower() not in seen:
            seen.add(q.lower())
            unique.append((q, why))
    return unique[:90]


def _coverage(core: set[str], pages: list[dict[str, Any]]) -> dict[str, Any]:
    best, best_hits = None, 0
    for p in pages:
        text = set(_words(f"{p['title']} {p['h1']}"))
        hits = sum(1 for w in core if w in text or w.rstrip("s") in text or f"{w}s" in text)
        if hits > best_hits:
            best, best_hits = p, hits
    if not core or not best:
        return {"status": "gap", "page": None}
    ratio = best_hits / len(core)
    partial = ratio >= 0.66  # most of the topic words: one shared generic word ("dental") is not coverage
    return {"status": "covered" if ratio == 1 else "partial" if partial else "gap", "page": best["url"] if partial else None}


def discover(db: Session, b: Business, seeds: list[str], areas: list[str]) -> dict[str, Any]:
    seeds = [" ".join(s.lower().split()) for s in seeds if s.strip()][:6]
    areas = [a.strip() for a in areas if a.strip()][:10]
    places = {w for a in [*areas, b.city or "", b.area or ""] for w in _words(a)}
    elsewhere = other_cities(places, countries.of(b))  # other cities: searches there aren't this business's customers
    competitors = [c.lower() for c in context_competitors(db, b)]
    brand = _core(b.name, places) - _core(" ".join(seeds), places)
    seed_core = set().union(*(_core(s, places) for s in seeds)) if seeds else set()
    queries = _queries(seeds, areas, b.city or "")
    research = competitor_research(db, b)
    rival_ideas = competitor_ideas(research)
    queries += [(x["keyword"], "competitor") for x in rival_ideas[:12]]  # what Google suggests around the rivals' searches
    with ThreadPoolExecutor(max_workers=8) as pool:
        answers = list(pool.map(lambda q: autocomplete(q[0], countries.gl(countries.of(b))), queries))

    found: dict[str, dict[str, Any]] = {}
    for (query, why), suggestions in zip(queries, answers):
        for pos, (text, rel) in enumerate(suggestions):
            k = " ".join(text.lower().split())
            words = set(_words(k))
            if not k or len(k.split()) > 9 or words & NOISE or words & elsewhere or not (seed_core & _core(k, places) or brand & words):
                continue
            item = found.setdefault(k, {"keyword": k, "strength": 0, "seen": 0, "why": set()})
            item["strength"] = max(item["strength"], max(5, 100 - pos * 8) + min(rel // 100, 4))
            item["seen"] += 1
            item["why"].add(why)

    # The competitors' own keywords go in directly (they are the point of the research), if they fit this business.
    for x in rival_ideas:
        k, words = x["keyword"], set(_words(x["keyword"]))
        if len(k.split()) > 9 or words & NOISE or words & elsewhere:
            continue
        item = found.setdefault(k, {"keyword": k, "strength": 0, "seen": 0, "why": set()})
        item["strength"] = max(item["strength"], x["strength"])
        item["seen"] += 1
        item["why"].add("competitor")
        item["reason"] = x["reason"]
    rival_keys = {x["keyword"]: x["reason"] for x in rival_ideas}
    site = _website(db, b)
    pages = (site or {}).get("pages", [])
    tracked = {k.keyword: k for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id))}
    year = str(date.today().year)
    out = []
    for k, item in found.items():
        words = set(_words(k))
        if k in rival_keys:
            group = "competitor"
        elif QUESTION.match(k):
            group = "question"
        elif "near me" in k or "nearby" in words:
            group = "near_me"
        elif words & places:
            group = "local"
        elif year in words or "fresh" in item["why"] and words & {"latest", "new", "offer", "offers", "discount", year}:
            group = "fresh"
        elif any(c and c in k for c in competitors):
            group = "competitor"
        elif brand and brand <= words:
            group = "brand"
        else:
            group = "service"
        strength = min(100, item["strength"] + (item["seen"] - 1) * 6)
        t = tracked.get(k)
        out.append({"keyword": k, "group": group, "intent": intent_of(k), "strength": strength, "stars": 1,
                    "coverage": _coverage(_core(k, places), pages) if pages else None, "from_competitors": rival_keys.get(k),
                    "tracked": bool(t), "rank": t.rank if t else None, "volume": None, "cpc": None, "difficulty": None, "trend": None})
    out.sort(key=lambda x: (GROUPS.index(x["group"]), -x["strength"]))
    out = [x for g in GROUPS for x in [y for y in out if y["group"] == g][:PER_GROUP]]  # the strongest of each kind
    # Stars rank keywords against each other (top fifth = 5): Google's raw signal is high for most suggestions.
    for i, x in enumerate(sorted(out, key=lambda y: -y["strength"])):
        x["stars"] = 5 - (i * 5) // len(out)

    source = "google_autocomplete"
    return {"data_source": source, "seeds": seeds, "areas": areas, "queries": len(queries), "keywords": out,
            "counts": {g: sum(1 for x in out if x["group"] == g) for g in GROUPS},
            "gaps": sum(1 for x in out if x["coverage"] and x["coverage"]["status"] == "gap"),
            "website_checked": bool(pages), "competitor_based": bool(research), "competitor_ideas": len(rival_ideas), "trending_today": trending_today(seed_core, countries.of(b))}


def competitor_research(db: Session, b: Business) -> dict[str, Any] | None:
    """The latest finished competitor research (step 1 of the process): keyword discovery builds on it."""
    a = db.scalar(select(Audit).where(Audit.kind == "intel", Audit.target == f"business:{b.id}", Audit.status == "done").order_by(Audit.id.desc()))
    return a.result if a and a.result and a.result.get("summary") else None


def competitor_ideas(research: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Keyword ideas the competitor research found, strongest first: searches where rivals rank and the
    business does not, then what rivals' sites target, then what Google relates to those searches."""
    if not research:
        return []
    out: list[dict[str, Any]] = []
    gaps = (research.get("gaps") or {}).get("keywords") or []
    ideas = research.get("ideas") or {}
    for g in gaps:
        out.append({"keyword": g["keyword"], "strength": 95, "reason": f"{', '.join(c['domain'] for c in g['competitors'][:2])} rank for this and you don't"})
    for k in ideas.get("competitor_keywords") or []:
        out.append({"keyword": k, "strength": 80, "reason": "Competitors' pages target this"})
    for k in ideas.get("related") or []:
        out.append({"keyword": k, "strength": 65, "reason": "Google relates it to the searches competitors win"})
    seen, unique = set(), []
    for x in out:
        k = " ".join(str(x["keyword"]).lower().split())
        if k and k not in seen:
            seen.add(k)
            unique.append(x | {"keyword": k})
    return unique


def context_competitors(db: Session, b: Business) -> list[str]:
    """Competitor names: from the competitor research first, else the rank scans."""
    research = competitor_research(db, b)
    names = [c["name"] for c in (research or {}).get("local_competitors", []) if c.get("name")]
    names += [p["domain"].split(".")[0] for p in (research or {}).get("profiles", []) if p.get("domain")]
    if not names:
        scan = db.scalar(select(RankScan).where(RankScan.business_id == b.id).order_by(RankScan.created_at.desc()))
        names = [c["name"] for c in (scan.competitors if scan else []) if c.get("name") and not c["name"].startswith("Competitor ")]
    return list(dict.fromkeys(names))
