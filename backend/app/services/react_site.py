"""Publishing to a custom (React.js) website through its own blog API.

The ERP side is fully configurable (base URL, endpoints, authentication), because every custom site's backend
differs. Authentication (auth_scheme):
  login       (default) the website's integration user: POST {base}{auth_endpoint} {"username"/"email", "password"}
              -> {"token" | "accessToken" | "access_token" | "data": {"token"}, "expires_in"?}. The token is cached
              (encrypted) until it expires and renewed automatically, also when the site refuses it (401).
  bearer      a fixed API key sent as `Authorization: Bearer <key>`
  x-api-key   a fixed API key sent as `X-API-Key: <key>`

Endpoints (the site's backend implements the receiving side; see docs/react-site-blog-api.md):
  Health    GET  {base}{health_endpoint}              optional; with a token/key -> 2xx, without -> 401/403
  Create    POST {base}{publish_endpoint}             JSON article -> 2xx {"id": ..., "slug"?: ..., "url"?: ...}
  Update    PUT  {base}{publish_endpoint}/{id}        JSON article -> 2xx
  Delete    DELETE {base}{publish_endpoint}/{id}      -> 2xx (404 = already gone)
  Image     POST {base}{image_endpoint}               multipart field "image" (+ "alt") -> 2xx {"url": ...}

Requests go through the same SSRF-safe client as WordPress publishing (public hosts only).
"""
import base64
import json
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

import httpx

from ..models import Article, ReactSiteConnection
from . import crypto
from .net import site_client
from .url_safety import SSRFValidationError, validate_url_shape

STATUS_OUT = {"draft": "draft", "publish": "published", "schedule": "scheduled"}
DEFAULT_TOKEN_MINUTES = 50  # when the site gives no expiry: renew well before a typical 1-hour token runs out


class ReactSiteError(RuntimeError):
    pass


class AuthFailed(ReactSiteError):
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
    if p.scheme != "https":
        raise ReactSiteError("Use an https:// address: credentials and tokens are never sent over plain http.")
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


def _msg(r: httpx.Response) -> str:
    try:
        d = r.json()
        if isinstance(d, dict):
            return str(d.get("message") or d.get("error") or d.get("detail") or r.text[:160])[:200]
    except ValueError:
        pass
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", r.text))[:160].strip() or f"HTTP {r.status_code}"


def _unseal(v: str | None) -> str | None:
    return crypto.unseal(v) if v else None


def key_of(conn: ReactSiteConnection) -> str | None:
    return _unseal(conn.api_key_enc)


def has_credentials(conn: ReactSiteConnection) -> bool:
    return bool(conn.login_username and conn.password_enc) if conn.auth_scheme == "login" else bool(conn.api_key_enc)


# ── login + token ───────────────────────────────────────────────────────────────

def _find(d, names):
    if isinstance(d, dict):
        for n in names:
            if d.get(n) not in (None, ""):
                return d[n]
        for k in ("data", "result", "auth", "tokens"):
            v = _find(d.get(k), names)
            if v not in (None, ""):
                return v
    return None


def _jwt_exp(token: str) -> datetime | None:
    try:
        part = token.split(".")[1]
        payload = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
        return datetime.fromtimestamp(int(payload["exp"]), tz=timezone.utc) if "exp" in payload else None
    except (IndexError, ValueError, KeyError, TypeError):
        return None


