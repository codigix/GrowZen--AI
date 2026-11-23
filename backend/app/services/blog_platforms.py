"""The top blogging and article-publishing platforms: places where anyone can publish a blog or an article (or list their blog) from their own account.

Two sources, always together. A built-in list of the well-known platforms is always there (it does not depend on the web search or the AI). Claude is asked, once a week per
business, for the platforms that suit this business (its niche, its readers, its country and city): they are added to the list and the ones it picks first are shown first,
with a short reason. If Claude cannot answer, the built-in list is still shown and checked.

Every platform is opened in the background to see that it is still online; one that cannot be reached is hidden. That a platform is open to publishers is a fact about the
platform, not something read from the page; whether a link from it is followed (most are not) depends on the platform and the post, and is only seen once you have posted
and checked the link.
"""
from __future__ import annotations

import hashlib
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Article, Business, DomainIntelCache
from . import backlink_checker as bc

log = logging.getLogger("seo.blog_platforms")
CACHE_TIER = "v1"
RECHECK_AFTER = timedelta(days=7)
_running: set[int] = set()  # businesses whose platforms are being checked now
_rental_running: set[int] = set()  # businesses whose clothing-rental websites are being checked now
_lock = threading.Lock()

BLOG, SITE, NEWS, COMM, ART, DIR, DOCS, SOC, PORT = ("Blog platform", "Website builder", "Newsletter", "Writing community", "Article site", "Blog directory",
                                                    "Document & magazine sharing", "Social network", "Portfolio")
FREE, PLAN, PAID = "free", "free plan", "paid"

