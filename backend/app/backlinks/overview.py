"""The backlink overview of the project's own website, read from what our backlink crawler stored for it.

Every number is counted from real links the crawler found (who links, to which page, with which anchor and follow type, when it was first and last seen), with Domain Authority and spam
score from Moz (through Apify) where we have it, the site's own search clicks from Google Search Console, and the address of each linking site looked up in DNS. What the crawler has not seen
(links of sites it does not read) is not in it: the figures are for the links we know, and the page says so.
"""
from __future__ import annotations

import logging
import math
import socket
import time
from collections import Counter, defaultdict
from concurrent.futures import TimeoutError as FutureTimeout
from app.services.fanout import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from ..db import release_connection
from ..models import Business
from . import hub
from .models import Backlink, BiDomain

log = logging.getLogger("seo.backlink_overview")
COUNTRY_TLDS = {"in": "India", "uk": "United Kingdom", "us": "United States", "de": "Germany", "fr": "France", "au": "Australia", "ca": "Canada", "ae": "United Arab Emirates", "sg": "Singapore",
                "it": "Italy", "es": "Spain", "nl": "Netherlands", "br": "Brazil", "ru": "Russia", "jp": "Japan", "cn": "China", "pk": "Pakistan", "bd": "Bangladesh", "id": "Indonesia",
                "tr": "Turkey", "mx": "Mexico", "za": "South Africa", "ng": "Nigeria", "ke": "Kenya", "my": "Malaysia", "ph": "Philippines", "pl": "Poland", "se": "Sweden", "ch": "Switzerland"}
_ip_cache: dict[str, tuple[float, str | None]] = {}
IP_TTL = 6 * 3600


def _log(v: float, top: float) -> float:
    return min(100.0, 100 * math.log(1 + max(v, 0)) / math.log(1 + top))


def _month(iso: str | None) -> str | None:
    return iso[:7] if iso else None


def _ip_of(host: str) -> str | None:
    hit = _ip_cache.get(host)
    if hit and time.time() - hit[0] < IP_TTL:
        return hit[1]
    try:
        ip = socket.getaddrinfo(host, None, socket.AF_INET)[0][4][0]
    except OSError:
        ip = None
    _ip_cache[host] = (time.time(), ip)
    return ip


def _ips(domains: list[str]) -> dict[str, str | None]:
    """Where each linking site is hosted (its IPv4 address in DNS), looked up together; a site that does not answer in time is left out."""
    out: dict[str, str | None] = {}
    ex = ThreadPoolExecutor(max_workers=24)
    futures = {d: ex.submit(_ip_of, d) for d in domains[:300]}
    deadline = time.time() + 14
    for d, f in futures.items():
        try:
            out[d] = f.result(timeout=max(0.1, deadline - time.time()))
        except FutureTimeout:
            out[d] = None
    ex.shutdown(wait=False, cancel_futures=True)
    return out


def _gsc_context(db: Session, b: Business) -> tuple[Any, str] | None:
    """The Search Console client and property of the project's site, or None. It reads `db`, so it runs on the thread that owns the session (the request's), never in a worker.
    What it returns is plain (a client built from the account's id and stored token, and the property's name)."""
    try:
        from ..services import google_rank, gsc_access, organic_rankings  # noqa: PLC0415
        host = google_rank.host_of(b.website)
        if not host:
            return None
        state, _msg, sc, site = gsc_access.search_console(db, b, host)
        if state != "ok":
            return None
        return organic_rankings.plain_search_console(sc), site
    except Exception as exc:  # noqa: BLE001 -- without Search Console the organic traffic is simply not shown
        log.info("search console clicks unavailable: %r", exc)
        return None


def _gsc_clicks_of(ctx: tuple[Any, str] | None) -> int | None:
    """Clicks from Google to the site in the last 28 days (Search Console): its organic traffic. Uses no database session, so it may run in a worker thread."""
    if ctx is None:
        return None
    try:
        from ..services import gsc  # noqa: PLC0415
        sc, site = ctx
        end = date.today() - timedelta(days=gsc.LAG_DAYS)
        rows = sc.query(site, gsc._body(end - timedelta(days=27), end, None, 1, None))
        return int(rows[0].get("clicks") or 0) if rows else 0
    except Exception as exc:  # noqa: BLE001 -- without Search Console the organic traffic is simply not shown
        log.info("search console clicks unavailable: %r", exc)
        return None


def _gsc_clicks(db: Session, b: Business) -> int | None:
    """Clicks from Google to the site in the last 28 days (Search Console): its organic traffic."""
    return _gsc_clicks_of(_gsc_context(db, b))


