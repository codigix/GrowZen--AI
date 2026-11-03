import asyncio
import logging
from collections import deque
from dataclasses import dataclass, field
from typing import Awaitable, Callable
from urllib.parse import urlsplit

from .extract import ParsedPage, parse_page
from .fetcher import FetchError, Fetcher, RobotsUnreachable, Skip
from .urls import TargetMatcher, bare_host, has_skipped_extension, is_blocked_host, page_key, site_key

log = logging.getLogger("backlink_service")

NOFOLLOW_RELS = {"nofollow", "sponsored", "ugc"}


@dataclass
class SiteResult:
    pages: int = 0
    backlinks: int = 0
    error: str | None = None
    external_urls: dict[str, str] = field(default_factory=dict)  # site_key -> a URL on that site (new seed candidates)


def _clean(value):
    """PostgreSQL refuses NUL characters in text; a page that contains one must not lose its backlinks."""
    if isinstance(value, str):
        return value.replace("\x00", "")
    if isinstance(value, list):
        return [_clean(v) for v in value]
    return value


def backlink_row(page: ParsedPage, link, depth: int) -> dict:
    nofollow = page.nofollow or bool(NOFOLLOW_RELS & set(link.rel))
    return {k: _clean(v) for k, v in {
        "source_url": page.url,
        "source_site": site_key(urlsplit(page.url).hostname or ""),
        "source_title": page.title,
        "target_url": link.url,
        "target_key": page_key(link.url),  # www / non-www and trailing slash are the same page
        "target_host": bare_host(link.url),
        "target_site": site_key(urlsplit(link.url).hostname or ""),
        "anchor_text": link.anchor,
        "context": link.get_context(),
        "found_in": link.found_in,
        "link_type": "nofollow" if nofollow else "dofollow",
        "rel": link.rel,
        "crawl_depth": depth,
    }.items()}


def index_matchers(matchers: list[TargetMatcher]) -> dict[str, list[TargetMatcher]]:
    """Targets grouped by website, so a link is only compared with the targets of its own site (not all of them)."""
    index: dict[str, list[TargetMatcher]] = {}
    for m in matchers:
        index.setdefault(site_key(m.domain), []).append(m)
    return index


def page_backlinks(page: ParsedPage, matchers: list[TargetMatcher] | dict, depth: int) -> list[dict]:
    """Links of this page that point at any target. Pages on the target's own site never count."""
    index = matchers if isinstance(matchers, dict) else index_matchers(matchers)
    rows = []
    for link in page.links:
        for m in index.get(site_key(urlsplit(link.url).hostname or ""), ()):
            if m.matches(link.url) and not m.is_target_site(page.url):
                rows.append(backlink_row(page, link, depth))
                break
    return rows


async def crawl_site(fetcher: Fetcher, start_url: str, page_limit: int, max_depth: int,
                     matchers: list[TargetMatcher], save: Callable[[list[dict]], Awaitable[None]],
                     say: Callable[[str], None] = lambda msg: None, max_queue: int = 20_000,
                     max_query_variants: int = 5) -> SiteResult:
    """Breadth-first read of one website. Backlinks to any target are saved page by page;
    links to other sites are only collected (they become seeds of their own)."""
    result = SiteResult()
    index = index_matchers(matchers)
    site = site_key(urlsplit(start_url).hostname or "")
    queue = deque([(start_url, 0)])
    seen = {start_url}
    read: set[str] = set()          # final URLs already read (a redirect can lead to a page that was queued too)
    variants: dict[str, int] = {}   # path -> how many ?query variants were queued
    last_error = None
    while queue and result.pages < page_limit:
        url, depth = queue.popleft()
        try:
            fetched = await fetcher.fetch(url)
        except RobotsUnreachable as exc:
            result.error = str(exc)  # nothing on this origin can be read now: stop, retry the site later
            break
        except Skip as exc:
            last_error = f"{url}: {exc}"  # shown as the reason when not a single page could be read
            say(f"SKIP   {url} ({exc})")
            continue
        except FetchError as exc:
            last_error = f"{url}: {exc}"
            say(f"FAILED {url} ({exc})")
            continue
        if site_key(urlsplit(fetched.url).hostname or "") != site:
            last_error = f"{url}: redirects to another website ({fetched.url})"
            continue  # the page redirected to another website
        if fetched.url in read:
            continue
        read.add(fetched.url)
        result.pages += 1
        try:
            page = await asyncio.to_thread(parse_page, fetched.url, fetched.html, fetched.nofollow)  # off the event loop
        except Exception as exc:  # malformed markup must not kill the crawl
            last_error = f"{url}: parse error {exc!r}"
            continue
        say(f"OK     {page.url} ({result.pages}/{page_limit}, queue={len(queue)})")

        rows = page_backlinks(page, index, depth)
        if rows:
            try:
                await save(rows)
            except Exception as exc:  # one page that cannot be saved must not cost the rest of the site
                last_error = f"{url}: could not save backlinks: {exc}"
                log.warning("%s", last_error)
            else:
                result.backlinks += len(rows)
                for r in rows:
                    say(f"  >>> BACKLINK {r['source_url']} -> {r['target_url']} (anchor={r['anchor_text']!r})")

        for link in page.links:
            host = urlsplit(link.url).hostname or ""
            key = site_key(host)
            if key == site:
                if (not page.nofollow and depth < max_depth and link.url not in seen and len(queue) < max_queue
                        and not has_skipped_extension(link.url)):
                    parts = urlsplit(link.url)
                    if parts.query:
                        if variants.get(parts.path, 0) >= max_query_variants:
                            continue
                        variants[parts.path] = variants.get(parts.path, 0) + 1
                    seen.add(link.url)
                    queue.append((link.url, depth + 1))
            elif not is_blocked_host(host):
                result.external_urls.setdefault(key, link.url)
    if result.pages == 0 and not result.error:
        result.error = last_error or "no page could be read"
    return result
