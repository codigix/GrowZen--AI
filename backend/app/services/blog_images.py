"""The images the website's own blog already uses (read only): per post, its featured image, the images inside the
article (single, side by side / gallery), its social sharing image, where each one sits and how big it is.
Shown on the Images & Analysis step so the user knows what to upload before publishing.

Finds the blog the same way as blog_flow.layout_check (the /blog page and its posts, or for a React.js website its
blog API, which holds the same content its pages draw). Every distinct image is measured once. Addresses are fetched
through net.site_client (private addresses are refused). An image that cannot be read is reported as unavailable,
never counted as missing."""
from __future__ import annotations

import base64
import io
import json
import re
from app.services.fanout import ThreadPoolExecutor
from typing import Any
from urllib.parse import unquote, urljoin, urlsplit

import httpx
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session

from ..models import Article, Business
from . import blog_flow as flow
from .net import site_client
from .url_safety import SSRFValidationError

MAX_IMAGE_BYTES = 20 * 1024 * 1024  # reading stops here
MAX_IMAGES = 80
MAX_POSTS = 40
MAX_HTML_POSTS = 10
GALLERY_CLASS = re.compile(r"gallery|grid|row|columns|carousel|slider|swiper|side-by-side", re.I)
SOCIAL_KEYS = ("social_image", "socialImage", "og_image", "ogImage", "share_image")
IMG_EXT = re.compile(r"\.(jpe?g|png|webp|gif|avif|svg)(\?|$)|/uploads?/|^data:image/", re.I)


def _name(src: str, i: int) -> str:
    if src.startswith("data:"):
        m = re.match(r"data:image/([a-z0-9+.-]+)", src, re.I)
        return f"embedded-image-{i + 1}.{(m.group(1) if m else 'img').replace('svg+xml', 'svg')}"
    return unquote(urlsplit(src).path.rstrip("/").rsplit("/", 1)[-1]) or src


def _dims(data: bytes) -> tuple[int | None, int | None, str | None]:
    try:
        from PIL import Image
        with Image.open(io.BytesIO(data)) as im:
            return im.width, im.height, (im.format or "").upper() or None
    except Exception:  # noqa: BLE001 - not an image Pillow reads (SVG...): size only
        return None, None, None


def _measure(src: str) -> dict[str, Any]:
    """{bytes, width, height, format, error}; error set (bytes None) when the image cannot be read."""
    if src.startswith("data:"):
        head, _, payload = src.partition(",")
        try:
            data = base64.b64decode(payload, validate=False) if ";base64" in head.lower() else unquote(payload).encode()
        except ValueError:
            return {"bytes": None, "error": "The embedded image is damaged."}
        w, h, f = _dims(data)
        return {"bytes": len(data), "width": w, "height": h, "format": f, "error": None, "inline": True}
    try:
        with site_client(15) as c, c.stream("GET", src) as r:
            if r.status_code >= 400:
                return {"bytes": None, "error": f"Unavailable: the website answers {r.status_code} for this image, so readers see a broken picture."}
            if "html" in r.headers.get("content-type", "").lower():
                return {"bytes": None, "error": "Unavailable: the website answers with a web page instead of the image, so readers see a broken picture."}
            body = bytearray()
            for chunk in r.iter_bytes():
                body += chunk
                if len(body) > MAX_IMAGE_BYTES:
                    break
            w, h, f = _dims(bytes(body))
            return {"bytes": len(body), "width": w, "height": h, "format": f or (r.headers.get("content-type", "").split("/")[-1].upper() or None), "error": None}
    except SSRFValidationError as exc:
        return {"bytes": None, "error": f"Unavailable: {exc}"}
    except httpx.HTTPError:
        return {"bytes": None, "error": "Unavailable: the image could not be opened."}


def _src(tag, base: str) -> str:
    raw = tag.get("data-src") or tag.get("data-lazy-src") or tag.get("data-original") or tag.get("src") or ""
    if (not raw or raw.startswith("data:image/gif") or raw.startswith("data:image/svg")) and (tag.get("srcset") or tag.get("data-srcset")):
        raw = (tag.get("data-srcset") or tag.get("srcset")).split(",")[0].strip().split(" ")[0]  # lazy-loaded: the real file is in srcset
    raw = raw.strip()
    if not raw or (re.match(r"data:image/(gif|svg)", raw, re.I) and len(raw) < 400):  # a lazy-loading placeholder, not the picture
        return ""
    return raw if raw.startswith("data:") else urljoin(base, raw)