def _similar(db: Session, domain: str, sources: list[str]) -> list[dict[str, Any]]:
    """Other sites in the crawler whose links come from the same websites as ours: the sites with a similar backlink profile."""
    if not sources:
        return []
    SD, TD = aliased(BiDomain), aliased(BiDomain)
    shared = db.execute(select(TD.registrable_domain, func.count(func.distinct(SD.registrable_domain))).select_from(Backlink).join(SD, SD.id == Backlink.source_domain_id)
                        .join(TD, TD.id == Backlink.target_domain_id).where(SD.registrable_domain.in_(sources), TD.registrable_domain != domain, Backlink.current_status.in_(hub.LIVE_STATES))
                        .group_by(TD.registrable_domain).order_by(func.count(func.distinct(SD.registrable_domain)).desc()).limit(8)).all()
    out = []
    for site, n in shared:
        total = db.scalar(select(func.count(func.distinct(Backlink.source_domain_id))).select_from(Backlink).join(TD, TD.id == Backlink.target_domain_id).where(TD.registrable_domain == site, Backlink.current_status.in_(hub.LIVE_STATES)))
        out.append({"domain": site, "shared": int(n), "referring_domains": int(total or 0), "share": round(100 * n / max(1, len(sources)))})
    return out


CHEAP_TLDS = {"shop", "site", "online", "xyz", "top", "click", "icu", "buzz", "cyou", "work", "space", "website", "store", "tech", "live"}


def _graph_verdict(ref: list[dict[str, Any]], scores: dict[str, Any], ips: dict[str, str | None], tlds: Counter, live_links: int, toxic: int) -> dict[str, Any]:
    """Is the group of linking sites natural? Reasons, each good or bad, from real counts: risky sites, many sites on one server block, a crowd of cheap endings, and links piled on a few sites."""
    n = max(1, len(ref))
    risky = round(100 * toxic / n)
    by_subnet = Counter(".".join(ips[d["domain"]].split(".")[:3]) for d in ref if ips.get(d["domain"]))
    crowded = max(by_subnet.values()) if by_subnet else 0
    cheap = round(100 * sum(v for k, v in tlds.items() if k in CHEAP_TLDS) / n)
    heavy = max((d["live"] for d in ref), default=0)
    heavy_share = round(100 * heavy / max(1, live_links))
    reasons = [
        {"ok": risky < 15, "text": f"{risky}% of the linking sites look risky"},
        {"ok": crowded < 4, "text": f"{crowded} linking site{'s' if crowded != 1 else ''} share one server block" + (": possible link network" if crowded >= 4 else "")},
        {"ok": cheap < 30, "text": f"{cheap}% of the linking sites end in a cheap, much-abused ending (.shop, .site, .online)"},
        {"ok": heavy_share < 50, "text": f"One site gives {heavy_share}% of all the links" + (": sitewide links" if heavy_share >= 50 else "")},
    ]
    bad = sum(1 for r in reasons if not r["ok"])
    verdict = "Dangerous" if risky >= 30 or bad >= 3 else "Suspicious" if bad else "Good"
    cats = Counter(d["cats"].most_common(1)[0][0] for d in ref)
    return {"verdict": verdict, "reasons": reasons, "categories": [{"label": k, "domains": v, "share": round(100 * v / n)} for k, v in cats.most_common(6)]}


