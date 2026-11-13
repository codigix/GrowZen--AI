"""AI-assisted working tools for one project: SEO brief, social posts, Google Ads plan and the questions people ask.

Each one is built from what we really have: Google Ads Keyword Planner data and the AI model, with the business's own details. Nothing is
published or spent: the tools return drafts to review. Limits that platforms enforce (ad headline and description lengths, post lengths) are
checked on the server, not trusted to the model.
"""
import re
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..competitors import intel
from ..db import get_db
from ..deps import get_business
from ..models import Business, Keyword
from ..services import ai, market
from ..services.activity import log

router = APIRouter(prefix="/businesses/{business_id}/tools", tags=["tools"])

LIMITS = {"x": 280, "linkedin": 3000, "facebook": 63206, "instagram": 2200, "gbp": 1500}
HEADLINE, DESCRIPTION = 30, 90


def _about(b: Business) -> str:
    place = ", ".join(x for x in (b.area, b.city) if x)
    return f"Business: {b.name}. Category: {b.primary_category or 'not set'}. Place: {place or 'not set'}. Website: {b.website or 'none'}. About: {(b.description or '')[:400]}"


def _need_ai() -> None:
    if not ai.is_configured():
        raise HTTPException(503, "The AI model is not set up on the platform (AI settings in backend/.env).")


_QUESTION = re.compile(r"^(who|what|which|where|when|why|how|is|are|can|do|does|should|will)(?![a-z])", re.I)


def _google(b: Business, q: str) -> dict[str, Any]:
    """What Google's Keyword Planner knows around a keyword: its related searches and, among them, the questions people type. {} when Google Ads is not set up."""
    from ..services import google_ads_client as ads, keyword_metrics  # noqa: PLC0415
    if not keyword_metrics.enabled():
        return {}
    try:
        ideas = ads.keyword_ideas([q], limit=80, geo_target=ads.geo_target_for(market.serp_country(b)))
    except ads.GoogleAdsError as exc:
        raise HTTPException(502, "Google Ads did not answer: " + ("; ".join(getattr(exc, "details", []) or []) or str(exc))[:200]) from exc
    ranked = sorted((i for i in ideas if i["keyword"].lower() != q.lower()), key=lambda i: -(i.get("avg_monthly_searches") or 0))
    return {"organic": [], "peopleAlsoAsk": [{"question": i["keyword"]} for i in ranked if _QUESTION.match(i["keyword"])][:12],
            "relatedSearches": [{"query": i["keyword"]} for i in ranked if not _QUESTION.match(i["keyword"])][:12]}


# SEO brief -------------------------------------------------------------------------------------------------------------------------------------
class BriefIn(BaseModel):
    keyword: str = Field(min_length=2, max_length=160)


