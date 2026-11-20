"""Images placed inside an article's body (Images & Analysis step), next to the featured image.

Each upload is converted to one optimized WebP exactly like the featured image (featured_images.convert) and stored in
uploads/articles/<business>/content/<article>-<hash>.webp. The editor places it in the body as

    <figure class="blog-content-image" data-gz-figure><img src="<GrowZen address>" data-gz-image="<name>" alt="..." loading="lazy"><figcaption>...</figcaption></figure>

(the same structure the website's own admin writes); two side-by-side images or a gallery are wrapped in
<div class="blog-image-row|blog-image-gallery" data-gz-layout="..." style="display:grid;...">.

On publish, publish_body() uploads each image once per website (WordPress media library / the React site's upload API)
and swaps the GrowZen address for the website's own. The website address is remembered in a sidecar file
(<name>.json), so editing and publishing again never uploads the same image twice."""
from __future__ import annotations

import hashlib
import html
import json
import re
from collections.abc import Callable
from pathlib import Path

from . import featured_images as fi

NAME_RE = re.compile(r"^(\d+)-[0-9a-f]{12}\.webp$")
IMG_RE = re.compile(r"<img\b[^>]*\bdata-gz-image=\"([^\"]+)\"[^>]*>", re.I)


def _folder(business_id: int) -> Path:
    return fi.UPLOAD_ROOT / "articles" / str(int(business_id)) / "content"


def save(business_id: int, article_id: int, data: bytes, info: dict) -> str:
    folder = _folder(business_id)
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{int(article_id)}-{hashlib.sha256(data).hexdigest()[:12]}.webp"
    (folder / name).write_bytes(data)
    meta = _meta_path(folder / name)
    old = json.loads(meta.read_text("utf-8")) if meta.is_file() else {}
    meta.write_text(json.dumps({"info": info, "sites": old.get("sites", {})}), "utf-8")
    return name


def path_of(business_id: int, article_id: int, name: str) -> Path | None:
    """The stored file, only for a well-formed name of this article inside the uploads folder."""
    m = NAME_RE.match(name or "")
    if not m or int(m.group(1)) != int(article_id):
        return None
    folder = _folder(business_id).resolve()
    p = (folder / name).resolve()
    if p.parent != folder:
        return None
    if not p.is_file() and not fi.fetch_missing(f"/businesses/{int(business_id)}/articles/{int(article_id)}/content-images/{name}", p):
        return None  # not here, and not available from another GrowZen server (settings.uploads_fallback_url)
    return p


def _meta_path(p: Path) -> Path:
    return p.with_name(p.name + ".json")


def _meta(p: Path) -> dict:
    try:
        return json.loads(_meta_path(p).read_text("utf-8"))
    except (OSError, ValueError):
        return {"info": {}, "sites": {}}


def listing(business_id: int, article_id: int) -> list[dict]:
    folder = _folder(business_id)
    if not folder.is_dir():
        return []
    out = []
    for p in sorted(folder.glob(f"{int(article_id)}-*.webp")):
        if NAME_RE.match(p.name):
            info = _meta(p).get("info") or {}
            out.append({"name": p.name, "size": p.stat().st_size, "width": info.get("width"), "height": info.get("height"),
                        "original_name": info.get("original_name"), "original_size": info.get("original_size"), "on_sites": sorted(_meta(p).get("sites", {}))})
    return out


def remove(business_id: int, article_id: int, name: str) -> bool:
    p = path_of(business_id, article_id, name)
    if not p:
        return False
    p.unlink(missing_ok=True)
    _meta_path(p).unlink(missing_ok=True)
    return True


# ── kept through the article sanitizer ──────────────────────────────────────────
# Saving an article strips every <figure>/<img> (services/articles.sanitize_html). Images placed on the Images & Analysis
# step are kept: each is rebuilt from scratch from its checked parts (stored file name, GrowZen address, ALT, caption,
# size), so nothing else written in the HTML gets through.
_LAYOUT_RE = re.compile(r"<div\b[^>]*\bdata-gz-layout=\"(row-2|gallery)\"[^>]*>([\s\S]*?)</div>", re.I)
_FIG_RE = re.compile(r"<figure\b[^>]*\bdata-gz-figure\b[^>]*>([\s\S]*?)</figure>", re.I)
_SRC_OK = re.compile(r"^(?:https?://[\w.\-]+(?::\d+)?)?/[\w./\-]*?/content-images/(\d+-[0-9a-f]{12}\.webp)$")
_TOKEN = "GZPLACEDIMAGE{}END"
LAYOUT_STYLE = {"row-2": ("blog-image-row", 240, 16), "gallery": ("blog-image-gallery", 180, 12)}


def _attr(tag: str, name: str) -> str:
    m = re.search(rf"\b{name}\s*=\s*\"([^\"]*)\"", tag, re.I)
    return html.unescape(m.group(1)) if m else ""


