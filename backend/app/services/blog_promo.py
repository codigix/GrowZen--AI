"""After a blog is published: where to promote it, a short overview of it to post there with its link, and a check that the posted link really works.

Nothing is posted for the user: their accounts on other sites are theirs. This module suggests places (a fixed list of well-known platforms with the page to open,
chosen by what fits the business), writes a platform-sized overview that contains the blog's real link (AI when a key is set, plain text from the article otherwise),
and, once the user pastes the address of the page they posted on, checks that page for a link to the blog with the same checker as the Backlink Checker
(working or not, follow or nofollow, the anchor)."""
from __future__ import annotations

import html
import logging
import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Article, BlogPromotion, Business
from . import ai
from . import backlink_checker as bc

log = logging.getLogger("seo.blog_promo")
STATUSES = ("planned", "posted", "verified", "problem", "skipped")

# key: (name, kind, page to open, max characters of the post, who it suits (regex on the business description, "" = everyone), what it gives, what to expect from the link)
CATALOG: dict[str, dict[str, Any]] = {
    "gbp": {"name": "Google Business Profile post", "kind": "own", "open": "/google-posts", "internal": True, "max": 1500, "fits": "", "gives": "Shows on your Google listing and in Maps, where local customers look.", "link": "Not a backlink you can check here: a link on your own Google profile."},
    "linkedin": {"name": "LinkedIn", "kind": "social", "open": "https://www.linkedin.com/feed/", "max": 1300, "fits": "", "gives": "Reaches professionals and local businesses you may know.", "link": "Usually nofollow: it brings visitors and visibility, little ranking value."},
    "facebook": {"name": "Facebook page", "kind": "social", "open": "https://www.facebook.com/", "max": 800, "fits": "", "gives": "Reaches existing followers and local groups.", "link": "Nofollow: visitors and visibility."},
    "x": {"name": "X (Twitter)", "kind": "social", "open": "https://x.com/compose/post", "max": 250, "fits": "", "gives": "Quick visibility and a place for industry conversations.", "link": "Nofollow."},
    "medium": {"name": "Medium", "kind": "blog", "open": "https://medium.com/new-story", "max": 2500, "fits": "", "gives": "A new audience that reads long articles: publish a short version and link to the full blog.", "link": "Usually nofollow; keep the version different from your blog so it is not a duplicate."},
    "quora": {"name": "Quora", "kind": "forum", "open": "https://www.quora.com/", "max": 1200, "fits": "", "gives": "Reaches people asking the very questions your blog answers.", "link": "Nofollow. Answer the question properly first; add the link only where it helps."},
    "reddit": {"name": "Reddit (a relevant community)", "kind": "forum", "open": "https://www.reddit.com/submit", "max": 1200, "fits": "", "gives": "Discussion with people who care about the topic.", "link": "Nofollow. Read the community's rules first: many ban self-promotion."},
    "tumblr": {"name": "Tumblr", "kind": "blog", "open": "https://www.tumblr.com/new/link", "max": 1000, "fits": "", "gives": "A short post with the link and an image.", "link": "Varies: the check shows the real follow type."},
    "blogger": {"name": "Blogger", "kind": "blog", "open": "https://www.blogger.com/", "max": 2000, "fits": "", "gives": "A short summary post on a blog you own.", "link": "Varies: the check shows the real follow type."},
    "flipboard": {"name": "Flipboard", "kind": "blog", "open": "https://flipboard.com/", "max": 500, "fits": "", "gives": "Your article appears in a magazine people follow.", "link": "Varies: the check shows the real follow type."},
    "pinterest": {"name": "Pinterest", "kind": "social", "open": "https://www.pinterest.com/pin-builder/", "max": 500, "fits": r"decor|interior|fashion|jewel|saree|lehenga|food|restaurant|cafe|bak|wedding|beauty|salon|travel|kitchen|furniture|garden|craft|gift|rental", "gives": "Visual search: the blog's image can keep sending visitors for months.", "link": "Nofollow, but pins last."},
    "devto": {"name": "DEV Community", "kind": "blog", "open": "https://dev.to/new", "max": 3000, "fits": r"software|web ?(design|development)|app|saas|it solution|digital|marketing agency|developer|seo|technology|cloud", "gives": "Developers and tech buyers read it.", "link": "Can pass a normal link; the canonical setting avoids duplicate content."},
    "hashnode": {"name": "Hashnode", "kind": "blog", "open": "https://hashnode.com/", "max": 3000, "fits": r"software|web ?(design|development)|app|saas|it solution|digital|developer|seo|technology|cloud", "gives": "A tech audience and a canonical link back to you.", "link": "Varies: the check shows the real follow type."},
}


