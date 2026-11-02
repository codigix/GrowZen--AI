"""Blog articles generated from Google Trends keywords: one article per generation (primary + secondary keywords), saved separately."""
import sys
from pathlib import Path
from datetime import datetime, timezone
from typing import Literal

# Enable direct script execution: add backend directory to sys.path so 'app' is recognized
_backend_dir = str(Path(__file__).resolve().parents[2])
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

try:
    from ..config import get_settings
    from ..db import get_db
    from ..deps import get_business, in_background
    from ..models import Article, Business, SiteIntegration
    from ..serialize import row, rows
    from ..services import articles as svc, crypto, site_publish as sp
except (ImportError, ValueError):
    from app.config import get_settings
    from app.db import get_db
    from app.deps import get_business, in_background
    from app.models import Article, Business, SiteIntegration
    from app.serialize import row, rows
    from app.services import articles as svc, crypto, site_publish as sp

router = APIRouter(prefix="/businesses/{business_id}/articles", tags=["articles"])

MAX_PER_BATCH = 10


class KeywordPick(BaseModel):
    keyword: str = Field(min_length=2, max_length=255)
    rising: bool = False


class GenerateIn(BaseModel):
    keywords: list[KeywordPick] = Field(min_length=1, max_length=MAX_PER_BATCH + 10)  # primary first, then the secondary keywords
    topic: str | None = Field(default=None, max_length=255)
    length: Literal["short", "standard", "long"] = "standard"


class KeywordSuggestIn(BaseModel):
    topic: str = Field(min_length=2, max_length=255)
    related: list[str] = Field(default_factory=list, max_length=40)  # Google Trends related queries for the topic
    avoid: list[str] = Field(default_factory=list, max_length=30)  # the set being replaced when regenerating


class ArticleEdit(BaseModel):
    keyword: str | None = Field(default=None, min_length=2, max_length=255)  # primary keyword
    secondary_keywords: list[str] | None = Field(default=None, max_length=20)
    title: str | None = Field(default=None, max_length=255)
    meta_description: str | None = Field(default=None, max_length=500)
    body: str | None = None


def _get(db: Session, b: Business, article_id: int) -> Article:
    a = db.get(Article, article_id)
    if not a or a.business_id != b.id:
        raise HTTPException(404, "Article not found")
    return a


