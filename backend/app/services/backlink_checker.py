"""Backlink Checker: for each page that should link to you, is the link really there, and what kind of link is it?

Read live from the linking page (never from a guess):
  - working / link missing / page error, with the HTTP status
  - the link itself: anchor text, follow or nofollow (rel nofollow, sponsored, ugc, and a page-wide robots nofollow), where on the page it sits
  - whether the linking page is noindex (a link on a page Google will not index is worth little) or points its canonical somewhere else
  - the kind of site (directory, social, forum, blog, news, education, government, business website): decided by fixed rules, and labelled as such
Domain Authority, Page Authority, Spam Score and referring domains are MOZ's numbers: they can only come from Moz's own API (MOZ_ACCESS_ID and MOZ_SECRET_KEY in the server settings).
Without them these fields say "not available" and nothing is estimated or invented. The software's own link graph is a different, separately labelled source.
"""
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

import httpx

from ..backlinks.extract import extract_page
from ..backlinks.urls import normalize_url, registrable_domain
from ..config import get_settings
from ..competitors import intel
from .net import site_client
from .url_safety import SSRFValidationError, validate_url_shape

log = logging.getLogger("seo.backlink_checker")
MAX_BYTES = 2 * 1024 * 1024
MAX_SOURCES = 25
FETCH_TIMEOUT = 15
MOZ_URL = "https://lsapi.seomoz.com/v2/url_metrics"
SOCIAL = {"facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com", "pinterest.com", "youtube.com", "tiktok.com", "threads.net", "snapchat.com", "t.me", "wa.me"}
FORUM = {"reddit.com", "quora.com", "stackexchange.com", "stackoverflow.com"}
BLOG_HOSTS = {"wordpress.com", "blogspot.com", "medium.com", "tumblr.com", "substack.com", "wixsite.com", "weebly.com", "blogger.com", "hashnode.dev"}


class CheckError(Exception):
    pass


def moz_configured() -> bool:
    s = get_settings()
    return bool(getattr(s, "moz_access_id", "") and getattr(s, "moz_secret_key", ""))


def target_of(raw: str) -> dict[str, str]:
    """What the links must point to: a whole site ("example.com") or one page ("example.com/page")."""
    t = (raw or "").strip()
    if not t:
        raise CheckError("Enter the website or page the links should point to.")
    url = t if re.match(r"^https?://", t, re.I) else f"https://{t}"
    try:
        validate_url_shape(url)
        n = normalize_url(url)
    except (SSRFValidationError, ValueError) as exc:
        raise CheckError("That is not a valid website address.") from exc
    parts = urlsplit(n)
    host = registrable_domain((parts.hostname or "").lower())
    path = parts.path.rstrip("/")
    return {"domain": host, "path": path if path else "", "label": host + path}


def categorize(source_url: str, placement: str | None, title: str | None) -> dict[str, str]:
    """The kind of site the link is on, by fixed rules on the address and the page: a label, not a quality score."""
    parts = urlsplit(source_url)
    host = (parts.hostname or "").lower().removeprefix("www.")
    dom = registrable_domain(host)
    path = parts.path.lower()
    text = f"{host} {path} {(title or '').lower()}"
    if dom in SOCIAL or any(host.endswith("." + d) for d in SOCIAL):
        return {"key": "social", "label": "Social media", "why": "A social network."}
    if dom in FORUM or re.search(r"(^|[./-])(forum|forums|community|discuss|board)([./-]|$)", host + path):
        return {"key": "forum", "label": "Forum / community", "why": "A forum or Q&A site."}
    if host.endswith((".gov", ".gov.in", ".nic.in")) or ".gov." in host:
        return {"key": "government", "label": "Government", "why": "A government domain."}
    if host.endswith((".edu", ".ac.in", ".edu.in")) or ".edu." in host or ".ac." in host:
        return {"key": "education", "label": "Education", "why": "An education domain."}
    if dom in BLOG_HOSTS or any(host.endswith("." + d) for d in BLOG_HOSTS) or re.search(r"(^|[./-])blog([./-]|$)|/blog/|/\d{4}/\d{2}/", host + path):
        return {"key": "blog", "label": "Blog", "why": "A blog platform or a blog post address."}
    if dom in ("wikipedia.org", "wikimedia.org", "wikihow.com", "britannica.com") or host.endswith(".wikipedia.org"):
        return {"key": "reference", "label": "Reference / encyclopedia", "why": "A reference site."}
    if intel.is_directory(host) or re.search(r"(directory|listing|yellowpages|business-list|classified|citation|local-?listing)", text):
        return {"key": "directory", "label": "Directory / listing", "why": "A directory or listing site."}
    if re.search(r"(news|press|times|herald|post|magazine|journal)", host) or re.search(r"/(news|press|article)/", path):
        return {"key": "news", "label": "News / press", "why": "A news or press site."}
    if placement == "comment":
        return {"key": "comment", "label": "Comment", "why": "The link is in a comment."}
    return {"key": "website", "label": "Business website", "why": "An ordinary website."}


