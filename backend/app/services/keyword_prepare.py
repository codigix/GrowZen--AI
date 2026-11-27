"""Prepare keywords: from a keyword picked in the research to the wording people really search (near me, in each target area), measured with Google Keyword Planner,
with a primary/secondary role and a priority for each, and secondary ideas around the primary. Nothing is saved here; My Keywords is saved by the page in one go."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, Keyword
from . import google_ads_client as ads
from . import keyword_metrics, keyword_quality, market

NEAR = "near me"


def _norm(t: str) -> str:
    return " ".join((t or "").lower().split())


def variants(keyword: str, areas: list[str]) -> list[dict[str, str]]:
    """The keyword itself, with 'near me', and with each target area: the ways a customer words the same search."""
    base = _norm(keyword)
    out = [{"keyword": base, "form": "base"}]
    low = base
    if NEAR not in low:
        out.append({"keyword": f"{base} {NEAR}", "form": "near"})
    for a in areas:
        an = _norm(a)
        if an and an not in low:
            out.append({"keyword": f"{base} in {an}", "form": "area", "area": a})
    return out


def _saved(db: Session, b: Business) -> set[str]:
    return {_norm(k) for k in db.scalars(select(Keyword.keyword).where(Keyword.business_id == b.id))}


def prepare(db: Session, b: Business, keywords: list[str], areas: list[str] | None = None) -> dict[str, Any]:
    """Every picked keyword with its variants and the real Planner figures. The variant with the most searches among the local ones is suggested as primary."""
    areas = list({_norm(a): a for a in (areas if areas is not None else market.places(b)) if a}.values())[:5]
    picked = list(dict.fromkeys(_norm(k) for k in keywords if _norm(k)))[:12]
    groups = [{"keyword": k, "rows": variants(k, areas)} for k in picked]
    phrases = [r["keyword"] for g in groups for r in g["rows"]]
    found, reason = keyword_metrics.lookup(phrases, market.serp_country(b))
    saved = _saved(db, b)
    from .keyword_workspace import merge_key  # noqa: PLC0415
    from ..models import KeywordCandidate  # noqa: PLC0415
    rivals: dict[str, list[str]] = {}
    for c in db.scalars(select(KeywordCandidate).where(KeywordCandidate.business_id == b.id)):
        names = [str(x.get("domain") if isinstance(x, dict) else x) for x in (c.competitors or []) if x]
        if names:
            rivals[c.norm] = names[:3]  # what the workspace already knows of who has the keyword: no new paid read
    from .providers.base import intent_of  # noqa: PLC0415
    for g in groups:
        for r in g["rows"]:
            m = found.get(r["keyword"]) or {}
            r.update({"volume": m.get("volume"), "cpc": m.get("cpc"), "competition": m.get("competition"), "difficulty": m.get("difficulty"),
                      "intent": intent_of(r["keyword"]), "saved": r["keyword"] in saved, "competitors": rivals.get(merge_key(r["keyword"]), [])})
        local = [r for r in g["rows"] if r["form"] != "base"]
        pool = local or g["rows"]
        best = max(pool, key=lambda r: (r.get("volume") or 0, r["form"] == "area"))
        for r in g["rows"]:
            r["role"] = "primary" if r is best else "secondary"
            r["priority"] = "High" if r is best else "Medium"
    return {"groups": groups, "areas": areas, "metrics_note": reason if not found else None, "country": market.serp_country(b)}


def secondary(db: Session, b: Business, primary: str, limit: int = 40) -> dict[str, Any]:
    """Related searches around a primary keyword from Keyword Planner, without the ones that are off-topic for the business or already saved."""
    p = _norm(primary)
    try:
        ideas = ads.keyword_ideas([p], limit=300, geo_target=ads.geo_target_for(market.serp_country(b)))
    except ads.GoogleAdsError as exc:
        return {"rows": [], "note": "Google Ads did not answer: " + str(exc)[:160]}
    except Exception as exc:  # noqa: BLE001 -- Planner not set up
        return {"rows": [], "note": f"Keyword Planner is not available: {str(exc)[:160]}"}
    saved = _saved(db, b)
    names = [_norm(i.get("keyword") or "") for i in ideas]
    junk = keyword_quality.check_all(b, [n for n in names if n])
    p_words = set(p.replace(NEAR, "").split())  # a secondary keyword keeps every word of the primary (without 'near me')
    rows = []
    for i, n in zip(ideas, names):
        if not n or n == p or n in saved or n in junk or not p_words <= set(n.split()) or len(set(n.split())) < len(n.split()):
            continue
        rows.append({"keyword": n, "volume": i.get("avg_monthly_searches") or 0, "cpc": i.get("high_top_of_page_bid"), "competition": i.get("competition"), "saved": False})
    rows.sort(key=lambda r: -(r["volume"] or 0))
    return {"rows": rows[:limit], "note": None}


# ---------------------------------------------------------------------------------------------------------------------------------- saved keywords
_trends: dict[tuple[str, str], tuple[float, list[int]]] = {}


def _trend_of(keywords: list[str], country: str) -> dict[str, list[int]]:
    """The last twelve months of searches of each keyword from Keyword Planner, kept for a day."""
    import time  # noqa: PLC0415
    now = time.time()
    out: dict[str, list[int]] = {}
    todo = []
    for k in keywords:
        hit = _trends.get((country, k))
        if hit and now - hit[0] < 86400:
            out[k] = hit[1]
        else:
            todo.append(k)
    for i in range(0, len(todo), 100):
        chunk = todo[i:i + 100]
        try:
            got = ads.historical_metrics(chunk, geo_target=ads.geo_target_for(country))
        except Exception:  # noqa: BLE001 -- no trend rather than a failed page
            break
        for k in chunk:
            series = [int(m.get("searches") or 0) for m in ((got.get(k) or {}).get("monthly") or [])][-12:]
            _trends[(country, k)] = (now, series)
            out[k] = series
    return out


def saved(db: Session, b: Business) -> dict[str, Any]:
    """The Saved Keywords list: every kept keyword with its list (My List, Blog Ideas, Competitors), searches, difficulty, intent, cost, 12-month trend and the day it was added."""
    from .keyword_mapping import is_blog  # noqa: PLC0415
    rows = list(db.scalars(select(Keyword).where(Keyword.business_id == b.id).order_by(Keyword.id.desc())))
    cc = market.serp_country(b)
    trends = _trend_of([k.keyword for k in rows][:300], cc) if rows else {}
    from ..models import KeywordCandidate  # noqa: PLC0415
    from .keyword_workspace import merge_key  # noqa: PLC0415
    kds = {c.norm: c.kd for c in db.scalars(select(KeywordCandidate).where(KeywordCandidate.business_id == b.id)) if c.kd is not None}  # real difficulty read in the workspace
    out = []
    for k in rows:
        src = k.source if isinstance(k.source, dict) else {}
        text = " ".join(str(src.get(x) or "") for x in ("kind", "label", "from")).lower()
        listing = "Competitors" if ("competitor" in text or src.get("competitors")) else "Blog Ideas" if is_blog(k.keyword, k.intent) else "My List"
        out.append({"id": k.id, "keyword": k.keyword, "list": listing, "volume": k.volume, "kd": kds.get(merge_key(k.keyword), k.difficulty), "intent": k.intent, "cpc": k.cpc, "trend": trends.get(k.keyword), "added": (k.created_at.date().isoformat() if k.created_at else None), "mapping": k.mapping_status if k.mapping_status in ("optimization", "new_page", "completed") else ("mapped" if k.target_url else "not_mapped"), "page": k.target_url, "role": k.role,
                    "role": k.role, "priority": k.priority, "topic": k.cluster, "rank": k.rank, "prev_rank": k.prev_rank, "checked": k.rank_checked_at.isoformat() if k.rank_checked_at else None, "page": k.target_url})
    return {"rows": out, "country": cc, "lists": {n: sum(1 for r in out if r["list"] == n) for n in ("My List", "Blog Ideas", "Competitors")}}