def login(client: httpx.Client, conn: ReactSiteConnection) -> tuple[str, datetime]:
    """Sign in as the integration user. Returns (token, expires_at). Raises AuthFailed with the site's message."""
    path = normalize_path(conn.auth_endpoint)
    user, password = (conn.login_username or "").strip(), _unseal(conn.password_enc)
    if not (path and user and password):
        raise AuthFailed("Enter the login username/email, password and authentication endpoint.")
    body = {"username": user, "password": password}
    if "@" in user:
        body["email"] = user
    try:
        r = client.post(normalize_base(conn.api_base_url) + path, json=body)
    except httpx.HTTPError as exc:
        raise ReactSiteError(f"Could not reach the login endpoint: {str(exc)[:140]}") from exc
    if r.status_code == 404:
        raise AuthFailed(f"The login endpoint {path} does not exist (404) on the website.")
    if r.status_code == 405 or (r.status_code < 400 and "json" not in r.headers.get("content-type", "")):
        hint = f" Did you mean /api{path}?" if not path.startswith("/api/") else ""
        raise AuthFailed(f"{path} is a page of the website, not its API (answered {r.status_code} {'Not Allowed' if r.status_code == 405 else 'with HTML'}).{hint} "
                         "API endpoints on this site start with /api/.")
    if r.status_code in (400, 401, 403, 422):
        raise AuthFailed(f"Login refused: {_msg(r)}")
    if r.status_code >= 400:
        raise ReactSiteError(f"The login endpoint answered {r.status_code}: {_msg(r)}")
    try:
        d = r.json()
    except ValueError:
        d = {}
    token = _find(d, ("token", "accessToken", "access_token", "jwt", "authToken", "auth_token"))
    if not token or not isinstance(token, str):
        raise AuthFailed("The website accepted the login but returned no access token (expected JSON like {\"token\": \"…\"}).")
    expires_at = _jwt_exp(token)
    seconds = _find(d, ("expires_in", "expiresIn"))
    if expires_at is None and isinstance(seconds, (int, float)) and seconds > 0:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(seconds))
    return token, expires_at or datetime.now(timezone.utc) + timedelta(minutes=DEFAULT_TOKEN_MINUTES)


def _token(client: httpx.Client, conn: ReactSiteConnection, force: bool = False) -> str:
    """A valid access token: the cached one while it has more than a minute left, otherwise a fresh login (cached encrypted)."""
    exp = conn.token_expires_at
    if exp is not None and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if not force and conn.token_enc and exp and exp - timedelta(minutes=1) > datetime.now(timezone.utc):
        return _unseal(conn.token_enc)
    token, expires_at = login(client, conn)
    conn.token_enc, conn.token_expires_at = crypto.seal(token), expires_at
    return token


def auth_headers(client: httpx.Client, conn: ReactSiteConnection, force: bool = False) -> dict:
    if conn.auth_scheme == "login":
        return {"Authorization": f"Bearer {_token(client, conn, force)}"}
    key = key_of(conn)
    if not key:
        raise AuthFailed("No API key is saved for this website.")
    return {"X-API-Key": key} if conn.auth_scheme == "x-api-key" else {"Authorization": f"Bearer {key}"}


def _send(client: httpx.Client, conn: ReactSiteConnection, method: str, url: str, **kw) -> httpx.Response:
    """One authenticated request; with login auth a refused token (401) is renewed once and the request repeated."""
    extra = kw.pop("headers", {})
    r = client.request(method, url, headers={**auth_headers(client, conn), **extra}, **kw)
    if r.status_code == 401 and conn.auth_scheme == "login":
        r = client.request(method, url, headers={**auth_headers(client, conn, force=True), **extra}, **kw)
    return r


# ── connection test ─────────────────────────────────────────────────────────────

