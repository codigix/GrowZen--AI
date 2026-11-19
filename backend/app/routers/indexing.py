"""Page indexing API.

GET  /businesses/{id}/indexing            settings, counts and the pages (from our own records: fast)
GET  /businesses/{id}/indexing/google     whether Google can be asked about this site, and the sitemaps it knows
POST /businesses/{id}/indexing/scan       read the sitemap now: new and changed pages
POST /businesses/{id}/indexing/submit     send new and changed pages (or the chosen ones) to the search engines that take IndexNow
POST /businesses/{id}/indexing/inspect    ask Google about pages (URL Inspection API)
POST /businesses/{id}/indexing/verify-key check that the IndexNow key file is on the site
GET  /businesses/{id}/indexing/key-file   the key file to upload to the site's root
PUT  /businesses/{id}/indexing/settings   automatic indexing on or off
POST /businesses/{id}/indexing/run        the whole daily routine now
"""
from datetime import timedelta
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import get_business
from ..models import Business, IndexPage
from ..services import growth_plan as plan
from ..services import indexing
from ..services.activity import log

router = APIRouter(prefix="/businesses/{business_id}/indexing", tags=["indexing"])
_limit = plan.RateLimit(30, name="indexing")


def _iso(dt) -> str | None:
    d = indexing._aware(dt)
    return d.isoformat() if d else None


def _page(p: IndexPage, pend: set[int]) -> dict[str, Any]:
    new = bool(p.first_seen_at and indexing._aware(p.first_seen_at) > indexing._now() - timedelta(days=7))
    path = urlsplit(p.url).path or "/"
    return {"id": p.id, "url": p.url, "path": path + (f"?{urlsplit(p.url).query}" if urlsplit(p.url).query else ""), "first_seen": _iso(p.first_seen_at), "lastmod": p.lastmod, "changed_at": _iso(p.changed_at),
            "in_sitemap": p.in_sitemap, "source": p.source, "is_new": new, "pending": p.id in pend, "skip_reason": p.skip_reason, "submitted_at": _iso(p.submitted_at), "submitted_to": p.submitted_to or [],
            "g_state": p.g_state, "g_reason": p.g_reason, "g_advice": indexing.advice(p.g_reason), "g_last_crawl": _iso(p.g_last_crawl), "g_canonical": p.g_canonical, "g_checked_at": _iso(p.g_checked_at)}


@router.get("")
def overview(status: str = "all", q: str = "", limit: int = 300, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    st = indexing.setting(db, b)
    db.commit()
    rows = list(db.scalars(select(IndexPage).where(IndexPage.business_id == b.id).order_by(IndexPage.first_seen_at.desc(), IndexPage.id.desc())))
    pend = {p.id for p in indexing.pending(db, b)}
    counts = {"total": len(rows), "in_sitemap": sum(1 for p in rows if p.in_sitemap), "indexed": sum(1 for p in rows if p.g_state == "indexed"),
              "not_indexed": sum(1 for p in rows if p.g_state in ("not_indexed", "blocked")), "unchecked": sum(1 for p in rows if not p.g_state), "sent": sum(1 for p in rows if p.submitted_at),
              "pending": len(pend), "skipped": sum(1 for p in rows if p.skip_reason), "new": sum(1 for p in rows if p.first_seen_at and indexing._aware(p.first_seen_at) > indexing._now() - timedelta(days=7))}
    needle = q.strip().lower()

    def keep(p: IndexPage) -> bool:
        if needle and needle not in p.url.lower():
            return False
        return {"all": True, "new": bool(p.first_seen_at and indexing._aware(p.first_seen_at) > indexing._now() - timedelta(days=7)), "pending": p.id in pend, "indexed": p.g_state == "indexed",
                "not_indexed": p.g_state in ("not_indexed", "blocked"), "unchecked": not p.g_state, "skipped": bool(p.skip_reason)}.get(status, True)

    shown = [_page(p, pend) for p in rows if keep(p)][: max(1, min(limit, 1000))]
    key = st.indexnow_key
    return {"auto": st.auto, "host": indexing.host_of(b), "counts": counts, "pages": shown, "shown": len(shown),
            "key": {"name": f"{key}.txt" if key else None, "url": indexing.key_location(b, key) if key and b.website else None, "verified_at": _iso(st.key_verified_at), "ready": bool(st.key_verified_at)},
            "engines": indexing.ENGINES, "last_scan": {"at": _iso(st.last_scan_at), **(st.last_scan or {})}}


@router.get("/google")
def google(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return indexing.google_status(db, b)


def _guard(user: User) -> None:
    if not _limit.hit(user.id):
        raise HTTPException(429, "Too many requests: try again in a minute.")


@router.post("/scan")
def scan(b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    _guard(user)
    try:
        return indexing.scan(db, b)
    except indexing.IndexingError as exc:
        raise HTTPException(422, str(exc)) from exc


class SubmitIn(BaseModel):
    urls: list[str] | None = Field(default=None, max_length=500)


@router.post("/submit")
def submit(body: SubmitIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    _guard(user)
    try:
        out = indexing.submit(db, b, body.urls)
    except indexing.IndexingError as exc:
        raise HTTPException(422, str(exc)) from exc
    log(db, user.name, "indexing_submitted", b.id, sent=out["sent"])
    db.commit()
    return out


class InspectIn(BaseModel):
    urls: list[str] | None = Field(default=None, max_length=50)
    limit: int = Field(default=indexing.INSPECT_BATCH, ge=1, le=50)


@router.post("/inspect")
def inspect(body: InspectIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    _guard(user)
    try:
        return indexing.inspect(db, b, body.urls, body.limit)
    except indexing.IndexingError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/verify-key")
def verify_key(b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    _guard(user)
    if not b.website:
        raise HTTPException(422, "Add the project's website first.")
    ok, msg = indexing.verify_key(db, b)
    return {"ok": ok, "message": msg}


@router.get("/key")
def key(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """The same key as JSON, for the page's download button."""
    st = indexing.ensure_key(db, b)
    db.commit()
    return {"name": f"{st.indexnow_key}.txt", "content": st.indexnow_key, "url": indexing.key_location(b, st.indexnow_key) if b.website else None}


@router.get("/key-file")
def key_file(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """The text file to put in the root of the site (its name is the key and its only content is the key)."""
    st = indexing.ensure_key(db, b)
    db.commit()
    return PlainTextResponse(st.indexnow_key, headers={"Content-Disposition": f'attachment; filename="{st.indexnow_key}.txt"'})


class SettingsIn(BaseModel):
    auto: bool


@router.put("/settings")
def settings(body: SettingsIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    st = indexing.ensure_key(db, b)
    st.auto = body.auto
    log(db, user.name, "indexing_auto_on" if body.auto else "indexing_auto_off", b.id)
    db.commit()
    return {"auto": st.auto, "key_ready": bool(st.key_verified_at)}


@router.post("/run")
def run(b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    _guard(user)
    return indexing.run_auto(db, b, force=True)
