"""A blog preview for a website whose pages cannot be copied (a React or other JavaScript site: its HTML is an empty shell until the browser runs it).

Instead of the site's own page, a clean blog page is drawn in the site's own brand, read from what the site does serve:
- name, logo (its icon or social image), colour (theme-color, else the most used colour in its stylesheet) and fonts (its Google Fonts and font-family), from its home page and CSS;
- its real posts (title, picture, date, address) from its blog API when it is connected as a React.js website, for the blog list and the "related posts" block.
The result says plainly that it is a preview in the site's brand, not a copy of its exact layout."""
from __future__ import annotations

import html as H
import re
from collections import Counter
from datetime import datetime
from typing import Any
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup
from sqlalchemy.orm import Session

from ..models import Article, Business
from . import backlink_checker as bc

MAX_INLINE_IMAGE = 350_000  # a picture stored inside a post record (data: address) bigger than this is not repeated in the preview
_GREYS = re.compile(r"^#?(?:([0-9a-f])\1\1|([0-9a-f]{2})\2\2)$", re.I)


def _get(url: str) -> tuple[str, str]:
    status, text, final, _ms, _err = bc._fetch(url)
    return (text or "", final or url) if (status or 0) < 400 else ("", url)


def _css_text(url: str) -> str:
    """A stylesheet's text (the page fetcher keeps only HTML), through the same SSRF-safe client, up to 2 MB."""
    from .net import site_client
    try:
        with site_client(15) as c, c.stream("GET", url) as r:
            if r.status_code >= 400:
                return ""
            data = bytearray()
            for chunk in r.iter_bytes():
                data += chunk
                if len(data) > 2_000_000:
                    break
            return data.decode("utf-8", errors="replace")
    except Exception:  # noqa: BLE001 - no stylesheet: the preview uses its fallback colour
        return ""


def _families(font_urls: list[str]) -> list[str]:
    """The font names in Google Fonts addresses: family=Playfair+Display:wght@...&family=Roboto -> ['Playfair Display', 'Roboto']."""
    out: list[str] = []
    for u in font_urls:
        for m in re.findall(r"family=([^&:]+)", u):
            name = m.replace("+", " ").strip()
            if name and name not in out:
                out.append(name)
    return out


def _site_name(title: str, host: str) -> str:
    """The brand in a page title such as "Clothing Rental in Pune | vastrbhushan": the short part, else the domain's name."""
    parts = [p.strip() for p in re.split(r"\s[|–—-]\s", title or "") if p.strip()]
    stem = host.split(".")[0] if host else ""
    pick = next((p for p in parts if stem and p.lower().replace(" ", "") == stem.lower()), None) or (min(parts, key=len) if len(parts) > 1 else None) or stem or (parts[0] if parts else "")
    return pick[:1].upper() + pick[1:]


def _to_hex(v: str) -> str | None:
    m = re.match(r"\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\b", v)
    if m:
        return m.group(1).lower()
    m = re.match(r"\s*rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})", v)
    return "#%02x%02x%02x" % tuple(int(x) for x in m.groups()) if m and all(int(x) < 256 for x in m.groups()) else None


def _named_color(css: str) -> str | None:
    """The first real colour the stylesheet gives a brand name: a CSS variable (--primary, --brand...) or a utility class (.bg-primary, .text-accent...)."""
    names = ("brand", "primary", "accent", "secondary", "gold", "theme")
    # the site's own utility classes first (its designer's palette), then CSS variables (which UI libraries also set, e.g. --primary-color)
    pats = [rf"\.(?:bg|text)-{n}\{{[^}}]*?(?:background-)?color\s*:\s*([^;}}]+)" for n in names] + [rf"--(?:color-)?{n}(?:-color)?\s*:\s*([^;}}]+)" for n in names]
    for pat in pats:
        for v in re.findall(pat, css, re.I)[:3]:
            c = _to_hex(v)
            if c and _hex_ok(c):
                return c
    return None