def test(conn: ReactSiteConnection) -> tuple[list[dict], bool]:
    """Real requests to the site, step by step. Returns (steps, connected).
    login: connected = the login returns a token (and, when a health endpoint is set, it accepts the token).
    key:   connected = the health endpoint accepts the key and refuses a request without it."""
    steps: list[dict] = []

    def step(name, ok, detail):
        steps.append({"step": name, "ok": bool(ok), "detail": detail})
        return ok

    try:
        base = normalize_base(conn.api_base_url)
        health = normalize_path(conn.health_endpoint)
    except ReactSiteError as exc:
        step("Check the settings", False, str(exc))
        return steps, False
    try:
        with site_client(20) as c:
            if conn.website_url:
                try:
                    w = c.get(normalize_base(conn.website_url))
                    step("Reach the website", w.status_code < 400, f"{conn.website_url} answered {w.status_code}")
                except (httpx.HTTPError, ReactSiteError, SSRFValidationError) as exc:
                    step("Reach the website", False, f"Could not connect: {str(exc)[:120]}")
            if conn.auth_scheme == "login":
                try:
                    _token(c, conn, force=True)
                except ReactSiteError as exc:
                    step("Sign in as the integration user", False, str(exc))
                    return steps, False
                exp = conn.token_expires_at
                step("Sign in as the integration user", True, f"Signed in as {conn.login_username}; access token valid until {exp.strftime('%d %b %H:%M UTC') if exp else 'unknown'}")
                if not health:
                    return steps, True
                r = _send(c, conn, "GET", base + health)
                if r.status_code == 404:
                    step("Access the blog API with the token", False, f"{base}{health} does not exist on the website (404). "
                                                                      "The health endpoint is optional: clear that field and test again.")
                    return steps, False
                if r.status_code >= 400:
                    step("Access the blog API with the token", False, f"{base}{health} answered {r.status_code}: {_msg(r)}")
                    return steps, False
                step("Access the blog API with the token", True, f"{base}{health} answered {r.status_code}")
                return steps, True

            # fixed API key
            if not key_of(conn):
                step("Check the settings", False, "Enter the API key issued by the website's backend.")
                return steps, False
            if not health:
                step("Check the settings", False, "Enter the health/test endpoint for API-key authentication.")
                return steps, False
            r = c.get(base + health, headers=auth_headers(c, conn))
            if r.status_code in (401, 403):
                step("API key accepted", False, f"The website refused the key: {_msg(r)}")
                return steps, False
            if r.status_code >= 400:
                step("Reach the blog API", False, f"{base}{health} answered {r.status_code}: {_msg(r)}")
                return steps, False
            step("Reach the blog API", True, f"{base}{health} answered {r.status_code}")
            anon = c.get(base + health)
            if anon.status_code in (401, 403):
                step("API key accepted", True, "Accepted with the key, refused without it")
                return steps, True
            step("API key accepted", False, f"This endpoint also answers without a key ({anon.status_code}), so the key could not be verified.")
            return steps, False
    except SSRFValidationError as exc:
        step("Reach the blog API", False, str(exc))
        return steps, False


# ── publishing ──────────────────────────────────────────────────────────────────

def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:90] or "article"


def _id_of(d) -> str | None:
    v = _find(d, ("id", "_id", "blog_id", "post_id", "insertId"))
    return str(v) if v not in (None, "") else None


