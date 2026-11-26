"""Blog articles generated from Google Keyword Planner keywords: one article per generation (primary + secondary keywords), saved separately."""
import logging
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
    from ..deps import get_business
    from ..services.durable import durable
    from ..models import Article, Business, SiteIntegration
    from ..serialize import row, rows
    from ..services import articles as svc, crypto, featured_images as fi, site_publish as sp, seo_report as seo
except (ImportError, ValueError):
    from app.config import get_settings
    from app.db import get_db
    from app.deps import get_business
    from app.services.durable import durable
    from app.models import Article, Business, SiteIntegration
    from app.serialize import row, rows
    from app.services import articles as svc, crypto, featured_images as fi, site_publish as sp, seo_report as seo

router = APIRouter(prefix="/businesses/{business_id}/articles", tags=["articles"])
log = logging.getLogger("seo.articles")

MAX_PER_BATCH = 10


class KeywordPick(BaseModel):
    keyword: str = Field(min_length=2, max_length=255)
    rising: bool = False


class GenerateIn(BaseModel):
    keywords: list[KeywordPick] = Field(min_length=1, max_length=MAX_PER_BATCH + 10)  # primary first, then the secondary keywords
    topic: str | None = Field(default=None, max_length=255)
    length: Literal["short", "standard", "long"] = "standard"
    title: str | None = Field(default=None, max_length=255)  # the SEO title picked on the Title step; empty = the model writes one
    blog_title: str | None = Field(default=None, max_length=255)  # the Blog title (H1) picked on the Title step; empty = the H1 is the SEO title
    workflow: dict | None = None  # the SEO workflow: research stage results + the content brief the user confirmed (optional; older pages send none)


class WorkflowStageIn(BaseModel):
    stage: str = Field(min_length=2, max_length=40)
    ctx: dict = Field(default_factory=dict)  # input, data, stages, brief (see services/seo_workflow/stages.py)


class TitleSuggestIn(BaseModel):
    topic: str = Field(default="", max_length=255)
    primary: str = Field(min_length=2, max_length=255)
    secondary: list[str] = Field(default_factory=list, max_length=15)
    avoid: list[str] = Field(default_factory=list, max_length=20)
    kind: Literal["seo", "blog"] = "seo"  # seo = SEO titles (Google, max 60); blog = Blog titles (the H1 on the page)
    seo_title: str = Field(default="", max_length=255)  # for blog titles: the SEO title they go with


class KeywordSuggestIn(BaseModel):
    topic: str = Field(min_length=2, max_length=255)
    related: list[str] = Field(default_factory=list, max_length=40)  # Keyword Planner ideas picked on the Trending Topics Radar
    avoid: list[str] = Field(default_factory=list, max_length=30)  # the set being replaced when regenerating
    primary: str = Field(default="", max_length=255)  # when set, the primary keyword is fixed: only secondary keywords are generated


class ArticleEdit(BaseModel):
    keyword: str | None = Field(default=None, min_length=2, max_length=255)  # primary keyword
    slug: str | None = Field(default=None, max_length=120)  # the end of the web address; empty means "follow the primary keyword"
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
    from ..services import article_publishing as ap
    ap.refresh_schema(a, b)


def _url_base(b: Business, db: Session) -> dict:
    """Where this site's blog posts live, learned from the posts already published (https://site/blog/ for a site that has none yet)."""
    from collections import Counter
    from urllib.parse import urlsplit
    seen: Counter = Counter()
    for (u,) in db.execute(select(Article.wp_url).where(Article.business_id == b.id, Article.wp_status == "publish", Article.wp_url.is_not(None))):
        p = urlsplit(u or "")
        parts = [x for x in p.path.split("/") if x]
        if p.scheme and p.netloc and parts:
            seen[(f"{p.scheme}://{p.netloc}/" + "".join(f"{x}/" for x in parts[:-1]), p.path.endswith("/"))] += 1
    if seen:
        (base, trailing), _ = seen.most_common(1)[0]
        return {"base": base, "trailing_slash": trailing, "learned": True}
    site = (b.website or "").strip().rstrip("/")
    return {"base": f"{site}/blog/" if site.startswith("http") else "", "trailing_slash": True, "learned": False}


