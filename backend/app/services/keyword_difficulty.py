"""SEO difficulty of one keyword, from what Google really shows for it.

The top 10 results of a Google search (and the "People also ask", related searches and ads on the page) come from Apify's Google Search scraper; Domain Authority, home-page Page
Authority, referring domains and spam score of each of those sites come from Moz through Apify (asked afresh each time; nothing is saved). Nothing is estimated: a site
Apify has no figures for is left out of the averages and said so.

Score (0-100, higher = harder), the parts of the formula we can measure:
    Authority_Strength      = mean(average DA, average PA, referring domains on a log scale)
    SERP_Feature_Competition = share of the SERP features we can see (ads, People also ask, AI overview) that are on the page
    Top10_Strength          = share of the top 10 sites with a Domain Authority of 70 or more
    SC = 0.50 * Authority_Strength + 0.25 * SERP_Feature_Competition + 0.25 * Top10_Strength
SV (search volume on a log scale against VOLUME_BENCHMARK) is returned beside it. BQ, CC and KI need page-by-page scoring that is not built, so they are not part of the score.
"""
from __future__ import annotations

import logging
import math
import threading
from typing import Any
from urllib.parse import urlsplit

import httpx

from . import apify_metrics, countries

log = logging.getLogger("seo.difficulty")
SERP_ACTOR = "apify~google-search-scraper"
SERP_URL = f"https://api.apify.com/v2/acts/{SERP_ACTOR}/run-sync-get-dataset-items"
VOLUME_BENCHMARK = 100_000  # searches a month that count as 100 on the volume scale
RD_TOP = 1_000_000  # referring domains that count as 100 on the log scale
STRONG_DA = 70
_TWO_PART = {"co", "com", "org", "net", "gov", "ac", "edu"}


class DifficultyError(Exception):
    pass


def site_of(url: str) -> str:
    host = (urlsplit(url).hostname or "").lower().removeprefix("www.")
    parts = host.split(".")
    if len(parts) >= 3 and parts[-2] in _TWO_PART and len(parts[-1]) == 2:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def _serper(keyword: str, country: str, location: str | None = None) -> dict[str, Any] | None:
    """The same page read through Serper.dev, which answers in about a second. None when it has no key or no credit left (Apify is used then)."""
    from ..config import get_settings  # noqa: PLC0415
    key = get_settings().serper_api_key.strip()
    if not key:
        return None
    try:
        r = httpx.post("https://google.serper.dev/search", headers={"X-API-KEY": key, "Content-Type": "application/json"}, json={"q": keyword, "gl": countries.gl(country).lower(), "hl": "en", "num": 10, **({"location": location} if location else {})}, timeout=15)
        if r.status_code != 200:
            return None
        j = r.json()
    except (httpx.HTTPError, ValueError):
        return None
    organic = [{"position": o.get("position") or i + 1, "title": o.get("title") or "", "url": o.get("link") or "", "site": site_of(o.get("link") or ""), "description": (o.get("snippet") or "")[:200]}
               for i, o in enumerate(j.get("organic") or []) if o.get("link")][:10]
    if not organic:
        return None
    return {"organic": organic, "questions": [p.get("question") for p in (j.get("peopleAlsoAsk") or []) if p.get("question")],
            "related": [q.get("query") for q in (j.get("relatedSearches") or []) if q.get("query")],
            "ads": [{"title": a.get("title") or "", "url": a.get("link") or "", "site": site_of(a.get("link") or ""), "description": (a.get("snippet") or "")[:240]} for a in (j.get("ads") or [])],
            "ai_overview": bool(j.get("aiOverview") or j.get("answerBox"))}


HEDGE_AFTER = 70  # seconds: a Google results run that is still going then is probably one of the slow ones (up to 8 minutes), so a second identical run is started and the first answer wins


_APIFY_SLOTS = threading.BoundedSemaphore(8)  # Apify Google scrapes running at once in this process (each is a paid run that can take minutes, and a hedged copy is a second one)


