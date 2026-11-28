"""GMB audit: nine parameters of a Google Business Profile, each scored by fixed rules from real data and given exact fixes.

Parameters: categories, name, NAP, description, products and services, reviews and ratings, photos, local keywords and
search visibility, and the Maps geo-grid ranking.

Rules measure; a score never comes from an AI. A fact that cannot be read (the description and services of a profile that is
not connected to Google, a rank scan that is only sample data) is marked "not read" and left out of the score, never guessed.
`suggest()` is the only AI step: it writes drafts (description, service texts, photo ideas, review messages) from the facts only,
and the result is cleaned in code before it is shown.
"""
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import discovery, gbp_public

WEIGHTS = {"categories": 12, "name": 8, "nap": 12, "description": 10, "services": 10, "reviews": 18, "photos": 8, "visibility": 10, "geogrid": 12}
LABELS = {"categories": "Primary & secondary categories", "name": "Business name", "nap": "NAP accuracy & consistency", "description": "Business description",
          "services": "Products & services", "reviews": "Customer reviews & star ratings", "photos": "Photos & videos", "visibility": "Local keywords & search visibility",
          "geogrid": "Google Maps local ranking (geo-grid)"}
STUFFING = re.compile(r"\b(best|top|cheap|cheapest|affordable|no\.?\s?1|number\s?one|#1|near\s?me|nearby|24\s?/\s?7|open now|discount|offer|call now|leading|famous)\b", re.I)
PROMO = re.compile(r"\b(best|cheapest|#1|no\.?\s?1|guarantee[d]?|100%|discount|free|offer)\b", re.I)
URL = re.compile(r"(https?://|www\.|\b[a-z0-9-]+\.(com|in|co|net|org)\b)", re.I)
PHONE = re.compile(r"\+?\d[\d\s().-]{8,}\d")
OK, WARN, BAD, NA = "ok", "warn", "bad", "unknown"


def _digits(v: Any) -> str:
    return "".join(ch for ch in str(v or "") if ch.isdigit())[-10:]


def _tokens(v: Any) -> set[str]:
    return {t for t in re.split(r"[^a-z0-9]+", str(v or "").lower()) if len(t) > 2}


_STOP = {"the", "and", "for", "with", "near", "best", "from", "your", "our", "all", "any", "service", "services"}


def _with_tips(sec: dict[str, Any], tips: list[str]) -> dict[str, Any]:
    sec["tips"] = [t for t in tips if t]
    return sec


def _stems(v: Any) -> set[str]:
    """Words cut to their first five letters, so clothes, cloths and clothing count as the same word."""
    return {t[:5] for t in _tokens(v)}


def _plain(v: Any) -> str:
    return "".join(ch for ch in str(v or "").lower() if ch.isalnum())


def _chk(label: str, status: str, detail: str) -> dict[str, str]:
    return {"label": label, "status": status, "detail": detail}


# Where in the app each kind of fix is made: (what the person reads, the address that opens it)
TARGETS = {
    "basics": ("Edit profile → Basics (name and categories)", "/gmb-profile/profile?sub=edit&step=details"),
    "contact": ("Edit profile → Contact (phone and website)", "/gmb-profile/profile?sub=edit&step=contact"),
    "location": ("Edit profile → Location (address)", "/gmb-profile/profile?sub=edit&step=location"),
    "about": ("Edit profile → About (description)", "/gmb-profile/profile?sub=edit&step=about"),
    "services": ("Edit profile → Services", "/gmb-profile/profile?sub=edit&step=services"),
    "highlights": ("Edit profile → Highlights (attributes)", "/gmb-profile/profile?sub=edit&step=highlights"),
    "photos": ("Photos", "/gmb-profile/photos"),
    "reviews": ("Reviews & Reputation", "/reviews?tab=google"),
    "keywords": ("My Keywords", "/keyword-management"),
    "rankgrid": ("Map Rank Tracker", "/rank-tracking/geo"),
}
# What fixing a parameter gives you, in plain words (shown next to each problem)
GAIN = {
    "categories": "Google shows you for the right searches, so more of the people who see you are looking for what you do.",
    "name": "The listing stays safe from suspension and matches your real brand, so customers and Google trust it.",
    "nap": "Google is sure which business you are, which supports a higher Maps ranking and avoids customers calling a wrong number.",
    "description": "Google and customers understand what you do and where, so you appear for more searches and get more enquiries.",
    "services": "You can be matched to searches for each service, and customers see what you offer before they call.",
    "reviews": "A higher Maps ranking, more calls and directions, and more trust from people comparing you with competitors.",
    "photos": "More calls and direction requests: profiles with many fresh photos get noticeably more actions.",
    "visibility": "You appear for the local searches that bring customers, and more people click through to you.",
    "geogrid": "You show up in the areas around you where you are missing now, so more nearby customers find you.",
}
_CHECK_GO = (("address", "location"), ("phone", "contact"), ("keywords appear", "about"), ("description", "about"), ("service", "services"), ("price", "services"), ("logo", "photos"), ("cover", "photos"))
_DEFAULT_GO = {"categories": "basics", "name": "basics", "nap": "contact", "description": "about", "services": "services", "reviews": "reviews", "photos": "photos", "visibility": "keywords", "geogrid": "rankgrid"}


class _Fixes(list):
    """The fixes of one parameter. A fix belongs to the check written just before it (unless it says otherwise), so each problem shows its own solution."""

    def __init__(self, checks: list[dict[str, str]]):
        super().__init__()
        self._checks = checks

    def append(self, f: dict[str, Any]) -> None:  # type: ignore[override]
        if f.get("check") is None:
            f["check"] = len(self._checks) - 1
        super().append(f)


def _idx(checks: list[dict[str, str]], *words: str) -> int:
    """The first check that is not fine and whose name has one of the words (else the last check)."""
    for i, c in enumerate(checks):
        if c["status"] in (BAD, WARN) and any(w in c["label"].lower() for w in words):
            return i
    return len(checks) - 1


def _fix(what: str, why: str, impact: str = "medium", example: str | None = None, go: str | None = None, apply: dict[str, Any] | None = None, check: int | None = None) -> dict[str, Any]:
    """`go` names where it is fixed (TARGETS); `apply` is a value the edit form can be filled with (checked and saved by the person)."""
    return {"what": what, "why": why, "impact": impact, "example": example, "go": go, "apply": apply, "check": check}