# name, domain, where to start, kind, what it suits (tags), price: free / free plan / paid / None (not stated)
CATALOG: list[tuple[str, str, str, str, str, str | None]] = [
    ("WordPress.com", "wordpress.com", "https://wordpress.com/start", BLOG, "general fashion lifestyle", PLAN),
    ("Blogger", "blogger.com", "https://www.blogger.com/", BLOG, "general fashion lifestyle", FREE),
    ("Medium", "medium.com", "https://medium.com/new-story", COMM, "general business fashion lifestyle", FREE),
    ("Substack", "substack.com", "https://substack.com/", NEWS, "newsletter general lifestyle", FREE),
    ("Tumblr", "tumblr.com", "https://www.tumblr.com/", BLOG, "fashion lifestyle general", FREE),
    ("Ghost", "ghost.org", "https://ghost.org/", BLOG, "newsletter general", PAID),
    ("Wix", "wix.com", "https://www.wix.com/blog", SITE, "business general fashion", PLAN),
    ("Weebly", "weebly.com", "https://www.weebly.com/", SITE, "business general", PLAN),
    ("Squarespace", "squarespace.com", "https://www.squarespace.com/", SITE, "business fashion", PAID),
    ("Typepad", "typepad.com", "https://www.typepad.com/", BLOG, "general", PAID),
    ("LiveJournal", "livejournal.com", "https://www.livejournal.com/", BLOG, "general lifestyle", FREE),
    ("Write.as", "write.as", "https://write.as/", BLOG, "general", FREE),
    ("Bear Blog", "bearblog.dev", "https://bearblog.dev/", BLOG, "general", FREE),
    ("Telegraph", "telegra.ph", "https://telegra.ph/", BLOG, "general", FREE),
    ("Hashnode", "hashnode.com", "https://hashnode.com/", COMM, "tech", FREE),
    ("DEV Community", "dev.to", "https://dev.to/new", COMM, "tech", FREE),
    ("Beehiiv", "beehiiv.com", "https://www.beehiiv.com/", NEWS, "newsletter", PLAN),
    ("Buttondown", "buttondown.com", "https://buttondown.com/", NEWS, "newsletter", PAID),
    ("Paragraph", "paragraph.xyz", "https://paragraph.xyz/", NEWS, "newsletter", FREE),
    ("Mirror", "mirror.xyz", "https://mirror.xyz/", COMM, "tech", FREE),
    ("Notion", "notion.so", "https://www.notion.so/", SITE, "general", PLAN),
    ("Webflow", "webflow.com", "https://webflow.com/", SITE, "business", PLAN),
    ("Strikingly", "strikingly.com", "https://www.strikingly.com/", SITE, "business", PLAN),
    ("Jimdo", "jimdo.com", "https://www.jimdo.com/", SITE, "business", PLAN),
    ("SITE123", "site123.com", "https://www.site123.com/", SITE, "business", PLAN),
    ("Webnode", "webnode.com", "https://www.webnode.com/", SITE, "business", PLAN),
    ("Tilda", "tilda.cc", "https://tilda.cc/", SITE, "business", PLAN),
    ("HubSpot CMS", "hubspot.com", "https://www.hubspot.com/products/cms", SITE, "business", PLAN),
    ("Edublogs", "edublogs.org", "https://edublogs.org/", BLOG, "general", PLAN),
    ("Over-Blog", "over-blog.com", "https://www.over-blog.com/", BLOG, "general", FREE),
    ("Micro.blog", "micro.blog", "https://micro.blog/", BLOG, "general", PAID),
    ("Shopify", "shopify.com", "https://www.shopify.com/blog", SITE, "ecommerce fashion business", PAID),
    ("BigCommerce", "bigcommerce.com", "https://www.bigcommerce.com/", SITE, "ecommerce business", PAID),
    ("Zoho Sites", "zoho.com", "https://www.zoho.com/sites/", SITE, "business", PLAN),
    ("Duda", "duda.co", "https://www.duda.co/", SITE, "business", PAID),
    ("Framer", "framer.com", "https://www.framer.com/", SITE, "business", PLAN),
    ("Google Sites", "sites.google.com", "https://sites.google.com/", SITE, "general business", FREE),
    ("GitHub Pages", "pages.github.com", "https://pages.github.com/", SITE, "tech", FREE),
    ("Quora", "quora.com", "https://www.quora.com/", COMM, "general business", FREE),
    ("Reddit", "reddit.com", "https://www.reddit.com/", SOC, "general", FREE),
    ("LinkedIn Articles", "linkedin.com", "https://www.linkedin.com/post/new", COMM, "business general", FREE),
    ("HubPages", "hubpages.com", "https://hubpages.com/", ART, "general lifestyle", FREE),
    ("Vocal Media", "vocal.media", "https://vocal.media/", ART, "general lifestyle fashion", FREE),
    ("EzineArticles", "ezinearticles.com", "https://ezinearticles.com/", ART, "general", FREE),
    ("HackerNoon", "hackernoon.com", "https://hackernoon.com/", COMM, "tech", FREE),
    ("Steemit", "steemit.com", "https://steemit.com/", COMM, "general", FREE),
    ("Minds", "minds.com", "https://www.minds.com/", SOC, "general", FREE),
    ("Bloglovin", "bloglovin.com", "https://www.bloglovin.com/", DIR, "fashion lifestyle", FREE),
    ("Flipboard", "flipboard.com", "https://flipboard.com/", DIR, "general fashion lifestyle", FREE),
    ("Scoop.it", "scoop.it", "https://www.scoop.it/", DIR, "business", PLAN),
    ("Issuu", "issuu.com", "https://issuu.com/", DOCS, "fashion lifestyle", PLAN),
    ("SlideShare", "slideshare.net", "https://www.slideshare.net/", DOCS, "business", FREE),
    ("Scribd", "scribd.com", "https://www.scribd.com/", DOCS, "general", FREE),
    ("Calaméo", "calameo.com", "https://www.calameo.com/", DOCS, "fashion lifestyle", PLAN),
    ("Yumpu", "yumpu.com", "https://www.yumpu.com/", DOCS, "fashion lifestyle", FREE),
    ("Mix", "mix.com", "https://mix.com/", DIR, "general", FREE),
    ("Wattpad", "wattpad.com", "https://www.wattpad.com/", COMM, "stories", FREE),
    ("Behance", "behance.net", "https://www.behance.net/", PORT, "fashion design", FREE),
    ("DeviantArt", "deviantart.com", "https://www.deviantart.com/", PORT, "design", FREE),
    ("Instructables", "instructables.com", "https://www.instructables.com/", COMM, "diy", FREE),
    ("Indie Hackers", "indiehackers.com", "https://www.indiehackers.com/", COMM, "tech business", FREE),
    ("Business 2 Community", "business2community.com", "https://www.business2community.com/", ART, "business", FREE),
    ("Care2", "care2.com", "https://www.care2.com/", COMM, "lifestyle", FREE),
    ("Ko-fi", "ko-fi.com", "https://ko-fi.com/", NEWS, "general", FREE),
    ("Patreon", "patreon.com", "https://www.patreon.com/", NEWS, "general", FREE),
    ("Gumroad", "gumroad.com", "https://gumroad.com/", NEWS, "general", FREE),
    ("Fandom", "fandom.com", "https://www.fandom.com/", COMM, "general", FREE),
    ("Pinterest", "pinterest.com", "https://www.pinterest.com/", SOC, "fashion lifestyle visual", FREE),
    ("Ning", "ning.com", "https://www.ning.com/", SOC, "general", PAID),
    ("Mighty Networks", "mightynetworks.com", "https://www.mightynetworks.com/", SOC, "general", PAID),
    ("Alignable", "alignable.com", "https://www.alignable.com/", SOC, "local business", FREE),
    ("Nextdoor", "nextdoor.com", "https://business.nextdoor.com/", SOC, "local", FREE),
    ("BizSugar", "bizsugar.com", "https://www.bizsugar.com/", DIR, "business", FREE),
    ("Authory", "authory.com", "https://authory.com/", PORT, "general", PLAN),
    ("Contently", "contently.com", "https://contently.com/", PORT, "general", FREE),
    ("Pearltrees", "pearltrees.com", "https://www.pearltrees.com/", DIR, "general", PLAN),
    ("Diigo", "diigo.com", "https://www.diigo.com/", DIR, "general", FREE),
    ("Feedspot", "feedspot.com", "https://www.feedspot.com/", DIR, "general", FREE),
    ("Blogarama", "blogarama.com", "https://www.blogarama.com/", DIR, "general", FREE),
    ("BlogCatalog", "blogcatalog.com", "https://www.blogcatalog.com/", DIR, "general", FREE),
    ("Blogtopsites", "blogtopsites.com", "https://www.blogtopsites.com/", DIR, "general", FREE),
    ("BlogAdda", "blogadda.com", "https://www.blogadda.com/", DIR, "india general lifestyle", FREE),
    ("IndiBlogger", "indiblogger.in", "https://www.indiblogger.in/", DIR, "india general lifestyle", FREE),
    ("Blogchatter", "blogchatter.com", "https://www.blogchatter.com/", DIR, "india lifestyle", FREE),
    ("Pratilipi", "pratilipi.com", "https://www.pratilipi.com/", COMM, "india stories", FREE),
    ("YourStory", "yourstory.com", "https://yourstory.com/", ART, "india business", None),
    ("TOI Blogs", "timesofindia.indiatimes.com", "https://timesofindia.indiatimes.com/blogs/", ART, "india general", FREE),
    ("Dailyhunt", "dailyhunt.in", "https://www.dailyhunt.in/", ART, "india general", FREE),
    ("Women's Web", "womensweb.in", "https://www.womensweb.in/", ART, "india lifestyle fashion", FREE),
    ("SheThePeople", "shethepeople.tv", "https://www.shethepeople.tv/", ART, "india lifestyle", None),
    ("Momspresso", "momspresso.com", "https://www.momspresso.com/", COMM, "india lifestyle", FREE),
    ("Thrive Global", "thriveglobal.com", "https://thriveglobal.com/", ART, "lifestyle", FREE),
    ("Elephant Journal", "elephantjournal.com", "https://www.elephantjournal.com/", ART, "lifestyle", FREE),
    ("The Good Men Project", "goodmenproject.com", "https://goodmenproject.com/", ART, "lifestyle", FREE),
    ("Tiny Buddha", "tinybuddha.com", "https://tinybuddha.com/", ART, "lifestyle", FREE),
    ("mindbodygreen", "mindbodygreen.com", "https://www.mindbodygreen.com/", ART, "lifestyle", None),
]

