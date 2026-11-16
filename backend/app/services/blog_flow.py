"""The blog workflow around the writer: pick keywords -> topics from them -> (write) -> check the site's blog layout -> schedule with a task for that day ->
after publishing, promote it (services/blog_promo.py).

- keyword_pool: the project's tracked keywords with their volume and how many articles already use each.
- topics: blog topics for the chosen keywords (AI when a key is set, plain patterns otherwise); each says which keyword it serves and why.
- layout_check: opens the website's own blog listing page and one of its posts and reports how they are built (what a post shows, how long they are), then how
  the article being written compares. Read only. Publishing itself uses the site's own template (see html_publisher / WordPress theme).
- tasks: a Growth Plan task on the day a blog is scheduled, and one to promote it once it is live."""
from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Article, Business, GrowthAction, Keyword
from . import ai
from . import backlink_checker as bc

log = logging.getLogger("seo.blog_flow")


# ------------------------------------------------------------------------------------------------------------------------ keywords
def keyword_pool(db: Session, b: Business) -> list[dict[str, Any]]:
    used: dict[str, int] = {}
    for a in db.scalars(select(Article).where(Article.business_id == b.id, Article.status.in_(("completed", "generating", "pending")))):
        for k in [a.keyword, *(a.secondary_keywords or [])]:
            used[" ".join(str(k).lower().split())] = used.get(" ".join(str(k).lower().split()), 0) + 1
    rows = db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True))).all()
    rows = sorted(rows, key=lambda k: ("blog" not in (k.uses or []), -(k.volume or 0)))
    return [{"keyword": k.keyword, "volume": k.volume, "difficulty": k.difficulty, "intent": k.intent, "cluster": k.cluster, "rank": k.rank, "for_blog": "blog" in (k.uses or []), "used": used.get(" ".join(k.keyword.lower().split()), 0)} for k in rows]


# ------------------------------------------------------------------------------------------------------------------------ topics
SYSTEM = ai.RULES + """
You plan blog topics for a small business. For the chosen keywords, propose topics people would really search for and that the business can answer from its own knowledge.
Return JSON: {"topics": [{"title": "a clear blog title", "keyword": "the one chosen keyword it serves", "angle": "one sentence on what the article covers",
"intent": "informational|commercial|local|how-to", "why": "one sentence on why it helps this business"}]} with 6 to 8 topics, each serving one of the chosen keywords.
Titles must not promise results or invent facts, awards or prices."""


def _rule_topics(b: Business, keywords: list[str]) -> list[dict[str, Any]]:
    city = (b.city or "").strip()
    out = []
    for kw in keywords[:4]:
        low = kw.lower()
        place = f" in {city}" if city and city.lower() not in low else ""
        out += [{"title": f"{kw.title()}{place}: what to know before you decide", "keyword": kw, "angle": f"A plain guide to {kw}: who needs it, what to look for, what to ask.", "intent": "informational", "why": "Answers the question a customer asks first."},
                {"title": f"How much does {kw} cost{place}?", "keyword": kw, "angle": "What changes the price and how to compare options fairly (no invented prices).", "intent": "commercial", "why": "Reaches people close to deciding."}]
    return out[:8]


