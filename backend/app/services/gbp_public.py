"""The public Google Business Profile of a listing, read through DataForSEO (business_data/google), and an honest analysis of it.

info()    the listing as Google shows it: description, every category, rating and its spread, photo count, claimed or not, hours, attributes, services, what customers mention
posts()   the listing's recent posts (a task on DataForSEO's side: it takes about 20 seconds)
analyse() a checklist scored from those facts, and a roadmap built from the checks that fail. Every line comes from data we read; nothing is estimated."""
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from ..config import get_settings
from . import countries

BASE = "https://api.dataforseo.com/v3/business_data/google/"
_info: dict[str, tuple[float, dict[str, Any]]] = {}
_posts: dict[str, tuple[float, list[dict[str, Any]]]] = {}
INFO_TTL, POSTS_TTL = 3600, 6 * 3600


class GbpError(Exception):
    pass


def configured() -> bool:
    return bool(get_settings().dataforseo_auth.strip())


def _headers() -> dict[str, str]:
    return {"Authorization": f"Basic {get_settings().dataforseo_auth.strip()}"}


def _location(country: str | None) -> str:
    return countries.name(country) or "India"


def _check(body: dict[str, Any]) -> dict[str, Any]:
    if body.get("status_code") != 20000:
        raise GbpError(f"DataForSEO: {body.get('status_message') or 'request failed'}")
    return (body.get("tasks") or [{}])[0]


def _hours(wt: dict[str, Any] | None) -> list[str]:
    tt = ((wt or {}).get("work_hours") or {}).get("timetable") or {}
    out = []
    for day in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"):
        slots = tt.get(day)
        if not slots:
            out.append(f"{day.capitalize()}: closed")
            continue
        out.append(f"{day.capitalize()}: " + ", ".join(f"{s['open']['hour']:02d}:{s['open']['minute']:02d}-{s['close']['hour']:02d}:{s['close']['minute']:02d}" for s in slots))
    return out if tt else []


def info(place_id: str, country: str | None = None, fresh: bool = False) -> dict[str, Any]:
    hit = _info.get(place_id)
    if hit and hit[0] > time.monotonic() and not fresh:
        return hit[1]
    try:
        r = httpx.post(f"{BASE}my_business_info/live", headers=_headers(), json=[{"keyword": f"place_id:{place_id}", "location_name": _location(country), "language_code": "en"}], timeout=90)
        task = _check(r.json())
    except httpx.HTTPError as exc:
        raise GbpError("DataForSEO could not be reached.") from exc
    items = ((task.get("result") or [{}])[0] or {}).get("items") or []
    if not items:
        raise GbpError("DataForSEO found no public profile for this Maps listing.")
    it = items[0]
    rating = it.get("rating") or {}
    attrs = it.get("attributes") or {}
    flat = lambda d: sorted({f"{k}: {v.replace('_', ' ')}" for k, vs in (d or {}).items() for v in (vs or [])})  # noqa: E731
    topics = sorted((it.get("place_topics") or {}).items(), key=lambda kv: -kv[1])[:14]
    out = {
        "title": it.get("title"), "category": it.get("category"), "additional_categories": it.get("additional_categories") or [], "description": it.get("description") or "",
        "phone": it.get("phone"), "website": it.get("url") or it.get("domain"), "book_url": it.get("book_online_url"), "address": it.get("address"), "address_info": it.get("address_info") or {},
        "rating": rating.get("value"), "votes": rating.get("votes_count") or 0, "distribution": {k: int(v or 0) for k, v in (it.get("rating_distribution") or {}).items()},
        "photos": it.get("total_photos"), "claimed": it.get("is_claimed"), "price": it.get("price_level"), "hours": _hours(it.get("work_time")),
        "attributes": flat(attrs.get("available_attributes")), "attributes_missing": flat(attrs.get("unavailable_attributes")),
        "services": it.get("services") or [], "topics": [{"topic": k, "mentions": v} for k, v in topics], "qa_count": it.get("questions_and_answers_count"),
        "links": it.get("local_business_links") or [], "logo": it.get("logo"), "image": it.get("main_image"), "cid": it.get("cid"),
        "read_at": datetime.now(timezone.utc).isoformat(),
    }
    if len(_info) > 300:
        _info.clear()
    _info[place_id] = (time.monotonic() + INFO_TTL, out)
    return out


