"""Competitor keywords only: the searches a competitor's website is about (Google Keyword Planner reads the address, no crawl of the site) and, for competitors the user chooses,
the keywords they really rank for with position, volume and the page that ranks (paid Apify actor). Each keyword gets a verdict for this business: useful or not, and why.
No website, speed or technical checks of the competitor are made."""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, Keyword
from . import apify_metrics, keyword_quality, market
from . import google_ads_client as ads

ACTOR = "santhej~ranked-keywords-checker"
COST_PER_KEYWORD = 0.003
COST_START = 0.001
COST_OVERVIEW = 0.02
LOCATION_CODES = {"US": "2840", "GB": "2826", "UK": "2826", "CA": "2124", "AU": "2036", "IN": "2356", "DE": "2276"}


def _norm(t: str) -> str:
    return " ".join((t or "").lower().split())


def cost_note(keywords: int) -> float:
    return round(COST_START + COST_OVERVIEW + COST_PER_KEYWORD * keywords, 3)


def _brand_words(domain: str) -> set[str]:
    host = domain.split(".")[0].lower()
    return {host, *re.findall(r"[a-z]{4,}", host)} - {"digital", "media", "marketing", "agency", "seo"}


def verdict(b: Business, vocab: set[str], places: set[str], keyword: str, brand: set[str], have: set[str], volume: int | None) -> dict[str, str]:
    """Useful or not for this business, with the reason in plain words."""
    k = _norm(keyword)
    if k in have:
        return {"fit": "have", "why": "You already have this keyword."}
    if any(w and w in k.split() or (len(w) >= 5 and w in k.replace(" ", "")) for w in brand):
        return {"fit": "no", "why": "Contains the competitor's own brand name: nobody searching it wants you."}
    why = keyword_quality.problem(k, vocab, places)
    if why:
        return {"fit": "no", "why": why}
    if volume is not None and volume < 10:
        return {"fit": "maybe", "why": "On topic but almost nobody searches it (under 10 a month)."}
    return {"fit": "yes", "why": "On topic for what you sell" + (f" and about {volume:,} searches a month." if volume else ".")}


def _context(db: Session, b: Business) -> tuple[set[str], set[str], set[str]]:
    vocab = keyword_quality.vocabulary(b)
    places = {w for p in (market.places(b) or []) for w in keyword_quality._words(p)} | set(keyword_quality._words(b.city)) | set(keyword_quality._words(b.area))
    have = {_norm(k) for k in db.scalars(select(Keyword.keyword).where(Keyword.business_id == b.id))}
    return vocab, places, have


def _row(db_ctx: tuple[set[str], set[str], set[str]], b: Business, domain: str, kw: str, **extra: Any) -> dict[str, Any]:
    vocab, places, have = db_ctx
    v = verdict(b, vocab, places, kw, _brand_words(domain), have, extra.get("volume")) if len(vocab) >= 3 else {"fit": "maybe", "why": "Too little is known about your business to judge; add services to your profile."}
    return {"keyword": _norm(kw), "competitor": domain, **extra, **v}


def planner_ideas(db: Session, b: Business, domains: list[str], limit: int = 120) -> dict[str, Any]:
    """The searches each competitor's address is about, from Google Keyword Planner, with volume, cost per click and a verdict. Free, and nothing of the site is crawled."""
    ctx = _context(db, b)
    geo = ads.geo_target_for(market.serp_country(b))

    def one(d: str) -> tuple[str, list[dict[str, Any]] | None, str | None]:
        try:
            got = ads.keyword_ideas([], limit=limit, geo_target=geo, page_url=f"https://{d}")
            return d, got, None
        except Exception as exc:  # noqa: BLE001 -- one competitor failing must not stop the rest
            return d, None, str(exc)[:160]

    rows: list[dict[str, Any]] = []
    notes: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=min(4, max(1, len(domains)))) as pool:
        for d, got, err in pool.map(one, domains[:8]):
            if err:
                notes[d] = err
                continue
            for i in got or []:
                rows.append(_row(ctx, b, d, i.get("keyword") or "", volume=i.get("avg_monthly_searches") or 0, cpc=i.get("high_top_of_page_bid"), competition=i.get("competition"), position=None, url=None, source="planner"))
    return {"rows": _merge(rows), "notes": notes, "source": "Google Keyword Planner reading the competitor's address"}


def ranked(db: Session, b: Business, domain: str, limit: int = 100, min_volume: int = 10) -> dict[str, Any]:
    """What a competitor really ranks for (paid per keyword on Apify). Returns the cost with the rows."""
    ctx = _context(db, b)
    code = LOCATION_CODES.get(market.serp_country(b).upper(), "2840")
    items: list[dict[str, Any]] | None = None
    last = None
    for _i, tok in apify_metrics.keys():
        try:
            r = httpx.post(f"https://api.apify.com/v2/acts/{ACTOR}/run-sync-get-dataset-items", params={"token": tok, "timeout": 120},
                           json={"target": domain, "limit": limit, "minVolume": min_volume, "locationCode": code}, timeout=130)
        except httpx.HTTPError as exc:
            last = str(exc)[:120]
            continue
        if r.status_code in (200, 201) and isinstance(r.json(), list):
            items = r.json()
            break
        last = f"Apify answered {r.status_code}"
    if items is None:
        return {"rows": [], "cost": 0, "note": f"Real rankings could not be read ({last or 'no Apify key'})."}
    rows = []
    for x in items:
        kw = x.get("keyword")
        if not kw or x.get("record_type") not in (None, "ranked_keyword"):
            continue
        rows.append(_row(ctx, b, domain, kw, volume=x.get("search_volume", x.get("volume")), cpc=x.get("cpc"), competition=x.get("competition"), difficulty=x.get("keyword_difficulty", x.get("kd")),
                         intent=x.get("search_intent", x.get("intent")), position=x.get("position") or x.get("rank_absolute"), url=x.get("ranking_url", x.get("url")),
                         traffic=x.get("traffic_estimate", x.get("etv")), source="ranking"))
    return {"rows": rows, "cost": cost_note(len(rows)), "note": None if rows else "This competitor has no ranked keywords above the volume filter."}


def _merge(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One row per keyword, with every competitor that has it."""
    by: dict[str, dict[str, Any]] = {}
    for r in rows:
        e = by.setdefault(r["keyword"], {**r, "competitors": []})
        if r["competitor"] not in e["competitors"]:
            e["competitors"].append(r["competitor"])
    out = list(by.values())
    out.sort(key=lambda r: ({"yes": 0, "maybe": 1, "have": 2, "no": 3}[r["fit"]], -len(r["competitors"]), -(r.get("volume") or 0)))
    return out
