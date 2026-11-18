"""Backlink Checker API.

GET    /businesses/{id}/backlink-check              saved checks, summary, and whether Moz is configured
GET    /businesses/{id}/backlink-check/candidates   pages our own crawler found linking to the project (to check them live)
POST   /businesses/{id}/backlink-check              {target?, sources:[page urls]}  check up to 25 pages now (live) and save the result
DELETE /businesses/{id}/backlink-check/{check_id}
"""
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import get_business
from ..models import BacklinkCheck, Business
from ..services import backlink_checker as bc
from ..services import growth_plan as plan
from ..services.activity import log

router = APIRouter(prefix="/businesses/{business_id}/backlink-check", tags=["backlink-check"])
_limit = plan.RateLimit(12, name="backlink_check")


def _own_target(b: Business) -> str:
    return (b.website or "").strip()


def _spam_report(d: dict[str, Any], site: dict[str, Any] | None) -> dict[str, Any]:
    """Our own spam report from facts we read, not a score: each flag is something real about this page or site."""
    flags = []
    if site and site.get("sitewide"):
        flags.append(f"Sitewide link: {site['links']} links from {site['pages']} pages of this site")
    if d.get("page_noindex"):
        flags.append("Page is noindex")
    if d.get("follow") in ("nofollow", "sponsored", "ugc"):
        flags.append(f"Link is {d['follow']}")
    if d.get("state") == "page_error":
        flags.append("Page does not open")
    for l in (d.get("links") or [])[:1]:
        if l.get("placement") in ("footer", "sidebar"):
            flags.append(f"Link sits in the {l['placement']}")
    serious = any(f.startswith(("Sitewide", "Page is noindex", "Page does not")) for f in flags)
    return {"level": "risky" if serious else ("check" if flags else "clean"), "flags": flags, "count": len(flags)}


def _score_rows(rows: list[dict[str, Any]]) -> str | None:
    """DataForSEO's DA-like, PA-like and spam numbers, asked for only when a check runs (it bills per request) and stored with the check. Returns a note when it could not be read."""
    from urllib.parse import urlsplit

    from ..backlinks import pitch
    if not bc.dfs_configured():
        return None
    live = [r for r in rows if r.get("source_url") and (r.get("moz") or {}).get("da") is None]  # a page that would not open still has a site rating; Moz's own figures are not paid for twice
    doms = list(dict.fromkeys(pitch._registrable(urlsplit(r["source_url"]).hostname or "") for r in live))
    try:
        got = bc.dfs_scores([d for d in doms if d], [r["source_url"] for r in live][:60])
    except Exception as exc:  # noqa: BLE001
        return str(exc) if isinstance(exc, bc.CheckError) else "DataForSEO could not be reached."
    for r in live:
        d_, p_ = got.get(pitch._registrable(urlsplit(r["source_url"]).hostname or "")) or {}, got.get(r["source_url"]) or {}
        r["scores"] = {"da": d_.get("rank"), "pa": p_.get("rank"), "spam": d_.get("spam"), "source": "DataForSEO"}
    return None


def _no_figures(d: dict[str, Any]) -> bool:
    """True when a saved check has neither Moz's nor DataForSEO's figures."""
    sc = d.get("scores") or {}
    return (d.get("moz") or {}).get("da") is None and sc.get("da") is None and sc.get("spam") is None