def overview(db: Session, b: Business) -> dict[str, Any]:
    domain = hub.own_domain(db, b.id)
    if not domain:
        return {"state": "no_target", "domain": None}
    from ..services import keyword_difficulty as kd  # noqa: PLC0415
    from ..services import url_overview as uo  # noqa: PLC0415
    from . import quality  # noqa: PLC0415
    rows = hub.links(db, b, status="all", limit=hub.MAX_LINKS)["links"]
    live = [x for x in rows if x["is_live"]]
    now = datetime.now(timezone.utc)
    with ThreadPoolExecutor(max_workers=3) as pool:
        f_auth = pool.submit(uo.authority, domain)
        f_clicks = pool.submit(_gsc_clicks_of, _gsc_context(db, b))  # the account is looked up on this thread (it reads `db`); the worker gets plain values only
        release_connection(db)  # `rows` are read: no connection is held while Moz, Search Console and the DNS lookups are waited for
        doms: dict[str, dict[str, Any]] = {}
        for x in rows:
            d = doms.setdefault(x["source_domain"], {"domain": x["source_domain"], "links": 0, "live": 0, "first": None, "last": None, "cats": Counter(), "da": None, "pa": None, "spam": None})
            d["links"] += 1
            d["live"] += 1 if x["is_live"] else 0
            if x["first_seen"] and (d["first"] is None or x["first_seen"] < d["first"]):
                d["first"] = x["first_seen"]
            if x["last_seen"] and (d["last"] is None or x["last_seen"] > d["last"]):
                d["last"] = x["last_seen"]
            d["cats"][x["category"]["label"]] += 1
            m = x.get("metrics") or {}
            d["da"], d["pa"], d["spam"] = (m.get("da") if m.get("da") is not None else d["da"]), (m.get("pa") if m.get("pa") is not None else d["pa"]), (m.get("spam") if m.get("spam") is not None else d["spam"])
        ref = [d for d in doms.values() if d["live"]]
        ips = _ips([d["domain"] for d in ref])
        authority, clicks = f_auth.result(), f_clicks.result()
    scores = quality.scores_for(db, b.id)

    # ------------------------------------------------------------------ the strip
    since = (now - timedelta(days=30)).isoformat()
    new_doms_30 = sum(1 for d in ref if d["first"] and d["first"] >= since)
    new_links_30 = sum(1 for x in live if x["first_seen"] and x["first_seen"] >= since)
    follow = Counter(x["follow"] for x in live)
    follow_share = round(100 * follow.get("dofollow", 0) / len(live)) if live else None
    risk = [scores[d["domain"]]["risk"] for d in ref if d["domain"] in scores]
    toxic = sum(1 for d in ref if scores.get(d["domain"], {}).get("verdict") == "risky")
    spam = [d["spam"] for d in ref if d["spam"] is not None]
    # ------------------------------------------------------------------ authority score and its three parts
    own = authority if authority and not authority.get("error") else None
    rd_total = (own or {}).get("rd") or len(ref)
    a_score = kd.authority_score((own or {}).get("da"), (own or {}).get("rd") or len(ref), (own or {}).get("spam"), (own or {}).get("ranking_keywords")) if own else None
    anchor_types = Counter(x["anchor_type"] for x in live)
    exact = round(100 * anchor_types.get("money", 0) / len(live)) if live else 0
    link_power = round(0.5 * ((own or {}).get("da") or 0) + 0.5 * _log(rd_total, 1_000_000))
    organic = round(_log((own or {}).get("ranking_keywords") or 0, 10_000_000)) if own and own.get("ranking_keywords") else round(_log(clicks or 0, 100_000))
    natural = max(0, min(100, round(100 - max(0, (follow_share or 0) - 90) * 3 - max(0, exact - 10) * 2 - (sum(spam) / len(spam) * 3 if spam else 0))))
    weakest = min((("Lacks link power", link_power), ("Lacks organic traffic", organic), ("Unnatural profile", natural)), key=lambda t: t[1])
    # ------------------------------------------------------------------ over time (by the month a link was first seen)
    months: list[str] = []
    first_all = [_month(x["first_seen"]) for x in rows if x["first_seen"]]
    if first_all:
        y, m = int(min(first_all)[:4]), int(min(first_all)[5:7])
        while (y, m) <= (now.year, now.month) and len(months) < 60:
            months.append(f"{y}-{m:02d}")
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    months = months[-36:]
    series = []
    for mo in months:
        series.append({"month": mo,
                       "domains": sum(1 for d in ref if d["first"] and _month(d["first"]) <= mo),
                       "backlinks": sum(1 for x in rows if x["first_seen"] and _month(x["first_seen"]) <= mo and (x["is_live"] or (x["last_seen"] and _month(x["last_seen"]) > mo))),
                       "new_links": sum(1 for x in rows if _month(x["first_seen"]) == mo), "lost_links": -sum(1 for x in rows if not x["is_live"] and _month(x["last_seen"]) == mo),
                       "new_domains": sum(1 for d in doms.values() if _month(d["first"]) == mo), "lost_domains": -sum(1 for d in doms.values() if not d["live"] and _month(d["last"]) == mo)})
    # ------------------------------------------------------------------ the breakdowns
    cats = Counter(d["cats"].most_common(1)[0][0] for d in ref)
    anchors = Counter(x["anchor"] for x in live if x["anchor"])
    anchor_info: dict[str, dict[str, Any]] = {}
    for x in live:
        if x["anchor"]:
            e = anchor_info.setdefault(x["anchor"], {"domains": set(), "type": x["anchor_type"], "follow": 0, "first": None, "last": None})
            e["domains"].add(x["source_domain"])
            e["follow"] += 1 if x["follow"] == "dofollow" else 0
            if x["first_seen"] and (e["first"] is None or x["first_seen"] < e["first"]):
                e["first"] = x["first_seen"]
            if x["last_seen"] and (e["last"] is None or x["last_seen"] > e["last"]):
                e["last"] = x["last_seen"]
    buckets = [(lo, lo + 10) for lo in range(0, 100, 10)]
    by_as = [{"range": f"{lo + 1 if lo else 0} - {hi}", "domains": sum(1 for d in ref if d["da"] is not None and (lo < d["da"] <= hi or (lo == 0 and d["da"] == 0)))} for lo, hi in buckets][::-1]
    tlds = Counter(d["domain"].rsplit(".", 1)[-1] for d in ref)
    countries = Counter(COUNTRY_TLDS[t] for t in (d["domain"].rsplit(".", 1)[-1] for d in ref) if t in COUNTRY_TLDS)
    ipset = {ips.get(d["domain"]) for d in ref if ips.get(d["domain"])}
    subnets = {".".join(i.split(".")[:3]) for i in ipset}
    pages: dict[str, dict[str, Any]] = defaultdict(lambda: {"domains": set(), "links": 0, "follow": 0})
    for x in live:
        p = pages[x["target_url"]]
        p["domains"].add(x["source_domain"])
        p["links"] += 1
        p["follow"] += 1 if x["follow"] == "dofollow" else 0
    n = max(1, len(ref))
    return {
        "state": "ok", "domain": domain, "as_of": now.isoformat(),
        "totals": {"referring_domains": len(ref), "backlinks": len(live), "lost_backlinks": len(rows) - len(live), "new_domains_30d": new_doms_30, "new_links_30d": new_links_30,
                   "domains_change": round(100 * new_doms_30 / (len(ref) - new_doms_30)) if ref and len(ref) > new_doms_30 else None,  # no change is shown when every link is new (there is nothing earlier to compare with)
                   "links_change": round(100 * new_links_30 / (len(live) - new_links_30)) if live and len(live) > new_links_30 else None,
                   "organic_clicks_28d": clicks, "toxicity": round(sum(risk) / len(risk)) if risk else None, "toxic_domains": toxic, "judged_domains": len(risk)},
        "authority": {"score": a_score, "da": (own or {}).get("da"), "rd": (own or {}).get("rd"), "ranking_keywords": (own or {}).get("ranking_keywords"), "spam": (own or {}).get("spam"), "error": (authority or {}).get("error") if authority else None,
                      "radar": {"link_power": link_power, "organic_traffic": organic, "natural_profile": natural}, "verdict": weakest[0] if weakest[1] < 40 else "Balanced"},
        "series": series,
        "categories": [{"label": k, "domains": v, "share": round(100 * v / n)} for k, v in cats.most_common(8)],
        "anchors": [{"text": k, "count": v, "domains": len(anchor_info[k]["domains"]), "type": anchor_info[k]["type"], "follow": anchor_info[k]["follow"], "first_seen": anchor_info[k]["first"], "last_seen": anchor_info[k]["last"]} for k, v in anchors.most_common(300)], "anchor_types": dict(anchor_types),
        "by_authority": by_as, "authority_known": sum(1 for d in ref if d["da"] is not None), "authority_unknown": sum(1 for d in ref if d["da"] is None),
        "follow": {"follow": follow.get("dofollow", 0), "nofollow": follow.get("nofollow", 0), "sponsored": follow.get("sponsored", 0), "ugc": follow.get("ugc", 0), "total": len(live), "follow_share": follow_share},
        "tlds": [{"tld": k, "domains": v, "share": round(100 * v / n)} for k, v in tlds.most_common(5)] + ([{"tld": "other", "domains": sum(tlds.values()) - sum(v for _k, v in tlds.most_common(5)), "share": round(100 * (sum(tlds.values()) - sum(v for _k, v in tlds.most_common(5))) / n)}] if len(tlds) > 5 else []),
        "countries": [{"country": k, "domains": v, "share": round(100 * v / n)} for k, v in countries.most_common(8)], "country_domains": sum(countries.values()),
        "profile": {"domains": len(ref), "ips": len(ipset), "subnets": len(subnets), "resolved": sum(1 for d in ref if ips.get(d["domain"]))},
        "similar": _similar(db, domain, [d["domain"] for d in ref]),
        "pages": [{"url": u, "domains": len(p["domains"]), "links": p["links"], "follow": p["follow"]} for u, p in sorted(pages.items(), key=lambda kv: (-len(kv[1]["domains"]), -kv[1]["links"]))[:200]],
        "network": [{"domain": d["domain"], "links": d["live"], "risk": scores.get(d["domain"], {}).get("risk"), "verdict": scores.get(d["domain"], {}).get("verdict"), "category": d["cats"].most_common(1)[0][0], "da": d["da"]} for d in sorted(ref, key=lambda d: -d["live"])[:80]],
        "graph": _graph_verdict(ref, scores, ips, tlds, len(live), toxic),
    }


