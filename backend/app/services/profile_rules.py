"""Google's rules for the details of a Business Profile (support.google.com/business: "Guidelines for representing your business on Google" and "Edit your Business Profile"),
checked before anything is sent: a problem Google would reject or that risks the profile being suspended is told here, in plain words, next to the field.

Each issue is {field, level, message}. level "error": Google refuses it or it breaks a hard rule (the save is stopped). level "warn": allowed by the API but against the guidelines or
likely to be removed (the person is told, the save goes ahead)."""
import re
from typing import Any

DESCRIPTION_MAX = 750          # "Do not exceed 750 characters in the description field."
EXTRA_PHONES_MAX = 2           # a primary number plus up to 2 more
EXTRA_CATEGORIES_MAX = 9       # one primary category plus up to 9 more
SERVICE_NAME_MAX = 140
SERVICE_DESCRIPTION_MAX = 300

_URL_IN_TEXT = re.compile(r"(https?://|www\.)\S+|\b[\w-]+\.(?:com|in|net|org|co|io|app|store|shop)\b", re.I)
_HTML = re.compile(r"</?[a-z][^>]*>", re.I)
_PROMO = re.compile(r"\b(?:\d{1,3}\s?%\s*off|flat\s+\d+\s*%|sale|discount|offer|cheapest|lowest price|best price|free delivery|coupon|rs\.?\s?\d+|₹\s?\d+|\$\s?\d+)\b", re.I)
_HOURS_IN_NAME = re.compile(r"\b(?:open\s+24|24\s*/\s*7|24\s*hours?|open now|closed|mon-|monday|9\s*(?:am|to))\b", re.I)
_TAGLINE = re.compile(r"\s[|:–—]\s|\s-\s")
_THIRD_PARTY_ORDERING = re.compile(r"(?:swiggy|zomato|ubereats|doordash|grubhub|deliveroo|foodpanda|justeat)\.", re.I)
_LEGAL = re.compile(r"\b(?:pvt|private|ltd|limited|llp|inc|llc|corp)\b\.?", re.I)


def _issue(field: str, level: str, message: str) -> dict[str, str]:
    return {"field": field, "level": level, "message": message}


