"""One status line per tracked keyword: where it ranks on Google now (Search Console), what it earns (impressions, clicks), where the business already uses it, and
whether it is worth pushing. Everything is read from what the platform already stores: nothing here is a new measurement.

The verdict is our plain-rule reading, with the reason in words:
  working      page 1 with real clicks: keep it up
  climbing     page 1 without clicks yet, or page 2: a small push can pay
  weak         page 3 or later
  invisible    checked, but Google Search Console shows no impressions
  unchecked    no position read yet
"Potential" is modelled, not measured: monthly searches times the usual click-through of the top spot, minus the clicks Search Console reports (28 days)."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Article, Business, Keyword
from . import keyword_ai, landscape


def _verdict(row: dict[str, Any], used_any: bool) -> tuple[str, str, str]:
    """(status, label, reason)"""
    rank, clicks, imps = row.get("rank"), row.get("clicks") or 0, row.get("impressions") or 0
    if not row.get("checked"):
        return "unchecked", "Not checked yet", "No position has been read yet. Press “Check positions now” in Position Tracking."
    if rank is None:
        why = "Google Search Console shows no impressions in the last 28 days: the site is not shown for this search."
        return "invisible", "Not showing", why + ("" if used_any else " It is not used on your website, blog or posts yet: use it first.")
    if rank <= 10 and clicks > 0:
        return "working", "Working", f"Average position {rank} with {clicks} click{'s' if clicks != 1 else ''} in 28 days."
    if rank <= 10:
        return "climbing", "Page 1, no clicks yet", f"Average position {rank} but no clicks: improve the title and description so people choose it."
    if rank <= 20:
        return "climbing", "Almost page 1", f"Average position {rank} (page 2). A better page for it can reach page 1."
    return "weak", "Weak", f"Average position {rank}: far from the first page. Give it a focused page, or decide it is not worth the effort."


def status(db: Session, b: Business) -> dict[str, Any]:
    from ..routers import seo
    rep = seo.rank_report(b, db)
    usage = {i["keyword"]: i for i in keyword_ai.usage(db, b)["items"]}
    kws = {k.keyword: k for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True)))}
    arts: dict[str, int] = {}
    for a in db.scalars(select(Article).where(Article.business_id == b.id, Article.status == "completed")):
        for k in [a.keyword, *(a.secondary_keywords or [])]:
            arts[" ".join(str(k).lower().split())] = arts.get(" ".join(str(k).lower().split()), 0) + 1
    by_rank = {r["keyword"]: r for r in rep.get("rows", [])}
    out = []
    for name, k in kws.items():
        r = by_rank.get(name, {"keyword": name, "checked": None, "rank": None})
        u = usage.get(name, {"used": {}, "planned": []})
        used_areas = [a for a, ok in (u.get("used") or {}).items() if ok]
        status_, label, why = _verdict(r, bool(used_areas))
        potential = None
        if k.volume:
            potential = max(0, round(k.volume * landscape.CTR[0] - (r.get("clicks") or 0)))  # per month vs 28 days: close enough to rank by, and labelled modelled
        out.append({"keyword": name, "volume": k.volume, "difficulty": k.difficulty, "intent": k.intent, "cluster": k.cluster, "target_url": k.target_url,
                    "rank": r.get("rank"), "change": r.get("change"), "best": r.get("best"), "impressions": r.get("impressions"), "clicks": r.get("clicks"), "maps_rank": r.get("maps_rank"),
                    "ranking_url": r.get("url"), "checked": r.get("checked"), "used_in": used_areas, "planned": u.get("planned") or [], "articles": arts.get(name, 0),
                    "status": status_, "label": label, "why": why, "potential": potential,
                    "next": _next(status_, used_areas, k.target_url, arts.get(name, 0), r)})
    order = {"working": 0, "climbing": 1, "weak": 2, "invisible": 3, "unchecked": 4}
    out.sort(key=lambda x: (order[x["status"]], -(x["volume"] or 0)))
    counts = {s: sum(1 for x in out if x["status"] == s) for s in order}
    return {"state": rep.get("state", "ok") if out else "no_keywords", "rank_ready": rep.get("rank_ready"), "items": out, "counts": counts, "total": len(out),
            "clicks": sum(x["clicks"] or 0 for x in out), "impressions": sum(x["impressions"] or 0 for x in out), "areas": keyword_ai.USES}


def _next(status_: str, used: list[str], target: str | None, articles: int, r: dict[str, Any]) -> dict[str, str]:
    if status_ == "unchecked":
        return {"text": "Read its position", "to": "/rank-tracking/positions"}
    if not used:
        return {"text": "Use it on a page or in a blog", "to": "/keyword-management/use"}
    if not target:
        return {"text": "Give it one target page", "to": "/keyword-management/tracked"}
    if status_ in ("invisible", "weak") and not articles:
        return {"text": "Write a blog for it", "to": "/ai-content-generation/blog"}
    if status_ == "climbing":
        return {"text": "Improve the page and add links to it", "to": "/website-audit?tab=xray"}
    if status_ == "working":
        return {"text": "Keep it fresh: update the page now and then", "to": "/rank-tracking/positions"}
    return {"text": "Check the page that should rank", "to": "/rank-tracking/positions"}


def pages_for_keywords(db: Session, b: Business) -> dict[str, Any]:
    """For each tracked keyword, the website pages that use it, read from the last site crawl: the page's title, meta description and main heading.
    A page counts when it carries every word of the keyword (same rule as "where it is used" elsewhere). The crawl does not keep body text, so this
    is where the page says what it is about, not every mention."""
    from urllib.parse import urlsplit
    from . import growth_content as gc
    crawl = gc._crawl(db, b)
    pages = [p for p in (crawl.get("pages") or []) if p.get("status") == 200 and p.get("url")]
    rows = list(db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True))))
    out: dict[str, list[dict[str, Any]]] = {}
    for k in rows:
        found = []
        for p in pages:
            h1 = p.get("h1") if isinstance(p.get("h1"), str) else " ".join(p.get("h1") or [])
            where = [label for label, text in (("title", p.get("title")), ("heading", h1), ("description", p.get("meta_description"))) if gc.has_keyword(gc._corpus([text]), k.keyword)]
            if where:
                path = urlsplit(p["url"]).path or "/"
                found.append({"url": p["url"], "path": path, "in": where})
        found.sort(key=lambda x: (-len(x["in"]), x["path"]))
        out[k.keyword] = found
    return {"crawled": bool(pages), "found_at": crawl.get("_found"), "pages": out}
