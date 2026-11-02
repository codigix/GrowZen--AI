"""How a business's own website receives blog posts: detect its platform, connect it, check the connection."""
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_business
from ..models import Article, Business, ScheduledPost, SiteIntegration
from ..services import crypto, site_onboarding, site_publish as sp

router = APIRouter(prefix="/businesses/{business_id}/site-integration", tags=["site-integration"])


class DetectIn(BaseModel):
    url: str | None = Field(default=None, max_length=500)  # defaults to the business's website


class ConnectIn(BaseModel):
    method: Literal["wordpress", "webhook", "github", "ghost", "shopify"]
    url: str = Field(min_length=3, max_length=500)  # the site's address (WordPress/Ghost/Shopify/GitHub-hosted site), or the webhook endpoint
    username: str | None = Field(default=None, max_length=255)
    secret: str | None = Field(default=None, max_length=500)  # application password / webhook secret / GitHub token / Ghost Admin key / Shopify token
    config: dict[str, Any] = Field(default_factory=dict)  # github: repo, branch, directory, body_format, public_url. shopify: blog_id
    save: bool = True  # false: only run the checks


def get_row(db: Session, b: Business) -> SiteIntegration | None:
    return db.scalar(select(SiteIntegration).where(SiteIntegration.business_id == b.id))


def public(row: SiteIntegration | None, b: Business) -> dict:
    """What the page needs. Never includes a secret."""
    if not row:
        return {"status": "not_connected", "website": b.website, "platform": None, "method": None, "detected": None, "config": None, "publishing": None}
    detected = row.detected or {}
    return {"status": row.status, "website": b.website, "platform": row.platform, "method": row.method, "base_url": row.base_url, "username": row.username,
            "config": {k: v for k, v in (row.config or {}).items() if k not in ("token",)} or None, "detected": row.detected, "publishing": detected.get("publishing"),
            "last_checked_at": _utc(row.last_checked_at), "last_error": row.last_error}


def _verify(body: ConnectIn) -> tuple[list[dict], dict | None, dict]:
    """Run the checks for the chosen method. Returns (steps, info, settings to keep)."""
    m, cfg = body.method, body.config or {}
    if m == "wordpress":
        if not (body.username and body.secret):
            raise HTTPException(400, "Enter the WordPress username and application password.")
        steps, info = sp.verify_wordpress(body.url, body.username, body.secret)
        return steps, info, {}
    if not body.secret:
        raise HTTPException(400, {"webhook": "Enter the signing secret that the website will use to check the requests.", "github": "Paste the GitHub access token.",
                                  "ghost": "Paste the Ghost Admin API key.", "shopify": "Paste the Shopify Admin API access token."}[m])
    if m == "webhook":
        steps, info = sp.verify_webhook(body.url, body.secret)
        return steps, info, {}
    if m == "github":
        repo = cfg.get("repo")
        if not repo:
            raise HTTPException(400, "Enter the repository as owner/name, for example acme/website.")
        steps, info = sp.verify_github(body.secret, repo, cfg.get("branch") or None, cfg.get("directory") or "content/blog")
        keep = {"repo": info["repo"], "branch": info["branch"], "directory": info["directory"], "body_format": cfg.get("body_format") if cfg.get("body_format") in ("markdown", "html") else "markdown",
                "public_url": (cfg.get("public_url") or "").strip() or None} if info else {}
        return steps, info, keep
    if m == "ghost":
        steps, info = sp.verify_ghost(body.url, body.secret)
        return steps, info, {"version": info.get("version")} if info else {}
    steps, info = sp.verify_shopify(body.url, body.secret, cfg.get("blog_id"))
    return steps, info, ({"blog_id": info["blog_id"], "blog_handle": info["blog_handle"], "public_domain": info["public_domain"]} if info else {})


@router.get("")
def get_integration(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return public(get_row(db, b), b)


@router.post("/detect")
def detect(body: DetectIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    url = body.url or b.website
    if not url:
        raise HTTPException(400, "This business has no website address yet. Add it in the business settings.")
    try:
        found = site_onboarding.detect_and_store(db, b, url)
    except sp.PublishError as exc:
        raise HTTPException(400, str(exc))
    if found is None:
        raise HTTPException(400, "That website address could not be used.")
    return public(get_row(db, b), b)


@router.post("/connect")
def connect(body: ConnectIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Run the connection checks; when they all pass (and save is true) keep the credentials, encrypted."""
    try:
        steps, info, keep = _verify(body)
    except sp.PublishError as exc:
        raise HTTPException(400, str(exc))
    ok = info is not None
    row = get_row(db, b)
    if not row:
        row = SiteIntegration(business_id=b.id)
        db.add(row)
    row.last_checked_at = datetime.now(timezone.utc)
    if ok and body.save:
        row.method, row.base_url = body.method, (info.get("base") if body.method == "shopify" else sp.normalize_url(body.url))
        row.username = body.username if body.method == "wordpress" else None
        row.secret_enc = crypto.seal(" ".join((body.secret or "").split()) if body.method in ("wordpress", "shopify") else body.secret.strip())
        row.config = keep or None
        row.platform = row.platform if row.platform not in (None, "unknown") else body.method
        row.status, row.last_error = "connected", None
    elif not ok:
        row.status = "error" if row.secret_enc else "not_connected"
        row.last_error = next((s["detail"] for s in steps if not s["ok"]), None)
    db.commit()
    return {"ok": ok, "steps": steps, "info": info, "integration": public(row, b)}


@router.post("/check")
def recheck(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Re-run the checks with the saved credentials."""
    row = get_row(db, b)
    if not row or not row.secret_enc:
        raise HTTPException(409, "The website is not connected yet.")
    steps, info = sp.verify_saved(row)
    row.last_checked_at = datetime.now(timezone.utc)
    row.status = "connected" if info else "error"
    row.last_error = None if info else next((s["detail"] for s in steps if not s["ok"]), None)
    db.commit()
    return {"ok": bool(info), "steps": steps, "info": info, "integration": public(row, b)}


@router.delete("", status_code=204)
def disconnect(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    row = get_row(db, b)
    if row:
        row.method = row.base_url = row.username = row.secret_enc = row.last_error = row.config = None
        row.status = "not_connected"
        db.commit()


def _utc(d: datetime | None) -> datetime | None:
    """Times are stored in UTC. SQLite hands them back without a zone, which a browser would read as local time (hours off); say UTC."""
    return d if d is None or d.tzinfo else d.replace(tzinfo=timezone.utc)


def _scheduled(p: ScheduledPost, title: str | None) -> dict:
    return {"id": p.id, "article_id": p.article_id, "title": title, "method": p.method, "due_at": _utc(p.due_at), "status": p.status, "attempts": p.attempts, "error": p.error,
            "url": (p.result or {}).get("url"), "finished_at": _utc(p.finished_at)}


@router.get("/scheduled")
def list_scheduled(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Posts GrowZen is holding to publish later (for sites with no native scheduling), and how earlier ones went."""
    rows = db.scalars(select(ScheduledPost).where(ScheduledPost.business_id == b.id).order_by(ScheduledPost.due_at.desc()).limit(30))
    return [_scheduled(p, (db.get(Article, p.article_id).title if db.get(Article, p.article_id) else None)) for p in rows]


@router.delete("/scheduled/{post_id}", status_code=204)
def cancel_scheduled(post_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    p = db.get(ScheduledPost, post_id)
    if not p or p.business_id != b.id:
        raise HTTPException(404, "Scheduled post not found")
    if p.status == "pending":
        p.status, p.finished_at = "cancelled", datetime.now(timezone.utc)
        db.commit()
