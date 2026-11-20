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


def _facts_text(d: dict[str, Any]) -> dict[str, Any]:
    bs, rep = d.get("basics") or {}, d.get("reputation") or {}
    return {"name": bs.get("name"), "main_category": bs.get("category"), "other_categories": (bs.get("categories") or [])[:8], "google_summary": bs.get("summary"), "address": bs.get("address"),
            "price": bs.get("price"), "attributes": (d.get("features") or [])[:12],
            "customer_reviews": [str(r.get("text") or "")[:220] for r in (rep.get("reviews") or []) if r.get("text")][:5]}


def understand(d: dict[str, Any]) -> dict[str, Any]:
    """What a business with no website does, read from its Google listing: what it is, the services it offers and the words customers find it with. Only from what the listing shows."""
    facts = _facts_text(d)
    base = {"kind": facts["main_category"] or "", "services": [c for c in [facts["main_category"], *facts["other_categories"]] if c][:6], "keywords": [], "summary": facts["google_summary"] or "", "by_ai": False}
    try:
        from ..services import ai
        if not ai.is_configured():
            return base
        import json
        system = ("You read a business's Google Maps listing and work out what it really does. Use ONLY the facts given: never invent services, prices or claims. Services are what a customer "
                  "can buy or hire there, written plainly. Keywords are phrases real customers type into Google to find this kind of business (no city). Reply with JSON only.")
        user = (f"The listing:\n{json.dumps(facts, ensure_ascii=False)}\n\nAnswer exactly: {{\"kind\": \"2-4 words: what it really is (for example clothing rental, saree shop)\", "
                "\"services\": [\"up to 8 services or products it offers, shown by the listing or its reviews\"], \"keywords\": [\"up to 10 search phrases customers use to find it\"], "
                "\"summary\": \"2 sentences on what it does and who it serves\"}")
        data = ai.complete_json(system, user, temperature=0.1, max_tokens=900)
    except Exception as exc:  # noqa: BLE001 - the categories alone still say something
        log.info("Understanding a listing failed: %s", exc)
        return base
    clean = lambda xs, n: list(dict.fromkeys(str(x).strip()[:80] for x in (xs or []) if str(x).strip()))[:n]  # noqa: E731
    return {"kind": str(data.get("kind") or base["kind"])[:60], "services": clean(data.get("services"), 8) or base["services"], "keywords": clean([k.lower() for k in (data.get("keywords") or [])], 10),
            "summary": str(data.get("summary") or base["summary"])[:400], "by_ai": True}


def resolve_and_read(competitor: Any, region: str, lat: float | None, lng: float | None) -> tuple[str, dict[str, Any]]:
    """(place id, the public listing) of a saved competitor: its stored place, else the first Maps result for its name and address."""
    from ..services import maps_public
    pid = competitor.place_id or _resolve({"name": competitor.name, "address": competitor.address}, region, lat, lng)
    if not pid:
        raise LookupError("Its Google listing could not be found.")
    return pid, maps_public.read(pid)


def audit_competitor(competitor: Any, region: str, lat: float | None, lng: float | None) -> dict[str, Any]:
    """The Audit of a competitor with no website: its Google listing checked and understood. The caller stores the result on the competitor."""
    pid, d = resolve_and_read(competitor, region, lat, lng)
    return score_listing(d) | {"place_id": pid, "understanding": understand(d), "audited_at": datetime.now(timezone.utc).isoformat()}


_STOP = set("the and for with from your our you are on in at of to a an near me best top shop store service services rental rent hire".split())


def _tokens(x: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", x.lower()) if w not in _STOP and len(w) > 1}


def same_thing(a: str, b: str) -> bool:
    ta, tb = _tokens(a), _tokens(b)
    return bool(ta and tb and (ta <= tb or tb <= ta or len(ta & tb) / len(ta | tb) >= 0.5))


def overlap(ours: list[str], theirs: list[str]) -> dict[str, list[str]]:
    """Which services or keywords both have, only they have, and only you have."""
    shared = [t for t in theirs if any(same_thing(t, o) for o in ours)]
    return {"shared": shared, "only_them": [t for t in theirs if t not in shared], "only_us": [o for o in ours if not any(same_thing(o, t) for t in theirs)]}


def compare(b: Any, competitor: Any, our_listing: dict[str, Any] | None, our_services: list[str], our_keywords: list[str]) -> dict[str, Any]:
    """Their Google listing against yours: the checks side by side, and the services and keywords that overlap or are missing. Reads only what the Audit stored."""
    theirs = competitor.listing or {}
    under = theirs.get("understanding") or {}
    rows = []
    for ch in CHECKS:
        o = next((r for r in (our_listing or {}).get("rows", []) if r["key"] == ch[0]), None)
        c = next((r for r in theirs.get("rows", []) if r["key"] == ch[0]), None)
        rows.append({"key": ch[0], "label": ch[1], "ours": o and {"status": o["status"], "detail": o["detail"]}, "theirs": c and {"status": c["status"], "detail": c["detail"]}})
    return {"kind": "listing", "competitor": {"id": competitor.id, "name": competitor.name, "kind": under.get("kind"), "summary": under.get("summary"), "maps_url": (theirs.get("facts") or {}).get("maps_url")},
            "you": {"name": getattr(b, "name", None), "listing_read": our_listing is not None},
            "scores": {"ours": (our_listing or {}).get("score"), "theirs": theirs.get("score")}, "checks": rows,
            "services": overlap(our_services, under.get("services") or []), "keywords": overlap(our_keywords, under.get("keywords") or []),
            "audited_at": theirs.get("audited_at")}