@router.post("/seo-brief")
def seo_brief(body: BriefIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """A content brief for a keyword: the questions and related searches Google's Keyword Planner shows, and an outline written for this business."""
    _need_ai()
    kw = " ".join(body.keyword.split())
    res = _google(b, kw)
    top = [{"position": o.get("position"), "title": o.get("title"), "url": o.get("link"), "snippet": (o.get("snippet") or "")[:240]} for o in (res.get("organic") or [])[:8]]
    questions = [q.get("question") for q in (res.get("peopleAlsoAsk") or []) if q.get("question")][:8]
    related = [q.get("query") for q in (res.get("relatedSearches") or []) if q.get("query")][:10]
    system = "You are a senior SEO content strategist. Return JSON only."
    prompt = (f"{_about(b)}\nTarget keyword: {kw}\nPages that rank now: {top or 'not available (no live Google results)'}\nPeople also ask: {questions}\nRelated searches: {related}\n\n"
              'Write a content brief as JSON: {"title_tag": "<=60 chars", "meta_description": "<=155 chars", "search_intent": "informational|commercial|transactional|navigational and one line why", '
              '"target_words": number, "outline": [{"h2": "...", "points": ["..."], "h3": ["..."]}], "questions_to_answer": ["..."], "terms_to_include": ["..."], '
              '"internal_link_ideas": ["..."], "how_to_beat_the_top_results": ["..."]}. Use this business\'s real place and offer. Do not invent statistics.')
    try:
        out = ai.complete_json(system, prompt, temperature=0.4, max_tokens=2400)
    except Exception as exc:  # the model or its network failed: say so rather than return an empty brief
        raise HTTPException(502, f"The AI model did not answer: {str(exc)[:160]}") from exc
    out["title_tag"] = (out.get("title_tag") or kw)[:60]
    out["meta_description"] = (out.get("meta_description") or "")[:155]
    log(db, user.name, "seo_brief", b.id, keyword=kw)
    db.commit()
    return {"keyword": kw, "brief": out, "ranking_now": top, "questions": questions, "related": related, "live_results": bool(top)}


# Social posts ----------------------------------------------------------------------------------------------------------------------------------
class SocialIn(BaseModel):
    topic: str = Field(min_length=3, max_length=300)
    platforms: list[Literal["x", "linkedin", "facebook", "instagram", "gbp"]] = Field(default_factory=lambda: ["facebook", "instagram", "x"], min_length=1, max_length=5)
    tone: Literal["friendly", "professional", "playful", "urgent"] = "friendly"


@router.post("/social-posts")
def social_posts(body: SocialIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """One draft per platform for a topic, kept inside each platform's length limit. Nothing is posted."""
    _need_ai()
    system = "You write social media posts for a local business. Return JSON only."
    limits = {p: LIMITS[p] for p in body.platforms}
    prompt = (f"{_about(b)}\nTopic: {body.topic}\nTone: {body.tone}\nPlatforms and their maximum lengths: {limits}\n"
              'Return {"posts": [{"platform": "...", "text": "the post, within the limit", "hashtags": ["..."], "call_to_action": "...", "image_idea": "..."}]} with exactly one post per platform. '
                "No made-up offers, prices or claims.")
    try:
        out = ai.complete_json(system, prompt, temperature=0.7, max_tokens=1800)
    except Exception as exc:
        raise HTTPException(502, f"The AI model did not answer: {str(exc)[:160]}") from exc
    posts = []
    for p in out.get("posts", []):
        plat = p.get("platform")
        if plat not in body.platforms:
            continue
        tags = " ".join(f"#{t.lstrip('#')}" for t in (p.get("hashtags") or [])[:8])
        text = (p.get("text") or "").strip()
        full = f"{text}\n\n{tags}".strip() if plat != "gbp" and tags else text
        over = len(full) > LIMITS[plat]
        if over:
            full = full[:LIMITS[plat]].rstrip()
        posts.append({"platform": plat, "text": full, "length": len(full), "limit": LIMITS[plat], "trimmed": over, "call_to_action": p.get("call_to_action"), "image_idea": p.get("image_idea")})
    log(db, user.name, "social_posts", b.id, topic=body.topic[:80])
    db.commit()
    return {"topic": body.topic, "posts": posts}


# Google Ads plan -------------------------------------------------------------------------------------------------------------------------------
class AdsIn(BaseModel):
    goal: Literal["calls", "leads", "visits", "bookings"] = "leads"
    daily_budget: float | None = Field(default=None, ge=1, le=100000)
    landing_url: str | None = Field(default=None, max_length=300)


@router.post("/ads-plan")
def ads_plan(body: AdsIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """A Google Ads search campaign to review and build: ad groups, keywords with match types, and responsive search ads within Google's limits."""
    _need_ai()
    seeds = [k.keyword for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id).order_by(Keyword.priority, Keyword.id).limit(25))] or intel.default_keywords(b)[:15]
    system = "You are a Google Ads specialist for local businesses. Return JSON only."
    prompt = (f"{_about(b)}\nGoal: {body.goal}. Daily budget: {body.daily_budget or 'not set'}. Landing page: {body.landing_url or b.website or 'not set'}.\nKeywords the business already targets: {seeds}\n\n"
              'Return {"campaign_name": "...", "bidding": "which strategy and why in one line", "ad_groups": [{"name": "...", "keywords": [{"text": "...", "match": "phrase|exact"}], '
              '"negative_keywords": ["..."], "headlines": ["up to 15, each at most 30 characters"], "descriptions": ["up to 4, each at most 90 characters"]}], '
              '"extensions": ["call, location, sitelink and callout ideas"], "checklist": ["steps before launching"]}. 2 to 4 ad groups. Use the real place; no invented offers, prices or awards.')
    try:
        out = ai.complete_json(system, prompt, temperature=0.4, max_tokens=3200)
    except Exception as exc:
        raise HTTPException(502, f"The AI model did not answer: {str(exc)[:160]}") from exc
    cut = 0
    for g in out.get("ad_groups", []):
        heads = [h.strip() for h in (g.get("headlines") or []) if isinstance(h, str)]
        descs = [d.strip() for d in (g.get("descriptions") or []) if isinstance(d, str)]
        cut += sum(1 for h in heads if len(h) > HEADLINE) + sum(1 for d in descs if len(d) > DESCRIPTION)
        g["headlines"] = [h for h in heads if 0 < len(h) <= HEADLINE][:15]  # Google rejects longer ones, so they are dropped rather than cut mid-word
        g["descriptions"] = [d for d in descs if 0 < len(d) <= DESCRIPTION][:4]
    log(db, user.name, "ads_plan", b.id, goal=body.goal)
    db.commit()
    return {"goal": body.goal, "plan": out, "dropped_over_limit": cut, "limits": {"headline": HEADLINE, "description": DESCRIPTION}, "seeded_from": seeds[:10]}


# Questions people ask --------------------------------------------------------------------------------------------------------------------------
class QuestionsIn(BaseModel):
    keywords: list[str] | None = Field(default=None, max_length=5)


@router.post("/questions")
def questions(body: QuestionsIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """The questions people type around the business's keywords, from the Google Ads Keyword Planner: the questions to answer, and to track in AI answers."""
    from ..services import keyword_metrics  # noqa: PLC0415
    if not keyword_metrics.enabled():
        raise HTTPException(503, "Questions come from the Google Ads Keyword Planner: set the GOOGLE_ADS_* values in backend/.env.")
    seeds = [k.strip() for k in (body.keywords or []) if k.strip()][:5]
    if not seeds:
        seeds = [k.keyword for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True)).order_by(Keyword.id).limit(5))] or intel.default_keywords(b)[:3]
    seen: dict[str, dict[str, Any]] = {}
    for kw in seeds:
        res = _google(b, kw)
        for q in res.get("peopleAlsoAsk") or []:
            text = (q.get("question") or "").strip()
            if text and text.lower() not in seen:
                seen[text.lower()] = {"question": text, "keyword": kw, "kind": "question", "answered_by": (q.get("link") or "")[:200]}
        for q in res.get("relatedSearches") or []:
            text = (q.get("query") or "").strip()
            if text and text.lower() not in seen:
                seen[text.lower()] = {"question": text, "keyword": kw, "kind": "related search", "answered_by": ""}
    out = list(seen.values())
    log(db, user.name, "questions_researched", b.id, keywords=len(seeds))
    db.commit()
    return {"keywords": seeds, "items": out, "source": "Google Ads Keyword Planner"}