def _ctx(b: Business) -> str:
    return " ".join(x for x in [b.name, b.primary_category, " ".join(b.secondary_categories or []), b.description or ""] if x).lower()


def published_url(db: Session, a: Article) -> str | None:
    """The live address of the blog: where it was published (WordPress, React, a Git or HTML site)."""
    from ..models import ScheduledPost
    if a.wp_url and (a.wp_status or "publish") in ("publish", "published"):
        return a.wp_url
    if a.react_url and a.react_status in ("publish", "published"):
        return a.react_url
    p = db.scalar(select(ScheduledPost).where(ScheduledPost.article_id == a.id, ScheduledPost.status == "published").order_by(ScheduledPost.id.desc()).limit(1))
    url = (p.result or {}).get("url") if p else None
    return url or None


def fits(b: Business, key: str) -> bool:
    pat = CATALOG[key]["fits"]
    return not pat or bool(re.search(pat, _ctx(b)))


def create_plan(db: Session, b: Business, a: Article) -> list[BlogPromotion]:
    """One row per suitable platform (idempotent: a platform already in the plan is left as it is)."""
    have = {r.platform for r in db.scalars(select(BlogPromotion).where(BlogPromotion.article_id == a.id))}
    for key, c in CATALOG.items():
        if key in have or not fits(b, key):
            continue
        db.add(BlogPromotion(business_id=b.id, article_id=a.id, platform=key, name=c["name"], open_url=c["open"], status="planned"))
    db.commit()
    return list(db.scalars(select(BlogPromotion).where(BlogPromotion.article_id == a.id).order_by(BlogPromotion.id)))


def add_custom(db: Session, b: Business, a: Article, name: str, url: str | None) -> BlogPromotion:
    name = " ".join(name.split())[:120]
    if len(name) < 2:
        raise ValueError("Enter the name of the site.")
    key = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:60] or "site"
    row = db.scalar(select(BlogPromotion).where(BlogPromotion.article_id == a.id, BlogPromotion.platform == key))
    if row is None:
        link = None
        if url:
            link = url.strip() if re.match(r"^https?://", url.strip(), re.I) else f"https://{url.strip()}"
            try:
                bc.validate_url_shape(link)
            except Exception:  # noqa: BLE001
                raise ValueError("That is not a valid address.") from None
        row = BlogPromotion(business_id=b.id, article_id=a.id, platform=key, name=name, open_url=link, status="planned")
        db.add(row)
        db.commit()
    return row


# ------------------------------------------------------------------------------------------------------------------------ the overview to post
def _plain(a: Article) -> str:
    text = re.sub(r"(?is)<(script|style).*?</\1>", " ", a.body or "")
    text = re.sub(r"<[^>]+>", " ", text)
    return " ".join(html.unescape(text).split())


def _first_sentences(text: str, n: int, limit: int) -> str:
    parts = re.split(r"(?<=[.!?])\s+", text)
    out = " ".join(parts[:n]).strip()
    return out[:limit].rsplit(" ", 1)[0] + "…" if len(out) > limit else out


def _rule_overview(b: Business, a: Article, url: str, limit: int) -> dict[str, Any]:
    title = a.title or a.topic or a.keyword
    intro = a.meta_description or _first_sentences(_plain(a), 2, 300)
    tags = ["#" + re.sub(r"[^a-z0-9]", "", w.lower()) for w in [a.keyword.replace(" ", ""), (b.city or "")] if w][:3]
    tail = f"\n\nRead the full article: {url}"
    body = f"{title}\n\n{intro}"
    room = max(40, limit - len(tail) - 2)
    if len(body) > room:
        body = body[:room].rsplit(" ", 1)[0] + "…"
    return {"text": body + tail, "hashtags": tags, "method": "rules"}


SYSTEM = ai.RULES + """
You write a short overview of a blog article for posting on another platform, using ONLY the article's facts. It must read like a person wrote it for that platform,
make the reader want to open the article, and never exaggerate. Do not include the link: it is added for you. No hashtags inside the text.
Return JSON: {"text": "the overview", "hashtags": ["#one", "#two"]} with 2-3 hashtags."""