def _hex_ok(c: str) -> bool:
    c = c.lower().lstrip("#")
    if len(c) == 3:
        c = "".join(x * 2 for x in c)
    if len(c) != 6 or _GREYS.match(c):
        return False
    r, g, b_ = (int(c[i:i + 2], 16) for i in (0, 2, 4))
    light, dark = max(r, g, b_), min(r, g, b_)
    return light - dark > 40 and 40 < light and dark < 225  # a real colour: not grey, not near white or black


def brand(b: Business, site_url: str = "") -> dict[str, Any]:
    """What the site's home page and stylesheet say about its look. Every value has a fallback, so the preview always draws.
    `site_url` is the website set up in Publishing Setup; the project's own website is used when there is none."""
    site = (site_url or b.website or "").strip().rstrip("/")
    site = site if site.startswith("http") else f"https://{site}" if site else ""
    out: dict[str, Any] = {"name": b.name or "", "logo": None, "color": "#4f46e5", "fonts": [], "family": None, "site": site, "read": False}
    if not site:
        return out
    page, final = _get(site + "/")
    if not page:
        return out
    out["read"] = True
    soup = BeautifulSoup(page, "html.parser")
    og = lambda p: (soup.find("meta", attrs={"property": p}) or soup.find("meta", attrs={"name": p}) or {}).get("content")  # noqa: E731
    host = (urlsplit(final).hostname or "").lower().removeprefix("www.")
    name = og("og:site_name") or og("application-name") or _site_name(soup.title.get_text(strip=True) if soup.title else "", host)
    out["name"] = (name or b.name or "")[:60]
    icon = None
    for rel in ("apple-touch-icon", "icon", "shortcut icon"):
        t = soup.find("link", rel=lambda v, r=rel: v and r in " ".join(v if isinstance(v, list) else [v]).lower())
        if t and t.get("href"):
            icon = urljoin(final, t["href"])
            break
    logo_img = next((urljoin(final, i.get("src")) for i in soup.find_all("img", src=True) if re.search(r"logo", " ".join([i.get("src", ""), i.get("alt", ""), " ".join(i.get("class") or [])]), re.I)), None)
    out["logo"] = logo_img or icon
    theme = (soup.find("meta", attrs={"name": "theme-color"}) or {}).get("content")
    out["fonts"] = [urljoin(final, l["href"]) for l in soup.find_all("link", href=True) if "fonts.googleapis.com/css" in l["href"]][:3]
    css_text = " ".join(s.get_text() for s in soup.find_all("style"))
    sheets = [urljoin(final, l["href"]) for l in soup.find_all("link", href=True, rel=lambda v: v and "stylesheet" in " ".join(v if isinstance(v, list) else [v])) if "fonts.googleapis" not in l["href"]]
    for sheet in sheets[:2]:
        text = _css_text(sheet)
        css_text += " " + text
        out["fonts"] += re.findall(r"@import\s+url\(['\"]?(https://fonts\.googleapis\.com/css[^'\")]+)", text)[:2]
    found = [c.lower() for c in re.findall(r"#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b", css_text)]
    found += ["#%02x%02x%02x" % tuple(int(x) for x in m) for m in re.findall(r"rgb\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})", css_text) if all(int(x) < 256 for x in m)]
    colors = Counter(c for c in found if _hex_ok(c))
    named = _named_color(css_text)
    if theme and re.match(r"^#[0-9a-f]{3,6}$", theme.strip(), re.I) and _hex_ok(theme.strip()):
        out["color"] = theme.strip()
    elif named:  # the site's own named colour (bg-primary, text-accent, --brand...): what its designer chose, ahead of a UI library's colours
        out["color"] = named
    elif colors:
        out["color"] = colors.most_common(1)[0][0]
    fams = _families(out["fonts"])
    if fams:  # the site's own fonts: the last one listed is usually the body text, the first the headings
        out["family"] = f"'{fams[-1]}', system-ui, sans-serif"
        out["heading"] = f"'{fams[0]}', Georgia, serif" if len(fams) > 1 else None
    else:
        fam = re.search(r"(?:body|html)\s*\{[^}]*font-family\s*:\s*([^;}]+)", css_text, re.I)
        if fam and "var(" not in fam.group(1):
            out["family"] = fam.group(1).strip()[:120]
    return out


