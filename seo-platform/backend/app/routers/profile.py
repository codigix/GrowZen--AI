"""GBP posts and reviews for a business. Publishing and replying go through approved tasks."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import get_business
from ..models import Business, Post, Review
from ..schemas import PostIn, ReplyIn
from ..serialize import row, rows
from ..services import agent, ai
from ..services.activity import log

router = APIRouter(prefix="/businesses/{business_id}", tags=["profile"])


# Posts
@router.get("/posts")
def list_posts(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return rows(db.scalars(select(Post).where(Post.business_id == b.id).order_by(Post.created_at.desc())))


@router.post("/posts", status_code=201)
def create_post(body: PostIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    data = body.model_dump()
    when = data.pop("scheduled_for")
    p = Post(business_id=b.id, **data, scheduled_for=datetime.fromisoformat(when) if when else None, status="scheduled" if when else "draft")
    db.add(p)
    db.flush()
    task = agent._task(db, b, "gbp", "gbp_post", f"Post: {p.body[:60]}…", "Medium", post_id=p.id, body=p.body)
    log(db, user.name, "post_created", b.id, post_id=p.id)
    db.commit()
    return row(p) | {"task_id": task.id}


@router.post("/posts/draft")
def draft_post(topic: str = "", b: Business = Depends(get_business), db: Session = Depends(get_db)):
    if not ai.is_configured():
        raise HTTPException(503, "AI is not set up on the SEO platform.")
    t = agent.draft_weekly_post(db, b, topic)
    return row(t)


@router.delete("/posts/{post_id}", status_code=204)
def delete_post(post_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    p = db.get(Post, post_id)
    if not p or p.business_id != b.id:
        raise HTTPException(404, "Post not found")
    db.delete(p)
    db.commit()


# AI description
@router.post("/ai/description")
def ai_description(b: Business = Depends(get_business)):
    """Draft a 600-750 character GBP description from the profile (nothing invented). Not saved."""
    if not ai.is_configured():
        raise HTTPException(503, "AI is not set up on the SEO platform.")
    text = ai.complete(f"You write Google Business Profile descriptions for local businesses.\n{ai.RULES}",
                       f"Business profile:\n{ai.profile_text(b)}\n\nWrite a 600-750 character description: what the business does and where, "
                       "main services and who they serve, what makes them different (only if given). "
                       "No URLs, phone numbers, prices or promotions. Return only the text.",
                       max_tokens=500)
    return {"text": text[:750]}


# Reviews
@router.get("/reviews")
def list_reviews(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    found = list(db.scalars(select(Review).where(Review.business_id == b.id).order_by(Review.review_date.desc().nullslast())))
    n = len(found)
    topics: dict[str, int] = {}
    for r in found:
        for t in r.topics or []:
            topics[t] = topics.get(t, 0) + 1
    return {
        "reviews": rows(found),
        "summary": {
            "count": n, "avg_rating": round(sum(r.rating for r in found) / n, 1) if n else None,
            "reply_rate": round(sum(1 for r in found if r.reply_status == "posted") / n * 100) if n else 0,
            "awaiting_reply": sum(1 for r in found if r.reply_status != "posted"),
            "distribution": {s: sum(1 for r in found if r.rating == s) for s in range(5, 0, -1)},
            "topics": sorted(({"name": k, "count": v} for k, v in topics.items()), key=lambda x: -x["count"])[:12],
        },
    }


@router.post("/reviews/{review_id}/draft")
def draft_reply(review_id: int, body: ReplyIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    r = db.get(Review, review_id)
    if not r or r.business_id != b.id:
        raise HTTPException(404, "Review not found")
    if not ai.is_configured():
        raise HTTPException(503, "AI is not set up on the SEO platform.")
    text = ai.complete(f"You reply to Google reviews for the owner.\n{ai.RULES}\n- Never offer anything for reviews.",
                       f"Business profile:\n{ai.profile_text(b)}\n\nReview ({r.rating} stars) by {r.author or 'a customer'}:\n\"{r.body or '(rating only)'}\"\n\nReply in {body.language}, 40-90 words. Only the reply.",
                       max_tokens=400)
    r.reply_text, r.reply_status, r.reply_language = text, "draft", body.language
    db.commit()
    return row(r)


@router.post("/reviews/{review_id}/approve")
def approve_reply(review_id: int, body: ReplyIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Approve (optionally edited) reply text: posts it to Google when the business is linked."""
    r = db.get(Review, review_id)
    if not r or r.business_id != b.id:
        raise HTTPException(404, "Review not found")
    text = body.text or r.reply_text
    if not text:
        raise HTTPException(400, "No reply text to approve")
    r.reply_text = text
    task = agent._task(db, b, "review", "review_reply", f"Reply to {r.rating}★ review by {r.author or 'a customer'}", "Medium", review_id=r.id, rating=r.rating, text=text)
    db.commit()
    agent.decide(db, task, True, user.name)
    return row(r) | {"task": row(task)}
