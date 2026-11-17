"""Keeps two websites of one owner apart (for example codigix.co and codigixinfotech.com).

Every project owns exactly one website, and nothing read from another website, another project's Google profile or a listing that belongs to a sister site
may be added to it. Hosts are compared whole, never as text inside text: "codigix.co" is not "codigix.com", and a page that shows another project's website
is not this project's page.
"""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session


def host_of(url: str | None) -> str:
    u = (url or "").strip()
    if not u:
        return ""
    h = (urlsplit(u if "://" in u else f"//{u}").hostname or "").lower().rstrip(".")
    return h[4:] if h.startswith("www.") else h


def same_host(a: str | None, b: str | None) -> bool:
    """The same website: equal hosts, www ignored. A subdomain is a different host."""
    x, y = host_of(a), host_of(b)
    return bool(x) and x == y


def belongs_to(url: str | None, website: str | None) -> bool:
    """The address is on the website or one of its subdomains (blog.example.com is on example.com; example.com.evil.io and notexample.com are not)."""
    h, w = host_of(url), host_of(website)
    return bool(h) and bool(w) and (h == w or h.endswith("." + w))


def mentions_host(text: str | None, host: str | None) -> bool:
    """The text shows this host as a whole address: "codigix.co" is not found inside "codigix.com" or "notcodigix.co"."""
    h = host_of(host)
    if not h:
        return False
    return re.search(rf"(?<![a-z0-9-]){re.escape(h)}(?![a-z0-9-]|\.[a-z0-9])", (text or "").lower()) is not None


def sibling_hosts(db: Session | None, b: Any) -> list[str]:
    """The websites of the owner's other projects."""
    if db is None or getattr(b, "id", None) is None:
        return []
    from ..models import Business
    q = select(Business.website).where(Business.id != b.id, Business.website.is_not(None))
    if getattr(b, "owner_id", None) is not None:
        q = q.where(Business.owner_id == b.owner_id)
    me = host_of(getattr(b, "website", None))
    return list(dict.fromkeys(h for h in (host_of(w) for w in db.scalars(q)) if h and h != me))


def website_taken(db: Session, owner_id: Any, website: str | None, except_id: int | None = None) -> str | None:
    """The name of the owner's other project that already has this website, or None."""
    h = host_of(website)
    if not h:
        return None
    from ..models import Business
    q = select(Business).where(Business.website.is_not(None))
    if owner_id is not None:
        q = q.where(Business.owner_id == owner_id)
    for o in db.scalars(q):
        if o.id != except_id and same_host(o.website, h):
            return o.name
    return None


def profile_conflict(b: Any, profile_website: str | None) -> str | None:
    """Why a Google profile must not be read into this project: its website is a different one. None when it fits or when either side has no website."""
    mine, theirs = host_of(getattr(b, "website", None)), host_of(profile_website)
    if not mine or not theirs or ".grexa.site" in theirs:
        return None
    if mine == theirs or theirs.endswith("." + mine) or mine.endswith("." + theirs):
        return None
    return (f"This Google profile belongs to {theirs}, but this project is {mine}. Its services, reviews and details were not brought in, so the two websites stay apart. "
            "Link the profile that belongs to this website, or change the project's website if it moved.")
