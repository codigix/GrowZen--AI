"""Publishing GrowZen articles to any plain-HTML website, through any deployment adapter (services/html_deploy.py).

How a site keeps its articles is DETECTED from the site itself (nothing is hardcoded to one website or folder):

  data mode   the listing page renders articles with JavaScript from a list in a script file, e.g.
              js/data.js -> `blog: [ {slug, title, date, ..., body}, ... ]`, and article URLs are query based,
              e.g. blog.html?post=<slug>. Publishing adds ONE entry to that list (same fields, same formats, newest
              first), and bumps the listing page's `data.js?v=` so visitors get the new list. The site's own renderer
              shows the card and the full article, so its header, navigation, design and article layout stay as they are.
  page mode   each article is its own HTML page, /blog/<slug>/ (index.html) or /blog/<slug>.html. Publishing writes the
              article page built FROM one of the site's own article pages (same header, footer, CSS, fonts), its image,
              and the listing page with a copy of one of its own article cards.

Both modes: the deployment root is found by locating the listing file in the source; an article GrowZen published
before is updated in place (never a second copy); an existing article or page that GrowZen did not make is never
overwritten (the slug gets -2, -3 ...); only the files of that one article are written.

Article status on the HTML website (kept with the connection, config["html_site"]["posts"][article_id]):
  publishing -> uploading -> deploying -> published | failed;  exported (manual: files prepared to upload by hand).
"""
import copy
import hashlib
import io
import json
import logging
import posixpath
import re
import threading
import time
import zipfile
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup

from ..db import SessionLocal
from ..models import Article, Business, SiteIntegration
from . import articles as svc, featured_images as fi, html_deploy as hd
from .net import site_client
from .site_adapters import slugify

log = logging.getLogger("seo.html_publish")
KEY = "html_site"
CHECK_FILE = ".well-known/growzen-deploy-check.txt"
FTP_ROOTS = ("", "public_html", "www", "htdocs", "httpdocs", "html", "web")
_SKIP = ("/", "#", "http:", "https:", "mailto:", "tel:", "data:", "javascript:", "//")
_MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"
_DATE = re.compile(rf"\b(?:{_MONTHS}|{_MONTHS[:3]})[a-z]*\.?\s+\d{{1,2}},?\s+\d{{4}}\b|\b\d{{1,2}}\s+(?:{_MONTHS})[a-z]*\s+\d{{4}}\b|\b\d{{1,2}}\s+[A-Z][a-z]{{2}}\s+\d{{4}}\b|\b\d{{4}}-\d{{2}}-\d{{2}}\b", re.I)
_READ = re.compile(r"\b\d+\s*min(?:ute)?s?\s+read\b", re.I)
_busy: set[int] = set()
_busy_lock = threading.Lock()


class PublishError(Exception):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── connection state (inside site_integrations.config["html_site"]) ─────────────

def settings_of(row: SiteIntegration | None) -> dict:
    return ((row.config or {}).get(KEY) if row else None) or {}


def _row(db, business_id: int) -> SiteIntegration | None:
    return db.query(SiteIntegration).filter(SiteIntegration.business_id == business_id).one_or_none()


def update_state(business_id: int, fn) -> dict:
    """Change the HTML site settings in a fresh session (background jobs); other keys of the row are untouched."""
    db = SessionLocal()
    try:
        row = _row(db, business_id)
        if not row:
            return {}
        s = copy.deepcopy(settings_of(row))
        fn(s)
        row.config = {**(row.config or {}), KEY: s}
        db.commit()
        return s
    finally:
        db.close()


VOLATILE = ("updated_at", "tested_at", "connection_test")


def fingerprint(s: dict) -> str:
    """Changes whenever the deployment changes (settings saved in the app, or the server config entry), so an old test
    result never counts for a new setup. Secrets are hashed in their encrypted form only."""
    stored = s.get("deploy")
    if stored and stored.get("adapter"):
        basis = {k: v for k, v in stored.items() if k not in VOLATILE}
    else:
        basis = hd.load_entry(s.get("website_url", "")) or {}
    return hashlib.sha256(json.dumps(basis, sort_keys=True, default=str).encode()).hexdigest()[:16]


def deploy_ready(s: dict) -> bool:
    t = s.get("deploy_test") or {}
    try:
        return t.get("status") == "ok" and t.get("fingerprint") == fingerprint(s)
    except hd.DeployError:
        return False


def deployer(s: dict) -> hd.Deployer:
    return hd.for_site(s["website_url"], s.get("deploy"))


def log_event(business_id: int, action: str, ok: bool, detail: str, article_id: int | None = None) -> None:
    """The deployment log shown on the connection (last 60 events). Never contains a credential."""
    def fn(s):
        entries = s.setdefault("log", [])
        entries.insert(0, {"at": _now(), "action": action, "ok": ok, "detail": detail[:400], **({"article_id": article_id} if article_id else {})})
        del entries[60:]
    update_state(business_id, fn)


def backup(business_id: int, files: dict[str, bytes]) -> str | None:
    """Keep GrowZen's own copy of every existing file a publish replaces (uploads/html_backups/...), for recovery."""
    if not files:
        return None
    base = BACKUP_ROOT or (fi.UPLOAD_ROOT / "html_backups")
    folder = base / str(business_id) / datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    for p, data in files.items():
        dest = (folder / p).resolve()
        if folder.resolve() in dest.parents:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
    return f"html_backups/{folder.relative_to(base).as_posix()}"


BACKUP_ROOT = None  # None: <uploads>/html_backups (tests point it at a temporary folder)


# ── a small JavaScript literal scanner (strings, template literals, comments, nesting) ─────────────

def _skip_str(t: str, i: int) -> int:
    """Index just after the string/template literal that starts at t[i]."""
    q, i = t[i], i + 1
    depth = 0
    while i < len(t):
        ch = t[i]
        if ch == "\\":
            i += 2
            continue
        if q == "`" and ch == "$" and t[i + 1:i + 2] == "{":
            depth += 1
            i += 2
            continue
        if q == "`" and depth and ch == "}":
            depth -= 1
        elif ch == q and not depth:
            return i + 1
        i += 1
    return i


def _skip_comment(t: str, i: int) -> int:
    if t.startswith("//", i):
        j = t.find("\n", i)
        return len(t) if j < 0 else j
    if t.startswith("/*", i):
        j = t.find("*/", i + 2)
        return len(t) if j < 0 else j + 2
    return i