@router.get("/url-base")
def url_base(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """So the page can show the whole address a slug will give."""
    return _url_base(b, db)


class SitePreviewIn(BaseModel):
    view: Literal["post", "list"] = "post"
    title: str | None = Field(default=None, max_length=255)
    meta_description: str | None = Field(default=None, max_length=500)
    body: str | None = None  # the draft as it is on screen (unsaved)
    slug: str | None = Field(default=None, max_length=120)
    keyword: str | None = Field(default=None, max_length=255)
    secondary_keywords: list[str] | None = Field(default=None, max_length=20)
    highlight: bool = True
    reference_url: str | None = Field(default=None, max_length=500)  # a post of the project's own website whose design the preview copies


def _image_src(a: Article) -> str | None:
    """The featured picture as the page can show it: its public address on the site, else the uploaded file inlined (up to 1.5 MB)."""
    if a.featured_image_url:
        return a.featured_image_url
    path = fi.path_of(a.featured_image_path)
    if not path:
        return None
    import base64
    import mimetypes
    try:
        data = path.read_bytes()
    except OSError:
        return None
    return f"data:{mimetypes.guess_type(str(path))[0] or 'image/jpeg'};base64,{base64.b64encode(data).decode()}" if len(data) <= 1_500_000 else None


@router.post("/{article_id}/site-preview")
def site_preview(article_id: int, body: SitePreviewIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """The article inside the website's own blog list or blog details page (its real design, read from the site), with the keywords coloured. Nothing is saved."""
    from ..services import site_preview as site_prev
    a = _get(db, b, article_id)
    base = _url_base(b, db)
    primary = " ".join((body.keyword or a.keyword or "").lower().split())
    secondary = [" ".join(k.lower().split()) for k in (body.secondary_keywords if body.secondary_keywords is not None else a.secondary_keywords or []) if k.strip()]
    slug = svc.slugify(body.slug or "", 100) or svc.explicit_slug(a) or svc.slugify(primary)
    url = f"{base['base']}{slug}" + ("/" if base["trailing_slash"] else "")
    try:
        return site_prev.build(db, b, a, view=body.view, title=(body.title if body.title is not None else a.title) or primary.title(), excerpt=(body.meta_description if body.meta_description is not None else a.meta_description) or "",
                               body=svc.prepare_body(body.body, primary, secondary, svc.brand_of(b)) if body.body else (a.body or ""), image=_image_src(a), url=url, primary=primary, secondary=secondary, highlight=body.highlight, reference_url=(body.reference_url or None))
    except site_prev.PreviewError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("")
def list_articles(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    from ..services import article_schedule as asch
    found = list(db.scalars(select(Article).where(Article.business_id == b.id).order_by(Article.id.desc())))
    latest = asch.latest_by_article(db, b.id)
    return {"articles": [{**row(a, exclude={"body"}), **asch.state_of(a, latest.get(a.id))} for a in found]}


_BLOGISH = re.compile(r"/(blogs?|articles?|news|insights|posts?|resources|knowledge)(/|$)", re.I)


def _norm_url(u: str) -> str:
    from urllib.parse import urlsplit
    q = urlsplit(u or "")
    return f"{(q.hostname or '').lower().removeprefix('www.')}{q.path.rstrip('/')}?{q.query}"


@router.get("/site-blogs")
def blogs_on_the_website(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """The blogs the website's sitemap lists (addresses with /blog/, /articles/, /news/...), minus the ones already in the list: what is posted on the site but not known here."""
    from urllib.parse import urlsplit
    from ..services import sitemap
    if not b.website:
        raise HTTPException(409, "Add the project's website first.")
    have = {_norm_url(x.wp_url or x.react_url or "") for x in db.scalars(select(Article).where(Article.business_id == b.id)) if x.wp_status != "deleted" and (x.wp_url or x.react_url)}
    # 1. a WordPress site says exactly which pages are posts, with their titles and dates; 2. else the sitemap of posts (post-sitemap.xml, blog-sitemap.xml...); 3. else addresses that look like a blog
    found = _wordpress_posts(b.website)
    source = "wordpress"
    if not found:
        try:
            everything = sitemap.discover_site_entries(b.website, 400)
        except Exception as exc:  # noqa: BLE001 - an unreachable site or a missing sitemap is explained, not a crash
            raise HTTPException(502, f"The sitemap could not be read: {str(exc)[:160]}") from exc
        try:  # a site that keeps its posts in their own sitemap (post-sitemap.xml, blog-sitemap.xml): everything in it is a post
            posts_only = sitemap.discover_site_entries(b.website, 400, child_filter=re.compile(r"(post|blog|article|news)", re.I))
        except Exception:  # noqa: BLE001
            posts_only = []
        if posts_only and len(posts_only) < len(everything):
            source = "sitemap"
            found = [{"url": u, "lastmod": m, "title": (urlsplit(u).path.strip("/").rsplit("/", 1)[-1]).replace("-", " ").replace("_", " ").capitalize()} for u, m in posts_only]
        else:  # one flat sitemap: only addresses that look like a blog count
            source = "addresses"
            for url, lastmod in everything:
                path = urlsplit(url).path.rstrip("/")
                parts = [p for p in path.split("/") if p]
                if len(parts) >= 2 and _BLOGISH.search(path + "/"):  # the blog's own index page is not a blog
                    found.append({"url": url, "lastmod": lastmod, "title": parts[-1].replace("-", " ").replace("_", " ").strip().capitalize()})
    out = [x for x in found if urlsplit(x["url"]).path.strip("/") and _norm_url(x["url"]) not in have]
    return {"blogs": out[:200], "found": len(out), "source": source}


def _wordpress_posts(website: str | None) -> list[dict]:
    """The posts of a WordPress site from its public REST address (/wp-json/wp/v2/posts): address, title and date of each. Empty when the site is not WordPress or hides it."""
    import html
    from urllib.parse import urlsplit
    from ..services.net import site_client
    p = urlsplit(website if (website or "").startswith("http") else f"https://{website or ''}")
    if not p.hostname:
        return []
    origin = f"{p.scheme}://{p.netloc}"
    out: list[dict] = []
    client = site_client(12)
    try:
        for page in (1, 2, 3):
            r = client.get(f"{origin}/wp-json/wp/v2/posts", params={"per_page": 100, "page": page, "_fields": "link,title,date,status"})
            if r.status_code != 200 or "json" not in (r.headers.get("content-type") or ""):
                break
            rows = r.json()
            if not isinstance(rows, list) or not rows:
                break
            out += [{"url": x["link"], "lastmod": str(x.get("date") or "")[:10] or None, "title": html.unescape(((x.get("title") or {}).get("rendered") or "")).strip()} for x in rows if x.get("link") and x.get("status", "publish") == "publish"]
            if len(rows) < 100:
                break
    except Exception:  # noqa: BLE001 - not WordPress, blocked or slow: the sitemap is used instead
        return []
    finally:
        client.close()
    return out


@router.get("/calendar")
def calendar(month: str | None = None, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """The Publishing Calendar: every article scheduled in GrowZen (and what became of it) in one month (YYYY-MM)."""
    from ..services import article_schedule as asch
    try:
        return asch.calendar(db, b, month)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.get("/destinations")
def publishing_destinations(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    from ..services import article_publishing as ap, article_schedule as asch
    return {"destinations": ap.destinations(db, b), "timezone": asch.tz_name()}


@router.get("/{article_id}")
def get_article(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    from ..services import article_schedule as asch
    a = _get(db, b, article_id)
    return {**row(a), **asch.state_of(a, asch.latest_by_article(db, b.id, a.id).get(a.id))}


@router.get("/{article_id}/duplicates")
def duplicates(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Other articles of this project that have the same title or the very same featured image file: each blog should have its own."""
    import hashlib
    a = _get(db, b, article_id)

    def norm(t: str | None) -> str:
        return " ".join((t or "").lower().split())

    def digest(rel: str | None) -> str | None:
        p = fi.path_of(rel) if rel else None
        return hashlib.md5(p.read_bytes()).hexdigest() if p else None

    mine, img = norm(a.title), digest(a.featured_image_path)
    same_title, same_image = [], []
    for o in db.scalars(select(Article).where(Article.business_id == b.id, Article.id != a.id)):
        if mine and norm(o.title) == mine:
            same_title.append({"id": o.id, "title": o.title})
        if img and o.featured_image_path and digest(o.featured_image_path) == img:
            same_image.append({"id": o.id, "title": o.title})
    return {"same_title": same_title, "same_image": same_image}


@router.get("/{article_id}/slug-check")
def slug_check(article_id: int, slug: str = "", b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Is this web address already taken: by another blog of this project, or by a post on the connected React.js website?
    Read only (the editor shows a warning; nothing is blocked or changed here)."""
    from urllib.parse import urlparse
    from ..models import ReactSiteConnection
    from ..services import react_site as rs
    a = _get(db, b, article_id)
    s = svc.slugify(slug or "", 100) or svc.slugify(a.keyword or "", 100)
    if not s:
        return {"slug": "", "used": False}
    for o in db.scalars(select(Article).where(Article.business_id == b.id, Article.id != a.id)):
        used = {(svc.explicit_slug(o) or "").lower()}
        for u in (o.wp_url, o.react_url):
            if u:
                used.add((urlparse(u).path.rstrip("/").rsplit("/", 1)[-1] or "").lower())
        if s in used:
            return {"slug": s, "used": True, "by": f"another article: “{o.title or o.keyword}”"}
    conn = db.scalar(select(ReactSiteConnection).where(ReactSiteConnection.business_id == b.id))
    checked_site = False
    if conn and conn.status == "connected":
        try:
            posts = rs.list_posts(conn)
            checked_site = bool(posts)
            for x in posts:
                if str(x.get("slug") or "").lower() == s and (rs._id_of(x) or "") != str(a.react_post_id or ""):
                    return {"slug": s, "used": True, "by": "a post already on your website", "checked_site": True}
        except Exception:  # noqa: BLE001 - a website that cannot be read never blocks the editor
            log.warning("Slug check could not read the website's posts for article %s", a.id)
    return {"slug": s, "used": False, "checked_site": checked_site}


class RegenerateIn(BaseModel):
    part: Literal["full", "intro", "section", "conclusion", "faqs", "title", "meta", "h1", "slug"]
    section_id: str | None = Field(default=None, max_length=20)  # for "section": an id from /regenerate/sections
    body: str | None = None  # the editor's current (maybe unsaved) HTML; the saved body when omitted
    # the editor's current (maybe unsaved) fields, for "title" / "meta"; the saved values when omitted
    title: str | None = Field(default=None, max_length=255)
    meta_description: str | None = Field(default=None, max_length=500)
    keyword: str | None = Field(default=None, max_length=255)
    secondary_keywords: list[str] | None = Field(default=None, max_length=20)
    slug: str | None = Field(default=None, max_length=100)  # the editor's current web address, for "slug"


class SectionsIn(BaseModel):
    body: str | None = None


@router.post("/{article_id}/regenerate/sections")
def regenerate_sections(article_id: int, body: SectionsIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """The H2/H3 sections of the article that can be regenerated one by one."""
    from ..services import article_regenerate as rg
    a = _get(db, b, article_id)
    return {"sections": rg.sections(body.body if body.body is not None else a.body or "")}


@router.post("/{article_id}/regenerate")
def regenerate_part(article_id: int, body: RegenerateIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Write a new version of one part (or the whole article) with Claude. NOTHING is saved: the answer has the current
    and the new HTML of that part and the whole new body; the editor applies it only when the user accepts."""
    from ..services import article_regenerate as rg
    a = _get(db, b, article_id)
    try:
        return rg.regenerate(a, b, body.part, body.body, body.section_id,
                             fields=body.model_dump(include={"title", "meta_description", "keyword", "secondary_keywords", "slug"}))
    except rg.RegenError as exc:
        raise HTTPException(exc.code, str(exc))


class ScheduleIn(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")  # in the publishing time zone (default Asia/Kolkata)
    time: str = Field(pattern=r"^\d{2}:\d{2}$")
    destination: str = Field(min_length=2, max_length=20)  # wordpress (or the connected site's method) | react


@router.put("/{article_id}/schedule")
def schedule_article(article_id: int, body: ScheduleIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Schedule (or reschedule) a draft: GrowZen keeps it and publishes it to the chosen destination at that time.
    Nothing is sent to the website now; scheduling again moves the same schedule (never a second article or post)."""
    from ..services import article_schedule as asch
    a = _get(db, b, article_id)
    try:
        p = asch.schedule(db, b, a, body.date, body.time, body.destination)
    except asch.ScheduleError as exc:
        raise HTTPException(exc.code, str(exc))
    return {"article": {**row(a, exclude={"body"}), **asch.state_of(a, p)}}


@router.delete("/{article_id}/schedule")
def cancel_article_schedule(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Cancel the schedule: the article goes back to Draft (nothing on the website changes)."""
    from ..services import article_schedule as asch
    a = _get(db, b, article_id)
    try:
        p = asch.cancel(db, a)
    except asch.ScheduleError as exc:
        raise HTTPException(exc.code, str(exc))
    return {"article": {**row(a, exclude={"body"}), **asch.state_of(a, p)}}


@router.post("/{article_id}/schedule/retry")
def retry_article_schedule(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Publish a failed scheduled article again now (same schedule, same destination; updates the post if it exists)."""
    from ..services import article_schedule as asch
    a = _get(db, b, article_id)
    try:
        p = asch.retry(db, b, a)
    except asch.ScheduleError as exc:
        raise HTTPException(exc.code, str(exc))
    return {"article": {**row(a, exclude={"body"}), **asch.state_of(a, p)}, "result": p.result, "error": p.error}


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
        out = svc.suggest_keywords(body.topic, related, b, body.avoid, volumes=volumes, fixed_primary=body.primary)
    except RuntimeError as exc:
        raise HTTPException(502, str(exc))
    final = [out["primary"], *out["secondary"]]
    missing = [k for k in final if k not in volumes]
    if missing and status in ("ok", "cached", "provided"):
        volumes.update(svc.planner_volumes(missing))
    return {**out, "trends": status, "source": "google_keyword_planner", "volumes": {k: volumes.get(k) for k in final}}


@router.post("/titles")
def suggest_titles(body: TitleSuggestIn, b: Business = Depends(get_business)):
    """Five SEO title options for the Title step (shown before the article is written)."""
    try:
        titles = (svc.suggest_blog_titles(body.topic, body.primary, body.seo_title, b, body.avoid) if body.kind == "blog"
                  else svc.suggest_titles(body.topic, body.primary, body.secondary, b, body.avoid))
    except RuntimeError as exc:
        raise HTTPException(502, str(exc))
    if not titles:
        raise HTTPException(502, "No usable titles came back. Try again, or type your own title.")
    return {"titles": titles}


def _clean_workflow(w: dict | None) -> dict | None:
    """What is kept with the article from the page: the workflow's input, research data, stage results and the confirmed brief (size-capped)."""
    import json
    if not isinstance(w, dict):
        return None
    out = {k: w[k] for k in ("input", "data", "stages", "brief") if isinstance(w.get(k), dict)}
    if len(json.dumps(out, default=str)) > 400_000:
        raise HTTPException(413, "The research data is too large to keep with the article.")
    return out


@router.post("/workflow-stage")
def workflow_stage(body: WorkflowStageIn, b: Business = Depends(get_business)):
    """Run ONE research stage of the SEO workflow (/brainstorm-content-ideas ... /write-content-brief) on the context the page sends; returns the
    updated context. The page runs the stages in order, shows each result, retries a failed one on its own, and lets the user edit the brief."""
    from ..services.seo_workflow import runner
    try:
        return runner.run_research_stage(body.stage, body.ctx, b)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.get("/{article_id}/workflow")
def get_workflow(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """The SEO workflow kept with the article: research data, every stage's result and the confirmed brief."""
    return (_get(db, b, article_id).stats or {}).get("workflow") or {}


@router.post("/{article_id}/workflow/{stage}/retry")
def retry_workflow_stage(article_id: int, stage: str, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Run one article stage again (meta title, meta description, expert, human, SEO review) without rewriting the article."""
    from ..services.seo_workflow import runner
    a = _get(db, b, article_id)
    if a.status != "completed" or not a.body:
        raise HTTPException(409, "The article must be finished before a stage can be run again.")
    try:
        runner.retry_article_stage(db, a, b, stage)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"workflow": (a.stats or {}).get("workflow") or {}, "article": row(a)}


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
    a = Article(business_id=b.id, topic=(body.topic or "").strip() or None, length=body.length, keyword=keywords[0], title=(body.title or "").strip() or None, secondary_keywords=keywords[1:],
                stats=({"workflow": _clean_workflow(body.workflow)} if body.workflow else {}) | ({"blog_title": " ".join(body.blog_title.split())} if (body.blog_title or "").strip() else {}) or None,
                rising_keywords=[k for k, r in picked.items() if r], status="pending")
    db.add(a)
    db.commit()
    tasks.add_task(durable(svc.run_batch, [a.id], refs=[f"article:{a.id}"]))
    return {"articles": [row(a, exclude={"body"})]}


@router.post("/{article_id}/retry", status_code=202)
def retry(article_id: int, tasks: BackgroundTasks, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    a = _get(db, b, article_id)
    if a.status != "failed":
        raise HTTPException(409, "Only a failed article can be retried")
    a.status, a.error = "pending", None
    db.commit()
    tasks.add_task(durable(svc.run_batch, [a.id], refs=[f"article:{a.id}"]))
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
            v = svc.sanitize_html(svc.strip_emphasis(v))  # the keyword marks are made again below, for the keywords as they are now
        elif f == "slug":
            v = svc.slugify(v or "", 100) or None
            if v and db.scalar(select(Article.id).where(Article.business_id == b.id, Article.id != a.id, Article.slug == v)):
                raise HTTPException(409, f"Another article already ends its address with “{v}”. Make this one different.")
        setattr(a, f, v)
    a.secondary_keywords = [k for k in (a.secondary_keywords or []) if k != a.keyword]
    if a.body:
        a.body = svc.emphasize(a.body, a.keyword, a.secondary_keywords, svc.brand_of(b))  # keywords and the brand name: bold and highlighted on the website
    _refresh_schema(a, b)  # only the JSON-LD block is replaced (BlogPosting + FAQPage from the saved content)
    a.headings = svc.headings_of(a.body or "")
    a.warnings = svc.validate(a.title or "", a.meta_description or "", a.body or "", a.keyword, a.secondary_keywords, svc.brand_of(b))  # re-checked on every save
    try:  # the measurable SEO checks follow every save; the last AI review is kept (marked out of date when the text changed)
        seo.save(db, a, seo.build(db, a, b, with_ai=False, previous=(a.stats or {}).get("seo_report")))
    except Exception:  # noqa: BLE001 - a checklist problem must never block saving the article
        log.warning("SEO checklist failed on save for article %s", a.id, exc_info=True)
    db.commit()
    return row(a)


@router.get("/{article_id}/seo-report")
def get_seo_report(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """The SEO Quality Checklist as last saved; worked out now (measurable checks only) when the article has none yet."""
    a = _get(db, b, article_id)
    rep = (a.stats or {}).get("seo_report")
    if not rep and a.body:
        rep = seo.build(db, a, b, with_ai=False)
        seo.save(db, a, rep)
        db.commit()
    return rep or {"checks": [], "summary": {}, "ai": None}


@router.post("/{article_id}/seo-report")
def run_seo_report(article_id: int, ai: bool = False, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Check the saved article again: ?ai=true also runs the AI review (search intent, writing, facts, E-E-A-T, related queries, links)."""
    a = _get(db, b, article_id)
    if not a.body:
        raise HTTPException(400, "The article has no text yet.")
    rep = seo.build(db, a, b, with_ai=ai, previous=(a.stats or {}).get("seo_report"))
    seo.save(db, a, rep)
    db.commit()
    return rep


class KeywordParagraphsIn(BaseModel):
    body: str | None = None  # the draft as it is on screen (unsaved); the saved body when empty
    keyword: str | None = Field(default=None, max_length=255)
    secondary_keywords: list[str] | None = Field(default=None, max_length=20)


@router.post("/{article_id}/keyword-paragraphs")
def keyword_paragraphs(article_id: int, body: KeywordParagraphsIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Rewrite the paragraphs of the draft that carry none of the keywords so each carries one. Nothing is saved: the editor shows the result and the person saves it."""
    a = _get(db, b, article_id)
    primary = " ".join((body.keyword or a.keyword or "").lower().split())
    secondary = [" ".join(k.lower().split()) for k in (body.secondary_keywords if body.secondary_keywords is not None else a.secondary_keywords or []) if k.strip()]
    brand = svc.brand_of(b)
    text = svc.sanitize_html(svc.strip_emphasis(body.body)) if body.body else svc.strip_emphasis(a.body or "")
    try:
        out, report = svc.add_keywords_to_paragraphs(text, primary, secondary, a.topic or "")
    except svc.OllamaAnswerError as exc:
        raise HTTPException(502, str(exc)) from exc
    out = svc.emphasize(out, primary, secondary, brand)
    cov = svc.paragraph_coverage(out, primary, secondary)
    return {"body": out, **report, "missing_after": len(cov["missing"]), "covered": cov["covered"], "total": cov["total"]}


class ChunkIn(BaseModel):
    body: str | None = None  # the draft as it is on screen (unsaved); the saved body when empty
    keyword: str | None = Field(default=None, max_length=255)
    secondary_keywords: list[str] | None = Field(default=None, max_length=20)


@router.post("/{article_id}/chunk-paragraphs")
def chunk_paragraphs(article_id: int, body: ChunkIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Break the long paragraphs of the draft into short chunks of whole sentences. Nothing is saved: the editor shows the result and the person saves it."""
    a = _get(db, b, article_id)
    primary = " ".join((body.keyword or a.keyword or "").lower().split())
    secondary = [" ".join(k.lower().split()) for k in (body.secondary_keywords if body.secondary_keywords is not None else a.secondary_keywords or []) if k.strip()]
    text = svc.sanitize_html(svc.strip_emphasis(body.body)) if body.body else svc.strip_emphasis(a.body or "")
    out, split = svc.chunk_paragraphs(text)
    return {"body": svc.emphasize(out, primary, secondary, svc.brand_of(b)), "split": split, "long_left": svc.long_paragraphs(out)}


class PublishIn(BaseModel):
    mode: Literal["draft", "publish", "schedule"] = "draft"
    scheduled_at: datetime | None = None  # with a time zone; required for "schedule"


def _target(db: Session, b: Business) -> SiteIntegration:
    """The business's connected website; falls back to the WORDPRESS_* settings in .env for a WordPress site."""
    from ..services import article_publishing as ap
    t = ap.site_target(db, b)
    if t:
        return t
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
        a.featured_image_alt = (re.sub(r"[^\w]+", "-", (a.keyword or "").lower()).strip("-") or a.title or "")[:255] or None  # the primary keyword, e.g. "wedding-dress"
    _refresh_schema(a, b)
    db.commit()
    return row(a)


@router.get("/{article_id}/featured-image")
def get_featured_image(business_id: int, article_id: int, db: Session = Depends(get_db)):
    from fastapi.responses import FileResponse
    a = db.scalar(select(Article).where(Article.id == article_id, Article.business_id == business_id))
    if not a or not a.featured_image_path:
        raise HTTPException(404, "This article has no featured image")
    p = fi.path_of(a.featured_image_path)
    if not p:
        raise HTTPException(404, "This article has no featured image")
    return FileResponse(p, media_type=fi.media_type(a.featured_image_path), headers={"Cache-Control": "public, max-age=86400"})


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


@router.post("/{article_id}/content-images")
def add_content_image(article_id: int, body: FeaturedImageIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """One image for the article body (Images & Analysis step): converted to an optimized WebP and stored in GrowZen.
    The editor places it in the body; publishing uploads it to the website once (services/content_images.py)."""
    from ..services import content_images as ci
    a = _get(db, b, article_id)
    try:
        webp, info = fi.convert(fi.decode_upload(body.data_url), body.filename, body.page or 1)
    except fi.ImageError as exc:
        raise HTTPException(422, str(exc))
    name = ci.save(b.id, a.id, webp, info)
    return {"name": name, "size": len(webp), "info": info}


@router.get("/{article_id}/content-images")
def list_content_images(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    from ..services import content_images as ci
    a = _get(db, b, article_id)
    return {"images": ci.listing(b.id, a.id)}


@router.get("/{article_id}/content-images/{name}")
def get_content_image(business_id: int, article_id: int, name: str):
    from fastapi.responses import FileResponse

    from ..services import content_images as ci
    p = ci.path_of(business_id, article_id, name)
    if not p:
        raise HTTPException(404, "Image not found")
    return FileResponse(p, media_type="image/webp", headers={"Cache-Control": "public, max-age=86400"})


@router.delete("/{article_id}/content-images/{name}")
def delete_content_image(article_id: int, name: str, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Remove an uploaded image that is not used in the article (still in the upload list, never inserted)."""
    from ..services import content_images as ci
    a = _get(db, b, article_id)
    if name in ci.names_in(a.body or ""):
        raise HTTPException(409, "This image is in the saved article. Take it out of the article and save first.")
    if not ci.remove(b.id, a.id, name):
        raise HTTPException(404, "Image not found")
    return {"ok": True}


def _ready_or_409(db: Session, a: Article, b: Business) -> None:
    """Before publishing a new post: the SEO checklist is refreshed so it shows what is still missing. It is information only and never
    blocks publishing (the user decides when the article is ready)."""
    if seo._is_live(a):
        return
    rep = seo.build(db, a, b, with_ai=False, previous=(a.stats or {}).get("seo_report"))
    seo.save(db, a, rep)
    db.commit()


@router.post("/{article_id}/publish")
def publish(article_id: int, body: PublishIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    a = _get(db, b, article_id)
    if a.status != "completed":
        raise HTTPException(409, "Only a completed article can be published")
    if get_settings().blog_featured_image_required and not fi.path_of(a.featured_image_path):
        raise HTTPException(422, "Add a featured image before publishing (Featured image section, above the article body).")
    _ready_or_409(db, a, b)
    when = body.scheduled_at.astimezone(timezone.utc) if body.scheduled_at and body.scheduled_at.tzinfo else None
    target = _target(db, b)
    if body.mode == "schedule" and target.method in sp.LOCAL_SCHEDULE:
        return _hold_for_later(db, b, a, target, when)
    from ..services import article_publishing as ap
    try:
        out = ap.publish_site(db, b, a, target, body.mode, when)
    except sp.PublishError as exc:
        raise HTTPException(502, str(exc))
    return {**out, "article": row(a)}


def _react_conn(db: Session, b: Business):
    from ..models import ReactSiteConnection
    from ..services import react_site as rs
    conn = db.scalar(select(ReactSiteConnection).where(ReactSiteConnection.business_id == b.id))
    if not conn or not rs.has_credentials(conn) or conn.status != "connected":
        raise HTTPException(409, "Connect the React.js website first (Publish & Schedule > React.js Website > Test Login).")
    return conn


def _react_failed(db: Session, conn, exc) -> None:
    """Keep the renewed token; a refused login marks the connection 'failed' (shown as Authentication Failed)."""
    from ..services import react_site as rs
    if isinstance(exc, rs.AuthFailed):
        conn.status, conn.last_error = "failed", str(exc)[:500]
    db.commit()


@router.post("/{article_id}/publish-react")
def publish_react(article_id: int, body: PublishIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Publish (or update) this article on the React.js website through its blog API. WordPress publishing is unaffected."""
    from ..services import react_site as rs
    a = _get(db, b, article_id)
    if a.status != "completed":
        raise HTTPException(409, "Only a completed article can be published")
    if get_settings().blog_featured_image_required and not fi.path_of(a.featured_image_path):
        raise HTTPException(422, "Add a featured image before publishing (Featured image section, above the article body).")
    _ready_or_409(db, a, b)
    conn = _react_conn(db, b)
    when = body.scheduled_at.astimezone(timezone.utc) if body.scheduled_at and body.scheduled_at.tzinfo else None
    from ..services import article_publishing as ap
    try:
        out = ap.publish_react(db, a, conn, body.mode, when)  # a refused login marks the connection failed there
    except rs.ScheduleHeldByGrowZen as exc:
        from ..services import article_schedule as sched
        try:
            sched.schedule_at(db, b, a, when, ap.REACT)  # the website cannot publish later: GrowZen keeps it and publishes at that time
        except sched.ScheduleError as err:
            raise HTTPException(err.code, str(err))
        a.react_status = a.react_status if a.react_post_id and a.react_status != "deleted" else "scheduled"  # a deleted post comes back at that time
        db.commit()
        return {"id": None, "url": None, "status": "scheduled", "held": True, "due_at": when, "article": row(a),
                "steps": [{"step": "Schedule it", "ok": True, "detail": f"{exc} It will be published on {when.strftime('%d %b %Y %H:%M')} UTC."}]}
    except rs.ReactSiteError as exc:
        raise HTTPException(502, str(exc))
    return {**out, "article": row(a)}


@router.delete("/{article_id}/react-post")
def delete_react_post(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Delete this article's post from the React.js website (by its stored id only). The article stays in GrowZen."""
    from ..services import react_site as rs
    a = _get(db, b, article_id)
    if not a.react_post_id or a.react_status == "deleted":
        raise HTTPException(409, "This article has no post on the React.js website to delete.")
    conn = _react_conn(db, b)
    try:
        out = rs.delete(conn, a.react_post_id)
    except rs.ReactSiteError as exc:
        _react_failed(db, conn, exc)
        raise HTTPException(502, str(exc))
    a.react_status = "deleted"
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


@router.post("/sync-from-website")
def sync_from_website(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Bring in the connected WordPress site's posts. New ones are added (with their WordPress id, so deleting works), and a blog added by hand that is the same post is linked to it. WordPress does not say which tool made a post, so every post of the site comes in."""
    from ..services import article_publishing as ap
    target = ap.site_target(db, b)
    if target is None:
        raise HTTPException(409, "Your website is not connected yet (Publishing Setup), so its posts cannot be fetched.")
    if target.method != "wordpress":
        raise HTTPException(409, f"Your website is connected as {target.method}. Fetching posted blogs works for WordPress only.")
    try:
        posts = sp.wordpress_posts(target)
    except sp.PublishError as exc:
        raise HTTPException(502, str(exc)) from exc
    mine = {_norm_url(x.wp_url or ""): x for x in db.scalars(select(Article).where(Article.business_id == b.id)) if x.wp_url and x.wp_status != "deleted"}
    added = linked = 0
    for p in posts:
        have = mine.get(_norm_url(p["url"]))
        status = "publish" if p["status"] == "publish" else "future"
        if have is not None:
            if not have.wp_post_id or have.publish_method == "existing":
                have.wp_post_id, have.publish_method, have.wp_status = p["id"], "wordpress", status
                linked += 1
            continue
        db.add(Article(business_id=b.id, keyword=(p["title"] or "Blog")[:255], title=(p["title"] or None), status="completed", body="", wp_post_id=p["id"], wp_url=p["url"], wp_status=status,
                       publish_method="wordpress", slug=(p["url"].rstrip("/").rsplit("/", 1)[-1] or None), generated_at=datetime.now(timezone.utc)))
        added += 1
    db.commit()
    return {"found": len(posts), "added": added, "linked": linked}


class BulkIn(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=40)


@router.post("/existing/bulk", status_code=201)
def add_existing_bulk(body: BulkIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Add several blogs that are already on the website: each one's title is read from its own page. Only addresses on the project's website are taken; nothing is changed on the site."""
    from urllib.parse import urlsplit
    from bs4 import BeautifulSoup
    from ..services.net import site_client
    site = (urlsplit(b.website or "").hostname or "").lower().removeprefix("www.")
    have = {_norm_url(x.wp_url or x.react_url or "") for x in db.scalars(select(Article).where(Article.business_id == b.id)) if x.wp_status != "deleted"}
    added, skipped = [], []
    client = site_client(10)
    try:
        for url in dict.fromkeys(u.strip() for u in body.urls):
            p = urlsplit(url)
            if p.scheme not in ("http", "https") or (p.hostname or "").lower().removeprefix("www.") != site or _norm_url(url) in have:
                skipped.append(url)
                continue
            title = ""
            try:
                r = client.get(url)
                if r.status_code < 400:
                    soup = BeautifulSoup(r.text, "html.parser")
                    h1 = soup.find("h1")
                    title = ((h1.get_text(" ", strip=True) if h1 else "") or (soup.title.string if soup.title and soup.title.string else "")).strip()
            except Exception:  # noqa: BLE001 - the address is still listed, with its words as the title
                title = ""
            slug = p.path.rstrip("/").rsplit("/", 1)[-1]
            title = (title or slug.replace("-", " ").capitalize() or url)[:255]
            a = Article(business_id=b.id, keyword=title, title=title, status="completed", body="", wp_url=url, wp_status="publish", publish_method="existing", slug=slug or None, generated_at=datetime.now(timezone.utc))
            db.add(a)
            have.add(_norm_url(url))
            added.append(url)
    finally:
        client.close()
    db.commit()
    return {"added": len(added), "skipped": len(skipped)}


class ExistingIn(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    url: str = Field(min_length=8, max_length=500)
    keyword: str | None = Field(default=None, max_length=255)


@router.post("/existing", status_code=201)
def add_existing(body: ExistingIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Add a blog that is already live on the business's website (written elsewhere), so it is in the list of posted blogs. Nothing is published or changed on the website."""
    from urllib.parse import urlsplit
    url = body.url.strip()
    p = urlsplit(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        raise HTTPException(422, "Enter the full address of the blog, starting with https://")
    site = (urlsplit(b.website or "").hostname or "").lower().removeprefix("www.")
    if site and (p.hostname or "").lower().removeprefix("www.") != site:
        raise HTTPException(422, f"That address is not on this project's website ({site}).")
    def same(u: str) -> str:  # www, scheme and a trailing slash do not make a different blog
        q = urlsplit(u or "")
        return f"{(q.hostname or '').lower().removeprefix('www.')}{q.path.rstrip('/')}?{q.query}"
    if any(same(x.wp_url or x.react_url or "") == same(url) and x.wp_status != "deleted" for x in db.scalars(select(Article).where(Article.business_id == b.id))):
        raise HTTPException(409, "This blog is already in the list.")
    a = Article(business_id=b.id, keyword=(body.keyword or body.title).strip()[:255], title=body.title.strip(), status="completed", body="", wp_url=url, wp_status="publish", publish_method="existing",
                slug=(p.path.rstrip("/").rsplit("/", 1)[-1] or None), generated_at=datetime.now(timezone.utc))
    db.add(a)
    db.commit()
    return row(a, exclude={"body"})


@router.delete("/{article_id}/with-website")
def delete_article_and_website_post(article_id: int, list_only: bool = False, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Delete the blog from the connected website AND from the list. The list entry is kept when the website refuses, so nothing is lost and it can be tried again.
    `list_only=true` removes it from the list without touching the website (for a site bevisibe cannot delete from)."""
    from ..models import ScheduledPost
    a = _get(db, b, article_id)
    gone_from_site = False
    if not list_only:
        on_wp = a.wp_status not in (None, "deleted") and bool(a.wp_url or a.wp_post_id)
        on_react = bool(a.react_post_id) and a.react_status not in (None, "deleted")
        if on_wp:
            from ..services import article_publishing as ap
            target = ap.site_target(db, b)
            if target is None:
                raise HTTPException(409, "Your website is not connected in the setup, so the blog cannot be deleted from it. Connect it, or delete the blog on the website yourself and use \"Remove from the list only\".")
            if target.method != "wordpress":
                raise HTTPException(409, f"Your website is connected as {target.method}, and bevisibe can delete posts from WordPress and the React website only. Delete the blog on the website yourself, then use \"Remove from the list only\".")
            pid = a.wp_post_id or sp.find_wordpress_post_id(target, a.wp_url or "")
            if not pid:
                raise HTTPException(409, "The blog could not be found on WordPress by its address, so it was not deleted. Check the address, or delete it on the website and use \"Remove from the list only\".")
            try:
                sp.delete_wordpress(target, pid)
            except sp.PublishError as exc:
                raise HTTPException(502, f"WordPress did not delete it, so it is still in the list: {exc}") from exc
            gone_from_site = True
        if on_react:
            from ..services import react_site as rs
            conn = _react_conn(db, b)
            try:
                rs.delete(conn, a.react_post_id)
            except rs.ReactSiteError as exc:
                _react_failed(db, conn, exc)
                raise HTTPException(502, f"The React website did not delete it, so it is still in the list: {exc}") from exc
            gone_from_site = True
    for p in db.scalars(select(ScheduledPost).where(ScheduledPost.article_id == a.id, ScheduledPost.status == "pending")):
        p.status = "cancelled"  # nothing held for later should bring it back
    db.delete(a)
    db.commit()
    return {"deleted": True, "from_website": gone_from_site}


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
