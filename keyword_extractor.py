#!/usr/bin/env python3
"""
Website Keyword Extractor
-------------------------
Give it a URL -> it crawls the whole site (not just the homepage) and finds
the keywords each page is actually using.

What it extracts, per page:
  1. <meta name="keywords"> (if the site has it)
  2. Title, meta description, H1/H2/H3 headings
  3. Image ALT text and link anchor text
  4. Most frequent words, 2-word and 3-word phrases from visible body text
  5. Keyword density + where each top keyword appears (title / h1 / description)

Plus a site-wide summary that merges keywords across every crawled page.

Optional: also pulls Google PageSpeed Insights scores (performance + SEO)
for the homepage so you get everything in one audit report.

Install:
    pip install requests beautifulsoup4

Usage:
    python keyword_extractor.py https://example.com
    python keyword_extractor.py https://example.com --max-pages 50 --top 30 --json report.json
    python keyword_extractor.py https://example.com --psi-key YOUR_API_KEY
    python keyword_extractor.py https://example.com --single-page   # old homepage-only behavior
"""

import argparse
import json
import re
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urldefrag, urljoin, urlparse

import requests
from bs4 import BeautifulSoup, NavigableString

# Windows consoles default to cp1252, which can't encode smart quotes, em
# dashes, etc. that frequently show up in scraped page text.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

SKIP_EXTENSIONS = (
    ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".ico",
    ".css", ".js", ".json", ".xml", ".zip", ".rar", ".mp4", ".mp3",
    ".woff", ".woff2", ".ttf", ".eot", ".doc", ".docx", ".xls", ".xlsx",
)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}

STOPWORDS = set("""
a about above after again against all am an and any are as at be because been before being below between
both but by can cannot could did do does doing down during each few for from further had has have having
he her here hers herself him himself his how i if in into is it its itself just me more most my myself no
nor not now of off on once only or other our ours ourselves out over own same she should so some such than
that the their theirs them themselves then there these they this those through to too under until up very
was we were what when where which while who whom why will with would you your yours yourself yourselves
also get got us one two may might must shall using use used like new click read more learn home menu
login log sign signup register contact privacy policy terms cookie cookies copyright rights reserved
""".split())


# --------------------------------------------------------------------------- #
# Fetching
# --------------------------------------------------------------------------- #
def normalize_url(url: str) -> str:
    if not urlparse(url).scheme:
        url = "https://" + url
    return url


def fetch_html(url: str, timeout: int = 20) -> str:
    resp = requests.get(url, headers=HEADERS, timeout=timeout)
    resp.raise_for_status()
    return resp.text


def discover_links(html: str, page_url: str, domain: str) -> set:
    """Absolute, same-domain, non-asset links found on a page."""
    soup = BeautifulSoup(html, "html.parser")
    found = set()
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("mailto:", "tel:", "javascript:", "#")):
            continue
        absolute = urljoin(page_url, href)
        absolute, _ = urldefrag(absolute)
        parsed = urlparse(absolute)
        if parsed.scheme not in ("http", "https"):
            continue
        if parsed.netloc != domain:
            continue
        if parsed.path.lower().endswith(SKIP_EXTENSIONS):
            continue
        found.add(absolute)
    return found


def crawl(start_url: str, max_pages: int = 50, delay: float = 0.0, workers: int = 10) -> dict:
    """Breadth-first crawl of same-domain pages, fetching each level concurrently.

    `delay` is per-request politeness spacing within a level (usually 0 is fine
    since `workers` already caps concurrency); raise it for sites that rate-limit.
    """
    domain = urlparse(start_url).netloc
    visited = {start_url}
    frontier = [start_url]
    pages = {}

    with requests.Session() as session:
        session.headers.update(HEADERS)

        def fetch(url):
            if delay:
                time.sleep(delay)
            resp = session.get(url, timeout=20)
            resp.raise_for_status()
            return url, resp.text

        while frontier and len(pages) < max_pages:
            frontier = frontier[: max_pages - len(pages)]
            next_frontier = []

            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = {pool.submit(fetch, url): url for url in frontier}
                for future in as_completed(futures):
                    url = futures[future]
                    try:
                        url, html = future.result()
                    except requests.RequestException as e:
                        print(f"[warn] skipping {url}: {e}", file=sys.stderr)
                        continue

                    pages[url] = html
                    if len(pages) >= max_pages:
                        continue

                    for link in discover_links(html, url, domain):
                        if link not in visited:
                            visited.add(link)
                            next_frontier.append(link)

            frontier = next_frontier

    return pages