def overview(db: Session, b: Business, a: Article, promo: BlogPromotion, force: bool = False) -> dict[str, Any]:
    if promo.overview and not force:
        return promo.overview
    url = published_url(db, a)
    if not url:
        raise ValueError("Publish the blog first: the overview needs its live link.")
    limit = int(CATALOG.get(promo.platform, {}).get("max", 1000))
    result = _rule_overview(b, a, url, limit)
    if ai.is_configured():
        kind = CATALOG.get(promo.platform, {}).get("kind", "blog")
        facts = f"Business: {b.name} ({b.primary_category or 'business'}{', ' + b.city if b.city else ''}).\nArticle title: {a.title}\nMeta description: {a.meta_description or ''}\nMain keyword: {a.keyword}\nArticle text (start): {_plain(a)[:2500]}"
        budget = max(60, limit - len(url) - 40)
        try:
            out = ai.complete_json(SYSTEM, f"{facts}\n\nPlatform: {promo.name} ({kind}). Maximum {budget} characters for the text.", max_tokens=700)
            text = str(out.get("text", "")).strip()
            if text:
                text = text[:budget].rsplit(" ", 1)[0] if len(text) > budget else text
                tags = [str(t) for t in out.get("hashtags", []) if str(t).startswith("#")][:3]
                result = {"text": f"{text}\n\nRead the full article: {url}", "hashtags": tags, "method": "ai"}
        except (ai.AiUnavailable, ValueError) as exc:
            log.warning("AI overview failed, using the article text: %s", exc)
    promo.overview = result
    db.add(promo)
    db.commit()
    return result


# ------------------------------------------------------------------------------------------------------------------------ posted: check the link
def _clean_url(raw: str) -> str:
    u = (raw or "").strip()
    u = u if re.match(r"^https?://", u, re.I) else f"https://{u}"
    from urllib.parse import urlsplit
    host = urlsplit(u).hostname or ""
    if re.search(r"\s", u) or "." not in host:
        raise ValueError("Paste the full address of the page you posted on.")
    bc.validate_url_shape(u)
    return u


def mark_posted(db: Session, promo: BlogPromotion, posted_url: str) -> BlogPromotion:
    try:
        u = _clean_url(posted_url)
    except ValueError:
        raise
    except Exception:  # noqa: BLE001
        raise ValueError("Paste the full address of the page you posted on.") from None
    promo.posted_url, promo.status, promo.posted_at, promo.check = u[:800], "posted", datetime.now(timezone.utc), None
    db.add(promo)
    db.commit()
    return promo


def check(db: Session, promo: BlogPromotion, article_url: str) -> BlogPromotion:
    """Open the page the user posted on and look for the blog's link: verified when it is there, problem when it is not."""
    if not promo.posted_url:
        raise ValueError("Paste the address of the page you posted on first.")
    res = bc.check_one(promo.posted_url, bc.target_of(article_url))
    link = res.get("link") or {}
    promo.check = {"state": res["state"], "follow": res.get("follow"), "http_status": res.get("http_status"), "anchor": link.get("anchor") if isinstance(link, dict) else None,
                   "error": res.get("error"), "checked_at": res.get("checked_at")}
    promo.status = "verified" if res["state"] == "working" else "problem" if res["state"] in ("link_missing", "page_error") else "posted"  # cannot confirm: stays posted
    promo.checked_at = datetime.now(timezone.utc)
    db.add(promo)
    db.commit()
    return promo


def view(db: Session, p: BlogPromotion) -> dict[str, Any]:
    c = CATALOG.get(p.platform, {})
    return {"id": p.id, "platform": p.platform, "name": p.name, "kind": c.get("kind", "site"), "open_url": p.open_url, "internal": bool(c.get("internal")), "status": p.status, "posted_url": p.posted_url,
            "gives": c.get("gives"), "link_note": c.get("link"), "has_overview": bool(p.overview), "check": p.check, "posted_at": p.posted_at.isoformat() if p.posted_at else None,
            "checked_at": p.checked_at.isoformat() if p.checked_at else None, "max_chars": c.get("max")}


def status(db: Session, b: Business, a: Article) -> dict[str, Any]:
    url = published_url(db, a)
    rows = list(db.scalars(select(BlogPromotion).where(BlogPromotion.article_id == a.id).order_by(BlogPromotion.id)))
    counts = {s: sum(1 for r in rows if r.status == s) for s in STATUSES}
    return {"published": bool(url), "url": url, "title": a.title, "items": [view(db, r) for r in rows], "counts": counts}
