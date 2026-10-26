"""Sample data (stable per business) used until a paid provider is connected."""
import math
import random
from typing import Any

from .base import BacklinkProvider, CitationProvider, KeywordProvider, RankProvider, grid_points, intent_of

DIRECTORIES = ["Justdial", "Sulekha", "IndiaMART", "Practo", "Yellow Pages India", "Bing Places", "Apple Business Connect", "Facebook", "Instagram", "LinkedIn"]


def _rng(*parts: Any) -> random.Random:
    return random.Random("|".join(str(p) for p in parts))


class SampleRanks(RankProvider):
    source = "sample"

    def scan_grid(self, business, keyword, size, radius_km):
        lat, lng = business.lat or 18.52, business.lng or 73.85
        r = _rng(business.id, keyword, size)
        strength = 1 + r.random() * 1.6
        mid = (size - 1) / 2
        points = []
        for p in grid_points(lat, lng, size, radius_km):
            d = math.hypot(p["x"] - mid, p["y"] - mid) / (mid or 1)
            rank = round(1 + d * d * 9 * strength + r.random() * 3 * strength)
            points.append({**p, "rank": None if rank > 20 else max(1, rank)})
        competitors = [{"name": f"Competitor {i + 1}", "avg_rank": round(3 + r.random() * 9, 1), "top3": r.randint(0, size * size // 3)} for i in range(4)]
        return {"points": points, "competitors": competitors}


class SampleKeywords(KeywordProvider):
    source = "sample"

    def ideas(self, seed, location, business=None):
        r = _rng(seed, location)
        area = (location.split(",")[0] if location else "").strip().lower()
        variants = [seed, f"{seed} near me", f"best {seed}", f"{seed} cost", f"{seed} {area}".strip(), f"{seed} price", f"how much does {seed} cost", f"{seed} reviews"]
        out = []
        for i, k in enumerate(dict.fromkeys(variants)):
            out.append({"keyword": k, "volume": round((r.randint(1500, 6000) if i == 0 else r.randint(40, 1900)) / 10) * 10,
                        "difficulty": r.randint(8, 72), "cpc": round(5 + r.random() * 60, 1), "intent": intent_of(k)})
        return out


class SampleBacklinks(BacklinkProvider):
    source = "sample"

    def summary(self, domain):
        r = _rng(domain)
        top = [{"domain": d, "authority": r.randint(15, 80) if not d.endswith((".xyz", ".biz")) else r.randint(1, 9),
                "anchor": r.choice(["brand", "website", "click here", "service keyword"]), "toxic": d.endswith((".xyz", ".biz"))}
               for d in ["justdial.com", "practo.com", "punemirror.in", "medium.com", "quora.com", "lbb.in", "cheap-links-seo.xyz", "top10dir.biz"]]
        return {"referring_domains": r.randint(8, 60), "backlinks": r.randint(40, 600), "toxic": sum(1 for t in top if t["toxic"]),
                "anchors": {"brand": r.randint(30, 60), "url": r.randint(10, 30), "keyword": r.randint(5, 25), "generic": r.randint(2, 15)}, "top": top}


class SampleCitations(CitationProvider):
    source = "sample"

    def check(self, business):
        r = _rng(business.id, "citations")
        out = []
        for d in DIRECTORIES:
            roll = r.random()
            status = "listed" if roll > 0.5 else "inconsistent" if roll > 0.25 else "missing"
            found = None
            if status != "missing":
                found = {"name": business.name, "phone": business.phone, "address": business.address}
                if status == "inconsistent":
                    found = {**found, "phone": "+91 20 2543 1100"} if r.random() < 0.5 else {**found, "name": f"{business.name.split(' ')[0]} {business.primary_category or ''}".strip()}
            out.append({"directory": d, "status": status, "found": found})
        return out