def _figure(inner: str, in_row: bool) -> str | None:
    m = IMG_RE.search(inner)
    if not m:
        return None
    tag, name = m.group(0), m.group(1)
    src = _attr(tag, "src")
    ok = _SRC_OK.match(src)
    if not NAME_RE.match(name) or not ok or ok.group(1) != name:
        return None
    alt = html.escape(_attr(tag, "alt"), quote=True)
    w, h = _attr(tag, "width"), _attr(tag, "height")
    size = f' width="{int(w)}" height="{int(h)}"' if w.isdigit() and h.isdigit() else ""
    cap = re.search(r"<figcaption[^>]*>([\s\S]*?)</figcaption>", inner, re.I)
    cap_text = html.escape(html.unescape(re.sub(r"<[^>]+>", "", cap.group(1))).strip(), quote=False) if cap else ""
    fig_style = ' style="margin:0;"' if in_row else ""
    img_width = "width:100%;" if in_row else ""
    caption = f"<figcaption>{cap_text}</figcaption>" if cap_text else ""
    return (f'<figure class="blog-content-image" data-gz-figure="1"{fig_style}>'
            f'<img src="{html.escape(src, quote=True)}" data-gz-image="{name}" alt="{alt}" loading="lazy"{size} style="max-width:100%;height:auto;{img_width}">'
            f"{caption}</figure>")


def keep_placed(body: str) -> tuple[str, dict[str, str]]:
    """The body with each placed image (or row/gallery of them) swapped for a plain token, and the rebuilt HTML per token."""
    kept: dict[str, str] = {}

    def stash(block: str | None) -> str:
        if not block:
            return ""
        key = _TOKEN.format(len(kept))
        kept[key] = block
        return key

    def layout(m: re.Match) -> str:
        cls, minw, gap = LAYOUT_STYLE[m.group(1)]
        figs = [f for f in (_figure(x.group(1), True) for x in _FIG_RE.finditer(m.group(2))) if f]
        return stash(f'<div class="{cls}" data-gz-layout="{m.group(1)}" style="display:grid;grid-template-columns:repeat(auto-fit,minmax({minw}px,1fr));gap:{gap}px;margin:24px 0;">'
                     + "".join(figs) + "</div>" if figs else None)
    body = _LAYOUT_RE.sub(layout, body or "")
    body = _FIG_RE.sub(lambda m: stash(_figure(m.group(1), False)), body)
    body = IMG_RE.sub(lambda m: stash(_figure(m.group(0), False)), body)  # a placed picture whose figure was edited away
    return body, kept


def restore_placed(body: str, kept: dict[str, str]) -> str:
    for key, block in kept.items():
        body = re.sub(rf"(?:<p>\s*)?{key}(?:\s*</p>)?", lambda _m, b=block: b, body)
    return body


def names_in(body: str) -> list[str]:
    return list(dict.fromkeys(IMG_RE.findall(body or "")))


def publish_body(body: str, business_id: int, article_id: int, title: str, site_key: str,
                 upload: Callable[[bytes, str, str, str], str], steps: list[dict]) -> str:
    """The body with every GrowZen content image pointing at the website's copy (uploaded once per website).
    Raises ValueError when an image file is missing in GrowZen."""
    names = names_in(body)
    if not names:
        return body
    slug = re.sub(r"[^a-z0-9]+", "-", (title or "blog-image").lower()).strip("-")[:60] or "blog-image"
    urls: dict[str, str] = {}
    reused = uploaded = 0
    for i, name in enumerate(names, 1):
        p = path_of(business_id, article_id, name)
        if not p:
            raise ValueError(f"The article image {name} is missing in GrowZen. Upload it again on the Images & Analysis step, then publish.")
        meta = _meta(p)
        url = (meta.get("sites") or {}).get(site_key)
        if url:
            reused += 1
        else:
            tag = next((t.group(0) for t in IMG_RE.finditer(body) if t.group(1) == name), "")
            alt = html.unescape((re.search(r"\balt=\"([^\"]*)\"", tag) or [None, ""])[1])
            cap = re.search(re.escape(tag) + r"\s*<figcaption[^>]*>([\s\S]*?)</figcaption>", body, re.I)
            caption = html.unescape(re.sub(r"<[^>]+>", "", cap.group(1))).strip() if cap else ""
            url = upload(p.read_bytes(), f"{slug}-{i}.webp", alt or title, caption)
            uploaded += 1
            if url and not url.startswith("data:"):  # an address on the website: never upload this image there again
                meta.setdefault("sites", {})[site_key] = url
                _meta_path(p).write_text(json.dumps(meta), "utf-8")
        urls[name] = url

    def swap(m: re.Match) -> str:
        tag = m.group(0)
        new = html.escape(urls[m.group(1)], quote=True)
        return re.sub(r"\bsrc=\"[^\"]*\"", lambda _s: f'src="{new}"', tag, count=1) if re.search(r"\bsrc=\"", tag) else tag.replace("<img", f'<img src="{new}"', 1)
    steps.append({"step": "Article images", "ok": True, "detail": f"{len(names)} image{'s' if len(names) != 1 else ''} in the article: {uploaded} uploaded, {reused} already on the website"})
    return IMG_RE.sub(swap, body)