def real_posts(db: Session, b: Business, own_id: str | None = None, limit: int = 9) -> tuple[list[dict[str, Any]], str | None]:
    """The site's own posts from its blog API (React.js website connection), newest first: [{title, excerpt, image, date, url}] and the blog address."""
    from . import article_publishing as ap
    from . import react_site as rs
    from .blog_flow import _BODY_KEYS, _DATE_KEYS, _IMAGE_KEYS
    conn = ap.react_target(db, b)
    if not conn:
        return [], None
    try:
        rows = rs.list_posts(conn)
    except Exception:  # noqa: BLE001 - the list is extra: the preview still draws
        return [], None
    blog = (conn.blog_url or "").rstrip("/") or ((b.website or "").rstrip("/") + "/blog")

    def first(r: dict, keys: tuple[str, ...]) -> str:
        return next((str(r[k]) for k in keys if isinstance(r.get(k), str) and r[k].strip()), "")
    out = []
    for r in rows:
        if own_id and str(r.get("id")) == own_id:
            continue
        title = first(r, ("title", "name", "heading"))
        if not title:
            continue
        img = first(r, _IMAGE_KEYS)
        if img.startswith("data:") and len(img) > MAX_INLINE_IMAGE:
            img = ""
        body = re.sub(r"<[^>]+>", " ", first(r, ("excerpt", "summary", "metaDescription", "meta_description")) or first(r, _BODY_KEYS))
        key = r.get("slug") or r.get("id")
        out.append({"title": title[:140], "excerpt": " ".join(body.split())[:160], "image": img, "date": _date(first(r, _DATE_KEYS)), "url": f"{blog}/{key}" if key else blog,
                    "_sort": first(r, _DATE_KEYS)})
    out.sort(key=lambda p: p["_sort"], reverse=True)
    return out[:limit], blog


def _date(raw: str) -> str:
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).strftime("%d %b %Y")
    except (ValueError, AttributeError):
        return ""


def _font_link(br: dict[str, Any]) -> str:
    links = "".join(f"<link rel='stylesheet' href='{H.escape(u, quote=True)}'>" for u in dict.fromkeys(br["fonts"]))
    return links or "<link rel='stylesheet' href='https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'>"