def _apify_once(tok: str, keyword: str, country: str) -> tuple[dict[str, Any] | None, str]:
    with _APIFY_SLOTS:
        return _apify_run(tok, keyword, country)


def _apify_run(tok: str, keyword: str, country: str) -> tuple[dict[str, Any] | None, str]:
    try:
        r = httpx.post(SERP_URL, params={"token": tok, "memory": 4096}, json={"queries": keyword, "countryCode": countries.gl(country).lower(), "languageCode": "en", "maxPagesPerQuery": 1,
                                                                              "saveHtml": False, "saveHtmlToKeyValueStore": False, "resultsPerPage": 10, "mobileResults": False}, timeout=170)
    except httpx.HTTPError as exc:
        return None, f"Apify could not be reached ({type(exc).__name__})."
    if r.status_code in (200, 201) and isinstance(r.json(), list) and r.json():
        item = r.json()[0]
        return {
            "organic": [{"position": o.get("position"), "title": o.get("title") or "", "url": o.get("url") or "", "site": site_of(o.get("url") or ""), "description": (o.get("description") or "")[:200]}
                        for o in sorted((item.get("organicResults") or []), key=lambda x: x.get("position") or 99) if o.get("url")][:10],
            "questions": [p.get("question") for p in (item.get("peopleAlsoAsk") or []) if p.get("question")],
            "related": [(q.get("title") if isinstance(q, dict) else str(q)) for q in (item.get("relatedQueries") or [])],
            "ads": [{"title": a.get("title") or "", "url": a.get("url") or a.get("displayedUrl") or "", "site": site_of(a.get("url") or a.get("displayedUrl") or ""),
                     "description": (a.get("description") or "")[:240]} for a in (item.get("paidResults") or [])],
            "ai_overview": bool(item.get("aiOverview")),
        }, ""
    return None, f"Apify answered {r.status_code}."


BADGER_URL = "https://api.apify.com/v2/acts/scrape.badger~google-search-scraper/run-sync-get-dataset-items"
FEATURES = {"Ads": "ads", "People also ask": "related_questions", "Local pack": "local_results", "Knowledge panel": "knowledge_graph", "Videos": "inline_videos", "Shopping": "shopping_results",
            "Discussions": "discussions_and_forums"}


def resolve_goto(url: str) -> str | None:
    """Google hides some result addresses behind a redirect (www.google.com/goto?url=...). The real address is read from the redirect: its Location header, or the link on Google's notice page."""
    import re  # noqa: PLC0415
    try:
        r = httpx.get(url, headers={"User-Agent": "Mozilla/5.0 (compatible; bevisibe-research/1.0)"}, follow_redirects=False, timeout=8)
    except httpx.HTTPError:
        return None
    if 300 <= r.status_code < 400 and r.headers.get("location"):
        return r.headers["location"]
    for m in re.finditer(r'href="(https?://[^"]+)"', r.text or ""):
        if "google." not in m.group(1).split("/")[2]:
            return m.group(1).replace("&amp;", "&")
    return None


