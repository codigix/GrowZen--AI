"""One page of the web, analysed: what the page itself says, how strong its site is, and which searches it shows for.

Nothing here is estimated. The page is read directly (title, description, headings, length, links, structured data, last update). The site's Domain Authority, home-page Page Authority, referring
domains, spam score and the number of keywords it ranks for are Moz's figures, read through Apify. The searches the page is found for are the phrases the page itself is about (its title,
heading and sub-headings, and the keyword that led here), each measured: its searches a month in Google Keyword Planner, and the page's position in Google's top 20 for it. For a page of the
project's own site, Google Search Console gives the real searches it was shown for, with clicks and positions.
"""
from __future__ import annotations

import ipaddress
import json
import logging
import re
import socket
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Any
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit

import httpx

from . import apify_metrics, countries

log = logging.getLogger("seo.url_overview")
UA = "Mozilla/5.0 (compatible; bevisibe-research/1.0)"
_BRAND_SPLIT = re.compile(r"\s*[|–—:»«·•]\s*|\s+-\s+")


class UrlError(Exception):
    pass


def _public(url: str) -> str:
    """The URL, checked: http or https, with a public address. A page on a private or local address is never fetched."""
    u = (url or "").strip()
    if not re.match(r"^https?://", u, re.I):
        u = "https://" + u
    parts = urlsplit(u)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise UrlError("That is not a web address.")
    try:
        for info in socket.getaddrinfo(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80)):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                raise UrlError("Only public web pages can be analysed.")
    except socket.gaierror as exc:
        raise UrlError("That address could not be found.") from exc
    return u


def _fetch(url: str) -> tuple[httpx.Response | None, str]:
    """The page, following up to four redirects by hand so that each step is checked as public."""
    current = _public(url)
    for _ in range(5):
        try:
            r = httpx.get(current, headers={"User-Agent": UA, "Accept": "text/html,*/*"}, timeout=14, follow_redirects=False)
        except httpx.HTTPError as exc:
            return None, f"The page could not be read ({type(exc).__name__})."
        if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
            current = _public(urljoin(current, r.headers["location"]))
            continue
        return r, current
    return None, "Too many redirects."


def norm(u: str | None) -> str:
    """A page address compared without the scheme, www, a trailing slash, a #fragment or tracking parameters."""
    p = urlsplit((u or "").strip().lower())
    q = urlencode([(k, v) for k, v in parse_qsl(p.query) if not k.startswith("utm_") and k not in ("gclid", "fbclid")])
    return re.sub(r"^www\.", "", p.netloc) + (p.path or "/").rstrip("/") + (f"?{q}" if q else "")


def page_analysis(url: str) -> dict[str, Any]:
    """What the page says about itself, read directly."""
    from bs4 import BeautifulSoup  # noqa: PLC0415

    from .keyword_difficulty import _modified  # noqa: PLC0415
    r, final = _fetch(url)
    if r is None:
        return {"ok": False, "error": final, "url": url}
    out: dict[str, Any] = {"ok": r.status_code == 200, "status": r.status_code, "url": url, "final_url": final, "error": None if r.status_code == 200 else f"The page answered {r.status_code}."}
    if r.status_code != 200 or "html" not in r.headers.get("content-type", ""):
        return out
    soup = BeautifulSoup(r.text, "html.parser")
    host = urlsplit(final).netloc.lower().removeprefix("www.")
    title = (soup.title.string or "").strip() if soup.title and soup.title.string else ""
    desc = soup.find("meta", attrs={"name": re.compile("^description$", re.I)})
    canon = soup.find("link", rel="canonical")
    robots = soup.find("meta", attrs={"name": re.compile("^robots$", re.I)})
    schema: list[str] = []
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
        except ValueError:
            continue
        for node in (data if isinstance(data, list) else data.get("@graph", [data]) if isinstance(data, dict) else []):
            t = node.get("@type") if isinstance(node, dict) else None
            schema += [str(x) for x in (t if isinstance(t, list) else [t])] if t else []
    modified = _modified(r.headers, soup)
    h1 = [h.get_text(" ", strip=True) for h in soup.find_all("h1")][:3]
    headings = [{"tag": h.name, "text": h.get_text(" ", strip=True)[:140]} for h in soup.find_all(["h2", "h3"])][:30]
    images = soup.find_all("img")
    links = soup.find_all("a", href=True)
    internal = sum(1 for a in links if urlsplit(urljoin(final, a["href"])).netloc.lower().removeprefix("www.") == host)
    n_links, n_images, no_alt = len(links), len(images), sum(1 for i in images if not (i.get("alt") or "").strip())  # counted before the page's furniture is taken out
    for x in soup(["script", "style", "nav", "footer", "header", "noscript"]):
        x.decompose()
    out.update({
        "title": title, "title_len": len(title), "description": (desc.get("content") or "").strip() if desc else "", "canonical": canon.get("href") if canon else None,
        "robots": (robots.get("content") or "").strip() if robots else None, "h1": h1, "headings": headings, "words": len(soup.get_text(" ").split()),
        "images": n_images, "images_no_alt": no_alt, "links_internal": internal, "links_external": n_links - internal,
        "schema": sorted(set(schema))[:10], "modified": modified.date().isoformat() if modified else None, "lang": (soup.html.get("lang") if soup.html else None),
    })
    out["description_len"] = len(out["description"])
    return out


