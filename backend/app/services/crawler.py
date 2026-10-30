"""Small site crawler for technical and on-page SEO.

Reads robots.txt and the sitemap, then walks internal links (same host, capped) and checks each
page: status, title and meta description length, H1 count, word count, canonical, noindex,
images without alt text, structured data types, and broken internal links.
"""
import json
import re
from collections import deque
from typing import Any, Callable
from urllib.parse import urldefrag, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from .net import site_client

UA = "CodigixSEOAuditBot/1.0 (+https://codigixinfotech.com)"
SKIP_EXT = re.compile(r"\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|mp3|css|js|ico|woff2?)$", re.I)

# On-page keyword extraction (adapted from keyword_extractor.py): what a page's own title, meta
# description, headings, alt text and body copy actually emphasise -- no external API, so this
# works for any crawled page (ours or a competitor's), unlike Serper-based search-keyword data.
_KW_STOPWORDS = frozenset("""
a about above after again against all am an and any are as at be because been before being below between
both but by can cannot could did do does doing down during each few for from further had has have having
he her here hers herself him himself his how i if in into is it its itself just me more most my myself no
nor not now of off on once only or other our ours ourselves out over own same she should so some such than
that the their theirs them themselves then there these they this those through to too under until up very
was we were what when where which while who whom why will with would you your yours yourself yourselves
also get got us one two may might must shall using use used like new click read more learn home menu
login log sign signup register contact privacy policy terms cookie cookies copyright rights reserved
""".split())
_KW_WORD = re.compile(r"[a-zA-Z][a-zA-Z0-9'’-]{2,}")


def _kw_tokenize(text: str) -> list[str]:
    return [w.strip("'’-") for w in _KW_WORD.findall((text or "").lower())]


def _kw_ngrams(words: list[str], n: int) -> list[str]:
    return [" ".join(words[i:i + n]) for i in range(len(words) - n + 1) if all(w not in _KW_STOPWORDS for w in words[i:i + n])]


def extract_keywords(html: str, top_n: int = 15) -> list[dict[str, Any]]:
    """Top keyword phrases this page's own content emphasises: multi-word phrases that repeat,
    then single words, from the title/meta description/alt text/body text with nav and footer
    chrome stripped out (a repeated mega-menu or footer link list would otherwise drown out the
    page's own content). Returns [] for a page with nothing to say (e.g. a 404 or empty body)."""
    soup = BeautifulSoup(html or "", "html.parser")  # own copy: analyse_html's soup must stay untouched
    for tag in soup(["script", "style", "noscript", "svg", "iframe", "template", "nav", "footer"]):
        tag.decompose()
    for header in soup.find_all("header"):
        if header.find("nav"):
            header.decompose()
    title = soup.title.get_text(strip=True) if soup.title else ""
    meta = soup.find("meta", attrs={"name": re.compile("^description$", re.I)})
    meta_desc = (meta.get("content") or "").strip() if meta else ""
    alt_texts = [img["alt"].strip() for img in soup.find_all("img", alt=True) if img["alt"].strip()]
    body = soup.body or soup
    segments = [s for s in [title, meta_desc, *alt_texts, body.get_text(" ", strip=True)] if s and s.strip()]

    single: dict[str, int] = {}
    bi: dict[str, int] = {}
    tri: dict[str, int] = {}
    for seg in segments:
        words = _kw_tokenize(seg)
        for w in words:
            if w not in _KW_STOPWORDS and not w.isdigit():
                single[w] = single.get(w, 0) + 1
        for n, counter in ((2, bi), (3, tri)):
            for kw in _kw_ngrams(words, n):
                counter[kw] = counter.get(kw, 0) + 1
    bi = {k: v for k, v in bi.items() if v >= 2}
    tri = {k: v for k, v in tri.items() if v >= 2}

    ranked: list[tuple[str, int]] = []
    seen: set[str] = set()
    for counter in (tri, bi, single):
        for kw, count in sorted(counter.items(), key=lambda kv: -kv[1]):
            if kw not in seen:
                seen.add(kw)
                ranked.append((kw, count))
    return [{"keyword": kw, "count": count} for kw, count in ranked[:top_n]]


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
    h1s = soup.find_all("h1")
    html_tag = soup.find("html")
    return {
        "lang": ((html_tag.get("lang") or "").strip() if html_tag else ""),
        "hreflang": len(soup.find_all("link", rel=lambda v: v and "alternate" in (v if isinstance(v, list) else [v]), hreflang=True)),
        "url": url, "status": status,
        "title": title, "title_length": len(title),
        "meta_description": meta_desc[:320],  # kept so the UI can show it and suggest a better one
        "meta_description_length": len(meta_desc),
        "h1_count": len(h1s),
        "h1": h1s[0].get_text(" ", strip=True)[:160] if h1s else "",
        "images_without_alt": [urljoin(url, i.get("src") or "") for i in images if not (i.get("alt") or "").strip() and i.get("src")][:8],
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
        "top_keywords": extract_keywords(html),
    }