def _fetch(url: str) -> tuple[int | None, str, str | None, int, str | None]:
    """(status, html, final_url, ms, error). Up to 2 MB of the page; redirects are followed (each hop is checked for private addresses)."""
    began = time.monotonic()
    try:
        with site_client(FETCH_TIMEOUT) as c, c.stream("GET", url) as r:
            body = bytearray()
            for chunk in r.iter_bytes():
                body += chunk
                if len(body) > MAX_BYTES:
                    break
            ctype = r.headers.get("content-type", "").lower()
            text = body.decode(r.encoding or "utf-8", errors="replace") if ("html" in ctype or not ctype) else ""
            return r.status_code, text, str(r.url), int((time.monotonic() - began) * 1000), None if text or r.status_code >= 400 else f"The page is not HTML ({ctype or 'unknown type'})."
    except SSRFValidationError as exc:
        return None, "", None, int((time.monotonic() - began) * 1000), str(exc)
    except httpx.TimeoutException:
        return None, "", None, int((time.monotonic() - began) * 1000), "The page took too long to answer."
    except httpx.HTTPError as exc:
        return None, "", None, int((time.monotonic() - began) * 1000), f"The page could not be opened ({type(exc).__name__})."


def _matches(href: str, tgt: dict[str, str]) -> bool:
    p = urlsplit(href)
    host = (p.hostname or "").lower().removeprefix("www.")
    if not (host == tgt["domain"] or host.endswith("." + tgt["domain"]) or registrable_domain(host) == tgt["domain"]):  # www. and subdomains of the target count
        return False
    return not tgt["path"] or (p.path.rstrip("/") + "/").startswith(tgt["path"] + "/") or p.path.rstrip("/") == tgt["path"]


def check_one(source_url: str, tgt: dict[str, str]) -> dict[str, Any]:
    out: dict[str, Any] = {"source_url": source_url[:1000], "source_domain": "", "state": "page_error", "http_status": None, "final_url": None, "ms": None, "error": None, "links": [], "link": None,
                           "follow": None, "page_noindex": None, "page_nofollow": None, "canonical_elsewhere": None, "category": None, "checked_at": datetime.now(timezone.utc).isoformat()}
    try:
        source_url = normalize_url(source_url if re.match(r"^https?://", source_url, re.I) else f"https://{source_url}")
        validate_url_shape(source_url)
    except (SSRFValidationError, ValueError):
        out["error"] = "That is not a valid page address."
        return out
    out["source_url"] = source_url[:1000]
    out["source_domain"] = registrable_domain((urlsplit(source_url).hostname or "").lower())
    status, html, final, ms, err = _fetch(source_url)
    out.update(http_status=status, final_url=final, ms=ms, error=err)
    if status is None or status >= 400 or not html:
        out["error"] = err or (f"The page answered {status}." if status else "The page could not be read.")
        return out
    page = extract_page(html, final or source_url)
    mine = [lk for lk in page.links if not lk.internal and _matches(lk.target_url, tgt)]
    out["page_noindex"], out["page_nofollow"] = page.noindex, page.nofollow_all
    if page.canonical and registrable_domain((urlsplit(page.canonical).hostname or "").lower()) not in ("", out["source_domain"]):
        out["canonical_elsewhere"] = page.canonical[:300]
    out["category"] = categorize(final or source_url, mine[0].placement if mine else None, page.title)
    out["title"] = (page.title or "")[:200]
    if not mine:
        words = len(re.sub(r"<(script|style)[\s\S]*?</\1>|<[^>]+>", " ", html, flags=re.I).split())
        if words < 60 and re.search(r"<script", html, re.I):  # the page draws its content with JavaScript: this plain read cannot see links added by it
            out["state"], out["js_built"] = "unconfirmed", True
            out["error"] = "The page builds its content with JavaScript, so the link cannot be confirmed from the plain page. Open it in a browser to check."
        else:
            out["state"] = "link_missing"
        return out
    out["state"] = "working"
    out["links"] = [{"href": lk.target_url[:500], "anchor": lk.anchor_text, "rel": lk.rel_attributes, "type": lk.link_type, "placement": lk.placement} for lk in mine[:5]]
    first = mine[0]
    rel = set(first.rel_attributes)
    out["link"] = out["links"][0]
    out["follow"] = "nofollow" if ("nofollow" in rel or page.nofollow_all) else "sponsored" if "sponsored" in rel else "ugc" if "ugc" in rel else "dofollow"
    return out