def topics(db: Session, b: Business, keywords: list[str]) -> dict[str, Any]:
    kws = [" ".join(k.lower().split()) for k in keywords if k.strip()][:6]
    if not kws:
        raise ValueError("Choose at least one keyword.")
    taken = {" ".join((a.topic or a.title or "").lower().split()) for a in db.scalars(select(Article).where(Article.business_id == b.id))}
    method, items = "rules", _rule_topics(b, kws)
    if ai.is_configured():
        try:
            ctx = " | ".join(x for x in [b.name, b.primary_category, ", ".join(s.get("name", "") for s in (b.services or []) if s.get("name")), b.city] if x)[:500]
            out = ai.complete_json(SYSTEM, f"Business: {ctx}\nChosen keywords: {kws}\nExisting article topics (do not repeat): {sorted(t for t in taken if t)[:20]}", max_tokens=1400)
            got = []
            for t in out.get("topics", []) if isinstance(out, dict) else []:
                try:
                    title, kw, angle, why = str(t["title"]).strip(), " ".join(str(t["keyword"]).lower().split()), str(t["angle"]).strip(), str(t["why"]).strip()
                except (KeyError, TypeError):
                    continue
                if title and angle and why and kw in kws:
                    got.append({"title": title[:200], "keyword": kw, "angle": angle[:300], "intent": str(t.get("intent", "informational"))[:20], "why": why[:300]})
            if got:
                method, items = "ai", got[:8]
        except (ai.AiUnavailable, ValueError) as exc:
            log.warning("AI topics failed, using patterns: %s", exc)
    items = [t for t in items if " ".join(t["title"].lower().split()) not in taken]
    return {"method": method, "keywords": kws, "topics": items}


# ------------------------------------------------------------------------------------------------------------------------ the site's blog layout
BLOG_PATH = re.compile(r"/(blog|blogs|news|articles|insights|journal|resources|posts?)(/|$)", re.I)


def _soup(url: str) -> tuple[BeautifulSoup | None, str | None, str | None]:
    status, html_, final, _ms, err = bc._fetch(url)
    if not html_ or (status or 0) >= 400:
        return None, final, err or f"The page answered {status}."
    return BeautifulSoup(html_, "html.parser"), final or url, None


def _words(node) -> int:
    return len(re.findall(r"\w+", node.get_text(" ", strip=True))) if node else 0


def _post_facts(soup: BeautifulSoup) -> dict[str, Any]:
    main = soup.find("article") or soup.find("main") or soup.body or soup
    text = main.get_text(" ", strip=True)
    ld = " ".join(s.get_text() for s in soup.find_all("script", type="application/ld+json"))
    heads = [h.get_text(" ", strip=True) for h in main.find_all(["h2", "h3"])]
    imgs = [i for i in main.find_all("img") if i.get("src") or i.get("data-src")]
    return {"words": len(re.findall(r"\w+", text)), "h2": len(main.find_all("h2")), "h3": len(main.find_all("h3")), "images": len(imgs), "featured_image": bool(imgs),
            "date": bool(main.find("time") or re.search(r"\b(20\d\d|19\d\d)\b", text[:600])), "author": bool(soup.find(attrs={"rel": "author"}) or re.search(r"\bby\s+[A-Z]", text[:400]) or soup.find(class_=re.compile("author", re.I))),
            "toc": bool(re.search(r"table of contents|in this article|on this page", text[:3000], re.I) or main.find(class_=re.compile(r"toc|table-of-contents", re.I))),
            "faq": bool(re.search(r"faq|frequently asked", " ".join(heads), re.I) or "FAQPage" in ld), "schema": [t for t in ("BlogPosting", "Article", "FAQPage", "BreadcrumbList") if t in ld],
            "cta": bool(main.find(["button"]) or main.find("a", class_=re.compile(r"btn|button|cta", re.I)) or re.search(r"contact us|book (a|an|your)|call us|get a quote|enquire", text, re.I)),
            "related": bool(re.search(r"related (posts|articles|reading)|you may also like|read more", text, re.I)), "internal_links": len([a for a in main.find_all("a", href=True) if a["href"].startswith(("/", "#")) or urlsplit(a["href"]).netloc == ""])}