def page_issues(p: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    path = urlparse(p["url"]).path or "/"
    if p["status"] >= 400:
        return [{"code": "http_error", "area": "Crawlability", "level": "critical", "title": f"{path} returns {p['status']}", "fix": "Fix the page or 301-redirect it to the closest live page."}]
    if p.get("javascript_only"):
        out.append({"code": "javascript_only", "area": "Crawlability", "level": "critical", "title": f"{path} is empty without JavaScript",
                    "fix": "The page content is built in the browser. Use server-side rendering or pre-rendering so search engines and AI crawlers see the text, links and contact details."})
        return out
    if p["noindex"]:
        out.append({"code": "noindex", "area": "Indexing", "level": "critical", "title": f"{path} has noindex", "fix": "Remove noindex if this page should rank."})
    if not p["title_length"]:
        out.append({"code": "missing_title", "area": "On-page", "level": "serious", "title": f"{path} has no title", "fix": "Add a unique 50-60 character title with the keyword near the start."})
    elif p["title_length"] > 60 or p["title_length"] < 25:
        out.append({"code": "title_length", "area": "On-page", "level": "warning", "title": f"{path} title is {p['title_length']} characters", "fix": "Keep titles 50-60 characters."})
    if not p["meta_description_length"]:
        out.append({"code": "missing_meta_description", "area": "On-page", "level": "warning", "title": f"{path} has no meta description", "fix": "Write 150-160 characters that earn the click."})
    if p["h1_count"] != 1:
        out.append({"code": "h1_count", "area": "On-page", "level": "warning", "title": f"{path} has {p['h1_count']} H1 headings", "fix": "Use exactly one H1 per page."})
    if p["word_count"] < 300:
        out.append({"code": "thin_content", "area": "On-page", "level": "warning", "title": f"{path} is thin ({p['word_count']} words)", "fix": "Answer the visitor's questions in more depth."})
    if p["images_missing_alt"]:
        out.append({"code": "missing_alt", "area": "Images", "level": "info", "title": f"{path}: {p['images_missing_alt']} images without alt text", "fix": "Add short descriptive alt text."})
    if not p["has_viewport"]:
        out.append({"code": "no_viewport", "area": "Mobile", "level": "serious", "title": f"{path} has no viewport tag", "fix": "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">."})
    return out


def frameable(headers: Any) -> bool:
    """Whether a browser may show the page inside an iframe (no X-Frame-Options / frame-ancestors block)."""
    if (headers.get("x-frame-options") or "").strip().lower() in ("deny", "sameorigin"):
        return False
    m = re.search(r"frame-ancestors([^;]*)", headers.get("content-security-policy") or "", re.I)
    return not m or "*" in m.group(1)


def _norm_host(netloc: str) -> str:
    """"www.example.com" and "example.com" are the same site for same-domain link filtering."""
    return netloc.lower().removeprefix("www.")


def _norm_url(url: str) -> str:
    """"/page" and "/page/" (and "" vs "/") are the same page, so they share one dedup key and
    aren't queued and crawled twice as cosmetic variants of each other."""
    parts = urlparse(url)
    path = parts.path or "/"
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")
    return parts._replace(path=path).geturl()


def homepage(url: str) -> str:
    """The site's first page: scheme and host with "/", whatever page the URL points at. An audit always starts here."""
    url = (url or "").strip()
    url = url if url.startswith("http") else f"https://{url}"
    parts = urlparse(url)
    return f"{parts.scheme}://{parts.netloc}/"


def crawl(start_url: str, max_pages: int = 25, timeout: float = 15, on_progress: Callable[[dict[str, Any]], None] | None = None) -> dict[str, Any]:
    """`on_progress` (optional) gets an event per step so a caller can show the scan live:
    {"step": "robots" | "sitemap" | "fetching" | "page", ...}."""
    report = on_progress or (lambda event: None)
    start = homepage(start_url)  # always the first page, so the crawl and the site-wide checks begin at the homepage
    host = _norm_host(urlparse(start).netloc)
    client = site_client(timeout)
    site: dict[str, Any] = {"start_url": start, "host": host}
    try:
        robots = client.get(urljoin(start, "/robots.txt"))
        site["robots_txt"] = robots.status_code == 200
        site["robots_blocks_all"] = bool(re.search(r"(?im)^user-agent:\s*\*\s*$[\s\S]*?^disallow:\s*/\s*$", robots.text)) if robots.status_code == 200 else False
        report({"step": "robots", "found": site["robots_txt"], "blocks_all": site["robots_blocks_all"]})
        sitemap_urls = re.findall(r"(?im)^sitemap:\s*(\S+)", robots.text) if robots.status_code == 200 else []
        sm = client.get(sitemap_urls[0] if sitemap_urls else urljoin(start, "/sitemap.xml"))
        site["sitemap"] = sm.status_code == 200 and ("<urlset" in sm.text or "<sitemapindex" in sm.text)
        site["https"] = start.startswith("https")
        report({"step": "sitemap", "found": site["sitemap"]})
        seen: set[str] = set()  # URLs already queued or dequeued, so the same link isn't crawled twice
        fetched: set[str] = set()  # resolved (post-redirect) URLs of pages already captured
        queue = deque([start])
        pages: list[dict[str, Any]] = []
        broken: list[dict[str, str]] = []
        while queue and len(pages) < max_pages:
            url = queue.popleft()
            if _norm_url(url) in seen:
                continue
            seen.add(_norm_url(url))
            report({"step": "fetching", "url": url, "done": len(pages), "queued": len(queue)})
            try:
                r = client.get(url)
            except httpx.HTTPError as exc:
                broken.append({"url": url, "error": str(exc)[:120]})
                continue
            if "text/html" not in r.headers.get("content-type", ""):
                continue
            resolved = _norm_url(str(r.url))
            if resolved in fetched:
                continue  # this URL redirected to a page already crawled: same content, not a new one
            fetched.add(resolved)
            seen.add(resolved)  # the fetched URL may differ from the queued one after a redirect
            if not pages:  # the start URL may redirect to a different host (e.g. www -> bare domain)
                host = _norm_host(urlparse(str(r.url)).netloc) or host
            p = analyse_html(str(r.url), r.status_code, r.text)
            p["frameable"] = frameable(r.headers)
            if r.status_code >= 400:
                broken.append({"url": url, "error": str(r.status_code)})
            pages.append(p)
            for link in p["links"]:
                href = link["href"]
                if _norm_host(urlparse(href).netloc) == host and _norm_url(href) not in seen and not SKIP_EXT.search(href):
                    queue.append(href)
            report({"step": "page", "page": {k: v for k, v in p.items() if k != "links"}, "queued": len(queue)})
        # Internal linking: how many other crawled pages link to each page (0 = an orphan), and links going out.
        keys = {_norm_url(p["url"]) for p in pages}
        inbound: dict[str, set[str]] = {}
        for p in pages:
            me = _norm_url(p["url"])
            same = {_norm_url(link["href"]) for link in p.get("links", []) if _norm_host(urlparse(link["href"]).netloc) == host}
            p["internal_out"] = len(same - {me})
            for t in (same & keys) - {me}:
                inbound.setdefault(t, set()).add(me)
        for p in pages:
            p["inbound"] = len(inbound.get(_norm_url(p["url"]), ()))
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
        issues.append({"code": "no_https", "area": "Security", "level": "serious", "title": "Site is not on HTTPS", "fix": "Install an SSL certificate and redirect HTTP to HTTPS."})
    if site.get("robots_blocks_all"):
        issues.append({"code": "robots_blocks_all", "area": "Crawlability", "level": "critical", "title": "robots.txt blocks all crawlers", "fix": "Remove 'Disallow: /' for User-agent: *."})
    if not site.get("sitemap"):
        issues.append({"code": "no_sitemap", "area": "Crawlability", "level": "warning", "title": "No XML sitemap found", "fix": "Publish /sitemap.xml and submit it in Search Console."})
    pages = site.get("pages", [])
    if pages and not any("LocalBusiness" in t or t in ("Dentist", "MedicalClinic", "Restaurant", "Store") for p in pages for t in p["schema_types"]):
        issues.append({"code": "no_localbusiness_schema", "area": "Structured data", "level": "serious", "title": "No LocalBusiness schema on the site", "fix": "Add LocalBusiness JSON-LD to the home and contact pages."})
    titles = [p["title"] for p in pages if p["title"]]
    dupes = {t for t in titles if titles.count(t) > 1}
    if dupes:
        issues.append({"code": "duplicate_titles", "area": "On-page", "level": "warning", "title": f"{len(dupes)} duplicate page titles", "fix": "Give every page a unique title.",
                       "titles": sorted(dupes)[:10], "pages": [p["url"] for p in pages if p["title"] in dupes][:20]})
    weight = {"critical": 12, "serious": 6, "warning": 2, "info": 0.5}
    site_penalty = sum(weight.get(i["level"], 1) for i in issues)
    page_found = [page_issues(p) for p in pages]
    for p, found in zip(pages, page_found):
        p["issues"] = found  # kept with the page, so the UI shows each page's own problems
        issues += found
    # Page problems are averaged over the pages, so a big site isn't punished for its size.
    page_penalty = (sum(weight.get(i["level"], 1) for found in page_found for i in found) / len(pages)) * 4 if pages else 0
    score = max(0, min(100, round(100 - site_penalty - page_penalty))) if pages else 0
    return score, issues
