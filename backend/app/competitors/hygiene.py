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


def real_competitor_domains(business: Any, domains: list[str]) -> list[str]:
    """Only the domains that can be competitors: never the business itself or a social, video, directory or link page. A link-graph read for instagram.com or youtube.com
    counts hundreds of thousands of links and runs for minutes, and says nothing about a competitor."""
    return [d for d in domains if not skip_reason(business, d)]


def invalid_targets(db: Any, business: Any) -> list[tuple[str, str]]:
    """Competitor targets already tracked in Backlink Intelligence that are not competitors (a tracked instagram.com makes every link-gap read count hundreds of thousands of links)."""
    from sqlalchemy import select

    from ..backlinks.models import BiTrackedTarget
    out = []
    for t in db.scalars(select(BiTrackedTarget).where(BiTrackedTarget.business_id == business.id, BiTrackedTarget.is_competitor.is_(True))):
        why = skip_reason(business, t.domain)
        if why:
            out.append((t.domain, why))
    return out


def invalid_rows(db: Any, business: Any) -> list[tuple[Any, str]]:
    from sqlalchemy import select

    from ..models import Competitor
    out = []
    for c in db.scalars(select(Competitor).where(Competitor.business_id == business.id)):
        why = skip_reason(business, c.website)
        if why:
            out.append((c, why))
    return out