def _close(t: str, i: int) -> int:
    """Index of the bracket that closes the one at t[i] ('[' or '{')."""
    stack, j = [], i
    pair = {"[": "]", "{": "}", "(": ")"}
    while j < len(t):
        ch = t[j]
        if ch in "'\"`":
            j = _skip_str(t, j)
            continue
        if t.startswith(("//", "/*"), j):
            j = _skip_comment(t, j)
            continue
        if ch in pair:
            stack.append(pair[ch])
        elif stack and ch == stack[-1]:
            stack.pop()
            if not stack:
                return j
        j += 1
    raise ValueError("unbalanced brackets")


def _objects(t: str, a: int, b: int) -> list[tuple[int, int]]:
    """(start, end) of each top-level {...} inside the array t[a]..t[b]."""
    out, j = [], a + 1
    while j < b:
        ch = t[j]
        if ch in "'\"`":
            j = _skip_str(t, j)
        elif t.startswith(("//", "/*"), j):
            j = _skip_comment(t, j)
        elif ch == "{":
            e = _close(t, j)
            out.append((j, e))
            j = e + 1
        elif ch == "[":
            j = _close(t, j) + 1
        else:
            j += 1
    return out


def _fields(t: str, s: int, e: int) -> dict[str, str]:
    """Top-level properties of the object t[s]..t[e]: key -> raw value text (in order)."""
    out, j = {}, s + 1
    while j < e:
        while j < e and (t[j] in " \t\r\n," or t.startswith(("//", "/*"), j)):
            j = _skip_comment(t, j) if t.startswith(("//", "/*"), j) else j + 1
        if j >= e:
            break
        if t[j] in "'\"":
            k_end = _skip_str(t, j)
            key = t[j + 1:k_end - 1]
            j = k_end
        else:
            m = re.match(r"[A-Za-z_$][\w$]*", t[j:])
            if not m:
                break
            key, j = m.group(0), j + m.end()
        while j < e and t[j] in " \t":
            j += 1
        if j >= e or t[j] != ":":
            break
        j += 1
        v = j
        while j < e:
            ch = t[j]
            if ch in "'\"`":
                j = _skip_str(t, j)
            elif ch in "[{(":
                j = _close(t, j) + 1
            elif t.startswith(("//", "/*"), j):
                j = _skip_comment(t, j)
            elif ch == ",":
                break
            else:
                j += 1
        out[key] = t[v:j].strip()
        j += 1
    return out


def _js_str(raw: str) -> str | None:
    """The text of a simple JS string literal ("..", '..' or `..` without ${}); None when it is not one."""
    raw = (raw or "").strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "'\"`" and "${" not in raw:
        body = raw[1:-1]
        if raw[0] == '"':
            try:
                return json.loads(raw)
            except ValueError:
                pass
        return body.replace("\\" + raw[0], raw[0]).replace("\\\\", "\\")
    return None


# ── detecting how the site keeps its articles ───────────────────────────────────

def _host(u: str | None) -> str:
    h = (urlsplit(u or "").hostname or "").lower()
    return h[4:] if h.startswith("www.") else h


def _links_into(html: str, page_url_path: str, folder: str, site_url: str = "") -> list[str]:
    """Root-relative URL paths of links on a page that point into the articles folder (the folder page itself
    excluded). Relative links and absolute links to this website count; links to other websites do not."""
    base = f"/{folder.strip('/')}/"
    own = _host(site_url)
    out = []
    for a in BeautifulSoup(html, "html.parser").find_all("a", href=True):
        href = a["href"].strip()
        if href.startswith(("mailto:", "tel:", "javascript:", "#")):
            continue
        p = urlsplit(urljoin("https://site.invalid" + page_url_path, href))
        host = (p.hostname or "").lower().removeprefix("www.")
        if host not in ("site.invalid", "") and host != own:
            continue
        if p.path.startswith(base) and p.path.rstrip("/") != base.rstrip("/") and not re.search(r"\.(?:png|jpe?g|gif|webp|svg|css|js|pdf)$", p.path, re.I):
            out.append(p.path)
    return list(dict.fromkeys(out))


def _scripts(html: str, page_url_path: str, site_url: str) -> list[str]:
    """Root-relative paths (no query) of the site's own script files on a page."""
    own, out = _host(site_url), []
    for s in BeautifulSoup(html, "html.parser").find_all("script", src=True):
        p = urlsplit(urljoin("https://site.invalid" + page_url_path, s["src"].strip()))
        if (p.hostname or "").lower().removeprefix("www.") in ("site.invalid", own) and p.path.endswith(".js"):
            out.append(p.path.lstrip("/"))
    return list(dict.fromkeys(out))


_URL_TPL = re.compile(r"""([\w\-./]*\.html?)\?([A-Za-z_]\w*)=\$\{\s*(?:encodeURIComponent\(\s*)?[A-Za-z_$][\w$]*\.([A-Za-z_$][\w$]*)""")


def _find_store(js: str, slug_field: str | None) -> dict | None:
    """The array of article objects in a script: {key, start, end, entries, sample, slug_field}. None if there is none."""
    best = None
    for m in re.finditer(r"(?:([A-Za-z_$][\w$]*)\s*:\s*|(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*|\.([A-Za-z_$][\w$]*)\s*=\s*)\[", js):
        a = m.end() - 1
        try:
            b = _close(js, a)
            objs = _objects(js, a, b)
        except ValueError:
            continue
        if not objs:
            continue
        sample = _fields(js, *objs[0])
        keys = {k.lower(): k for k in sample}
        sf = slug_field if slug_field and slug_field in sample else next((keys[k] for k in ("slug", "id", "key", "permalink") if k in keys), None)
        if not sf or "title" not in keys or not any(k in keys for k in ("body", "content", "html", "text", "excerpt", "summary")):
            continue
        name = m.group(1) or m.group(2) or m.group(3)
        score = (2 if re.search(r"blog|post|article|news", name, re.I) else 0) + (1 if sf == slug_field else 0)
        if not best or score > best["score"]:
            best = {"key": name, "start": a, "end": b, "entries": objs, "sample": sample, "slug_field": sf, "score": score}
    return best


