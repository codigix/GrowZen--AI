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
    from .providers.base import intent_of  # noqa: PLC0415
    for g in groups:
        for r in g["rows"]:
            m = found.get(r["keyword"]) or {}
            r.update({"volume": m.get("volume"), "cpc": m.get("cpc"), "competition": m.get("competition"), "difficulty": m.get("difficulty"),
                      "intent": intent_of(r["keyword"]), "saved": r["keyword"] in saved})
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
