"""Blog articles generated from Google Trends keywords: one article per generation (primary + secondary keywords), saved separately."""
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_business, in_background
from ..models import Article, Business
from ..serialize import row, rows
from ..services import articles as svc

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


@router.post("/{article_id}/publish-wordpress")
def publish_wordpress(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    a = _get(db, b, article_id)
    if a.status != "completed":
        raise HTTPException(409, "Only a completed article can be published")
    try:
        a.wp_post_id, a.wp_url = svc.publish_wordpress(a)
    except RuntimeError as exc:
        raise HTTPException(502, str(exc))
    db.commit()
    return row(a)


@router.delete("/{article_id}", status_code=204)
def delete_article(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    a = db.get(Article, article_id)
    if a and a.business_id == b.id:
        db.delete(a)
        db.commit()