def posts(place_id: str, country: str | None = None, fresh: bool = False) -> list[dict[str, Any]]:
    hit = _posts.get(place_id)
    if hit and hit[0] > time.monotonic() and not fresh:
        return hit[1]
    try:
        made = _check(httpx.post(f"{BASE}my_business_updates/task_post", headers=_headers(), json=[{"keyword": f"place_id:{place_id}", "location_name": _location(country), "language_code": "en", "depth": 20}], timeout=60).json())
        tid = made.get("id")
        if not tid:
            raise GbpError("DataForSEO did not start the posts task.")
        got = None
        for _ in range(14):
            time.sleep(4)
            t = httpx.get(f"{BASE}my_business_updates/task_get/{tid}", headers=_headers(), timeout=60).json()
            task = (t.get("tasks") or [{}])[0]
            if task.get("status_code") == 20000:
                got = task
                break
            if task.get("status_code") not in (40601, 40602):  # still queued or running
                raise GbpError(f"DataForSEO: {task.get('status_message') or 'posts failed'}")
    except httpx.HTTPError as exc:
        raise GbpError("DataForSEO could not be reached.") from exc
    if not got:
        raise GbpError("The posts are taking longer than usual. Try again in a minute.")
    items = ((got.get("result") or [{}])[0] or {}).get("items") or []
    out = [{"text": (i.get("post_text") or i.get("snippet") or "")[:600], "date": (i.get("timestamp") or "")[:10], "url": i.get("url"), "image": i.get("images_url"), "has_link": bool(i.get("links"))} for i in items]
    _posts[place_id] = (time.monotonic() + POSTS_TTL, out)
    return out


def reviews(place_id: str, country: str | None = None, depth: int = 100) -> list[dict[str, Any]]:
    """Public reviews of the listing, newest first (a DataForSEO task: about 20 to 60 seconds for 100). Each has the author, stars, date, text and the owner's reply when there is one."""
    try:
        made = _check(httpx.post(f"{BASE}reviews/task_post", headers=_headers(), json=[{"keyword": f"place_id:{place_id}", "location_name": _location(country), "language_code": "en", "depth": max(10, min(depth, 200)), "sort_by": "newest"}], timeout=60).json())
        tid = made.get("id")
        if not tid:
            raise GbpError("DataForSEO did not start the reviews task.")
        got = None
        for _ in range(30):
            time.sleep(4)
            task = (httpx.get(f"{BASE}reviews/task_get/{tid}", headers=_headers(), timeout=60).json().get("tasks") or [{}])[0]
            if task.get("status_code") == 20000:
                got = task
                break
            if task.get("status_code") not in (40601, 40602):
                raise GbpError(f"DataForSEO: {task.get('status_message') or 'reviews failed'}")
    except httpx.HTTPError as exc:
        raise GbpError("DataForSEO could not be reached.") from exc
    if not got:
        raise GbpError("The reviews are taking longer than usual. Try again in a minute.")
    items = ((got.get("result") or [{}])[0] or {}).get("items") or []
    return [{"id": i.get("review_id"), "author": i.get("profile_name"), "rating": int((i.get("rating") or {}).get("value") or 0), "text": i.get("review_text") or i.get("original_review_text") or "",
             "at": i.get("timestamp"), "reply": i.get("owner_answer") or i.get("original_owner_answer") or "", "reply_at": i.get("owner_timestamp")} for i in items if i.get("review_id")]


def service_ideas(p: dict[str, Any], existing: list[str]) -> list[str]:
    """Service names to offer on the profile, taken from the categories Google shows for it (Google lists no services of its own for many profiles)."""
    have = {"".join(ch for ch in x.lower() if ch.isalnum()) for x in existing}
    out: list[str] = []
    for name in [p.get("category")] + list(p.get("additional_categories") or []):
        key = "".join(ch for ch in (name or "").lower() if ch.isalnum())
        if name and key not in have and name not in out:
            out.append(name)
    return out[:12]


# ------------------------------------------------------------------------------------------------------------------------ analysis
def _row(key: str, label: str, status: str, detail: str, weight: int, fix: str | None = None, phase: str = "30") -> dict[str, Any]:
    return {"key": key, "label": label, "status": status, "detail": detail, "weight": weight, "fix": fix, "phase": phase}