# Related clothing rental websites: reference websites for clothing-rental content, not publishing destinations. Nothing is hard-coded: Claude is asked for clothing
# rental websites (local first, then wider), each one is opened, and only the ones whose own page is about renting clothes are kept. They are shown under the platform
# cards that suit clothing-rental articles, to a rental business only. GrowZen has no integration with them: the platforms stay the places a blog is published.
RENTAL_KIND = "Clothing Rental Website"
RENTAL_KEY = "rental-sites"
RENTAL_RECHECK_AFTER = timedelta(days=1)
SUITS_KINDS = (BLOG, COMM, ART)  # places where an article can be published; directories, document sites, social networks and portfolios are not


def _suits_rental(platform: dict[str, Any]) -> bool:
    """A platform that suits clothing-rental articles: a fashion platform that takes articles from anyone (by its kind and its fashion tag, not read from its pages)."""
    return "fashion" in platform["tags"] and platform["kind"] in SUITS_KINDS

# how much each kind of fit counts for this business
_W = {"fashion": 3, "lifestyle": 2, "india": 2, "local": 1, "ecommerce": 2, "business": 1, "general": 1}
KINDS = (BLOG, SITE, NEWS, COMM, ART, DIR, DOCS, SOC, PORT)
TAGS = {"general", "business", "fashion", "lifestyle", "india", "local", "ecommerce", "tech", "newsletter", "diy", "stories", "design", "visual"}
PRICES = {"free", "free plan", "paid"}


