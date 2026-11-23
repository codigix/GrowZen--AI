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


# ------------------------------------------------------------------------------------------------------------------------ where competitors promote their blogs
# A linking site that is one of the fixed platforms above: it becomes a "used by competitors" badge on that row, not a second row.
PLATFORM_DOMAINS = {"linkedin.com": "linkedin", "facebook.com": "facebook", "fb.com": "facebook", "x.com": "x", "twitter.com": "x", "medium.com": "medium", "quora.com": "quora",
                    "reddit.com": "reddit", "tumblr.com": "tumblr", "blogger.com": "blogger", "blogspot.com": "blogger", "flipboard.com": "flipboard", "pinterest.com": "pinterest",
                    "pin.it": "pinterest", "dev.to": "devto", "hashnode.com": "hashnode", "hashnode.dev": "hashnode"}
# a competitor page that is an article (a blog post, a guide, news), not its home, contact or a category page
_ARTICLE_DIR = re.compile(r"/(blogs?|articles?|posts?|news|insights|resources|guides?|learn|knowledge(?:-base)?|stories|tips|updates)/[^/?#]+", re.I)
_DATED = re.compile(r"/(19|20)\d{2}/\d{1,2}/[^/?#]+")
_NOT_ARTICLE = re.compile(r"/(tag|tags|category|categories|author|page|search|feed|products?|product-category|collections?|shop|store|cart|checkout|account|services?|locations?)(/|$)", re.I)


def _is_article(url: str) -> bool:
    from urllib.parse import urlsplit
    path = urlsplit(url or "").path or "/"
    if path in ("", "/") or _NOT_ARTICLE.search(path):
        return False
    if _ARTICLE_DIR.search(path) or _DATED.search(path):
        return True
    last = path.rstrip("/").rsplit("/", 1)[-1]
    return last.count("-") >= 3 and not re.search(r"\.(jpe?g|png|webp|gif|svg|pdf|css|js)$", last, re.I)  # a long slug: an article address


def _own_site(source_url: str, competitor: str) -> bool:
    """A page of the competitor's own (its shop, a subdomain, a mirror named after it): a link from there is not promotion somewhere else."""
    from urllib.parse import urlsplit
    host = (urlsplit(source_url or "").hostname or "").lower()
    stem = competitor.split(".")[0].lower()
    return len(stem) >= 4 and stem in host.replace("-", "")


def _platform_of(domain: str) -> str | None:
    d = (domain or "").lower()
    return next((k for dom, k in PLATFORM_DOMAINS.items() if d == dom or d.endswith("." + dom)), None)


def _slug_words(url: str) -> str:
    from urllib.parse import urlsplit
    return re.sub(r"[-_/]+", " ", urlsplit(url or "").path)


def saved_competitors(db: Session, b: Business) -> dict[str, Any]:
    """Why no competitor can be used to find blog platforms, when competitors are saved: their blogs are found from their websites, so a competitor
    only on Google Maps (no website) cannot be read, and one with a website that was left out (not selected) is not used. Says which, so the page can explain."""
    from urllib.parse import urlsplit

    from ..competitors import hygiene
    from ..models import Competitor

    def host(raw: str | None) -> str:
        h = (urlsplit(raw if "//" in (raw or "") else f"//{raw or ''}").hostname or "").lower()
        return h[4:] if h.startswith("www.") else h
    rows = list(db.scalars(select(Competitor).where(Competitor.business_id == b.id).order_by(Competitor.id)))
    usable = set(hygiene.real_competitor_domains(b, [host(c.website) for c in rows if c.website]))
    return {"total": len(rows),
            "no_website": [c.name or "Unnamed" for c in rows if c.selected is not False and not host(c.website)],
            "left_out": [{"id": c.id, "name": c.name or host(c.website), "domain": host(c.website)} for c in rows
                         if c.selected is False and host(c.website) in usable]}


