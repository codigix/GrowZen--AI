"""Publishing to a custom (React.js) website through its own blog API.

The ERP side is fully configurable (base URL, endpoints, API key, auth header), because every custom site's
backend differs. The contract GrowZen speaks (the site's backend implements the receiving side; see
docs/react-site-blog-api.md for a ready Express example):

  Auth      every request carries the key: `Authorization: Bearer <key>` (default) or `X-API-Key: <key>`
  Health    GET  {base}{health_endpoint}              -> 2xx with the key, 401/403 without it (proves the key is checked)
  Create    POST {base}{publish_endpoint}             JSON article -> 2xx {"id": ..., "slug"?: ..., "url"?: ...}
  Update    PUT  {base}{publish_endpoint}/{id}        JSON article -> 2xx
  Delete    DELETE {base}{publish_endpoint}/{id}      -> 2xx (404 = already gone)
  Image     POST {base}{image_endpoint}               multipart field "image" (+ "alt") -> 2xx {"url": ...}

Requests go through the same SSRF-safe client as WordPress publishing (public hosts only).
"""
import json
import re
from datetime import datetime, timezone
from urllib.parse import urlsplit

import httpx

from ..models import Article, ReactSiteConnection
from . import crypto
from .net import site_client
from .url_safety import SSRFValidationError, validate_url_shape

STATUS_OUT = {"draft": "draft", "publish": "published", "schedule": "scheduled"}


class ReactSiteError(RuntimeError):
    pass


def normalize_base(url: str) -> str:
    url = (url or "").strip()
    if url and "://" not in url:
        url = "https://" + url
    try:
        validate_url_shape(url)
    except SSRFValidationError as exc:
        raise ReactSiteError(str(exc)) from exc
    p = urlsplit(url)
    return f"{p.scheme}://{p.netloc}{p.path}".rstrip("/")


def normalize_path(path: str | None) -> str | None:
    p = (path or "").strip()
    if not p:
        return None
    if "://" in p:
        raise ReactSiteError(f"Endpoints are paths on the API base URL, like /api/blogs (got {p}).")
    if not re.fullmatch(r"/[\w\-./{}]*", "/" + p.lstrip("/")):
        raise ReactSiteError(f"'{p}' is not a valid endpoint path.")
    return "/" + p.lstrip("/").rstrip("/")


def _headers(scheme: str, key: str | None) -> dict:
    if not key:
        return {}
    return {"X-API-Key": key} if scheme == "x-api-key" else {"Authorization": f"Bearer {key}"}


def _msg(r: httpx.Response) -> str:
    try:
        d = r.json()
        if isinstance(d, dict):
            return str(d.get("message") or d.get("error") or d.get("detail") or r.text[:160])[:200]
    except ValueError:
        pass
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", r.text))[:160].strip() or f"HTTP {r.status_code}"


def key_of(conn: ReactSiteConnection) -> str | None:
    return crypto.unseal(conn.api_key_enc) if conn.api_key_enc else None


# ── connection test ─────────────────────────────────────────────────────────────

def test(*, website_url: str | None, api_base_url: str, api_key: str | None, auth_scheme: str, health_endpoint: str | None,
         publish_endpoint: str | None) -> tuple[list[dict], bool]:
    """Real requests to the site, step by step. Returns (steps, connected). Connected = the API answers with the key
    and the key is actually required (a request without it is refused)."""
    steps: list[dict] = []

    def step(name, ok, detail):
        steps.append({"step": name, "ok": bool(ok), "detail": detail})
        return ok

    try:
        base = normalize_base(api_base_url)
        health = normalize_path(health_endpoint) or normalize_path(publish_endpoint)
    except ReactSiteError as exc:
        step("Check the settings", False, str(exc))
        return steps, False
    if not api_key:
        step("Check the settings", False, "Enter the API authentication key issued by the website's backend.")
        return steps, False
    if not health:
        step("Check the settings", False, "Enter the health/test endpoint (or the publishing endpoint).")
        return steps, False
    try:
        with site_client(20) as c:
            if website_url:
                try:
                    w = c.get(normalize_base(website_url))
                    step("Reach the website", w.status_code < 400, f"{website_url} answered {w.status_code}")
                except (httpx.HTTPError, ReactSiteError, SSRFValidationError) as exc:
                    step("Reach the website", False, f"Could not connect: {str(exc)[:120]}")
            try:
                r = c.get(base + health, headers=_headers(auth_scheme, api_key))
            except httpx.HTTPError as exc:
                step("Reach the blog API", False, f"Could not connect to {base}{health}: {str(exc)[:120]}")
                return steps, False
            if r.status_code in (401, 403):
                step("Reach the blog API", True, f"{base}{health} answered {r.status_code}")
                step("API key accepted", False, f"The website refused the key: {_msg(r)}")
                return steps, False
            if r.status_code == 404:
                step("Reach the blog API", False, f"{base}{health} does not exist (404). Check the endpoint path; the website's backend must provide it.")
                return steps, False
            if r.status_code >= 400:
                step("Reach the blog API", False, f"{base}{health} answered {r.status_code}: {_msg(r)}")
                return steps, False
            step("Reach the blog API", True, f"{base}{health} answered {r.status_code}")
            anon = c.get(base + health)
            if anon.status_code in (401, 403):
                step("API key accepted", True, "Accepted with the key, refused without it")
                return steps, True
            step("API key accepted", False, f"This endpoint also answers without a key ({anon.status_code}), so the key could not be verified. "
                                            "Use an endpoint that requires the key (e.g. /api/integrations/health); the website's backend must add it.")
            return steps, False
    except SSRFValidationError as exc:
        step("Reach the blog API", False, str(exc))
        return steps, False


