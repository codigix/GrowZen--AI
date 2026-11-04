"""Every business's website (paused ones excluded) becomes a backlink target. Reads the platform's businesses table (never changes it)."""
from sqlalchemy import select

from . import repository as repo
from . import slots
from .config import Settings
from .db import Database
from .urls import bare_host, is_blocked_host, normalize_url


def domain_targets(websites: list[str | None]) -> list[str]:
    """One 'https://domain/' per distinct website (a bare domain matches its subdomains too)."""
    domains: dict[str, str] = {}
    for website in websites:
        raw = (website or "").strip()
        norm = normalize_url(raw if "://" in raw else f"https://{raw}") if raw else None
        host = bare_host(norm) if norm else ""
        if "." in host and not is_blocked_host(host):
            domains.setdefault(host, f"https://{host}/")
    return list(domains.values())


def business_targets() -> list[str]:
    """The websites of all businesses that are not paused (onboarding leaves many in needs_approval, which is still a live client)."""
    from ..db import SessionLocal
    from ..models import Business

    with SessionLocal() as s:
        websites = list(s.scalars(select(Business.website).where(Business.status != "paused", Business.website.is_not(None))))
    return domain_targets(websites)


def sync(db: Database, settings: Settings) -> int:
    """Add new businesses as targets. With a single group, finished sites become due once for them (not once per
    business). With several groups the time slots decide when a business is searched, so nothing is reset here."""
    added = repo.add_targets(db, business_targets())
    if added and slots.plain_mode(len(repo.list_targets(db)), settings.slot_businesses, settings.slot_hours):
        repo.recrawl_all(db)
    return added