def _digits(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def phone_issues(phone: str | None, label: str = "phone") -> list[dict[str, str]]:
    t = (phone or "").strip()
    if not t:
        return []
    d = _digits(t)
    if re.search(r"[^\d+()\-\s.]", t) or not 7 <= len(d) <= 15:
        return [_issue(label, "error", "Enter a valid phone number: 7 to 15 digits, with the country code if you can (for example +91 98765 43210).")]
    out = []
    if not t.startswith("+") and t.lstrip("(").startswith("0") and len(d) >= 11:
        out.append(_issue(label, "warn", "This number starts with 0 as if dialled inside the country. Google shows and validates numbers best in international form, for example +91 91127 06604."))
    if re.fullmatch(r"(?:1800|1860|000)\d*", d) or d.startswith(("1800", "1860")):
        out.append(_issue(label, "warn", "A toll-free or central helpline number is not accepted by Google: use a local number the business controls directly."))
    return out


def url_issues(url: str | None, label: str) -> list[dict[str, str]]:
    t = (url or "").strip()
    if not t:
        return []
    if not re.match(r"^https?://[^\s/]+\.[^\s]+$", t, re.I):
        return [_issue(label, "error", "Enter the full link, starting with https:// (or http://).")]
    return []


def check(p: dict[str, Any]) -> list[dict[str, str]]:
    """All issues for the profile fields in `p` (the same keys the editor sends: name, description, phone, additional_phones, website, booking_url, action_links,
    secondary_categories, services)."""
    out: list[dict[str, str]] = []

    name = (p.get("name") or "").strip()
    if name:
        if _URL_IN_TEXT.search(name) or re.search(r"\d{5,}", name):
            out.append(_issue("name", "warn", "The name has a web address or phone number in it. Google only allows the real name on your signage."))
        if _HOURS_IN_NAME.search(name):
            out.append(_issue("name", "warn", "Opening hours do not belong in the name (for example “Open 24 hours”). Put them in Hours."))
        if "®" in name or "™" in name:
            out.append(_issue("name", "warn", "Leave out ® and ™: Google does not allow them in the name."))
        caps = [w for w in re.findall(r"[A-Za-z]{4,}", name) if w.isupper()]
        if len(caps) >= 2 or (caps and len(name.split()) == 1 and len(name) > 6):
            out.append(_issue("name", "warn", "Avoid ALL-CAPS words in the name unless that is exactly how your signage writes it (only acronyms are fine)."))
        if _TAGLINE.search(name):
            out.append(_issue("name", "warn", "The name looks like it has a tagline or extra words after a dash or bar. Google only allows the name on your signage: no services, slogans or locations."))
        if len(name) > 70:
            out.append(_issue("name", "warn", f"The name is {len(name)} characters. Real names are short: extra words risk the profile being flagged."))

    desc = p.get("description") or ""
    if desc:
        if len(desc) > DESCRIPTION_MAX:
            out.append(_issue("description", "error", f"The description is {len(desc)} characters. Google allows at most {DESCRIPTION_MAX}."))
        if _HTML.search(desc):
            out.append(_issue("description", "error", "The description cannot contain HTML code."))
        if _URL_IN_TEXT.search(desc):
            out.append(_issue("description", "error", "The description cannot contain links or web addresses of any kind."))
        if re.search(r"\*\*|__|^#{1,6}\s|^\s*[-*]\s", desc, re.M):
            out.append(_issue("description", "warn", "Formatting marks such as ** or # would show as stray symbols: they are removed when you save."))
        if _PROMO.search(desc):
            out.append(_issue("description", "warn", "Promotions, prices and discounts do not belong in the description. Use an Offer post for those."))
        if re.search(r"(?:\+?\d[\d\s().-]{8,}\d)", desc):
            out.append(_issue("description", "warn", "Leave phone numbers out of the description: they have their own field."))
        if 0 < len(desc) < 250:
            out.append(_issue("description", "warn", f"The description is {len(desc)} characters. 250 to 750 describes the business well."))

    out += phone_issues(p.get("phone"), "phone")
    extra = [x for x in (p.get("additional_phones") or []) if (x or "").strip()]
    if len(extra) > EXTRA_PHONES_MAX:
        out.append(_issue("additional_phones", "error", f"Google allows a main number and {EXTRA_PHONES_MAX} more: you have {len(extra)} extra numbers."))
    main_d = _digits(p.get("phone") or "")
    seen: set[str] = set()
    for x in extra:
        out += phone_issues(x, "additional_phones")
        d = _digits(x)
        if d and (d == main_d or d in seen):
            out.append(_issue("additional_phones", "error", f"{x.strip()} is listed twice."))
        seen.add(d)

    out += url_issues(p.get("website"), "website")
    out += url_issues(p.get("booking_url"), "booking_url")
    site = (p.get("website") or "").strip().rstrip("/")
    for link in p.get("action_links") or []:
        u = (link.get("url") or "").strip()
        out += url_issues(u, "action_links")
        if u and _THIRD_PARTY_ORDERING.search(u):
            out.append(_issue("action_links", "warn", "Google does not accept a direct link to a third-party ordering or delivery service: link to your own order page."))
        if u and site and u.rstrip("/") == site:
            out.append(_issue("action_links", "warn", "This link is just your home page. Google refuses a booking or order button unless it opens a real booking or order page."))
    booking = (p.get("booking_url") or "").strip()
    if booking and site and booking.rstrip("/") == site:
        out.append(_issue("booking_url", "warn", "This is just your home page. Google refuses a booking link unless it opens a real booking page."))

    cats = [c for c in (p.get("secondary_categories") or []) if c]
    if len(cats) > EXTRA_CATEGORIES_MAX:
        out.append(_issue("secondary_categories", "error", f"Google allows a primary category and {EXTRA_CATEGORIES_MAX} more: you have {len(cats)} extra categories."))
    elif len(cats) > 4:
        out.append(_issue("secondary_categories", "warn", "Use the fewest categories that describe the core business: extra ones that are not the main business can hurt ranking."))

    names: set[str] = set()
    for s in p.get("services") or []:
        n = (s.get("name") or "").strip()
        if not n:
            continue
        label = f"Service “{n[:30]}”"
        if len(n) > SERVICE_NAME_MAX:
            out.append(_issue("services", "error", f"{label}: the name is {len(n)} characters (limit {SERVICE_NAME_MAX})."))
        if len(s.get("description") or "") > SERVICE_DESCRIPTION_MAX:
            out.append(_issue("services", "error", f"{label}: the description is over {SERVICE_DESCRIPTION_MAX} characters."))
        if _URL_IN_TEXT.search(n) or _URL_IN_TEXT.search(s.get("description") or ""):
            out.append(_issue("services", "warn", f"{label}: leave web addresses out of services."))
        price = str(s.get("price") or "").strip()
        if price and not re.fullmatch(r"[^\d]{0,4}\s?\d[\d,]*(?:\.\d+)?\s?[^\d]{0,6}", price):
            out.append(_issue("services", "warn", f"{label}: write the price as a plain number (for example 2000)."))
        if n.lower() in names:
            out.append(_issue("services", "warn", f"{label} is listed twice."))
        names.add(n.lower())
    return out


def errors(issues: list[dict[str, str]]) -> list[dict[str, str]]:
    return [i for i in issues if i["level"] == "error"]
