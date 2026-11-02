"""Blog articles generated from Google Keyword Planner keywords: one article per generation (primary + secondary keywords), saved separately."""
import re
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
    from ..services import articles as svc, crypto, featured_images as fi, site_publish as sp
except (ImportError, ValueError):
    from app.config import get_settings
    from app.db import get_db
    from app.deps import get_business, in_background
    from app.models import Article, Business, SiteIntegration
    from app.serialize import row, rows
    from app.services import articles as svc, crypto, featured_images as fi, site_publish as sp

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
    related: list[str] = Field(default_factory=list, max_length=40)  # Keyword Planner ideas picked on the Trending Topics Radar
    avoid: list[str] = Field(default_factory=list, max_length=30)  # the set being replaced when regenerating


class ArticleEdit(BaseModel):
    keyword: str | None = Field(default=None, min_length=2, max_length=255)  # primary keyword
    secondary_keywords: list[str] | None = Field(default=None, max_length=20)
    title: str | None = Field(default=None, max_length=255)
    meta_description: str | None = Field(default=None, max_length=500)
    body: str | None = None
    featured_image_alt: str | None = Field(default=None, max_length=255)


class FeaturedImageIn(BaseModel):
    data_url: str = Field(min_length=20)  # data:...;base64,... (the format is detected from the actual bytes)
    filename: str | None = Field(default=None, max_length=255)  # its extension must match the content
    alt: str | None = Field(default=None, max_length=255)
    page: int | None = Field(default=None, ge=1, le=500)  # PDF: the page to use (1 = first)


def _get(db: Session, b: Business, article_id: int) -> Article:
    a = db.get(Article, article_id)
    if not a or a.business_id != b.id:
        raise HTTPException(404, "Article not found")
    return a


def _refresh_schema(a: Article, b: Business) -> None:
    """Rebuild only the article's JSON-LD block from its current fields (one block, never duplicated)."""
    if a.body:
        a.body = svc.with_schema(a.body, svc.article_schema(
            title=a.title or "", description=a.meta_description or "", body=a.body, primary=a.keyword,
            secondary=a.secondary_keywords or [], b=b, url=a.wp_url, published=a.generated_at or a.created_at,
            modified=datetime.now(timezone.utc), topic=a.topic, image_url=a.featured_image_url))


