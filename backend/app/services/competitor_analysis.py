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
