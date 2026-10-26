"""Interfaces every data provider implements."""
import math
from abc import ABC, abstractmethod
from typing import Any


def grid_points(lat: float, lng: float, size: int, radius_km: float) -> list[dict[str, float]]:
    """size x size points spread evenly over a square of +/- radius_km around the pin."""
    step = (2 * radius_km) / (size - 1) if size > 1 else 0
    dlat = 1 / 111.0
    dlng = 1 / (111.0 * max(0.1, math.cos(math.radians(lat))))
    half = (size - 1) / 2
    return [{"x": x, "y": y, "lat": round(lat + (half - y) * step * dlat, 6), "lng": round(lng + (x - half) * step * dlng, 6)}
            for y in range(size) for x in range(size)]


class RankProvider(ABC):
    source = "sample"

    @abstractmethod
    def scan_grid(self, business: Any, keyword: str, size: int, radius_km: float) -> dict[str, Any]:
        """{points: [{x, y, lat, lng, rank|None}], competitors: [{name, avg_rank, top3}]}"""


class KeywordProvider(ABC):
    source = "sample"

    @abstractmethod
    def ideas(self, seed: str, location: str, business: Any | None = None) -> list[dict[str, Any]]:
        """[{keyword, volume, difficulty, cpc, intent}]"""


class BacklinkProvider(ABC):
    source = "sample"

    @abstractmethod
    def summary(self, domain: str) -> dict[str, Any]:
        """{referring_domains, backlinks, toxic, anchors: {...}, top: [{domain, authority, anchor, toxic}]}"""


class CitationProvider(ABC):
    source = "sample"

    @abstractmethod
    def check(self, business: Any) -> list[dict[str, Any]]:
        """[{directory, status: listed|inconsistent|missing, found: {name, phone, address}|None}]"""


def intent_of(keyword: str) -> str:
    k = f" {keyword.lower()} "
    if " near me " in k or " in " in k or " nearby " in k:
        return "local"
    if any(w in k for w in (" cost ", " price ", " book ", " hire ", " buy ")):
        return "transactional"
    if any(w in k for w in (" best ", " top ", " vs ", " review")):
        return "commercial"
    if any(w in k for w in (" how ", " what ", " why ", " which ", " is ")):
        return "informational"
    return "commercial"
