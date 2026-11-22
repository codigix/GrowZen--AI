"""What the competitors' pages earn from Google, read from the last competitor research: which of their pages are in the top 10 for the project's keywords,
and an estimate of the visits that brings.

The estimate is modelled, not measured: for each keyword where the competitor's page is in the top 10, monthly searches (Google Keyword Planner) times the usual
click share of that position. It is shown beside the same estimate for your own site so the two can be compared. Without searches the pages are still listed.
"""
from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Audit, Business, Keyword, KeywordCandidate
from . import keyword_metrics, market
from .keyword_workspace import merge_key

CTR = {1: 0.28, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.07, 6: 0.05, 7: 0.04, 8: 0.03, 9: 0.025, 10: 0.02}


def _volumes(db: Session, b: Business, keywords: list[str]) -> dict[str, int]:
    known: dict[str, int] = {}
    for r in db.scalars(select(Keyword).where(Keyword.business_id == b.id)):
        if r.volume:
            known[merge_key(r.keyword)] = r.volume
    for r in db.scalars(select(KeywordCandidate).where(KeywordCandidate.business_id == b.id)):
        if r.volume:
            known.setdefault(r.norm, r.volume)
    missing = [k for k in keywords if merge_key(k) not in known]
    if missing and keyword_metrics.enabled():
        m, _ = keyword_metrics.lookup(missing[:100], market.serp_country(b))
        for k, v in (m or {}).items():
            if v.get("volume"):
                known[merge_key(k)] = v["volume"]
    return {k: known.get(merge_key(k), 0) for k in keywords}


def report(db: Session, b: Business, limit: int = 5) -> dict[str, Any]:
    run = db.scalar(select(Audit).where(Audit.kind == "intel", Audit.target == f"business:{b.id}", Audit.status == "done").order_by(Audit.id.desc()))
    if not run:
        return {"available": False, "reason": "Run the competitor research first: it reads who ranks on Google for your keywords."}
    serps = (run.result or {}).get("serps") or []
    vol = _volumes(db, b, [s["keyword"] for s in serps])
    doms: dict[str, dict[str, Any]] = {}
    mine = {"visits": 0, "keywords": 0}
    for s in serps:
        v = vol.get(s["keyword"], 0)
        if s.get("you_organic") and s["you_organic"] <= 10:
            mine["keywords"] += 1
            mine["visits"] += round(v * CTR.get(s["you_organic"], 0))
        for o in s.get("organic") or []:
            if o.get("mine") or not o.get("domain") or o.get("type") == "directory" or (o.get("position") or 99) > 10:
                continue
            d = doms.setdefault(o["domain"], {"domain": o["domain"], "pages": {}, "visits": 0, "keywords": 0})
            est = round(v * CTR.get(o["position"], 0))
            d["visits"] += est
            d["keywords"] += 1
            pg = d["pages"].setdefault(o["url"], {"url": o["url"], "path": urlsplit(o["url"]).path or "/", "title": o.get("title") or "", "visits": 0, "keywords": []})
            pg["visits"] += est
            pg["keywords"].append({"keyword": s["keyword"], "position": o["position"], "volume": v or None})
    out = []
    for d in sorted(doms.values(), key=lambda x: (-x["visits"], -x["keywords"]))[:limit]:
        pages = sorted(d["pages"].values(), key=lambda p: (-p["visits"], -len(p["keywords"])))
        out.append({"domain": d["domain"], "est_visits": d["visits"], "keywords_top10": d["keywords"], "top_pages": pages[:5]})
    gaps = ((run.result or {}).get("gaps") or {}).get("keywords", [])
    return {"available": True, "analysed_at": (run.result or {}).get("analysed_at"), "keywords": len(serps), "volumes": any(vol.values()), "ads": keyword_metrics.enabled(), "organic_results": sum(len(s.get("organic") or []) for s in serps),
            "competitors": out, "you": mine,
            "gaps": [{"keyword": g.get("keyword"), "volume": vol.get(g.get("keyword")) or None, "competitors": [c.get("domain") for c in g.get("competitors") or []][:3]} for g in gaps][:30],
            "note": "Estimates, not measured visits: monthly searches times the usual click share of each position, for the keywords researched."}