@router.get("")
def list_articles(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    found = db.scalars(select(Article).where(Article.business_id == b.id).order_by(Article.id.desc()))
    return {"articles": rows(found, exclude={"body"})}


@router.get("/{article_id}")
def get_article(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return row(_get(db, b, article_id))


@router.post("/keywords")
def suggest_keywords(body: KeywordSuggestIn, b: Business = Depends(get_business)):
    """A primary keyword and 5-10 secondary keywords for a topic, written by Ollama. Google Trends' related queries are used when
    they are available (sent by the page, or fetched here within a short deadline); when Google is rate-limited Ollama works alone."""
    related, trends = body.related, "provided"
    if not related:
        related, trends = svc.trends_related(body.topic)
    try:
        return {**svc.suggest_keywords(body.topic, related, b, body.avoid), "trends": trends}
    except RuntimeError as exc:
        raise HTTPException(502, str(exc))


@router.post("/generate", status_code=202)
def generate(body: GenerateIn, tasks: BackgroundTasks, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Queue ONE article that covers all the selected keywords (the first one is the primary keyword)."""
    picked: dict[str, bool] = {}
    for k in body.keywords:
        picked.setdefault(" ".join(k.keyword.lower().split()), k.rising)
    keywords = list(picked)
    running = db.scalar(select(Article).where(Article.business_id == b.id, Article.keyword == keywords[0], Article.status.in_(["pending", "generating"])))
    if running:
        raise HTTPException(409, f"An article for '{keywords[0]}' is already being written. Wait for it to finish or delete it first.")
    a = Article(business_id=b.id, topic=(body.topic or "").strip() or None, length=body.length, keyword=keywords[0], secondary_keywords=keywords[1:], rising_keywords=[k for k, r in picked.items() if r], status="pending")
    db.add(a)
    db.commit()
    tasks.add_task(in_background(svc.run_batch, [a.id]))
    return {"articles": [row(a, exclude={"body"})]}


@router.post("/{article_id}/retry", status_code=202)
def retry(article_id: int, tasks: BackgroundTasks, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    a = _get(db, b, article_id)
    if a.status != "failed":
        raise HTTPException(409, "Only a failed article can be retried")
    a.status, a.error = "pending", None
    db.commit()
    tasks.add_task(in_background(svc.run_batch, [a.id]))
    return row(a, exclude={"body"})


@router.patch("/{article_id}")
def edit(article_id: int, body: ArticleEdit, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    a = _get(db, b, article_id)
    for f, v in body.model_dump(exclude_unset=True).items():
        if f == "keyword" and v:
            v = " ".join(v.lower().split())
        elif f == "secondary_keywords":
            v = list(dict.fromkeys(" ".join(k.lower().split()) for k in (v or []) if k.strip()))
        elif f == "body" and v:
            v = svc.sanitize_html(v)
        setattr(a, f, v)
    a.secondary_keywords = [k for k in (a.secondary_keywords or []) if k != a.keyword]
    a.headings = svc.headings_of(a.body or "")
    a.warnings = svc.validate(a.title or "", a.meta_description or "", a.body or "", a.keyword, a.secondary_keywords)  # re-checked on every save
    db.commit()
    return row(a)


class PublishIn(BaseModel):
    mode: Literal["draft", "publish", "schedule"] = "draft"
    scheduled_at: datetime | None = None  # with a time zone; required for "schedule"


def _target(db: Session, b: Business) -> SiteIntegration:
    """The business's connected website; falls back to the WORDPRESS_* settings in .env for a WordPress site."""
    row = db.scalar(select(SiteIntegration).where(SiteIntegration.business_id == b.id))
    if row and row.status == "connected" and row.method:
        return row
    s = get_settings()
    if s.wordpress_url and s.wordpress_user and s.wordpress_app_password:
        return SiteIntegration(business_id=b.id, method="wordpress", base_url=s.wordpress_url, username=s.wordpress_user, secret_enc=crypto.seal(s.wordpress_app_password), status="connected")
    raise HTTPException(409, "Connect this business's website first (Publish & Schedule > Connect your website).")


@router.post("/{article_id}/publish")
def publish(article_id: int, body: PublishIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    a = _get(db, b, article_id)
    if a.status != "completed":
        raise HTTPException(409, "Only a completed article can be published")
    when = body.scheduled_at.astimezone(timezone.utc) if body.scheduled_at and body.scheduled_at.tzinfo else None
    try:
        out = sp.publish(_target(db, b), a, body.mode, when)
    except sp.PublishError as exc:
        raise HTTPException(502, str(exc))
    a.wp_post_id, a.wp_url = out["id"] or None, out["url"] or None
    db.commit()
    return {**out, "article": row(a)}


@router.post("/{article_id}/publish-wordpress")
def publish_wordpress(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return publish(article_id, PublishIn(), b, db)


@router.delete("/{article_id}", status_code=204)
def delete_article(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    a = db.get(Article, article_id)
    if a and a.business_id == b.id:
        db.delete(a)
        db.commit()


@router.get("/{article_id}/stream")
async def stream_article(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """SSE endpoint: streams article progress and body chunks while Ollama writes.
    
    Events emitted:
      {"type":"progress","text":"..."} — status message from the writer
      {"type":"body","html":"..."}    — new HTML appended to body (delta only)
      {"type":"done","status":"completed"|"failed","title":"...","meta":"...","body":"...","error":"..."}
    """
    from fastapi.responses import StreamingResponse
    import asyncio
    import json as _json_mod

    a = _get(db, b, article_id)

    async def gen():
        last_body_len = 0
        last_progress = ""
        for _ in range(360):  # poll up to 6 min (360 * 1s)
            await asyncio.sleep(1)
            try:
                db.refresh(a)
            except Exception:
                break
            # progress update
            prog = (a.progress or "").strip()
            if prog and prog != last_progress:
                last_progress = prog
                yield f"data: {_json_mod.dumps({'type': 'progress', 'text': prog})}\n\n"
            # body delta
            body = a.body or ""
            if len(body) > last_body_len:
                delta = body[last_body_len:]
                last_body_len = len(body)
                yield f"data: {_json_mod.dumps({'type': 'body', 'html': delta})}\n\n"
            # done
            if a.status in ("completed", "failed"):
                yield f"data: {_json_mod.dumps({'type': 'done', 'status': a.status, 'title': a.title or '', 'meta': a.meta_description or '', 'body': a.body or '', 'error': a.error or ''})}\n\n"
                break

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


if __name__ == "__main__":
    import uvicorn
    from fastapi import FastAPI
    app = FastAPI(title="Articles Router Dev Server")
    app.include_router(router)
    print("Starting Articles Dev Server on http://127.0.0.1:8000 ...")
    uvicorn.run(app, host="127.0.0.1", port=8000)
