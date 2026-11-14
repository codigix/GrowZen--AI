"""Keywords worth targeting, taken from what the client's site and a competitor's site really say, with where each one came from.

Only the places a site uses to say what a page is about are read: its title, its main heading and its meta description (kept by the site crawl).
Repeated body words are not used: they give phrases like "price per unit" that nobody searches. A phrase counts when:
  - it is 2 to 4 words, does not start or end on a filler word, and holds no brand, company-suffix or address word;
  - it appears in a title or main heading, or on at least two pages.
Each phrase is then checked for real monthly searches in Google Keyword Planner (services/keyword_metrics). With that data only phrases that
people really search for are kept, ordered by searches. Without it (Google Ads not set up) the best-evidenced phrases are listed and
marked "searches not verified": nothing is guessed.
"""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, Keyword
from . import keyword_metrics, market
from .crawler import _KW_STOPWORDS

_WORD = re.compile(r"[a-z][a-z0-9'’-]{1,}")
_SPLIT = re.compile(r"\s[|\-–—:•·»&,/]\s|[|•·»&,/]")
_CORP = frozenset("pvt ltd llp inc limited private company co corp official website www com in org net".split())
_FILLER_IN = frozenset({"for", "in", "of", "to", "near", "with", "and", "on"})  # allowed inside a phrase, never at its ends
_MAX_CHECK = 150


def _words(text: str) -> list[str]:
    return [w.strip("'’-") for w in _WORD.findall((text or "").lower())]


def _brand_words(*names: str, hosts: tuple[str, ...] = ()) -> set[str]:
    """What identifies a site rather than describes it: its host name, and every run of two or more words of its business name.
    (A single word of the name, like "dental", can be a real keyword, so it is not removed on its own.)"""
    out: set[str] = set()
    for n in names:
        for part in re.split(r"[()]", n or ""):
            head = _SPLIT.split(part)[0]
            w = [x for x in _words(head) if x not in _CORP]
            for size in range(len(w), 1, -1):
                for i in range(len(w) - size + 1):
                    out.add(" ".join(w[i:i + size]))
    for h in hosts:
        h = (urlsplit(h if "//" in h else f"//{h}").hostname or h).lower().removeprefix("www.")
        if h:
            out.add(h.split(".")[0])
            out.add(h)
    return {x for x in out if x}


def _cut_brand(text: str, brand: set[str]) -> str:
    for ph in sorted(brand, key=len, reverse=True):
        text = re.sub(r"(?<![a-z0-9])" + r"[\W_]+".join(map(re.escape, ph.split())) + r"(?![a-z0-9])", " | ", text, flags=re.I)
    return text


def _grams(segment: str, brand: set[str]) -> set[str]:
    words = _words(segment)
    out: set[str] = set()
    for n in (2, 3, 4):
        for i in range(len(words) - n + 1):
            g = words[i:i + n]
            if g[0] in _KW_STOPWORDS or g[-1] in _KW_STOPWORDS or g[0] in _FILLER_IN or g[-1] in _FILLER_IN:
                continue
            if any(w in _CORP or w.isdigit() for w in g):
                continue
            if any(w in _KW_STOPWORDS and w not in _FILLER_IN for w in g):
                continue
            out.add(" ".join(g))
    return out


def _site_phrases(crawl: dict[str, Any], brand: set[str]) -> dict[str, dict[str, Any]]:
    """{phrase: {score, pages: [{url, path, in: [...]}]}} from the title, main heading and meta description of every crawled page."""
    found: dict[str, dict[str, Any]] = {}
    for p in crawl.get("pages") or []:
        if p.get("status") != 200 or not p.get("url"):
            continue
        h1 = p.get("h1") if isinstance(p.get("h1"), str) else " ".join(p.get("h1") or [])
        spots: dict[str, set[str]] = {}
        for label, text in (("title", p.get("title")), ("heading", h1), ("description", p.get("meta_description"))):
            for seg in _SPLIT.split(_cut_brand(text or "", brand)):
                for g in _grams(seg, brand):
                    spots.setdefault(g, set()).add(label)
        path = urlsplit(p["url"]).path or "/"
        for g, where in spots.items():
            row = found.setdefault(g, {"score": 0, "pages": []})
            row["score"] += (3 if "title" in where else 0) + (3 if "heading" in where else 0) + (1 if "description" in where else 0)
            row["pages"].append({"url": p["url"], "path": path, "in": sorted(where)})
    return {g: r for g, r in found.items() if r["score"] >= 3 or len(r["pages"]) >= 2}


def _drop_inside(rows: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """A phrase fully contained in a longer one used on the same pages adds nothing: keep the longer."""
    keys = sorted(rows, key=len, reverse=True)
    out: dict[str, dict[str, Any]] = {}
    for k in keys:
        if any(k in kept and rows[k]["score"] <= rows[kept]["score"] for kept in out):
            continue
        out[k] = rows[k]
    return out


def researched(db: Session, business_id: int | None, our_crawl: dict[str, Any], their_crawl: dict[str, Any], *, our_name: str = "", their_name: str = "",
               our_host: str = "", their_host: str = "", limit: int = 60) -> dict[str, Any]:
    brand = _brand_words(our_name, their_name, hosts=tuple(h for h in (our_host, their_host) if h))
    ours = _drop_inside(_site_phrases(our_crawl, brand)) if our_crawl.get("pages") else {}
    theirs = _drop_inside(_site_phrases(their_crawl, brand)) if their_crawl.get("pages") else {}
    names = set(ours) | set(theirs)
    ranked = sorted(names, key=lambda g: -((ours.get(g) or {"score": 0})["score"] + (theirs.get(g) or {"score": 0})["score"]))[:_MAX_CHECK]
    b = db.get(Business, business_id) if business_id else None
    metrics, why = ({}, "No project, so search volume cannot be looked up.") if not b else keyword_metrics.lookup(ranked, market.serp_country(b))
    verified = bool(metrics)
    tracked = {k.keyword for k in db.scalars(select(Keyword).where(Keyword.business_id == business_id))} if business_id else set()
    rows = []
    for g in ranked:
        m = metrics.get(g) or {}
        vol = m.get("volume")
        if verified and not vol:
            continue  # nobody is measured searching it: not a keyword
        side = "both" if g in ours and g in theirs else "competitor" if g in theirs else "client"
        sources = [{"side": s, "name": (their_name or "Competitor") if s == "competitor" else (our_name or "Your site"), **pg}
                   for s, src in (("client", ours), ("competitor", theirs)) if g in src for pg in src[g]["pages"][:4]]
        rows.append({"keyword": g, "side": side, "volume": vol, "cpc": m.get("cpc"), "difficulty": m.get("difficulty"), "evidence": (ours.get(g) or {"score": 0})["score"] + (theirs.get(g) or {"score": 0})["score"],
                     "pages": len((ours.get(g) or {"pages": []})["pages"]) + len((theirs.get(g) or {"pages": []})["pages"]), "sources": sources, "tracked": g in tracked})
    rows.sort(key=lambda r: (-(r["volume"] or 0), -r["evidence"]))
    if not verified:
        rows = rows[:40]
    return {"available": bool(rows), "verified": verified, "volume_note": None if verified else (why or "Search volume is not available, so these phrases are ordered by how strongly the sites use them, not by searches."),
            "source": "titles, main headings and meta descriptions of the pages both sites were crawled for", "items": rows[:limit],
            "counts": {s: sum(1 for r in rows if r["side"] == s) for s in ("both", "competitor", "client")}}
