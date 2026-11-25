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

WEIGHT = {"title": 3, "heading": 2, "slug": 2, "description": 1, "phrases": 1}
NEEDED = 1.0  # a page carries a keyword when its places add up to at least this (a partial match counts half)
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


def _cover(words: set[str], keyword: str) -> float:
    """1 when the place holds every word of the keyword, a half when it holds most of a longer keyword (two of three), else 0."""
    c = gc.core(keyword)
    if not c or not words:
        return 0.0
    hit = sum(1 for w in c if w in words)
    return 1.0 if hit == len(c) else 0.5 if len(c) >= 3 and hit / len(c) >= 0.66 else 0.0


STATUSES = {"not_mapped": "Not mapped", "mapped": "Mapped", "optimization": "Optimization required", "new_page": "New page required", "completed": "Completed"}
BY_HAND = ("optimization", "new_page", "completed")  # the statuses a person sets: the others are worked out


def plan(db: Session, b: Business) -> dict[str, Any]:
    crawl = gc._crawl(db, b)
    pages = [p for p in (crawl.get("pages") or []) if p.get("status") == 200 and p.get("url")]
    kws = list(db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True))))
    kws.sort(key=lambda k: -(k.volume or 0))
    corp = []
    # A site that sends the same title and description on most pages (a single-page app) says nothing about which page is which: those two are ignored there and the web address leads.
    from collections import Counter
    same = Counter(((p.get("title") or "").strip(), (p.get("meta_description") or "").strip()) for p in pages)
    shared = {k for k, n in same.items() if n >= 3 and k != ("", "")}
    for p in pages:
        generic = ((p.get("title") or "").strip(), (p.get("meta_description") or "").strip()) in shared and _key(urlsplit(p["url"]).path or "/") != "/"
        path = _key(urlsplit(p["url"]).path or "/")
        corp.append({"p": p, "path": path, "generic": generic,
                     "parts": {"title": set() if generic else gc._corpus([p.get("title")]), "heading": gc._corpus([_h1(p)]), "description": set() if generic else gc._corpus([p.get("meta_description")]),
                               "slug": gc._corpus([re.sub(r"[-_/]+", " ", path)]), "phrases": gc._corpus([x.get("keyword") for x in (p.get("top_keywords") or []) if isinstance(x, dict)])}})
    by_path = {c["path"]: c for c in corp}
    assigned: dict[str, list[Keyword]] = {}
    missing, blog = [], []
    plan_pages: dict[str, dict[str, Any]] = {}
    mapped = 0
    placed: dict[int, str | None] = {}  # keyword id -> the path it is on (None: no page carries it)
    carriers: dict[int, list[tuple[str, float]]] = {}  # keyword id -> every page that carries it, strongest first
    for k in kws:
        manual = _key(urlsplit(k.target_url).path or "/") if k.target_url else None
        best, best_score = None, 0
        for c in corp:
            score = sum(WEIGHT[part] * _cover(words, k.keyword) for part, words in c["parts"].items())
            if score >= NEEDED:
                carriers.setdefault(k.id, []).append((c["path"], score))
            if score > best_score or (score == best_score and score and len(c["path"]) < len(best["path"])):
                best, best_score = c, score
        carriers[k.id] = sorted(carriers.get(k.id, []), key=lambda x: -x[1])
        if manual and manual in by_path:
            best = by_path[manual]
        elif best_score < NEEDED:
            best = None
        placed[k.id] = best["path"] if best is not None else None
        if best is not None:
            assigned.setdefault(best["path"], []).append(k)
            mapped += 1
        elif corp:
            item = {"keyword": k.keyword, "volume": k.volume, "intent": k.intent}
            if is_blog(k.keyword, k.intent):
                blog.append(item | {"title": k.keyword[:1].upper() + k.keyword[1:], "slug": _slug(k.keyword)})
            else:
                pg = ((k.source or {}) if isinstance(k.source, dict) else {}).get("page")  # the page the Strategy Builder planned for it
                if pg:
                    e = plan_pages.setdefault(pg, {"keyword": pg, "volume": 0, "intent": k.intent, "title": pg.title(), "slug": "/" + _slug(pg), "keywords": [], "planned": True})
                    e["keywords"].append(k.keyword)
                    e["volume"] += k.volume or 0
                else:
                    missing.append(item | {"title": k.keyword.title(), "slug": "/" + _slug(k.keyword)})
    missing = list(plan_pages.values()) + missing
    out_pages = []
    for c in corp:
        ks = sorted(assigned.get(c["path"], []), key=lambda k: (-(k.volume or 0), len(k.keyword)))
        top = ks[0] if ks else None
        saved = bool(top and top.role == "primary" and top.target_url and _key(urlsplit(top.target_url).path or "/") == c["path"])  # the suggestion is already written on the keyword
        out_pages.append({"url": c["p"]["url"], "path": c["path"], "title": c["p"].get("title") or "", "primary": top.keyword if top else None, "primary_volume": top.volume if top else None,
                          "secondary": [k.keyword for k in ks[1:]], "keywords": len(ks), "saved": saved})
    out_pages.sort(key=lambda x: (-x["keywords"], x["path"]))
    notes = []
    if any(c["generic"] for c in corp):
        notes.append(f"{sum(1 for c in corp if c['generic'])} pages send the same title and description in their HTML (a single-page site), so they are matched by their web address only. "
                     "Give every page its own title, heading and description and the mapping becomes exact.")
    status_rows, risks, duplicates = _status_and_risks(kws, placed, carriers, bool(corp))
    return {"statuses": status_rows, "status_counts": {s: sum(1 for r in status_rows if r["status"] == s) for s in STATUSES}, "cannibalization": risks, "duplicates": duplicates,
            "crawled": bool(pages), "notes": notes, "found_at": crawl.get("_found"), "pages": out_pages, "missing_pages": missing, "blog_opportunities": blog, "keywords": len(kws), "mapped": mapped,
            "unmapped": len(missing) + len(blog), "pages_without_keyword": sum(1 for p in out_pages if not p["keywords"]), "primaries": sum(1 for p in out_pages if p["primary"])}