def moz_metrics(urls: list[str]) -> dict[str, dict[str, Any]]:
    """DA, PA, Spam Score and referring root domains for each URL, from Moz's API. {} when it is not configured; raises CheckError with the reason when Moz refuses."""
    s = get_settings()
    if not moz_configured() or not urls:
        return {}
    try:
        r = httpx.post(MOZ_URL, json={"targets": urls[:50]}, auth=(s.moz_access_id, s.moz_secret_key), timeout=30)
    except httpx.HTTPError as exc:
        raise CheckError(f"Moz could not be reached ({type(exc).__name__}).") from exc
    if r.status_code in (401, 403):
        raise CheckError("Moz refused the credentials: check MOZ_ACCESS_ID and MOZ_SECRET_KEY.")
    if r.status_code == 429:
        raise CheckError("Moz rate limit reached: try again later.")
    if r.status_code >= 400:
        raise CheckError(f"Moz answered {r.status_code}.")
    out: dict[str, dict[str, Any]] = {}
    for item in (r.json().get("results") or []):
        page = item.get("page") or item.get("root_domain")
        if not page:
            continue
        out[str(page)] = {"da": item.get("domain_authority"), "pa": item.get("page_authority"), "spam": item.get("spam_score"), "ref_domains": item.get("root_domains_to_root_domain"),
                          "ref_domains_page": item.get("root_domains_to_page")}
    return out


def check_many(sources: list[str], target: str) -> tuple[list[dict[str, Any]], str | None]:
    """Check up to 25 pages (five at a time) and add Moz's numbers when configured. Returns (rows, note about the metrics)."""
    tgt = target_of(target)
    urls = list(dict.fromkeys(s.strip() for s in sources if s and s.strip()))[:MAX_SOURCES]
    if not urls:
        raise CheckError("Add at least one page address to check.")
    with ThreadPoolExecutor(max_workers=5) as pool:
        rows = list(pool.map(lambda u: check_one(u, tgt), urls))
    note = None
    if moz_configured():
        try:
            m = moz_metrics([r["final_url"] or r["source_url"] for r in rows if r["state"] != "page_error"])
            for r in rows:
                got = m.get(r["final_url"] or r["source_url"]) or m.get(r["source_url"])
                r["moz"] = got
        except CheckError as exc:
            note = str(exc)
    else:
        note = "Domain Authority, Page Authority, Spam Score and referring domains come only from Moz. Add MOZ_ACCESS_ID and MOZ_SECRET_KEY to the server settings to show them; nothing is estimated."
    return rows, note


def summarise(rows: list[dict[str, Any]]) -> dict[str, int]:
    return {"total": len(rows), "working": sum(1 for r in rows if r["state"] == "working"), "missing": sum(1 for r in rows if r["state"] == "link_missing"), "errors": sum(1 for r in rows if r["state"] == "page_error"), "unconfirmed": sum(1 for r in rows if r["state"] == "unconfirmed"),
            "dofollow": sum(1 for r in rows if r.get("follow") == "dofollow"), "nofollow": sum(1 for r in rows if r.get("follow") in ("nofollow", "sponsored", "ugc")),
            "noindex": sum(1 for r in rows if r.get("page_noindex"))}
