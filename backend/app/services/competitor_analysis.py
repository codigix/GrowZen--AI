"""Competitor analysis: for each competitor, only the numbers that matter for competing on Google: its Domain Authority and referring domains (Moz, through Apify), the keywords it ranks for and the
organic traffic they bring (a ranked-keywords read), and the pages that bring it. Nothing about the competitor's website is audited: no speed test, no crawl.

Everything is kept: a competitor shows what was last read and when. "Analyze" reads it again."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, CompetitorKeyword
from . import apify_metrics
from . import competitor_keyword_report as ck


def _host(d: str) -> str:
    d = (d or "").lower().strip()
    return d[4:] if d.startswith("www.") else d


def _site_metrics(db: Session, domains: list[str]) -> dict[str, dict[str, Any]]:
    """Domain Authority, Page Authority, spam score and referring domains last read for each domain, with the date (whichever source read it)."""
    from ..backlinks.models import BiDomainMetric  # noqa: PLC0415
    out: dict[str, dict[str, Any]] = {}
    want = set(domains) | {f"www.{d}" for d in domains}
    for m in db.scalars(select(BiDomainMetric).where(BiDomainMetric.domain.in_(list(want) or [""]))):
        if m.da is not None:
            out[_host(m.domain)] = {"da": m.da, "pa": m.pa, "spam": m.spam_score, "rd": m.linking_domains, "read_at": m.fetched_at.isoformat() if m.fetched_at else None}
    return out


def metrics(db: Session, b: Business, domains: list[str]) -> dict[str, dict[str, Any]]:
    """{domain: {da, pa, spam, rd, keywords, traffic, top3, top10, avg_position, kw_read_at, status}} from what was kept. Status: analyzed (both read), partial (one), pending (none)."""
    domains = list(dict.fromkeys(_host(d) for d in domains if d))
    site = _site_metrics(db, domains)
    by: dict[str, list[CompetitorKeyword]] = {}
    for r in db.scalars(select(CompetitorKeyword).where(CompetitorKeyword.business_id == b.id, CompetitorKeyword.domain.in_(domains or [""]))):
        by.setdefault(r.domain, []).append(r)
    out: dict[str, dict[str, Any]] = {}
    for d in domains:
        rows = by.get(d, [])
        s = site.get(d) or {}
        pos = [r.position for r in rows if r.position]
        has_kw, has_site = bool(rows), s.get("da") is not None
        out[d] = {"da": s.get("da"), "pa": s.get("pa"), "spam": s.get("spam"), "rd": s.get("rd"), "site_read_at": s.get("read_at"),
                  "keywords": len(rows) if has_kw else None, "traffic": round(sum(r.traffic or 0 for r in rows)) if has_kw else None,
                  "top3": sum(1 for p in pos if p <= 3) if has_kw else None, "top10": sum(1 for p in pos if p <= 10) if has_kw else None,
                  "avg_position": round(sum(pos) / len(pos), 1) if pos else None, "kw_read_at": max((r.read_at for r in rows), default=None).isoformat() if rows else None,
                  "status": "analyzed" if has_kw and has_site else "partial" if has_kw or has_site else "pending"}
    return out


def analyze_one(db: Session, b: Business, domain: str, limit: int = 100) -> dict[str, Any]:
    """Read one competitor: its site strength (Moz) and the keywords it ranks for. Each part reports its own reason when it could not be read."""
    domain = _host(domain)
    notes: list[str] = []
    try:
        got = apify_metrics.check([domain], force=True)
        if got and got[0].get("error"):
            notes.append(f"Domain Authority: {str(got[0]['error'])[:140]}")
    except Exception as exc:  # noqa: BLE001 -- a part that fails must not stop the other
        notes.append(f"Domain Authority: {str(exc)[:140]}")
    r = ck.ranked(db, b, domain, limit)
    if r.get("note"):
        notes.append(f"Keywords: {r['note']}")
    return {"domain": domain, "metrics": metrics(db, b, [domain])[domain], "notes": notes, "cost": r.get("cost"), "keywords_read": len(r.get("rows") or [])}


def pages(db: Session, b: Business, domains: list[str], limit: int = 200) -> list[dict[str, Any]]:
    """The pages that bring each competitor its organic traffic, from the kept keyword reads: per page the keywords it ranks for, their estimated traffic, its best position and its top keyword."""
    domains = list(dict.fromkeys(_host(d) for d in domains if d))
    agg: dict[tuple[str, str], dict[str, Any]] = {}
    for r in db.scalars(select(CompetitorKeyword).where(CompetitorKeyword.business_id == b.id, CompetitorKeyword.domain.in_(domains or [""]))):
        if not r.url:
            continue
        e = agg.setdefault((r.domain, r.url), {"domain": r.domain, "url": r.url, "keywords": 0, "traffic": 0.0, "best": None, "top_keyword": None, "top_volume": -1})
        e["keywords"] += 1
        e["traffic"] += r.traffic or 0
        if r.position and (e["best"] is None or r.position < e["best"]):
            e["best"] = r.position
        if (r.volume or 0) > e["top_volume"]:
            e["top_keyword"], e["top_volume"] = r.keyword, r.volume or 0
    out = sorted(agg.values(), key=lambda e: (-e["traffic"], -e["keywords"]))[:limit]
    for e in out:
        e["traffic"] = round(e["traffic"])
        e.pop("top_volume", None)
    return out


def own(db: Session, b: Business) -> dict[str, Any] | None:
    """Your own site in the same terms: Domain Authority and referring domains as last read, the tracked keywords that rank, and Google clicks in the last 28 days (Search Console)."""
    from ..backlinks.overview import _gsc_clicks  # noqa: PLC0415
    from ..models import Keyword  # noqa: PLC0415
    from . import google_rank  # noqa: PLC0415
    host = _host(google_rank.host_of(b.website) or "")
    if not host:
        return None
    m = dict(metrics(db, b, [host]).get(host) or {})
    ranked = [k.rank for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True))) if k.rank]
    m.update({"domain": host, "keywords": len(ranked), "top3": sum(1 for r in ranked if r <= 3), "top10": sum(1 for r in ranked if r <= 10),
              "avg_position": round(sum(ranked) / len(ranked), 1) if ranked else None, "traffic": _gsc_clicks(db, b), "traffic_note": "Google clicks, last 28 days (Search Console)", "kw_read_at": None})
    return m


# ---------------------------------------------------------------------------------------------------------------------------------- automatic analysis
import threading  # noqa: E402
import time  # noqa: E402

_progress: dict[int, dict[str, Any]] = {}
_tried: dict[tuple[int, str], float] = {}  # (business, domain) -> when it was last tried: a competitor is not read again automatically within a day
_lock = threading.Lock()
MAX_AUTO = 10
RETRY_AFTER = 24 * 3600


def progress(business_id: int) -> dict[str, Any]:
    p = _progress.get(business_id)
    return dict(p) if p else {"running": False, "total": 0, "done": 0, "current": None, "queue": [], "failed": {}, "finished_at": None}


def start_auto(db: Session, b: Business, domains: list[str], limit: int = 100) -> dict[str, Any]:
    """Analyze the competitors that were not analyzed yet, one after another in the background, so nobody has to press anything. A competitor read within the last day is skipped,
    and at most MAX_AUTO are started at once. Progress is kept for the page to follow."""
    with _lock:
        cur = _progress.get(b.id)
        if cur and cur.get("running"):
            return dict(cur)
        now = time.time()
        known = metrics(db, b, domains)
        todo = [d for d in dict.fromkeys(_host(x) for x in domains if x) if known.get(d, {}).get("status") != "analyzed" and now - _tried.get((b.id, d), 0) > RETRY_AFTER][:MAX_AUTO]
        if not todo:
            return progress(b.id) | {"running": False}
        _progress[b.id] = {"running": True, "total": len(todo), "done": 0, "current": todo[0], "queue": list(todo), "failed": {}, "finished_at": None, "stop": False}
    threading.Thread(target=_work, args=(b.id, todo, limit), daemon=True, name=f"competitor-analysis-{b.id}").start()
    return progress(b.id)


def stop_auto(business_id: int) -> dict[str, Any]:
    with _lock:
        if business_id in _progress:
            _progress[business_id]["stop"] = True
    return progress(business_id)


def _work(business_id: int, todo: list[str], limit: int) -> None:
    from ..db import SessionLocal  # noqa: PLC0415
    db = SessionLocal()
    try:
        b = db.get(Business, business_id)
        for d in todo:
            p = _progress[business_id]
            if p.get("stop") or b is None:
                break
            p["current"] = d
            try:
                r = analyze_one(db, b, d, limit)
                if r["notes"] and r["metrics"]["status"] == "pending":
                    p["failed"][d] = r["notes"][0]
            except Exception as exc:  # noqa: BLE001 -- one competitor failing must not stop the rest
                db.rollback()
                p["failed"][d] = str(exc)[:160]
            _tried[(business_id, d)] = time.time()
            p["done"] += 1
            p["queue"] = [x for x in p["queue"] if x != d]
    finally:
        db.close()
        with _lock:
            p = _progress.get(business_id)
            if p:
                p.update({"running": False, "current": None, "queue": [], "finished_at": time.time()})


# ---------------------------------------------------------------------------------------------------------------------------------- location and match for every saved competitor
_rated: dict[tuple, tuple[float, dict[str, Any]]] = {}


def _km(a: tuple[float, float], b: tuple[float, float]) -> float:
    import math  # noqa: PLC0415
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    d = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b[1] - a[1]) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(d))


def ratings(db: Session, b: Business, location: str | None) -> dict[str, Any]:
    """For every saved competitor: its address, how far it is from the place searched, and how well it matches the business (the nine factors). Works from the saved list, so it does not
    need a research run. A competitor's map point is found once from its address and kept. Cached for six hours."""
    from ..competitors import intel, intel_router, relevance  # noqa: PLC0415
    from ..models import Audit, Competitor  # noqa: PLC0415
    from ..services import keyword_locations, market  # noqa: PLC0415
    comps = list(db.scalars(select(Competitor).where(Competitor.business_id == b.id).order_by(Competitor.id)))
    key = (b.id, (location or "").lower(), tuple(c.id for c in comps))
    hit = _rated.get(key)
    if hit and time.time() - hit[0] < 6 * 3600:
        return hit[1]
    centre = intel_router._centre(b, location) or ((b.lat, b.lng) if getattr(b, "lat", None) is not None and getattr(b, "lng", None) is not None else None)
    country = market.serp_country(b)
    geocoded = 0
    for c in comps:  # find each competitor's point once and keep it
        if c.lat is None and c.address and geocoded < 30:
            geocoded += 1
            try:
                pin = keyword_locations.place_pin(f"{c.name}, {c.address}"[:160], country) or keyword_locations.place_pin(c.address[:160], country)
            except Exception:  # noqa: BLE001 -- without a point the distance is simply not shown
                pin = None
            if pin:
                c.lat, c.lng = pin["lat"], pin["lng"]
    db.commit()
    run = db.scalar(select(Audit).where(Audit.kind == "intel", Audit.target == f"business:{b.id}", Audit.status == "done").order_by(Audit.id.desc()))
    result = (run.result or {}) if run else {}
    keywords = list(result.get("keywords") or [])[:8] or [k for k in intel.default_keywords(b)[:5]]
    seen = {_host((e.get("domain") or e.get("website") or "")): e for e in (result.get("local_competitors") or [])}
    cands = []
    for c in comps:
        dom = _host(c.website or "")
        dom = dom.split("/")[0] if dom else ""
        e = seen.get(dom) or {}
        cands.append({"_id": c.id, "name": c.name, "category": e.get("category"), "address": c.address, "website": c.website, "domain": dom, "cid": c.place_id,
                      "distance_m": round(_km(centre, (c.lat, c.lng)) * 1000) if centre and c.lat is not None else None,
                      "appearances": e.get("appearances"), "best": e.get("best"), "avg_position": e.get("avg_position"), "mine": False})
    authority: dict[str, int] = {}
    try:
        from ..backlinks.models import BiDomainMetric  # noqa: PLC0415
        authority = {m.domain.lower().removeprefix("www."): m.da for m in db.scalars(select(BiDomainMetric)) if m.da is not None}
    except Exception:  # noqa: BLE001
        pass
    try:
        extra = intel_router._context(db, b, {})
    except Exception:  # noqa: BLE001
        extra = {}
    from ..services import categories as _categories  # noqa: PLC0415
    own_rental = bool(_categories.rental_seeds(getattr(b, "name", None), getattr(b, "primary_category", None), [s.get("name") for s in (getattr(b, "services", None) or [])], getattr(b, "description", None)))
    relevance.rate(b, cands, keywords, authority, lambda u: intel.scan_site(u, max_pages=0, timeout=6), own_rental, extra)
    out: dict[str, Any] = {"centre": {"lat": centre[0], "lng": centre[1]} if centre else None, "keywords": keywords, "by_id": {}}
    for x in cands:
        out["by_id"][str(x["_id"])] = {"address": x.get("address"), "distance_m": x.get("distance_m"), "relevance": x.get("relevance")}
    _rated[key] = (time.time(), out)
    return out