def _context(b: Business, a: Article | None) -> dict[str, bool]:
    """What kind of business this is, for ranking: a clothing / fashion business, one in India, one that serves a local area."""
    from . import publish_discovery as pd
    return {"fashion": "fashion" in pd.Niche(b, a).audiences(),  # see publish_discovery._AUDIENCES
            "india": (b.country or "").upper() == "IN", "local": (b.target_scope or "local") == "local"}


def _fit(tags: set[str], ctx: dict[str, bool]) -> int:
    score = 0
    for t in tags:
        w = _W.get(t, 0)
        if t in ("fashion", "ecommerce") and not ctx["fashion"]:
            w = 0
        elif t == "lifestyle" and not ctx["fashion"]:
            w = 1
        elif t == "india" and not ctx["india"]:
            w = 0
        elif t == "local" and not ctx["local"]:
            w = 0
        score += w
    return score


def _entries() -> list[dict[str, Any]]:
    return [{"name": n, "domain": d, "url": u, "kind": k, "tags": t.split(), "price": p} for n, d, u, k, t, p in CATALOG]


# ------------------------------------------------------------------------------------------------------------------------ Claude's picks for this business
AI_SYSTEM = f"""You list real, existing platforms where a business can publish a blog or an article, or list its blog, from its own account: blog hosts, writing communities, article
sites, newsletter platforms, blog directories, document and magazine sharing sites, portfolio sites and niche communities.

Give the 100 best platforms for THIS business, best fit first: its niche, its audience and the people who read about that niche, and its country and city (local and national
platforms count). Start with the ones that suit it most; when fewer than 100 suit it well, fill the rest with the most widely used platforms that suit it least.
Only list platforms you are confident exist and that let outside people publish; never invent a domain. Do not list search engines, shops or marketplaces.

Return compact JSON, one short line per platform: {{"platforms": [{{"name": "Example", "domain": "example.com", "kind": "one of {list(KINDS)}",
"tags": ["any of {sorted(TAGS)}"], "price": "free" or "free plan" or "paid" or null, "why": "at most 8 words: why it suits this business"}}]}} with 100 platforms."""


def _domain_of(raw: Any) -> str:
    return str(raw or "").lower().strip().removeprefix("https://").removeprefix("http://").removeprefix("www.").split("/")[0]


def _platform_objects(text: str) -> list[Any]:
    """The platform entries of Claude's answer. A long answer can be cut off in the middle of an entry: every complete entry before the cut is kept."""
    import json

    from . import ai
    try:
        out = ai.parse_json(text)
        if isinstance(out.get("platforms"), list):
            return out["platforms"]
    except ValueError:
        pass
    decoder, items, i = json.JSONDecoder(), [], text.find("[")
    while i != -1:
        i = text.find("{", i)
        if i == -1:
            break
        try:
            obj, end = decoder.raw_decode(text[i:])
        except ValueError:
            break  # the entry that was cut off
        items.append(obj)
        i += end
    return items


def _ask_claude(b: Business, a: Article | None) -> list[dict[str, Any]]:
    """Claude's platforms for this business, checked for shape: a real-looking domain, a start page on that domain, a known kind, known tags. Raises when the AI cannot answer."""
    import re

    from . import ai
    from . import publish_discovery as pd
    if not ai.is_configured():
        raise RuntimeError("The AI is not set up (add the Claude key): showing the built-in list.")
    place = ", ".join(x for x in [b.area or "", b.city or "", b.country or ""] if x)
    desc = " ".join((b.description or "").split())[:300]
    niche = pd.Niche(b, a)
    text = ai.complete(AI_SYSTEM, f"Business: {b.name}\nWhat it sells (its services): {pd._offers(b) or [b.primary_category or '']}\nCategory: {b.primary_category or ''}\nWhere: {place}\n"
                                 f"About it: {desc}\nTopics: {pd.topics_of(b, a)}\nPeople who read about its niche: {niche.audiences() or 'the same people as its customers'}",
                       json_mode=True, max_tokens=9000)
    entries = _platform_objects(text)
    if not entries:
        raise RuntimeError("Claude's answer could not be read: showing the built-in list.")
    res: list[dict[str, Any]] = []
    seen: set[str] = set()
    for p in entries:
        if not isinstance(p, dict):
            continue
        d = _domain_of(p.get("domain"))
        if not re.match(r"^[a-z0-9-]+(\.[a-z0-9-]+)+$", d) or d in seen or any(s in d for s in pd.SKIP):
            continue
        seen.add(d)
        url = str(p.get("url") or "")
        host = (urlsplit(url).hostname or "").removeprefix("www.")
        if not url.startswith("https://") or not (host == d or host.endswith("." + d)):
            url = f"https://{d}/"
        tags = [t for t in (p.get("tags") or []) if isinstance(t, str) and t in TAGS] or ["general"]
        res.append({"name": str(p.get("name") or d)[:80], "domain": d, "url": url, "kind": p.get("kind") if p.get("kind") in KINDS else BLOG, "tags": tags,
                    "price": p.get("price") if p.get("price") in PRICES else None, "why": " ".join(str(p.get("why") or "").split())[:140], "rank": len(res)})
    return res[:100]


