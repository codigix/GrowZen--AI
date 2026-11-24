"""Where a keyword is already used: the website's pages, the blogs, the FAQs, the Google posts and the Google profile.

A keyword counts as used in a text when every word that matters in it is there (the same rule the keyword status and the placement view use). Everything is read from what the platform
holds: the last site crawl (address, title, heading and description of each page), the articles written in bevisibe, the profile's FAQs, the Google posts and the profile text.
`docs()` reads them once; `counts()` and `detail()` then answer for any keyword, tracked or not.
"""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Article, Business, Post
from . import growth_content as gc
from . import keyword_placement as kp

PLACES = [("address", "address"), ("title", "title"), ("heading", "heading"), ("description", "description")]


def _snippet(text: str, n: int = 110) -> str:
    return " ".join(re.sub(r"<[^>]+>", " ", text or "").split())[:n]


def docs(db: Session, b: Business) -> dict[str, list[dict[str, Any]]]:
    pages = []
    for p in kp._pages(db, b):
        path = (urlsplit(p["url"]).path or "/").rstrip("/") or "/"
        h1 = p.get("h1") if isinstance(p.get("h1"), str) else " ".join(p.get("h1") or [])
        generic = bool(p.get("_generic"))
        pages.append({"url": p["url"], "path": path, "title": p.get("title") or "", "parts": {"address": gc._corpus([re.sub(r"[-_/]+", " ", path)]), "title": set() if generic else gc._corpus([p.get("title")]),
                                                                                       "heading": gc._corpus([h1]), "description": set() if generic else gc._corpus([p.get("meta_description")])}})
    blogs = []
    for a in db.scalars(select(Article).where(Article.business_id == b.id)):
        if a.status != "completed":
            continue
        live = a.wp_status == "publish" or a.react_status == "publish"
        blogs.append({"id": a.id, "title": a.title or a.keyword, "url": a.wp_url or a.react_url, "state": "Live" if live else "Not posted yet",
                      "corp": gc._corpus([a.title, a.keyword, " ".join(a.secondary_keywords or []), a.body]), "in_title": gc._corpus([a.title, a.keyword])})
    faqs = [{"q": str(f.get("q") or "")[:160], "corp": gc._corpus([f.get("q"), f.get("a")])} for f in (b.faqs or []) if isinstance(f, dict) and f.get("q")]
    posts = []
    for p in db.scalars(select(Post).where(Post.business_id == b.id)):
        posts.append({"id": p.id, "text": _snippet(f"{p.title or ''} {p.body or ''}"), "state": {"published": "Live", "scheduled": "Scheduled", "draft": "Draft", "failed": "Failed"}.get(p.status, p.status), "corp": gc._corpus([p.title, p.body])})
    svc = [f"{s.get('name', '')} {s.get('description', '')}" if isinstance(s, dict) else str(s) for s in (b.services or [])]
    profile = {"description": gc._corpus([b.description]), "services": gc._corpus(svc)}
    return {"pages": pages, "blogs": blogs, "faqs": faqs, "posts": posts, "profile": profile}  # type: ignore[dict-item]


def counts(d: dict[str, Any], keyword: str) -> dict[str, int]:
    has = gc.has_keyword
    return {"pages": sum(1 for p in d["pages"] if any(has(c, keyword) for c in p["parts"].values())), "blogs": sum(1 for x in d["blogs"] if has(x["corp"], keyword)),
            "faqs": sum(1 for x in d["faqs"] if has(x["corp"], keyword)), "posts": sum(1 for x in d["posts"] if has(x["corp"], keyword)),
            "profile": int(has(d["profile"]["description"], keyword)) + int(has(d["profile"]["services"], keyword))}


def detail(d: dict[str, Any], keyword: str) -> dict[str, Any]:
    has = gc.has_keyword
    pages = [{"url": p["url"], "path": p["path"], "title": p["title"], "places": [label for key, label in PLACES if has(p["parts"][key], keyword)]} for p in d["pages"] if any(has(c, keyword) for c in p["parts"].values())]
    blogs = [{"id": x["id"], "title": x["title"], "url": x["url"], "state": x["state"], "in_title": has(x["in_title"], keyword)} for x in d["blogs"] if has(x["corp"], keyword)]
    faqs = [{"q": x["q"]} for x in d["faqs"] if has(x["corp"], keyword)]
    posts = [{"id": x["id"], "text": x["text"], "state": x["state"]} for x in d["posts"] if has(x["corp"], keyword)]
    prof = {"description": has(d["profile"]["description"], keyword), "services": has(d["profile"]["services"], keyword)}
    pages.sort(key=lambda p: (-len(p["places"]), p["path"]))
    return {"keyword": keyword, "pages": pages[:30], "blogs": blogs[:30], "faqs": faqs[:30], "posts": posts[:30], "profile": prof, "counts": counts(d, keyword)}
