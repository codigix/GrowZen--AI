"""The My Keywords table in one place: for each chosen keyword, where it came from, where it ranks on Google, what Search Console says about it (impressions, clicks, click rate), whether AI assistants mention
the business for it, the page it is mapped to against the page Google really shows, that page's index status, and what Google Analytics says about the page. Every figure is read from a real source; a figure
with no source for this project is left empty with the reason.

Slow parts (positions, the keyword status, the mapping suggestions, the AI answers) are worked out in the background and stored (search_insights.snapshot, kind "kwtable"); the fast parts (the page chosen,
index status, Analytics for the page) are read from the database on every load, so a page chosen a second ago shows at once.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, GeoPrompt, GeoResult, IndexPage, Keyword, SearchSnapshot
from . import growth_content as gc
from . import google_rank, gsc, keyword_ai, keyword_mapping, keyword_status, market


def path_of(url: str | None) -> str:
    p = urlsplit(url or "").path or "/"
    return p if p == "/" else p.rstrip("/")


def heavy(db: Session, b: Business) -> dict[str, Any]:
    """The slow figures per keyword: position and Search Console numbers (keyword status), the page the mapping suggests, and whether AI assistants mention the business for it."""
    st = keyword_status.status(db, b)
    plan = keyword_mapping.plan(db, b)
    suggested: dict[str, dict[str, str]] = {}
    for pg in plan["pages"]:
        if pg["primary"]:
            suggested[pg["primary"]] = {"url": pg["url"], "path": pg["path"], "role": "main"}
        for s in pg["secondary"]:
            suggested[s] = {"url": pg["url"], "path": pg["path"], "role": "supporting"}
    prompts = list(db.scalars(select(GeoPrompt).where(GeoPrompt.business_id == b.id, GeoPrompt.active.is_(True))))
    corpora = [(p.id, gc._corpus([p.prompt])) for p in prompts]
    mentioned: dict[int, bool] = {}
    if prompts:
        for r in db.scalars(select(GeoResult).where(GeoResult.business_id == b.id, GeoResult.prompt_id.in_([p.id for p in prompts]))):
            mentioned[r.prompt_id] = mentioned.get(r.prompt_id, False) or bool(r.mentioned)
    # Search Console now: one request for every keyword (28 days, the business's own country), so the figures are as fresh as this refresh and not as old as the last saved position check
    live: dict[str, dict[str, Any]] | None = None
    google_error = None
    if b.website:
        try:
            live = google_rank.organic_positions(db, b, [it["keyword"] for it in st["items"]], 28)
        except Exception as exc:  # noqa: BLE001 - the saved checks stand, and the reason is said
            google_error = str(exc)[:220]
    end = date.today() - timedelta(days=gsc.LAG_DAYS)
    window = {"start": (end - timedelta(days=27)).isoformat(), "end": end.isoformat(), "days": 28, "country": market.serp_country(b)}
    rows: dict[str, dict[str, Any]] = {}
    for it in st["items"]:
        kw = it["keyword"]
        asked = [pid for pid, corpus in corpora if gc.has_keyword(corpus, kw)]
        rank, impressions, clicks, ranking_url, status_, label, why = it.get("rank"), it.get("impressions"), it.get("clicks"), it.get("ranking_url"), it["status"], it["label"], it["why"]
        if live is not None:
            d = live.get(kw)
            impressions, clicks = (d["impressions"], d["clicks"]) if d else (0, 0)  # Google was asked: none means it showed the site 0 times for this search
            rank, ranking_url = (max(1, round(d["position"])) if d else None), (d["url"] if d else None)
            status_, label, why = keyword_status._verdict({"rank": rank, "clicks": clicks, "impressions": impressions, "checked": True}, bool(it.get("used_in")))
        rows[kw] = {"rank": rank, "change": it.get("change"), "best": it.get("best"), "impressions": impressions, "clicks": clicks,
                    "ctr": round(clicks * 100 / impressions, 1) if impressions else None, "ranking_url": ranking_url, "checked": it.get("checked"),
                    "status": status_, "label": label, "why": why, "used_in": it.get("used_in") or [], "articles": it.get("articles") or 0, "next": it.get("next"),
                    "suggested": suggested.get(kw), "ai": {"tracked": bool(asked), "mentioned": (any(mentioned.get(pid) for pid in asked) if asked else None)}}
    return {"rows": rows, "state": st["state"], "rank_ready": st.get("rank_ready"), "window": window, "google": "live" if live is not None else "saved", "google_error": google_error,
            "google_total": ({"impressions": sum(r["impressions"] or 0 for r in rows.values()), "clicks": sum(r["clicks"] or 0 for r in rows.values()), "searches": sum(1 for r in rows.values() if r["impressions"])} if live is not None else None)}


def _ga_rows(db: Session, b: Business) -> tuple[dict[str, dict[str, Any]], str]:
    """Organic landing-page figures from the stored Search Insights read, by page path. (state, rows): Analytics only knows pages, not searches."""
    snap = db.scalar(select(SearchSnapshot).where(SearchSnapshot.business_id == b.id, SearchSnapshot.kind == "insights"))
    a = ((snap.payload or {}).get("analytics") or {}) if snap else {}
    if a.get("state") != "ok":
        return {}, "not_connected" if snap else "not_read"
    return {r["path"]: r for r in (a.get("landing_pages") or {}).get("rows") or []}, "ok"


def _index_for(rows: dict[str, IndexPage], url: str | None) -> dict[str, Any] | None:
    if not url:
        return None
    p = rows.get(path_of(url))
    if p is None:
        return {"state": "unknown", "page": path_of(url), "reason": "This page is not in your page list yet: scan it in Page Indexing."}
    tech = (p.tech or {}).get("verdict")
    reason = p.g_reason or (((p.tech or {}).get("reasons") or [{}])[0].get("text") if tech in ("risky", "blocked") else None)
    return {"state": p.g_state or "unchecked", "page": path_of(url), "reason": reason, "tech": tech}


def merge(db: Session, b: Business, stored: dict[str, Any] | None) -> dict[str, Any]:
    """The table rows: the stored slow figures with the live fields (chosen page, index status, Analytics for the page) from the database."""
    slow = (stored or {}).get("rows") or {}
    pages = {path_of(p.url): p for p in db.scalars(select(IndexPage).where(IndexPage.business_id == b.id))}
    ga, ga_state = _ga_rows(db, b)
    out = []
    for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True)).order_by(Keyword.volume.desc().nullslast(), Keyword.keyword)):
        s = slow.get(k.keyword) or {}
        src = k.source or {}
        target = k.target_url
        sug = s.get("suggested")
        shown = target or (sug or {}).get("url") or s.get("ranking_url")
        landing = ga.get(path_of(shown)) if shown else None
        out.append({"id": k.id, "keyword": k.keyword, "source": {"kind": src.get("kind"), "label": src.get("label")}, "intent": k.intent, "cluster": k.cluster, "priority": k.priority,
                    "volume": k.volume, "difficulty": k.difficulty, "rank": s.get("rank", k.rank), "change": s.get("change"), "best": s.get("best"), "impressions": s.get("impressions"), "clicks": s.get("clicks"),
                    "ctr": s.get("ctr"), "ranking_url": s.get("ranking_url"), "ranking_path": path_of(s["ranking_url"]) if s.get("ranking_url") else None, "checked": s.get("checked"),
                    "status": s.get("status") or ("unchecked" if not k.rank else None), "label": s.get("label"), "why": s.get("why"), "used_in": s.get("used_in") or [], "articles": s.get("articles") or 0,
                    "ai": s.get("ai") or {"tracked": False, "mentioned": None}, "target_url": target, "target_path": path_of(target) if target else None, "mapped": bool(target),
                    "suggested": sug, "role": k.role, "index": _index_for(pages, shown), "index_for": path_of(shown) if shown else None,
                    "ga": ({"sessions": landing["sessions"], "engagement_rate": landing["engagement_rate"], "key_events": landing["key_events"], "path": landing["path"]} if landing else None),
                    "ga_state": ga_state if not landing else "ok"})
    return {"rows": out, "state": (stored or {}).get("state"), "ga_state": ga_state, "ready": stored is not None, "window": (stored or {}).get("window"), "google": (stored or {}).get("google"),
            "google_error": (stored or {}).get("google_error"), "google_total": (stored or {}).get("google_total")}