def _open_gotos(organic: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Results whose address Google hid behind a redirect get their real address (looked up together), so they count like any other result."""
    from app.services.fanout import ThreadPoolExecutor  # noqa: PLC0415
    hidden = [o for o in organic if "google.com/goto" in o["url"]]
    if hidden:
        with ThreadPoolExecutor(max_workers=8) as pool:
            for o, real in zip(hidden, pool.map(lambda o: resolve_goto(o["url"]), hidden)):
                if real:
                    o["url"], o["site"] = real, site_of(real)
    return organic


LOFO_URL = "https://api.apify.com/v2/acts/lofomachines~google-serp-scraper/run-sync-get-dataset-items"


def _lofo(keyword: str, country: str, n: int = 20) -> list[dict[str, Any]] | None:
    """The top results of Google with their real addresses, through Apify's `lofomachines/google-serp-scraper` (about 5 seconds, up to 20 results, no place setting). The faster `scrape.badger`
    reader hides most result addresses behind Google redirects, so this one gives the results themselves. None when it fails."""
    for _i, tok in apify_metrics.keys():
        try:
            r = httpx.post(LOFO_URL, params={"token": tok, "timeout": 60}, json={"query": [keyword], "maxItems": max(20, n), "scrapingMode": "economy", "country": countries.gl(country).lower(), "language": "en"}, timeout=70)
            items = r.json() if r.status_code in (200, 201) and isinstance(r.json(), list) else None
        except (httpx.HTTPError, ValueError):
            continue
        out = [{"position": int(o.get("position") or o.get("rank") or i + 1), "title": o.get("title") or "", "url": o.get("url") or "", "site": site_of(o.get("url") or ""), "description": (o.get("snippet") or "")[:200]}
               for i, o in enumerate(items or []) if o.get("url")]
        if out:
            return sorted(out, key=lambda o: o["position"])[:n]
    return None


def _badger(keyword: str, country: str, location: str | None = None, num: int = 10) -> dict[str, Any] | None:
    """The same page through Apify's `scrape.badger/google-search-scraper`: about 7 seconds instead of 60+, and it also reports the local pack, knowledge panel, videos, shopping and forums.
    None when it fails (the slower scraper is used then)."""
    for _i, tok in apify_metrics.keys():
        try:
            r = httpx.post(BADGER_URL, params={"token": tok, "timeout": 60}, json={"q": keyword, "gl": countries.gl(country).lower(), "hl": "en", "num": num, **({"location": location} if location else {})}, timeout=70)
            j = r.json()[0] if r.status_code in (200, 201) and isinstance(r.json(), list) and r.json() else None
        except (httpx.HTTPError, ValueError):
            continue
        if not j or not j.get("organic_results"):
            continue
        organic = [{"position": o.get("position") or i + 1, "title": o.get("title") or "", "url": o.get("link") or "", "site": site_of(o.get("link") or ""), "description": (o.get("snippet") or "")[:200]}
                   for i, o in enumerate(j["organic_results"]) if o.get("link")][:num]
        organic = _open_gotos(organic)
        ai_refs = [{"title": r.get("title") or r.get("source") or "", "url": r.get("link") or r.get("url") or "", "site": site_of(r.get("link") or r.get("url") or "")}
                   for r in ((j.get("ai_overview") or {}).get("references") or []) if isinstance(r, dict) and (r.get("link") or r.get("url"))][:12]
        ai_refs = _open_gotos(ai_refs)  # the sources of the AI Overview come as Google redirects: their real addresses are read
        ai = bool((j.get("ai_overview") or {}).get("text_blocks")) or bool(ai_refs)
        features = {name: bool(j.get(key)) for name, key in FEATURES.items()}
        features["AI overview"] = ai
        if any(o["site"] == "google.com" for o in organic):  # Google's own map or search links are the local pack, not a competitor's page: they are not scored as one
            features["Local pack"] = True
            organic = [o for o in organic if o["site"] != "google.com"]
        return {"organic": organic, "questions": [q.get("question") for q in (j.get("related_questions") or []) if q.get("question")],
                "related": [q.get("query") for q in (j.get("related_searches") or []) if q.get("query")],
                "ads": [{"title": a.get("title") or "", "url": a.get("link") or a.get("displayed_link") or "", "site": site_of(a.get("link") or a.get("displayed_link") or ""),
                         "description": (a.get("description") or a.get("snippet") or "")[:240]} for a in (j.get("ads") or [])],
                "ai_overview": ai, "ai_links": ai_refs, "features": features, "counts": {"ads": len(j.get("ads") or []), "pla": len(j.get("shopping_results") or [])}}
    return None


def serp(keyword: str, country: str, location: str | None = None) -> dict[str, Any]:
    """What Google shows for the keyword right now: {organic: [{position, title, url, site, description}], questions, related, ads: [{title, url, description}], ai_overview}. Not kept.
    Serper answers in about a second when it has credit. Otherwise Apify's Google scraper is used: most runs take 60 to 90 seconds but some take several minutes, so after HEDGE_AFTER seconds a second run is started and whichever ends first is used."""
    from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait  # noqa: PLC0415
    fast = _serper(keyword, country, location)
    if fast:
        return fast
    from concurrent.futures import ThreadPoolExecutor  # noqa: PLC0415
    with ThreadPoolExecutor(max_workers=2) as ex:  # the results with their real addresses, and the rest of the page (features, questions, ads), read together
        f_org, f_page = ex.submit(_lofo, keyword, country, 10), ex.submit(_badger, keyword, country, location, 10)
        organic, page = f_org.result(), f_page.result()
    usable = [o for o in (page or {}).get("organic", []) if o["site"] and "google." not in o["site"]]
    applied = None
    if location and page and len(usable) >= 6:  # a place was asked for: the place-aware reader is used when it gave enough real results
        organic, applied = usable[:10], True
    elif location:
        applied = False  # the results are for the whole country: the reader that gives real addresses has no place setting
    if organic and len(organic) >= 3:
        base = page or {"questions": [], "related": [], "ads": [], "ai_overview": False}
        return {**base, "organic": organic[:10], "location_applied": applied}
    if page and len(usable) >= 3:
        return {**page, "organic": usable[:10], "location_applied": applied}
    tokens = [t for _i, t in apify_metrics.keys()]
    if not tokens:
        raise DifficultyError("Apify is not connected (APIFY_KEY): the Google results cannot be read.")
    last = ""
    for tok in tokens:
        ex = ThreadPoolExecutor(max_workers=2)
        try:
            pending = {ex.submit(_apify_once, tok, keyword, country)}
            done, pending = wait(pending, timeout=HEDGE_AFTER, return_when=FIRST_COMPLETED)
            if not done:
                pending.add(ex.submit(_apify_once, tok, keyword, country))
            while True:
                if done:
                    for f in done:
                        res, err = f.result()
                        if res:
                            return res
                        last = err
                if not pending:
                    break
                done, pending = wait(pending, return_when=FIRST_COMPLETED)
        finally:
            ex.shutdown(wait=False, cancel_futures=True)  # the slower run is left to end by itself
    raise DifficultyError(last or "Apify gave no results.")


COMMERCIAL = ("best", "top", "review", "compare", "vs", "services", "service", "company", "companies", "agency", "agencies", "provider", "alternative", "pricing", "plans")
TRANSACTIONAL = ("buy", "price", "prices", "pricing", "cost", "hire", "quote", "order", "book", "near me", "cheap", "free trial", "get started", "contact us", "demo")
UA = "Mozilla/5.0 (compatible; bevisibe-research/1.0)"


def _modified(headers: Any, soup: Any) -> Any:
    """When the page says it was last updated: a meta tag, the page's structured data, or the Last-Modified header."""
    import re  # noqa: PLC0415
    from datetime import datetime, timezone  # noqa: PLC0415
    from email.utils import parsedate_to_datetime  # noqa: PLC0415
    cands = []
    for sel in ({"property": "article:modified_time"}, {"property": "og:updated_time"}, {"itemprop": "dateModified"}, {"property": "article:published_time"}):
        m = soup.find("meta", attrs=sel)
        if m and m.get("content"):
            cands.append(m["content"])
    j = re.search(r'"dateModified"\s*:\s*"([^"]+)"', str(soup))
    if j:
        cands.append(j.group(1))
    if headers.get("last-modified"):
        cands.append(headers["last-modified"])
    for c in cands:
        try:
            d = datetime.fromisoformat(c.replace("Z", "+00:00"))
        except ValueError:
            try:
                d = parsedate_to_datetime(c)
            except (TypeError, ValueError):
                continue
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    return None


def page_signals(url: str, keyword: str) -> dict[str, Any]:
    """What one top-10 page itself shows (read directly): its length, whether its title or main heading carries the keyword, and when it was last updated. {} when the page cannot be read."""
    from datetime import datetime, timezone  # noqa: PLC0415
    from bs4 import BeautifulSoup  # noqa: PLC0415
    try:
        r = httpx.get(url, headers={"User-Agent": UA}, timeout=8, follow_redirects=True)
        if r.status_code != 200 or "html" not in r.headers.get("content-type", ""):
            return {}
        soup = BeautifulSoup(r.text, "html.parser")
    except Exception:  # noqa: BLE001 -- a page that cannot be read is simply unknown
        return {}
    words = [w for w in keyword.lower().split() if len(w) > 2]
    head = ((soup.title.string if soup.title and soup.title.string else "") + " " + " ".join(h.get_text(" ") for h in soup.find_all("h1"))).lower()
    mod = _modified(r.headers, soup)
    for x in soup(["script", "style", "nav", "footer", "header", "noscript"]):
        x.decompose()
    return {"words": len(soup.get_text(" ").split()), "relevant": bool(words) and all(w in head for w in words), "age_days": (datetime.now(timezone.utc) - mod).days if mod else None}


def intent_scores(rows: list[dict[str, Any]], ads: list[dict[str, Any]]) -> dict[str, int]:
    """How commercial, transactional and navigational the results page is, from the titles and descriptions Google shows (and whether ads run). KI = 0.4 C + 0.4 T + 0.2 N."""
    n = max(1, len(rows))
    txt = [f"{r['title']} {r['description']}".lower() for r in rows]
    com = 100 * sum(1 for x in txt if any(w in x for w in COMMERCIAL)) / n
    tra = 100 * sum(1 for x in txt if any(w in x for w in TRANSACTIONAL)) / n
    if ads:
        com, tra = min(100, com + 20), min(100, tra + 20)
    nav = 100 * sum(1 for r in rows if r["site"].split(".")[0] and r["site"].split(".")[0] in " ".join(r["title"].lower().split()[:4]).replace(" ", "")) / n
    return {"commercial": round(com), "transactional": round(tra), "navigational": round(nav), "ki": round(0.4 * com + 0.4 * tra + 0.2 * nav)}


MIN_LINKS = 5  # fewer saved links than this say nothing about a site's profile
IBQ_WEIGHTS = {"DQ": 0.30, "TR": 0.25, "LF": 0.20, "LP": 0.15, "LH": 0.10}
FOLLOW_SCORE = {"dofollow": 100, "ugc": 40, "nofollow": 30, "sponsored": 20}
PLACEMENT_SCORE = {"body": 100, "content": 100, "contextual": 100, "author": 70, "bio": 70, "sidebar": 40, "footer": 20}
HEALTH_SCORE = {"LIVE": 100, "REDIRECTED": 60, "BROKEN": 0, "LOST": 0, "REMOVED": 0}


def _mean(xs: list[float]) -> float | None:
    return sum(xs) / len(xs) if xs else None


def _follow(link_type: str | None, rel: list[str]) -> int:
    rel = {str(r).lower() for r in rel}
    if "sponsored" in rel:
        return FOLLOW_SCORE["sponsored"]
    if "ugc" in rel:
        return FOLLOW_SCORE["ugc"]
    if "nofollow" in rel or link_type == "nofollow":
        return FOLLOW_SCORE["nofollow"]
    return FOLLOW_SCORE["dofollow"]


def _place(placement: str | None) -> int | None:
    p = (placement or "").lower()
    return next((v for k, v in PLACEMENT_SCORE.items() if k in p), None) if p else None


def link_profile(sites: list[str], keyword: str) -> dict[str, dict[str, Any]]:
    """The Importance-weighted Backlink Quality of the sites that rank, from the links our own crawler saved for them (a site with fewer than MIN_LINKS saved links gets nothing):
    IBQ = 0.30 DQ + 0.25 TR + 0.20 LF + 0.15 LP + 0.10 LH, where
      DQ  domain quality of the linking sites: their Domain Authority and (100 - 6 x spam score), from Moz
      TR  topic relevance: how often the link's anchor text carries the keyword
      LF  link follow: dofollow 100, UGC 40, nofollow 30, sponsored 20
      LP  link placement: body 100, author bio 70, sidebar 40, footer 20 (placement is not saved yet, so this is usually missing)
      LH  link health: live 100, redirected 60, broken or lost 0
    A factor with no data is left out and the others are scaled to 100%. Returns {site: {links, dq, tr, lf, lp, lh, ibq, dofollow}}."""
    from sqlalchemy import select  # noqa: PLC0415
    from sqlalchemy.orm import aliased  # noqa: PLC0415

    from ..backlinks.models import Backlink, BiDomain, BiDomainMetric  # noqa: PLC0415
    from ..db import SessionLocal  # noqa: PLC0415
    words = [w for w in keyword.lower().split() if len(w) > 2]
    db = SessionLocal()
    try:
        src = aliased(BiDomain)
        rows = db.execute(select(BiDomain.registrable_domain, Backlink.link_type, Backlink.rel_attributes, Backlink.anchor_text, Backlink.placement, Backlink.current_status,
                                 BiDomainMetric.da, BiDomainMetric.spam_score)
                          .join(Backlink, Backlink.target_domain_id == BiDomain.id).join(src, src.id == Backlink.source_domain_id)
                          .outerjoin(BiDomainMetric, BiDomainMetric.domain == src.registrable_domain)
                          .where(BiDomain.registrable_domain.in_(sites or [""]))).all()
        by: dict[str, list[Any]] = {}
        for r in rows:
            by.setdefault(r[0], []).append(r[1:])
        out: dict[str, dict[str, Any]] = {}
        for site, links in by.items():
            if len(links) < MIN_LINKS:
                continue
            dq = _mean([(da + (100 - min(100, (spam or 0) * 6))) / 2 for _lt, _rel, _a, _pl, _st, da, spam in links if da is not None])
            anchored = [a.lower() for _lt, _rel, a, _pl, _st, _da, _sp in links if a]
            tr = 100 * sum(1 for a in anchored if words and any(w in a for w in words)) / len(anchored) if anchored else None
            lf = _mean([_follow(lt, rel or []) for lt, rel, *_r in links])
            lp = _mean([v for v in (_place(pl) for _lt, _rel, _a, pl, *_r in links) if v is not None])
            lh = _mean([HEALTH_SCORE[st] for *_h, st, _da, _sp in links if st in HEALTH_SCORE])
            f = {"DQ": dq, "TR": tr, "LF": lf, "LP": lp, "LH": lh}
            live = [(IBQ_WEIGHTS[k], v) for k, v in f.items() if v is not None]
            ibq = sum(w * v for w, v in live) / sum(w for w, _ in live) if live else None
            out[site] = {"links": len(links), **{k.lower(): round(v) if v is not None else None for k, v in f.items()}, "ibq": round(ibq) if ibq is not None else None,
                         "dofollow": round(100 * sum(1 for lt, rel, *_r in links if _follow(lt, rel or []) == 100) / len(links))}
        return out
    except Exception as exc:  # noqa: BLE001 -- the saved links being unreachable only means no figures
        log.warning("link profile unavailable: %r", exc)
        db.rollback()
        return {}
    finally:
        db.close()


def authority_score(da: int | None, rd: int | None, spam: int | None, rk: int | None) -> int | None:
    """Our Authority Score, 0 to 100: how reputable a site is, from the number of sites linking to it (30%), their quality as Domain Authority (35%), how many keywords it ranks for on Google,
    a measure of its organic presence (25%), and how authentic its profile is, from its spam score (10%). A part with no figure is left out and the rest are scaled to 100%."""
    if da is None:
        return None
    parts = [(0.35, float(da))]
    if rd is not None:
        parts.append((0.30, _log_scale(rd, 1_000_000)))
    if rk is not None:
        parts.append((0.25, _log_scale(rk, 10_000_000)))
    if spam is not None:
        parts.append((0.10, max(0.0, 100 - spam * 6)))
    return round(sum(w * v for w, v in parts) / sum(w for w, _ in parts))


def _log_scale(v: float, top: float) -> float:
    return min(100.0, 100 * math.log(1 + max(v, 0)) / math.log(1 + top))


def _volume(keyword: str, country: str, geo: str | None = None) -> int | None:
    from . import google_ads_client as ads  # noqa: PLC0415
    try:
        return (ads.historical_metrics([keyword], geo_target=geo or ads.geo_target_for(country)).get(keyword) or {}).get("volume")
    except Exception:  # noqa: BLE001 -- no volume only leaves SV out
        return None


def score(keyword: str, country: str, volume: int | None = None, use_cache: bool = False, location: str | None = None, geo: str | None = None, domain: str | None = None) -> dict[str, Any]:
    from app.services.fanout import ThreadPoolExecutor  # noqa: PLC0415
    with ThreadPoolExecutor(max_workers=2) as ex:  # the volume is asked while Google's results page is read
        vol = ex.submit(_volume, keyword, country, geo) if volume is None else None
        page = serp(keyword, country, location)
        volume = vol.result() if vol else volume
    sites = list(dict.fromkeys(o["site"] for o in page["organic"] if o["site"]))
    mine = site_of(f"https://{domain}") if domain else None
    metrics = {x["domain"]: x.get("scores") for x in apify_metrics.check(sites + ([mine] if mine and mine not in sites else []), force=not use_cache, save=use_cache)}  # afresh and not kept, unless the caller (a list of many keywords) accepts a day-old authority figure
    rows = []
    for o in page["organic"]:
        m = metrics.get(o["site"]) or {}
        rows.append({**o, "da": m.get("da"), "pa": m.get("pa"), "rd": m.get("rd"), "spam": m.get("spam"), "rk": m.get("rk"), "as": authority_score(m.get("da"), m.get("rd"), m.get("spam"), m.get("rk"))})
    from app.services.fanout import ThreadPoolExecutor  # noqa: PLC0415
    with ThreadPoolExecutor(max_workers=8) as pool:  # the pages are read together
        for r, sig in zip(rows, pool.map(lambda r: page_signals(r["url"], keyword), rows)):
            r.update({"words": sig.get("words"), "relevant": sig.get("relevant"), "age_days": sig.get("age_days")})
    read = [r for r in rows if r.get("words")]
    relevance = 100 * sum(1 for r in read if r["relevant"]) / len(read) if read else None
    quality = sum(min(100, r["words"] / 20) for r in read) / len(read) if read else None  # 2,000 words = 100
    dated = [r for r in read if r["age_days"] is not None]
    freshness = 100 * sum(1 for r in dated if r["age_days"] <= 365) / len(dated) if dated else None
    cc_parts = [(relevance, 0.40), (quality, 0.35), (freshness, 0.25)]
    live = [(v, w) for v, w in cc_parts if v is not None]
    cc = sum(v * w for v, w in live) / sum(w for _, w in live) if live else None
    profiles = link_profile(sites, keyword)
    for r in rows:
        pr = profiles.get(r["site"]) or {}
        r.update({"links_saved": pr.get("links"), "backlinks": pr.get("links"), "dofollow": pr.get("dofollow"), "ibq": pr.get("ibq")})
    covered = [profiles[r["site"]] for r in rows if r["site"] in profiles and profiles[r["site"]].get("ibq") is not None]
    bq_each = [x["ibq"] for x in covered]
    bq = sum(bq_each) / len(bq_each) if bq_each else None
    bq_parts = {k: (round(m) if (m := _mean([x[k.lower()] for x in covered if x.get(k.lower()) is not None])) is not None else None) for k in IBQ_WEIGHTS}
    known = [r for r in rows if r["da"] is not None]
    avg = lambda k: (sum(r[k] for r in known if r[k] is not None) / max(1, sum(1 for r in known if r[k] is not None))) if known else None  # noqa: E731
    da, pa = avg("da"), avg("pa")
    rds = [r["rd"] for r in known if r["rd"] is not None]
    rd_score = sum(_log_scale(x, RD_TOP) for x in rds) / len(rds) if rds else None
    parts = [x for x in (da, pa, rd_score) if x is not None]
    authority = sum(parts) / len(parts) if parts else None
    features = page.get("features") or {"Ads": bool(page["ads"]), "People also ask": bool(page["questions"]), "AI overview": page["ai_overview"]}  # the fast reader sees seven or eight features, the others three
    feature_comp = 100 * sum(features.values()) / len(features)
    top10 = 100 * sum(1 for r in known if r["da"] >= STRONG_DA) / len(known) if known else None
    sc = round(0.5 * authority + 0.25 * feature_comp + 0.25 * top10) if authority is not None and top10 is not None else None
    ki = intent_scores(page["organic"], page["ads"])
    sv = _log_scale(volume, VOLUME_BENCHMARK) if volume else None
    # KEYWORD_DIFFICULTY = 0.25 RD + 0.10 DA + 0.10 PA + 0.15 BQ + 0.10 CC + 0.05 SV + 0.15 SC + 0.10 KI, each part on 0-100.
    # A part we hold no data for (BQ needs saved links for three or more of the sites) is left out and the weights of the others are scaled up to 100%: nothing is made up for it.
    parts = [("RD", "Referring domains", 0.25, rd_score), ("DA", "Domain Authority", 0.10, da), ("PA", "Page Authority", 0.10, pa),
             ("BQ", "Backlink quality", 0.15, bq if len(bq_each) >= 3 else None), ("CC", "Content competition", 0.10, cc), ("SV", "Search volume", 0.05, sv),
             ("SC", "SERP competition", 0.15, sc), ("KI", "Keyword intent", 0.10, ki["ki"])]
    used = [(w, v) for _k, _n, w, v in parts if v is not None]
    kd = round(sum(w * v for w, v in used) / sum(w for w, _ in used)) if used else None
    formula = [{"key": k, "name": n, "weight": round(w * 100), "value": round(v) if v is not None else None, "used": v is not None} for k, n, w, v in parts]
    return {
        "score": kd, "sc": sc, "location": location, "ai_links": page.get("ai_links") or [], "location_applied": page.get("location_applied"), "serp_counts": page.get("counts") or {"ads": len(page["ads"]), "pla": None},
        "you": ({"domain": mine, "da": (metrics.get(mine) or {}).get("da"), "pa": (metrics.get(mine) or {}).get("pa"), "rd": (metrics.get(mine) or {}).get("rd"), "top_da": round(da) if da is not None else None,
                 "top_pa": round(pa) if pa is not None else None} if mine and metrics.get(mine) else None),
        "content": {"cc": round(cc) if cc is not None else None, "relevance": round(relevance) if relevance is not None else None, "quality": round(quality) if quality is not None else None,
                    "freshness": round(freshness) if freshness is not None else None, "pages_read": len(read), "avg_words": round(sum(r["words"] for r in read) / len(read)) if read else None},
        "intent": ki, "formula": formula, "weight_used": round(100 * sum(w for w, _ in used)),
        "backlinks": {"bq": round(bq) if bq is not None else None, "sites_with_links": len(bq_each), "counted": len(bq_each) >= 3, "parts": bq_parts}, "sites_with_figures": len(known), "sites": len(rows),
        "components": {"authority_strength": round(authority) if authority is not None else None, "avg_da": round(da) if da is not None else None, "avg_pa": round(pa) if pa is not None else None,
                       "median_rd": round(sorted(rds)[len(rds) // 2]) if rds else None, "serp_features": round(feature_comp), "features": features, "top10_strength": round(top10) if top10 is not None else None,
                       "sv": round(sv) if sv is not None else None},
        "organic": rows, "questions": page["questions"], "related": page["related"], "ads": page["ads"],
        "note": "Difficulty = 0.25 RD + 0.10 DA + 0.10 PA + 0.15 BQ + 0.10 CC + 0.05 SV + 0.15 SC + 0.10 KI. A part with no data is left out and the rest are scaled to 100%. Page Authority is the home page's.",
    }