def _content_images(html: str, base: str, skip: set[str]) -> list[dict[str, Any]]:
    """The images inside an article: each with its kind (Content / Gallery), where it sits and its ALT text."""
    full = "<html" in html[:500].lower()
    soup = BeautifulSoup(html if full else f"<article>{html}</article>", "html.parser")
    main = soup.find("article") or soup.find("main") or soup.body or soup
    out: list[dict[str, Any]] = []
    seen: set[str] = set(skip)
    for t in main.find_all("img"):
        s = _src(t, base)
        if not s or s in seen:
            continue
        seen.add(s)
        gallery = False
        node = t.parent
        for _ in range(3):  # a figure / row / gallery holding more than one picture
            if node is None or node is main:
                break
            if len(node.find_all("img")) > 1 or GALLERY_CLASS.search(" ".join(node.get("class") or []) + " " + (node.get("data-gz-layout") or "")):
                gallery = True
                break
            node = node.parent
        head = t.find_previous(["h2", "h3"])
        where = f"Under “{head.get_text(' ', strip=True)[:70]}”" if head and main in head.parents else "Before the first heading"
        out.append({"src": s, "kind": "Gallery" if gallery else "Content", "placement": where, "alt": (t.get("alt") or "").strip()})
    return out


def _block_images(blocks: Any, base: str) -> list[str]:
    """Image addresses inside a site's structured content blocks (JSON)."""
    if isinstance(blocks, str):
        try:
            blocks = json.loads(blocks)
        except ValueError:
            return []
    found: list[str] = []

    def walk(v: Any) -> None:
        if isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)
        elif isinstance(v, str) and IMG_EXT.search(v) and len(v) > 4 and " " not in v[:200]:
            found.append(v if v.startswith("data:") else urljoin(base, v))
    walk(blocks)
    return list(dict.fromkeys(found))


def _from_api(db: Session, b: Business, article: Article | None, base: str) -> list[dict[str, Any]] | None:
    from . import article_publishing as ap
    from . import react_site as rs
    conn = ap.react_target(db, b)
    rows = rs.list_posts(conn) if conn else []
    if not rows:
        return None
    own = str(article.react_post_id) if article and article.react_post_id else None
    blog = (conn.blog_url or "").rstrip("/") or base.rstrip("/") + "/blog"
    site = conn.website_url or base

    def first(r: dict, keys: tuple[str, ...]) -> str:
        return next((str(r[k]) for k in keys if isinstance(r.get(k), str) and r[k].strip()), "")

    def absolute(v: str) -> str:
        return v if not v or v.startswith("data:") else urljoin(site.rstrip("/") + "/", v)
    posts = []
    for r in [r for r in rows if str(r.get("id")) != own][:MAX_POSTS]:
        cover = absolute(first(r, flow._IMAGE_KEYS))
        social = absolute(first(r, SOCIAL_KEYS))
        body = first(r, flow._BODY_KEYS)
        content = _content_images(body, site, {cover} if cover else set())
        for s in _block_images(r.get("content_blocks") or r.get("blocks"), site):
            if s != cover and all(s != c["src"] for c in content):
                content.append({"src": s, "kind": "Content", "placement": "In a content block", "alt": ""})
        key = r.get("slug") or r.get("id")
        posts.append({"title": first(r, ("title", "name")) or f"Post {r.get('id')}", "url": f"{blog}/{key}" if key else None,
                      "featured": cover or None, "featured_alt": first(r, ("image_alt", "imageAltText", "alt")),
                      "social": social if social and social != cover else None, "social_same": bool(social and social == cover),
                      "content": content, "body_read": bool(body)})
    return posts


def _listing_posts(listing_url: str) -> tuple[list[str], list[str]]:
    """(post addresses, card image addresses) from the blog page."""
    soup, final, _err = flow._soup(listing_url)
    if soup is None:
        return [], []
    final = final or listing_url
    host, lpath = urlsplit(final).netloc, urlsplit(final).path.rstrip("/")
    posts, cards = [], []
    for a in soup.find_all("a", href=True):
        full = urljoin(final, a["href"]).split("#")[0]
        pr = urlsplit(full)
        if pr.netloc == host and pr.path.rstrip("/").startswith(lpath) and pr.path.rstrip("/") != lpath and full not in posts and not re.search(r"/(page|category|tag|author)/", pr.path):
            posts.append(full)
    for node in soup.find_all(["article", "li", "div"], class_=re.compile(r"post|card|blog|article|entry", re.I))[:40]:
        img = node.find("img")
        s = _src(img, final) if img else ""
        if s and s not in cards:
            cards.append(s)
    return posts, cards[:12]