def payload(a: Article, mode: str, when: datetime | None, image_url: str | None) -> dict:
    """The article as JSON, in the shape of the site's own blog records (title, slug, body, SEO fields, image, status)."""
    from . import articles as svc, elementor_layout as el

    body = el.clean_body(a.body or "")
    schema = "\n".join(re.findall(r"<script\b[^>]*application/ld\+json[^>]*>([\s\S]*?)</script>", body))
    body_only = re.sub(r"\s*<script\b[^>]*application/ld\+json[^>]*>[\s\S]*?</script>\s*", "\n", body).strip()
    faqs = [{"question": q, "answer": ans} for q, ans in svc.faqs_of(body_only) if not svc._is_template_faq(q, ans)]
    keywords = [k for k in [a.keyword, *(a.secondary_keywords or [])] if k]
    pub_at = (when or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return {
        "title": a.title or a.keyword, "slug": _slug(a.title or a.keyword), "body": body_only,
        "excerpt": a.meta_description or "", "seo_title": a.title or a.keyword, "seo_description": a.meta_description or "",
        "focus_keyword": a.keyword, "secondary_keywords": a.secondary_keywords or [], "seo_keywords": ", ".join(keywords),
        "tags": keywords[:8], "category": (a.topic or a.keyword or "").strip().title(),
        "image": image_url or "", "image_alt": (a.featured_image_alt or a.title or "") if image_url else "",
        "status": STATUS_OUT[mode], "date": pub_at.strftime("%Y-%m-%d"), "publication_time": pub_at.isoformat(timespec="seconds"),
        "faqs": faqs, "schema_jsonld": schema.strip(), "source": "growzen", "growzen_article_id": a.id,
    }


def _upload_image(c: httpx.Client, conn: ReactSiteConnection, a: Article, steps: list[dict]) -> str | None:
    """Send the featured image (the optimized WebP) to the site's image endpoint; returns its public URL."""
    from . import featured_images as fi

    p = fi.path_of(a.featured_image_path)
    path = normalize_path(conn.image_endpoint)
    if not p:
        return None
    if not path:
        steps.append({"step": "Featured image", "ok": False, "detail": "No image upload endpoint configured; the post is sent without an image"})
        return None
    r = _send(c, conn, "POST", normalize_base(conn.api_base_url) + path,
              files={"image": (fi.upload_filename(a, a.featured_image_path), p.read_bytes(), fi.media_type(a.featured_image_path))},
              data={"alt": a.featured_image_alt or a.title or ""})
    if r.status_code in (401, 403):
        raise AuthFailed(f"The website refused the image upload: {_msg(r)}")
    if r.status_code >= 400:
        raise ReactSiteError(f"The website could not store the featured image ({r.status_code}): {_msg(r)}")
    try:
        url = _find(r.json(), ("url", "imageUrl", "image_url", "location", "path", "file"))
    except ValueError:
        url = None
    if not url or not isinstance(url, str):
        raise ReactSiteError("The image endpoint answered without a URL (expected JSON like {\"url\": \"https://...\"}).")
    url = url if url.startswith("http") else normalize_base(conn.website_url or conn.api_base_url) + "/" + url.lstrip("/")
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
    existing = a.react_post_id if a.react_status != "deleted" else None
    try:
        with site_client(60) as c:
            if a.featured_image_path and a.react_image_url and a.react_image_path == a.featured_image_path:
                image_url = a.react_image_url  # same image as last time: no second upload
                steps.append({"step": "Featured image", "ok": True, "detail": f"Already on the website: {image_url}"})
            else:
                image_url = _upload_image(c, conn, a, steps) if a.featured_image_path else None
            data = payload(a, mode, when, image_url)
            r = None
            if existing:
                r = _send(c, conn, "PUT", f"{base}{path}/{existing}", json=data)
                if r.status_code in (404, 410):
                    steps.append({"step": "Find the existing post", "ok": True, "detail": f"Post {existing} is no longer on the website; creating it again"})
                    existing, r = None, None
            if r is None:
                r = _send(c, conn, "POST", base + path, json=data)
    except (httpx.HTTPError, SSRFValidationError) as exc:
        steps.append({"step": "Send to the website", "ok": False, "detail": str(exc)[:140]})
        raise ReactSiteError(f"Could not reach the website's API: {str(exc)[:160]}") from exc
    if r.status_code in (401, 403):
        raise AuthFailed(f"The website refused the request: {_msg(r)}")
    if r.status_code >= 400:
        raise ReactSiteError(f"The website refused the post ({r.status_code}): {_msg(r)}")
    try:
        d = r.json()
    except ValueError:
        d = {}
    pid = _id_of(d) or existing
    if not pid:
        raise ReactSiteError("The website accepted the post but did not return its id (expected JSON like {\"id\": 12}), so it could not be updated or deleted later.")
    slug = _find(d, ("slug",)) or data["slug"]
    url = _find(d, ("url", "link", "permalink"))
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
    try:
        with site_client(30) as c:
            r = _send(c, conn, "DELETE", f"{normalize_base(conn.api_base_url)}{path}/{post_id}")
    except (httpx.HTTPError, SSRFValidationError) as exc:
        raise ReactSiteError(f"Could not reach the website's API: {str(exc)[:160]}") from exc
    if r.status_code == 404:
        return {"steps": [{"step": "Delete the post on the website", "ok": True, "detail": f"Post {post_id} was already removed"}], "already_gone": True}
    if r.status_code in (401, 403):
        raise AuthFailed(f"The website refused to delete post {post_id}: {_msg(r)}")
    if r.status_code >= 400:
        raise ReactSiteError(f"The website could not delete post {post_id} ({r.status_code}): {_msg(r)}")
    return {"steps": [{"step": "Delete the post on the website", "ok": True, "detail": f"Post {post_id} deleted"}], "already_gone": False}
