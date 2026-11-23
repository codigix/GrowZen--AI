"""The blog workflow API: /businesses/{id}/blog-flow/... (keywords, topics, the site's layout, and promoting a published blog)."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_user
from ..db import get_db
from ..deps import get_business
from ..models import Article, BlogPromotion, Business
from ..services import blog_flow as flow
from ..services import blog_promo as promo

router = APIRouter(prefix="/businesses/{business_id}/blog-flow", tags=["articles"], dependencies=[Depends(current_user)])


def _article(db: Session, b: Business, article_id: int) -> Article:
    a = db.get(Article, article_id)
    if a is None or a.business_id != b.id:
        raise HTTPException(404, "Article not found")
    return a


def _promo(db: Session, a: Article, promo_id: int) -> BlogPromotion:
    p = db.get(BlogPromotion, promo_id)
    if p is None or p.article_id != a.id:
        raise HTTPException(404, "Not found")
    return p


@router.get("/keywords")
def keywords(b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    return {"keywords": flow.keyword_pool(db, b)}


class TopicsIn(BaseModel):
    keywords: list[str] = Field(min_length=1, max_length=6)


@router.post("/topics")
def topics(body: TopicsIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    try:
        return flow.topics(db, b, body.keywords)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/layout")
def layout(article_id: int | None = Query(None), b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    return flow.layout_check(db, b, _article(db, b, article_id) if article_id else None)


@router.get("/images")
def blog_images(article_id: int | None = Query(None), b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """The images the website's own /blog posts already use: count and size per post (read only)."""
    from ..services import blog_images as bi
    return bi.image_structure(db, b, _article(db, b, article_id) if article_id else None)


