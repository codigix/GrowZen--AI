"""Small site crawler for technical and on-page SEO.

Reads robots.txt and the sitemap, then walks internal links (same host, capped) and checks each
page: status, title and meta description length, H1 count, word count, canonical, noindex,
images without alt text, structured data types, and broken internal links.
"""
import json
import re
from collections import deque
from typing import Any
from urllib.parse import urldefrag, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from .net import site_client

UA = "CodigixSEOAuditBot/1.0 (+https://codigixinfotech.com)"
SKIP_EXT = re.compile(r"\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|mp3|css|js|ico|woff2?)$", re.I)


APP_ROOT = re.compile(r'<div[^>]+id=["\'](root|app|__next|__nuxt)["\']', re.I)


def renders_with_javascript(html: str, word_count: int) -> bool:
    """A single-page app: the raw HTML is an empty shell filled in by JavaScript."""
    return word_count < 60 and bool(APP_ROOT.search(html or ""))


def analyse_html(url: str, status: int, html: str) -> dict[str, Any]:
    """On-page facts for one page (pure function, used by tests)."""
    soup = BeautifulSoup(html or "", "html.parser")
    title = (soup.title.string or "").strip() if soup.title and soup.title.string else ""
    meta = soup.find("meta", attrs={"name": re.compile("^description$", re.I)})
    meta_desc = (meta.get("content") or "").strip() if meta else ""
    robots = soup.find("meta", attrs={"name": re.compile("^robots$", re.I)})
    canonical = soup.find("link", rel=lambda v: v and "canonical" in (v if isinstance(v, list) else [v]))
    text = soup.get_text(" ", strip=True)
    schema_types: list[str] = []
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "{}")
        except (ValueError, TypeError):
            continue
        for node in (data if isinstance(data, list) else data.get("@graph", [data]) if isinstance(data, dict) else []):
            t = node.get("@type") if isinstance(node, dict) else None
            schema_types += t if isinstance(t, list) else [t] if t else []
    links = []
    for a in soup.find_all("a", href=True):
        href = urldefrag(urljoin(url, a["href"]))[0]
        if href.startswith("http"):
            links.append({"href": href, "text": a.get_text(" ", strip=True)})
    images = soup.find_all("img")
    return {
        "url": url, "status": status,
        "title": title, "title_length": len(title),
        "meta_description_length": len(meta_desc),
        "h1_count": len(soup.find_all("h1")),
        "word_count": len(text.split()),
        "canonical": canonical.get("href") if canonical else None,
        "noindex": bool(robots and "noindex" in (robots.get("content") or "").lower()),
        "images": len(images),
        "images_missing_alt": sum(1 for i in images if not (i.get("alt") or "").strip()),
        "schema_types": sorted(set(schema_types)),
        "has_viewport": bool(soup.find("meta", attrs={"name": "viewport"})),
        "links": links,
        "generic_link_text": sum(1 for l in links if l["text"].lower() in ("click here", "here", "read more", "more", "link")),
        "javascript_only": renders_with_javascript(html, len(text.split())),
    }


