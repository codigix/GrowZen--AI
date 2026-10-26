from __future__ import annotations

import httpx
import pytest
import respx

from app.security.url_validation import SSRFValidationError
from app.services.sitemap_service import SitemapDiscoveryError, discover_site_urls

URLSET_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/about</loc></url>
  <url><loc>https://example.com/contact</loc></url>
  <url><loc>https://not-example.com/evil</loc></url>
</urlset>"""

SITEMAP_INDEX_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
</sitemapindex>"""


def _plain_client() -> httpx.AsyncClient:
    # Sitemap discovery normally fetches through the SSRF-safe, DNS-pinning
    # transport, which rewrites the request's host to a resolved IP before
    # the HTTP call is made -- that defeats respx's hostname-based URL
    # matching in tests. Inject a plain client here instead; the pinning
    # transport itself is covered by tests/test_url_validation.py.
    return httpx.AsyncClient()


@pytest.mark.asyncio
@respx.mock
async def test_discover_site_urls_from_urlset():
    respx.get("https://example.com/robots.txt").mock(return_value=httpx.Response(404))
    respx.get("https://example.com/sitemap.xml").mock(return_value=httpx.Response(200, content=URLSET_XML))

    async with _plain_client() as client:
        urls = await discover_site_urls("https://example.com/", max_pages=10, client=client)

    assert "https://example.com/" in urls
    assert "https://example.com/about" in urls
    # Cross-origin URLs listed in the sitemap must be filtered out.
    assert not any("not-example.com" in u for u in urls)


@pytest.mark.asyncio
@respx.mock
async def test_discover_site_urls_respects_max_pages():
    respx.get("https://example.com/robots.txt").mock(return_value=httpx.Response(404))
    respx.get("https://example.com/sitemap.xml").mock(return_value=httpx.Response(200, content=URLSET_XML))

    async with _plain_client() as client:
        urls = await discover_site_urls("https://example.com/", max_pages=2, client=client)
    assert len(urls) == 2


@pytest.mark.asyncio
@respx.mock
async def test_discover_site_urls_follows_sitemap_index():
    respx.get("https://example.com/robots.txt").mock(return_value=httpx.Response(404))
    respx.get("https://example.com/sitemap.xml").mock(return_value=httpx.Response(200, content=SITEMAP_INDEX_XML))
    respx.get("https://example.com/sitemap-pages.xml").mock(return_value=httpx.Response(200, content=URLSET_XML))

    async with _plain_client() as client:
        urls = await discover_site_urls("https://example.com/", max_pages=10, client=client)
    assert "https://example.com/about" in urls


@pytest.mark.asyncio
@respx.mock
async def test_discover_site_urls_follows_robots_txt_directive():
    respx.get("https://example.com/robots.txt").mock(
        return_value=httpx.Response(200, content=b"User-agent: *\nSitemap: https://example.com/custom-sitemap.xml\n")
    )
    respx.get("https://example.com/sitemap.xml").mock(return_value=httpx.Response(404))
    respx.get("https://example.com/custom-sitemap.xml").mock(return_value=httpx.Response(200, content=URLSET_XML))

    async with _plain_client() as client:
        urls = await discover_site_urls("https://example.com/", max_pages=10, client=client)
    assert "https://example.com/contact" in urls


@pytest.mark.asyncio
@respx.mock
async def test_discover_site_urls_raises_when_nothing_found():
    respx.get("https://example.com/robots.txt").mock(return_value=httpx.Response(404))
    respx.get("https://example.com/sitemap.xml").mock(return_value=httpx.Response(404))

    async with _plain_client() as client:
        with pytest.raises(SitemapDiscoveryError):
            await discover_site_urls("https://example.com/", max_pages=10, client=client)


@pytest.mark.asyncio
async def test_discover_site_urls_rejects_ssrf_target():
    with pytest.raises(SSRFValidationError):
        await discover_site_urls("http://127.0.0.1/", max_pages=10)
