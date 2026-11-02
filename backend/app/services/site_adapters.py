"""More ways for a blog post to reach a customer's website: GitHub (for code-based sites), Ghost and Shopify.

Each adapter has `verify_*` (named steps, run before credentials are saved) and `publish_*` (draft / publish / schedule), like the WordPress and webhook
ones in site_publish.py. They are written against the vendors' documented REST APIs and tested against simulated servers; whether a particular customer's
token has the right permissions is exactly what `verify_*` checks, step by step, with a plain fix for each failure.

- GitHub: the post becomes a Markdown file (with front matter) committed to the site's repository; Vercel, Netlify, GitHub Pages and similar rebuild by themselves.
- Ghost: Admin API with an Admin API key (a short-lived signed token is made for each request).
- Shopify: Admin API with a custom-app access token; Shopify itself hides a post until its publish date.
"""
import base64
import json
import re
import time
from datetime import datetime, timezone
from urllib.parse import quote, urlsplit

import httpx
import jwt
from bs4 import BeautifulSoup, NavigableString, Tag

from ..models import Article, SiteIntegration
from . import crypto
from .net import site_client
from .url_safety import SSRFValidationError

GITHUB_API = "https://api.github.com"
SHOPIFY_API_VERSION = "2024-10"


class AdapterError(RuntimeError):
    """Mapped to PublishError by site_publish (kept separate to avoid a circular import)."""


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s[:80].strip("-") or "post"


# ---------------------------------------------------------------- HTML -> Markdown (for sites whose posts are files)

def html_to_markdown(html: str) -> str:
    """Article HTML to clean Markdown: headings, paragraphs, lists, links, emphasis, quotes, code, images. Tables stay as HTML blocks (valid in Markdown)."""
    soup = BeautifulSoup(html or "", "html.parser")

    def inline(node) -> str:
        return "".join(render(c, 0) for c in node.children)

    def render(node, depth: int) -> str:
        if isinstance(node, NavigableString):
            return re.sub(r"\s+", " ", str(node)) if not node.parent or node.parent.name != "pre" else str(node)
        if not isinstance(node, Tag):
            return ""
        n = node.name
        if n in ("script", "style"):
            return ""
        if re.fullmatch(r"h[1-6]", n):
            return f"\n\n{'#' * int(n[1])} {inline(node).strip()}\n\n"
        if n == "p":
            return f"\n\n{inline(node).strip()}\n\n"
        if n == "br":
            return "<br />"  # raw HTML is valid in Markdown and MDX; trailing-space hard breaks get stripped by editors and formatters
        if n in ("strong", "b"):
            return f"**{inline(node).strip()}**"
        if n in ("em", "i"):
            return f"*{inline(node).strip()}*"
        if n == "a" and node.get("href"):
            return f"[{inline(node).strip()}]({node['href']})"
        if n == "img" and node.get("src"):
            return f"![{node.get('alt', '')}]({node['src']})"
        if n == "code" and (not node.parent or node.parent.name != "pre"):
            return f"`{node.get_text()}`"
        if n == "pre":
            return f"\n\n```\n{node.get_text().strip(chr(10))}\n```\n\n"
        if n in ("ul", "ol"):
            lines = []
            for i, li in enumerate(node.find_all("li", recursive=False), 1):
                mark = f"{i}." if n == "ol" else "-"
                body = "".join(render(c, depth + 1) for c in li.children).strip()  # a nested list arrives already indented
                lines.append(f"{'  ' * depth}{mark} {body}")
            return "\n\n" + "\n".join(lines) + "\n\n" if depth == 0 else "\n" + "\n".join(lines)
        if n == "blockquote":
            return "\n\n" + "\n".join("> " + ln if ln.strip() else ">" for ln in inline(node).strip().splitlines()) + "\n\n"
        if n == "hr":
            return "\n\n---\n\n"
        if n == "table":
            return f"\n\n{node}\n\n"
        return inline(node)

    md = "".join(render(c, 0) for c in soup.children)
    md = re.sub(r"[ \t]+\n", "\n", md)
    return re.sub(r"\n{3,}", "\n\n", md).strip() + "\n"


