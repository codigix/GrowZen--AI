"""Domain Overview figures from Google only: the site's own Search Console data (clicks, impressions, queries, pages, countries,
history). Search Console only knows sites the connected Google account has verified, so these are the real figures of that site.

Google offers no API for the rest of what a paid SEO index reports (authority score, backlinks, a competitor's traffic, other
sites' ads, estimated traffic for any domain). Those sections are returned as unavailable with the reason, never estimated.

Each section is fetched on its own, so one failing call leaves the rest intact. Results are kept in domain_intel_cache per
domain/country/size and reused for the number of days in domain_checks.LIMITS.
"""
import logging
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import DomainIntelCache
from . import countries, gbp, gsc

log = logging.getLogger("seo")
BUCKETS = [("top3", 3), ("p4_10", 10), ("p11_20", 20), ("p21_50", 50), ("p51_100", 100)]
NOT_GOOGLE = "Google has no API for this. It is not shown rather than estimated."
UNAVAILABLE = {
    "competitors": "Competitor keywords and traffic aren't available from Google. Use Competitor Research (Google results) instead.",
    "links": "Authority score and backlink totals aren't available from Google; the Search Console links report has no API.",
    "paid": "Paid traffic and other sites' ads aren't available from Google.",
}


def _no(reason: str) -> dict:
    return {"ok": False, "error": reason}


def _empty_metrics() -> dict:
    return {"count": 0, "traffic": 0, "traffic_cost": None, **{k: 0 for k, _ in BUCKETS}}


def _bucket_counts(positions: list[float]) -> dict:
    out = {k: 0 for k, _ in BUCKETS}
    for p in positions:
        for k, top in BUCKETS:
            if p <= top:
                out[k] += 1
                break
    return out


def _pct(now: float | None, before: float | None) -> float | None:
    return round((now - before) / before * 100, 1) if now is not None and before else None


def _months_back(n: int) -> date:
    d = date.today().replace(day=1)
    for _ in range(n):
        d = (d - timedelta(days=1)).replace(day=1)
    return d


