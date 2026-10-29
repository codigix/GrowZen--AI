"""Live Google data through Serper.dev (SERPER_API_KEY), used when DataForSEO isn't connected.

- Rankings: a Google Maps search at each point of a grid around the business's pin (the `ll` parameter),
  finding where the business shows. Each point costs 3 Serper credits, so grids stay small.
- Backlinks: the other sites Google shows for the business's domain and name (listings, social profiles,
  articles). Not a full backlink index; the result says so ("source": "google_mentions").
- Citations: which of the listing sites that matter for the business's kind it appears on, and whether
  the phone shown there matches.
"""
import re
from statistics import mean
from typing import Any

from ...competitors.intel import Serper, brand_words_of, host_of, link_sources
from .. import countries
from ..keywords import other_cities
from ..match import phone_digits, site_domain
from .base import BacklinkProvider, CitationProvider, RankProvider, grid_points

MAX_GRID = 5  # 25 points x 3 credits: the most a single scan may spend


def _norm(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def same_place(item: dict[str, Any], business: Any) -> bool:
    """Whether a Maps result is this business: same Google place, phone, website or name."""
    if business.place_id and item.get("placeId") == business.place_id:
        return True
    if countries.same_phone(item.get("phoneNumber"), business.phone, countries.of(business)):
        return True
    if site_domain(business.website) and site_domain(item.get("website")) == site_domain(business.website):
        return True
    a, n = _norm(item.get("title")), _norm(business.name)
    return bool(n) and (a == n or (len(n) > 6 and (a.startswith(n) or n.startswith(a) and len(a) > 6)))


class SerperRanks(RankProvider):
    source = "live"
    default_grid = 3  # onboarding: 9 points per keyword
    default_radius_km = 2.0

    def scan_grid(self, business, keyword, size, radius_km):
        if business.lat is None or business.lng is None:
            raise RuntimeError("The business has no map pin (lat/lng); set it before a rank scan.")
        size = max(1, min(int(size), MAX_GRID))
        serper = Serper(countries.of(business))
        points, seen = [], {}
        for p in grid_points(business.lat, business.lng, size, radius_km):
            data = serper.call("/maps", {"q": keyword, "ll": f"@{p['lat']},{p['lng']},15z", "gl": serper.gl, "hl": "en"})
            places = data.get("places") or []
            rank = next((pl.get("position") for pl in places if same_place(pl, business)), None)
            for pl in places[:10]:
                if not same_place(pl, business) and pl.get("title"):
                    seen.setdefault(pl["title"], []).append(pl.get("position") or 20)
            points.append({**p, "rank": rank if rank and rank <= 20 else None})
        competitors = sorted(({"name": n, "avg_rank": round(mean(r), 1), "top3": sum(1 for x in r if x <= 3)} for n, r in seen.items()),
                             key=lambda c: (-c["top3"], c["avg_rank"]))[:5]
        return {"points": points, "competitors": competitors, "grid_size": size, "credits": serper.credits}


class SerperBacklinks(BacklinkProvider):
    source = "live"

    def summary(self, domain, name: str = "", city: str = "", country: str | None = None):
        serper = Serper(country)
        host = host_of(f"https://{domain}") or domain
        brand = brand_words_of(host, name)
        found = {s["domain"]: s for s in link_sources(serper, host, host, brand)}
        if name:
            for s in link_sources(serper, f"{name} {city}".strip(), host, brand):
                found.setdefault(s["domain"], s)
        # A same-named business in another city is not this one.
        away = other_cities(set(re.findall(r"[a-z]+", (city or "").lower())), countries.code(country))
        found = {d: s for d, s in found.items() if not (set(re.findall(r"[a-z]+", f"{s['title']} {s['url']}".lower())) & away)}
        top = [{"domain": s["domain"], "authority": None, "anchor": None, "toxic": False, "url": s["url"], "title": s["title"], "type": s["type"]} for s in found.values()]
        return {"referring_domains": len(top), "backlinks": None, "toxic": 0, "anchors": {}, "top": top, "source": "google_mentions",
                "note": "Sites Google shows linking to or mentioning the business. Connect DataForSEO for full backlink counts."}


def listing_sites(category: str | None, country: str | None = None) -> list[tuple[str, str]]:
    """The listing sites that matter for this kind of business in its country (see services/countries.py)."""
    return countries.listing_sites(category, country)


class SerperCitations(CitationProvider):
    source = "live"

    def check(self, business):
        c = countries.of(business)
        serper = Serper(c)
        host = site_domain(business.website)
        brand = brand_words_of(host, business.name)
        results = []
        # The name with the city, with the phone, and the website's domain: listings show up under any of them.
        for q in [f"{business.name} {business.city or ''}".strip(), f"{business.name} {phone_digits(business.phone)}".strip() if phone_digits(business.phone) else None, host or None]:
            if q:
                results += serper.search(q, None).get("organic", [])
        names = {x for x in brand if len(x) >= 4}
        mine = countries.national(business.phone, c)
        # A listing in another city with the same name is someone else ("SMD Hospital, Kolhapur").
        away = other_cities(set(re.findall(r"[a-z]+", f"{business.city or ''} {getattr(business, 'area', '') or ''}".lower())), c)
        out = []
        for label, domain in countries.listing_sites(business.primary_category, c):
            hit = None
            for o in results:
                h = host_of(o.get("link"))
                text = f"{o.get('title', '')} {o.get('snippet', '')} {o.get('link', '')}".lower()
                if (h == domain or h.endswith(f".{domain}")) and any(n in re.sub(r"[^a-z0-9]", "", text) for n in names):
                    same_phone = bool(mine) and mine in re.sub(r"\D", "", text)
                    if same_phone or not (set(re.findall(r"[a-z]+", text)) & away):
                        hit = o
                        break
            if not hit:
                out.append({"directory": label, "status": "missing", "found": None})
                continue
            # Any phone-like run of 10+ digits, however it is spaced ("98220 11111", "070551 01101", "+91-20-2747-0000").
            runs = re.findall(r"\+?\d[\d\s-]{8,16}\d", f"{hit.get('title', '')} {hit.get('snippet', '')}")
            phones = {countries.national(m, c) for m in runs if len(re.sub(r"\D", "", m)) >= 7}
            status = "inconsistent" if mine and phones and not any(countries.same_phone(mine, p, c) for p in phones) else "listed"
            out.append({"directory": label, "status": status, "url": hit.get("link"),
                        "found": {"name": hit.get("title"), "phone": next(iter(phones), None), "address": None}})
        return out