@router.get("/promo/{article_id}")
def promo_status(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    a = _article(db, b, article_id)
    if promo.published_url(db, a) and not db.scalar(select(BlogPromotion.id).where(BlogPromotion.article_id == a.id).limit(1)):
        promo.create_plan(db, b, a)
    return promo.status(db, b, a)


class CustomIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    url: str | None = Field(default=None, max_length=500)


@router.post("/promo/{article_id}/add")
def promo_add(article_id: int, body: CustomIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    a = _article(db, b, article_id)
    try:
        promo.add_custom(db, b, a, body.name, body.url)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return promo.status(db, b, a)


class FromCompetitorIn(BaseModel):
    domain: str = Field(min_length=3, max_length=255)


@router.post("/promo/{article_id}/add-from-competitor")
def promo_add_from_competitor(article_id: int, body: FromCompetitorIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Add a site where a competitor promotes its blog to this blog's plan."""
    a = _article(db, b, article_id)
    try:
        promo.add_from_competitor(db, b, a, body.domain)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return promo.status(db, b, a)


@router.post("/promo/{article_id}/research-competitors", status_code=202)
def promo_research_competitors(article_id: int, background: BackgroundTasks, force: bool = Query(False), b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Open each competitor's website to find its blog, its articles and the outside platforms it publishes on. Runs in the background; GET /promo/{id} shows the progress."""
    from ..backlinks import hub
    from ..deps import in_background
    from ..services import competitor_blogs as cb
    _article(db, b, article_id)
    comps = hub.hygiene_competitors(db, b)
    if not comps:
        raise HTTPException(409, "Add your competitors first (Competitors page).")
    if not cb.start(b.id):
        return {"started": False, "running": True}
    background.add_task(in_background(cb.run, b.id, comps, force))
    return {"started": True, "running": True}


@router.get("/discovery/{article_id}")
def discovery(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Websites across the web that publish articles on this blog's topics, with what was verified about each (last run's result)."""
    from ..services import publish_discovery as pd
    return pd.view(db, b, _article(db, b, article_id))


@router.post("/discovery/{article_id}/run", status_code=202)
def discovery_run(article_id: int, background: BackgroundTasks, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Search the web and verify the sites found. Runs in the background; GET /discovery/{id} shows the result."""
    from ..deps import in_background
    from ..services import publish_discovery as pd
    a = _article(db, b, article_id)
    v = pd.view(db, b, a)
    if v["state"] in ("no_search", "no_topic"):
        raise HTTPException(409, v["message"])
    if not pd.start(b, a):
        return {"started": False, "running": True}
    background.add_task(in_background(pd.run, b.id, a.id))
    return {"started": True, "running": True}


class SaveSiteIn(BaseModel):
    domain: str = Field(min_length=3, max_length=255)


@router.post("/discovery/{article_id}/save")
def discovery_save(article_id: int, body: SaveSiteIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Keep a discovered site in the link-building plan for later."""
    from ..services import publish_discovery as pd
    a = _article(db, b, article_id)
    try:
        pd.save(db, b, a, body.domain)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return pd.view(db, b, a)


@router.get("/platforms/{article_id}")
def platforms(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """The top blogging and article-publishing platforms, ranked for this business, with which ones were found online at the last check."""
    from ..services import blog_platforms as bp
    return bp.view(db, b, _article(db, b, article_id))


@router.post("/platforms/{article_id}/check", status_code=202)
def platforms_check(article_id: int, background: BackgroundTasks, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Ask Claude for the platforms that suit this business and open every platform to see that it is online. Runs in the background; GET /platforms/{id} shows the result."""
    from ..deps import in_background
    from ..services import blog_platforms as bp
    a = _article(db, b, article_id)
    if not bp.start(b.id):
        return {"started": False, "running": True}
    background.add_task(in_background(bp.run, b.id, a.id))
    return {"started": True, "running": True}


@router.post("/platforms/{article_id}/rental/refresh", status_code=202)
def platforms_rental_refresh(article_id: int, background: BackgroundTasks, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Ask Claude for clothing-rental websites for this business and open each to keep the real ones. Runs in the background; GET /platforms/{id} shows the result."""
    from ..deps import in_background
    from ..services import blog_platforms as bp
    a = _article(db, b, article_id)
    if not bp.is_rental(b, a):
        raise HTTPException(409, "This business does not rent anything out.")
    if not bp.start_rental(b.id):
        return {"started": False, "running": True}
    background.add_task(in_background(bp.refresh_rental, b.id, a.id))
    return {"started": True, "running": True}


@router.post("/platforms/{article_id}/save")
def platforms_save(article_id: int, body: SaveSiteIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Keep a platform in the link-building plan for later."""
    from ..services import blog_platforms as bp
    a = _article(db, b, article_id)
    try:
        bp.save(db, b, a, body.domain)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return bp.view(db, b, a)


@router.post("/promo/{article_id}/check-all")
def promo_check_all(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    a = _article(db, b, article_id)
    url = promo.published_url(db, a)
    if not url:
        raise HTTPException(409, "The blog is not published yet.")
    for p in db.scalars(select(BlogPromotion).where(BlogPromotion.article_id == a.id, BlogPromotion.posted_url.is_not(None), BlogPromotion.status.in_(("posted", "verified", "problem")))).all():
        promo.check(db, p, url)
    return promo.status(db, b, a)


class OverviewIn(BaseModel):
    refresh: bool = False


@router.post("/promo/{article_id}/{promo_id}/overview")
def promo_overview(article_id: int, promo_id: int, body: OverviewIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    a = _article(db, b, article_id)
    try:
        return {"overview": promo.overview(db, b, a, _promo(db, a, promo_id), body.refresh), "url": promo.published_url(db, a)}
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


class PostedIn(BaseModel):
    url: str = Field(min_length=4, max_length=800)


@router.post("/promo/{article_id}/{promo_id}/posted")
def promo_posted(article_id: int, promo_id: int, body: PostedIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """The user posted on the platform: remember the page address and check it for the blog's link straight away."""
    a = _article(db, b, article_id)
    p = _promo(db, a, promo_id)
    try:
        promo.mark_posted(db, p, body.url)
        url = promo.published_url(db, a)
        if url:
            promo.check(db, p, url)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return promo.status(db, b, a)


@router.post("/promo/{article_id}/{promo_id}/check")
def promo_check(article_id: int, promo_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    a = _article(db, b, article_id)
    url = promo.published_url(db, a)
    if not url:
        raise HTTPException(409, "The blog is not published yet.")
    try:
        promo.check(db, _promo(db, a, promo_id), url)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return promo.status(db, b, a)


class StateIn(BaseModel):
    status: str = Field(pattern="^(planned|skipped)$")


@router.post("/promo/{article_id}/{promo_id}/status")
def promo_state(article_id: int, promo_id: int, body: StateIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    a = _article(db, b, article_id)
    p = _promo(db, a, promo_id)
    p.status = body.status
    db.commit()
    return promo.status(db, b, a)