def page_issues(p: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    path = urlparse(p["url"]).path or "/"
    if p["status"] >= 400:
        return [{"area": "Crawlability", "level": "critical", "title": f"{path} returns {p['status']}", "fix": "Fix the page or 301-redirect it to the closest live page."}]
    if p.get("javascript_only"):
        out.append({"area": "Crawlability", "level": "critical", "title": f"{path} is empty without JavaScript",
                    "fix": "The page content is built in the browser. Use server-side rendering or pre-rendering so search engines and AI crawlers see the text, links and contact details."})
        return out
    if p["noindex"]:
        out.append({"area": "Indexing", "level": "critical", "title": f"{path} has noindex", "fix": "Remove noindex if this page should rank."})
    if not p["title_length"]:
        out.append({"area": "On-page", "level": "serious", "title": f"{path} has no title", "fix": "Add a unique 50-60 character title with the keyword near the start."})
    elif p["title_length"] > 60 or p["title_length"] < 25:
        out.append({"area": "On-page", "level": "warning", "title": f"{path} title is {p['title_length']} characters", "fix": "Keep titles 50-60 characters."})
    if not p["meta_description_length"]:
        out.append({"area": "On-page", "level": "warning", "title": f"{path} has no meta description", "fix": "Write 150-160 characters that earn the click."})
    if p["h1_count"] != 1:
        out.append({"area": "On-page", "level": "warning", "title": f"{path} has {p['h1_count']} H1 headings", "fix": "Use exactly one H1 per page."})
    if p["word_count"] < 300:
        out.append({"area": "On-page", "level": "warning", "title": f"{path} is thin ({p['word_count']} words)", "fix": "Answer the visitor's questions in more depth."})
    if p["images_missing_alt"]:
        out.append({"area": "Images", "level": "info", "title": f"{path}: {p['images_missing_alt']} images without alt text", "fix": "Add short descriptive alt text."})
    if not p["has_viewport"]:
        out.append({"area": "Mobile", "level": "serious", "title": f"{path} has no viewport tag", "fix": "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">."})
    return out


def crawl(start_url: str, max_pages: int = 25, timeout: float = 15) -> dict[str, Any]:
    start = start_url if start_url.startswith("http") else f"https://{start_url}"
    host = urlparse(start).netloc
    client = site_client(timeout)
    site: dict[str, Any] = {"start_url": start, "host": host}
    try:
        robots = client.get(urljoin(start, "/robots.txt"))
        site["robots_txt"] = robots.status_code == 200
        site["robots_blocks_all"] = bool(re.search(r"(?im)^user-agent:\s*\*\s*$[\s\S]*?^disallow:\s*/\s*$", robots.text)) if robots.status_code == 200 else False
        sitemap_urls = re.findall(r"(?im)^sitemap:\s*(\S+)", robots.text) if robots.status_code == 200 else []
        sm = client.get(sitemap_urls[0] if sitemap_urls else urljoin(start, "/sitemap.xml"))
        site["sitemap"] = sm.status_code == 200 and ("<urlset" in sm.text or "<sitemapindex" in sm.text)
        site["https"] = start.startswith("https")
        seen: set[str] = set()
        queue = deque([start])
        pages: list[dict[str, Any]] = []
        broken: list[dict[str, str]] = []
        while queue and len(pages) < max_pages:
            url = queue.popleft()
            if url in seen:
                continue
            seen.add(url)
            try:
                r = client.get(url)
            except httpx.HTTPError as exc:
                broken.append({"url": url, "error": str(exc)[:120]})
                continue
            if "text/html" not in r.headers.get("content-type", ""):
                continue
            p = analyse_html(str(r.url), r.status_code, r.text)
            if r.status_code >= 400:
                broken.append({"url": url, "error": str(r.status_code)})
            pages.append(p)
            for link in p["links"]:
                href = link["href"]
                if urlparse(href).netloc == host and href not in seen and not SKIP_EXT.search(href):
                    queue.append(href)
        for p in pages:
            p.pop("links", None)
        site.update(pages=pages, broken=broken, crawled=len(pages))
        return site
    finally:
        client.close()


def summarise(site: dict[str, Any]) -> tuple[int, list[dict[str, Any]]]:
    """Score (0-100) and issues for a crawl."""
    issues: list[dict[str, Any]] = []
    if not site.get("https"):
        issues.append({"area": "Security", "level": "serious", "title": "Site is not on HTTPS", "fix": "Install an SSL certificate and redirect HTTP to HTTPS."})
    if site.get("robots_blocks_all"):
        issues.append({"area": "Crawlability", "level": "critical", "title": "robots.txt blocks all crawlers", "fix": "Remove 'Disallow: /' for User-agent: *."})
    if not site.get("sitemap"):
        issues.append({"area": "Crawlability", "level": "warning", "title": "No XML sitemap found", "fix": "Publish /sitemap.xml and submit it in Search Console."})
    pages = site.get("pages", [])
    if pages and not any("LocalBusiness" in t or t in ("Dentist", "MedicalClinic", "Restaurant", "Store") for p in pages for t in p["schema_types"]):
        issues.append({"area": "Structured data", "level": "serious", "title": "No LocalBusiness schema on the site", "fix": "Add LocalBusiness JSON-LD to the home and contact pages."})
    titles = [p["title"] for p in pages if p["title"]]
    dupes = {t for t in titles if titles.count(t) > 1}
    if dupes:
        issues.append({"area": "On-page", "level": "warning", "title": f"{len(dupes)} duplicate page titles", "fix": "Give every page a unique title."})
    weight = {"critical": 12, "serious": 6, "warning": 2, "info": 0.5}
    site_penalty = sum(weight.get(i["level"], 1) for i in issues)
    page_found = [page_issues(p) for p in pages]
    for found in page_found:
        issues += found
    # Page problems are averaged over the pages, so a big site isn't punished for its size.
    page_penalty = (sum(weight.get(i["level"], 1) for found in page_found for i in found) / len(pages)) * 4 if pages else 0
    score = max(0, min(100, round(100 - site_penalty - page_penalty))) if pages else 0
    return score, issues
