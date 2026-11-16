"""Live Google data for the local rank grid: the Google Places API (New), asked for the same search from each point around the business's pin, in Google's own order.

Listings (citations) and backlinks are not read from Google search results any more (Google has no API for them): listing links are added by hand and checked on the page,
and backlinks come from Backlink Intelligence.
"""
import re
from statistics import mean
from typing import Any

from .. import countries
from ..match import site_domain
from .base import CitationProvider, RankProvider, grid_points

MAX_GRID = 5  # 25 Places requests per keyword: the most a single scan may spend


def _norm(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def same_place(item: dict[str, Any], business: Any) -> bool:
    """Whether a Maps result is this business: same Google place, phone, website or name."""
    if business.place_id and (item.get("placeId") or item.get("cid")) == business.place_id:
        return True
    if countries.same_phone(item.get("phoneNumber"), business.phone, countries.of(business)):
        return True
    if site_domain(business.website) and site_domain(item.get("website")) == site_domain(business.website):
        return True
    a, n = _norm(item.get("title")), _norm(business.name)
    return bool(n) and (a == n or (len(n) > 6 and (a.startswith(n) or n.startswith(a) and len(a) > 6)))


class GooglePlacesRanks(RankProvider):
    source = "live"
    default_grid = 3  # onboarding: 9 points per keyword
    default_radius_km = 2.0

    def scan_grid(self, business, keyword, size, radius_km):
        from ...competitors import service
        if business.lat is None or business.lng is None:
            raise RuntimeError("The business has no map pin (lat/lng); set it before a rank scan.")
        size = max(1, min(int(size), MAX_GRID))
        region = countries.of(business) or "IN"
        bias_m = max(1000.0, min(5000.0, radius_km * 1000 / max(1, size - 1)))
        points, seen, requests = [], {}, 0
        for p in grid_points(business.lat, business.lng, size, radius_km):
            places = service.places_search(keyword, region, p["lat"], p["lng"], bias_m)
            requests += 1
            rank = next((pl["position"] for pl in places if same_place(pl, business)), None)
            for pl in places[:10]:
                if not same_place(pl, business) and pl.get("title"):
                    seen.setdefault(pl["title"], []).append(pl.get("position") or 20)
            points.append({**p, "rank": rank if rank and rank <= 20 else None})
        competitors = sorted(({"name": n, "avg_rank": round(mean(r), 1), "top3": sum(1 for x in r if x <= 3)} for n, r in seen.items()), key=lambda c: (-c["top3"], c["avg_rank"]))[:5]
        return {"points": points, "competitors": competitors, "grid_size": size, "requests": requests}


class ManualCitations(CitationProvider):
    """No automatic listing search: Google has no API for it. Listing links are added by a person and checked against the listing page (see citations_manage)."""
    source = "live"

    def check(self, business):
        return []
