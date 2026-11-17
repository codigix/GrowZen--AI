"""Keyword mapping: which website page each chosen keyword belongs to, which keyword is the page's main (primary) one, which pages are missing and which
keywords are better as blog posts. Read from the latest site crawl (title, main heading, meta description of each page); nothing is invented.

A page "carries" a keyword when it holds every word of it (same rule as everywhere else). A keyword goes to the page that carries it in the strongest place
(title, then heading, then description). The primary keyword of a page is its highest-searched keyword; the others are secondary. A keyword no page
carries is either a blog opportunity (a question, guide or comparison) or a page the site is missing.
"""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, Keyword
from . import growth_content as gc

WEIGHT = {"title": 3, "heading": 2, "description": 1}
BLOG_WORDS = ("how ", "what ", "why ", "which ", "when ", "guide", "tips", "vs ", " vs", "difference", "benefits", "ideas", "meaning", "examples")


def _h1(p: dict[str, Any]) -> str:
    return p.get("h1") if isinstance(p.get("h1"), str) else " ".join(p.get("h1") or [])


def _slug(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.lower())).strip("-")[:60]


def is_blog(keyword: str, intent: str | None) -> bool:
    k = f" {keyword.lower()} "
    return intent == "informational" or any(w in k for w in BLOG_WORDS)


def _key(path: str) -> str:
    return path.rstrip("/") or "/"


def plan(db: Session, b: Business) -> dict[str, Any]:
    crawl = gc._crawl(db, b)
    pages = [p for p in (crawl.get("pages") or []) if p.get("status") == 200 and p.get("url")]
    kws = list(db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True))))
    kws.sort(key=lambda k: -(k.volume or 0))
    corp = []
    for p in pages:
        corp.append({"p": p, "path": _key(urlsplit(p["url"]).path or "/"),
                     "parts": {"title": gc._corpus([p.get("title")]), "heading": gc._corpus([_h1(p)]), "description": gc._corpus([p.get("meta_description")])}})
    by_path = {c["path"]: c for c in corp}
    assigned: dict[str, list[Keyword]] = {}
    missing, blog = [], []
    mapped = 0
    for k in kws:
        manual = _key(urlsplit(k.target_url).path or "/") if k.target_url else None
        best, best_score = None, 0
        for c in corp:
            score = sum(WEIGHT[part] for part, words in c["parts"].items() if gc.has_keyword(words, k.keyword))
            if score > best_score or (score == best_score and score and len(c["path"]) < len(best["path"])):
                best, best_score = c, score
        if manual and manual in by_path:
            best = by_path[manual]
        elif best_score == 0:
            best = None
        if best is not None:
            assigned.setdefault(best["path"], []).append(k)
            mapped += 1
        elif corp:
            item = {"keyword": k.keyword, "volume": k.volume, "intent": k.intent}
            if is_blog(k.keyword, k.intent):
                blog.append(item | {"title": k.keyword[:1].upper() + k.keyword[1:], "slug": _slug(k.keyword)})
            else:
                missing.append(item | {"title": k.keyword.title(), "slug": "/" + _slug(k.keyword)})
    out_pages = []
    for c in corp:
        ks = sorted(assigned.get(c["path"], []), key=lambda k: (-(k.volume or 0), len(k.keyword)))
        out_pages.append({"url": c["p"]["url"], "path": c["path"], "title": c["p"].get("title") or "", "primary": ks[0].keyword if ks else None, "primary_volume": ks[0].volume if ks else None,
                          "secondary": [k.keyword for k in ks[1:]], "keywords": len(ks)})
    out_pages.sort(key=lambda x: (-x["keywords"], x["path"]))
    return {"crawled": bool(pages), "found_at": crawl.get("_found"), "pages": out_pages, "missing_pages": missing, "blog_opportunities": blog, "keywords": len(kws), "mapped": mapped,
            "unmapped": len(missing) + len(blog), "pages_without_keyword": sum(1 for p in out_pages if not p["keywords"]), "primaries": sum(1 for p in out_pages if p["primary"])}


def apply(db: Session, b: Business) -> dict[str, Any]:
    """Save the plan on the keywords: the page each belongs to (never over a page you chose) and primary or secondary."""
    p = plan(db, b)
    got: dict[str, tuple[str, str]] = {}
    for page in p["pages"]:
        if page["primary"]:
            got[page["primary"]] = (page["url"], "primary")
        for s in page["secondary"]:
            got[s] = (page["url"], "secondary")
    n = 0
    for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True))):
        hit = got.get(k.keyword)
        if not hit:
            continue
        if not k.target_url:
            k.target_url = hit[0]
            n += 1
        k.role = hit[1]
    db.commit()
    return {"mapped": n, "primaries": p["primaries"]}