# ── publishing ──────────────────────────────────────────────────────────────────

def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:90] or "article"


def _id_of(d) -> str | None:
    if isinstance(d, dict):
        for k in ("id", "_id", "blog_id", "post_id"):
            if d.get(k) not in (None, ""):
                return str(d[k])
        for k in ("data", "blog", "post", "result"):
            if isinstance(d.get(k), dict):
                found = _id_of(d[k])
                if found:
                    return found
    return None


def _field(d, *names):
    if isinstance(d, dict):
        for n in names:
            if d.get(n):
                return d[n]
        for k in ("data", "blog", "post", "result"):
            if isinstance(d.get(k), dict):
                v = _field(d[k], *names)
                if v:
                    return v
    return None


def payload(a: Article, conn: ReactSiteConnection, mode: str, when: datetime | None, image_url: str | None) -> dict:
    """The article as JSON, in the shape of the site's own blog records (title, slug, body, SEO fields, image, status)."""
    from . import articles as svc, elementor_layout as el

    body = el.clean_body(a.body or "")
    schema = "\n".join(re.findall(r"<script\b[^>]*application/ld\+json[^>]*>([\s\S]*?)</script>", body))
    body_only = re.sub(r"\s*<script\b[^>]*application/ld\+json[^>]*>[\s\S]*?</script>\s*", "\n", body).strip()
    faqs = [{"question": q, "answer": ans} for q, ans in svc.faqs_of(body_only) if not svc._is_template_faq(q, ans)]
    keywords = [k for k in [a.keyword, *(a.secondary_keywords or [])] if k]
    now = datetime.now(timezone.utc)
    pub_at = (when or now).astimezone(timezone.utc)
    return {
        "title": a.title or a.keyword,
        "slug": _slug(a.title or a.keyword),
        "body": body_only,
        "excerpt": a.meta_description or "",
        "seo_title": a.title or a.keyword,
        "seo_description": a.meta_description or "",
        "focus_keyword": a.keyword,
        "secondary_keywords": a.secondary_keywords or [],
        "seo_keywords": ", ".join(keywords),
        "tags": keywords[:8],
        "category": (a.topic or a.keyword or "").strip().title(),
        "image": image_url or "",
        "image_alt": (a.featured_image_alt or a.title or "") if image_url else "",
        "status": STATUS_OUT[mode],
        "date": pub_at.strftime("%Y-%m-%d"),
        "publication_time": pub_at.isoformat(timespec="seconds"),
        "faqs": faqs,
        "schema_jsonld": schema.strip(),
        "source": "growzen",
        "growzen_article_id": a.id,
    }


def upload_image(conn: ReactSiteConnection, a: Article, steps: list[dict]) -> str | None:
    """Send the featured image (the optimized WebP) to the site's image endpoint; returns its public URL."""
    from . import featured_images as fi

    p = fi.path_of(a.featured_image_path)
    path = normalize_path(conn.image_endpoint)
    if not p:
        return None
    if not path:
        steps.append({"step": "Featured image", "ok": False, "detail": "No image upload endpoint configured; the post is sent without an image"})
        return None
    base = normalize_base(conn.api_base_url)
    try:
        with site_client(60) as c:
            r = c.post(base + path, headers=_headers(conn.auth_scheme, key_of(conn)),
                       files={"image": (fi.upload_filename(a, a.featured_image_path), p.read_bytes(), fi.media_type(a.featured_image_path))},
                       data={"alt": a.featured_image_alt or a.title or ""})
    except (httpx.HTTPError, SSRFValidationError) as exc:
        raise ReactSiteError(f"Could not upload the featured image: {str(exc)[:160]}") from exc
    if r.status_code in (401, 403):
        raise ReactSiteError(f"The website refused the image upload (API key): {_msg(r)}")
    if r.status_code >= 400:
        raise ReactSiteError(f"The website could not store the featured image ({r.status_code}): {_msg(r)}")
    try:
        url = _field(r.json(), "url", "imageUrl", "image_url", "location", "path")
    except ValueError:
        url = None
    if not url:
        raise ReactSiteError("The image endpoint answered without a URL (expected JSON like {\"url\": \"https://...\"}).")
    url = url if str(url).startswith("http") else normalize_base(conn.website_url or conn.api_base_url) + "/" + str(url).lstrip("/")
    steps.append({"step": "Featured image", "ok": True, "detail": f"Uploaded: {url}"})
    return url