def outbound(db: Session, b: Business) -> dict[str, Any]:
    """The websites the project's own site links to, read now from its pages (the pages of the last website scan, up to 30): each site with how many links point to it, from how many pages, and how many
    of them are nofollow. Nothing is kept."""
    import re  # noqa: PLC0415
    from urllib.parse import urljoin, urlsplit  # noqa: PLC0415

    import httpx  # noqa: PLC0415
    from bs4 import BeautifulSoup  # noqa: PLC0415

    from ..services import keyword_difficulty as kd  # noqa: PLC0415
    from ..services import keyword_workspace  # noqa: PLC0415
    domain = hub.own_domain(db, b.id)
    if not domain:
        return {"state": "no_target"}
    crawl = keyword_workspace._latest_crawl(db, b)
    urls = [p["url"] for p in (crawl.get("pages") or []) if p.get("url") and p.get("status") == 200][:30] or [f"https://{domain}/"]

    def read(u: str) -> list[tuple[str, str, bool]]:
        try:
            r = httpx.get(u, headers={"User-Agent": "Mozilla/5.0 (compatible; bevisibe-research/1.0)"}, timeout=10, follow_redirects=True)
            if r.status_code != 200 or "html" not in r.headers.get("content-type", ""):
                return []
            soup = BeautifulSoup(r.text, "html.parser")
        except Exception:  # noqa: BLE001 -- a page that cannot be read adds nothing
            return []
        found = []
        for a in soup.find_all("a", href=True):
            href = urljoin(u, a["href"])
            if not re.match(r"^https?://", href):
                continue
            site = kd.site_of(href)
            if site and not site.rsplit(".", 1)[-1].isdigit() and site != kd.site_of(f"https://{domain}/"):
                found.append((site, " ".join(a.get_text(" ").split())[:80], "nofollow" in " ".join(a.get("rel") or []).lower() or "sponsored" in " ".join(a.get("rel") or []).lower()))
        return found
    with ThreadPoolExecutor(max_workers=8) as pool:
        per_page = list(pool.map(read, urls))
    sites: dict[str, dict[str, Any]] = {}
    for u, items in zip(urls, per_page):
        for site, text, nofollow in items:
            e = sites.setdefault(site, {"domain": site, "links": 0, "pages": set(), "nofollow": 0, "anchor": text})
            e["links"] += 1
            e["pages"].add(u)
            e["nofollow"] += 1 if nofollow else 0
            e["anchor"] = e["anchor"] or text
    rows = sorted(({"domain": e["domain"], "links": e["links"], "pages": len(e["pages"]), "nofollow": e["nofollow"], "anchor": e["anchor"]} for e in sites.values()), key=lambda r: (-r["pages"], -r["links"]))
    return {"state": "ok", "domain": domain, "pages_read": sum(1 for x in per_page if x is not None), "pages": len(urls), "domains": rows[:300], "total_links": sum(r["links"] for r in rows)}