def authority(site: str) -> dict[str, Any] | None:
    """Moz's figures for the site, through Apify, asked afresh: Domain Authority, home-page Page Authority, referring domains, spam score and how many keywords it ranks for."""
    try:
        got = apify_metrics.lookup([site])
    except apify_metrics.ApifyError as exc:
        return {"error": str(exc)[:160]}
    x = got[0] if got else None
    if not x:
        return None
    n = apify_metrics._num
    return {"domain": site, "da": n(x.get("domain_authority")), "pa": n(x.get("home_page_authority")), "rd": n(x.get("linking_root_domains")), "spam": n(x.get("spam_score")), "ranking_keywords": n(x.get("ranking_keywords")),
            "report": x.get("report_link")}


def own_queries(db, b, url: str, country: str | None) -> dict[str, Any]:
    """For a page of the project's own site: the searches Google Search Console says it was shown for (last 90 days), with views, clicks and average position."""
    from . import google_rank, gsc, gsc_access  # noqa: PLC0415
    host = google_rank.host_of(b.website)
    if not host or google_rank.host_of(url) != host:
        return {"own": False, "rows": []}
    state, message, sc, site = gsc_access.search_console(db, b, host)
    if state != "ok":
        return {"own": True, "rows": [], "note": message}
    end = date.today() - timedelta(days=gsc.LAG_DAYS)
    body = gsc._body(end - timedelta(days=89), end, ["query"], 100, None)
    body["dimensionFilterGroups"] = [{"groupType": "and", "filters": [{"dimension": "page", "operator": "equals", "expression": url}]}]
    try:
        rows = sc.query(site, body)
    except Exception as exc:  # noqa: BLE001 -- Google's own message is the reason
        return {"own": True, "rows": [], "note": str(exc)[:200]}
    out = [{"keyword": (r.get("keys") or [""])[0], "views": int(r.get("impressions") or 0), "clicks": int(r.get("clicks") or 0), "position": round(float(r.get("position") or 0), 1),
            "ctr": round(100 * float(r.get("ctr") or 0), 1)} for r in rows]
    out.sort(key=lambda r: (-r["clicks"], -r["views"]))
    return {"own": True, "rows": out[:30], "note": None if out else "Search Console has no searches for this page in the last 90 days."}


def phrases(analysis: dict[str, Any], keyword: str | None) -> list[str]:
    """The searches this page is about: the keyword that led here, its title and main heading cut at the brand, and its sub-headings, as short phrases."""
    seen: dict[str, str] = {}

    brand = {w for w in re.split(r"[.\-]", urlsplit(analysis.get("final_url") or "").netloc.lower().removeprefix("www.")) if len(w) > 3 and w not in ("com", "org", "net")}

    def add(text: str | None, cut_brand: bool = False) -> None:
        for seg in _BRAND_SPLIT.split(text or ""):
            words = re.findall(r"[a-z0-9']+", seg.lower())
            if cut_brand and brand & set(words):
                continue  # a piece of the title that names the site is its brand, not a search
            if 2 <= len(words) <= 7:
                seen.setdefault(" ".join(words), " ".join(words))
    if keyword:
        add(keyword)
    add(analysis.get("title"), cut_brand=True)
    for h in analysis.get("h1") or []:
        add(h)
    for h in analysis.get("headings") or []:
        if h["tag"] == "h2":
            add(h["text"])
    return list(seen)[:12]


def rankings(url: str, keyword: str | None, country: str, analysis: dict[str, Any]) -> dict[str, Any]:
    """Each phrase the page is about, measured: searches a month (Google Keyword Planner) and the page's position in Google's top 20 for it ({position: None} when it is not there)."""
    from . import google_ads_client as ads  # noqa: PLC0415
    from . import keyword_difficulty as kd  # noqa: PLC0415
    from .providers.base import intent_of  # noqa: PLC0415
    cands = phrases(analysis, keyword)
    vols: dict[str, Any] = {}
    try:
        vols = ads.historical_metrics(cands, geo_target=ads.geo_target_for(country)) if cands else {}
    except Exception as exc:  # noqa: BLE001 -- without volumes the positions are still shown
        log.info("volumes unavailable: %r", exc)
    want = norm(url)
    final = norm(analysis.get("final_url") or url)

    def place(k: str) -> int | None:
        results = kd._lofo(k, country, 20)  # Google's top 20 with their real addresses
        if not results:
            return -1  # not measured
        for o in results:
            if norm(o["url"]) in (want, final):
                return int(o["position"])
        return None
    # the searches with the most traffic first; the others are measured while there is time (three at a time)
    order = sorted(cands, key=lambda k: -((vols.get(k) or {}).get("volume") or 0))[:10]
    with ThreadPoolExecutor(max_workers=3) as pool:
        pos = dict(zip(order, pool.map(place, order)))
    rows = [{"keyword": k, "volume": (vols.get(k) or {}).get("volume"), "index": (vols.get(k) or {}).get("competition_index"), "cpc": (vols.get(k) or {}).get("cpc"), "intent": intent_of(k),
             "position": (None if pos.get(k) in (None, -1) else pos[k]), "measured": pos.get(k, -1) != -1, "in_top20": pos.get(k) not in (None, -1)} for k in order]
    return {"rows": rows, "country": country}
