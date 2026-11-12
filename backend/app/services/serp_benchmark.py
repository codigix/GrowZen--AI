"""Real SERP benchmark for the blog writer: what the top Google results for a keyword look like (length, headings, FAQ), measured on the live pages.

Nothing here is estimated. A page that cannot be opened keeps `fetched: false` and `word_count: null`; the averages use only pages that were read.
"""
import json
import re
import statistics
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

from bs4 import BeautifulSoup

from ..competitors import intel
from . import market
from .net import site_client

CACHE_SECONDS = 24 * 3600  # one answer per business and keyword per day: protects the Serper quota
MAX_PAGES = 6
_cache: dict[tuple[int, str], tuple[float, dict[str, Any]]] = {}
_lock = threading.Lock()


def analyse_html(html: str) -> dict[str, Any]:
    """Visible words in the main content, the number of h2/h3 headings, and whether the page has an FAQ (heading or FAQPage schema)."""
    soup = BeautifulSoup(html or "", "html.parser")
    faq_schema = False
    for tag in soup.find_all("script", attrs={"type": re.compile("ld\+json", re.I)}):
        raw = tag.string or tag.get_text() or ""
        if re.search(r"FAQPage", raw):
            try:
                json.loads(raw)
            except ValueError:
                pass
            faq_schema = True
    for t in soup(["script", "style", "noscript", "nav", "footer", "header", "aside", "form", "svg", "iframe"]):
        t.decompose()
    root = soup.find("main") or soup.find("article") or soup.body or soup
    words = re.findall(r"[^\W_]+(?:['’][^\W_]+)?", root.get_text(" ", strip=True), flags=re.UNICODE)
    heads = root.find_all(["h2", "h3"])
    faq_heading = any(re.search(r"\b(faq|faqs|frequently asked|common questions)\b", h.get_text(" ", strip=True), re.I) for h in heads)
    return {"word_count": len(words), "headings": len(heads), "has_faq": bool(faq_schema or faq_heading)}


def fetch_page(url: str) -> tuple[int, str]:
    """(status, html) of one result page, through the SSRF-safe client."""
    with site_client(timeout=10) as c:
        r = c.get(url)
        return r.status_code, r.text[:600_000]


def _read(url: str) -> dict[str, Any] | None:
    try:
        status, html = fetch_page(url)
    except Exception:  # noqa: BLE001 - any network or blocked-address error just means this page was not read
        return None
    if status >= 400:
        return None
    return analyse_html(html)


def benchmark(business: Any, keyword: str) -> dict[str, Any]:
    kw = " ".join(keyword.lower().split())
    key = (business.id, kw)
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < CACHE_SECONDS:
            return hit[1]
    own = intel.host_of(business.website)
    serper = intel.Serper(market.serp_country(business))
    organic = serper.search(kw, market.search_location(business), 10).get("organic", [])
    picked: list[dict[str, Any]] = []
    for pos, o in enumerate(organic, start=1):
        url = o.get("link") or ""
        host = intel.host_of(url)
        is_own = bool(own) and (host == own or host.endswith(f".{own}"))
        if not host or is_own or intel.is_directory(host):
            continue  # your own site and listing, social or marketplace sites are not articles to beat
        picked.append({"rank": o.get("position") or pos, "title": o.get("title") or host, "url": url, "domain": host})
    to_read = picked[:MAX_PAGES]
    with ThreadPoolExecutor(max_workers=4) as pool:
        read = list(pool.map(lambda r: _read(r["url"]), to_read))
    results = []
    for i, r in enumerate(picked):
        m = read[i] if i < len(read) else None
        results.append({**r, "word_count": m["word_count"] if m else None, "headings": m["headings"] if m else None,
                        "has_faq": m["has_faq"] if m else None, "fetched": bool(m)})
    counts = [r["word_count"] for r in results if r["fetched"]]
    out = {
        "keyword": kw, "source": "serper", "fetched_at": datetime.now(timezone.utc).isoformat(), "results": results,
        "median_words": int(statistics.median(counts)) if counts else None, "avg_words": round(sum(counts) / len(counts)) if counts else None,
        "note": (f"Measured on the {len(counts)} top Google result page{'s' if len(counts) != 1 else ''} we could open." if counts
                 else "No result page could be opened, so there is no length benchmark for this keyword."),
    }
    with _lock:
        _cache[key] = (time.time(), out)
    return out
