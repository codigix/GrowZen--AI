"""GBP posts and reviews for a business. Publishing and replying go through approved tasks."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import access
from ..auth import User, current_user
from ..db import get_db, release_connection
from ..deps import get_business
from ..models import AgentTask, Business, Post, Review
from ..schemas import PostIn, ReplyIn
from ..serialize import row, rows
from ..services import agent, ai, gbp
from ..services.activity import log

router = APIRouter(prefix="/businesses/{business_id}", tags=["profile"])


# Posts
@router.get("/posts")
def list_posts(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    found = list(db.scalars(select(Post).where(Post.business_id == b.id).order_by(Post.created_at.desc())))
    waiting = {str((t.detail or {}).get("post_id")) for t in db.scalars(select(AgentTask).where(AgentTask.business_id == b.id, AgentTask.kind == "gbp_post", AgentTask.status == "scheduled"))}
    stale = [p for p in found if p.status == "scheduled" and str(p.id) not in waiting]
    for p in stale:  # "scheduled" with nothing waiting to send it (saved before posts were sent at their time): honestly a draft, so it is never shown as going out when it will not
        p.status, p.scheduled_for = "draft", None
    if stale:
        db.commit()
    return rows(found)


@router.post("/posts", status_code=201)
def create_post(body: PostIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    from ..services import autopilot
    data = body.model_dump()
    raw_when = data.pop("scheduled_for")
    try:
        when = autopilot.parse_when(raw_when)
    except autopilot.AutopilotError as exc:
        raise HTTPException(422, str(exc)) from exc
    if when is not None:  # the time is checked before anything is saved: a past time is refused, never published at once
        if not autopilot.linked(b):
            raise HTTPException(409, "Link the Google Business Profile first: a post cannot be scheduled without it.")
        if when <= datetime.now(timezone.utc) + timedelta(minutes=2):
            raise HTTPException(422, "Choose a time in the future. To post at once, use Post now.")
        from ..services import post_image_host
        if (why := post_image_host.hosting_problem(db, b, data.get("image_url"))):
            raise HTTPException(409, why)
    p = Post(business_id=b.id, **data, status="draft")
    db.add(p)
    db.flush()
    task = agent._task(db, b, "gbp", "gbp_post", f"Post: {p.body[:60]}…", "Medium", post_id=p.id, body=p.body)
    log(db, user.name, "post_created", b.id, post_id=p.id)
    db.commit()
    if when is not None:  # the person who set the time approves it for that time; the scheduler sends it then and not before
        try:
            autopilot.approve(db, b, task, user.name, publish_at=when)
        except autopilot.AutopilotError as exc:
            raise HTTPException(422, str(exc)) from exc
        db.refresh(p)
    return row(p) | {"task_id": task.id}


@router.get("/posts/clicks")
def post_clicks_report(b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Visits that came from each post's button, counted by Google Analytics from the campaign tag on the link. {available, reason, by_post: {id: {visits, users}}}."""
    from ..services import ga4, post_clicks
    try:
        props = access.ga4_properties(db, user, b)
    except HTTPException:
        return {"available": False, "reason": "Connect Google Analytics for this website to count clicks on the post buttons.", "by_post": {}}
    if not props:
        return {"available": False, "reason": "No Google Analytics property was found for this website.", "by_post": {}}
    try:
        ga = ga4.Ga4(b.connection)
        merged: dict[int, dict[str, int]] = {}
        for pr in props:
            for pid, v in post_clicks.counts(ga, pr["property"]).items():
                m = merged.setdefault(pid, {"visits": 0, "users": 0})
                m["visits"] += v["visits"]
                m["users"] += v["users"]
    except Exception as exc:  # noqa: BLE001 - Analytics may be slow or refuse: the table still shows
        return {"available": False, "reason": f"Google Analytics did not answer ({str(exc)[:120]}).", "by_post": {}}
    return {"available": True, "reason": None, "by_post": {str(k): v for k, v in merged.items()}}