def analyse(p: dict[str, Any], b: Any, post_list: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Score the profile and build the roadmap. `post_list` None means the posts were not read: the posting checks are then left out, not guessed."""
    rows: list[dict[str, Any]] = []
    add = rows.append
    add(_row("claimed", "Profile is claimed and verified", "ok" if p.get("claimed") else "bad", "Claimed by the owner." if p.get("claimed") else "Nobody has claimed this profile, so you cannot edit or answer reviews.", 10,
             None if p.get("claimed") else "Claim the profile on Google and verify it (postcard, phone, email or video).", "7"))
    mine = (getattr(b, "primary_category", None) or "").strip().lower()
    cat = (p.get("category") or "").strip()
    add(_row("category", "Main category", "ok" if cat and (not mine or mine == cat.lower()) else "warn" if cat else "bad",
             f"Google shows “{cat}”." + (f" Your project says “{b.primary_category}”." if cat and mine and mine != cat.lower() else "") if cat else "No main category shown.", 10,
             "Make the main category the service that earns you the most, and use the same one everywhere.", "7"))
    extra = len(p.get("additional_categories") or [])
    add(_row("extra_categories", "Extra categories", "ok" if extra >= 3 else "warn" if extra else "bad", f"{extra} extra categor{'y' if extra == 1 else 'ies'} (Google allows up to 9).", 8,
             "Add the other services you really offer as extra categories (3 to 6 is a good range).", "7"))
    dl = len((p.get("description") or "").strip())
    add(_row("description", "Description", "ok" if dl >= 400 else "warn" if dl >= 150 else "bad", f"{dl} of 750 characters used." if dl else "No description.", 8,
             "Write 400 to 750 characters: who you serve, what you do, where, and what makes you different. No keyword stuffing, no links.", "7"))
    ph = p.get("photos") or 0
    add(_row("photos", "Photos", "ok" if ph >= 100 else "warn" if ph >= 25 else "bad", f"{ph} photos on the profile.", 8,
             "Add real photos of your work, team and place every week. Aim for 100 or more, with new ones each month.", "30"))
    votes, rating = p.get("votes") or 0, p.get("rating") or 0
    add(_row("reviews", "Number of reviews", "ok" if votes >= 100 else "warn" if votes >= 25 else "bad", f"{votes} reviews.", 12,
             "Ask every happy customer for a review with your review link: print it on the bill and send it by WhatsApp after each job.", "7"))
    add(_row("rating", "Average rating", "ok" if rating >= 4.5 else "warn" if rating >= 4.0 else "bad", f"{rating} stars." if rating else "No rating yet.", 10,
             "Reply to every review and fix what unhappy customers name.", "30"))
    dist = p.get("distribution") or {}
    total = sum(dist.values()) or 0
    low = (dist.get("1", 0) + dist.get("2", 0)) / total if total else 0
    if total:
        add(_row("negatives", "Low-star reviews", "ok" if low <= 0.05 else "warn" if low <= 0.12 else "bad", f"{round(low * 100)}% of reviews are 1 or 2 stars.", 4, "Reply politely to each low review and offer to put it right offline.", "30"))
    add(_row("hours", "Opening hours", "ok" if p.get("hours") else "bad", "Hours are shown." if p.get("hours") else "No opening hours shown.", 6, "Add hours for every day, and special hours for holidays.", "7"))
    add(_row("phone", "Phone number", "ok" if p.get("phone") else "bad", p.get("phone") or "No phone shown.", 4, "Add the number customers can call.", "7"))
    add(_row("website", "Website link", "ok" if p.get("website") else "bad", p.get("website") or "No website shown.", 4, "Add your website, with a UTM tag so you can see the visits in analytics.", "7"))
    add(_row("booking", "Booking or appointment link", "ok" if p.get("book_url") else "warn", p.get("book_url") or "No booking link.", 3, "Add an appointment or enquiry link so customers can act straight from Google.", "30"))
    add(_row("attributes", "Attributes", "ok" if len(p.get("attributes") or []) >= 3 else "warn", f"{len(p.get('attributes') or [])} attributes set.", 3, "Turn on every attribute that is true for you (payment, accessibility, amenities).", "30"))
    add(_row("services", "Services listed", "ok" if p.get("services") else "warn", f"{len(p.get('services') or [])} services listed." if p.get("services") else "No services listed.", 5,
             "List each service with a short description (and a price if you can).", "30"))
    nap = []
    if getattr(b, "phone", None) and p.get("phone"):
        a, c = "".join(ch for ch in str(b.phone) if ch.isdigit())[-10:], "".join(ch for ch in str(p["phone"]) if ch.isdigit())[-10:]
        if a and c and a != c:
            nap.append("phone")
    if getattr(b, "name", None) and p.get("title") and "".join(ch for ch in b.name.lower() if ch.isalnum()) != "".join(ch for ch in p["title"].lower() if ch.isalnum()):
        nap.append("name")
    add(_row("nap", "Same name and phone everywhere", "warn" if nap else "ok", ("Your project and Google differ in: " + ", ".join(nap) + ".") if nap else "Name and phone match your project.", 4,
             "Use one exact name and phone on Google, your website and every listing.", "7"))
    if post_list is not None:
        newest = max((x["date"] for x in post_list if x.get("date")), default=None)
        age = (datetime.now(timezone.utc).date() - datetime.fromisoformat(newest).date()).days if newest else None
        recent = sum(1 for x in post_list if x.get("date") and (datetime.now(timezone.utc).date() - datetime.fromisoformat(x["date"]).date()).days <= 30)
        add(_row("posts", "Recent posts", "ok" if age is not None and age <= 14 and recent >= 3 else "warn" if age is not None and age <= 45 else "bad",
                 f"{recent} post{'s' if recent != 1 else ''} in the last 30 days; the newest is {age} days old." if age is not None else "No posts found.", 10,
                 "Post one update or offer a week with a real photo and a button. Old posts stop showing after a few weeks.", "7"))
    earned = sum(r["weight"] * {"ok": 1, "warn": 0.5, "bad": 0}[r["status"]] for r in rows)
    possible = sum(r["weight"] for r in rows)
    score = round(100 * earned / possible) if possible else 0
    order = {"bad": 0, "warn": 1}
    todo = sorted((r for r in rows if r["status"] != "ok" and r["fix"]), key=lambda r: (order[r["status"]], -r["weight"]))
    phases = {"7": [], "30": [], "90": []}
    for r in todo:
        phases[r["phase"]].append({"what": r["fix"], "why": f"{r['label']}: {r['detail']}", "impact": "high" if r["weight"] >= 8 else "medium" if r["weight"] >= 5 else "low"})
    phases["30"] += [
        {"what": f"Collect about {max(10, round(max(votes, 20) * 0.1))} new reviews a month and reply to every one within two days.", "why": "Reviews are the strongest local signal you control.", "impact": "high"},
        {"what": "Post a weekly update or offer and add 5 to 10 new photos a month.", "why": "Fresh activity keeps the profile ahead of similar businesses nearby.", "impact": "medium"},
    ]
    phases["90"] += [
        {"what": "Build one page on your website for each main service and area, and link them from the profile.", "why": "The website is what Google compares the profile against.", "impact": "high"},
        {"what": "Keep name, address and phone identical on 15 to 20 trusted directories (Listings page).", "why": "Consistent listings build trust in your location.", "impact": "medium"},
        {"what": "Track your Maps rank for your top 10 searches each month and compare with competitors (Map Rank Tracker).", "why": "It shows whether the work is moving you up.", "impact": "medium"},
        {"what": "Earn links and mentions from local sites, and add the same details as LocalBusiness data on your site.", "why": "Prominence on the web lifts the profile in Maps.", "impact": "medium"},
    ]
    return {"score": score, "word": "Strong" if score >= 80 else "Fair" if score >= 55 else "Needs work", "checks": rows, "roadmap": [
        {"when": "This week", "days": 7, "items": phases["7"]}, {"when": "Next 30 days", "days": 30, "items": phases["30"]}, {"when": "Next 90 days", "days": 90, "items": phases["90"]}],
        "counts": {s: sum(1 for r in rows if r["status"] == s) for s in ("ok", "warn", "bad")}, "posts_read": post_list is not None}