def front_matter(fields: dict) -> str:
    """YAML front matter with JSON-quoted strings (valid YAML), for Next.js/Gatsby/Astro/Hugo/Jekyll content files."""
    lines = ["---"]
    for k, v in fields.items():
        if v is None or v == "" or v == []:
            continue
        lines.append(f"{k}: {json.dumps(v, ensure_ascii=False) if not isinstance(v, bool) else str(v).lower()}")
    lines.append("---")
    return "\n".join(lines) + "\n\n"


def _article_fields(a: Article, when: datetime | None, draft: bool) -> dict:
    return {"title": a.title or a.keyword, "date": (when or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%S+00:00"), "description": a.meta_description or "",
            "slug": slugify(a.title or a.keyword), "keywords": [a.keyword, *(a.secondary_keywords or [])], "draft": draft}


# ---------------------------------------------------------------- GitHub

def _gh(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "GrowZen-publisher"}


def normalize_repo(value: str) -> str:
    v = (value or "").strip().rstrip("/")
    v = re.sub(r"^https?://github\.com/", "", v)
    v = re.sub(r"\.git$", "", v)
    if not re.fullmatch(r"[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+", v):
        raise AdapterError("Enter the repository as owner/name, for example acme/website.")
    return v


def verify_github(token: str, repo: str, branch: str | None, directory: str) -> tuple[list[dict], dict | None]:
    steps: list[dict] = []

    def step(name: str, ok: bool, detail: str) -> bool:
        steps.append({"step": name, "ok": ok, "detail": detail})
        return ok

    repo = normalize_repo(repo)
    directory = (directory or "content/blog").strip("/")
    try:
        with site_client(20) as c:
            me = c.get(f"{GITHUB_API}/user", headers=_gh(token))
            if me.status_code in (401, 403):
                step("Sign in with the access token", False, "GitHub rejected the token. Create a fine-grained token with Contents: Read and write for this repository.")
                return steps, None
            step("Sign in with the access token", True, f"Signed in as {me.json().get('login', 'GitHub user')}")
            r = c.get(f"{GITHUB_API}/repos/{repo}", headers=_gh(token))
            if r.status_code == 404:
                step("Find the repository", False, f"{repo} was not found, or the token cannot see it. Check the name and that the token was given access to this repository.")
                return steps, None
            if r.status_code >= 400:
                step("Find the repository", False, f"GitHub answered {r.status_code}: {r.text[:120]}")
                return steps, None
            info = r.json()
            step("Find the repository", True, f"{info.get('full_name', repo)} ({'private' if info.get('private') else 'public'})")
            if not (info.get("permissions") or {}).get("push"):
                step("Check permission to write", False, "The token can read this repository but not write to it. Give it Contents: Read and write.")
                return steps, None
            step("Check permission to write", True, "Can commit files")
            branch = branch or info.get("default_branch") or "main"
            b = c.get(f"{GITHUB_API}/repos/{repo}/branches/{quote(branch, safe='')}", headers=_gh(token))
            if b.status_code != 200:
                step("Check the branch", False, f"Branch '{branch}' was not found. Use the branch your site deploys from.")
                return steps, None
            step("Check the branch", True, f"Posts will be committed to '{branch}'")
            d = c.get(f"{GITHUB_API}/repos/{repo}/contents/{quote(directory)}", headers=_gh(token), params={"ref": branch})
            if d.status_code == 200 and isinstance(d.json(), list):
                step("Check the posts folder", True, f"{directory}/ exists ({len(d.json())} item(s))")
            elif d.status_code == 404:
                step("Check the posts folder", True, f"{directory}/ does not exist yet; it will be created with the first post")
            else:
                step("Check the posts folder", False, f"{directory} is not a folder (GitHub answered {d.status_code}).")
                return steps, None
            return steps, {"site_name": info.get("full_name", repo), "user": me.json().get("login"), "branch": branch, "directory": directory, "repo": repo}
    except (httpx.HTTPError, SSRFValidationError) as exc:
        step("Reach GitHub", False, f"Could not connect: {str(exc)[:140]}")
        return steps, None


def publish_github(row: SiteIntegration, a: Article, mode: str, when: datetime | None, steps: list[dict]) -> dict:
    cfg = row.config or {}
    token = crypto.unseal(row.secret_enc)
    repo, branch, directory = cfg["repo"], cfg.get("branch") or "main", (cfg.get("directory") or "content/blog").strip("/")
    fmt = cfg.get("body_format", "markdown")
    draft = mode == "draft"
    body = html_to_markdown(a.body or "") if fmt == "markdown" else (a.body or "")
    fields = _article_fields(a, when if mode == "schedule" else None, draft)
    ext = "md" if fmt == "markdown" else "html"
    path = f"{directory}/{fields['slug']}.{ext}"
    content = front_matter(fields) + body
    payload = {"message": f"{'Draft' if draft else 'Add'} blog post: {fields['title'][:80]}", "content": base64.b64encode(content.encode("utf-8")).decode(), "branch": branch}
    try:
        with site_client(45) as c:
            url = f"{GITHUB_API}/repos/{repo}/contents/{quote(path)}"
            existing = c.get(url, headers=_gh(token), params={"ref": branch})
            if existing.status_code == 200:
                payload["sha"] = existing.json().get("sha")  # same title again: update the file instead of failing
            r = c.put(url, headers=_gh(token), json=payload)
            if r.status_code in (401, 403):
                steps.append({"step": "Commit to GitHub", "ok": False, "detail": "GitHub refused the token. Reconnect the website."})
                raise AdapterError("GitHub refused the token. Reconnect the website.")
            if r.status_code >= 400:
                steps.append({"step": "Commit to GitHub", "ok": False, "detail": f"{r.status_code}: {r.text[:140]}"})
                raise AdapterError(f"GitHub refused the post ({r.status_code}): {r.text[:200]}")
            d = r.json()
            sha = (d.get("commit") or {}).get("sha", "")[:7]
            steps.append({"step": "Commit to GitHub", "ok": True, "detail": f"{'Updated' if 'sha' in payload else 'Created'} {path} on '{branch}' (commit {sha})"})
            steps.append({"step": "Confirm the post status", "ok": True, "detail": "Saved as a draft (draft: true)" if draft else "Committed. Your site rebuilds in a minute or two"})
            public = (cfg.get("public_url") or "").replace("{slug}", fields["slug"]) or (d.get("content") or {}).get("html_url", "")
            return {"id": sha or path, "url": public, "status": "draft" if draft else "publish"}
    except (httpx.HTTPError, SSRFValidationError) as exc:
        steps.append({"step": "Commit to GitHub", "ok": False, "detail": str(exc)[:140]})
        raise AdapterError(f"Could not reach GitHub: {str(exc)[:160]}") from exc


# ---------------------------------------------------------------- Ghost

def ghost_token(admin_key: str) -> str:
    """A 5-minute Admin API token from the key 'id:secret' (Ghost's documented JWT scheme)."""
    try:
        key_id, secret = admin_key.strip().split(":", 1)
        raw = bytes.fromhex(secret)
    except ValueError as exc:
        raise AdapterError("The Admin API key looks wrong. It has two parts, id:secret, from Settings > Integrations > Add custom integration.") from exc
    now = int(time.time())
    return jwt.encode({"iat": now, "exp": now + 300, "aud": "/admin/"}, raw, algorithm="HS256", headers={"kid": key_id})


def _ghost_headers(key: str) -> dict:
    return {"Authorization": f"Ghost {ghost_token(key)}", "Accept-Version": "v5.0", "Content-Type": "application/json"}


def verify_ghost(url: str, admin_key: str) -> tuple[list[dict], dict | None]:
    steps: list[dict] = []
    base = url.rstrip("/")

    def step(name: str, ok: bool, detail: str) -> bool:
        steps.append({"step": name, "ok": ok, "detail": detail})
        return ok

    try:
        headers = _ghost_headers(admin_key)
    except AdapterError as exc:
        step("Read the Admin API key", False, str(exc))
        return steps, None
    step("Read the Admin API key", True, "The key has the right shape")
    try:
        with site_client(20) as c:
            s = c.get(f"{base}/ghost/api/admin/site/")
            if s.status_code != 200 or '"site"' not in s.text[:2000]:
                step("Find the Ghost Admin API", False, f"{base}/ghost/api/admin/ did not answer like Ghost. Use the address where Ghost itself runs (not a CDN or a different domain).")
                return steps, None
            site = s.json().get("site", {})
            step("Find the Ghost Admin API", True, f"{site.get('title', 'Ghost')} (Ghost {site.get('version', '')})".strip())
            r = c.get(f"{base}/ghost/api/admin/posts/", headers=headers, params={"limit": 1})
            if r.status_code in (401, 403):
                step("Sign in with the Admin API key", False, "Ghost rejected the key. Copy the Admin API key (not the Content API key) of a custom integration.")
                return steps, None
            if r.status_code >= 400:
                step("Sign in with the Admin API key", False, f"Ghost answered {r.status_code}: {r.text[:120]}")
                return steps, None
            step("Sign in with the Admin API key", True, "The key can read and write posts")
            return steps, {"site_name": site.get("title"), "user": "Admin API key", "version": site.get("version")}
    except (httpx.HTTPError, SSRFValidationError) as exc:
        step("Reach the website", False, f"Could not connect: {str(exc)[:140]}")
        return steps, None


def publish_ghost(row: SiteIntegration, a: Article, mode: str, when: datetime | None, steps: list[dict]) -> dict:
    status = {"draft": "draft", "publish": "published", "schedule": "scheduled"}[mode]
    post = {"title": a.title or a.keyword, "html": a.body or "", "status": status, "custom_excerpt": (a.meta_description or "")[:300] or None,
            "tags": [{"name": k} for k in [a.keyword, *(a.secondary_keywords or [])][:5]]}
    if mode == "schedule":
        post["published_at"] = when.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    base = row.base_url.rstrip("/")
    try:
        with site_client(45) as c:
            r = c.post(f"{base}/ghost/api/admin/posts/", params={"source": "html"}, headers=_ghost_headers(crypto.unseal(row.secret_enc)), json={"posts": [{k: v for k, v in post.items() if v}]})
            if r.status_code in (401, 403):
                steps.append({"step": "Send to Ghost", "ok": False, "detail": "Ghost refused the key. Reconnect the website."})
                raise AdapterError("Ghost refused the key. Reconnect the website.")
            if r.status_code >= 400:
                steps.append({"step": "Send to Ghost", "ok": False, "detail": f"{r.status_code}: {r.text[:140]}"})
                raise AdapterError(f"Ghost refused the post ({r.status_code}): {r.text[:200]}")
            d = r.json()["posts"][0]
            steps.append({"step": "Send to Ghost", "ok": True, "detail": f"Post {d.get('id')} created as {d.get('status')}"})
            ok = d.get("status") == status
            steps.append({"step": "Confirm the post status", "ok": ok, "detail": {"draft": "Saved as a draft", "published": "Published", "scheduled": "Scheduled by Ghost"}[status] if ok else f"Ghost saved it as '{d.get('status')}'"})
            return {"id": str(d.get("id", "")), "url": d.get("url", ""), "status": {"draft": "draft", "published": "publish", "scheduled": "future"}.get(d.get("status"), d.get("status"))}
    except (httpx.HTTPError, SSRFValidationError) as exc:
        steps.append({"step": "Send to Ghost", "ok": False, "detail": str(exc)[:140]})
        raise AdapterError(f"Could not reach Ghost: {str(exc)[:160]}") from exc


# ---------------------------------------------------------------- Shopify

def normalize_shop(value: str) -> str:
    v = (value or "").strip().lower()
    v = re.sub(r"^https?://", "", v).split("/")[0]
    if "." not in v:
        v += ".myshopify.com"
    if not v.endswith(".myshopify.com"):
        raise AdapterError("Use the store's .myshopify.com address (Settings > Domains shows it), for example mystore.myshopify.com.")
    return f"https://{v}"


def _shop_headers(token: str) -> dict:
    return {"X-Shopify-Access-Token": token.strip(), "Content-Type": "application/json", "Accept": "application/json"}


def verify_shopify(url: str, token: str, blog_id: str | None = None) -> tuple[list[dict], dict | None]:
    steps: list[dict] = []

    def step(name: str, ok: bool, detail: str) -> bool:
        steps.append({"step": name, "ok": ok, "detail": detail})
        return ok

    try:
        base = normalize_shop(url)
    except AdapterError as exc:
        step("Read the store address", False, str(exc))
        return steps, None
    step("Read the store address", True, base)
    try:
        with site_client(20) as c:
            s = c.get(f"{base}/admin/api/{SHOPIFY_API_VERSION}/shop.json", headers=_shop_headers(token))
            if s.status_code in (401, 403):
                step("Sign in with the access token", False, "Shopify rejected the token. Create a custom app (Settings > Apps > Develop apps), give it write_content and read_content, install it and copy the Admin API access token.")
                return steps, None
            if s.status_code >= 400:
                step("Sign in with the access token", False, f"Shopify answered {s.status_code}: {s.text[:120]}")
                return steps, None
            shop = s.json().get("shop", {})
            step("Sign in with the access token", True, f"Signed in to {shop.get('name', base)}")
            b = c.get(f"{base}/admin/api/{SHOPIFY_API_VERSION}/blogs.json", headers=_shop_headers(token))
            if b.status_code in (401, 403):
                step("Find the blog", False, "The token cannot read blogs. Give the app the read_content and write_content permissions and reinstall it.")
                return steps, None
            blogs = b.json().get("blogs", [])
            if not blogs:
                step("Find the blog", False, "This store has no blog yet. Create one under Online Store > Blogs.")
                return steps, None
            chosen = next((x for x in blogs if str(x["id"]) == str(blog_id)), None) or next((x for x in blogs if x.get("handle") in ("news", "blog")), blogs[0])
            step("Find the blog", True, f"Posts will go to the blog “{chosen.get('title')}”")
            return steps, {"site_name": shop.get("name"), "user": "custom app", "blog_id": str(chosen["id"]), "blog_handle": chosen.get("handle"),
                           "public_domain": shop.get("domain") or base.replace("https://", ""), "base": base}
    except (httpx.HTTPError, SSRFValidationError) as exc:
        step("Reach the store", False, f"Could not connect: {str(exc)[:140]}")
        return steps, None


def publish_shopify(row: SiteIntegration, a: Article, mode: str, when: datetime | None, steps: list[dict]) -> dict:
    cfg = row.config or {}
    article = {"title": a.title or a.keyword, "body_html": a.body or "", "summary_html": f"<p>{a.meta_description}</p>" if a.meta_description else None,
               "tags": ", ".join([a.keyword, *(a.secondary_keywords or [])][:8]), "published": mode != "draft"}
    if mode == "schedule":
        article["published_at"] = when.astimezone(timezone.utc).isoformat()  # Shopify keeps a post with a future date hidden until then
    base = row.base_url.rstrip("/")
    try:
        with site_client(45) as c:
            r = c.post(f"{base}/admin/api/{SHOPIFY_API_VERSION}/blogs/{cfg['blog_id']}/articles.json", headers=_shop_headers(crypto.unseal(row.secret_enc)),
                       json={"article": {k: v for k, v in article.items() if v is not None}})
            if r.status_code in (401, 403):
                steps.append({"step": "Send to Shopify", "ok": False, "detail": "Shopify refused the token. Reconnect the website."})
                raise AdapterError("Shopify refused the token. Reconnect the website.")
            if r.status_code >= 400:
                steps.append({"step": "Send to Shopify", "ok": False, "detail": f"{r.status_code}: {r.text[:140]}"})
                raise AdapterError(f"Shopify refused the post ({r.status_code}): {r.text[:200]}")
            d = r.json()["article"]
            steps.append({"step": "Send to Shopify", "ok": True, "detail": f"Article {d.get('id')} created"})
            future = mode == "schedule"
            steps.append({"step": "Confirm the post status", "ok": True, "detail": {"draft": "Saved as hidden (not published)", "publish": "Published", "schedule": "Scheduled: Shopify shows it from the chosen time"}[mode]})
            url = f"https://{cfg.get('public_domain') or urlsplit(base).netloc}/blogs/{cfg.get('blog_handle', 'news')}/{d.get('handle', '')}"
            return {"id": str(d.get("id", "")), "url": url, "status": "future" if future else ("publish" if mode == "publish" else "draft")}
    except (httpx.HTTPError, SSRFValidationError) as exc:
        steps.append({"step": "Send to Shopify", "ok": False, "detail": str(exc)[:140]})
        raise AdapterError(f"Could not reach Shopify: {str(exc)[:160]}") from exc