def competitor_platforms(db: Session, b: Business, a: Article, limit: int = 15) -> dict[str, Any]:
    """The sites where the business's competitors promote their own blog articles, from the links our backlink crawler found to the competitors' article pages.
    Ranked by how many competitors use the site, how close their article there is to this blog's topic, follow type, DA and spam risk. Risky sites are left out.
    Nothing is fetched here and nothing is invented: a competitor the crawler has not read yet adds nothing."""
    from sqlalchemy.orm import aliased

    from ..backlinks import hub, quality
    from ..backlinks.lifecycle import LIVE_STATES
    from ..backlinks.models import Backlink, BiDomain, BiPage
    comps = hub.hygiene_competitors(db, b)
    if not comps:
        return {"state": "no_competitors", "competitors": [], "items": [], "platforms": {}, "saved": saved_competitors(db, b)}
    me = hub.own_domain(db, b.id)
    SD, TD = aliased(BiDomain), aliased(BiDomain)
    rows = db.execute(select(Backlink, BiPage, SD.registrable_domain, TD.registrable_domain).join(BiPage, BiPage.id == Backlink.source_page_id)
                      .join(SD, SD.id == Backlink.source_domain_id).join(TD, TD.id == Backlink.target_domain_id)
                      .where(TD.registrable_domain.in_(comps), Backlink.current_status.in_(LIVE_STATES)).order_by(Backlink.id.desc()).limit(5000)).all()
    if not rows:
        return {"state": "no_data", "competitors": comps, "items": [], "platforms": {}}
    topic = quality._words(" ".join([a.keyword or "", a.title or "", " ".join(a.secondary_keywords or [])]))
    skip = set(comps) | ({me} if me else set())
    groups: dict[str, dict[str, Any]] = {}
    articles: set[str] = set()
    found: dict[str, dict[str, dict[str, Any]]] = {}  # competitor -> its article -> the pages that link to it (the analysis shown first)
    for bl, page, sdom, tdom in rows:
        if sdom in skip or not _is_article(bl.target_url) or _own_site(page.normalized_url, tdom):
            continue
        art = found.setdefault(tdom, {}).setdefault(bl.target_url, {"url": bl.target_url, "links": [], "topic": 0})
        art["topic"] = max(art["topic"], len(topic & quality._words(_slug_words(bl.target_url))))
        if len(art["links"]) < 25:
            art["links"].append({"url": page.normalized_url, "domain": sdom, "title": page.title, "anchor": " ".join((bl.anchor_text or "").split()) or None,
                                 "follow": hub.follow_of(bl.rel_attributes), "placement": bl.placement})
        articles.add(bl.target_url)
        g = groups.setdefault(sdom, {"competitors": set(), "articles": set(), "links": 0, "dofollow": 0, "overlap": -1, "example": None})
        g["competitors"].add(tdom)
        g["articles"].add(bl.target_url)
        g["links"] += 1
        g["dofollow"] += 1 if hub.follow_of(bl.rel_attributes) == "dofollow" else 0
        overlap = len(topic & quality._words(" ".join([page.title or "", bl.anchor_text or "", _slug_words(bl.target_url)])))
        if overlap > g["overlap"]:  # the example shown: the competitor post closest to this blog's topic
            g["overlap"] = overlap
            g["example"] = {"url": page.normalized_url, "title": page.title, "anchor": " ".join((bl.anchor_text or "").split()) or None,
                            "competitor": tdom, "competitor_article": bl.target_url, "placement": bl.placement}
    all_links = {c: 0 for c in comps}
    for _bl, _page, _sdom, tdom in rows:
        all_links[tdom] = all_links.get(tdom, 0) + 1

    def summary(c: str, arts: list[dict[str, Any]]) -> dict[str, Any]:
        return {"competitor": c, "articles": arts[:15], "article_count": len(arts), "link_count": sum(len(x["links"]) for x in arts),
                "sites": len({ln["domain"] for x in arts for ln in x["links"]}), "all_links": all_links.get(c, 0)}
    if not groups:
        return {"state": "no_articles", "competitors": comps, "items": [], "platforms": {},
                "by_competitor": sorted((summary(c, []) for c in comps), key=lambda x: (-x["all_links"], x["competitor"]))}
    names = list(groups)
    scores = quality.scores_for(db, b.id)
    metrics = hub.metrics_for(db, names)
    missing = [d for d in names if d not in scores]
    facts = quality.domain_facts(db, b.id, comps, missing) if missing else {}
    context = quality.business_context(b)
    have = {r.platform for r in db.scalars(select(BlogPromotion).where(BlogPromotion.article_id == a.id))}
    items: list[dict[str, Any]] = []
    platforms: dict[str, dict[str, Any]] = {}
    verdict: dict[str, dict[str, Any]] = {}  # linking site -> its kind and whether it is useful, risky..., for the analysis
    for dom, g in groups.items():
        ex = g["example"]
        follow = "dofollow" if g["dofollow"] * 2 >= g["links"] else "nofollow"
        cat = bc.categorize(ex["url"], ex["placement"], ex["title"])
        sc = scores.get(dom) or quality.rule_score(dom, facts.get(dom, {"links": 0, "pages": 0, "anchors": [], "placements": {}, "nofollow": 0, "titles": [], "snippets": []}), context)
        mt = metrics.get(dom)
        j = hub.judge(follow, sc, mt, cat["key"])
        verdict[dom] = {"category": cat["label"], "useful": j["label"], "why": j["why"], "platform": _platform_of(dom)}
        if j["label"] == "risky":
            continue  # never suggest posting on a spammy site just because a competitor is there
        da = (mt or {}).get("da") or 0
        overlap = max(g["overlap"], 0)
        score = len(g["competitors"]) * 15 + min(overlap, 3) * 10 + (15 if follow == "dofollow" else 0) + da * 0.3 + sc["relevance"] * 0.3 - sc["risk"] * 0.5
        out = {"domain": dom, "category": {"key": cat["key"], "label": cat["label"]}, "follow": follow, "competitors": sorted(g["competitors"]),
               "articles": len(g["articles"]), "links": g["links"], "example": {k: ex[k] for k in ("url", "title", "anchor", "competitor", "competitor_article")},
               "topic": "same" if overlap >= 2 else "related" if overlap == 1 else None, "da": (mt or {}).get("da"), "spam": (mt or {}).get("spam"),
               "useful": j["label"], "why": j["why"], "how": hub.HOW.get(cat["key"], hub.HOW["website"]), "score": round(score, 1)}
        key = _platform_of(dom)
        if key:  # one of the fixed platforms: shown on its row
            if key not in platforms or score > platforms[key]["score"]:
                platforms[key] = out
            continue
        if re.sub(r"[^a-z0-9]+", "-", dom.lower()).strip("-")[:60] in have:
            continue  # already in this blog's plan
        items.append(out)
    items.sort(key=lambda x: -x["score"])
    by_competitor = []
    for comp_dom in comps:
        arts = sorted(found.get(comp_dom, {}).values(), key=lambda x: (-x["topic"], -len(x["links"])))
        for art in arts:
            for ln in art["links"]:
                ln.update(verdict.get(ln["domain"], {}))
            art["sites"] = len({ln["domain"] for ln in art["links"]})
        by_competitor.append(summary(comp_dom, arts))
    by_competitor.sort(key=lambda x: (-x["link_count"], x["competitor"]))
    return {"state": "ok", "competitors": comps, "competitor_articles": len(articles), "items": items[:limit], "total": len(items), "platforms": platforms, "by_competitor": by_competitor}


