"""Keyword Strategy Builder: up to five seed keywords become a content plan. Google Keyword Planner's ideas are grouped into topics; in each topic the biggest broad search is the pillar page and groups of
narrower searches are its subpages, each with the keywords it should target. Nothing is saved; the page sends the chosen keywords to My Keywords."""
from __future__ import annotations

import math
import re
from typing import Any

from sqlalchemy.orm import Session

from ..models import Business
from . import google_ads_client as ads
from . import keyword_quality, market
from .providers.base import intent_of

STOP = {"a", "an", "the", "and", "or", "for", "to", "of", "in", "on", "at", "with", "is", "are", "my", "me", "you", "your", "how", "what", "do", "does", "can", "best", "top", "near", "vs"}


def _words(k: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", k.lower())


def _group(rows: list[dict[str, Any]], skip: set[str], min_size: int) -> tuple[list[tuple[str, list[dict[str, Any]]]], list[dict[str, Any]]]:
    """Greedy: the word shared by the most searched ideas takes them; what no word takes is returned apart."""
    left = list(rows)
    out: list[tuple[str, list[dict[str, Any]]]] = []
    while left:
        tot: dict[str, int] = {}
        cnt: dict[str, int] = {}
        for r in left:
            for w in set(_words(r["keyword"])) - skip - STOP:
                if len(w) > 2:
                    tot[w] = tot.get(w, 0) + (r["volume"] or 0)
                    cnt[w] = cnt.get(w, 0) + 1
        best = max((w for w in tot if cnt[w] >= min_size), key=lambda w: (tot[w], cnt[w]), default=None)
        if not best:
            break
        take = [r for r in left if best in _words(r["keyword"])]
        out.append((best, take))
        left = [r for r in left if best not in _words(r["keyword"])]
    return out, left


def build(db: Session, b: Business, seeds: list[str], country: str | None = None) -> dict[str, Any]:
    seeds = list(dict.fromkeys(" ".join(s.lower().split()) for s in seeds if s and s.strip()))[:5]
    cc = (country or market.serp_country(b)).upper()
    try:
        ideas = ads.keyword_ideas(seeds, limit=1500, geo_target=ads.geo_target_for(cc))
    except Exception as exc:  # noqa: BLE001 -- Planner not set up or refused
        return {"state": "error", "message": f"Google Keyword Planner did not answer: {str(exc)[:200]}"}
    rows: dict[str, dict[str, Any]] = {}
    for i in ideas:
        k = " ".join((i.get("keyword") or "").lower().split())
        if k and k not in rows:
            rows[k] = {"keyword": k, "volume": i.get("avg_monthly_searches") or 0, "index": i.get("competition_index"), "cpc": i.get("high_top_of_page_bid"), "intent": intent_of(k)}
    junk = keyword_quality.check_all(b, list(rows))
    kept = [r for k, r in rows.items() if k not in junk]
    seed_words = {w for s in seeds for w in _words(s)}
    groups, rest = _group(kept, seed_words, 3)
    topics = []
    for name, members in groups[:40]:
        members.sort(key=lambda r: (-(r["volume"] or 0), len(r["keyword"])))
        freq: dict[str, int] = {}
        for r in members:
            for w in set(_words(r["keyword"])) - STOP:
                freq[w] = freq.get(w, 0) + 1
        # the pillar is the broad, central search of the topic: many of the topic's common words in few words, with real searches
        pillar = max(members[:40], key=lambda r: (sum(freq.get(w, 0) for w in set(_words(r["keyword"])) - STOP) / max(1, len(_words(r["keyword"]))) ** 1.5) * math.log10((r["volume"] or 0) + 10) * (2 if set(_words(r["keyword"])) & seed_words else 1))
        others = [r for r in members if r is not pillar]
        subs, loose = _group(others, seed_words | {name}, 2)
        pages = [{"lead": s[0]["keyword"], "word": w, "volume": sum(r["volume"] or 0 for r in s), "keywords": sorted(s, key=lambda r: -(r["volume"] or 0))} for w, s in subs[:12]]
        topics.append({"topic": pillar["keyword"], "word": name, "volume": sum(r["volume"] or 0 for r in members), "count": len(members),
                       "pillar": {"keyword": pillar["keyword"], "volume": pillar["volume"], "index": pillar["index"], "intent": pillar["intent"], "keywords": loose[:15]}, "pages": pages})
    topics.sort(key=lambda t: -t["volume"])
    return {"state": "ok", "seeds": seeds, "country": cc, "topics": topics, "ungrouped": len(rest), "analysed": len(kept), "dropped": len(junk),
            "source": "Google Keyword Planner ideas, grouped by shared words"}