# --------------------------------------------------------------------------- #
# Text helpers
# --------------------------------------------------------------------------- #
def tokenize(text: str):
    """Lowercase words (letters/digits/apostrophes), min length 3."""
    words = re.findall(r"[a-zA-Z][a-zA-Z0-9'’-]{2,}", text.lower())
    return [w.strip("'’-") for w in words]


def clean_words(words):
    return [w for w in words if w not in STOPWORDS and not w.isdigit()]


def ngrams(words, n):
    """n-grams from a word list where no word in the phrase is a stopword."""
    out = []
    for i in range(len(words) - n + 1):
        chunk = words[i:i + n]
        if all(w not in STOPWORDS for w in chunk):
            out.append(" ".join(chunk))
    return out


def extract_text_segments(root) -> list:
    """Walk the tree and emit one segment per element's OWN direct text,
    recursing into child tags separately. This keeps real sentences/list
    items intact (their text is one contiguous run within that element)
    while never gluing together sibling elements' text — e.g. a nav bar's
    separate "Products" / "Pricing" / "Docs" links each become their own
    segment instead of merging into one fake phrase."""
    segments = []

    def walk(tag):
        direct_text = "".join(
            str(child) for child in tag.children if isinstance(child, NavigableString)
        ).strip()
        if direct_text:
            segments.append(direct_text)
        for child in tag.find_all(True, recursive=False):
            walk(child)

    walk(root)
    return segments


# --------------------------------------------------------------------------- #
# Extraction
# --------------------------------------------------------------------------- #
def extract(html: str, top_n: int = 20) -> dict:
    soup = BeautifulSoup(html, "html.parser")

    # --- meta / on-page SEO elements ---
    title = soup.title.get_text(strip=True) if soup.title else ""

    def meta(name):
        tag = soup.find("meta", attrs={"name": re.compile(f"^{name}$", re.I)})
        return tag.get("content", "").strip() if tag and tag.get("content") else ""

    meta_keywords_raw = meta("keywords")
    meta_keywords = [k.strip().lower() for k in meta_keywords_raw.split(",") if k.strip()]
    meta_description = meta("description")

    og_title = ""
    og = soup.find("meta", property="og:title")
    if og and og.get("content"):
        og_title = og["content"].strip()

    # --- drop boilerplate chrome before reading any content from the body ---
    # <nav>/<footer> are repeated verbatim on every page (mega-menus, footer
    # link columns) and would otherwise drown out page-specific content. A
    # <header> is only chrome if it wraps a <nav> — a blog post's own
    # <header> (title/author/date) has no <nav> and is real per-page
    # content, so it's kept.
    for tag in soup(["script", "style", "noscript", "svg", "iframe", "template", "nav", "footer"]):
        tag.decompose()
    for header in soup.find_all("header"):
        if header.find("nav"):
            header.decompose()

    headings = {
        f"h{i}": [h.get_text(" ", strip=True) for h in soup.find_all(f"h{i}") if h.get_text(strip=True)]
        for i in (1, 2, 3)
    }

    alt_texts = [img["alt"].strip() for img in soup.find_all("img", alt=True) if img["alt"].strip()]
    anchor_texts = [a.get_text(" ", strip=True) for a in soup.find_all("a") if a.get_text(strip=True)]

    body = soup.body or soup
    body_segments = extract_text_segments(body)

    # Split everything into small segments so phrases never span across
    # unrelated elements (e.g. a nav bar's separate links, or the end of
    # one paragraph running into the start of another).
    segments = [title, meta_description] + alt_texts + body_segments
    segments = [s for s in segments if s and s.strip()]

    seg_words = [tokenize(seg) for seg in segments]
    total_words = sum(len(w) for w in seg_words)

    single, bi, tri = Counter(), Counter(), Counter()
    for words in seg_words:
        single.update(clean_words(words))
        bi.update(ngrams(words, 2))
        tri.update(ngrams(words, 3))

    # Only keep phrases that repeat
    bi = Counter({k: v for k, v in bi.items() if v >= 2})
    tri = Counter({k: v for k, v in tri.items() if v >= 2})

    def with_density(counter):
        rows = []
        for kw, count in counter.most_common(top_n):
            density = round((count * len(kw.split()) / max(total_words, 1)) * 100, 2)
            rows.append({"keyword": kw, "count": count, "density_%": density})
        return rows

    top_single = with_density(single)
    top_bi = with_density(bi)
    top_tri = with_density(tri)

    # --- where does each top keyword appear? ---
    placement = []
    t, d = title.lower(), meta_description.lower()
    h1_text = " ".join(headings["h1"]).lower()
    h2_text = " ".join(headings["h2"]).lower()
    for row in top_single[:10]:
        kw = row["keyword"]
        placement.append({
            "keyword": kw,
            "in_title": kw in t,
            "in_meta_description": kw in d,
            "in_h1": kw in h1_text,
            "in_h2": kw in h2_text,
            "in_meta_keywords": kw in " ".join(meta_keywords),
        })

    meta_keywords_source = "meta_tag"
    if not meta_keywords:
        meta_keywords = derive_keywords(top_single, top_bi, top_tri, t, h1_text, h2_text)
        meta_keywords_source = "derived"

    return {
        "title": title,
        "title_length": len(title),
        "meta_description": meta_description,
        "meta_description_length": len(meta_description),
        "og_title": og_title,
        "meta_keywords": meta_keywords,
        "meta_keywords_source": meta_keywords_source,
        "headings": headings,
        "images_with_alt": len(alt_texts),
        "total_words": total_words,
        "top_keywords": top_single,
        "top_2_word_phrases": top_bi,
        "top_3_word_phrases": top_tri,
        "keyword_placement": placement,
    }