def publish(conn: ReactSiteConnection, a: Article, mode: str, when: datetime | None) -> dict:
    """Create the post (or update it when this article is already there). Returns {id, url, status, image_url, steps}."""
    if mode == "schedule" and (not when or when <= datetime.now(timezone.utc)):
        raise ReactSiteError("Pick a date and time in the future to schedule the post.")
    steps = [{"step": "Prepare the article", "ok": True, "detail": f"{len((a.body or '').split())} words, title: {a.title or a.keyword}"}]
    path = normalize_path(conn.publish_endpoint)
    if not path:
        raise ReactSiteError("Set the publishing endpoint in the React.js website connection first.")
    base = normalize_base(conn.api_base_url)
    if a.featured_image_path and a.react_image_url and a.react_image_path == a.featured_image_path:
        image_url = a.react_image_url  # same image as last time: no second upload
        steps.append({"step": "Featured image", "ok": True, "detail": f"Already on the website: {image_url}"})
    else:
        image_url = upload_image(conn, a, steps) if a.featured_image_path else None
    data = payload(a, conn, mode, when, image_url)
    headers = {**_headers(conn.auth_scheme, key_of(conn)), "Content-Type": "application/json"}
    existing = a.react_post_id if a.react_status != "deleted" else None
    try:
        with site_client(45) as c:
            r = None
            if existing:
                r = c.put(f"{base}{path}/{existing}", content=json.dumps(data, ensure_ascii=False).encode(), headers=headers)
                if r.status_code in (404, 410):
                    steps.append({"step": "Find the existing post", "ok": True, "detail": f"Post {existing} is no longer on the website; creating it again"})
                    existing, r = None, None
            if r is None:
                r = c.post(base + path, content=json.dumps(data, ensure_ascii=False).encode(), headers=headers)
    except (httpx.HTTPError, SSRFValidationError) as exc:
        steps.append({"step": "Send to the website", "ok": False, "detail": str(exc)[:140]})
        raise ReactSiteError(f"Could not reach the website's API: {str(exc)[:160]}") from exc
    if r.status_code in (401, 403):
        raise ReactSiteError(f"The website refused the API key: {_msg(r)}")
    if r.status_code >= 400:
        raise ReactSiteError(f"The website refused the post ({r.status_code}): {_msg(r)}")
    try:
        d = r.json()
    except ValueError:
        d = {}
    pid = _id_of(d) or existing
    if not pid:
        raise ReactSiteError("The website accepted the post but did not return its id (expected JSON like {\"id\": 12}), so it could not be updated or deleted later.")
    slug = _field(d, "slug") or data["slug"]
    url = _field(d, "url", "link", "permalink")
    if not url:
        blog = (conn.blog_url or "").rstrip("/") or normalize_base(conn.website_url or conn.api_base_url) + "/blog"
        url = f"{blog}/{slug}"
    steps.append({"step": "Send to the website", "ok": True, "detail": f"Post {pid} {'updated' if existing else 'created'} as {data['status']}"})
    return {"id": str(pid), "url": url, "status": {"draft": "draft", "publish": "publish", "schedule": "scheduled"}[mode], "image_url": image_url, "steps": steps}


def delete(conn: ReactSiteConnection, post_id: str) -> dict:
    """Delete ONE post by its id. 404 counts as already deleted. Returns {steps, already_gone}."""
    path = normalize_path(conn.publish_endpoint)
    if not path or not post_id:
        raise ReactSiteError("This article has no post on the React.js website.")
    if not re.fullmatch(r"[\w\-]{1,80}", str(post_id)):
        raise ReactSiteError("The stored post id is not valid.")
    base = normalize_base(conn.api_base_url)
    try:
        with site_client(30) as c:
            r = c.delete(f"{base}{path}/{post_id}", headers=_headers(conn.auth_scheme, key_of(conn)))
    except (httpx.HTTPError, SSRFValidationError) as exc:
        raise ReactSiteError(f"Could not reach the website's API: {str(exc)[:160]}") from exc
    if r.status_code == 404:
        return {"steps": [{"step": "Delete the post on the website", "ok": True, "detail": f"Post {post_id} was already removed"}], "already_gone": True}
    if r.status_code in (401, 403):
        raise ReactSiteError(f"The website refused to delete post {post_id}: {_msg(r)}")
    if r.status_code >= 400:
        raise ReactSiteError(f"The website could not delete post {post_id} ({r.status_code}): {_msg(r)}")
    return {"steps": [{"step": "Delete the post on the website", "ok": True, "detail": f"Post {post_id} deleted"}], "already_gone": False}