def pages_report(db: Session, b: Business) -> dict[str, Any]:
    """Every page of the project's website the crawler or a link knows, with its backlinks and referring domains (from the links we hold) and, read now from the page itself, whether it loads,
    its title, and how many links it has inside the site and out to other sites. Nothing is kept."""
    import re  # noqa: PLC0415
    from urllib.parse import urljoin  # noqa: PLC0415

    import httpx  # noqa: PLC0415
    from bs4 import BeautifulSoup  # noqa: PLC0415

    from ..services import keyword_difficulty as kd  # noqa: PLC0415
    from ..services import keyword_workspace  # noqa: PLC0415
    from ..services import url_overview as uo  # noqa: PLC0415
    domain = hub.own_domain(db, b.id)
    if not domain:
        return {"state": "no_target"}
    rows = hub.links(db, b, status="all", limit=hub.MAX_LINKS)["links"]
    by: dict[str, dict[str, Any]] = {}
    for x in rows:
        if not x["is_live"]:
            continue
        e = by.setdefault(uo.norm(x["target_url"]), {"url": x["target_url"], "domains": set(), "links": 0, "last": None})
        e["domains"].add(x["source_domain"])
        e["links"] += 1
        if x["last_seen"] and (e["last"] is None or x["last_seen"] > e["last"]):
            e["last"] = x["last_seen"]
    crawl = keyword_workspace._latest_crawl(db, b)
    for p in crawl.get("pages") or []:
        if p.get("url"):
            by.setdefault(uo.norm(p["url"]), {"url": p["url"], "domains": set(), "links": 0, "last": None})
    items = sorted(by.values(), key=lambda e: (-len(e["domains"]), -e["links"], e["url"]))[:80]
    host = kd.site_of(f"https://{domain}/")

    def read(url: str) -> dict[str, Any]:
        try:
            r = httpx.get(url, headers={"User-Agent": "Mozilla/5.0 (compatible; bevisibe-research/1.0)"}, timeout=10, follow_redirects=True)
        except Exception:  # noqa: BLE001 -- a page that cannot be reached is a broken page
            return {"status": None, "title": None, "internal": 0, "external": 0}
        title, internal, external = None, 0, 0
        if r.status_code == 200 and "html" in r.headers.get("content-type", ""):
            soup = BeautifulSoup(r.text, "html.parser")
            title = (soup.title.string or "").strip() if soup.title and soup.title.string else None
            for a in soup.find_all("a", href=True):
                href = urljoin(url, a["href"])
                if not re.match(r"^https?://", href):
                    continue
                if kd.site_of(href) == host:
                    internal += 1
                else:
                    external += 1
        return {"status": r.status_code, "title": title, "internal": internal, "external": external}
    with ThreadPoolExecutor(max_workers=8) as pool:
        live = list(pool.map(lambda e: read(e["url"]), items))
    out = [{"url": e["url"], "domains": len(e["domains"]), "backlinks": e["links"], "last_seen": e["last"], **info, "broken": info["status"] is None or info["status"] >= 400} for e, info in zip(items, live)]
    return {"state": "ok", "domain": domain, "pages": out, "broken": sum(1 for r in out if r["broken"])}