def _css(br: dict[str, Any]) -> str:
    c = br["color"]
    fam = br["family"] or "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    heads = br.get("heading") or "inherit"
    return f"""<style>
h1,h2,h3,h5,.gz-logo{{font-family:{heads}}}
:root{{--brand:{c};--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--soft:color-mix(in srgb,var(--brand) 8%,#fff)}}
*{{box-sizing:border-box}}body{{margin:0;font-family:{fam};color:var(--ink);background:#fff;line-height:1.7;-webkit-font-smoothing:antialiased}}
a{{color:var(--brand);text-decoration:none}}img{{max-width:100%;display:block}}
.gz-head{{position:sticky;top:0;z-index:5;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}}
.gz-wrap{{max-width:1180px;margin:0 auto;padding:0 20px}}
.gz-bar{{display:flex;align-items:center;gap:18px;height:68px}}.gz-logo{{display:flex;align-items:center;gap:10px;font-weight:800;font-size:19px;color:var(--ink)}}
.gz-logo img{{height:38px;width:auto;max-width:150px;object-fit:contain}}.gz-nav{{margin-left:auto;display:flex;gap:22px;font-size:14.5px;font-weight:600}}.gz-nav a{{color:#334155}}.gz-nav a.on{{color:var(--brand)}}
.gz-cta{{background:var(--brand);color:#fff!important;padding:9px 16px;border-radius:999px;font-size:14px;font-weight:700}}
.gz-crumb{{font-size:13px;color:var(--muted);padding:22px 0 0}}.gz-crumb a{{color:var(--muted)}}
.gz-hero{{padding:14px 0 26px;max-width:860px}}.gz-chip{{display:inline-block;background:var(--soft);color:var(--brand);font-weight:700;font-size:12px;letter-spacing:.06em;text-transform:uppercase;padding:6px 12px;border-radius:999px}}
.gz-hero h1{{font-size:clamp(28px,4.2vw,46px);line-height:1.15;margin:14px 0 14px;letter-spacing:-.02em}}.gz-lead{{font-size:18px;color:#475569;margin:0 0 18px}}
.gz-meta{{display:flex;flex-wrap:wrap;align-items:center;gap:14px;font-size:14px;color:var(--muted)}}.gz-av{{width:38px;height:38px;border-radius:50%;background:var(--brand);color:#fff;display:grid;place-items:center;font-weight:800}}
.gz-cover{{border-radius:20px;overflow:hidden;aspect-ratio:1200/630;background:linear-gradient(135deg,var(--brand),color-mix(in srgb,var(--brand) 55%,#000));margin-bottom:38px}}.gz-cover img{{width:100%;height:100%;object-fit:cover}}
.gz-grid{{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:48px;align-items:start}}
.gz-body{{font-size:17.5px}}.gz-body h2{{font-size:28px;line-height:1.25;margin:44px 0 14px;letter-spacing:-.01em;scroll-margin-top:90px}}.gz-body h3{{font-size:21px;margin:30px 0 10px}}
.gz-body p{{margin:0 0 18px}}.gz-body ul,.gz-body ol{{padding-left:22px;margin:0 0 20px}}.gz-body li{{margin:6px 0}}.gz-body blockquote{{margin:24px 0;padding:16px 20px;border-left:4px solid var(--brand);background:var(--soft);border-radius:0 12px 12px 0}}
.gz-body table{{width:100%;border-collapse:collapse;margin:20px 0;font-size:15px}}.gz-body th,.gz-body td{{border:1px solid var(--line);padding:10px 12px;text-align:left}}.gz-body th{{background:var(--soft)}}
.gz-body img,.gz-body figure{{border-radius:14px;margin:24px 0}}.gz-body figcaption{{font-size:13px;color:var(--muted);text-align:center;margin-top:8px}}
.gz-side{{position:sticky;top:92px;display:grid;gap:18px}}.gz-card{{border:1px solid var(--line);border-radius:16px;padding:20px;background:#fff}}.gz-card h4{{margin:0 0 12px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}}
.gz-toc a{{display:block;padding:7px 0 7px 12px;border-left:2px solid var(--line);color:#334155;font-size:14.5px;line-height:1.4}}.gz-toc a:first-of-type{{border-color:var(--brand);color:var(--brand);font-weight:600}}
.gz-book{{background:linear-gradient(135deg,var(--brand),color-mix(in srgb,var(--brand) 60%,#000));color:#fff;border:0}}.gz-book h4{{color:rgba(255,255,255,.8)}}.gz-book p{{margin:0 0 14px;font-size:15px}}.gz-book a{{display:inline-block;background:#fff;color:var(--brand);font-weight:700;padding:10px 16px;border-radius:999px;font-size:14px}}
.gz-share{{display:flex;gap:8px}}.gz-share span{{width:36px;height:36px;border-radius:50%;border:1px solid var(--line);display:grid;place-items:center;font-size:13px;font-weight:700;color:#475569}}
.gz-sec{{padding:56px 0;border-top:1px solid var(--line);margin-top:56px}}.gz-sec h3{{font-size:26px;margin:0 0 22px}}
.gz-posts{{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:26px}}
.gz-post{{border:1px solid var(--line);border-radius:18px;overflow:hidden;background:#fff;display:flex;flex-direction:column;transition:box-shadow .2s}}.gz-post:hover{{box-shadow:0 12px 30px rgba(15,23,42,.08)}}
.gz-post .ph{{aspect-ratio:16/10;background:linear-gradient(135deg,var(--soft),color-mix(in srgb,var(--brand) 25%,#fff));display:grid;place-items:center;color:var(--brand);font-weight:800;font-size:30px}}.gz-post .ph img{{width:100%;height:100%;object-fit:cover}}
.gz-post .in{{padding:18px 20px 22px;display:flex;flex-direction:column;gap:8px;flex:1}}.gz-post .d{{font-size:12.5px;color:var(--muted);font-weight:600}}.gz-post h5{{font-size:18px;line-height:1.35;margin:0;color:var(--ink)}}.gz-post p{{font-size:14.5px;color:#475569;margin:0}}.gz-post .more{{margin-top:auto;font-weight:700;font-size:14px}}
.gz-new{{outline:3px solid var(--brand);outline-offset:3px;position:relative}}.gz-new::before{{content:'Your new post';position:absolute;top:12px;left:12px;z-index:2;background:var(--brand);color:#fff;font:700 11px/1 system-ui,sans-serif;padding:6px 10px;border-radius:999px}}
.gz-bloghero{{padding:56px 0 34px;text-align:center;background:linear-gradient(180deg,var(--soft),#fff)}}.gz-bloghero h1{{font-size:clamp(30px,4.5vw,48px);margin:10px 0}}.gz-bloghero p{{color:#475569;font-size:17px;margin:0 auto;max-width:620px}}
.gz-foot{{background:#0f172a;color:#cbd5e1;margin-top:40px;padding:40px 0;font-size:14px}}.gz-foot b{{color:#fff;font-size:17px}}
mark{{background:#fde68a;padding:0 2px;border-radius:3px}}
@media(max-width:900px){{.gz-grid{{grid-template-columns:1fr}}.gz-side{{position:static}}.gz-nav a:not(.gz-cta){{display:none}}.gz-body{{font-size:16.5px}}}}
</style>"""