def derive_keywords(top_single, top_bi, top_tri, title_text, h1_text, h2_text, limit=12):
    """When a site has no <meta name="keywords">, build an equivalent list
    from the phrases/words the page actually emphasizes: multi-word phrases
    first (they read like real keywords), prioritizing ones that show up in
    the title or headings, then top single words as filler."""
    ranked = []
    seen = set()

    def add(kw):
        if kw not in seen:
            seen.add(kw)
            ranked.append(kw)

    for row in top_tri + top_bi:
        kw = row["keyword"]
        if kw in title_text or kw in h1_text or kw in h2_text:
            add(kw)
    for row in top_tri + top_bi:
        add(row["keyword"])
    for row in top_single:
        add(row["keyword"])

    return ranked[:limit]


# --------------------------------------------------------------------------- #
# Site-wide aggregation
# --------------------------------------------------------------------------- #
def aggregate_site(per_page: dict, top_n: int = 20) -> dict:
    """Merge single-keyword counts across every crawled page."""
    site_single = Counter()
    total_words = 0
    for data in per_page.values():
        total_words += data["total_words"]
        for row in data["top_keywords"]:
            site_single[row["keyword"]] += row["count"]

    rows = []
    for kw, count in site_single.most_common(top_n):
        density = round((count / max(total_words, 1)) * 100, 2)
        rows.append({"keyword": kw, "count": count, "density_%": density})

    return {
        "pages_crawled": len(per_page),
        "total_words": total_words,
        "top_keywords": rows,
    }


# --------------------------------------------------------------------------- #
# Optional: Google PageSpeed Insights
# --------------------------------------------------------------------------- #
def pagespeed(url: str, api_key: str = None, strategy: str = "mobile") -> dict:
    endpoint = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"
    params = [("url", url), ("strategy", strategy),
              ("category", "performance"), ("category", "seo"),
              ("category", "accessibility"), ("category", "best-practices")]
    if api_key:
        params.append(("key", api_key))
    r = requests.get(endpoint, params=params, timeout=120)
    r.raise_for_status()
    cats = r.json().get("lighthouseResult", {}).get("categories", {})
    return {name: round((c.get("score") or 0) * 100) for name, c in cats.items()}


# --------------------------------------------------------------------------- #
# Pretty printing
# --------------------------------------------------------------------------- #
def print_table(title, rows):
    print(f"\n=== {title} ===")
    if not rows:
        print("  (none found)")
        return
    for r in rows:
        print(f"  {r['keyword']:<35} count={r['count']:<4} density={r['density_%']}%")