def layout_check(db: Session, b: Business, article: Article | None = None) -> dict[str, Any]:
    site = (b.website or "").strip()
    if not site:
        return {"state": "no_website", "message": "Add the website to the project first: the layout is read from its blog."}
    base = site if re.match(r"^https?://", site, re.I) else f"https://{site}"
    home, home_url, err = _soup(base)
    if home is None:
        return {"state": "unreachable", "message": f"The website could not be opened ({err}).", "site": base}
    host = urlsplit(home_url or base).netloc
    listing_url = None
    for a in home.find_all("a", href=True):
        full = urljoin(home_url or base, a["href"])
        if urlsplit(full).netloc == host and BLOG_PATH.search(urlsplit(full).path) and urlsplit(full).path.rstrip("/").count("/") <= 1:
            listing_url = full.split("#")[0]
            break
    if not listing_url:
        return {"state": "no_blog", "message": "No blog page was found from the home page (a link to /blog, /news, /articles...). Publish the first article and the site will get one, or add the link.", "site": base}
    listing, listing_final, err = _soup(listing_url)
    if listing is None:
        return {"state": "no_blog", "message": f"The blog page could not be opened ({err}).", "site": base, "listing_url": listing_url}
    lpath = urlsplit(listing_final or listing_url).path.rstrip("/")
    posts: list[str] = []
    cards = 0
    for a in listing.find_all("a", href=True):
        full = urljoin(listing_final or listing_url, a["href"]).split("#")[0]
        pr = urlsplit(full)
        if pr.netloc == host and pr.path.rstrip("/").startswith(lpath) and pr.path.rstrip("/") != lpath and full not in posts and not re.search(r"/(page|category|tag|author)/", pr.path):
            posts.append(full)
    card_nodes = listing.find_all(["article", "li", "div"], class_=re.compile(r"post|card|blog|article|entry", re.I))
    cards = len([c for c in card_nodes if c.find("a", href=True) and len(c.get_text(" ", strip=True)) < 900])
    cardfacts = {"posts_found": len(posts), "cards_with_image": sum(1 for c in card_nodes[:20] if c.find("img")), "cards_with_date": sum(1 for c in card_nodes[:20] if c.find("time") or re.search(r"\b20\d\d\b", c.get_text(" ", strip=True))),
                 "cards_with_excerpt": sum(1 for c in card_nodes[:20] if len(c.get_text(" ", strip=True)) > 120), "cards_checked": min(len(card_nodes), 20)}
    sample = None
    sample_facts = None
    for p in posts[:3]:
        soup, _fin, perr = _soup(p)
        if soup is not None:
            sample, sample_facts = p, _post_facts(soup)
            break
    out: dict[str, Any] = {"state": "ok", "site": base, "listing_url": listing_final or listing_url, "listing": cardfacts, "sample_post": sample, "post": sample_facts}
    out["fit"] = _fit(article, sample_facts, cardfacts) if sample_facts else []
    out["note"] = ("When you publish, the article is placed in your site's own design: header, footer, styles and fonts come from the site, so the look matches. "
                   "This check shows what your existing posts contain, so the new one has the same parts.")
    return out


def _fit(a: Article | None, post: dict[str, Any], listing: dict[str, Any]) -> list[dict[str, Any]]:
    text = re.sub(r"<[^>]+>", " ", (a.body or "")) if a else ""
    words = len(re.findall(r"\w+", text))
    heads = len(re.findall(r"<h2", (a.body or "")) if a else [])
    have_faq = bool(a and re.search(r"faq|frequently asked", a.body or "", re.I))
    have_cta = bool(a and re.search(r"contact us|book |call us|get a quote|enquire|<a [^>]*href", a.body or "", re.I))
    rows = []

    def add(label: str, ok: bool | None, detail: str) -> None:
        rows.append({"label": label, "ok": ok, "detail": detail})
    if a:
        lo, hi = int(post["words"] * 0.6), int(post["words"] * 1.6)
        add("Length is in line with your existing posts", lo <= words <= hi or words >= post["words"], f"Yours: {words} words. The post checked on your site: about {post['words']}.")
        add("Sub-headings like your posts", heads >= max(2, min(post["h2"], 4)), f"Yours: {heads} H2. Your post: {post['h2']} H2, {post['h3']} H3.")
    if post["featured_image"] or listing.get("cards_with_image"):
        add("A featured image is set (your posts and cards show one)", bool(a and a.featured_image_path), "Add it above the article: the blog listing shows an image on each card.")
    if post["faq"]:
        add("A FAQ section (your post has one)", have_faq, "Add 3-5 real questions with short answers.")
    if post["cta"]:
        add("A contact or booking call to action (your post has one)", have_cta, "End with what the reader should do next.")
    if post["date"]:
        add("A date is shown", True, "The site adds the publish date itself.")
    if listing.get("cards_with_excerpt"):
        add("A meta description / excerpt for the card", bool(a and (a.meta_description or "").strip()), "The blog page shows a short excerpt under each title.")
    return rows


