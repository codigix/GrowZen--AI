"""Audit a competitor through its Google Maps listing, for the many local businesses that have no website.

The public listing (Google Places) shows what a customer sees: name and category, phone, website link, opening hours, photos, rating, number of reviews, how recent the reviews are, the
attributes it ticked. Each is checked the same way for the competitor and for this business, so the two can be put side by side. Places shows at most 10 photos and 5 reviews and gives
no posts, services list or owner replies: those are never invented here, they are simply not part of the check."""
from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

log = logging.getLogger("seo.listing_audit")

# (key, label, weight): the checks in the order they are shown
CHECKS = [("category", "Main category", 8), ("summary", "Description (Google's summary)", 8), ("phone", "Phone number", 8), ("website", "Website link", 12), ("hours", "Opening hours", 10),
          ("photos", "Photos", 12), ("reviews", "Number of reviews", 14), ("rating", "Average rating", 12), ("recent", "Recent reviews", 10), ("attributes", "Attributes", 6)]

_REL = re.compile(r"(\d+|an?|one)\s+(minute|hour|day|week|month|year)s?\s+ago", re.I)
_UNIT_DAYS = {"minute": 0, "hour": 0, "day": 1, "week": 7, "month": 30, "year": 365}


def age_days(when: str | None) -> int | None:
    """How old a review is, from Google's text ("a month ago", "3 weeks ago") or its date."""
    if not when:
        return None
    m = _REL.search(when)
    if m:
        n = 1 if m.group(1).lower() in ("a", "an", "one") else int(m.group(1))
        return n * _UNIT_DAYS[m.group(2).lower()]
    try:
        d = datetime.fromisoformat(str(when).replace("Z", "+00:00"))
        return max(0, (datetime.now(timezone.utc) - (d if d.tzinfo else d.replace(tzinfo=timezone.utc))).days)
    except ValueError:
        return None


def _row(key: str, status: str, detail: str) -> dict[str, Any]:
    label, weight = next((l, w) for k, l, w in CHECKS if k == key)
    return {"key": key, "label": label, "status": status, "detail": detail, "weight": weight}


def score_listing(d: dict[str, Any]) -> dict[str, Any]:
    """Check one public listing (the dict maps_public.read gives). Returns {score 0-100, rows, facts}."""
    bs, rep = d.get("basics") or {}, d.get("reputation") or {}
    cat = bs.get("category") or ""
    photos, votes, rating = rep.get("photos") or 0, rep.get("count") or 0, rep.get("rating") or 0
    ages = [a for a in (age_days(r.get("when")) for r in rep.get("reviews") or []) if a is not None]
    newest = min(ages) if ages else None
    feats = d.get("features") or []
    rows = [
        _row("category", "ok" if cat else "bad", cat or "No main category shown."),
        _row("summary", "ok" if bs.get("summary") else "bad", "Google shows a description." if bs.get("summary") else "No description shown."),
        _row("phone", "ok" if bs.get("phone") else "bad", bs.get("phone") or "No phone shown."),
        _row("website", "ok" if bs.get("website") else "bad", bs.get("website") or "No website on the listing."),
        _row("hours", "ok" if d.get("hours") else "bad", "Hours are shown." if d.get("hours") else "No opening hours shown."),
        _row("photos", "ok" if photos >= 10 else "warn" if photos >= 5 else "bad", f"{photos} photo{'s' if photos != 1 else ''} (Maps shows at most 10)."),
        _row("reviews", "ok" if votes >= 100 else "warn" if votes >= 25 else "bad", f"{votes} review{'s' if votes != 1 else ''}."),
        _row("rating", "ok" if rating >= 4.5 else "warn" if rating >= 4.0 else "bad", f"{rating} stars." if rating else "No rating yet."),
        _row("recent", "ok" if newest is not None and newest <= 90 else "warn" if newest is not None and newest <= 365 else "bad",
             f"The newest of the reviews shown is {newest} day{'s' if newest != 1 else ''} old." if newest is not None else "No recent review shown."),
        _row("attributes", "ok" if len(feats) >= 3 else "warn" if feats else "bad", f"{len(feats)} attribute{'s' if len(feats) != 1 else ''} ticked."),
    ]
    total = round(sum(r["weight"] * (1 if r["status"] == "ok" else 0.5 if r["status"] == "warn" else 0) for r in rows))
    facts = {"name": bs.get("name"), "address": bs.get("address"), "rating": rating or None, "reviews": votes, "photos": photos, "website": bs.get("website"), "phone": bs.get("phone"),
             "category": cat, "newest_review_days": newest, "maps_url": d.get("maps_url"), "open": bs.get("status")}
    return {"score": total, "rows": rows, "facts": facts}


def _resolve(item: dict[str, Any], region: str, lat: float | None, lng: float | None) -> str | None:
    """The Google place id of a competitor: the one the research kept, else the first Maps result for its name and address."""
    if item.get("cid"):
        return str(item["cid"])
    from .service import CompetitorSearchError, places_search
    q = " ".join(x for x in [item.get("name"), item.get("address")] if x)
    if not q:
        return None
    try:
        found = places_search(q, region, lat, lng, 3000.0, page_size=1)
    except CompetitorSearchError:
        return None
    return (found[0].get("placeId") or found[0].get("cid")) if found else None


def audit_one(place_id: str) -> dict[str, Any]:
    from ..services import maps_public
    return score_listing(maps_public.read(place_id))


def audit(b: Any, items: list[dict[str, Any]], region: str = "IN") -> dict[str, Any]:
    """Audit the business's own public listing and each competitor's, side by side."""
    lat, lng = getattr(b, "lat", None), getattr(b, "lng", None)
    wanted = [i for i in items if isinstance(i, dict)][:15]

    def one(item: dict[str, Any]) -> dict[str, Any]:
        out = {"name": item.get("name"), "cid": item.get("cid"), "website": item.get("website")}
        try:
            pid = _resolve(item, region, lat, lng)
            if not pid:
                return out | {"error": "Its Google listing could not be found."}
            return out | audit_one(pid) | {"place_id": pid}
        except Exception as exc:  # noqa: BLE001 - one listing that cannot be read must not stop the others
            log.info("Listing audit failed for %s: %s", item.get("name"), exc)
            return out | {"error": "Its Google listing could not be read."}

    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(one, wanted))
    you = None
    if getattr(b, "place_id", None):
        try:
            you = audit_one(b.place_id) | {"name": b.name, "place_id": b.place_id}
        except Exception as exc:  # noqa: BLE001
            log.info("Own listing could not be read: %s", exc)
    return {"you": you, "items": results, "checks": [{"key": k, "label": l, "weight": w} for k, l, w in CHECKS], "read_at": datetime.now(timezone.utc).isoformat(),
            "note": "Read from each public Google Maps listing: Maps shows at most 10 photos and 5 reviews, and no posts, services or owner replies."}