def _post_task(db: Session, b: Business, post_id: int, statuses: tuple[str, ...]) -> AgentTask | None:
    return next((t for t in db.scalars(select(AgentTask).where(AgentTask.business_id == b.id, AgentTask.kind == "gbp_post", AgentTask.status.in_(statuses)).order_by(AgentTask.id.desc()))
                 if str((t.detail or {}).get("post_id")) == str(post_id)), None)


class ScheduleIn(BaseModel):
    scheduled_for: str


@router.post("/posts/{post_id}/schedule")
def schedule_post(post_id: int, body: ScheduleIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Set (or change) the time a saved post goes live. It is sent at that time and not before."""
    from ..services import autopilot
    p = db.get(Post, post_id)
    if not p or p.business_id != b.id:
        raise HTTPException(404, "Post not found")
    if p.status == "published":
        raise HTTPException(409, "This post is already live.")
    try:
        when = autopilot.parse_when(body.scheduled_for)
    except autopilot.AutopilotError as exc:
        raise HTTPException(422, str(exc)) from exc
    if when is None or when <= datetime.now(timezone.utc) + timedelta(minutes=2):
        raise HTTPException(422, "Choose a time in the future. To post at once, use Post now.")
    from ..services import post_image_host
    if (why := post_image_host.hosting_problem(db, b, p.image_url)):
        raise HTTPException(409, why)
    task = _post_task(db, b, p.id, ("scheduled",))
    if task:  # a new time replaces the old one: back to waiting, then approved for the new time
        d = {k: v for k, v in (task.detail or {}).items() if k not in ("approved_by", "approved_at")}
        task.detail, task.status, task.decided_by, task.decided_at = d, "pending", None, None
    else:
        task = _post_task(db, b, p.id, ("pending",)) or agent._task(db, b, "gbp", "gbp_post", f"Post: {p.body[:60]}…", "Medium", post_id=p.id, body=p.body)
    db.commit()
    try:
        autopilot.approve(db, b, task, user.name, publish_at=when)
    except autopilot.AutopilotError as exc:
        raise HTTPException(422, str(exc)) from exc
    db.refresh(p)
    return row(p)


@router.post("/posts/{post_id}/unschedule")
def unschedule_post(post_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Take a scheduled post back to a draft: nothing is sent."""
    p = db.get(Post, post_id)
    if not p or p.business_id != b.id:
        raise HTTPException(404, "Post not found")
    task = _post_task(db, b, p.id, ("scheduled",))
    if not task:
        raise HTTPException(409, "This post is not scheduled.")
    d = {k: v for k, v in (task.detail or {}).items() if k not in ("approved_by", "approved_at", "publish_at")}
    task.detail, task.status, task.decided_by, task.decided_at = d, "pending", None, None
    p.status, p.approved_at, p.approved_by, p.scheduled_for = "draft", None, None, None
    log(db, user.name, "post_unscheduled", b.id, post_id=p.id)
    db.commit()
    return row(p)


@router.post("/posts/draft")
def draft_post(topic: str = "", b: Business = Depends(get_business), db: Session = Depends(get_db)):
    if not ai.is_configured():
        raise HTTPException(503, "AI is not set up on the SEO platform.")
    t = agent.draft_weekly_post(db, b, topic)
    return row(t)


class ComposeIn(BaseModel):
    topic: str = ""
    post_type: str = "Update"
    what: str = "all"  # all | text | hashtags


def _clean_tags(tags, limit: int = 8) -> list[str]:
    out: list[str] = []
    for t in tags or []:
        t = "".join(ch for ch in str(t).replace("#", "").strip().replace(" ", "") if ch.isalnum() or ch == "_")
        if t and f"#{t}" not in out:
            out.append(f"#{t}")
    return out[:limit]


@router.post("/posts/compose")
def compose_post(body: ComposeIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """AI text and hashtags for one post, grounded in the profile. Nothing is saved: the editor shows it for a person to check."""
    if not ai.is_configured():
        raise HTTPException(503, "AI is not set up on the SEO platform.")
    release_connection(db)  # nothing more is read from the database: no connection is held while the AI writes
    kind = body.post_type if body.post_type in ("Update", "Offer", "Event") else "Update"
    out = ai.complete_json(
        f"You write Google Business Profile posts.\n{ai.RULES}\n- Do not put hashtags inside the text; return them separately.",
        f"Business profile:\n{ai.profile_text(b)}\n\nWrite one {kind} post{' about: ' + body.topic.strip() if body.topic.strip() else ' about one main service'}. "
        "Friendly, specific, 400 to 900 characters, short paragraphs, end with a clear next step. "
        "Also give 5 to 8 relevant hashtags (local area, service, category), no spaces inside a hashtag. "
        'Return JSON {"title": string, "body": string, "hashtags": [string]}.')
    return {"title": (out.get("title") or "")[:90], "body": str(out.get("body", ""))[:1200], "hashtags": _clean_tags(out.get("hashtags"))}


class PostImageIn(BaseModel):
    title: str | None = None
    body: str | None = None
    post_type: str = "Update"
    style: str | None = None
    coupon_code: str | None = None
    starts_on: str | None = None
    ends_on: str | None = None
    start_time: str | None = None


@router.post("/posts/image")
def post_image(body: PostImageIn, b: Business = Depends(get_business)):
    """A 1200 x 900 picture made from the post's own words (Google's recommended size). Nothing is saved or sent: the editor shows it, and attaches it only when the person accepts it."""
    import base64
    from ..services import post_image as pi
    if not (body.title or body.body or "").strip():
        raise HTTPException(422, "Write the post first: the picture is made from its words.")
    kind = body.post_type if body.post_type in ("Update", "Offer", "Event") else "Update"
    data = pi.for_business(b, title=body.title, body=body.body, post_type=kind, style=body.style, coupon=body.coupon_code, starts_on=body.starts_on, ends_on=body.ends_on, start_time=body.start_time)
    return {"width": pi.W, "height": pi.H, "size": len(data), "style": pi.pick_style(b.name or "", body.style), "styles": list(pi.STYLES), "content_type": "image/jpeg",
            "image_base64": base64.b64encode(data).decode()}


@router.delete("/posts/{post_id}", status_code=204)
def delete_post(post_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    p = db.get(Post, post_id)
    if not p or p.business_id != b.id:
        raise HTTPException(404, "Post not found")
    from ..services import autopilot
    autopilot.cancel_for_post(db, p.id)  # its approval card goes with it
    db.delete(p)
    db.commit()


# AI description
@router.post("/ai/description")
def ai_description(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Draft a 600-750 character GBP description from the profile (nothing invented). Not saved."""
    if not ai.is_configured():
        raise HTTPException(503, "AI is not set up on the SEO platform.")
    release_connection(db)  # nothing more is read from the database: no connection is held while the AI writes
    text = ai.complete(f"You write Google Business Profile descriptions for local businesses.\n{ai.RULES}",
                       f"Business profile:\n{ai.profile_text(b)}\n\nWrite a 600-750 character description: what the business does and where, "
                       "main services and who they serve, what makes them different (only if given). "
                       "No URLs, phone numbers, prices or promotions. Return only the text.",
                       max_tokens=500)
    return {"text": gbp.plain_description(text)[:750]}


DAY_NAMES = {"MONDAY": "Monday", "TUESDAY": "Tuesday", "WEDNESDAY": "Wednesday", "THURSDAY": "Thursday", "FRIDAY": "Friday", "SATURDAY": "Saturday", "SUNDAY": "Sunday"}


def _hours_text(hours: dict | None) -> str:
    """Opening hours in words, from the stored periods ("Monday 09:00-19:00, …")."""
    t = lambda o: f"{(o or {}).get('hours', 0):02d}:{(o or {}).get('minutes', 0):02d}"  # noqa: E731
    return ", ".join(f"{DAY_NAMES.get(p.get('openDay'), p.get('openDay'))} {t(p.get('openTime'))}-{t(p.get('closeTime'))}" for p in (hours or {}).get("periods") or [])


def rule_faqs(b: Business) -> list[dict[str, str]]:
    """FAQs answered only from what the profile holds; a question is left out when its answer isn't known."""
    place = ", ".join(x for x in [b.address or b.area, b.city] if x)
    services = [s.get("name") for s in (b.services or []) if s.get("name")]
    hours = _hours_text(b.hours)
    out = []
    if place:
        out.append({"q": f"Where is {b.name} located?", "a": f"{b.name} is at {place}."})
    if hours:
        out.append({"q": f"What are {b.name}'s opening hours?", "a": f"We're open {hours}."})
    if services:
        out.append({"q": "What services do you offer?", "a": f"We offer {', '.join(services[:8])}."})
    if b.booking_url or b.phone:
        out.append({"q": "How can I book an appointment?", "a": f"{'Book online on our website' if b.booking_url else 'Call us'}{f' or call {b.phone}' if b.booking_url and b.phone else f' on {b.phone}' if b.phone else ''}."})
    if b.area or b.service_area:
        out.append({"q": f"Do you serve customers near {b.area or b.city}?", "a": f"Yes. We serve {b.service_area or f'{b.area} and nearby areas' + (f' in {b.city}' if b.city else '')}."})
    return out


@router.post("/ai/faqs")
def ai_faqs(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Draft FAQs for the website and Google Q&A from the profile (nothing invented). Not saved.
    AI-written with a key; otherwise template answers built only from the profile's facts."""
    base = rule_faqs(b)
    if not ai.is_configured():
        return {"source": "rules", "faqs": base}
    release_connection(db)  # nothing more is read from the database: no connection is held while the AI writes
    try:
        out = ai.complete_json(f"You write FAQs for a local business website and its Google Q&A.\n{ai.RULES}\n- Answer only from the facts given; skip a question rather than guess.",
                               f"Business profile:\n{ai.profile_text(b)}\nOpening hours: {_hours_text(b.hours) or 'not given'}\nBooking: {b.booking_url or b.phone or 'not given'}\n\n"
                               'Return JSON {"faqs": [{"q": "a question customers really ask", "a": "a 1-3 sentence answer"}]} with 5-7 items.', temperature=0.4, max_tokens=1200)
        faqs = [{"q": str(f.get("q", "")).strip()[:200], "a": str(f.get("a", "")).strip()[:600]} for f in out.get("faqs") or [] if isinstance(f, dict) and f.get("q") and f.get("a")]
        return {"source": "ai", "faqs": faqs[:8]} if faqs else {"source": "rules", "faqs": base}
    except Exception:
        return {"source": "rules", "faqs": base}


# Reviews
@router.get("/reviews")
def list_reviews(b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    access.require(db, user, b, "gmb")  # Google reviews: only once the project's Google access is complete
    every = list(db.scalars(select(Review).where(Review.business_id == b.id).order_by(Review.review_date.desc().nullslast())))
    found = [r for r in every if not r.gone_at]  # a review Google no longer lists is shown, but is not counted
    n = len(found)
    topics: dict[str, int] = {}
    for r in found:
        for t in r.topics or []:
            topics[t] = topics.get(t, 0) + 1
    return {
        "reviews": rows(found) + rows([r for r in every if r.gone_at]),
        "summary": {
            "not_on_google": len(every) - n,
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
    release_connection(db)  # the review is read: no connection is held while the AI writes the reply (it is saved below)
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
    if task.status == "failed":  # Google refused it: say so instead of reporting a posted reply
        err = (task.result or {}).get("error") or "unknown error"
        raise HTTPException(502, err if err.startswith("This review") else f"Google did not accept the reply, so it was not posted: {err}")
    return row(r) | {"task": row(task)}