def _header(br: dict[str, Any], blog: str, on: str) -> str:
    logo = f"<img src='{H.escape(br['logo'], quote=True)}' alt=''>" if br["logo"] else ""
    site = H.escape(br["site"] or "#", quote=True)
    return (f"<header class='gz-head'><div class='gz-wrap gz-bar'><a class='gz-logo' href='{site}'>{logo}<span>{H.escape(br['name'])}</span></a>"
            f"<nav class='gz-nav'><a href='{site}'>Home</a><a class='{'on' if on == 'blog' else ''}' href='{H.escape(blog, quote=True)}'>Blog</a><a href='{site}/contact'>Contact</a>"
            f"<a class='gz-cta' href='{site}/contact'>Get in touch</a></nav></div></header>")


def _footer(br: dict[str, Any], b: Business) -> str:
    where = ", ".join(x for x in [b.city or "", b.country or ""] if x)
    return (f"<footer class='gz-foot'><div class='gz-wrap'><b>{H.escape(br['name'])}</b><div>{H.escape(where)}</div>"
            f"<div style='margin-top:14px;opacity:.7'>© {datetime.now().year} {H.escape(br['name'])}. All rights reserved.</div></div></footer>")


def _card(p: dict[str, Any], initial: str, new: bool = False) -> str:
    img = f"<img src='{H.escape(p['image'], quote=True)}' alt=''>" if p.get("image") else H.escape(initial)
    return (f"<a class='gz-post{' gz-new' if new else ''}' href='{H.escape(p['url'], quote=True)}'><div class='ph'>{img}</div><div class='in'>"
            f"<span class='d'>{H.escape(p.get('date') or '')}</span><h5>{H.escape(p['title'])}</h5><p>{H.escape(p.get('excerpt') or '')}</p><span class='more'>Read more →</span></div></a>")


def _toc(body: str) -> list[tuple[str, str]]:
    heads = re.findall(r"<h2\b[^>]*>([\s\S]*?)</h2>", body, re.I)
    out = []
    for i, h in enumerate(heads[:10]):
        text = " ".join(H.unescape(re.sub(r"<[^>]+>", " ", h)).split())
        if text:
            out.append((f"gz-s{i}", text))
    return out


def _with_ids(body: str) -> str:
    n = iter(range(100))
    return re.sub(r"<h2\b", lambda _m: f"<h2 id='gz-s{next(n)}'", body, flags=re.I)