@router.get("")
def list_articles(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    found = db.scalars(select(Article).where(Article.business_id == b.id).order_by(Article.id.desc()))
    return {"articles": rows(found, exclude={"body"})}


@router.get("/{article_id}")
def get_article(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return row(_get(db, b, article_id))


@router.post("/keywords")
def suggest_keywords(body: KeywordSuggestIn, b: Business = Depends(get_business)):
    """A primary keyword and 5-10 secondary keywords for a topic, written by Claude from Google Keyword Planner ideas.
    Ideas sent by the page (Trending Topics Radar picks) come first, then Planner ideas fetched here within a deadline; the
    answer carries each final keyword's average monthly searches. When Google Ads is unavailable Claude works alone.
    `trends` keeps its name for the page: provided | ok | cached | cooldown | not_configured | unavailable."""
    ideas, status = svc.planner_related(body.topic)
    volumes = {i["keyword"].lower(): i.get("avg_monthly_searches") for i in ideas}
    related = list(dict.fromkeys([*body.related, *volumes]))[:40]
    if body.related and status not in ("ok", "cached"):
        status = "provided"
    try:
        out = svc.suggest_keywords(body.topic, related, b, body.avoid, volumes=volumes)
    except RuntimeError as exc:
        raise HTTPException(502, str(exc))
    final = [out["primary"], *out["secondary"]]
    missing = [k for k in final if k not in volumes]
    if missing and status in ("ok", "cached", "provided"):
        volumes.update(svc.planner_volumes(missing))
    return {**out, "trends": status, "source": "google_keyword_planner", "volumes": {k: volumes.get(k) for k in final}}


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
    _refresh_schema(a, b)  # only the JSON-LD block is replaced (BlogPosting + FAQPage from the saved content)
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


@router.put("/{article_id}/featured-image")
def set_featured_image(article_id: int, body: FeaturedImageIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Upload (or replace) the article's featured image: JPG/PNG/WebP/GIF/BMP/TIFF/AVIF/HEIC/SVG/PDF up to 15 MB,
    detected from the file's bytes and converted to one optimized WebP (PDF: the chosen page). A new image is
    uploaded to the website again on the next publish; the old file is removed from GrowZen."""
    a = _get(db, b, article_id)
    try:
        webp, info = fi.convert(fi.decode_upload(body.data_url), body.filename, body.page or 1)
    except fi.ImageError as exc:
        raise HTTPException(422, str(exc))
    rel = fi.save(b.id, a.id, webp, "webp", old_rel=a.featured_image_path)
    a.featured_image_info = info
    if rel != a.featured_image_path:  # a different image: the website copy must be uploaded again
        a.wp_media_id, a.featured_image_url = None, None
    a.featured_image_path = rel
    if body.alt is not None:
        a.featured_image_alt = body.alt.strip() or None
    elif not a.featured_image_alt:
        a.featured_image_alt = (a.title or a.keyword or "")[:255] or None
    _refresh_schema(a, b)
    db.commit()
    return row(a)


@router.get("/{article_id}/featured-image")
def get_featured_image(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    from fastapi.responses import FileResponse
    a = _get(db, b, article_id)
    p = fi.path_of(a.featured_image_path)
    if not p:
        raise HTTPException(404, "This article has no featured image")
    return FileResponse(p, media_type=fi.media_type(a.featured_image_path), headers={"Cache-Control": "private, max-age=86400"})


@router.delete("/{article_id}/featured-image")
def remove_featured_image(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Remove the image from the article in GrowZen. A post already on the website keeps its featured image
    (nothing is deleted on the site); the next publish simply doesn't send one."""
    a = _get(db, b, article_id)
    fi.remove(a.featured_image_path)
    a.featured_image_path, a.featured_image_url, a.wp_media_id, a.featured_image_info = None, None, None, None
    _refresh_schema(a, b)
    db.commit()
    return row(a)


@router.post("/{article_id}/publish")
def publish(article_id: int, body: PublishIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    a = _get(db, b, article_id)
    if a.status != "completed":
        raise HTTPException(409, "Only a completed article can be published")
    if get_settings().blog_featured_image_required and not fi.path_of(a.featured_image_path):
        raise HTTPException(422, "Add a featured image before publishing (Featured image section, above the article body).")
    when = body.scheduled_at.astimezone(timezone.utc) if body.scheduled_at and body.scheduled_at.tzinfo else None
    target = _target(db, b)
    if body.mode == "schedule" and target.method in sp.LOCAL_SCHEDULE:
        return _hold_for_later(db, b, a, target, when)
    media_steps: list[dict] = []
    try:
        if target.method == "wordpress" and fi.path_of(a.featured_image_path):
            mid, url, media_steps = sp.ensure_wp_featured_media(target, a)
            if mid and (mid != a.wp_media_id or url != a.featured_image_url):
                a.wp_media_id, a.featured_image_url = mid, url
                _refresh_schema(a, b)  # the schema's image now points at the public copy
                db.commit()
        ours = {x for x in db.scalars(select(Article.wp_post_id).where(Article.business_id == b.id, Article.wp_post_id.is_not(None)))}
        out = sp.publish(target, a, body.mode, when, exclude_layout_ids=ours)
        # The schema must carry the real permalink. Before the first publish it can only be predicted, so when the
        # live URL differs, rebuild the schema with it and update the post once more (same post, nothing duplicated).
        schema_url = re.search(r'"mainEntityOfPage":\s*\{[^}]*"@id":\s*"([^"]+)"', a.body or "")
        if out.get("status") == "publish" and out.get("url") and (out["url"] != a.wp_url or not schema_url or schema_url.group(1) != out["url"]):
            a.wp_post_id, a.wp_url = out["id"] or a.wp_post_id, out["url"]
            a.wp_status, a.publish_method = "publish", target.method
            _refresh_schema(a, b)
            db.commit()
            again = sp.publish(target, a, body.mode, when, exclude_layout_ids=ours | {a.wp_post_id})
            out = {**again, "steps": out["steps"] + [{"step": "Set the permalink in the schema", "ok": True, "detail": out["url"]}]}
    except sp.PublishError as exc:
        raise HTTPException(502, str(exc))
    out["steps"] = out["steps"][:1] + media_steps + out["steps"][1:]
    a.wp_post_id, a.wp_url = out["id"] or None, out["url"] or None
    a.wp_status = out.get("status") or {"draft": "draft", "publish": "publish", "schedule": "future"}[body.mode]
    a.publish_method, a.wp_deleted_at = target.method, None
    db.commit()
    return {**out, "article": row(a)}


@router.delete("/{article_id}/website-post")
def delete_website_post(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Permanently delete this article's post from the WordPress site (by its stored post id only; force=true).
    The article stays in GrowZen with status 'deleted' and keeps the post id and URL for the history.
    On any failure the post status is left unchanged and WordPress's error is returned."""
    from ..models import ScheduledPost
    a = _get(db, b, article_id)
    if not a.wp_post_id or a.wp_status == "deleted":
        raise HTTPException(409, "This article has no post on the website to delete.")
    if (a.publish_method or "wordpress") != "wordpress":
        raise HTTPException(409, "Deleting from the website is available for posts published to WordPress only.")
    target = _target(db, b)
    if target.method != "wordpress":
        raise HTTPException(409, "The connected website is not WordPress, so the post cannot be deleted from here.")
    try:
        out = sp.delete_wordpress(target, a.wp_post_id)
    except sp.PublishError as exc:
        raise HTTPException(502, str(exc))
    a.wp_status, a.wp_deleted_at = "deleted", datetime.now(timezone.utc)
    for p in db.scalars(select(ScheduledPost).where(ScheduledPost.article_id == a.id, ScheduledPost.status == "pending")):
        p.status = "cancelled"  # nothing held for later should bring it back
    db.commit()
    return {**out, "article": row(a)}


def _hold_for_later(db: Session, b: Business, a: Article, target: SiteIntegration, when: datetime | None) -> dict:
    """GitHub has no "publish later": GrowZen keeps the post and commits it at the chosen time (the scheduler checks every minute)."""
    from ..models import ScheduledPost
    if not when or when <= datetime.now(timezone.utc):
        raise HTTPException(422, "Pick a date and time in the future to schedule the post.")
    for old in db.scalars(select(ScheduledPost).where(ScheduledPost.article_id == a.id, ScheduledPost.status == "pending")):
        old.status = "cancelled"  # scheduling the same article again replaces the earlier time
    p = ScheduledPost(business_id=b.id, article_id=a.id, method=target.method, due_at=when)
    db.add(p)
    if a.wp_status in (None, "deleted", "scheduled"):  # not on the site yet: show it as scheduled
        a.wp_status, a.publish_method = "scheduled", target.method
    db.commit()
    steps = [{"step": "Prepare the article", "ok": True, "detail": f"{len((a.body or '').split())} words, title: {a.title or a.keyword}"},
             {"step": "Schedule it", "ok": True, "detail": f"GrowZen will publish it to your website at {when.strftime('%d %b %Y %H:%M')} UTC"}]
    return {"id": None, "url": None, "status": "scheduled", "steps": steps, "scheduled_post_id": p.id, "due_at": when, "article": row(a)}


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