def detect(site_url: str, listing_file: str, folder: str, listing_html: str, fetch) -> dict:
    """How this website keeps its articles. `fetch(path)` returns a live file's text (or None). Read-only."""
    listing_url_path = "/" + listing_file.lstrip("/")
    tpl = None
    texts: dict[str, str] = {}
    for path in _scripts(listing_html, listing_url_path, site_url)[:12]:
        txt = fetch(path)
        if txt:
            texts[path] = txt
            tpl = tpl or _URL_TPL.search(txt)
    for m in re.finditer(r"""href\s*=\s*["']([\w\-./]*\.html?)\?([A-Za-z_]\w*)=[^"'&]+["']""", listing_html):  # server-rendered ?post= links
        tpl = tpl or m
    slug_field = tpl.group(3) if tpl and tpl.lastindex and tpl.lastindex >= 3 else None
    for path, txt in texts.items():
        store = _find_store(txt, slug_field)
        if store:
            slugs = [_js_str(_fields(txt, s, e).get(store["slug_field"], "")) for s, e in store["entries"]]
            page = (tpl.group(1).lstrip("./") if tpl else listing_file)
            param = tpl.group(2) if tpl else "post"
            return {"mode": "data", "data_file": path, "array_key": store["key"], "slug_field": store["slug_field"], "page": page, "param": param,
                    "count": len(store["entries"]), "slugs": [s for s in slugs if s][:50], "fields": list(store["sample"]),
                    "url_pattern": f"{site_url.rstrip('/')}/{page}?{param}=<article-slug>", "url_known": bool(tpl)}
    links = _links_into(listing_html, listing_url_path, folder, site_url)
    style = "folder" if links and sum(p.endswith("/") for p in links) * 2 >= len(links) else "file"
    return {"mode": "pages", "style": style, "count": len(links), "links": links[:50],
            "url_pattern": f"{site_url.rstrip('/')}/{folder}/<article-slug>/" if style == "folder" else f"{site_url.rstrip('/')}/{folder}/<article-slug>.html"}


# ── paths ───────────────────────────────────────────────────────────────────────

def _title(html: str) -> str:
    m = re.search(r"<title[^>]*>([\s\S]*?)</title>", html or "", re.I)
    return " ".join(m.group(1).split()) if m else ""


def find_root(dep: hd.Deployer, listing_file: str, live_html: str | None) -> str:
    """The folder of the source that is served as the website root."""
    if dep.root or dep.name == "manual":
        return dep.root
    paths = dep.list_paths()
    if paths is None:  # FTP/SFTP: try the usual web folders, then the other top-level folders of the login
        live_title = _title(live_html or "")
        extra = [d for d in (dep.list_dir(".") if hasattr(dep, "list_dir") else []) if d and not d.startswith(".") and d not in FTP_ROOTS][:25]
        for cand in (*FTP_ROOTS, *extra):
            dep.root = cand
            data = dep.read(listing_file)
            if data and (not live_title or _title(data.decode("utf-8", "replace")) == live_title):
                return cand
        dep.root = ""
        raise PublishError(f"{listing_file} was not found on the server (tried {', '.join(r or '/' for r in FTP_ROOTS)}). Set \"root\" for this website in the deployment configuration.")
    hits = [p[: -len(listing_file)].rstrip("/") for p in paths if p == listing_file or p.endswith("/" + listing_file)]
    if not hits:
        raise PublishError(f"{listing_file} was not found in the {dep.name} source. Check the Blog Listing HTML File, or set \"root\" in the deployment configuration.")
    if len(hits) > 1 and live_html:
        for h in sorted(hits, key=len):
            src = dep.read(posixpath.join(h, listing_file) if h else listing_file)
            if src and _title(src.decode("utf-8", "replace")) == _title(live_html):
                return h
    return sorted(hits, key=len)[0]


def file_for(url_path: str, known: set[str] | None) -> str:
    p = url_path.lstrip("/")
    if not p or p.endswith("/"):
        return p + "index.html"
    if re.search(r"\.html?$", p, re.I):
        return p
    for cand in (p + ".html", p + "/index.html"):
        if known is not None and cand in known:
            return cand
    return p + "/index.html"


# ── the article's values ────────────────────────────────────────────────────────

def article_info(a: Article, b: Business, url: str, image_url: str | None) -> dict:
    body = svc._SCHEMA_RE.sub("\n", a.body or "")
    body = re.sub(r"^\s*<h1\b[^>]*>[\s\S]*?</h1>", "", body.strip(), count=1, flags=re.I)  # the site shows the title itself
    words = len(svc._text(body).split())
    now = datetime.now(timezone.utc)
    return {"title": a.title or a.keyword, "description": a.meta_description or "", "body": body.strip(), "url": url, "image": image_url,
            "image_alt": a.featured_image_alt or a.title or "", "now": now, "date": f"{now:%B} {now.day}, {now.year}", "iso": now.isoformat(timespec="seconds"),
            "minutes": max(1, round(words / 200)), "category": (a.topic or a.keyword or "").strip().title(), "author": b.name, "id": a.id,
            "keywords": [k for k in [a.keyword, *(a.secondary_keywords or [])] if k],
            "schema": svc.article_schema(title=a.title or a.keyword, description=a.meta_description or "", body=a.body or "", primary=a.keyword,
                                         secondary=a.secondary_keywords or [], b=b, url=url, published=now, modified=now, topic=a.topic, image_url=image_url)}


def _date_like(sample: str | None, d: datetime) -> str:
    """The date in the same format as the site's existing articles."""
    s = (sample or "").strip()
    mon, Mon = d.strftime("%b"), d.strftime("%B")
    if re.fullmatch(r"\d{2} [A-Z][a-z]{2} \d{4}", s):
        return f"{d.day:02d} {mon} {d.year}"
    if re.fullmatch(r"\d{1,2} [A-Z][a-z]{2} \d{4}", s):
        return f"{d.day} {mon} {d.year}"
    if re.fullmatch(r"\d{1,2} [A-Z][a-z]+ \d{4}", s):
        return f"{d.day} {Mon} {d.year}"
    if re.fullmatch(r"[A-Z][a-z]{2} \d{1,2}, \d{4}", s):
        return f"{mon} {d.day}, {d.year}"
    if re.fullmatch(r"[A-Z][a-z]+ \d{1,2}, \d{4}", s):
        return f"{Mon} {d.day}, {d.year}"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}.*", s):
        return d.strftime("%Y-%m-%d")
    if re.fullmatch(r"\d{2}/\d{2}/\d{4}", s):
        return d.strftime("%d/%m/%Y")
    return f"{d.day:02d} {mon} {d.year}"


# ── data mode: one entry in the site's article list ─────────────────────────────

