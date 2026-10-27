"""Finds a site's pages from its sitemap.xml (and robots.txt's Sitemap: lines and nested sitemap
indexes) so a whole site can be Lighthouse-audited in one request.

Every fetch goes through the SSRF-safe transport (DNS validated and pinned on each hop), since this
server makes the requests itself.
"""
import logging
from urllib.parse import urljoin, urlsplit
from xml.etree import ElementTree

import httpx

from .url_safety import SSRFSafeTransport, SSRFValidationError, resolve_and_validate

log = logging.getLogger("seo.sitemap")

MAX_SITEMAP_FILES = 10  # sitemap / sitemap-index files followed at most
FETCH_TIMEOUT_SECONDS = 20
_NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}


class SitemapDiscoveryError(Exception):
    """No pages could be found for the site."""


def discover_site_urls(base_url: str, max_pages: int, *, client: httpx.Client | None = None) -> list[str]:
    """Up to max_pages same-host URLs from the site's sitemaps. `client` is for tests only; leave it
    unset so the SSRF-safe transport is always used."""
    validated = resolve_and_validate(base_url)
    origin = f"{validated.scheme}://{validated.hostname}" + (f":{validated.port}" if validated.port not in (80, 443) else "")
    candidates = [urljoin(origin + "/", "sitemap.xml")]

    owns_client = client is None
    if client is None:
        client = httpx.Client(transport=SSRFSafeTransport(), timeout=FETCH_TIMEOUT_SECONDS, follow_redirects=True,
                              headers={"User-Agent": "Mozilla/5.0 (compatible; CodigixSEOAuditBot/1.0; +https://codigixinfotech.com)"})
    discovered: list[str] = []
    try:
        for sm in _sitemaps_from_robots(client, origin):
            if sm not in candidates:
                candidates.append(sm)
        seen: set[str] = set()
        queue = list(candidates)
        while queue and len(seen) < MAX_SITEMAP_FILES and len(discovered) < max_pages:
            sitemap_url = queue.pop(0)
            if sitemap_url in seen:
                continue
            seen.add(sitemap_url)
            try:
                xml = _fetch(client, sitemap_url)
            except (httpx.HTTPError, SSRFValidationError) as exc:
                log.info("Could not fetch sitemap candidate %s: %s", sitemap_url, exc)
                continue
            if xml is None:
                continue
            try:
                root = ElementTree.fromstring(xml)
            except ElementTree.ParseError:
                continue
            tag = root.tag.lower()
            if tag.endswith("sitemapindex"):
                for loc in root.findall("sm:sitemap/sm:loc", _NS) or root.findall(".//{*}sitemap/{*}loc"):
                    if loc.text:
                        queue.append(loc.text.strip())
            elif tag.endswith("urlset"):
                for loc in root.findall("sm:url/sm:loc", _NS) or root.findall(".//{*}url/{*}loc"):
                    page = (loc.text or "").strip()
                    if page and _same_host(page, validated.hostname) and page not in discovered:
                        discovered.append(page)
                        if len(discovered) >= max_pages:
                            break
    finally:
        if owns_client:
            client.close()

    if not discovered:
        raise SitemapDiscoveryError(f"No sitemap could be found or parsed for {origin} (tried /sitemap.xml and robots.txt's "
                                    "Sitemap: directive). Submit individual page URLs instead, or add a sitemap.xml to the site.")
    return discovered[:max_pages]


def _sitemaps_from_robots(client: httpx.Client, origin: str) -> list[str]:
    try:
        body = _fetch(client, urljoin(origin + "/", "robots.txt"))
    except (httpx.HTTPError, SSRFValidationError):
        return []
    if body is None:
        return []
    return [line.split(":", 1)[1].strip() for line in body.decode("utf-8", errors="replace").splitlines() if line.lower().startswith("sitemap:")]


def _fetch(client: httpx.Client, url: str) -> bytes | None:
    r = client.get(url)
    return r.content if r.status_code == 200 else None


def _same_host(url: str, hostname: str) -> bool:
    try:
        host = urlsplit(url).hostname
    except ValueError:
        return False
    return host is not None and host.lower() == hostname.lower()