def print_report(url, data, psi=None):
    print(f"\nURL: {url}")
    print(f"Title ({data['title_length']} chars): {data['title']}")
    print(f"Meta description ({data['meta_description_length']} chars): {data['meta_description'] or '(missing)'}")
    kw_label = "meta tag" if data.get("meta_keywords_source") == "meta_tag" else "derived from content"
    print(f"Meta keywords ({kw_label}): {', '.join(data['meta_keywords']) or '(none found)'}")
    print(f"Total words on page: {data['total_words']}")
    for level, items in data["headings"].items():
        print(f"{level.upper()} ({len(items)}): {items[:5]}")

    print_table("TOP SINGLE KEYWORDS", data["top_keywords"])
    print_table("TOP 2-WORD PHRASES", data["top_2_word_phrases"])
    print_table("TOP 3-WORD PHRASES", data["top_3_word_phrases"])

    print("\n=== WHERE TOP KEYWORDS APPEAR ===")
    for p in data["keyword_placement"]:
        flags = [k.replace("in_", "") for k, v in p.items() if k != "keyword" and v]
        print(f"  {p['keyword']:<25} -> {', '.join(flags) or 'only in body text'}")

    if psi:
        print("\n=== GOOGLE PAGESPEED SCORES ===")
        for k, v in psi.items():
            print(f"  {k:<18} {v}/100")


def trim_for_display(data: dict, top_n: int) -> dict:
    trimmed = dict(data)
    trimmed["top_keywords"] = data["top_keywords"][:top_n]
    trimmed["top_2_word_phrases"] = data["top_2_word_phrases"][:top_n]
    trimmed["top_3_word_phrases"] = data["top_3_word_phrases"][:top_n]
    return trimmed


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(description="Extract keywords used across a website.")
    ap.add_argument("url", help="Website URL, e.g. https://example.com")
    ap.add_argument("--top", type=int, default=20, help="How many keywords to show per page/site (default 20)")
    ap.add_argument("--json", metavar="FILE", help="Save full report to a JSON file")
    ap.add_argument("--psi-key", metavar="KEY", help="Google PageSpeed API key (also fetches PSI scores for the homepage)")
    ap.add_argument("--strategy", choices=["mobile", "desktop"], default="mobile")
    ap.add_argument("--max-pages", type=int, default=50, help="Max number of same-domain pages to crawl (default 50)")
    ap.add_argument("--delay", type=float, default=0.0, help="Extra seconds to wait before each request, for rate-limited sites (default 0)")
    ap.add_argument("--workers", type=int, default=10, help="Concurrent page fetches per crawl level (default 10)")
    ap.add_argument("--single-page", action="store_true", help="Only analyze the given URL, skip crawling the rest of the site")
    args = ap.parse_args()

    url = normalize_url(args.url)

    if args.single_page:
        try:
            html = fetch_html(url)
        except requests.RequestException as e:
            sys.exit(f"Could not fetch {url}: {e}")
        pages = {url: html}
    else:
        pages = crawl(url, max_pages=args.max_pages, delay=args.delay, workers=args.workers)
        if not pages:
            sys.exit(f"Could not fetch {url} or any linked pages.")

    # Extract with a generous top_n so the site-wide aggregate stays accurate;
    # per-page/display output is trimmed down to --top afterwards.
    extract_top_n = max(args.top, 200)
    per_page = {page_url: extract(html, top_n=extract_top_n) for page_url, html in pages.items()}

    psi = None
    if args.psi_key:
        try:
            psi = pagespeed(url, args.psi_key, args.strategy)
        except requests.RequestException as e:
            print(f"[warn] PageSpeed request failed: {e}", file=sys.stderr)

    site_summary = aggregate_site(per_page, top_n=extract_top_n)

    print(f"\nCrawled {len(per_page)} page(s) on {urlparse(url).netloc}")
    for page_url, data in per_page.items():
        print_report(page_url, trim_for_display(data, args.top), psi if page_url == url else None)

    print("\n" + "=" * 60)
    print(f"SITE-WIDE SUMMARY ({site_summary['pages_crawled']} pages, {site_summary['total_words']} total words)")
    print("=" * 60)
    print_table("TOP SITE-WIDE KEYWORDS", site_summary["top_keywords"][:args.top])

    if args.json:
        json_fields = ("title", "title_length", "meta_description",
                       "meta_description_length", "og_title", "meta_keywords",
                       "meta_keywords_source")
        report = {
            "url": url,
            "pages_crawled": len(per_page),
            "pages": {
                page_url: {"url": page_url, **{k: data[k] for k in json_fields}}
                for page_url, data in per_page.items()
            },
        }
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        print(f"\nFull report saved to {args.json}")


if __name__ == "__main__":
    main()