TOXIC_FROM, POTENTIAL_FROM = 60, 30  # toxicity score (0-100) from which a site is toxic, and potentially toxic


def _toxicity(risk: int | None, spam: int | None, verdict: str | None) -> int | None:
    """How harmful a linking site looks, 0 to 100, from what we hold about it: our own risk judgement of the site (relevance and spam signals) and Moz's spam score (a percentage, scaled to 100).
    None when the site has been judged by neither."""
    parts = [x for x in (risk, min(100, spam * 6) if spam is not None else None) if x is not None]
    if not parts:
        return None
    score = round(0.6 * max(parts) + 0.4 * (sum(parts) / len(parts)))
    return max(score, TOXIC_FROM) if verdict == "risky" else score


def _band(score: int | None) -> str:
    return "unknown" if score is None else "toxic" if score >= TOXIC_FROM else "potential" if score >= POTENTIAL_FROM else "clean"


def toxicity_report(db: Session, b: Business) -> dict[str, Any]:
    """The Backlink Audit's numbers, counted from the links our crawler found and what we know of each linking site.

    Toxicity of a site: our risk judgement of it and Moz's spam score together (see `_toxicity`). Toxic from 60, potentially toxic from 30, clean below. A link takes its site's band.
    Overall toxicity score: the share of live links that come from toxic sites. Follow and link kinds are read from the links as the crawler saw them."""
    from . import quality  # noqa: PLC0415
    domain = hub.own_domain(db, b.id)
    if not domain:
        return {"state": "no_target"}
    rows = hub.links(db, b, status="all", limit=hub.MAX_LINKS)["links"]
    live = [x for x in rows if x["is_live"]]
    scores = quality.scores_for(db, b.id)
    doms: dict[str, dict[str, Any]] = {}
    for x in live:
        d = doms.setdefault(x["source_domain"], {"domain": x["source_domain"], "links": 0, "spam": None, "da": None, "authority": None, "verdict": None, "first": None})
        d["links"] += 1
        m = x.get("metrics") or {}
        d["spam"] = m.get("spam") if m.get("spam") is not None else d["spam"]
        d["da"] = m.get("da") if m.get("da") is not None else d["da"]
        d["authority"] = x.get("authority") if x.get("authority") is not None else d["authority"]
        if x["first_seen"] and (d["first"] is None or x["first_seen"] < d["first"]):
            d["first"] = x["first_seen"]
    for d in doms.values():
        sc = scores.get(d["domain"]) or {}
        d["verdict"] = sc.get("verdict")
        d["toxicity"] = _toxicity(sc.get("risk"), d["spam"], sc.get("verdict"))
        d["band"] = _band(d["toxicity"])
        d["reason"] = sc.get("reason")
    n_links, n_doms = len(live), len(doms)
    band_links = Counter()
    for d in doms.values():
        band_links[d["band"]] += d["links"]
    follow = Counter("follow" if x["follow"] == "dofollow" else "nofollow" for x in live)
    kinds = Counter("No text (image or icon)" if x["anchor_type"] == "empty" else "Web address" if x["anchor_type"] == "naked" else "Text" for x in live)
    toxic_links = band_links["toxic"]
    overall = round(100 * toxic_links / n_links) if n_links else None
    # the same figures month by month (by the month a link was first seen), for the small charts
    months = sorted({x["first_seen"][:7] for x in rows if x["first_seen"]})[-12:]
    toxic_domains = {d for d, v in doms.items() if v["band"] == "toxic"}
    series = [{"month": mo, "domains": sum(1 for d in doms.values() if d["first"] and d["first"][:7] <= mo), "backlinks": sum(1 for x in live if x["first_seen"] and x["first_seen"][:7] <= mo),
               "toxic": sum(1 for x in live if x["first_seen"] and x["first_seen"][:7] <= mo and x["source_domain"] in toxic_domains)} for mo in months]
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    new30 = sum(1 for x in live if x["first_seen"] and x["first_seen"] >= since)
    judged = sum(1 for d in doms.values() if d["toxicity"] is not None)
    ordered = sorted(doms.values(), key=lambda d: (-(d["toxicity"] if d["toxicity"] is not None else -1), -d["links"]))
    return {
        "state": "ok", "domain": domain,
        "totals": {"referring_domains": n_doms, "backlinks": n_links, "toxic_links": toxic_links, "potential_links": band_links["potential"], "clean_links": band_links["clean"], "unknown_links": band_links["unknown"],
                   "toxic_domains": sum(1 for d in doms.values() if d["band"] == "toxic"), "potential_domains": sum(1 for d in doms.values() if d["band"] == "potential"), "judged_domains": judged,
                   "overall": overall, "risk": None if overall is None else "High" if overall >= 60 else "Medium" if overall >= 30 else "Low", "new_30d": new30,
                   "domains_change": round(100 * sum(1 for d in doms.values() if d["first"] and d["first"] >= since) / max(1, n_doms - sum(1 for d in doms.values() if d["first"] and d["first"] >= since))) if n_doms > sum(1 for d in doms.values() if d["first"] and d["first"] >= since) else None,
                   "links_change": round(100 * new30 / (n_links - new30)) if n_links > new30 else None},
        "follow": dict(follow), "kinds": dict(kinds), "series": series,
        "categories": [{"key": k, "label": l, "links": band_links[k], "domains": sum(1 for d in doms.values() if d["band"] == k), "share": round(100 * band_links[k] / n_links) if n_links else 0}
                       for k, l in (("toxic", "Toxic"), ("potential", "Potentially toxic"), ("clean", "Non-toxic"), ("unknown", "Not judged yet"))],
        "domains": [{"domain": d["domain"], "authority": d["authority"], "da": d["da"], "spam": d["spam"], "toxicity": d["toxicity"], "band": d["band"], "links": d["links"], "reason": d["reason"]} for d in ordered[:300]],
        "backlinks": [{"source_url": x["source_url"], "source_domain": x["source_domain"], "anchor": x["anchor"], "follow": x["follow"], "band": doms[x["source_domain"]]["band"], "toxicity": doms[x["source_domain"]]["toxicity"], "first_seen": x["first_seen"]}
                      for x in sorted(live, key=lambda x: -(doms[x["source_domain"]]["toxicity"] if doms[x["source_domain"]]["toxicity"] is not None else -1))[:300]],
        "anchors": [{"text": k, "count": v, "domains": len({x["source_domain"] for x in live if x["anchor"] == k})} for k, v in Counter(x["anchor"] for x in live if x["anchor"]).most_common(100)],
        "disavow": {"toxic": sorted(d["domain"] for d in doms.values() if d["band"] == "toxic"), "potential": sorted(d["domain"] for d in doms.values() if d["band"] == "potential")},
    }


