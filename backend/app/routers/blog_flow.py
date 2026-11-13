"""The blog workflow API: /businesses/{id}/blog-flow/... (keywords, topics, the site's layout, and promoting a published blog)."""
from fastapi import APIRouter, Depends, HTTPException, Query
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