# ------------------------------------------------------------------------------------------------------------------------ is it online
def _cache_key(b: Business, a: Article | None) -> tuple[str, str]:
    from . import publish_discovery as pd
    return f"biz:{b.id}", "platforms:" + hashlib.sha1("|".join(pd.topics_of(b, a)).encode()).hexdigest()[:16]


def _cached(db: Session, b: Business, a: Article | None) -> dict[str, Any] | None:
    dom, key = _cache_key(b, a)
    row = db.scalar(select(DomainIntelCache).where(DomainIntelCache.domain == dom, DomainIntelCache.key == key, DomainIntelCache.tier == CACHE_TIER))
    return row.payload if row else None


def _probe(url: str) -> str:
    """up: it answered (a site that blocks robots with 401/403/429 is still online) · gone: the page is not there (404/410) or the name does not resolve ·
    unknown: anything else (a timeout, a dropped connection, a server error, a network that blocks it): that says nothing about the platform itself."""
    try:
        status, _html, _final, _ms, err = bc._fetch(url)
    except Exception:  # noqa: BLE001 - one platform that cannot be read must not stop the others
        return "unknown"
    if status is not None:
        if status < 400 or status in (401, 403, 405, 429, 999):
            return "up"
        return "gone" if status in (404, 410) else "unknown"
    return "gone" if "resolve hostname" in (err or "") else "unknown"


def _alive(url: str) -> bool | None:
    """True: online · False: gone (hidden from the list) · None: could not tell (still shown). A platform is only called gone when its start page and the
    site's home page (with and without www) are all gone: showing a live platform matters more than hiding a dead one."""
    first = _probe(url)
    if first == "up":
        return True
    host = urlsplit(url).hostname or ""
    bare = host.removeprefix("www.")
    saw_unknown = first == "unknown"
    for other in (f"https://{host}/", f"https://{bare}/", f"https://www.{bare}/"):
        if other == url:
            continue
        s = _probe(other)
        if s == "up":
            return True
        saw_unknown = saw_unknown or s == "unknown"
    return None if saw_unknown else False


def _stale(data: dict[str, Any] | None, after: timedelta = RECHECK_AFTER) -> bool:
    if not data or not data.get("checked_at"):
        return True
    try:
        return datetime.now(timezone.utc) - datetime.fromisoformat(data["checked_at"]) > after
    except ValueError:
        return True


def start(business_id: int) -> bool:
    with _lock:
        if business_id in _running:
            return False
        _running.add(business_id)
        return True


def run(db: Session, business_id: int, article_id: int | None) -> None:
    """Ask Claude for the platforms that suit this business, then open every platform (built-in and Claude's) to see that it is online, and keep the result.
    Called in the background (start() was called first). If Claude cannot answer, the built-in list is still checked and shown."""
    try:
        b = db.get(Business, business_id)
        a = db.get(Article, article_id) if article_id else None
        claude: list[dict[str, Any]] = []
        message = ""
        try:
            claude = _ask_claude(b, a)
        except Exception as exc:  # noqa: BLE001 - the built-in list is the fallback
            message = str(exc)[:200] or exc.__class__.__name__
            log.warning("Claude platform suggestions failed: %s", message)
        have = {e["domain"] for e in _entries()}
        entries = _entries() + [{**c, "tags": c["tags"]} for c in claude if c["domain"] not in have]
        with ThreadPoolExecutor(max_workers=8) as pool:
            alive = list(pool.map(lambda e: _alive(e["url"]), entries))
        payload = {"checked_at": datetime.now(timezone.utc).isoformat(), "live": {e["domain"]: ok for e, ok in zip(entries, alive)},
                   "claude": claude, "source": "claude" if claude else "built-in", "message": message}
        dom, key = _cache_key(b, a)
        row = db.scalar(select(DomainIntelCache).where(DomainIntelCache.domain == dom, DomainIntelCache.key == key, DomainIntelCache.tier == CACHE_TIER))
        if row is None:
            row = DomainIntelCache(domain=dom, key=key, tier=CACHE_TIER)
            db.add(row)
        row.payload, row.fetched_at = payload, datetime.now(timezone.utc)
        db.commit()
        if is_rental(b, a) and start_rental(business_id):  # the clothing-rental websites shown under the platform cards are refreshed in the same background job
            refresh_rental(db, business_id, article_id)
    finally:
        with _lock:
            _running.discard(business_id)


