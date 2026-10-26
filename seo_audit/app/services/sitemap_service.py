"""Discovers a website's pages via its sitemap.xml (and any sitemap index
files it references) so a whole site can be audited in one request instead
of one URL at a time.

All fetches go through the SSRF-safe transport (DNS resolved + validated,
pinned per-hop against rebinding) since, unlike the PageSpeed engine, this
server is the one making the HTTP request directly.
"""
from __future__ import annotations

import logging
from urllib.parse import urljoin, urlsplit
from xml.etree import ElementTree

import httpx

from app.security.url_validation import (
    AsyncSSRFSafeTransport,
    SSRFValidationError,
    resolve_and_validate,
)

logger = logging.getLogger("lighthouse_app.sitemap_service")

_MAX_SITEMAP_FILES = 10  # cap how many sitemap/sitemap-index files we'll follow
_FETCH_TIMEOUT_SECONDS = 20
_XML_NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}


class SitemapDiscoveryError(Exception):
    """Raised when no pages could be discovered for a site."""


async def discover_site_urls(
    base_url: str, max_pages: int, *, client: httpx.AsyncClient | None = None
) -> list[str]:
    """Return up to ``max_pages`` same-origin URLs discovered from the
    site's sitemap.xml (following robots.txt's ``Sitemap:`` directive and
    nested sitemap-index files). Raises :class:`SitemapDiscoveryError` if
    none could be found.

    ``client`` is exposed purely for testing (to inject a mocked transport);
    production code should leave it unset so the SSRF-safe, DNS-pinning
    transport is always used.
    """
    validated = resolve_and_validate(base_url)
    origin = f"{validated.scheme}://{validated.hostname}" + (
        f":{validated.port}" if validated.port not in (80, 443) else ""
    )

    candidate_sitemap_urls = [urljoin(origin + "/", "sitemap.xml")]

    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient(
            transport=AsyncSSRFSafeTransport(),
            timeout=_FETCH_TIMEOUT_SECONDS,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; LighthouseAuditTool/1.0)"},
        )
    try:
        robots_sitemaps = await _sitemaps_from_robots(client, origin)
        for sm in robots_sitemaps:
            if sm not in candidate_sitemap_urls:
                candidate_sitemap_urls.append(sm)

        discovered: list[str] = []
        seen_sitemap_files: set[str] = set()
        queue = list(candidate_sitemap_urls)

        while queue and len(seen_sitemap_files) < _MAX_SITEMAP_FILES and len(discovered) < max_pages:
            sitemap_url = queue.pop(0)
            if sitemap_url in seen_sitemap_files:
                continue
            seen_sitemap_files.add(sitemap_url)

            try:
                xml_bytes = await _fetch(client, sitemap_url)
            except (httpx.HTTPError, SSRFValidationError) as exc:
                logger.info("Could not fetch sitemap candidate %s: %s", sitemap_url, exc)
                continue
            if xml_bytes is None:
                continue

            try:
                root = ElementTree.fromstring(xml_bytes)
            except ElementTree.ParseError:
                continue

            tag = root.tag.lower()
            if tag.endswith("sitemapindex"):
                for loc in root.findall("sm:sitemap/sm:loc", _XML_NS) or root.findall(".//{*}sitemap/{*}loc"):
                    if loc.text:
                        queue.append(loc.text.strip())
            elif tag.endswith("urlset"):
                for loc in root.findall("sm:url/sm:loc", _XML_NS) or root.findall(".//{*}url/{*}loc"):
                    if not loc.text:
                        continue
                    page_url = loc.text.strip()
                    if _is_same_origin(page_url, validated.hostname) and page_url not in discovered:
                        discovered.append(page_url)
                        if len(discovered) >= max_pages:
                            break
    finally:
        if owns_client:
            await client.aclose()

    if not discovered:
        raise SitemapDiscoveryError(
            f"No sitemap could be found or parsed for {origin} (tried /sitemap.xml and "
            "robots.txt's Sitemap: directive). Submit individual page URLs instead, or "
            "add a sitemap.xml to the site."
        )

    return discovered[:max_pages]


async def _sitemaps_from_robots(client: httpx.AsyncClient, origin: str) -> list[str]:
    robots_url = urljoin(origin + "/", "robots.txt")
    try:
        body = await _fetch(client, robots_url)
    except (httpx.HTTPError, SSRFValidationError):
        return []
    if body is None:
        return []
    sitemaps = []
    for line in body.decode("utf-8", errors="replace").splitlines():
        if line.lower().startswith("sitemap:"):
            sitemaps.append(line.split(":", 1)[1].strip())
    return sitemaps


async def _fetch(client: httpx.AsyncClient, url: str) -> bytes | None:
    response = await client.get(url)
    if response.status_code != 200:
        return None
    return response.content


def _is_same_origin(url: str, expected_hostname: str) -> bool:
    try:
        hostname = urlsplit(url).hostname
    except ValueError:
        return False
    return hostname is not None and hostname.lower() == expected_hostname.lower()