def _lit(value: str, like: str | None) -> str:
    """A JS literal for a text, in the quoting style of the site's own value (template literal for long HTML)."""
    if (like or "").strip().startswith("`"):
        return "`" + value.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${") + "`"
    if (like or "").strip().startswith("'"):
        return "'" + value.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n") + "'"
    return json.dumps(value, ensure_ascii=False)


def data_entry(sample: dict[str, str], info: dict, slug: str, image_path: str | None, next_id: int | None) -> dict[str, str]:
    """The new article as the site's own fields (same keys, same order, same formats). Unknown fields are left out."""
    out: dict[str, str] = {}
    for key, raw in sample.items():
        k = key.lower()
        sv = _js_str(raw)
        if k in ("slug", "permalink"):
            out[key] = _lit(slug, raw)
        elif k == "id":
            out[key] = str(next_id) if raw.strip().isdigit() and next_id is not None else _lit(slug, raw)
        elif k in ("title", "name", "heading", "headline"):
            out[key] = _lit(info["title"], raw)
        elif k in ("date", "published", "publishedat", "published_at", "pubdate", "created"):
            out[key] = _lit(_date_like(sv, info["now"]), raw)
        elif k in ("author", "by", "writer"):
            out[key] = _lit(info["author"], raw)
        elif k in ("cat", "category", "section", "topic"):
            out[key] = _lit(info["category"], raw)
        elif k in ("read", "readtime", "read_time", "readingtime", "reading_time", "duration"):
            out[key] = str(info["minutes"]) if raw.strip().isdigit() else _lit(_READ.sub(f"{info['minutes']} min read", sv) if sv and _READ.search(sv) else f"{info['minutes']} min read", raw)
        elif k in ("excerpt", "summary", "description", "desc", "intro", "teaser"):
            out[key] = _lit(info["description"], raw)
        elif k in ("body", "content", "html", "text", "article"):
            out[key] = _lit("\n" + info["body"] + "\n", raw)
        elif k in ("tags", "keywords") and raw.strip().startswith("["):
            out[key] = json.dumps(info["keywords"], ensure_ascii=False)
        elif k in ("image", "img", "thumbnail", "thumb", "photo", "picture", "featured", "featuredimage", "featured_image", "cover", "coverimage", "banner", "hero", "bg", "background"):
            css = sv is not None and re.search(r"gradient\(|url\(|#[0-9a-f]{3}|rgb", sv, re.I)
            if image_path:
                out[key] = _lit(f"url('{image_path}') center/cover no-repeat" if css else image_path, raw)
            elif css or sv == "":
                out[key] = raw  # keep the site's own default look (e.g. its gradient)
        elif k in ("icon", "emoji", "color", "colour", "theme", "accent", "badge"):
            out[key] = raw  # a style value: the same as the site's newest article
    out["growzenId"] = str(info["id"])  # identifies GrowZen's own entry (republishing updates it); the renderer ignores it
    return out


def _entry_text(fields: dict[str, str], ind: str, find: str) -> str:
    return "{\n" + ",\n".join(f"{find}{k}: {v}" for k, v in fields.items()) + f"\n{ind}}}"


def write_data(js: str, store_key: str, slug_field: str, info: dict, slug_wanted: str, image_path: str | None, art_id: int) -> tuple[str, str, str]:
    """The script with the article added at the top of its list (or GrowZen's earlier entry replaced).
    Returns (new js, slug used, note)."""
    store = _find_store(js, slug_field)
    if not store or store["key"] != store_key:
        raise PublishError(f"The article list '{store_key}' was not found in the script any more. Check the website again.")
    entries = store["entries"]
    parsed = [(s, e, _fields(js, s, e)) for s, e in entries]
    mine = next(((s, e) for s, e, f in parsed if f.get("growzenId", "").strip() == str(art_id)), None)
    taken = {(_js_str(f.get(slug_field, "")) or "") for s, e, f in parsed if (s, e) != mine}
    slug = slug_wanted
    n = 2
    while slug in taken:
        slug, n = f"{slug_wanted}-{n}", n + 1
    ids = [int(f["id"]) for _, _, f in parsed if f.get("id", "").strip().isdigit()]
    s0 = entries[0][0]
    line_start = js.rfind("\n", 0, s0) + 1
    ind = js[line_start:s0] if js[line_start:s0].strip() == "" else "    "
    first_key = re.search(r"\n([ \t]+)[A-Za-z_$'\"]", js[s0:entries[0][1]])
    find = first_key.group(1) if first_key else ind + "  "
    fields = data_entry(store["sample"], info, slug, image_path, (max(ids) + 1) if ids else None)
    text = _entry_text(fields, ind, find)
    if mine:
        return js[:mine[0]] + text + js[mine[1] + 1:], slug, f"Updated GrowZen's earlier entry in the '{store_key}' list"
    a = store["start"]
    return js[:a + 1] + "\n" + ind + text + "," + js[a + 1:], slug, f"Added the article at the top of the '{store_key}' list ({len(entries)} existing article(s) kept)"


def bump_version(html: str, script_path: str) -> str:
    """The page with `<script src="script?v=N">` raised to a new version (cache refresh); every other byte unchanged."""
    def repl(m):
        old = m.group(2) or ""
        new = str(int(old) + 1) if old.isdigit() else datetime.now(timezone.utc).strftime("%Y%m%d%H%M")
        return f"{m.group(1)}?v={new}"
    pat = re.compile(r"(" + re.escape(script_path) + r")(?:\?v=([\w.\-]*))?(?=[\"'])")
    return pat.sub(repl, html)


# ── page mode: the article as its own page, built from the site's own page ──────

def _absolutize(soup: BeautifulSoup, page_url_path: str) -> None:
    for tag in soup.find_all(True):
        for attr in ("href", "src", "poster", "action", "data-src"):
            v = tag.get(attr)
            if isinstance(v, str) and v.strip() and not v.strip().lower().startswith(_SKIP):
                p = urlsplit(urljoin("https://site.invalid" + page_url_path, v.strip()))
                tag[attr] = p.path + (f"?{p.query}" if p.query else "") + (f"#{p.fragment}" if p.fragment else "")


def _container(soup: BeautifulSoup):
    for sel in ("article", "main", "[role=main]"):
        found = soup.select(sel)
        if found:
            return max(found, key=lambda e: len(e.get_text(" ", strip=True)))
    cand = [e for e in soup.find_all(["div", "section"]) if re.search(r"content|post|entry|article|blog", " ".join(e.get("class") or []) + " " + (e.get("id") or ""), re.I)]
    return max(cand, key=lambda e: len(e.get_text(" ", strip=True))) if cand else (soup.body or soup)


def _prose(container):
    best, n_best = container, len(container.find_all("p", recursive=False))
    for e in container.find_all(["div", "section", "article"]):
        if e.find("h1"):
            continue
        n = len(e.find_all("p", recursive=False))
        if n > n_best:
            best, n_best = e, n
    return best


def _meta_text(template_text: str, date_txt: str, minutes: int) -> str:
    t = template_text or ""
    if _DATE.search(t) or _READ.search(t):
        return _READ.sub(f"{minutes} min read", _DATE.sub(date_txt, t, count=1), count=1)
    return f"{date_txt} · {minutes} min read"


def _set_text(tag, text: str) -> None:
    inner = tag.find("a") if tag.find("a") and len(tag.find_all(string=True)) <= 3 else None
    (inner or tag).clear()
    (inner or tag).append(text)


def _set_meta(soup, attr: str, key: str, value: str | None, create: bool = False) -> None:
    if value is None:
        return
    tag = soup.find("meta", attrs={attr: key})
    if tag:
        tag["content"] = value
    elif create and soup.head:
        soup.head.append(soup.new_tag("meta", attrs={attr: key, "content": value}))


def build_article(template_html: str, template_url_path: str, info: dict, image_path: str | None) -> str:
    soup = BeautifulSoup(template_html, "html.parser")
    for s in soup.find_all("script", src=re.compile(r"/\.netlify/")):  # a host-injected toolbar of a live page
        s.decompose()
    _absolutize(soup, template_url_path)
    c = _container(soup)
    old_h1 = c.find("h1") or soup.find("h1")
    old_title = soup.title.get_text(" ", strip=True) if soup.title else ""
    suffix = next((sep + old_title.rsplit(sep, 1)[1] for sep in (" | ", " – ", " — ", " - ") if sep in old_title), "")
    if soup.title:
        soup.title.string = info["title"] + suffix
    _set_meta(soup, "name", "description", info["description"], create=True)
    canon = soup.find("link", rel="canonical")
    if canon:
        canon["href"] = info["url"]
    for k, v in (("og:title", info["title"]), ("og:description", info["description"]), ("og:url", info["url"]), ("og:image", info["image"]),
                 ("og:type", "article"), ("article:published_time", info["iso"])):
        _set_meta(soup, "property", k, v)
    for k, v in (("twitter:title", info["title"]), ("twitter:description", info["description"]), ("twitter:image", info["image"])):
        _set_meta(soup, "name", k, v)
    for s in soup.find_all("script", type="application/ld+json"):
        if re.search(r'"@type"\s*:\s*"(?:BlogPosting|Article|NewsArticle|FAQPage)"', s.get_text() or ""):
            s.decompose()
    if soup.head:
        soup.head.append(BeautifulSoup(info["schema"], "html.parser"))
        soup.head.append(soup.new_tag("meta", attrs={"name": "growzen-article-id", "content": str(info["id"])}))
    if old_h1 is not None and c.find("h1") is old_h1:
        for sib in old_h1.find_previous_siblings():
            if len(sib.get_text(strip=True)) <= 40 and not sib.find(["a", "img", "h1", "h2"]):
                _set_text(sib, info["category"])
                break
        meta = next((s for s in old_h1.find_next_siblings() if (_DATE.search(s.get_text()) or _READ.search(s.get_text()) or re.search(r"\bby\b|·", s.get_text(), re.I))
                     and len(s.get_text(strip=True)) < 160), None)
        if meta:
            _set_text(meta, _meta_text(meta.get_text(" ", strip=True), info["date"], info["minutes"]))
        _set_text(old_h1, info["title"])
    else:
        h1 = soup.new_tag("h1")
        h1.string = info["title"]
        c.insert(0, h1)
    img = c.find("img")
    if img is not None:
        if image_path:
            img["src"], img["alt"] = image_path, info["image_alt"]
            for k in ("srcset", "sizes", "width", "height"):
                img.attrs.pop(k, None)
        else:
            (img.find_parent("figure") or img).decompose()
    prose = _prose(c)
    fresh = BeautifulSoup(info["body"], "html.parser")
    if prose is c:
        keep = {id(x) for x in (c.find("h1"), c.find("img"))}
        for child in list(c.find_all(["p", "h2", "h3", "h4", "ul", "ol", "blockquote", "table", "pre"], recursive=False)):
            if id(child) not in keep and not (_DATE.search(child.get_text()) and len(child.get_text(strip=True)) < 160):
                child.decompose()
        c.append(fresh)
    else:
        prose.clear()
        prose.append(fresh)
    return str(soup)


def _card_of(link, article_paths: set[str], page_url_path: str):
    best = None
    for anc in link.parents:
        if anc.name in ("body", "html", "[document]", "main") or anc.get("role") == "main":
            break
        hrefs = {urlsplit(urljoin("https://site.invalid" + page_url_path, x["href"])).path for x in anc.find_all("a", href=True)}
        if len(hrefs & article_paths) == 1:
            best = anc
        else:
            break
    return best


def update_listing(listing_html: str, listing_url_path: str, folder: str, new_url_path: str, info: dict, image_path: str | None, site_url: str = "") -> tuple[str, str]:
    soup = BeautifulSoup(listing_html, "html.parser")
    paths = set(_links_into(listing_html, listing_url_path, folder, site_url))
    path_of = lambda a: urlsplit(urljoin("https://site.invalid" + listing_url_path, a["href"])).path  # noqa: E731
    links = [a for a in soup.find_all("a", href=True) if path_of(a) in paths]
    mine = next((a for a in links if path_of(a) == new_url_path), None)
    template = mine or (links[0] if links else None)
    card = _card_of(template, paths, listing_url_path) if template is not None else None

    def fill(el):
        for a in el.find_all("a", href=True):
            if path_of(a) in paths:
                a["href"] = new_url_path
        if el.name == "a":
            el["href"] = new_url_path
        head = el.find(["h1", "h2", "h3", "h4", "h5", "h6"])
        if head:
            _set_text(head, info["title"])
        for t in el.find_all(["p", "span", "time", "small", "div"]):
            txt = t.get_text(" ", strip=True)
            if not t.find(["p", "div", "h2", "h3"]) and (_DATE.search(txt) or _READ.search(txt)) and len(txt) < 160:
                _set_text(t, _meta_text(txt, info["date"], info["minutes"]))
        paras = [p for p in el.find_all("p") if not (_DATE.search(p.get_text()) or _READ.search(p.get_text())) and len(p.get_text(strip=True)) > 30]
        if paras:
            _set_text(max(paras, key=lambda p: len(p.get_text())), info["description"])
        img = el.find("img")
        if img is not None:
            if image_path:
                img["src"], img["alt"] = image_path, info["image_alt"]
                for k in ("srcset", "sizes"):
                    img.attrs.pop(k, None)
            else:
                fig = img.find_parent("figure")
                (fig if fig is not None and el in fig.parents else img).decompose()
        if head:
            for sib in head.find_previous_siblings():
                if len(sib.get_text(strip=True)) <= 40 and not sib.find(["a", "img"]) and not _DATE.search(sib.get_text()):
                    _set_text(sib, info["category"])
                    break

    if card is not None and mine is not None:
        fill(card)
        return str(soup), "Updated the article's card on the listing page"
    if card is not None:
        new = copy.copy(card)
        fill(new)
        card.insert_before(new)
        card.insert_before("\n")
        return str(soup), "Added the article's card at the top of the listing (same design as the existing cards)"
    block = BeautifulSoup(f'<article class="growzen-post"><h2><a href="{new_url_path}">{_esc(info["title"])}</a></h2><p>{_esc(info["date"])} · {info["minutes"]} min read</p>'
                          f'<p>{_esc(info["description"])}</p><p><a href="{new_url_path}">Read more →</a></p></article>', "html.parser")
    _container(soup).append(block)
    return str(soup), "Added the first article card to the listing page"


def _esc(t: str) -> str:
    return (t or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


# ── preparing the files of one publish (both modes) ─────────────────────────────

def _live(url: str) -> str | None:
    try:
        with site_client(20) as c:
            r = c.get(url)
            return r.text if r.status_code < 400 else None
    except hd.errors():
        return None


def prepare(s: dict, dep: hd.Deployer, a: Article, b: Business, steps: list[dict]) -> dict:
    """Everything one publish writes: {files, url, slug, mode, verify}. Reads the site source (or the live site)."""
    site, listing, folder = s["website_url"].rstrip("/"), s["listing_file"], s["articles_folder"].strip("/")
    listing_url_path = "/" + listing.lstrip("/")
    live_listing = _live(site + listing_url_path)
    dep.root = find_root(dep, listing, live_listing)
    known = set(dep.list_paths() or []) if dep.can_read else None

    def source(path: str) -> str | None:
        data = dep.read(path) if dep.can_read else None
        return data.decode("utf-8", "replace") if data else _live(f"{site}/{path.lstrip('/')}")

    listing_html = source(listing)
    if not listing_html:
        raise PublishError(f"Could not read {listing} from the website or its source.")
    shape = detect(site, listing, folder, listing_html, source)
    steps.append({"step": "Read the website", "ok": True, "detail": f"{listing} from the {'source (' + dep.name + ')' if dep.can_read else 'live website'}"
                  + (f", served from '/{dep.root}'" if dep.root else "")
                  + (f". Articles are kept in {shape['data_file']} ('{shape['array_key']}' list, {shape['count']} article(s))" if shape["mode"] == "data"
                     else f". Articles are pages in /{folder}/ ({shape['count']} found)")})
    prev = (s.get("posts") or {}).get(str(a.id)) or {}
    base_slug = slugify(a.title or a.keyword)
    files: dict[str, bytes] = {}
    img_src = fi.path_of(a.featured_image_path)

    if shape["mode"] == "data":
        image_file = f"{folder}/{base_slug}.webp" if img_src else None  # into the existing blog folder (e.g. /blog/<slug>.webp)
        image_path = "/" + image_file if image_file else None
        js = source(shape["data_file"])
        if not js:
            raise PublishError(f"Could not read {shape['data_file']}.")
        info = article_info(a, b, "", site + image_path if image_path else None)
        new_js, slug, note = write_data(js, shape["array_key"], shape["slug_field"], info, prev.get("slug") or base_slug, image_path, a.id)
        url = f"{site}/{shape['page']}?{shape['param']}={slug}"
        files[shape["data_file"]] = new_js.encode("utf-8")
        if image_file:
            files[image_file] = img_src.read_bytes()
        bumped = bump_version(listing_html, shape["data_file"])
        if bumped != listing_html:
            files[listing] = bumped.encode("utf-8")
        steps.append({"step": "Prepare the files", "ok": True, "detail": f"{note}. Files: {', '.join(files)}"
                      + (f" ({listing}: only the {shape['data_file']} version number changes, so visitors load the new list)" if listing in files else "")
                      + ". Header, navigation, design and article layout stay the site's own (its script shows the article)."})
        return {"files": files, "url": url, "slug": slug, "mode": "data", "verify": (f"{site}/{shape['data_file']}", slug)}

    # page mode
    existing = shape.get("links") or []
    style = shape.get("style") or "folder"
    url_path = prev.get("url_path")
    if not url_path:
        for n in range(1, 50):
            slug = base_slug if n == 1 else f"{base_slug}-{n}"
            cand = f"/{folder}/{slug}/" if style == "folder" else f"/{folder}/{slug}.html"
            f = file_for(cand, known)
            other = (f in known) if known is not None else (cand in existing)
            if other and dep.can_read:
                other = f'name="growzen-article-id" content="{a.id}"' not in (dep.read(f) or b"").decode("utf-8", "replace")
            if not other:
                url_path = cand
                break
        else:
            raise PublishError("Could not find a free address for this article.")
    page_file = file_for(url_path, known)
    tpl_url_path, tpl_html = None, None
    for p in [x for x in existing if x != url_path][:3]:
        html_txt = source(file_for(p, known)) if dep.can_read else _live(site + p)
        if html_txt:
            tpl_url_path, tpl_html = p, html_txt
            break
    if not tpl_html:
        tpl_url_path, tpl_html = listing_url_path, listing_html
    image_file = image_path = None
    if img_src:
        tpl_img = BeautifulSoup(tpl_html, "html.parser").select_one("article img, main img")
        img_dir = None
        if tpl_img and tpl_img.get("src") and not str(tpl_img["src"]).startswith(("http:", "https:", "data:", "//")):
            img_dir = posixpath.dirname(urlsplit(urljoin("https://site.invalid" + tpl_url_path, tpl_img["src"])).path).lstrip("/")
        image_file = f"{img_dir or folder + '/images'}/{url_path.strip('/').rsplit('/', 1)[-1].removesuffix('.html')}.webp"
        image_path = "/" + image_file
    url = site + url_path
    info = article_info(a, b, url, site + image_path if image_path else None)
    files[page_file] = build_article(tpl_html, tpl_url_path, info, image_path).encode("utf-8")
    if image_file:
        files[image_file] = img_src.read_bytes()
    new_listing, note = update_listing(listing_html, listing_url_path, folder, url_path, info, image_path, site)
    files[listing] = new_listing.encode("utf-8")
    steps.append({"step": "Prepare the files", "ok": True, "detail": f"Template: {tpl_url_path} (the site's own design). {note}. Files: {', '.join(files)}. No other file is changed."})
    return {"files": files, "url": url, "url_path": url_path, "slug": url_path.strip("/").rsplit("/", 1)[-1].removesuffix(".html"), "mode": "pages",
            "verify": (url, f'content="{a.id}"')}


def export_zip(prep: dict, s: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for p, d in prep["files"].items():
            z.writestr(p, d)
        z.writestr("GROWZEN-README.txt", "\n".join([
            f"Files for {s['website_url']} (made by GrowZen on {_now()[:16].replace('T', ' ')} UTC).", "",
            "Upload these files to your website, keeping the folders exactly as they are here (they replace the files of the same name).",
            "Only these files are new or changed; keep every other file of your website.", "", *[f"  {p}" for p in prep["files"]], "",
            f"The article will then be at: {prep['url']}"]))
    return buf.getvalue()


# ── background jobs ─────────────────────────────────────────────────────────────

def _wait_live(url: str, needle: str, seconds: int) -> bool:
    end = time.time() + seconds
    while True:
        try:
            with site_client(20) as c:
                r = c.get(url, params={"growzen": str(int(time.time()))}, headers={"Cache-Control": "no-cache"})
                if r.status_code == 200 and needle in r.text:
                    return True
        except hd.errors():
            pass
        if time.time() >= end:
            return False
        time.sleep(8)


def _set_post(business_id: int, article_id: int, **kw) -> None:
    def fn(s):
        posts = s.setdefault("posts", {})
        posts[str(article_id)] = {**(posts.get(str(article_id)) or {}), **kw, "updated_at": _now()}
    update_state(business_id, fn)


def _spawn(fn, *args) -> None:
    """Run a job in the background (one seam, so tests can run it at once)."""
    threading.Thread(target=fn, args=args, daemon=True).start()


def start_publish(business_id: int, article_id: int) -> bool:
    with _busy_lock:
        if business_id in _busy:
            return False
        _busy.add(business_id)
    _set_post(business_id, article_id, status="publishing", detail="Preparing the article", error=None, steps=[])
    log_event(business_id, "publish", True, "Publish started", article_id)
    _spawn(_publish_job, business_id, article_id)
    return True


def publish_sync(business_id: int, article_id: int, record: bool = True) -> dict:
    """Publish one article now and wait for the live website to show it. Returns {id, url, status, steps}; raises
    PublishError when it is not live (the status then says why). Used by Publish now and by the scheduler."""
    steps: list[dict] = []
    db = SessionLocal()
    try:
        row, a, b = _row(db, business_id), db.get(Article, article_id), db.get(Business, business_id)
        s = settings_of(row)
        if not (row and a and b and s):
            raise PublishError("The article or the HTML website connection no longer exists.")
        dep = deployer(s)
        if dep.name == "manual" or not deploy_ready(s):
            raise PublishError("Publishing is not connected: run a successful test deployment first (or use Download files).")
        _set_post(business_id, article_id, status="publishing", detail="Preparing the article", error=None, steps=[])
        prep = prepare(s, dep, a, b, steps)
        _set_post(business_id, article_id, status="uploading", detail=f"Uploading {len(prep['files'])} file(s) with {dep.name}", url=prep["url"],
                  slug=prep["slug"], url_path=prep.get("url_path"), mode=prep["mode"], steps=steps)
        originals = {p: d for p in prep["files"] if (d := dep.read(p)) is not None}  # what is replaced, kept by GrowZen
        kept = backup(business_id, originals)
        if kept:
            steps.append({"step": "Back up the files that change", "ok": True, "detail": f"{len(originals)} file(s) saved in GrowZen ({kept})"})
        steps.append({"step": "Upload the files", "ok": True, "detail": dep.write(prep["files"], f"GrowZen: publish \"{(a.title or a.keyword)[:80]}\"")})
        _set_post(business_id, article_id, status="deploying", detail="Checking that the live website shows the article", steps=steps)
        vurl, needle = prep["verify"]
        if not _wait_live(vurl, needle, 300 if dep.rebuilds else 90):
            steps.append({"step": "Live on the website", "ok": False, "detail": f"The files were uploaded, but {vurl} did not show the article in time. "
                          "The host may still be updating: click Check status in a few minutes, or Retry."})
            _set_post(business_id, article_id, status="deploying", detail="Uploaded; the website has not shown the article yet", steps=steps, verify=list(prep["verify"]))
            log_event(business_id, "publish", False, f"Uploaded \"{a.title or a.keyword}\" but the live site did not show it yet", article_id)
            raise PublishError(f"Uploaded, but the live website did not show the article yet ({vurl}).")
        steps.append({"step": "Live on the website", "ok": True, "detail": prep["url"] + (f" (the article is in the live {vurl.rsplit('/', 1)[-1]})" if prep["mode"] == "data" else "")})
        _set_post(business_id, article_id, status="published", detail=prep["url"], steps=steps, published_at=_now(), error=None)
        log_event(business_id, "publish", True, f"Published \"{a.title or a.keyword}\": {prep['url']}", article_id)
        out = {"id": prep["slug"], "url": prep["url"], "status": "publish", "steps": steps}
        if record:  # Publish now: keep it on the Publishing Calendar like the other destinations
            from . import article_publishing as ap  # noqa: PLC0415
            ap.record_published(db, a, "html", out)
            db.commit()
        return out
    except PublishError:
        raise
    except Exception as exc:  # noqa: BLE001 - the user sees the reason; nothing stays "publishing"
        if not isinstance(exc, hd.errors()):
            log.exception("HTML publish failed")
        steps.append({"step": "Publish", "ok": False, "detail": str(exc)[:400]})
        _set_post(business_id, article_id, status="failed", detail=str(exc)[:400], error=str(exc)[:400], steps=steps)
        log_event(business_id, "publish", False, str(exc)[:300], article_id)
        raise PublishError(str(exc)[:400]) from exc
    finally:
        db.close()


def _publish_job(business_id: int, article_id: int) -> None:
    try:
        publish_sync(business_id, article_id)
    except PublishError as exc:
        post = ((update_state(business_id, lambda s: None).get("posts") or {}).get(str(article_id)) or {})
        if post.get("status") not in ("failed", "deploying"):
            _set_post(business_id, article_id, status="failed", detail=str(exc), error=str(exc))
    finally:
        with _busy_lock:
            _busy.discard(business_id)


def recheck_post(business_id: int, article_id: int, s: dict) -> dict:
    """A post still 'deploying': look once whether the article is live now."""
    post = (s.get("posts") or {}).get(str(article_id)) or {}
    v = post.get("verify")
    if post.get("status") == "deploying" and v and _wait_live(v[0], v[1], 0):
        _set_post(business_id, article_id, status="published", detail=post.get("url"), published_at=_now(),
                  steps=[*(post.get("steps") or [])[:-1], {"step": "Live on the website", "ok": True, "detail": post.get("url")}])
        post = {**post, "status": "published"}
    return post


def test_connection(business_id: int) -> tuple[bool, list[dict]]:
    """Test connection (nothing is written): sign in, pin the server's SSH host key the first time, and find the website
    folder (e.g. public_html) by locating the listing file that the live website serves. Saves the key and folder."""
    steps: list[dict] = []
    db = SessionLocal()
    try:
        s = settings_of(_row(db, business_id))
    finally:
        db.close()
    stored = dict(s.get("deploy") or {})
    dropped_root = None
    if hd.bad_root(stored.get("root")):  # e.g. "blog.html" typed as the folder: set aside (credentials untouched), then detect
        dropped_root = stored.pop("root")
        s = {**s, "deploy": stored}
        steps.append({"step": "Website folder setting", "ok": True, "warning": True,
                      "detail": f"'{dropped_root}' is a file name, not a folder, so it is not used as one. GrowZen looks for the folder that contains "
                                f"{s['listing_file']} instead."})
    hk = root = None
    dep = None
    try:
        dep = deployer(s)
        if dep.name == "manual":
            raise PublishError("No deployment is saved for this website.")
        steps.append({"step": "Sign in", "ok": True, "detail": dep.check()})
        hk = getattr(dep, "host_key", None)
        if hk:
            steps.append({"step": "Server identity", "ok": True, "detail": f"Matches the saved host key {hk}" if stored.get("host_key") else
                          f"Host key {hk} saved: later connections must present the same key"})
        live = _live(s["website_url"].rstrip("/") + "/" + s["listing_file"].lstrip("/"))
        try:
            root = find_root(dep, s["listing_file"], live)
        except PublishError as exc:
            seen = dep.list_dir(".") if hasattr(dep, "list_dir") else []
            if not [n for n in seen if not n.startswith(".")]:
                raise PublishError(f"Signed in, but this account opens in an empty folder (it contains only: {', '.join(seen) or 'nothing'}), so it cannot reach "
                                   f"your website files. In cPanel → FTP Accounts, the account's Directory must be your website folder (public_html): "
                                   "delete it and add it again with Directory 'public_html', then click Test connection.") from exc
            raise PublishError(f"{exc} The login folder contains: {', '.join(seen[:15])}.") from exc
        where = f"'{root or '(login folder)'}'"
        if dep.read(s["listing_file"]) is None:
            raise PublishError(f"{s['listing_file']} was not found in {where}. Expected: <website folder>/{s['listing_file']}.")
        steps.append({"step": "Website folder", "ok": True, "detail": f"{where} contains {s['listing_file']}" + (" and it matches the live page" if live else "")})
        shape = s.get("shape") or {}
        if shape.get("mode") == "data":
            found = dep.read(shape["data_file"]) is not None
            steps.append({"step": "Article data file", "ok": found, "detail": f"{shape['data_file']} found in {where}" if found
                          else f"{shape['data_file']} was not found in {where} (expected {root + '/' if root else ''}{shape['data_file']})."})
            if not found:
                raise PublishError(f"{shape['data_file']} was not found in {where}.")
        folder = s["articles_folder"].strip("/")
        listing = dep.list_dir(posixpath.join(root, folder) if root else folder) if hasattr(dep, "list_dir") else None
        if listing is None:
            pass  # the host cannot list folders; the folder is created with the first article if needed
        elif listing:
            steps.append({"step": "Blog folder", "ok": True, "detail": f"{folder}/ exists in {where} (images go there)"})
        else:
            steps.append({"step": "Blog folder", "ok": True, "warning": True, "detail": f"{folder}/ is empty or does not exist yet in {where}; it is created with the first article image."})
        ok = True
    except (PublishError, *hd.errors()) as exc:
        steps.append({"step": "Connection", "ok": False, "detail": str(exc)[:500]})
        ok, hk, root = False, None, None

    def save(x):
        d = x.get("deploy")
        if not d:
            return
        if dropped_root is not None and d.get("root") == dropped_root:
            d.pop("root", None)  # never keep a file name as the folder
        if ok:
            if hk and not d.get("host_key"):
                d["host_key"] = hk
            if root is not None and not d.get("root"):
                d["root"] = root
        d["connection_test"] = {"ok": ok, "at": _now(), "detail": steps[-1]["detail"]}
    update_state(business_id, save)
    log_event(business_id, "test connection", ok, steps[-1]["detail"])
    return ok, steps


def start_test_deploy(business_id: int) -> bool:
    with _busy_lock:
        if business_id in _busy:
            return False
        _busy.add(business_id)
    update_state(business_id, lambda s: s.__setitem__("deploy_test", {"status": "running", "detail": "Uploading a small check file", "at": _now()}))
    _spawn(_test_job, business_id,)
    return True


def _test_job(business_id: int) -> None:
    db = SessionLocal()
    result: dict = {}
    try:
        s = settings_of(_row(db, business_id))
        fp = fingerprint(s)
        dep = deployer(s)
        if dep.name == "manual":
            raise PublishError("No deployment is configured for this website on the server.")
        dep.check()
        dep.root = find_root(dep, s["listing_file"], _live(s["website_url"].rstrip("/") + "/" + s["listing_file"].lstrip("/")))
        token = hashlib.sha256(f"{business_id}{time.time()}".encode()).hexdigest()[:24]
        dep.write({CHECK_FILE: f"GrowZen deployment check {token}\n".encode()}, "GrowZen: deployment check")
        url = s["website_url"].rstrip("/") + "/" + CHECK_FILE
        update_state(business_id, lambda x: x.__setitem__("deploy_test", {"status": "running", "detail": f"Uploaded; waiting for {url}", "at": _now()}))
        if _wait_live(url, token, 300 if dep.rebuilds else 90):
            removed = dep.delete([CHECK_FILE])  # the check file is temporary
            result = {"status": "ok", "detail": f"A check file was uploaded with {dep.name} into '{dep.root or '(login folder)'}' and the live website served it at {url}"
                      + ("; it was then removed." if removed else "."), "fingerprint": fp, "root": dep.root}
        else:
            result = {"status": "failed", "detail": f"The check file was uploaded with {dep.name} but did not appear at {url} in time. Check that this folder is what the "
                      "website serves (\"root\" in the deployment configuration).", "fingerprint": fp}
    except Exception as exc:  # noqa: BLE001
        if not isinstance(exc, (PublishError, *hd.errors())):
            log.exception("HTML test deployment failed")
        result = {"status": "failed", "detail": str(exc)[:400]}
    finally:
        db.close()
        with _busy_lock:
            _busy.discard(business_id)
    update_state(business_id, lambda x: x.__setitem__("deploy_test", {**result, "at": _now()}))
    log_event(business_id, "test deployment", result.get("status") == "ok", result.get("detail") or "")