# ------------------------------------------------------------------------------------------------------------------------ the rental websites
def is_rental(b: Business, a: Article | None) -> bool:
    """Whether this business rents things out (its services, category or keywords say rent / rental / hire)."""
    from . import publish_discovery as pd
    n = pd.Niche(b, a)
    return bool(pd._GROUPS[1] & (n.core | n.plus))  # the "rent / rental / hire" word group


def _rental_row(db: Session, b: Business) -> DomainIntelCache | None:
    return db.scalar(select(DomainIntelCache).where(DomainIntelCache.domain == f"biz:{b.id}", DomainIntelCache.key == RENTAL_KEY, DomainIntelCache.tier == CACHE_TIER))


RENTAL_AI_SYSTEM = """You list real, existing websites of businesses that RENT OUT clothes: fashion and ethnic-wear rental shops and rental marketplaces (lehengas, sarees,
sherwanis, gowns, suits, costumes, designer and bridal outfits, everyday wear). A shop that only sells clothes does not count. Only list websites you are confident exist;
never invent a domain. Return compact JSON: {"sites": [{"name": "Example", "domain": "example.com", "why": "at most 8 words: what it rents"}]} with up to 30 sites,
best fit first."""
RENTAL_FOCUS = {"local": "Only rental businesses in or serving this city and country (local shops with a website first, then national ones).",
                "wider": "Rental businesses in this country and well-known ones in other countries."}


def _ask_claude_rental(b: Business, a: Article | None, focus: str = "local", skip: set[str] | None = None) -> list[dict[str, Any]]:
    """Clothing-rental websites Claude knows (not yet opened: refresh_rental checks each one). `focus` local or wider; `skip`: domains already found.
    Raises when the AI cannot answer."""
    import re

    from . import ai
    from . import publish_discovery as pd
    if not ai.is_configured():
        raise RuntimeError("The AI is not set up (add the Claude key): no rental websites can be looked up.")
    place = ", ".join(x for x in [b.area or "", b.city or "", b.country or ""] if x)
    seen = set(skip or ())
    text = ai.complete(RENTAL_AI_SYSTEM, f"Business: {b.name}\nWhat it rents (its services): {pd._offers(b) or [b.primary_category or '']}\nWhere: {place}\n"
                                         f"Topics: {pd.topics_of(b, a)}\n{RENTAL_FOCUS[focus]}" + (f"\nAlready found (do not repeat): {sorted(seen)}" if seen else ""),
                       json_mode=True, max_tokens=3000)
    out: list[dict[str, Any]] = []
    try:
        entries = ai.parse_json(text).get("sites")
    except ValueError:
        entries = None
    for p in (entries if isinstance(entries, list) else _platform_objects(text)):
        d = _domain_of(p.get("domain")) if isinstance(p, dict) else ""
        if not re.match(r"^[a-z0-9-]+(\.[a-z0-9-]+)+$", d) or d in seen or any(s in d for s in pd.SKIP):
            continue
        seen.add(d)
        out.append({"name": str(p.get("name") or d)[:80], "domain": d, "url": f"https://{d}/", "kind": RENTAL_KIND,
                    "why": " ".join(str(p.get("why") or "").split())[:100]})
    return out[:30]