# ------------------------------------------------------------------------------------------------------------------------ Growth Plan tasks
def _local_date(b: Business, when: datetime) -> date:
    from . import localtime
    try:
        return when.astimezone(localtime.tz_of(b)).date()
    except Exception:  # noqa: BLE001
        return when.date()


def schedule_task(db: Session, b: Business, a: Article, due: datetime) -> None:
    """A task on the day the blog goes live: check that it is live and looks right. Moves with the schedule."""
    key = f"blog.publish.{a.id}"
    day = _local_date(b, due)
    row = db.scalar(select(GrowthAction).where(GrowthAction.business_id == b.id, GrowthAction.key == key, GrowthAction.status.in_(("todo", "unverified", "failed"))))
    title = f"Check the blog goes live: {a.title or a.keyword}"[:300]
    how = ["Open the blog page on your website and read it once: title, image, headings and links.", "Check it looks like your other posts (the Layout check on the blog page shows what to compare).", "Share it: the next task lists where to promote it."]
    if row is None:
        db.add(GrowthAction(business_id=b.id, target_id=None, area="seo", key=key, period="day", due_on=day, title=title, why="A scheduled blog only helps once it is really live and correct.", how=how, est_minutes=10,
                            mode="assisted", link=f"/ai-content-generation/blog?article={a.id}", verify={"type": "blog_published", "article_id": a.id}, status="todo"))
    else:
        row.due_on, row.title = day, title
        db.add(row)
    db.flush()


def cancel_task(db: Session, b: Business, a: Article) -> None:
    for row in db.scalars(select(GrowthAction).where(GrowthAction.business_id == b.id, GrowthAction.key == f"blog.publish.{a.id}", GrowthAction.status == "todo")):
        row.status, row.note = "skipped", "The schedule was cancelled."
        db.add(row)


def after_published(db: Session, b: Business, a: Article) -> None:
    """Once the blog is live: the promotion plan, and a task to do it (due the next day, in the project's time zone)."""
    from . import blog_promo
    try:
        blog_promo.create_plan(db, b, a)
        key = f"blog.promote.{a.id}"
        if not db.scalar(select(GrowthAction).where(GrowthAction.business_id == b.id, GrowthAction.key == key)):
            day = _local_date(b, datetime.now(timezone.utc) + timedelta(days=1))
            db.add(GrowthAction(business_id=b.id, target_id=None, area="seo", key=key, period="day", due_on=day, title=f"Promote the blog on 3 platforms: {a.title or a.keyword}"[:300],
                                why="A new blog needs visitors and links: a short overview with its link on other platforms brings both.", est_minutes=30, mode="assisted",
                                how=["Open the blog's Promote step and pick three platforms.", "Copy the overview written for each one and post it with the blog link.", "Paste the address of each post; the software checks the link."],
                                link=f"/ai-content-generation/blog?article={a.id}", verify={"type": "blog_promo", "article_id": a.id, "min": 3}, status="todo"))
        db.commit()
    except Exception:  # noqa: BLE001 - a task or plan problem must never fail a publish
        db.rollback()
        log.exception("Could not set up the promotion for article %s", a.id)
