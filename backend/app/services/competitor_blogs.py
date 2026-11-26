"""Where a competitor publishes its blog: its own blog (and the article addresses on it) and the outside platforms it publishes on or links to (Medium, LinkedIn,
Blogger, WordPress.com, Substack...), read from the competitor's own pages. Each platform carries the page it was seen on, so every result is verified;
a platform that was looked for and not seen is listed separately as not found. Nothing is guessed.

The pages read: the home page, the blog page (a /blog, /news, /articles... link, or /blog itself) and the first few articles. One result per competitor domain is
kept for a week (public pages: the same for every project that watches that competitor)."""
from __future__ import annotations

import logging
import re
import threading
from app.services.fanout import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import DomainIntelCache
from . import backlink_checker as bc

log = logging.getLogger("seo.competitor_blogs")
CACHE_KEY, CACHE_TIER = "blog-platforms", "v1"
TTL = timedelta(days=7)
ARTICLES_READ = 3
_running: set[int] = set()  # business ids whose research is in progress
_lock = threading.Lock()

# host -> (name, kind). kind: publish = a place articles are published; social = a profile where posts are shared
PLATFORMS: dict[str, tuple[str, str]] = {
    "medium.com": ("Medium", "publish"), "blogger.com": ("Blogger", "publish"), "blogspot.com": ("Blogger", "publish"), "wordpress.com": ("WordPress.com", "publish"),
    "substack.com": ("Substack", "publish"), "tumblr.com": ("Tumblr", "publish"), "dev.to": ("DEV Community", "publish"), "hashnode.com": ("Hashnode", "publish"),
    "hashnode.dev": ("Hashnode", "publish"), "hubpages.com": ("HubPages", "publish"), "vocal.media": ("Vocal", "publish"), "ezinearticles.com": ("EzineArticles", "publish"),
    "issuu.com": ("Issuu", "publish"), "slideshare.net": ("SlideShare", "publish"), "scoop.it": ("Scoop.it", "publish"), "quora.com": ("Quora", "publish"),
    "reddit.com": ("Reddit", "publish"), "linkedin.com": ("LinkedIn", "social"), "facebook.com": ("Facebook", "social"), "x.com": ("X (Twitter)", "social"),
    "twitter.com": ("X (Twitter)", "social"), "instagram.com": ("Instagram", "social"), "youtube.com": ("YouTube", "social"), "pinterest.com": ("Pinterest", "social"),
    "flipboard.com": ("Flipboard", "publish"),
}
LOOKED_FOR = ["Medium", "LinkedIn", "Blogger", "WordPress.com", "Substack", "Quora", "Facebook", "X (Twitter)", "YouTube", "Pinterest"]
BLOG_PATH = re.compile(r"/(blogs?|news|articles?|insights|journal|resources|posts?|knowledge|learn|stories)(/|$)", re.I)
# an address on a platform that is one article (not a profile): medium.com/@x/slug, linkedin.com/pulse/slug, x.blogspot.com/2024/05/slug...
POST_PATH = re.compile(r"/pulse/|/p/[^/]+|/\d{4}/\d{2}/|/@[^/]+/[^/]+|/posts?/[^/]+|/(story|article|answer)s?/", re.I)


def platform_of(host: str) -> tuple[str, str] | None:
    h = (host or "").lower().removeprefix("www.")
    return next((v for d, v in PLATFORMS.items() if h == d or h.endswith("." + d)), None)


def _soup(url: str) -> tuple[BeautifulSoup | None, str]:
    status, html_, final, _ms, _err = bc._fetch(url)
    if not html_ or (status or 0) >= 400:
        return None, final or url
    return BeautifulSoup(html_, "html.parser"), final or url


def _clean(url: str) -> str:
    """The address without its #part and tracking parameters (utm_*, fbclid...); the query that names the page (?id=, ?v=) is kept."""
    from urllib.parse import parse_qsl, urlencode
    parts = urlsplit(url.split("#")[0])
    q = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not re.match(r"(utm_|fbclid|gclid|igsh|si$|ref$|ref_src)", k, re.I)]
    return parts._replace(query=urlencode(q)).geturl()


def _host(url: str) -> str:
    return (urlsplit(url).hostname or "").lower().removeprefix("www.")