def _from_html(listing_url: str | None, sample: str | None) -> tuple[list[dict[str, Any]], list[str]]:
    urls, cards = _listing_posts(listing_url) if listing_url else ([], [])
    if sample and sample not in urls:
        urls.insert(0, sample)

    def one(url: str) -> dict[str, Any] | None:
        soup, final, err = flow._soup(url)
        if soup is None:
            return {"title": url, "url": url, "featured": None, "social": None, "content": [], "body_read": False, "error": err}
        final = final or url
        og = soup.find("meta", attrs={"property": "og:image"}) or soup.find("meta", attrs={"name": "twitter:image"})
        social = urljoin(final, og["content"]) if og and og.get("content") else None
        main = soup.find("article") or soup.find("main") or soup.body or soup
        feat_tag = main.find("img", class_=re.compile(r"featured|wp-post-image|hero|cover|banner|thumbnail", re.I))
        if not feat_tag:  # the picture above the first heading of the post
            first_img, first_h = main.find("img"), main.find(["h2", "h3"])
            feat_tag = first_img if first_img and (not first_h or first_img.find_next(["h2", "h3"]) == first_h) else None
        feat = _src(feat_tag, final) if feat_tag else (social or None)
        content = _content_images(str(soup), final, {feat} if feat else set())
        title = soup.find("h1") or soup.find("title")
        return {"title": title.get_text(" ", strip=True)[:200] if title else url, "url": url, "featured": feat or None,
                "social": social if social and social != feat else None, "social_same": bool(social and social == feat), "content": content, "body_read": True}
    with ThreadPoolExecutor(4) as pool:
        posts = [p for p in pool.map(one, urls[:MAX_HTML_POSTS]) if p]
    return posts, cards


def _summary(items: list[dict[str, Any]]) -> dict[str, Any]:
    sized = [i["bytes"] for i in items if i.get("bytes")]
    dims = sorted((i["width"], i["height"]) for i in items if i.get("width"))
    return {"count": len(items), "unavailable": sum(1 for i in items if i.get("error")), "total_bytes": sum(sized),
            "avg_bytes": int(sum(sized) / len(sized)) if sized else None, "max_bytes": max(sized) if sized else None,
            "typical": f"{dims[len(dims) // 2][0]} × {dims[len(dims) // 2][1]}" if dims else None}


def image_structure(db: Session, b: Business, article: Article | None = None) -> dict[str, Any]:
    lay = flow.layout_check(db, b, article)
    if lay.get("state") != "ok":
        return {"state": lay.get("state"), "message": lay.get("message"), "site": lay.get("site")}
    base = lay["site"]
    cards: list[str] = []
    posts = _from_api(db, b, article, base) if lay.get("source") == "api" else None
    source = "api" if posts else "page"
    if not posts:
        posts, cards = _from_html(lay.get("listing_url"), lay.get("sample_post"))
    srcs: list[str] = []
    for p in posts:
        for s in [p["featured"], p.get("social"), *(c["src"] for c in p["content"])]:
            if s and s not in srcs:
                srcs.append(s)
    srcs += [s for s in cards if s not in srcs]
    measured_srcs = srcs[:MAX_IMAGES]
    with ThreadPoolExecutor(6) as pool:
        sizes = dict(zip(measured_srcs, pool.map(_measure, measured_srcs)))

    def img(s: str, kind: str, i: int, **extra) -> dict[str, Any]:
        m = sizes.get(s) or {"bytes": None, "error": "Not measured (too many images on the blog to measure them all)."}
        return {"kind": kind, "name": _name(s, i), "preview": None if s.startswith("data:") else s, **extra, **m}
    out_posts = []
    for p in posts:
        feat = img(p["featured"], "Featured", 0, placement="Top of the post and the blog card", alt=p.get("featured_alt", "")) if p["featured"] else None
        social = img(p["social"], "Social", 0, placement="Shared on social media") if p.get("social") else None
        content = [img(c["src"], c["kind"], i, placement=c["placement"], alt=c["alt"]) for i, c in enumerate(p["content"])]
        every = [x for x in [feat, social, *content] if x]
        out_posts.append({"title": p["title"], "url": p["url"], "featured": feat, "social": social, "social_same_as_featured": p.get("social_same", False),
                          "content": content, "total_bytes": sum(x.get("bytes") or 0 for x in every), "images": len(every),
                          "read": p.get("body_read", True), "error": p.get("error")})
    feats = [p["featured"] for p in out_posts if p["featured"]]
    contents = [x for p in out_posts for x in p["content"] if x["kind"] == "Content"]
    galleries = [x for p in out_posts for x in p["content"] if x["kind"] == "Gallery"]
    socials = [p["social"] for p in out_posts if p["social"]]
    card_items = [img(s, "Card", i) for i, s in enumerate(cards)]
    every = feats + contents + galleries + socials
    n = len(out_posts) or 1
    shared = max((sum(1 for p in posts if p["featured"] == s) for s in {p["featured"] for p in posts if p["featured"]}), default=0)
    return {"state": "ok", "source": source, "site": base, "listing_url": lay.get("listing_url"), "posts_checked": len(out_posts),
            "total": {**_summary(every), "distinct": len(srcs)},
            "featured": _summary(feats), "content": {**_summary(contents), "per_post": round(len(contents) / n, 1),
                                                     "posts_with": sum(1 for p in out_posts if any(x["kind"] == "Content" for x in p["content"]))},
            "gallery": {**_summary(galleries), "posts_with": sum(1 for p in out_posts if any(x["kind"] == "Gallery" for x in p["content"]))},
            "social": _summary(socials), "cards": _summary(card_items) if card_items else None,
            "posts": out_posts, "same_featured_on": shared if shared > 1 else 0}
