"""One keyword, place by place: searches per month, the competition index and the cost in each of the project's locations, and the last twelve months.

From the Google Ads Keyword Planner: each place (the country, the city, the areas the project targets, and any place added by hand) is a location Google knows by its own code, and the keyword's
historical metrics are asked for that location. A place Google has no figures for is shown without numbers, never with an estimate. Answers are kept for a day.
"""
from __future__ import annotations

import time
from typing import Any

from ..models import Business
from . import countries, google_ads_client as ads

TTL = 24 * 3600
_geo: dict[tuple[str, str], tuple[float, dict | None]] = {}
_metrics: dict[tuple[str, str], tuple[float, dict]] = {}
MAX_PLACES = 8


def places_of(b: Business, extra: list[str] | None = None) -> list[tuple[str, str]]:
    """(name, kind) of each place to look at: the country, the city, the target areas, the business's own area, then what was added."""
    out: list[tuple[str, str]] = []
    code = countries.of(b) or "IN"
    out.append((countries.name(code), "Country"))
    for name, kind in [(b.city, "City"), *[(a, "Area") for a in (b.target_areas or [])], ((b.area or "").split(",")[0], "Area"), *[(x, "Added") for x in (extra or [])]]:
        name = " ".join(str(name or "").split())
        if name and name.lower() not in [n.lower() for n, _ in out]:
            out.append((name, kind))
    return out[:MAX_PLACES]


def _constant(name: str, code: str) -> dict | None:
    key = (code, name.lower())
    hit = _geo.get(key)
    if hit and time.time() - hit[0] < TTL * 7:
        return hit[1]
    found = ads.geo_constants([name], code).get(name)
    _geo[key] = (time.time(), found)
    return found


def for_keyword(b: Business, keyword: str, extra: list[str] | None = None) -> dict[str, Any]:
    """{keyword, difficulty (the country's competition index, 0 to 100), locations: [{name, kind, found_as, volume, index, competition, cpc, monthly}], reason}."""
    code = countries.of(b) or "IN"
    kw = " ".join(keyword.lower().split())
    rows: list[dict[str, Any]] = []
    reason = None
    try:
        for name, kind in places_of(b, extra):
            row: dict[str, Any] = {"name": name, "kind": kind, "found_as": None, "volume": None, "index": None, "competition": None, "cpc": None, "monthly": []}
            target = {"resource": ads.geo_target_for(code), "canonical": name, "type": "Country"} if kind == "Country" else _constant(name, code)
            if target is None:
                row["note"] = "Google has no location of this name."
                rows.append(row)
                continue
            row["found_as"] = target["canonical"]
            hit = _metrics.get((kw, target["resource"]))
            if hit and time.time() - hit[0] < TTL:
                m = hit[1]
            else:
                m = ads.historical_metrics([kw], geo_target=target["resource"]).get(kw) or {}
                _metrics[(kw, target["resource"])] = (time.time(), m)
            if m:
                row.update({"volume": m.get("volume"), "index": m.get("competition_index"), "competition": m.get("competition"), "cpc": m.get("cpc"), "monthly": m.get("monthly") or []})
            rows.append(row)
    except ads.GoogleAdsNotConfigured as exc:
        reason = str(exc)
    except ads.GoogleAdsError as exc:
        reason = f"Google Ads did not answer ({'; '.join(getattr(exc, 'details', []) or [str(exc)])[:200]})."
    country_row = next((r for r in rows if r["kind"] == "Country"), None)
    return {"keyword": kw, "difficulty": country_row["index"] if country_row else None, "locations": rows, "reason": reason}
