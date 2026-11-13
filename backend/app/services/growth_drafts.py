"""AI drafts for fix tasks, written for a person to approve. Nothing here publishes or changes anything on Google or on the website.

A draft is made from the business profile and the task's own keywords, with the platform's rules (no invented prices, awards, statistics, addresses or reviews). Each draft is checked afterwards:
lengths are cut to what the place allows and the keywords it was asked to use are checked in the text, so the page can say honestly which ones made it in.
Only a Google post draft can be saved into the software (as a draft post); the others are for copying into the website, the profile or the blog studio.
"""
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, GrowthAction, Post
from . import ai
from .growth_content import _corpus, core, has_keyword, _main_keywords, tracked

KIND_BY_KEY = {"fix.kw.use.website": "meta", "fix.kw.use.profile": "profile", "fix.kw.use.posts": "post", "fix.kw.use.blog": "blog", "fix.blog.none": "blog",
               "fix.xray.title": "meta", "fix.xray.description": "meta", "fix.site.meta.title_missing": "meta", "fix.site.meta.title_length": "meta", "fix.site.meta.title_duplicate": "meta",
               "fix.site.meta.desc_missing": "meta", "fix.site.meta.desc_length": "meta", "fix.site.meta.desc_duplicate": "meta"}
FACTS = ("Use only facts that appear in the business profile. Never invent prices, discounts, awards, years in business, statistics, customer names, reviews, addresses or phone numbers. "
         "Write for people first; use each keyword naturally once, never repeat it to stuff. Plain English, no hype words like 'best in the world'.")


class DraftError(Exception):
    pass


def kind_of(a: GrowthAction) -> str | None:
    if a.key.startswith("fix.kw.use."):  # per-topic keys carry a suffix: fix.kw.use.posts.lehenga
        return KIND_BY_KEY.get(".".join(a.key.split(".")[:4])) or {"services": "profile"}.get(a.key.split(".")[3])
    return KIND_BY_KEY.get(a.key)


def _keywords(db: Session, b: Business, a: GrowthAction) -> list[str]:
    given = (a.verify or {}).get("keywords")
    if given:
        return [k for k in given if isinstance(k, str)][:4]
    return _main_keywords(b, tracked(db, b), 3)


def _cut(text: Any, n: int) -> str:
    t = " ".join(str(text or "").split())
    return t if len(t) <= n else t[: n - 1].rsplit(" ", 1)[0].rstrip(",.;:- ") + "…"


def _page_for_meta(a: GrowthAction, b: Business) -> str:
    rule_url = (a.link or "")
    if "url=" in rule_url:
        from urllib.parse import parse_qs, urlsplit
        got = parse_qs(urlsplit(rule_url).query).get("url")
        if got:
            return got[0]
    return b.website or ""