def render(db: Session, b: Business, a: Article, *, view: str, title: str, excerpt: str, body_html: str, image: str | None, url: str, reason: str, mark=None, site_url: str = "") -> dict[str, Any]:
    from .site_preview import article_html
    mark = mark or (lambda h: h)
    br = brand(b, site_url)
    posts, blog = real_posts(db, b, str(a.react_post_id) if a.react_post_id else None)
    blog = blog or (br["site"].rstrip("/") + "/blog" if br["site"] else "#")  # the post list is the Publishing Setup website's own blog API
    initial = (br["name"] or "B")[:1].upper()
    notes = [f"Your website draws its blog in the browser, so its page could not be copied ({reason.rstrip('.')})."
             f" This preview uses your site's brand: {'its logo, ' if br['logo'] else ''}colour {br['color']}{', its fonts' if br['fonts'] or br['family'] else ''}"
             f"{f' and {len(posts)} real posts from its blog API' if posts else ''}. The live page's exact layout may differ."]
    head = f"<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>{H.escape(title)}</title>{_font_link(br)}{_css(br)}</head><body>"
    new = {"title": title, "excerpt": excerpt, "image": image, "date": datetime.now().strftime("%d %b %Y"), "url": url}
    if view == "list":
        cards = _card(new, initial, new=True) + "".join(_card(p, initial) for p in posts[:8])
        page = (head + _header(br, blog, "blog") + f"<section class='gz-bloghero'><div class='gz-wrap'><span class='gz-chip'>Blog</span><h1>{H.escape(br['name'])} Blog</h1>"
                f"<p>Ideas, guides and news from {H.escape(br['name'])}.</p></div></section><main class='gz-wrap' style='padding-top:10px'><div class='gz-posts'>{cards}</div></main>"
                + _footer(br, b) + "</body></html>")
        notes.append(f"Your new post is shown first, then {len(posts[:8])} of your existing posts." if posts else "Your new post is shown as the newest card.")
        return {"html": page, "reference_url": blog, "view": "list", "notes": notes, "source": "brand"}
    body = _with_ids(mark(article_html(body_html, drop_h1=True)))
    words = len(re.findall(r"\w+", re.sub(r"<[^>]+>", " ", body)))
    toc = _toc(body)
    toc_html = ("<div class='gz-card gz-toc'><h4>In this article</h4>" + "".join(f"<a href='#{i}'>{H.escape(t)}</a>" for i, t in toc) + "</div>") if toc else ""
    phone = (b.phone or "").strip()
    book = (f"<div class='gz-card gz-book'><h4>{H.escape(br['name'])}</h4><p>Have a question about this? Talk to us{(' on ' + H.escape(phone)) if phone else ''}.</p>"
            f"<a href='{H.escape(br['site'] or '#', quote=True)}/contact'>Contact us</a></div>")
    share = "<div class='gz-card'><h4>Share</h4><div class='gz-share'><span>f</span><span>in</span><span>X</span><span>✉</span></div></div>"
    cover = f"<div class='gz-cover'>{f'<img src={chr(39)}{H.escape(image, quote=True)}{chr(39)} alt={chr(39)}{chr(39)}>' if image else ''}</div>"
    related = ("<section class='gz-sec'><h3>Related posts</h3><div class='gz-posts'>" + "".join(_card(p, initial) for p in posts[:3]) + "</div></section>") if posts else ""
    page = (head + _header(br, blog, "blog") + "<main class='gz-wrap'>"
            f"<div class='gz-crumb'><a href='{H.escape(br['site'] or '#', quote=True)}'>Home</a> › <a href='{H.escape(blog, quote=True)}'>Blog</a> › {H.escape(title[:60])}</div>"
            f"<div class='gz-hero'><span class='gz-chip'>{H.escape((a.keyword or 'Blog').title()[:40])}</span><h1>{H.escape(title)}</h1>"
            + (f"<p class='gz-lead'>{H.escape(excerpt)}</p>" if excerpt else "")
            + f"<div class='gz-meta'><span class='gz-av'>{H.escape(initial)}</span><b style='color:var(--ink)'>{H.escape(br['name'])}</b><span>{datetime.now().strftime('%d %b %Y')}</span>"
            f"<span>· {max(1, round(words / 220))} min read</span></div></div>{cover}"
            f"<div class='gz-grid'><article class='gz-body'>{body}</article><aside class='gz-side'>{toc_html}{book}{share}</aside></div>{related}</main>" + _footer(br, b) + "</body></html>")
    return {"html": page, "reference_url": url, "view": "post", "notes": notes, "source": "brand"}