def _issues(checks: list[dict[str, str]], fixes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One entry per problem: what is wrong, and the fix(es) for exactly that. A fix with no problem of its own (a step not done yet) is shown on its own."""
    out = [{"severity": c["status"], "title": c["label"], "detail": c["detail"], "fixes": [f for f in fixes if f.get("check") == i]} for i, c in enumerate(checks) if c["status"] in (BAD, WARN)]
    used = {id(f) for q in out for f in q["fixes"]}
    loose = [f for f in fixes if id(f) not in used]
    if loose:
        out.append({"severity": WARN, "title": loose[0]["what"] if len(loose) == 1 else "To do", "detail": loose[0]["why"] if len(loose) == 1 else "", "fixes": loose})
    return out


def _section(key: str, checks: list[dict[str, str]], fixes: list[dict[str, Any]], found: list[tuple[str, Any]], source: str, readable: bool = True, note: str | None = None) -> dict[str, Any]:
    if not readable or not checks:
        return {"tips": [], "issues": _issues(checks, fixes), "passed": [], "not_checked": [c["label"] for c in checks if c["status"] == NA], "gain": GAIN[key], "key": key, "label": LABELS[key], "weight": WEIGHTS[key], "status": NA, "score": None, "summary": note or "Not read.", "found": [{"label": k, "value": v} for k, v in found if v not in (None, "", [])],
                "checks": checks, "fixes": fixes, "source": source, "readable": False}
    pts = sum({OK: 1.0, WARN: 0.5, BAD: 0.0}[c["status"]] for c in checks if c["status"] in (OK, WARN, BAD))
    n = sum(1 for c in checks if c["status"] in (OK, WARN, BAD))
    score = round(100 * pts / n) if n else None
    status = OK if score is not None and score >= 80 else WARN if score is not None and score >= 50 else BAD if score is not None else NA
    bad = sum(1 for c in checks if c["status"] == BAD)
    warn = sum(1 for c in checks if c["status"] == WARN)
    summary = "Everything checked is in good shape." if not (bad or warn) else f"{bad} to fix, {warn} to improve out of {n} checks."
    return {"tips": [], "issues": _issues(checks, fixes), "passed": [c["label"] for c in checks if c["status"] == OK], "not_checked": [c["label"] for c in checks if c["status"] == NA], "gain": GAIN[key], "key": key, "label": LABELS[key], "weight": WEIGHTS[key], "status": status, "score": score, "summary": summary, "found": [{"label": k, "value": v} for k, v in found if v not in (None, "", [])],
            "checks": checks, "fixes": fixes, "source": source, "readable": True}


# ---------------------------------------------------------------------------------------------------------------- facts
def _public(b: Any, fresh: bool) -> dict[str, Any] | None:
    if not getattr(b, "place_id", None) or not discovery.places_enabled():
        return None
    try:
        return gbp_public.info(b.place_id, fresh)
    except Exception:  # noqa: BLE001 - the audit goes on with what the project has saved
        return None


def _services(b: Any) -> list[dict[str, Any]]:
    return [s for s in (b.services or []) if isinstance(s, dict) and s.get("name")]


# ---------------------------------------------------------------------------------------------------------------- the nine
def categories(b: Any, p: dict[str, Any] | None, comps: list[Any]) -> dict[str, Any]:
    connected = bool(b.gbp_location)
    primary = (b.primary_category if connected else (p or {}).get("category") or b.primary_category) or ""
    secondary = list(b.secondary_categories or []) if connected else list((p or {}).get("additional_categories") or b.secondary_categories or [])
    checks: list[dict[str, str]] = []
    fixes = _Fixes(checks)
    checks.append(_chk("Primary category is set", OK if primary else BAD, primary or "No primary category."))
    if not primary:
        fixes.append(_fix("Choose the primary category that describes your main money-making service.", "The primary category has the biggest effect on which searches you appear for.", "high"))
    services = [s["name"] for s in _services(b)]
    if primary and services:
        pt = _stems(primary)
        match = any(pt & _stems(s) for s in services)
        listed = ", ".join(services[:4])
        checks.append(_chk("Primary category matches your main services", OK if match else WARN,
                           "Your services use the same words as the category." if match else f"The category “{primary}” and your services (“{listed}”) use different words, so Google may not link them."))
        if not match:
            fixes.append(_fix(f"Look at your services (“{listed}”) and the category “{primary}”. If the category does not say what you actually do, change it to one that does.", "Google shows you for searches that match the category, so a category that describes a different kind of business brings the wrong customers.", "high",
                              "Open the category picker in Edit profile → Basics, search for words from your services, and pick the category that fits. “Write drafts with AI” also suggests categories."))
    if primary and len(services) >= 2:
        covered = {t[:4] for t in _tokens(" ".join([primary, *secondary]))} | {t[:4] for t in _tokens(f"{b.city or ''} {b.area or ''}")}
        per_service = [{t[:4]: t for t in _tokens(sv) if t not in _STOP} for sv in services]
        count: dict[str, int] = {}
        word_of: dict[str, str] = {}
        for sv in per_service:
            for stem, word in sv.items():
                if stem not in covered:
                    count[stem] = count.get(stem, 0) + 1
                    word_of[stem] = max(word_of.get(stem, ""), word, key=len)
        top = max(count.items(), key=lambda kv: kv[1], default=None)
        if top and top[1] >= 2 and top[1] / len(services) >= 0.5:
            w = word_of[top[0]]
            checks.append(_chk("Category says what most of your services are about", WARN,
                               f"{top[1]} of your {len(services)} services are about “{w}”, but your category “{primary}” does not say that."))
            fixes.append(_fix(f"Open the category picker and search “{w}”. If a category with that word describes your business, make it the primary category (keep “{primary}” as a secondary one if it is still true).",
                              "Google shows you for searches that match your categories. A category that leaves out what you mainly do hides you from those customers.", "high",
                              f"Search these words in Edit profile → Basics: {w}" + (f", {primary.lower()}" if primary else "")))
        else:
            checks.append(_chk("Category says what most of your services are about", OK, "Your categories use the main words of your services."))
    n = len(secondary)
    checks.append(_chk("Secondary categories (2 to 5 recommended)", OK if 2 <= n <= 9 else (BAD if n == 0 else WARN), f"{n} secondary categories." if n else "No secondary categories" + (" shown." if not connected else ".")))
    if n < 2:
        fixes.append(_fix("Add 2 to 5 secondary categories, one for each other real service you offer.", "Secondary categories let you appear for related searches.", "medium",
                          ("Ideas from your services: " + ", ".join(services[:5])) if services else None))
    if primary and any(_plain(c) == _plain(primary) for c in secondary):
        checks.append(_chk("No repeat of the primary category", WARN, "The primary category is also listed as a secondary one."))
        fixes.append(_fix("Remove the primary category from the secondary list.", "It counts once and wastes a slot.", "low"))
    theirs: dict[str, int] = {}
    for c in comps:
        cat = ((getattr(c, "listing", None) or {}).get("category") or "").strip()
        if cat:
            theirs[cat] = theirs.get(cat, 0) + 1
    if theirs and primary:
        top, cnt = max(theirs.items(), key=lambda kv: kv[1])
        same = _plain(top) == _plain(primary)
        checks.append(_chk("Same main category as nearby competitors", OK if same or cnt < 2 else WARN, f"{cnt} of {len(comps)} competitors use “{top}”."))
        if not same and cnt >= 2:
            fixes.append(_fix(f"Compare your primary category with “{top}”, which {cnt} competitors use. If it describes you, use it.", "Google matches searchers to the category most businesses like you use.", "medium"))
    tips: list[str] = []
    if primary and secondary and len(secondary) < 5:
        tips.append("You can list up to 9 secondary categories. Add every one that is a real part of your business, and no more.")
    sec = _section("categories", checks, fixes, [("Primary category", primary or "Not set"), ("Secondary categories", ", ".join(secondary) or "None")], "Google Business Profile" if connected else "Google Maps (public)")
    return _with_tips(sec, tips)


def name(b: Any, p: dict[str, Any] | None) -> dict[str, Any]:
    gname = ((p or {}).get("title") or b.name or "").strip()
    checks: list[dict[str, str]] = []
    fixes = _Fixes(checks)
    if not gname:
        return _section("name", [], [], [], "", False, "No name to check.")
    flagged = sorted({m.group(0).lower() for m in STUFFING.finditer(gname)})
    checks.append(_chk("No marketing words in the name", BAD if flagged else OK, ("Contains: " + ", ".join(flagged)) if flagged else "No keyword stuffing found."))
    city = (b.city or "").strip()
    area = (b.area or "").strip()
    has_place = [x for x in (city, area) if x and x.lower() in gname.lower()]
    checks.append(_chk("No city or area added to the name", WARN if has_place else OK, ("Contains: " + ", ".join(has_place)) if has_place else "The name does not carry a location."))
    checks.append(_chk("No phone number or web address in the name", BAD if (PHONE.search(gname) or URL.search(gname)) else OK, "A phone or web address is in the name." if (PHONE.search(gname) or URL.search(gname)) else "Clean."))
    caps = len(gname) > 6 and gname.upper() == gname
    odd = bool(re.search(r"[^\w\s&'’.,()\-|/]", gname, re.U))
    checks.append(_chk("Normal capitalisation and characters", WARN if (caps or odd) else OK, "ALL CAPS or special characters or emoji found." if (caps or odd) else "Looks normal."))
    checks.append(_chk("Length", WARN if len(gname) > 60 else OK, f"{len(gname)} characters."))
    mine = (b.name or "").strip()
    if p and mine and _plain(mine) != _plain(gname):
        checks.append(_chk("Same as the name in your project", WARN, f"Google: “{gname}”. Project: “{mine}”."))
        fixes.append(_fix("Make the Google name and your real signboard name identical.", "The same name everywhere builds trust in the listing.", "medium", f"Use: {mine}", apply={"name": mine}))
    if flagged or has_place or caps:
        clean = STUFFING.sub("", gname)
        for x in has_place:
            clean = re.sub(re.escape(x), "", clean, flags=re.I)
        clean = re.sub(r"\s*[-|,–]\s*(?=$)|\s{2,}", " ", clean).strip(" -|,–")
        if caps:
            clean = clean.title()
        fixes.append(_fix("Change the name to your real business name only, as on your signboard.", "Google’s rules forbid keywords or locations in the name, and it can suspend a listing that breaks them.", "high", f"Use: {clean or mine or gname}", apply={"name": clean or mine or gname}, check=_idx(checks, "marketing", "city", "capital", "phone")))
    sec = _section("name", checks, fixes, [("Business name", gname), ("Name in your project", (b.name or "").strip() if (b.name or "").strip() != gname else None)], "Google Business Profile" if b.gbp_location else "Google Maps (public)")
    if flagged or PHONE.search(gname) or URL.search(gname):
        sec["status"] = BAD  # breaking the name rules can get the listing suspended, whatever the other checks say
    return sec


def nap(b: Any, p: dict[str, Any] | None) -> dict[str, Any]:
    checks: list[dict[str, str]] = []
    fixes = _Fixes(checks)
    g_phone = (p or {}).get("phone") or b.phone
    g_addr = (p or {}).get("address") or b.address
    if not (g_phone or g_addr):
        return _section("nap", [], [], [], "", False, "No phone or address could be read.")
    checks.append(_chk("Phone shown on Google", OK if g_phone else BAD, g_phone or "No phone."))
    checks.append(_chk("Address shown on Google", OK if g_addr else BAD, g_addr or "No address."))
    if not g_phone:
        fixes.append(_fix("Add the phone number customers can call.", "Calls are the main action people take from the profile.", "high", go="contact"))
    if p and b.phone and p.get("phone"):
        same = _digits(b.phone) == _digits(p["phone"])
        checks.append(_chk("Phone: Google matches your project", OK if same else BAD, "Same number." if same else f"Google {p['phone']} / project {b.phone}."))
        if not same:
            fixes.append(_fix("Use one phone number on Google and in all your listings.", "Different numbers make Google unsure which one is right.", "high", f"Google: {p['phone']}  |  Project: {b.phone}"))
    if p and b.address and p.get("address"):
        a, c = _tokens(b.address), _tokens(p["address"])
        overlap = len(a & c) / max(1, len(a | c))
        checks.append(_chk("Address: Google matches your project", OK if overlap >= 0.6 else WARN, "Same address." if overlap >= 0.6 else f"Different wording. Google: {p['address']}"))
        if overlap < 0.6:
            fixes.append(_fix("Write the address in one exact format and use it everywhere.", "Small differences (Rd / Road, Floor / Flr) weaken the match between listings.", "medium", f"Google: {p['address']}  |  Project: {b.address}", go="location"))
    g_site = (p or {}).get("website") or b.website
    checks.append(_chk("Website link on the profile", OK if g_site else BAD, g_site or "No website link."))
    if not g_site:
        fixes.append(_fix("Add your website link to the profile.", "Customers and Google use it to confirm the business and visit your site.", "medium", go="contact"))
    return _section("nap", checks, fixes, [("Name", (p or {}).get("title") or b.name), ("Address", g_addr or "Not set"), ("Phone", g_phone or "Not set"), ("Website link", g_site or "Not set")], "Google Business Profile")


def description(b: Any, p: dict[str, Any] | None) -> dict[str, Any]:
    if not b.gbp_location:
        return _section("description", [], [], [], "Owner only", False, "Google does not share the owner’s description for profiles that are not connected. Connect the profile to audit it.")
    text = (b.description or "").strip()
    checks: list[dict[str, str]] = []
    fixes = _Fixes(checks)
    n = len(text)
    checks.append(_chk("Written (400 to 750 characters)", OK if 400 <= n <= 750 else WARN if n >= 150 else BAD, f"{n} of 750 characters." if n else "No description."))
    if n < 400:
        fixes.append(_fix("Write 400 to 750 characters: who you serve, what you do, where, and what makes you different.", "It is the one place to explain the business in your own words.", "high", _draft_description(b)))
    if n:
        head = text[:250].lower()
        cat = (b.primary_category or "").lower()
        checks.append(_chk("Main service in the first 250 characters", OK if cat and any(t in head for t in _tokens(cat)) else WARN, "The first lines say what you do." if cat and any(t in head for t in _tokens(cat)) else "Only the first 250 characters show before “more”; they do not name the main service."))
        loc = [x for x in (b.city, b.area) if x]
        named = any(_plain(x) in _plain(text) for x in loc)
        checks.append(_chk("Location named", OK if named else WARN, "City or area is named." if named else "No city or area in the text."))
        names = [s["name"] for s in _services(b)]
        used = [s for s in names if s.lower() in text.lower()]
        if names:
            checks.append(_chk("Services mentioned", OK if used else WARN, f"{len(used)} of your {len(names)} services appear." if used else "None of your services appear in the text."))
        checks.append(_chk("No links or phone numbers", BAD if (URL.search(text) or PHONE.search(text)) else OK, "Google’s rules do not allow links or phone numbers here." if (URL.search(text) or PHONE.search(text)) else "Clean."))
        promo = sorted({m.group(0).lower() for m in PROMO.finditer(text)})
        checks.append(_chk("No promotional claims", WARN if promo else OK, ("Found: " + ", ".join(promo)) if promo else "Factual wording."))
        if promo:
            fixes.append(_fix("Remove claims such as " + ", ".join(promo) + ". Describe facts instead.", "Google can reject promotional text.", "medium"))
        if not named and loc:
            fixes.append(_fix(f"Name {loc[0]} (and nearby areas) in the first two sentences.", "It ties the business to the places people search in.", "medium", check=_idx(checks, "location")))
    sec = _section("description", checks, fixes, [("Description", text or "No description written"), ("Length", f"{n} of 750 characters")], "Google Business Profile")
    tips = []
    if 0 < n < 650:
        tips.append(f"You have room for about {750 - n} more characters. Use them for the areas you serve, what makes you different, and a closing line that tells people to call or visit.")
    if n and not re.search(r"\b(call|visit|contact|book|message|whatsapp|enquir|inquir)\w*", text, re.I):
        tips.append("End the description with a short call to action, for example “Call us to book” or “Visit us today”.")
    return _with_tips(sec, tips)


def _draft_description(b: Any) -> str:
    names = [s["name"] for s in _services(b)][:4]
    cat = b.primary_category or "business"
    place = ", ".join(x for x in (b.area, b.city) if x)
    s = f"{b.name} is a {cat.lower()}" + (f" in {place}" if place else "") + "."
    if names:
        s += f" We offer {', '.join(names[:-1]) + ' and ' + names[-1] if len(names) > 1 else names[0]}."
    return (s + " [Add: who you serve, how long you have been open, and what makes you different.]")[:750]


def services(b: Any) -> dict[str, Any]:
    items = _services(b)
    prods = [x for x in (b.products or []) if isinstance(x, dict) and x.get("name")]
    if not b.gbp_location:
        return _section("services", [], [], [("Products kept in this app", len(prods))], "Owner only", False, "Google does not share the services list for profiles that are not connected. Connect the profile to audit it.")
    checks: list[dict[str, str]] = []
    fixes = _Fixes(checks)
    n = len(items)
    checks.append(_chk("Services listed (5 or more)", OK if n >= 5 else WARN if n >= 1 else BAD, f"{n} services." if n else "No services listed."))
    if n < 5:
        fixes.append(_fix("List every service you really offer, one by one.", "Each service is a search Google can match you to.", "high"))
    if n:
        with_desc = sum(1 for s in items if len((s.get("description") or "").strip()) >= 40)
        checks.append(_chk("Each service has a description", OK if with_desc == n else WARN if with_desc else BAD, f"{with_desc} of {n} have a description."))
        if with_desc < n:
            missing = [s["name"] for s in items if len((s.get("description") or "").strip()) < 40][:5]
            fixes.append(_fix("Write 1 to 2 sentences for each service (what it is, who it is for).", "Descriptions give Google and customers the detail.", "medium", "Missing for: " + ", ".join(missing)))
        priced = sum(1 for s in items if s.get("price") not in (None, ""))
        checks.append(_chk("Prices shown", OK if priced >= n / 2 else WARN, f"{priced} of {n} have a price."))
        if priced < n / 2:
            fixes.append(_fix("Add a price or a “from” price where you can.", "Profiles with prices get more qualified enquiries.", "low"))
    checks.append(_chk("Products tab filled (if you sell products)", OK if prods else WARN, f"{len(prods)} products." if prods else "No products stored."))
    sec = _section("services", checks, fixes, [("Services listed", f"{n}: " + ", ".join(x["name"] for x in items[:25]) + (f" and {n - 25} more" if n > 25 else "") if n else "None"), ("Products listed", len(prods) or "None")], "Google Business Profile")
    tips = []
    if n >= 5 and not prods:
        tips.append("If you sell things as well as services, fill the Products tab too: each product with a photo and a price gives you one more thing to appear for.")
    if any(len((x.get("description") or "")) > 280 for x in items):
        tips.append("Keep each service description to one or two clear sentences. Very long ones are cut off on the profile.")
    return _with_tips(sec, tips)


def reviews(b: Any, p: dict[str, Any] | None, rows: list[Any], comps: list[Any]) -> dict[str, Any]:
    rating = b.rating or (p or {}).get("rating")
    count = b.review_count or (p or {}).get("votes")
    if rating is None and not count:
        return _section("reviews", [], [], [], "", False, "No rating or reviews could be read.")
    checks: list[dict[str, str]] = []
    fixes = _Fixes(checks)
    checks.append(_chk("Average rating (4.5 or more is strong)", OK if (rating or 0) >= 4.5 else WARN if (rating or 0) >= 4.0 else BAD, f"{rating} stars." if rating else "No rating."))
    checks.append(_chk("Number of reviews", OK if (count or 0) >= 100 else WARN if (count or 0) >= 25 else BAD, f"{count or 0} reviews."))
    if (count or 0) < 100:
        fixes.append(_fix("Ask every happy customer for a review: put the review link on the bill and send it by WhatsApp after each job.", "Reviews are the strongest local signal you control.", "high",
                          "“Thank you for visiting us! If you were happy with the service, a quick review helps others find us: <your review link>”"))
    today = datetime.now(timezone.utc).date()

    def d_of(r: Any) -> date | None:
        return (r.review_at.date() if r.review_at else None) or r.review_date

    dated = [(r, d_of(r)) for r in rows]
    if rows:
        last90 = sum(1 for _, d in dated if d and (today - d).days <= 90)
        checks.append(_chk("New reviews in the last 90 days (10 or more)", OK if last90 >= 10 else WARN if last90 >= 3 else BAD, f"{last90} in 90 days."))
        if last90 < 10:
            fixes.append(_fix("Aim for at least one new review a week.", "Recent reviews show Google the business is active.", "high"))
        replied = sum(1 for r in rows if r.reply_text and r.reply_status == "posted") or sum(1 for r in rows if r.reply_text)
        rate = replied / len(rows)
        checks.append(_chk("Reply to reviews (90% or more)", OK if rate >= 0.9 else WARN if rate >= 0.5 else BAD, f"{round(rate * 100)}% of {len(rows)} reviews have a reply."))
        if rate < 0.9:
            fixes.append(_fix("Reply to every review, good and bad, within two days.", "Replies show customers and Google that you care, and they lift conversion.", "high",
                              "“Thank you, {name}! We are glad you liked {service}. See you again soon. – {your name}”"))
        low = [r for r in rows if (r.rating or 5) <= 2]
        unanswered = [r for r in low if not r.reply_text]
        if low:
            checks.append(_chk("Low-star reviews answered", OK if not unanswered else BAD, f"{len(unanswered)} of {len(low)} 1 to 2 star reviews have no reply."))
            if unanswered:
                fixes.append(_fix(f"Reply politely to the {len(unanswered)} unanswered low review{'s' if len(unanswered) != 1 else ''} and offer to put it right offline.", "Others read how you handle problems.", "high",
                                  "“We are sorry about your experience, {name}. Please call us on {phone} so we can put this right.”"))
        times = [(r.replied_at - r.review_at).total_seconds() / 86400 for r in rows if r.replied_at and r.review_at and r.review_at.date() >= today - timedelta(days=180) and r.replied_at >= r.review_at]
        if len(times) >= 3:
            med = sorted(times)[len(times) // 2]
            checks.append(_chk("Reply speed (within 2 days)", OK if med <= 2 else WARN, f"Median reply time {med:.1f} days."))
    else:
        checks.append(_chk("Reply rate and recency", NA, "Only a connected profile shows every review, so reply rate and recency were not read."))
    others = [c for c in comps if c.rating is not None and c.reviews is not None]
    if others and count is not None:
        avg = sum(c.reviews for c in others) / len(others)
        top = max(c.reviews for c in others)
        checks.append(_chk("Review count against competitors", OK if count >= avg else WARN, f"You: {count}. Competitors average {round(avg)}, the highest has {top}."))
        if count < avg:
            fixes.append(_fix(f"Competitors average {round(avg)} reviews and you have {count}: you need about {round(avg) - count} more to match them.", "Searchers compare review counts before they call.", "high"))
    now_found = [("Star rating", f"{rating} stars" if rating else "None yet"), ("Number of reviews", count or 0)]
    if rows:
        replied_n = sum(1 for r in rows if r.reply_text)
        now_found += [("Reviews in the last 90 days", sum(1 for _, d in dated if d and (today - d).days <= 90)), ("Reviews with a reply", f"{replied_n} of {len(rows)}")]
    if others and count is not None:
        now_found.append(("Competitors", f"average {round(sum(c.reviews for c in others) / len(others))} reviews, highest {max(c.reviews for c in others)}"))
    return _section("reviews", checks, fixes, now_found, "Google Business Profile" if rows else "Google Maps (public)")


def photos(b: Any, p: dict[str, Any] | None) -> dict[str, Any]:
    full = bool(b.gbp_location and b.photo_count is not None)
    n = b.photo_count if full else (p or {}).get("photos")
    if n is None:
        return _section("photos", [], [], [], "", False, "No photo count could be read.")
    checks: list[dict[str, str]] = []
    fixes = _Fixes(checks)
    if full:
        checks.append(_chk("Number of photos (100 or more is strong)", OK if n >= 100 else WARN if n >= 25 else BAD, f"{n} photos."))
    else:
        checks.append(_chk("Photos (Maps shows at most 10)", OK if n >= 10 else WARN if n >= 5 else BAD, f"{n} photos visible."))
    if n < (100 if full else 10):
        fixes.append(_fix("Add real photos every week: the outside of the place, the inside, your team, your work and your products.", "Profiles with many fresh photos get more calls and direction requests.", "high",
                          "Shot list: 1) signboard from the street  2) reception/inside  3) team at work  4) a finished job  5) products or menu  6) a happy customer (with consent)"))
    if b.gbp_location:
        checks.append(_chk("Logo set", OK if getattr(b, "logo", None) else WARN, "Logo is set." if getattr(b, "logo", None) else "No logo."))
        checks.append(_chk("Cover photo set", OK if b.cover_photo else WARN, "Cover photo is set." if b.cover_photo else "No cover photo."))
        if not b.cover_photo or not getattr(b, "logo", None):
            fixes.append(_fix("Set a logo and a cover photo.", "They are the first image customers see.", "medium", go="photos", check=_idx(checks, "logo", "cover")))
    checks.append(_chk("Videos", NA, "Google does not give the video count, so it was not checked."))
    sec = _section("photos", checks, fixes, [("Photos on the profile", f"{n}" + ("" if full else " (Maps shows at most 10)")), ("Logo", ("Set" if getattr(b, "logo", None) else "Not set") if b.gbp_location else None), ("Cover photo", ("Set" if b.cover_photo else "Not set") if b.gbp_location else None)], "Google Business Profile" if full else "Google Maps (public)")
    tips = ["Add a few short videos (a tour of the place, or your work being done): they get more attention than photos and Google shows them on the profile."]
    if full and n >= 100:
        tips.append("Keep adding 5 to 10 new photos a month so the profile always looks active.")
    return _with_tips(sec, tips)


def visibility(db: Session, b: Any, p: dict[str, Any] | None, kws: list[Any]) -> dict[str, Any]:
    checks: list[dict[str, str]] = []
    fixes = _Fixes(checks)
    target = [k for k in kws if k.keyword][:10]
    desc = (b.description or "").lower()
    svc = " ".join(s["name"].lower() for s in _services(b))
    if target:
        top = target[0].keyword
        checks.append(_chk("A target keyword is chosen", OK, f"{len(target)} tracked keywords. Main: “{top}”."))
        if b.gbp_location:
            in_desc = [k.keyword for k in target[:5] if k.keyword.lower() in desc]
            checks.append(_chk("Target keywords appear in the description", OK if in_desc else WARN, f"{len(in_desc)} of your top 5 appear." if in_desc else "None of your top keywords appears in the description."))
            if not in_desc:
                fixes.append(_fix("Work your top keywords into the description naturally (not repeated).", "Google uses the description to understand what you do.", "medium", "Top keywords: " + ", ".join(k.keyword for k in target[:5]), go="about"))
            in_svc = [k.keyword for k in target[:5] if _tokens(k.keyword) & _tokens(svc)]
            checks.append(_chk("Target keywords match your services", OK if in_svc else WARN, f"{len(in_svc)} match." if in_svc else "Your listed services do not use your keywords."))
        ranked = [k for k in target if k.rank]
        if ranked:
            top10 = sum(1 for k in ranked if k.rank <= 10)
            checks.append(_chk("Tracked keywords on page one", OK if top10 / len(ranked) >= 0.5 else WARN if top10 else BAD, f"{top10} of {len(ranked)} tracked keywords rank in the top 10."))
            if top10 / len(ranked) < 0.5:
                fixes.append(_fix("For each keyword that is not on page one, put it in your services and description, and ask happy customers to mention that service in their review.", "Google matches the profile to a search from its services, description and reviews.", "high", go="services"))
    else:
        checks.append(_chk("A target keyword is chosen", BAD, "No keywords are tracked for this project."))
        fixes.append(_fix("Choose your target keywords in My Keywords (the service plus your city, for example).", "Every other check depends on knowing which searches matter.", "high"))
    return _section("visibility", checks, fixes, [("Keywords you track", ", ".join(k.keyword for k in target[:8]) + (f" and {len(target) - 8} more" if len(target) > 8 else "") if target else "None"), ("Keywords in the top 10", f"{sum(1 for k in target if k.rank and k.rank <= 10)} of {sum(1 for k in target if k.rank)} ranked" if any(k.rank for k in target) else None)], "Your keywords + Maps rankings")


def _direction(dx: float, dy: float) -> str:
    v = "north" if dy > 0.35 else "south" if dy < -0.35 else ""
    h = "east" if dx > 0.35 else "west" if dx < -0.35 else ""
    return (v + ("-" if v and h else "") + h) or "centre"


def geogrid(b: Any, scans: list[Any], tracked: set[str] | None = None) -> dict[str, Any]:
    real = [s for s in scans if s.data_source != "sample"]
    hidden = 0
    if tracked is not None:  # only scans of keywords the person chose; scans the app made with its own keywords are not judged here
        hidden = sum(1 for s in real if s.keyword.lower() not in tracked)
        real = [s for s in real if s.keyword.lower() in tracked]
    if not real:
        msg = "No map rank scan has been run yet." if not scans else "The saved scans are sample data, not real results."
        if hidden:
            msg = f"No scan exists for a keyword you chose. {hidden} older scan{'s were' if hidden != 1 else ' was'} made with keywords the app picked itself, so {'they are' if hidden != 1 else 'it is'} not shown or scored."
        return _section("geogrid", [], [_fix("Choose your own target keyword in My Keywords, then scan it in Map Rank Tracker. Use “Write drafts with AI” for keyword ideas.", "The map ranking is only meaningful for a search your customers really make.", "high")], [], "Map Rank Tracker", False, msg)
    checks: list[dict[str, str]] = []
    fixes = _Fixes(checks)
    seen: set[str] = set()
    latest = []
    for s in real:  # newest first: one scan per keyword
        if s.keyword.lower() not in seen:
            seen.add(s.keyword.lower())
            latest.append(s)
    rivals: list[str] = []
    zone_done = False
    for s in latest[:3]:
        total = max(1, len(s.points or []) or s.grid_size ** 2)
        top3 = round(100 * (s.top3 or 0) / total)
        found = round(100 * (s.found or 0) / total)
        checks.append(_chk(f"“{s.keyword}”: top 3 on the map", OK if top3 >= 50 else WARN if top3 >= 20 else BAD, f"Top 3 at {top3}% of the {total} points; shown at {found}%. Average position {s.avg_rank if s.avg_rank is not None else '-'}."))
        weak: dict[str, int] = {}
        for pt in s.points or []:
            if not pt.get("rank") or pt["rank"] > 10:
                half = max(1, (s.grid_size - 1) / 2)
                weak_dir = _direction((pt.get("x", half) - half) / half, (half - pt.get("y", half)) / half)
                weak[weak_dir] = weak.get(weak_dir, 0) + 1
        if weak and top3 < 50 and not zone_done:
            zones = [d for d, n in sorted(weak.items(), key=lambda kv: -kv[1]) if d != "centre"][:3]
            if zones:
                zone_done = True
                fixes.append(_fix(f"For “{s.keyword}” you are weak to the {', '.join(zones)} of your location. Add a service-area page for each of those areas, get reviews that name them, and post about work done there.", "Ranking drops with distance; local pages and reviews carry you further out.", "high"))
        if found < 60:
            fixes.append(_fix(f"For “{s.keyword}” you do not appear at {100 - found}% of the points. Check the category and the keyword in your services and description.", "Google does not connect you to the search from those places.", "high"))
        if s.competitors:
            lead = min((c for c in s.competitors if c.get("avg_rank")), key=lambda c: c["avg_rank"], default=None)
            if lead and (s.avg_rank is None or lead["avg_rank"] < s.avg_rank):
                rivals.append(f"“{s.keyword}”: {lead['name']} (average position {lead['avg_rank']})")
    sec = _section("geogrid", checks, fixes, [(f"Scan: “{s.keyword}”", f"top 3 at {round(100 * (s.top3 or 0) / max(1, len(s.points or []) or s.grid_size ** 2))}% of points, shown at {round(100 * (s.found or 0) / max(1, len(s.points or []) or s.grid_size ** 2))}%, average position {s.avg_rank if s.avg_rank is not None else '-'}") for s in latest[:3]] + [("Strongest competitors", "; ".join(rivals))], "Map Rank Tracker (real Maps searches)")
    sec["maps"] = [_map_of(s, tracked) for s in latest[:3]]
    return sec


def _map_of(s: Any, tracked: set[str] | None = None) -> dict[str, Any]:
    """One scan as a picture: the grid of points with the position at each, and the plain-words reading of it."""
    pts = [{"x": int(p.get("x", 0)), "y": int(p.get("y", 0)), "rank": p.get("rank")} for p in (s.points or [])]
    total = max(1, len(pts))
    top3 = sum(1 for p in pts if p["rank"] and p["rank"] <= 3)
    mid = sum(1 for p in pts if p["rank"] and 3 < p["rank"] <= 10)
    low = sum(1 for p in pts if p["rank"] and p["rank"] > 10)
    none = total - top3 - mid - low
    if top3 / total >= 0.5:
        verdict = "Strong: customers in most of the area see you at the top."
    elif (top3 + mid) / total >= 0.5:
        verdict = "Visible but not on top: you appear in most places, but only a few at the top 3."
    elif none / total >= 0.5:
        verdict = "Weak: Google does not show you in more than half of the area."
    else:
        verdict = "Low: you appear in many places, but far down the list."
    return {"keyword": s.keyword, "source": "yours" if tracked and s.keyword.lower() in tracked else "app", "size": int(s.grid_size or 0), "radius_km": getattr(s, "radius_km", None), "points": pts, "total": total, "counts": {"top3": top3, "mid": mid, "low": low, "none": none},
            "avg_rank": s.avg_rank, "verdict": verdict, "scanned_at": s.created_at.isoformat() if getattr(s, "created_at", None) else None,
            "competitors": [{"name": c.get("name"), "avg_rank": c.get("avg_rank"), "top3": c.get("top3")} for c in (s.competitors or [])[:3]]}


# ---------------------------------------------------------------------------------------------------------------- the audit
def audit(db: Session, b: Any, fresh: bool = False) -> dict[str, Any]:
    from ..models import Competitor, Keyword, RankScan, Review
    p = _public(b, fresh)
    comps = list(db.scalars(select(Competitor).where(Competitor.business_id == b.id, Competitor.selected.is_not(False)).limit(15)))
    rows = list(db.scalars(select(Review).where(Review.business_id == b.id).order_by(Review.id.desc()).limit(500)))
    kws = list(db.scalars(select(Keyword).where(Keyword.business_id == b.id).order_by(Keyword.volume.desc().nullslast()).limit(20)))
    scans = list(db.scalars(select(RankScan).where(RankScan.business_id == b.id).order_by(RankScan.id.desc()).limit(12)))
    parts = [categories(b, p, comps), name(b, p), nap(b, p), description(b, p), services(b), reviews(b, p, rows, comps), photos(b, p), visibility(db, b, p, kws), geogrid(b, scans, {k.keyword.lower() for k in kws if getattr(k, "tracked", False)})]
    read = [x for x in parts if x["readable"] and x["score"] is not None]
    total_w = sum(x["weight"] for x in read)
    score = round(sum(x["score"] * x["weight"] for x in read) / total_w) if total_w else None
    order = {"high": 0, "medium": 1, "low": 2}
    for x in parts:  # every fix says where it is made; a fix that names no place uses its parameter's usual one
        for f in x["fixes"]:
            f["go"] = f.get("go") or _DEFAULT_GO.get(x["key"])
            t = TARGETS.get(f["go"] or "")
            f["where"], f["to"] = (t if t else (None, None))
    problems = []
    for x in parts:
        for c in x["checks"]:
            if c["status"] not in (BAD, WARN):
                continue
            low = c["label"].lower()
            go = next((g for word, g in _CHECK_GO if word in low), None) or _DEFAULT_GO.get(x["key"])
            if x["key"] in ("reviews", "photos", "geogrid"):
                go = _DEFAULT_GO[x["key"]] if not ("logo" in low or "cover" in low) else "photos"
            t = TARGETS.get(go or "")
            problems.append({"parameter": x["label"], "key": x["key"], "severity": c["status"], "title": c["label"], "detail": c["detail"], "gain": GAIN[x["key"]], "where": t[0] if t else None, "to": t[1] if t else None})
    problems.sort(key=lambda q: (0 if q["severity"] == BAD else 1))
    todo = [{**f, "parameter": x["label"], "key": x["key"]} for x in parts for f in x["fixes"]]
    todo.sort(key=lambda f: order.get(f["impact"], 3))
    return {"state": "ok", "score": score, "word": None if score is None else "Strong" if score >= 80 else "Fair" if score >= 55 else "Needs work",
            "connected": bool(b.gbp_location), "linked": bool(b.place_id), "places": bool(p), "parameters": parts, "problems": problems, "top_fixes": todo[:10],
            "not_read": [{"label": x["label"], "why": x["summary"]} for x in parts if not x["readable"]], "read_at": datetime.now(timezone.utc).isoformat(),
            "counts": {s: sum(1 for x in parts if x["status"] == s) for s in (OK, WARN, BAD, NA)}}


# ---------------------------------------------------------------------------------------------------------------- AI drafts
def _clean(text: Any, limit: int) -> str:
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    t = URL.sub("", t)
    t = PHONE.sub("", t)
    return re.sub(r"\s{2,}", " ", t)[:limit].strip()


def suggest(db: Session, b: Any) -> dict[str, Any]:
    """Drafts the person can paste into the profile. Written by AI from the facts below only, then cleaned in code (length, no links or phone numbers)."""
    from . import ai
    from ..models import Competitor, Keyword
    if not ai.is_configured():
        return {"state": "no_ai", "message": "AI is not set up, so drafts cannot be written. The audit and its fixes above do not need it."}
    kws = [k.keyword for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id).order_by(Keyword.volume.desc().nullslast()).limit(8))]
    from ..models import RankScan
    scanned = list(dict.fromkeys(r.keyword for r in db.scalars(select(RankScan).where(RankScan.business_id == b.id).order_by(RankScan.id.desc()).limit(10))))
    comps = [c.name for c in db.scalars(select(Competitor).where(Competitor.business_id == b.id).limit(5))]
    from ..db import release_connection  # noqa: PLC0415
    release_connection(db)  # the facts are read: no connection is held while the AI writes the drafts
    facts = {"name": b.name, "category": b.primary_category, "secondary_categories": b.secondary_categories or [], "city": b.city, "area": b.area,
             "services": [{"name": s["name"], "description": s.get("description") or "", "price": s.get("price")} for s in _services(b)][:12], "current_description": (b.description or "")[:750],
             "target_keywords": kws, "already_scanned": scanned, "nearby_competitors": comps}
    system = ("You write Google Business Profile copy for a local business. Use ONLY the facts given. Never invent awards, years in business, prices, certifications or claims. "
              "No links, no phone numbers, no promotional words such as best, cheapest, #1, guaranteed. Plain, factual, friendly English. Reply with one JSON object only.")
    user = ("Facts:\n" + str(facts) + "\n\nReturn JSON with exactly these keys:\n"
            "\"description\": 600 to 740 characters; the first 250 characters must say what the business is and where; mention up to 3 target keywords naturally;\n"
            "\"secondary_categories\": up to 5 real Google Business categories that fit the services, not repeating the primary one;\n"
            "\"service_descriptions\": [{\"name\": exact service name, \"description\": 1 to 2 sentences, max 280 characters}] for services that lack one;\n"
            "\"photo_ideas\": 8 short photo ideas specific to this business;\n"
            "\"review_request\": a short WhatsApp message asking a happy customer for a review (use the placeholder <review link>);\n"
            "\"reply_to_positive\" and \"reply_to_negative\": two short reply templates using the placeholders {name} and {phone};\n"
            "\"geo_keywords\": 8 phrases a real customer would type into Google Maps to find this business (service plus the city or a nearby area people actually search, no tiny neighbourhood names few people use), each as {\"keyword\": phrase, \"why\": one short reason}, not repeating the tracked or scanned keywords;\n"
            "\"keyword_placement\": [{\"keyword\": one target keyword, \"where\": where on the profile to use it}].")
    try:
        d = ai.complete_json(system, user, temperature=0.4, max_tokens=2200)
    except Exception as exc:  # noqa: BLE001
        return {"state": "error", "message": f"The AI could not write the drafts: {str(exc)[:160]}"}
    names = {s["name"].lower() for s in _services(b)}
    own_cat = _plain(b.primary_category)
    return {"state": "ok", "description": _clean(d.get("description"), 750),
            "secondary_categories": [str(c).strip()[:60] for c in (d.get("secondary_categories") or []) if str(c).strip() and _plain(c) != own_cat][:5],
            "service_descriptions": [{"name": str(x.get("name"))[:120], "description": _clean(x.get("description"), 300)} for x in (d.get("service_descriptions") or []) if isinstance(x, dict) and str(x.get("name") or "").lower() in names and x.get("description")][:12],
            "photo_ideas": [_clean(x, 140) for x in (d.get("photo_ideas") or [])][:8], "review_request": _clean(d.get("review_request"), 400),
            "reply_to_positive": _clean(d.get("reply_to_positive"), 400), "reply_to_negative": _clean(d.get("reply_to_negative"), 400),
            "keyword_placement": [{"keyword": _clean(x.get("keyword"), 80), "where": _clean(x.get("where"), 160)} for x in (d.get("keyword_placement") or []) if isinstance(x, dict)][:8],
            "geo_keywords": [{"keyword": _clean(x.get("keyword"), 80).lower(), "why": _clean(x.get("why"), 160)} for x in (d.get("geo_keywords") or []) if isinstance(x, dict) and x.get("keyword")
                             and _clean(x.get("keyword"), 80).lower() not in {k.lower() for k in [*kws, *scanned]}][:8],
            "written_by_ai": True}