def _crawler_life(db: Session, rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """What our own crawler knows about each linking page: when it first and last saw a link to a tracked site there, and how many are live now."""
    from sqlalchemy import case, func

    from ..backlinks.lifecycle import LIVE_STATES
    from ..backlinks.models import Backlink, BiPage
    urls = {r.get("source_url") for r in rows if r.get("source_url")}
    variants = urls | {u.rstrip("/") for u in urls} | {u.rstrip("/") + "/" for u in urls}
    if not variants:
        return {}
    try:
        got = db.execute(select(BiPage.normalized_url, func.min(Backlink.first_seen_at), func.max(Backlink.last_seen_at), func.count(Backlink.id),
                                func.sum(case((Backlink.current_status.in_(LIVE_STATES), 1), else_=0)))
                         .join(Backlink, Backlink.source_page_id == BiPage.id).where(BiPage.normalized_url.in_(variants)).group_by(BiPage.normalized_url)).all()
    except Exception:  # noqa: BLE001
        db.rollback()
        return {}
    return {u: {"first_seen": a.isoformat() if a else None, "last_seen": b.isoformat() if b else None, "links": n, "live": int(live or 0)} for u, a, b, n, live in got}


def _with_site(db: Session, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    from urllib.parse import urlsplit

    from ..backlinks import hub, pitch
    doms = {pitch._registrable(urlsplit(r.get("source_url") or "").hostname or "") for r in rows}
    try:
        sig = hub.crawler_signals(db, [d for d in doms if d])
    except Exception:  # noqa: BLE001
        db.rollback()
        sig = {}
    ranks = bc.opr_ranks([d for d in doms if d])
    life = _crawler_life(db, rows)
    for r in rows:
        site = sig.get(pitch._registrable(urlsplit(r.get("source_url") or "").hostname or ""))
        dom = pitch._registrable(urlsplit(r.get("source_url") or "").hostname or "")
        r["site"] = site
        u = r.get("source_url") or ""
        r["crawler"] = life.get(u) or life.get(u.rstrip("/")) or life.get(u.rstrip("/") + "/")
        r["domain_rank"] = (ranks.get(dom) or {}).get("rank")
        r["spam_report"] = _spam_report(r, site)
    return rows


def _out(r: BacklinkCheck) -> dict[str, Any]:
    d = dict(r.data or {})
    d.update(id=r.id, target=r.target, state=r.state, checks=r.checks, was_working=r.was_working, lost=bool(r.was_working and r.state != "working"),
             checked_at=d.get("checked_at") or (r.updated_at.isoformat() if r.updated_at else None))
    return d


@router.get("")
def list_checks(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    rows = _with_site(db, [_out(r) for r in db.scalars(select(BacklinkCheck).where(BacklinkCheck.business_id == b.id).order_by(BacklinkCheck.updated_at.desc(), BacklinkCheck.id.desc()).limit(500))])
    missing = sum(1 for r in rows if _no_figures(r))
    return {"rows": rows, "missing_scores": missing if (bc.dfs_configured() or bc.moz_configured()) else 0, "summary": bc.summarise(rows), "moz": bc.moz_configured(), "opr": bc.opr_configured(), "dfs": bc.dfs_configured(), "google": bc.google_configured(), "default_target": _own_target(b), "limit": bc.MAX_SOURCES}


@router.post("/scores")
def fill_scores(b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Get DA, PA and spam for saved checks that have none (up to 100 at a time, newest first): Moz first, DataForSEO for what Moz cannot answer (for example while Moz has no quota). Nothing is spent unless this is pressed."""
    if not bc.dfs_configured() and not bc.moz_configured():
        raise HTTPException(422, "No data service is set up: add MOZ_ACCESS_ID and MOZ_SECRET_KEY, or DATAFORSEO_AUTH, to the backend settings.")
    if not _limit.hit(user.id):
        raise HTTPException(429, "Too many requests: try again in a while.")
    found = [r for r in db.scalars(select(BacklinkCheck).where(BacklinkCheck.business_id == b.id).order_by(BacklinkCheck.updated_at.desc(), BacklinkCheck.id.desc()))
             if _no_figures(r.data or {})]
    batch, left = found[:100], max(0, len(found) - 100)
    filled = 0
    note = None
    for i in range(0, len(batch), 40):
        chunk = batch[i:i + 40]
        dicts = [dict(r.data or {}, source_url=r.source_url) for r in chunk]
        if bc.moz_configured():
            try:
                got = bc.moz_metrics([d.get("final_url") or d["source_url"] for d in dicts])
                for d in dicts:
                    d["moz"] = got.get(d.get("final_url") or d["source_url"]) or got.get(d["source_url"]) or None
            except bc.CheckError as exc:
                note = str(exc)  # Moz cannot answer now: DataForSEO fills in below
        n = _score_rows(dicts)
        if n:
            note = " ".join(x for x in (note, n) if x)
            if not any(d.get("moz") for d in dicts):
                break
        for r, d in zip(chunk, dicts):
            if not _no_figures(d):
                r.data = {**(r.data or {}), **({"moz": d["moz"]} if (d.get("moz") or {}).get("da") is not None else {}), **({"scores": d["scores"]} if d.get("scores") else {})}
                filled += 1
    db.commit()
    return {"filled": filled, "tried": len(batch), "left": left, "note": note}


@router.get("/candidates")
def candidates(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Linking pages found by the software's own crawler for the project's website (the ones not checked yet first)."""
    from ..backlinks.lifecycle import LIVE_STATES
    from ..backlinks.models import Backlink, BiDomain, BiPage, BiTrackedTarget
    from ..services import growth_content
    mine = db.scalar(select(BiTrackedTarget.domain).where(BiTrackedTarget.business_id == b.id, BiTrackedTarget.is_competitor.is_(False)).order_by(BiTrackedTarget.id))
    if not mine:
        return {"urls": [], "note": "The website is not tracked in Backlink Intelligence yet."}
    try:
        growth_content.bounded(db, 15)  # the link graph is large: a slow read must not hang the page
        rows = db.execute(select(BiPage.normalized_url).join(Backlink, Backlink.source_page_id == BiPage.id).join(BiDomain, BiDomain.id == Backlink.target_domain_id)
                          .where(BiDomain.registrable_domain == mine, Backlink.current_status.in_(LIVE_STATES)).group_by(BiPage.normalized_url).limit(200)).all()
    except Exception:  # noqa: BLE001
        db.rollback()
        return {"urls": [], "note": "The link data could not be read right now."}
    done = {r.source_url for r in db.scalars(select(BacklinkCheck).where(BacklinkCheck.business_id == b.id))}
    urls = sorted((u for (u,) in rows), key=lambda u: u in done)[: bc.MAX_SOURCES * 2]
    return {"urls": urls, "note": None if urls else "Our crawler has not found links to your website yet."}


class CheckIn(BaseModel):
    target: str | None = Field(default=None, max_length=500)
    sources: list[str] = Field(min_length=1, max_length=60)


@router.post("")
def run_check(body: CheckIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    if not _limit.hit(user.id):
        raise HTTPException(429, "Too many checks: each one opens live pages. Try again in a while.")
    target = (body.target or _own_target(b)).strip()
    if not target:
        raise HTTPException(422, "Enter the website the links should point to (the project has no website saved).")
    try:
        tgt = bc.target_of(target)
        rows, note = bc.check_many(body.sources[: bc.MAX_SOURCES], target)
    except bc.CheckError as exc:
        raise HTTPException(422, str(exc)) from exc
    note = " ".join(x for x in (note, _score_rows(rows)) if x) or None
    saved = []
    for r in rows:
        row = db.scalar(select(BacklinkCheck).where(BacklinkCheck.business_id == b.id, BacklinkCheck.source_url == r["source_url"], BacklinkCheck.target == tgt["label"]))
        old = list(((row.data or {}).get("history") if row is not None else None) or [])
        sc = r.get("scores") or {}
        r["history"] = (old + [{"at": r.get("checked_at") or datetime.now(timezone.utc).isoformat(), "state": r["state"], "follow": r.get("follow"), "links": len(r.get("links") or []), "http": r.get("http_status"),
                                "da": sc.get("da"), "pa": sc.get("pa"), "spam": sc.get("spam")}])[-30:]  # the link's life, one point per check
        if row is None:
            row = BacklinkCheck(business_id=b.id, source_url=r["source_url"], target=tgt["label"], state=r["state"], data=r, checks=1)
            db.add(row)
        else:
            row.was_working, row.state, row.data, row.checks = (row.state == "working"), r["state"], r, (row.checks or 0) + 1
        db.flush()
        saved.append(_out(row))
    log(db, user.name, "backlinks_checked", b.id, count=len(saved))
    db.commit()
    return {"rows": _with_site(db, saved), "summary": bc.summarise(saved), "note": note, "moz": bc.moz_configured(), "opr": bc.opr_configured(), "dfs": bc.dfs_configured(), "google": bc.google_configured(), "target": tgt["label"]}


@router.delete("/{check_id}", status_code=204)
def delete_check(check_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    r = db.get(BacklinkCheck, check_id)
    if not r or r.business_id != b.id:
        raise HTTPException(404, "Check not found")
    db.delete(r)
    db.commit()