def _core_key(keyword: str) -> frozenset:
    return frozenset(gc.core(keyword))


def _status_and_risks(kws: list[Keyword], placed: dict[int, str | None], carriers: dict[int, list[tuple[str, float]]], crawled: bool) -> tuple[list[dict], list[dict], list[dict]]:
    """Per keyword: its mapping status (set by hand, else worked out: on a page = mapped, no page carries it = new page required, no scan = not mapped).
    Cannibalization risks: a keyword that two or more pages carry about equally (they would compete with each other), and the same keyword written two ways sent to different pages.
    Duplicate page targeting: a page that holds two main keywords, or two keywords that are the same words in another order."""
    rows = []
    for k in kws:
        path = placed.get(k.id)
        auto = "mapped" if path else "new_page" if crawled else "not_mapped"
        rows.append({"id": k.id, "keyword": k.keyword, "volume": k.volume, "role": k.role, "page": path, "target_url": k.target_url, "status": k.mapping_status if k.mapping_status in BY_HAND else auto, "by_hand": k.mapping_status in BY_HAND})
    risks = []
    for k in kws:
        c = carriers.get(k.id) or []
        close = [p for p, sc in c if c and sc >= c[0][1] * 0.6][:4]  # the pages that carry it about as strongly as the best one
        if len(close) >= 2:
            risks.append({"keyword": k.keyword, "volume": k.volume, "pages": close, "kind": "pages_compete",
                          "why": f"{len(close)} pages carry it about equally ({', '.join(close[:3])}). Pick one page for it and make the others point to that page or use other keywords."})
    by_core: dict[frozenset, list[Keyword]] = {}
    for k in kws:
        if _core_key(k.keyword):
            by_core.setdefault(_core_key(k.keyword), []).append(k)
    duplicates = []
    for ks in by_core.values():
        if len(ks) < 2:
            continue
        pages = {placed.get(k.id) for k in ks if placed.get(k.id)}
        entry = {"keywords": [k.keyword for k in ks], "pages": sorted(pages), "kind": "same_words"}
        if len(pages) >= 2:
            risks.append({"keyword": " / ".join(k.keyword for k in ks), "volume": max((k.volume or 0) for k in ks), "pages": sorted(pages), "kind": "same_keyword_two_pages",
                          "why": "The same words are saved as separate keywords and sent to different pages, so those pages compete. Keep one keyword and one page."})
        duplicates.append(entry | {"why": "These keywords are the same words in another order or form: one page should target them together."})
    prim: dict[str, list[str]] = {}
    for k in kws:
        if k.role == "primary" and placed.get(k.id):
            prim.setdefault(placed[k.id], []).append(k.keyword)
    for path, names in prim.items():
        if len(names) >= 2:
            duplicates.append({"keywords": names, "pages": [path], "kind": "two_primaries", "why": f"{path} has {len(names)} main keywords. A page should have one main keyword; make the others supporting."})
    risks.sort(key=lambda r: -(r["volume"] or 0))
    return rows, risks, duplicates


def assign(db: Session, b: Business, ids: list[int], target_url: str | None = None, role: str | None = None, status: str | None = None) -> dict[str, Any]:
    """Map several keywords at once: put them on a page, make them the page's main or a supporting keyword, and/or set their status. A page keeps one main keyword: the one that held it before
    becomes supporting. status 'mapped' or 'not_mapped' clears a status set by hand (the status is then worked out again)."""
    if role not in (None, "primary", "secondary"):
        raise ValueError("role must be primary or secondary")
    if status not in (None, "mapped", "not_mapped", *BY_HAND):
        raise ValueError("unknown status")
    if target_url:
        target_url = target_url.strip()
        if not re.match(r"^(https?://|/)", target_url):
            raise ValueError("The page must be a web address (https://…) or a path starting with /")
    ks = list(db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.id.in_(ids or [0]))))
    for k in ks:
        if target_url:
            k.target_url = target_url
        if role:
            k.role = role
        if status:
            k.mapping_status = status if status in BY_HAND else None
    if role == "primary" and target_url and ks:
        path = lambda u: (urlsplit(u or "").path or "/").rstrip("/") or "/"  # noqa: E731
        chosen = {k.id for k in ks}
        # one main keyword per page: of the keywords sent here as main, the first keeps it; and one that held it before becomes supporting
        for k in ks[1:]:
            k.role = "secondary"
        for other in db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.role == "primary", Keyword.tracked.is_(True))):
            if other.id not in chosen and other.target_url and path(other.target_url) == path(target_url):
                other.role = "secondary"
    db.commit()
    return {"updated": len(ks)}


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