def _search_rental(b: Business, a: Article | None) -> list[dict[str, Any]]:
    """Real web search results (Google, through the Serper search service) for what the business rents, in its city: the websites that come up.
    Returns [] when no search key is set; raises ValueError when the search service refuses (no credits...)."""
    from urllib.parse import urlsplit as _split

    from ..config import get_settings
    from . import competitor_blogs as cb
    from . import market
    from . import publish_discovery as pd
    if not get_settings().serper_api_key.strip():
        return []
    city = " ".join((b.city or "").split())
    offers = pd._offers(b)[:2] or [" ".join((b.primary_category or "").lower().split())]
    queries = [f"{o} {city}".strip() for o in offers] + [f"{offers[0]} online"]
    if pd._GROUPS[0] & pd.Niche(b, a).core:  # a clothing business: also the plain way people search for it
        queries.append(f"clothes on rent {city}".strip())
    own = pd._registrable(_split(b.website if "://" in (b.website or "") else f"//{b.website or ''}").hostname or "")
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for q in dict.fromkeys(q for q in queries if q):
        for r in pd._search(q, market.serp_country(b)):
            host = (_split(r.get("link") or "").hostname or "").lower().removeprefix("www.")
            reg = pd._registrable(host)
            if not reg or reg in seen or reg == own or any(s in host for s in pd.SKIP) or cb.platform_of(host):
                continue  # directories (Justdial...), social networks and the business's own website are not rental websites to show
            seen.add(reg)
            title = (r.get("title") or reg).split(" | ")[0].split(" - ")[0].strip()
            out.append({"name": title[:80] or reg, "domain": reg, "url": f"https://{reg}/", "kind": RENTAL_KIND, "why": " ".join((r.get("snippet") or "").split())[:100]})
    return out[:30]


def _check_rental(site: dict[str, Any]) -> dict[str, Any]:
    """Open the website. It is verified only when it answers with a page (HTTP 200-399) AND that page is about renting clothes: it uses a word from the
    clothing group and one from the rental group. A site that opens but is about something else is not shown."""
    from bs4 import BeautifulSoup

    from . import publish_discovery as pd
    html, status, err, final = "", None, None, site["url"]
    for url in (site["url"], site["url"].replace("https://", "https://www.", 1)):  # some sites only answer on the www name
        try:
            status, html, final, _ms, err = bc._fetch(url)
        except Exception as exc:  # noqa: BLE001
            status, html, err = None, "", f"The site could not be opened ({type(exc).__name__})."
        if status is not None and 200 <= status < 400 and html:
            break
    opened = status is not None and 200 <= status < 400 and bool(html)
    about_rental = False
    if opened:
        words = pd._tokens(pd._fit_text(BeautifulSoup(html, "html.parser"), {"title": site["name"]}))
        about_rental = bool(pd._GROUPS[0] & words) and bool(pd._GROUPS[1] & words)
    verified = opened and about_rental
    return {"verified": verified, "status": status,
            "error": None if verified else (err or (f"The site answered {status}." if not opened else "The site opens but does not look like a clothing rental website."))}


def refresh_rental(db: Session, business_id: int, article_id: int | None) -> None:
    """Find clothing-rental websites for this business and keep only the real ones. Candidates, in this order: the websites verified last time (checked again),
    real web search results for what the business rents in its city, then Claude's suggestions (local first, then wider; Claude often names websites that do not
    exist, which the check removes). Each one is opened and kept only when its own page is about renting clothes. Nothing is hard-coded.
    Called in the background (start_rental() was called first)."""
    try:
        b = db.get(Business, business_id)
        a = db.get(Article, article_id) if article_id else None
        row = _rental_row(db, b)
        before = [{k: s.get(k) for k in ("name", "domain", "url", "kind", "why")} for s in ((row.payload or {}).get("pool") or [])] if row else []
        candidates: list[dict[str, Any]] = list(before)  # what was real last time is checked again, so the list grows run after run
        found_by = {c["domain"]: "earlier" for c in candidates}
        problems: list[str] = []

        def add(new: list[dict[str, Any]], how: str) -> None:
            for c in new:
                if c["domain"] not in found_by:
                    found_by[c["domain"]] = how
                    candidates.append(c)
        try:
            add(_search_rental(b, a), "web search")
        except Exception as exc:  # noqa: BLE001 - no search credits...: Claude's suggestions are still checked
            problems.append(str(exc)[:200] or exc.__class__.__name__)
        for focus in ("local", "wider"):  # two Claude searches: more candidates, so more real ones get through the check
            try:
                add(_ask_claude_rental(b, a, focus, set(found_by)), "Claude")
            except Exception as exc:  # noqa: BLE001 - whatever the other searches found is still checked
                problems.append(str(exc)[:200] or exc.__class__.__name__)
                log.warning("Claude rental website search (%s) failed: %s", focus, problems[-1])
        with ThreadPoolExecutor(max_workers=8) as pool:
            checked = list(pool.map(_check_rental, candidates))
        pool_sites = [{**c, **r, "found_by": found_by[c["domain"]]} for c, r in zip(candidates, checked) if r["verified"]]
        new_tried = len(candidates) - len(before)
        payload = {"checked_at": datetime.now(timezone.utc).isoformat(), "pool": pool_sites, "tried": len(candidates),
                   "message": "" if new_tried else (problems[-1] if problems else "No clothing rental websites were found.")}
        row = _rental_row(db, b)
        if row is None:
            row = DomainIntelCache(domain=f"biz:{b.id}", key=RENTAL_KEY, tier=CACHE_TIER)
            db.add(row)
        row.payload, row.fetched_at = payload, datetime.now(timezone.utc)
        db.commit()
    finally:
        with _lock:
            _rental_running.discard(business_id)


