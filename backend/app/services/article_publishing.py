"""Publishing ONE article to one destination. The single code path behind the Publish buttons (routers/articles.py) and the
scheduler (services/article_schedule.py): WordPress featured media, the post itself and the schema permalink; or the
React.js website (its own image field, field mapping, login). Errors are site_publish.PublishError / react_site.ReactSiteError."""
import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Article, Business, ReactSiteConnection, SiteIntegration
from . import articles as svc, crypto, featured_images as fi, react_site as rs, site_publish as sp

REACT = "react"  # the destination id of the React.js website (SiteIntegration methods are the others)


def refresh_schema(a: Article, b: Business) -> None:
    """Rebuild only the article's JSON-LD block from its current fields (one block, never duplicated)."""
    if a.body:
        a.body = svc.with_schema(a.body, svc.article_schema(
            title=a.title or "", description=a.meta_description or "", body=a.body, primary=a.keyword,
            secondary=a.secondary_keywords or [], b=b, url=a.wp_url, published=a.generated_at or a.created_at,
            modified=datetime.now(timezone.utc), topic=a.topic, image_url=a.featured_image_url))


def site_target(db: Session, b: Business) -> SiteIntegration | None:
    """The business's connected website; falls back to the WORDPRESS_* settings in .env for a WordPress site."""
    row = db.scalar(select(SiteIntegration).where(SiteIntegration.business_id == b.id))
    if row and row.status == "connected" and row.method:
        return row
    s = get_settings()
    if s.wordpress_url and s.wordpress_user and s.wordpress_app_password:
        return SiteIntegration(business_id=b.id, method="wordpress", base_url=s.wordpress_url, username=s.wordpress_user,
                               secret_enc=crypto.seal(s.wordpress_app_password), status="connected")
    return None


def react_target(db: Session, b: Business) -> ReactSiteConnection | None:
    conn = db.scalar(select(ReactSiteConnection).where(ReactSiteConnection.business_id == b.id))
    return conn if conn and rs.has_credentials(conn) and conn.status == "connected" else None


def destinations(db: Session, b: Business) -> list[dict]:
    """The connected publishing destinations of this business, for the Schedule dialog."""
    out = []
    t = site_target(db, b)
    if t:
        out.append({"id": t.method, "label": {"wordpress": "WordPress"}.get(t.method, t.method.title()), "target": t.base_url})
    c = react_target(db, b)
    if c:
        out.append({"id": REACT, "label": "React.js Website", "target": c.blog_url or c.website_url})
    return out


def record_published(db: Session, a: Article, destination: str, out: dict, at: datetime | None = None) -> None:
    """A direct publish (Publish now / Update and publish) is kept in the publishing history, so it shows on the
    Publishing Calendar like a scheduled one. Publishing the same article again moves its direct entry to the new time
    (one entry per article, never one per click); entries made by the scheduler are left as they are."""
    from ..models import ScheduledPost
    at = at or datetime.now(timezone.utc)
    last = db.scalar(select(ScheduledPost).where(ScheduledPost.article_id == a.id).order_by(ScheduledPost.id.desc()).limit(1))
    if last and last.status in ("pending", "publishing"):
        return  # a schedule is waiting: it stays the article's current entry
    p = last if last and last.status == "published" and (last.result or {}).get("direct") else None
    if p is None:
        p = ScheduledPost(business_id=a.business_id, article_id=a.id, attempts=0)
        db.add(p)
    p.method, p.due_at, p.status, p.error, p.finished_at = destination, at, "published", None, at
    p.result = {"id": out.get("id"), "url": out.get("url"), "status": out.get("status"), "direct": True, "published_at": at.isoformat()}


def publish_site(db: Session, b: Business, a: Article, target: SiteIntegration, mode: str, when: datetime | None, record: bool = True) -> dict:
    """Publish to the connected website (WordPress, Ghost, Shopify, GitHub, webhook) and store the post on the article."""
    media_steps: list[dict] = []
    if target.method == "wordpress" and fi.path_of(a.featured_image_path):
        mid, url, media_steps = sp.ensure_wp_featured_media(target, a)
        if mid and (mid != a.wp_media_id or url != a.featured_image_url):
            a.wp_media_id, a.featured_image_url = mid, url
            refresh_schema(a, b)  # the schema's image now points at the public copy
            db.commit()
    ours = {x for x in db.scalars(select(Article.wp_post_id).where(Article.business_id == b.id, Article.wp_post_id.is_not(None)))}
    out = sp.publish(target, a, mode, when, exclude_layout_ids=ours)
    # The schema must carry the real permalink. Before the first publish it can only be predicted, so when the
    # live URL differs, rebuild the schema with it and update the post once more (same post, nothing duplicated).
    schema_url = re.search(r'"mainEntityOfPage":\s*\{[^}]*"@id":\s*"([^"]+)"', a.body or "")
    if out.get("status") == "publish" and out.get("url") and (out["url"] != a.wp_url or not schema_url or schema_url.group(1) != out["url"]):
        a.wp_post_id, a.wp_url = out["id"] or a.wp_post_id, out["url"]
        a.wp_status, a.publish_method = "publish", target.method
        refresh_schema(a, b)
        db.commit()
        again = sp.publish(target, a, mode, when, exclude_layout_ids=ours | {a.wp_post_id})
        out = {**again, "steps": out["steps"] + [{"step": "Set the permalink in the schema", "ok": True, "detail": out["url"]}]}
    out["steps"] = out["steps"][:1] + media_steps + out["steps"][1:]
    a.wp_post_id, a.wp_url = out["id"] or None, out["url"] or None
    a.wp_status = out.get("status") or {"draft": "draft", "publish": "publish", "schedule": "future"}[mode]
    a.publish_method, a.wp_deleted_at = target.method, None
    if record and a.wp_status == "publish":
        record_published(db, a, target.method, out)
    db.commit()
    return out


def publish_react(db: Session, a: Article, conn: ReactSiteConnection, mode: str, when: datetime | None, record: bool = True) -> dict:
    """Publish (or update) on the React.js website and store the post on the article. A refused login marks the
    connection failed; a renewed access token is kept either way."""
    try:
        out = rs.publish(conn, a, mode, when)
    except rs.ReactSiteError as exc:
        if isinstance(exc, rs.AuthFailed):
            conn.status, conn.last_error = "failed", str(exc)[:500]
        db.commit()
        raise
    a.react_post_id, a.react_url, a.react_status = out["id"], out["url"], out["status"]
    if out.get("image_url") and not out["image_url"].startswith("data:"):  # an embedded image is not an address to remember
        a.react_image_url, a.react_image_path = out["image_url"], a.featured_image_path
    if record and a.react_status == "publish":
        record_published(db, a, REACT, out)
    db.commit()
    return out
