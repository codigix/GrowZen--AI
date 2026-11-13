"""What is not a competitor: the business's own website, and social, video, directory and link-in-bio pages (a competitor's Instagram is not a site to audit or compare)."""
from typing import Any
from urllib.parse import urlparse

from . import intel

LINK_HOSTS = {"linktr.ee", "linkin.bio", "beacons.ai", "bio.link", "carrd.co", "wa.me", "whatsapp.com", "bit.ly", "g.page", "goo.gl", "maps.app.goo.gl"}


def host_of(url: str | None) -> str:
    return intel.host_of(url if "//" in (url or "") else f"https://{url or ''}")


def skip_reason(business: Any, website: str | None) -> str | None:
    """Why this website must not be a competitor of `business`, or None when it can be."""
    host = host_of(website)
    if not host or "." not in host:
        return "It is not a website address."
    mine = host_of(getattr(business, "website", None))
    if mine and (host == mine or host.endswith(f".{mine}")):
        return "That is your own website."
    if intel.is_directory(host):
        return "That is a social network or directory page, not a competitor's own website."
    if host in LINK_HOSTS or any(host.endswith(f".{h}") for h in LINK_HOSTS):
        return "That is a link page, not a competitor's own website."
    return None


def invalid_rows(db: Any, business: Any) -> list[tuple[Any, str]]:
    from sqlalchemy import select

    from ..models import Competitor
    out = []
    for c in db.scalars(select(Competitor).where(Competitor.business_id == business.id)):
        why = skip_reason(business, c.website)
        if why:
            out.append((c, why))
    return out