def build(db: Session, b: Business, a: GrowthAction) -> dict[str, Any]:
    """Write the draft (one AI call) and check it. Raises DraftError when AI is not set up or the answer is unusable."""
    kind = kind_of(a)
    if kind is None:
        raise DraftError("This task has no draft: it is a step only you can do.")
    if not ai.is_configured():
        raise DraftError("AI is not set up on this server (no AI key), so no draft can be written.")
    kws = _keywords(db, b, a)
    if not kws:
        raise DraftError("There is no keyword to write for yet: track some keywords first.")
    profile = ai.profile_text(b)
    system = f"You write search-optimised content for a local business.\n{ai.RULES}\n{FACTS}"
    kw_line = "Keywords to use: " + ", ".join(f"“{k}”" for k in kws)
    if kind == "meta":
        page = _page_for_meta(a, b)
        user = (f"Business profile:\n{profile}\n\nPage: {page}\n{kw_line}\n\nWrite the page's SEO title (30 to 60 characters), meta description (110 to 155 characters, ends with a reason to click) and one H1. "
                'Return JSON {"title": "", "description": "", "h1": ""}.')
        limits = {"title": 60, "description": 160, "h1": 90}
    elif kind == "profile":
        user = (f"Business profile:\n{profile}\n\n{kw_line}\n\nWrite a Google Business Profile description (600 to 740 characters, no links, no phone numbers, no promotions) and up to 4 service names with a one-sentence description each, "
                'using the keywords naturally. Never put keywords in the business name. Return JSON {"description": "", "services": [{"name": "", "description": ""}]}.')
        limits = {"description": 750}
    elif kind == "post":
        user = (f"Business profile:\n{profile}\n\n{kw_line}\n\nWrite one Google Business Profile Update post, 120 to 300 words at most 1200 characters, about the service, with a helpful tone and a clear call to action. "
                'Return JSON {"title": "", "body": "", "cta_type": "BOOK"|"LEARN_MORE"|"CALL"}.')
        limits = {"title": 90, "body": 1200}
    else:
        user = (f"Business profile:\n{profile}\n\n{kw_line}\n\nPlan one helpful blog article for customers: a title (under 65 characters), a meta description (110 to 155 characters), a 2 sentence intro and 5 to 7 section headings (some as customer questions). "
                'Return JSON {"title": "", "meta_description": "", "intro": "", "headings": [""]}.')
        limits = {"title": 70, "meta_description": 160, "intro": 500}
    try:
        data = ai.complete_json(system, user, max_tokens=900)
    except Exception as exc:  # noqa: BLE001 - the provider chain already retried; say why in words
        raise DraftError(f"The AI service did not answer ({type(exc).__name__}). Try again in a moment.") from exc
    if not isinstance(data, dict) or not data:
        raise DraftError("The AI answer could not be read. Try again.")
    clean: dict[str, Any] = {}
    for k, v in data.items():
        if k in limits:
            clean[k] = _cut(v, limits[k])
        elif k == "headings" and isinstance(v, list):
            clean[k] = [_cut(x, 120) for x in v if str(x).strip()][:8]
        elif k == "services" and isinstance(v, list):
            clean[k] = [{"name": _cut(x.get("name"), 80), "description": _cut(x.get("description"), 300)} for x in v if isinstance(x, dict) and str(x.get("name") or "").strip()][:4]
        elif k == "cta_type" and v in ("BOOK", "LEARN_MORE", "CALL"):
            clean[k] = v
    main_field = {"meta": "title", "profile": "description", "post": "body", "blog": "title"}[kind]
    if not clean.get(main_field):
        raise DraftError("The AI answer was empty. Try again.")
    text = " ".join(str(v) if not isinstance(v, (list, dict)) else repr(v) for v in clean.values())
    corpus = _corpus([text])
    used = {k: has_keyword(corpus, k) for k in kws}
    return {"kind": kind, "data": clean, "keywords": kws, "keyword_used": used, "page": _page_for_meta(a, b) if kind == "meta" else None,
            "generated_at": datetime.now(timezone.utc).isoformat(), "applied": None, "model_note": "Written by AI from your profile. Read it, correct any fact, then use it."}


def save(db: Session, b: Business, a: GrowthAction) -> dict[str, Any]:
    d = build(db, b, a)
    a.evidence = {**(a.evidence or {}), "draft": d}
    db.add(a)
    db.flush()
    return d


def apply_post(db: Session, b: Business, a: GrowthAction) -> Post:
    """Save a post draft as a DRAFT post in Google Posts (not published). Once only."""
    d = (a.evidence or {}).get("draft")
    if not d or d.get("kind") != "post":
        raise DraftError("This task has no post draft to save.")
    if d.get("applied"):
        raise DraftError("This draft was already saved as a post draft.")
    body = (d["data"].get("body") or "").strip()
    if not body:
        raise DraftError("The draft has no text.")
    post = Post(business_id=b.id, post_type="Update", title=d["data"].get("title") or None, body=body[:1500], cta_type=d["data"].get("cta_type"), cta_url=b.booking_url or b.website, status="draft", ai_generated=True)
    db.add(post)
    db.flush()
    d["applied"] = {"post_id": post.id, "at": datetime.now(timezone.utc).isoformat()}
    a.evidence = {**(a.evidence or {}), "draft": d}
    db.add(a)
    db.flush()
    return post


def prefill(db: Session, b: Business, limit: int = 4) -> int:
    """Write drafts for the first open fix tasks that can have one and have none yet (used by Start plan). Stops on the first AI failure."""
    if not ai.is_configured():
        return 0
    n = 0
    rows = db.scalars(select(GrowthAction).where(GrowthAction.business_id == b.id, GrowthAction.period == "fix", GrowthAction.status.in_(("todo", "unverified", "failed"))).order_by(GrowthAction.due_on, GrowthAction.id))
    for a in rows:
        if n >= limit:
            break
        if kind_of(a) is None or (a.evidence or {}).get("draft"):
            continue
        try:
            save(db, b, a)
            n += 1
        except DraftError:
            break
    return n