def start_rental(business_id: int) -> bool:
    with _lock:
        if business_id in _rental_running:
            return False
        _rental_running.add(business_id)
        return True


def _rental_view(db: Session, b: Business, a: Article | None) -> dict[str, Any]:
    show = is_rental(b, a)
    row = _rental_row(db, b)
    data = row.payload if row else None
    items = ((data or {}).get("pool") or []) if show else []  # only websites that were found and verified
    return {"show": show, "items": items, "checked_at": (data or {}).get("checked_at"), "stale": show and _stale(data, RENTAL_RECHECK_AFTER),
            "running": show and b.id in _rental_running, "message": (data or {}).get("message") or "", "tried": (data or {}).get("tried") or 0}


# ------------------------------------------------------------------------------------------------------------------------ what the page shows
def _everything(claude: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The built-in platforms plus Claude's others; a platform Claude also picked carries its reason and rank."""
    picks = {c["domain"]: c for c in claude}
    out = [{**e, "why": picks[e["domain"]]["why"] if e["domain"] in picks else "", "rank": picks[e["domain"]]["rank"] if e["domain"] in picks else None,
            "suggested": e["domain"] in picks} for e in _entries()]
    have = {e["domain"] for e in out}
    out += [{**c, "suggested": True} for c in claude if c["domain"] not in have]
    return out


def view(db: Session, b: Business, a: Article | None) -> dict[str, Any]:
    from ..backlinks.models import BiOpportunity
    data = _cached(db, b, a)
    live = (data or {}).get("live") or {}
    saved = {r.domain: r.status for r in db.scalars(select(BiOpportunity).where(BiOpportunity.business_id == b.id))}
    ctx = _context(b, a)
    items = []
    for e in _everything((data or {}).get("claude") or []):
        items.append({**e, "fit": _fit(set(e["tags"]), ctx), "live": live.get(e["domain"]), "saved": saved.get(e["domain"])})
    # Claude's picks first, in the order it ranked them for this business; then the rest of the built-in list by how well its tags fit
    items.sort(key=lambda i: (0, i["rank"], "") if i.get("suggested") and i.get("rank") is not None else (1, -i["fit"], i["name"].lower()))
    rental = _rental_view(db, b, a)
    sites = [s for s in rental["items"] if s.get("verified")]
    k = 0
    for i in items:
        if rental["show"] and _suits_rental(i):  # a rental business: mark the platforms that suit its articles...
            i["suits"] = True
            if sites:  # ...and show the verified rental websites under them: each card gets the next three (round and round), so the cards differ
                i["related"] = list(sites) if len(sites) <= 3 else [sites[(3 * k + j) % len(sites)] for j in range(3)]
                k += 1
    return {"items": items, "total": len(items), "checked_at": (data or {}).get("checked_at"), "running": b.id in _running, "stale": _stale(data),
            "source": (data or {}).get("source") or "built-in", "message": (data or {}).get("message") or "", "kinds": sorted({i["kind"] for i in items}),
            "rental": rental}


def save(db: Session, b: Business, a: Article | None, domain: str) -> None:
    """Keep a platform in the business's link-building plan (Backlinks > Link Opportunities / Outreach)."""
    from ..backlinks.models import BiOpportunity
    from ..db import utcnow
    e = next((x for x in _everything(((_cached(db, b, a) or {}).get("claude")) or []) if x["domain"] == domain), None)
    if not e:
        raise ValueError("That platform is not in the list.")
    row = db.scalar(select(BiOpportunity).where(BiOpportunity.business_id == b.id, BiOpportunity.domain == domain))
    if row is None:
        db.add(BiOpportunity(business_id=b.id, domain=domain, source="platforms", status="planned", name=e["name"][:160],
                             note=f"{e['kind']} · open to publishers · {e['url']}"[:500], status_at=utcnow()))
        db.commit()