def research(domain: str) -> dict[str, Any]:
    """Read the competitor's pages and return its blog, its article addresses and the outside platforms seen on its pages."""
    from .blog_promo import _is_article
    out: dict[str, Any] = {"domain": domain, "checked_at": datetime.now(timezone.utc).isoformat(), "reachable": False, "blog_url": None, "articles": [], "platforms": [], "not_found": []}
    home, home_url = _soup(f"https://{domain}/")
    if home is None:
        out["note"] = "The website could not be opened."
        out["not_found"] = LOOKED_FOR
        return out
    out["reachable"] = True
    me = _host(home_url)
    pages: list[tuple[str, BeautifulSoup]] = [(home_url, home)]

    def same_site(u: str) -> bool:
        h = _host(u)
        return h == me or h.endswith("." + me) or me.endswith("." + h)

    listing_url = next((urljoin(home_url, a["href"]).split("#")[0] for a in home.find_all("a", href=True)
                        if same_site(urljoin(home_url, a["href"])) and BLOG_PATH.search(urlsplit(urljoin(home_url, a["href"])).path)
                        and urlsplit(urljoin(home_url, a["href"])).path.rstrip("/").count("/") <= 1), None)
    listing, listing_final = _soup(listing_url or f"https://{domain}/blog/")
    if listing is not None and BLOG_PATH.search(urlsplit(listing_final).path):
        out["blog_url"] = listing_final
        pages.append((listing_final, listing))
    articles: list[str] = []
    for url, soup in list(pages):
        for a in soup.find_all("a", href=True):
            full = urljoin(url, a["href"]).split("#")[0]
            if same_site(full) and _is_article(full) and full.rstrip("/") != (out["blog_url"] or "").rstrip("/") and full not in articles:
                articles.append(full)
    out["articles"] = articles[:20]
    for art in articles[:ARTICLES_READ]:
        s, final = _soup(art)
        if s is not None:
            pages.append((final, s))
    found: dict[str, dict[str, Any]] = {}
    for url, soup in pages:
        for a in soup.find_all("a", href=True):
            full = urljoin(url, a["href"])
            p = platform_of(_host(full))
            if not p or not full.startswith("http"):
                continue
            name, kind = p
            post = bool(POST_PATH.search(urlsplit(full).path))
            row = found.setdefault(name, {"name": name, "kind": kind, "url": _clean(full), "seen_on": url, "posts": 0, "verified": True})
            if post:
                row["posts"] += 1
                if row["posts"] == 1:
                    row["url"], row["seen_on"] = _clean(full), url  # an article there is better evidence than a profile link
    for row in found.values():
        row["evidence"] = ("An article of theirs is published there" if row["posts"] else "Their website links to their page there")
    out["platforms"] = sorted(found.values(), key=lambda r: (r["kind"] != "publish", -r["posts"], r["name"]))
    out["not_found"] = [n for n in LOOKED_FOR if n not in found]
    return out


def cached(db: Session, domains: list[str]) -> dict[str, dict[str, Any]]:
    rows = db.scalars(select(DomainIntelCache).where(DomainIntelCache.domain.in_(domains or [""]), DomainIntelCache.key == CACHE_KEY, DomainIntelCache.tier == CACHE_TIER))
    return {r.domain: r.payload for r in rows}


def _save(db: Session, domain: str, payload: dict[str, Any]) -> None:
    row = db.scalar(select(DomainIntelCache).where(DomainIntelCache.domain == domain, DomainIntelCache.key == CACHE_KEY, DomainIntelCache.tier == CACHE_TIER))
    if row is None:
        row = DomainIntelCache(domain=domain, key=CACHE_KEY, tier=CACHE_TIER)
        db.add(row)
    row.payload, row.fetched_at = payload, datetime.now(timezone.utc)
    db.commit()


def is_running(business_id: int) -> bool:
    return business_id in _running


def start(business_id: int) -> bool:
    with _lock:
        if business_id in _running:
            return False
        _running.add(business_id)
        return True


def run(db: Session, business_id: int, domains: list[str], force: bool = False) -> None:
    """Research every competitor that has no fresh result (all of them when `force`), four at a time. Called in the background."""
    try:
        have = cached(db, domains)
        now = datetime.now(timezone.utc)

        def fresh(d: str) -> bool:
            at = (have.get(d) or {}).get("checked_at")
            return bool(at) and now - datetime.fromisoformat(at) < TTL

        todo = [d for d in domains if force or not fresh(d)]
        with ThreadPoolExecutor(max_workers=4) as pool:
            for d, res in zip(todo, pool.map(_safe_research, todo)):
                _save(db, d, res)
    finally:
        with _lock:
            _running.discard(business_id)


def _safe_research(domain: str) -> dict[str, Any]:
    try:
        return research(domain)
    except Exception as exc:  # noqa: BLE001 - one unreadable competitor must not stop the others
        log.warning("competitor blog research failed for %s: %s", domain, exc)
        return {"domain": domain, "checked_at": datetime.now(timezone.utc).isoformat(), "reachable": False, "blog_url": None, "articles": [], "platforms": [],
                "not_found": LOOKED_FOR, "note": "The website could not be read."}
