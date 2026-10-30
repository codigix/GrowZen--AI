"""Normalised contact details, so the same business is recognised across sources (email, Maps, imports)."""
import re
from urllib.parse import urlparse


def phone_digits(s: str | None) -> str:
    """The last 10 digits of a phone number (Indian mobile/landline without the country code)."""
    return re.sub(r"\D", "", s or "")[-10:]


def site_domain(url: str | None) -> str:
    """A website's host without "www." ("" for no URL)."""
    return urlparse(url if (url or "").startswith("http") else f"https://{url}").netloc.removeprefix("www.") if url else ""


# Words that say what a business is, not which one it is.
_GENERIC = {"the", "and", "of", "pvt", "ltd", "private", "limited", "llp", "inc", "co", "company", "clinic", "hospital", "centre", "center",
            "care", "services", "service", "multispeciality", "multi", "speciality", "specialty", "solutions", "group", "india", "intl", "international"}


def name_words(name: str | None) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", (name or "").lower()) if len(w) >= 3 and w not in _GENERIC}


def same_name(a: str | None, b: str | None) -> bool:
    """Whether two names are the same business: most of the distinctive words in common ("Skin 101" vs
    "Skin 101 Clinic" yes; "Wadi Al-Lawami Nursery" vs "Moraya Hospital" no)."""
    x, y = name_words(a), name_words(b)
    if not x or not y:
        return re.sub(r"[^a-z0-9]", "", (a or "").lower()) == re.sub(r"[^a-z0-9]", "", (b or "").lower()) != ""
    return len(x & y) / min(len(x), len(y)) >= 0.66


def is_same_business(existing, place_id: str | None, name: str | None, phone: str | None, website: str | None) -> bool:
    """An existing project is the same business only if the Google place matches, or the phone / website
    matches AND the names agree. Two different Google places are never the same business, and a shared
    phone or website alone (a group number, an agency's site, a typo) is not enough."""
    if place_id and existing.place_id:
        return place_id == existing.place_id
    from .countries import same_phone  # noqa: PLC0415 - countries imports nothing from here; kept local for clarity
    contact = same_phone(phone, existing.phone, getattr(existing, "country", None)) \
        or (site_domain(website) and site_domain(existing.website) == site_domain(website))
    return bool(contact) and same_name(name, existing.name)