def _rows(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(raw, key=lambda r: (-r["clicks"], -r["impressions"]))


def _safe(fn: Callable[[], Any]) -> dict:
    try:
        return {"ok": True, "data": fn()}
    except gbp.GbpError as exc:
        return _no(str(exc))
    except Exception as exc:  # a malformed answer must not take the whole page down
        log.warning("domain intel section failed: %s", exc)
        return _no(f"Unexpected answer from Google: {str(exc)[:120]}")


def fetch(sc: gsc.SearchConsole, site: str, country: str, limits: dict, brand_terms: list[str] | None = None) -> dict:
    """All sections for one site in one country, from Search Console. `country` is an ISO alpha-2 market code."""
    end = date.today() - timedelta(days=gsc.LAG_DAYS)
    start = end - timedelta(days=89)
    p_end, p_start = start - timedelta(days=1), start - timedelta(days=90)
    hist_start = _months_back(15)

    def q(s: date, e: date, dims: list[str] | None, limit: int = 1000, c: str | None = country) -> list[dict]:
        return sc.query(site, gsc._body(s, e, dims, limit, c))

    with ThreadPoolExecutor(max_workers=5) as ex:
        f = {
            "queries": ex.submit(_safe, lambda: q(start, end, ["query"])), "queries_prev": ex.submit(_safe, lambda: q(p_start, p_end, ["query"])),
            "pages": ex.submit(_safe, lambda: q(start, end, ["page"])),
            "series": ex.submit(_safe, lambda: q(hist_start, end, ["date"], 25000)),
            "totals": ex.submit(_safe, lambda: q(start, end, None)), "totals_prev": ex.submit(_safe, lambda: q(p_start, p_end, None)),
        }
        got = {k: v.result() for k, v in f.items()}

    out: dict[str, Any] = {}
    queries, pages = got["queries"], got["pages"]
    if queries["ok"]:
        rows_raw = queries["data"]
        positions = [r["position"] for r in rows_raw]
        clicks = int(sum(r["clicks"] for r in rows_raw))
        total_clicks = int(((got["totals"].get("data") or [{}])[0] or {}).get("clicks", clicks))
        out["overview"] = {"ok": True, "data": {"organic": {"count": len(rows_raw), "traffic": total_clicks, "traffic_cost": None, **_bucket_counts(positions)}, "paid": _empty_metrics()}}
        kw_rows = [{"keyword": r["keys"][0], "intent": None, "position": round(r["position"]), "volume": None, "cpc": None, "traffic": int(r["clicks"]), "impressions": int(r["impressions"]),
                    "ctr": round(r["ctr"] * 100, 2), "url": None, "title": None, "description": None} for r in _rows(rows_raw)[:limits["keywords"]]]
        out["keywords"] = {"ok": True, "data": {"total": len(rows_raw), "rows": kw_rows, "intents": [{"intent": "unknown", "keywords": len(kw_rows), "traffic": sum(r["traffic"] for r in kw_rows)}]}}
        terms = [t.lower() for t in (brand_terms or []) if t and len(t) >= 3]
        branded = sum(r["traffic"] for r in kw_rows if any(t in r["keyword"].lower() for t in terms)) if terms else None
        prev_rows = got["queries_prev"].get("data") or []
        prev_clicks = ((got["totals_prev"].get("data") or [{}])[0] or {}).get("clicks")
        out["organic"] = {"ok": True, "data": {"keywords": len(rows_raw), "keywords_change": _pct(len(rows_raw), len(prev_rows) or None), "traffic": total_clicks,
                                               "traffic_change": _pct(total_clicks, prev_clicks), "traffic_cost": None, "branded": branded,
                                               "non_branded": max(total_clicks - branded, 0) if branded is not None else None, "sample": len(kw_rows)}}
    else:
        for k in ("overview", "keywords", "organic"):
            out[k] = queries

    if pages["ok"]:
        out["pages"] = {"ok": True, "data": [{"url": r["keys"][0], "traffic": int(r["clicks"]), "keywords": None, "impressions": int(r["impressions"])} for r in _rows(pages["data"])[:limits["pages"]]]}
        by_host: dict[str, float] = defaultdict(float)
        for r in pages["data"]:
            by_host[urlparse(r["keys"][0]).netloc.lower()] += r["clicks"]
        total = sum(by_host.values())
        out["subdomains"] = {"ok": True, "data": [{"subdomain": h, "traffic": int(v), "keywords": None, "share": round(v / total * 100, 2) if total else 0} for h, v in sorted(by_host.items(), key=lambda kv: -kv[1])[:10]]}
    else:
        out["pages"] = out["subdomains"] = pages

    if got["series"]["ok"]:
        months: dict[str, float] = defaultdict(float)
        for r in got["series"]["data"]:
            months[r["keys"][0][:7]] += r["clicks"]
        out["history"] = {"ok": True, "data": [{"date": m, "traffic": int(v), "keywords": None, "paid_traffic": None, "paid_keywords": None, **{k: None for k, _ in BUCKETS}} for m, v in sorted(months.items())]}
    else:
        out["history"] = got["series"]

    for k, why in (("competitors", UNAVAILABLE["competitors"]), ("links", UNAVAILABLE["links"]), ("backlinks", UNAVAILABLE["links"]), ("anchors", UNAVAILABLE["links"]),
                   ("ref_domains", UNAVAILABLE["links"]), ("indexed_pages", UNAVAILABLE["links"]), ("paid_keywords", UNAVAILABLE["paid"]), ("paid_competitors", UNAVAILABLE["paid"])):
        out[k] = _no(why)
    return out


def by_country(sc: gsc.SearchConsole, site: str, codes: list[str]) -> list[dict]:
    """Clicks per target market from Search Console."""
    end = date.today() - timedelta(days=gsc.LAG_DAYS)
    start = end - timedelta(days=89)
    try:
        rows = {gsc.A3.get(r["keys"][0], r["keys"][0].upper()[:2]): r for r in sc.query(site, gsc._body(start, end, ["country"], 250))}
    except gbp.GbpError as exc:
        return [{"code": c, "name": countries.name(c), "error": str(exc)} for c in codes[:6]]
    out = []
    for c in codes[:6]:
        r = rows.get(c)
        out.append({"code": c, "name": countries.name(c), "organic": {**_empty_metrics(), "count": None, "traffic": int(r["clicks"]) if r else 0}, "paid": _empty_metrics()})
    return out


def cached(db: Session, key: str, host: str, tier: str, days: int, refresh: bool, build: Callable[[], Any]) -> dict:
    """Reuse a stored result younger than `days`; a result with a failed Google section is kept only when nothing but the unavailable ones failed."""
    row = db.scalar(select(DomainIntelCache).where(DomainIntelCache.domain == host, DomainIntelCache.key == key, DomainIntelCache.tier == tier))
    now = datetime.now(timezone.utc)
    if row and not refresh and row.fetched_at.replace(tzinfo=row.fetched_at.tzinfo or timezone.utc) > now - timedelta(days=days):
        return {"data": row.payload, "fetched_at": row.fetched_at, "cached": True}
    data = build()
    unavailable = set(UNAVAILABLE.values())
    failed = isinstance(data, dict) and any(isinstance(v, dict) and v.get("ok") is False and v.get("error") not in unavailable for v in data.values())
    if not failed:
        if not row:
            row = DomainIntelCache(domain=host, key=key, tier=tier)
            db.add(row)
        row.payload, row.fetched_at = data, now
        db.commit()
    return {"data": data, "fetched_at": now, "cached": False}