def add_from_competitor(db: Session, b: Business, a: Article, domain: str) -> BlogPromotion:
    """Add a site a competitor promotes its blog on to this blog's plan: it then works like any other row (overview, posted, link check)."""
    d = " ".join((domain or "").lower().split())
    found = next((x for x in competitor_platforms(db, b, a, limit=500)["items"] if x["domain"] == d), None)
    if not found:
        raise ValueError("That site is not among the places your competitors promote their blogs.")
    return add_custom(db, b, a, d, found["example"]["url"])


def _with_research(db: Session, b: Business, comp: dict[str, Any]) -> None:
    """One entry per competitor: what its own website shows (its blog, its articles, the platforms it publishes on, from competitor_blogs) and the sites
    the crawler found linking to its articles, each named as a platform where it is one."""
    from . import competitor_blogs as cb
    comps = comp.get("competitors") or []
    res = cb.cached(db, comps)
    comp["research"] = {"running": cb.is_running(b.id), "done": sum(1 for c in comps if c in res), "total": len(comps)}
    by = {c["competitor"]: c for c in comp.get("by_competitor") or []}
    out = []
    for c in comps:
        e = dict(by.get(c) or {"competitor": c, "articles": [], "article_count": 0, "link_count": 0, "sites": 0, "all_links": 0})
        linked: dict[str, dict[str, Any]] = {}
        for art in e["articles"]:
            for ln in art["links"]:
                p = cb.platform_of(ln["domain"])
                row = linked.setdefault(ln["domain"], {"name": p[0] if p else ln["domain"], "domain": ln["domain"], "url": ln["url"], "article": art["url"],
                                                       "follow": ln["follow"], "useful": ln.get("useful"), "links": 0})
                row["links"] += 1
        e["linked_from"] = sorted(linked.values(), key=lambda r: -r["links"])
        e["site"] = res.get(c)
        out.append(e)
    out.sort(key=lambda e: (-(len((e["site"] or {}).get("platforms") or []) + len(e["linked_from"])), -len((e["site"] or {}).get("articles") or []), e["competitor"]))
    comp["by_competitor"] = out


def status(db: Session, b: Business, a: Article) -> dict[str, Any]:
    url = published_url(db, a)
    rows = list(db.scalars(select(BlogPromotion).where(BlogPromotion.article_id == a.id).order_by(BlogPromotion.id)))
    counts = {s: sum(1 for r in rows if r.status == s) for s in STATUSES}
    items = [view(db, r) for r in rows]
    comp: dict[str, Any] | None = None
    if url:
        try:
            comp = competitor_platforms(db, b, a)
        except Exception:  # noqa: BLE001 - the competitor list is extra: the plan still shows without it
            log.exception("competitor platforms failed for article %s", a.id)
            comp = {"state": "error", "competitors": [], "items": [], "platforms": {}}
        _with_research(db, b, comp)
        for it in items:
            it["competitor_use"] = comp["platforms"].get(it["platform"])
    return {"published": bool(url), "url": url, "title": a.title, "items": items, "counts": counts, "from_competitors": comp}