# ---------------------------------------------------------------------------------------------------------------------------------- compare with competitors
def _visits(domain: str) -> dict[str, Any] | None:
    """Estimated visits a month of a website (Similarweb data through Apify), asked afresh and not kept. None when it has none."""
    import httpx  # noqa: PLC0415

    from ..services import apify_metrics  # noqa: PLC0415
    for _i, tok in apify_metrics.keys():
        try:
            r = httpx.post("https://api.apify.com/v2/acts/trakk~similarweb-scraper/run-sync-get-dataset-items", params={"token": tok, "timeout": 22}, json={"domains": [domain]}, timeout=28)  # a small site has no figures and the actor then keeps trying: it is not waited for
            items = r.json() if r.status_code in (200, 201) and isinstance(r.json(), list) else None
        except (httpx.HTTPError, ValueError):
            return None
        if r.status_code in (401, 402, 403):
            continue  # this key has no credit: the next one
        if items:
            x = items[0]
            est = x.get("estimatedMonthlyVisits") or {}
            last = max(est) if est else None
            visits = est.get(last) if last else (x.get("engagement") or {}).get("visits")
            return {"visits": visits, "month": last, "change": x.get("trafficChangeMoM"), "rank": x.get("globalRank")}
        return None
    return None


def _crawler_profile(db: Session, b: Business, domain: str) -> dict[str, Any] | None:
    """What our crawler holds for one tracked website (yours or a competitor's), counted the same way as the overview. None when it holds no link to the site."""
    from . import quality  # noqa: PLC0415
    rows = hub._rows(db, domain)
    if not rows:
        return None
    scores = quality.scores_for(db, b.id)
    metrics = hub.metrics_for(db, sorted({d for _, _, d in rows}))
    brand = hub.brand_terms(b, domain)
    out = [hub._link_out(bl, page, dom, scores.get(dom), metrics.get(dom), brand) for bl, page, dom in rows]
    live = [x for x in out if x["is_live"]]
    per: dict[str, dict[str, Any]] = {}
    for x in live:
        d = per.setdefault(x["source_domain"], {"links": 0, "first": None, "cats": Counter(), "da": None})
        d["links"] += 1
        d["cats"][x["category"]["label"]] += 1
        m = x.get("metrics") or {}
        d["da"] = m.get("da") if m.get("da") is not None else d["da"]
        if x["first_seen"] and (d["first"] is None or x["first_seen"] < d["first"]):
            d["first"] = x["first_seen"]
    ips = _ips(sorted(per)[:120])
    months = sorted({d["first"][:7] for d in per.values() if d["first"]})
    series = [{"month": mo, "domains": sum(1 for d in per.values() if d["first"] and d["first"][:7] <= mo)} for mo in months][-12:]
    ranges = [("81 - 100", 80, 100), ("61 - 80", 60, 80), ("41 - 60", 40, 60), ("21 - 40", 20, 40), ("0 - 20", -1, 20)]
    return {
        "links": len(live), "domains": len(per), "ips": len({i for i in ips.values() if i}), "series": series, "per_domain": {k: v["links"] for k, v in per.items()},
        "follow": dict(Counter("follow" if x["follow"] == "dofollow" else "nofollow" for x in live)),
        "kinds": dict(Counter("Web address" if x["anchor_type"] == "naked" else "No text (image or icon)" if x["anchor_type"] == "empty" else "Text" for x in live)),
        "categories": dict(Counter(d["cats"].most_common(1)[0][0] for d in per.values())),
        "by_authority": [{"range": lbl, "domains": sum(1 for d in per.values() if d["da"] is not None and lo < d["da"] <= hi), } for lbl, lo, hi in ranges], "authority_known": sum(1 for d in per.values() if d["da"] is not None),
        "authority_of": {k: v["da"] for k, v in per.items()},
    }


