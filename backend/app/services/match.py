"""Normalised contact details, so the same business is recognised across sources (email, Maps, imports)."""
import re
from urllib.parse import urlparse


def phone_digits(s: str | None) -> str:
    """The last 10 digits of a phone number (Indian mobile/landline without the country code)."""
    return re.sub(r"\D", "", s or "")[-10:]


def site_domain(url: str | None) -> str:
    """A website's host without "www." ("" for no URL)."""
    return urlparse(url if (url or "").startswith("http") else f"https://{url}").netloc.removeprefix("www.") if url else ""
