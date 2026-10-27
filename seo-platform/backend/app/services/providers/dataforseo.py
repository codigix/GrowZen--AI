"""DataForSEO adapters (pay per use): Maps SERP for rank grids, keyword data, backlinks.

Docs: https://docs.dataforseo.com/v3/ . Live endpoints are used for simplicity; switch to the
task_post / task_get pair for large volumes (cheaper).
"""
import re
from statistics import mean
from typing import Any

import httpx

from ...config import get_settings
from .base import BacklinkProvider, KeywordProvider, RankProvider, grid_points, intent_of

API = "https://api.dataforseo.com/v3"


class DataForSeoError(RuntimeError):
    pass


def _post(path: str, payload: list[dict[str, Any]], timeout: float = 60) -> dict[str, Any]:
    s = get_settings()
    r = httpx.post(f"{API}{path}", json=payload, auth=(s.dataforseo_login, s.dataforseo_password), timeout=timeout)
    data = r.json()
    if r.status_code != 200 or data.get("status_code") != 20000:
        raise DataForSeoError(data.get("status_message") or f"HTTP {r.status_code}")
    task = (data.get("tasks") or [{}])[0]
    if task.get("status_code") != 20000:
        raise DataForSeoError(task.get("status_message") or "Task failed")
    return task


def _same_business(item: dict[str, Any], business: Any) -> bool:
    if business.place_id and item.get("place_id") == business.place_id:
        return True
    norm = lambda s: re.sub(r"[^a-z0-9]", "", (s or "").lower())  # noqa: E731
    if business.phone and norm(item.get("phone"))[-10:] == norm(business.phone)[-10:]:
        return True
    return norm(item.get("title")) == norm(business.name)


class DataForSeoRanks(RankProvider):
    source = "live"

    def scan_grid(self, business, keyword, size, radius_km):
        if business.lat is None or business.lng is None:
            raise DataForSeoError("The business has no map pin (lat/lng); set it before a rank-grid scan.")
        points = []
        seen: dict[str, list[int]] = {}
        for p in grid_points(business.lat, business.lng, size, radius_km):
            task = _post("/serp/google/maps/live/advanced", [{"keyword": keyword, "location_coordinate": f"{p['lat']},{p['lng']},15z", "language_code": "en", "depth": 20}])
            items = ((task.get("result") or [{}])[0] or {}).get("items") or []
            rank = next((it.get("rank_group") for it in items if _same_business(it, business)), None)
            for it in items[:10]:
                if not _same_business(it, business) and it.get("title"):
                    seen.setdefault(it["title"], []).append(it.get("rank_group") or 20)
            points.append({**p, "rank": rank})
        competitors = sorted(({"name": n, "avg_rank": round(mean(r), 1), "top3": sum(1 for x in r if x <= 3)} for n, r in seen.items()), key=lambda c: (-c["top3"], c["avg_rank"]))[:5]
        return {"points": points, "competitors": competitors}


class DataForSeoKeywords(KeywordProvider):
    source = "live"

    def ideas(self, seed, location, business=None):
        task = _post("/keywords_data/google_ads/keywords_for_keywords/live", [{"keywords": [seed], "location_name": location or "India", "language_code": "en"}])
        rows = task.get("result") or []
        out = [{"keyword": r["keyword"], "volume": r.get("search_volume"), "cpc": r.get("cpc"), "difficulty": r.get("competition_index"), "intent": intent_of(r["keyword"])} for r in rows if r.get("keyword")]
        return sorted(out, key=lambda k: k["volume"] or 0, reverse=True)[:60]


class DataForSeoBacklinks(BacklinkProvider):
    source = "live"

    def summary(self, domain):
        task = _post("/backlinks/summary/live", [{"target": domain, "include_subdomains": True}])
        res = (task.get("result") or [{}])[0] or {}
        ref = _post("/backlinks/referring_domains/live", [{"target": domain, "limit": 20, "order_by": ["rank,desc"]}])
        items = ((ref.get("result") or [{}])[0] or {}).get("items") or []
        top = [{"domain": i.get("domain"), "authority": i.get("rank"), "anchor": None, "toxic": (i.get("backlinks_spam_score") or 0) >= 60} for i in items]
        return {"referring_domains": res.get("referring_domains"), "backlinks": res.get("backlinks"), "toxic": sum(1 for t in top if t["toxic"]),
                "anchors": {}, "top": top, "spam_score": res.get("backlinks_spam_score")}