def compare(db: Session, b: Business, competitors: list[str]) -> dict[str, Any]:
    """Your website beside up to four competitors: Authority Score, referring domains and Moz figures from Moz (through Apify), estimated monthly visits (Similarweb through Apify), and, for every
    website our crawler tracks, the links it holds (backlinks, hosting, link kinds and attributes, kinds of linking site, authority of the linking sites), then the websites that link to a competitor
    and not to you. A website the crawler does not track shows what Moz and Similarweb say and 'not read yet' for the links."""
    from sqlalchemy import select  # noqa: PLC0415

    from ..services import keyword_difficulty as kd  # noqa: PLC0415
    from ..services import url_overview as uo  # noqa: PLC0415
    from .models import BiTrackedTarget  # noqa: PLC0415
    me = hub.own_domain(db, b.id)
    if not me:
        return {"state": "no_target"}
    names = [me]
    for x in competitors:
        host = kd.site_of(uo._public(x)) if x else ""
        if host and host not in names:
            names.append(host)
    names = names[:5]
    tracked = {t for t in db.scalars(select(BiTrackedTarget.domain).where(BiTrackedTarget.business_id == b.id))}
    with ThreadPoolExecutor(max_workers=6) as pool:
        f_auth = {n: pool.submit(uo.authority, n) for n in names}
        f_vis = {n: pool.submit(_visits, n) for n in names}
        f_clicks = pool.submit(_gsc_clicks_of, _gsc_context(db, b))  # the account is looked up on this thread; `db` is used by this thread alone while the workers run
        profiles = []
        crawls = {n: (_crawler_profile(db, b, n) if n in tracked or n == me else None) for n in names}  # the database work of every site first
        release_connection(db)  # nothing more is read: no connection is held while Moz and Similarweb are waited for
        for n in names:
            crawl = crawls[n]
            au = f_auth[n].result()
            au = au if au and not au.get("error") else None
            vis = f_vis[n].result()
            profiles.append({"domain": n, "you": n == me, "tracked": n in tracked or n == me, "read": crawl is not None,
                             "authority": {"score": kd.authority_score(au.get("da"), au.get("rd"), au.get("spam"), au.get("ranking_keywords")) if au else None, "da": au.get("da") if au else None,
                                           "rd": au.get("rd") if au else None, "ranking_keywords": au.get("ranking_keywords") if au else None, "spam": au.get("spam") if au else None},
                             "visits": vis, "organic_clicks": None, "crawler": crawl})
        clicks = f_clicks.result()
    profiles[0]["organic_clicks"] = clicks
    # websites that link to a competitor and not to you
    mine = set((profiles[0]["crawler"] or {}).get("per_domain", {}))
    opp: dict[str, dict[str, Any]] = {}
    for p in profiles[1:]:
        for dom, n in ((p["crawler"] or {}).get("per_domain", {})).items():
            if dom in mine:
                continue
            e = opp.setdefault(dom, {"domain": dom, "counts": {}, "authority": None})
            e["counts"][p["domain"]] = n
            e["authority"] = (p["crawler"] or {}).get("authority_of", {}).get(dom) if e["authority"] is None else e["authority"]
    opps = sorted(opp.values(), key=lambda e: (-len(e["counts"]), -(e["authority"] or 0), -sum(e["counts"].values())))[:15]
    for p in profiles:
        if p["crawler"]:
            p["crawler"].pop("per_domain", None)
            p["crawler"].pop("authority_of", None)
    return {"state": "ok", "you": me, "profiles": profiles, "opportunities": opps, "tracked": sorted(tracked - {me})}
