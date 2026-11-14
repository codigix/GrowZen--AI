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


LOGIN_GUESSES = ("/api/auth/login", "/api/login", "/api/admin/login", "/api/users/login", "/api/user/login", "/api/v1/auth/login", "/api/auth/signin")


def discover_login(client: httpx.Client, conn: ReactSiteConnection) -> str | None:
    """The configured login address does not exist: try the usual ones with the same credentials. Returns the first that gives a token, else None.
    (Only the website the user connected is contacted, with the credentials they entered for it.)"""
    first = conn.auth_endpoint
    try:
        for path in LOGIN_GUESSES:
            if path == normalize_path(first):
                continue
            conn.auth_endpoint = path
            try:
                login(client, conn)
                return path
            except (ReactSiteError, httpx.HTTPError):
                continue
    finally:
        conn.auth_endpoint = first
    return None


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
    first_path = conn.auth_endpoint

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
                    found = discover_login(c, conn) if "does not exist (404)" in str(exc) else None
                    if not found:
                        tried = ", ".join(LOGIN_GUESSES) if "does not exist (404)" in str(exc) else ""
                        step("Sign in as the integration user", False, str(exc) + (f" The usual alternatives were tried and none worked ({tried}). The website's backend must provide a login (see docs/react-site-blog-api.md), or enter its real login path." if tried else ""))
                        return steps, False
                    conn.auth_endpoint = found  # saved with the connection: the site's real login address
                    step("Find the login address", True, f"{normalize_path(first_path)} does not exist, but {found} signs in: it is now used.")
                    _token(c, conn, force=True)
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
        "tags": keywords[:8], "category": (a.keyword or a.topic or "").strip().title()[:60],  # short, like a real category: the topic is a whole sentence and can overflow the site's column
        "image": image_url or "", "image_alt": (a.featured_image_alt or a.title or "") if image_url else "",
        "status": STATUS_OUT[mode], "date": pub_at.strftime("%Y-%m-%d"), "publication_time": pub_at.isoformat(timespec="seconds"),
        "faqs": faqs, "schema_jsonld": schema.strip(), "source": "growzen", "growzen_article_id": a.id,
    }


CMS_STATUS = {"draft": "Draft", "publish": "Published"}
CMS_MARKERS = ("isPublished", "coverImage", "seoData")


def detect_profile(conn: ReactSiteConnection, sample: dict | None, list_text: str = "") -> str:
    """standard | cms. cms = a blog table of the kind this software's CMS-style sites use: `content`, `isPublished`, `coverImage`, a `seoData` JSON column.
    Read from an example record, or, when the site's list call fails, from the column names its own error message prints."""
    chosen = mapping_of(conn).get("profile", "auto")
    if chosen in ("standard", "cms"):
        return chosen
    if sample and "content" in sample and ("isPublished" in sample or "seoData" in sample):
        return "cms"
    return "cms" if sum(m in (list_text or "") for m in CMS_MARKERS) >= 2 else "standard"


def to_cms(a: Article, raw: dict, mode: str, when: datetime | None) -> dict:
    """The article as one record of a `content / isPublished / seoData` blog table: the same shape the site's own admin form saves
    (status "Draft" or "Published" with isPublished, SEO fields inside seoData, FAQs as {question, answer})."""
    words = len(re.sub(r"<[^>]+>", " ", raw.get("body") or "").split())
    published = mode == "publish"
    pub_at = (when or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return {
        "title": raw["title"], "slug": raw["slug"], "excerpt": raw.get("excerpt") or "", "category": raw.get("category") or "", "subCategory": "", "author": "Admin",
        "readingTime": max(1, round(words / 200)), "status": CMS_STATUS[mode], "isPublished": published,
        "coverImage": "", "bannerImage": "", "relatedImages": [], "imageAltText": "", "imageCaption": "",
        "content": raw["body"], "enableToc": False,
        "seoData": {"focusKeyword": raw.get("focus_keyword") or "", "secondaryKeywords": ", ".join(raw.get("secondary_keywords") or []), "seoTitle": raw.get("seo_title") or raw["title"],
                    "metaDescription": raw.get("seo_description") or "", "canonicalUrl": "", "index": True, "follow": True, "bannerImageAltText": "", "relatedImagesAltTexts": []},
        "socialMediaData": {"socialTitle": raw.get("seo_title") or raw["title"], "socialDescription": raw.get("seo_description") or "", "socialImage": ""},
        "ctaData": {"ctaType": "", "heading": "", "description": "", "buttonText": "", "buttonUrl": ""},
        "relatedCategories": [], "faqs": raw.get("faqs") or [], "internalLinks": [], "relatedProductIds": [], "visibility": "Public",
        "publishedAt": pub_at.strftime("%Y-%m-%d"),
    }


_SKIP_FROM_SAMPLE = {"id", "_id", "views", "likes", "created_at", "updated_at", "createdAt", "updatedAt"}


_last_list_text: dict[str, str] = {}


def _site_sample(c: httpx.Client, conn: ReactSiteConnection, base: str, path: str) -> dict | None:
    """One existing blog record from the website (its list endpoint): which columns its table has and their formats."""
    try:
        r = c.get(base + path)
        if r.status_code in (401, 403):
            r = _send(c, conn, "GET", base + path)
        _last_list_text[base + path] = r.text[:4000] if r.status_code >= 400 else ""
        d = r.json() if r.status_code == 200 else None
    except (httpx.HTTPError, ValueError):
        return None
    rows = d if isinstance(d, list) else _find(d, ("data", "blogs", "posts", "items", "results")) if isinstance(d, dict) else None
    rows = [x for x in rows if isinstance(x, dict)] if isinstance(rows, list) else []
    # the most filled-in record: it best shows how this site stores each field (e.g. its featured image)
    return max(rows, key=lambda x: sum(v not in (None, "") for v in x.values())) if rows else None


def fit_to_site(data: dict, sample: dict | None, keep: set | None = None) -> tuple[dict, list[str]]:
    """Shape the article like the website's own records, so its database accepts it as is:
    only the columns the site has (unknown keys would fail the insert), lists as text (a MySQL `SET ?` insert expands
    an array into invalid SQL), JSON columns as JSON text, and the site's casing for status and time format.
    Without a sample: flat values and only the standard blog fields. Returns (fitted, dropped_keys)."""
    standard = {"title", "slug", "body", "excerpt", "seo_title", "seo_description", "seo_keywords", "focus_keyword", "secondary_keywords",
                "tags", "category", "image", "image_alt", "status", "date", "publication_time"}
    columns = set(sample) - _SKIP_FROM_SAMPLE if sample else standard | (keep or set())
    out, dropped = {}, []
    for k, v in data.items():
        if k not in columns:
            dropped.append(k)
            continue
        model = sample.get(k) if sample else None
        if isinstance(v, (list, dict)):
            if isinstance(model, (list, dict)) or (isinstance(model, str) and model.strip().startswith(("[", "{"))):
                v = json.dumps(v, ensure_ascii=False)  # a JSON column
            elif isinstance(v, list) and all(isinstance(x, (str, int, float)) for x in v):
                v = ", ".join(str(x) for x in v)  # comma-separated text column
            else:
                v = json.dumps(v, ensure_ascii=False)
        out[k] = v
    if sample:
        st = sample.get("status")
        if isinstance(st, str) and st[:1].isupper() and isinstance(out.get("status"), str):
            out["status"] = out["status"].capitalize()  # the site writes "Published" / "Draft"
        pt = sample.get("publication_time")
        if isinstance(pt, str) and re.fullmatch(r"\d{1,2}:\d{2}", pt) and isinstance(out.get("publication_time"), str):
            out["publication_time"] = out["publication_time"][11:16]  # "2026-11-03T10:30:00+00:00" -> "10:30"
    return out, dropped


_LIMITS = (255, 191, 150, 100, 64, 32, 16)


def _too_long_column(r: httpx.Response) -> str | None:
    """The column a MySQL 'Data too long for column ...' error names (the site passes the database error through)."""
    if r.status_code < 400:
        return None
    m = re.search(r"Data too long for column '([\w]+)'", r.text)
    return m.group(1) if m else None


def _shorten(data: dict, col: str, steps: list[dict]) -> bool:
    """Cut a text field to the next smaller common column size, at a comma or word boundary. False when it cannot shrink."""
    v = data.get(col)
    if not isinstance(v, str) or not v:
        return False
    limit = next((n for n in _LIMITS if n < len(v)), None)
    if limit is None:
        return False
    cut = v[:limit]
    if "," in cut and len(v) > limit:
        cut = cut.rsplit(",", 1)[0]  # keep whole keywords
    elif " " in cut and len(v) > limit:
        cut = cut.rsplit(" ", 1)[0]
    data[col] = cut.strip(" ,")
    note = next((s for s in steps if s.get("step") == "Fit the website's field sizes"), None)
    text = f"{col} shortened to {len(data[col])} characters"
    if note:
        note["detail"] = re.sub(rf"{col} shortened to \d+ characters", text, note["detail"]) if col in note["detail"] else f"{note['detail']}; {text}"
    else:
        steps.append({"step": "Fit the website's field sizes", "ok": True, "detail": text})
    return True


# ── featured image upload: one contract, mapped per website ─────────────────────

DEFAULT_MAPPING = {
    "image_delivery": "upload",     # upload (separate upload API, URL stored) | inline (the image itself goes inside the blog POST, as a data URL in image_field)
    "upload_format": "multipart",  # multipart (file field) | json_base64 ({field: "data:image/webp;base64,...", filename, alt})
    "upload_field": "image",        # the file / base64 field name the site's upload API expects
    "alt_field": "alt",             # extra form field carrying the ALT text ("" = don't send)
    "response_url_path": "",        # where the URL is in the answer, dot notation (e.g. "data.file.url"); "" = detect
    "image_field": "image",         # the blog record field that stores the featured image URL
    "image_alt_field": "image_alt", # the blog record field for the ALT text ("" = none)
    "max_upload_mb": 5,             # the site's upload limit: larger images are re-compressed to fit first
    "profile": "auto",              # how the blog record is shaped: standard (title, body, seo_title...) | cms (content, isPublished, seoData...) | auto (decided from the site)
}
MAPPING_KEYS = tuple(DEFAULT_MAPPING)


def mapping_of(conn: ReactSiteConnection) -> dict:
    m = {**DEFAULT_MAPPING, **{k: v for k, v in (conn.mapping or {}).items() if k in DEFAULT_MAPPING and v not in (None,)}}
    try:
        m["max_upload_mb"] = max(0.1, min(float(m["max_upload_mb"]), 100.0))
    except (TypeError, ValueError):
        m["max_upload_mb"] = DEFAULT_MAPPING["max_upload_mb"]
    return m


def clean_mapping(raw: dict | None) -> dict:
    """Validate mapping settings from the form (field names and paths only; no code, no URLs)."""
    out = {}
    for k, v in (raw or {}).items():
        if k not in DEFAULT_MAPPING:
            continue
        if k == "image_delivery":
            if v not in ("upload", "inline"):
                raise ReactSiteError("Image delivery must be 'upload' or 'inline'.")
        elif k == "profile":
            if v not in ("auto", "standard", "cms"):
                raise ReactSiteError("Record shape must be auto, standard or cms.")
        elif k == "upload_format":
            if v not in ("multipart", "json_base64"):
                raise ReactSiteError("Request format must be multipart or json_base64.")
        elif k == "max_upload_mb":
            try:
                v = float(v)
            except (TypeError, ValueError) as exc:
                raise ReactSiteError("Maximum upload size must be a number of MB.") from exc
            if not 0.1 <= v <= 100:
                raise ReactSiteError("Maximum upload size must be between 0.1 and 100 MB.")
        else:
            v = (v or "").strip()
            if v and not re.fullmatch(r"[A-Za-z_][\w.\-]{0,79}", v):
                raise ReactSiteError(f"'{v}' is not a valid field name or path.")
            if k in ("upload_field", "image_field") and not v:
                raise ReactSiteError(f"{'Upload file field' if k == 'upload_field' else 'Blog image field'} cannot be empty.")
        out[k] = v
    return out


def _dig(d, path: str):
    for part in path.split("."):
        if isinstance(d, list) and part.isdigit():
            d = d[int(part)] if int(part) < len(d) else None
        elif isinstance(d, dict):
            d = d.get(part)
        else:
            return None
    return d


def _fit_size(data: bytes, max_bytes: int) -> tuple[bytes, str | None]:
    """Re-encode the WebP smaller (quality, then size) until it fits the site's limit. Returns (bytes, note)."""
    if len(data) <= max_bytes:
        return data, None
    import io

    from PIL import Image

    img = Image.open(io.BytesIO(data))
    img.load()
    for scale in (1.0, 0.85, 0.7, 0.55, 0.4):
        frame = img if scale == 1.0 else img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.Resampling.LANCZOS)
        for q in (75, 65, 55, 45):
            b = io.BytesIO()
            frame.save(b, "WEBP", quality=q, method=6)
            if b.tell() <= max_bytes:
                return b.getvalue(), f"re-compressed from {len(data) // 1024} KB to {b.tell() // 1024} KB ({frame.width}x{frame.height}) to fit the {round(max_bytes / 1048576, 2):g} MB limit"
    raise ReactSiteError(f"The image cannot be made smaller than the website's {round(max_bytes / 1048576, 2):g} MB upload limit.")


def upload_image_bytes(c: httpx.Client, conn: ReactSiteConnection, data: bytes, filename: str, alt: str, steps: list[dict]) -> str:
    """Upload one WebP to the website's configured upload API (auth, request format and response mapping from the
    connection) and return its public URL. Raises AuthFailed / ReactSiteError with the website's exact message."""
    m = mapping_of(conn)
    path = normalize_path(conn.image_endpoint)
    if not path:
        raise ReactSiteError("No image upload endpoint is configured for this website.")
    data, note = _fit_size(data, int(m["max_upload_mb"] * 1024 * 1024))
    if note:
        steps.append({"step": "Fit the upload size limit", "ok": True, "detail": note})
    url_in = normalize_base(conn.api_base_url) + path
    if m["upload_format"] == "json_base64":
        body = {m["upload_field"]: "data:image/webp;base64," + base64.b64encode(data).decode(), "filename": filename}
        if m["alt_field"]:
            body[m["alt_field"]] = alt
        r = _send(c, conn, "POST", url_in, json=body)
    else:
        r = _send(c, conn, "POST", url_in, files={m["upload_field"]: (filename, data, "image/webp")},
                  data={m["alt_field"]: alt} if m["alt_field"] else None)
    site_msg = _msg(r)
    if r.status_code == 404:
        raise ReactSiteError(f"The upload endpoint {path} was not found on the website (404): {site_msg}")
    if r.status_code in (401, 403):
        raise AuthFailed(f"The website refused the image upload (authentication): {site_msg}")
    if r.status_code == 413:
        raise ReactSiteError(f"The website says the image is too large (413): {site_msg}. Lower 'Maximum upload size' in the connection.")
    if r.status_code == 415 or (r.status_code == 400 and re.search(r"type|format|mime|extension|webp", site_msg, re.I)):
        raise ReactSiteError(f"The website does not accept this image format ({r.status_code}): {site_msg}")
    if r.status_code >= 500:
        raise ReactSiteError(f"The website's image storage failed ({r.status_code}): {site_msg}")
    if r.status_code >= 400:
        raise ReactSiteError(f"The website refused the image ({r.status_code}): {site_msg}")
    try:
        d = r.json()
    except ValueError:
        raise ReactSiteError(f"The upload endpoint answered {r.status_code} without JSON, so the image URL is unknown.") from None
    if isinstance(d, dict) and d.get("success") is False:
        raise ReactSiteError(f"The website reported the upload failed: {_msg(r)}")
    url = _dig(d, m["response_url_path"]) if m["response_url_path"] else _find(d, ("url", "imageUrl", "image_url", "location", "secure_url", "path", "file", "filename"))
    if not url or not isinstance(url, str):
        where = f"at '{m['response_url_path']}'" if m["response_url_path"] else "(looked for url, imageUrl, image_url, location, secure_url, path)"
        raise ReactSiteError(f"The upload succeeded but no image URL was found in the answer {where}. Set 'Response URL path' in the connection. Answer: {r.text[:160]}")
    if not url.startswith("http"):  # a relative path or bare file name: make it absolute on the website
        site = normalize_base(conn.website_url or conn.api_base_url)
        url = site + "/" + url.lstrip("/") if "/" in url else f"{site}/uploads/{url}"
    steps.append({"step": "Featured image", "ok": True, "detail": f"Uploaded: {url}"})
    return url


def _upload_image(c: httpx.Client, conn: ReactSiteConnection, a: Article, steps: list[dict]) -> str | None:
    """The article's featured image (already an optimized WebP) uploaded to the site; returns its public URL."""
    from . import featured_images as fi

    p = fi.path_of(a.featured_image_path)
    if not p:
        return None
    if not normalize_path(conn.image_endpoint):
        steps.append({"step": "Featured image", "ok": False, "detail": "No image upload endpoint configured; the post is sent without an image"})
        return None
    return upload_image_bytes(c, conn, p.read_bytes(), fi.upload_filename(a, a.featured_image_path), a.featured_image_alt or a.title or "", steps)


def _verify_image(conn: ReactSiteConnection, base: str, path: str, pid: str, image_url: str, steps: list[dict], field: str | None = None) -> None:
    """Read the post back: is the image URL stored in the mapped field, and does the image load publicly?"""
    field = field or mapping_of(conn)["image_field"]
    try:
        with site_client(30) as c:
            r = _send(c, conn, "GET", f"{base}{path}/{pid}")
            rec = r.json() if r.status_code == 200 else None
            rec = _find(rec, ("data", "blog", "post")) if isinstance(rec, dict) and field not in rec and _find(rec, ("data", "blog", "post")) else rec
            saved = _dig(rec, field) if isinstance(rec, dict) else None
            inline = image_url.startswith("data:")
            if r.status_code != 200:
                steps.append({"step": "Image saved on the post", "ok": False, "detail": f"Could not read post {pid} back ({r.status_code}) to check"})
            else:
                same = saved == image_url
                steps.append({"step": "Image saved on the post" if inline else "Image URL saved on the post", "ok": same,
                              "detail": (f"'{field}' holds the embedded image ({len(image_url) // 1024} KB, stored unchanged)" if inline else f"'{field}' holds the uploaded image")
                              if same else f"'{field}' = {str(saved)[:120]!r}"})
            if inline:
                return  # nothing separate to load: the page shows the image from the field itself
            img = c.get(image_url)
            steps.append({"step": "Image loads on the website", "ok": img.status_code == 200 and img.headers.get("content-type", "").startswith("image/"),
                          "detail": f"{image_url} answered {img.status_code} {img.headers.get('content-type', '')}"})
    except (httpx.HTTPError, SSRFValidationError, ReactSiteError, ValueError) as exc:
        steps.append({"step": "Image URL saved on the post", "ok": False, "detail": f"Could not verify: {str(exc)[:140]}"})


def _inline_image(a: Article, m: dict, steps: list[dict]) -> str | None:
    """The featured image as a data URL for the blog record's own image field (no upload API involved). The WebP is
    re-compressed to the configured size limit first, because every blog read returns this value."""
    from . import featured_images as fi

    p = fi.path_of(a.featured_image_path)
    if not p:
        return None
    data, note = _fit_size(p.read_bytes(), int(m["max_upload_mb"] * 1024 * 1024))
    if note:
        steps.append({"step": "Fit the image size limit", "ok": True, "detail": note})
    url = "data:image/webp;base64," + base64.b64encode(data).decode()
    steps.append({"step": "Featured image", "ok": True, "detail": f"Sent inside the blog post ({len(data) // 1024} KB) in the '{m['image_field']}' field"})
    return url


def test_upload(conn: ReactSiteConnection) -> tuple[list[dict], str | None]:
    """Upload one small labelled test image on its own (Test image upload). Returns (steps, url)."""
    import io

    if mapping_of(conn)["image_delivery"] == "inline":
        return [{"step": "Image delivery", "ok": True, "detail": "Images are sent inside the blog post (no separate upload). They are verified on every publish: "
                                                                   "the post is read back to confirm the image was stored."}], "inline"

    from PIL import Image, ImageDraw

    img = Image.new("RGB", (1200, 630), (236, 242, 255))
    d = ImageDraw.Draw(img)
    d.rectangle([40, 40, 1160, 590], outline=(79, 70, 229), width=6)
    d.text((80, 80), "GrowZen image upload test", fill=(30, 30, 90))
    b = io.BytesIO()
    img.save(b, "WEBP", quality=80)
    steps: list[dict] = []
    try:
        with site_client(60) as c:
            url = upload_image_bytes(c, conn, b.getvalue(), "growzen-upload-test.webp", "GrowZen image upload test", steps)
            chk = c.get(url)
            ok = chk.status_code == 200 and chk.headers.get("content-type", "").startswith("image/")
            steps.append({"step": "Image is publicly reachable", "ok": ok, "detail": f"{url} answered {chk.status_code} {chk.headers.get('content-type', '')}"})
            return steps, url
    except ReactSiteError as exc:
        steps.append({"step": "Featured image", "ok": False, "detail": str(exc)})
    except (httpx.HTTPError, SSRFValidationError) as exc:
        steps.append({"step": "Featured image", "ok": False, "detail": f"Could not reach the website: {str(exc)[:140]}"})
    return steps, None


# ── featured image straight into the website's own blog record ──────────────────

# common names for a blog record's featured-image field and its ALT text, tried in order (case-insensitive)
_IMAGE_FIELDS = ("image", "featured_image", "featuredImage", "cover_image", "coverImage", "image_url", "imageUrl", "thumbnail",
                 "thumbnail_url", "thumbnailUrl", "banner", "banner_image", "bannerImage", "hero_image", "heroImage", "main_image",
                 "blog_image", "blogImage", "post_image", "cover", "img", "photo", "picture", "og_image")
_ALT_FIELDS = ("image_alt", "imageAlt", "featured_image_alt", "featuredImageAlt", "alt", "alt_text", "altText", "image_alt_text", "cover_alt")
# embedded image sizes tried in turn when the site refuses a bigger one (column such as MySQL TEXT = 64 KB, or a request
# body limit such as Express's default 100 KB)
_INLINE_KB = (300, 100, 45)


def _image_fields(sample: dict | None, m: dict) -> tuple[str, str]:
    """(image field, ALT field) of this website's blog records: the configured name when its records have it, else the
    first common featured-image name they do have. Without an existing record to inspect: the configured names."""
    if not sample:
        return m["image_field"], m["image_alt_field"]
    by_lower = {k.lower(): k for k in sample}

    def pick(names):
        return next((by_lower[n.lower()] for n in names if n and n.lower() in by_lower), None)

    img = pick((m["image_field"], *_IMAGE_FIELDS)) or next(
        (k for k in sample if re.search(r"image|img|thumbnail|cover|banner|photo", k, re.I)
         and not re.search(r"alt|caption|title|width|height|size|type|credit|count", k, re.I)), None)
    if not img:
        raise ReactSiteError(f"This website's blog records have no featured-image field (they have: {', '.join(list(sample)[:20])}). "
                             "Its blog API must return and accept an image field. Nothing was published.")
    return img, pick((m["image_alt_field"], f"{img}_alt", f"{img}Alt", f"{img}_alt_text", *_ALT_FIELDS)) or ""


def _image_style(sample: dict | None, field: str) -> str | None:
    """How the site keeps its featured images, read from an existing record: 'inline' (the image data in the column),
    'absolute' (a full URL), 'relative' (a path or file name its pages complete), or None (no example to read)."""
    v = sample.get(field) if sample else None
    if not isinstance(v, str) or not v.strip():
        return None
    v = v.strip()
    if v.startswith("data:"):
        return "inline"
    return "absolute" if v.startswith(("http://", "https://", "//")) else "relative"


def _loads(c: httpx.Client, url: str) -> bool:
    try:
        r = c.get(url)
        return r.status_code == 200 and r.headers.get("content-type", "").startswith("image/")
    except (httpx.HTTPError, SSRFValidationError):
        return False


def _stored_url(c: httpx.Client, conn: ReactSiteConnection, a: Article, img_path, alt: str, steps: list[dict]) -> str:
    """The image in the website's own storage: its permanent URL, returned only once it loads publicly as an image."""
    from . import featured_images as fi

    if a.react_image_url and a.react_image_path == a.featured_image_path and _loads(c, a.react_image_url):
        steps.append({"step": "Featured image", "ok": True, "detail": f"Already on the website: {a.react_image_url}"})
        return a.react_image_url
    if not normalize_path(conn.image_endpoint):
        raise ReactSiteError("No image upload endpoint is configured for this website.")
    sub: list[dict] = []
    url = upload_image_bytes(c, conn, img_path.read_bytes(), fi.upload_filename(a, a.featured_image_path), alt, sub)
    if not _loads(c, url):
        raise ReactSiteError(f"The website answered with {url}, but that address does not load as an image.")
    steps.extend(sub)
    return url


def _image_too_big(r: httpx.Response, field: str) -> bool:
    """The site refused the request because the embedded image does not fit (its column or its request size limit)."""
    col = _too_long_column(r)
    if col:
        return col == field
    return r.status_code == 413 or bool(re.search(r"too large|entity|payload|max_allowed_packet|packet|request body|limit", r.text, re.I))


def _send_post(c: httpx.Client, conn: ReactSiteConnection, base: str, path: str, existing: str | None, data: dict,
               steps: list[dict], protect: set) -> tuple[httpx.Response, str | None]:
    """POST (or PUT when it exists) the record. The site's column limits are unknown: a text field it reports as too long
    is shortened and the request retried; protected fields (the image) are never cut. Returns (response, post id)."""
    r = None
    for _attempt in range(12):
        if existing:
            r = _send(c, conn, "PUT", f"{base}{path}/{existing}", json=data)
            if r.status_code in (404, 410):
                steps.append({"step": "Find the existing post", "ok": True, "detail": f"Post {existing} is no longer on the website; creating it again"})
                existing = None
                r = _send(c, conn, "POST", base + path, json=data)
        else:
            r = _send(c, conn, "POST", base + path, json=data)
        col = _too_long_column(r)
        if not col or col in protect or not _shorten(data, col, steps):
            break
    return r, existing


def _send_with_image(c: httpx.Client, conn: ReactSiteConnection, a: Article, img_path, sample: dict | None, data: dict,
                     steps: list[dict], base: str, path: str, existing: str | None) -> tuple[str, httpx.Response, str | None]:
    """Save the record with its featured image in the site's OWN image field, in the form the site already uses:
    a permanent URL from the site's storage, or the optimized WebP itself (data URL) in the column. Never sends the post
    without the image: when neither fits, raises a clear error. Returns (stored image value, response, post id)."""
    m = mapping_of(conn)
    img_field, alt_field = _image_fields(sample, m)
    style = "inline" if (conn.mapping or {}).get("image_delivery") == "inline" else _image_style(sample, img_field)
    alt = a.featured_image_alt or a.title or ""
    protect = {img_field}
    upload_problem = None
    if style != "inline":  # the site keeps image addresses (or has no example yet): its own storage first
        try:
            url = _stored_url(c, conn, a, img_path, alt, steps)
        except AuthFailed:
            raise
        except (ReactSiteError, httpx.HTTPError, SSRFValidationError) as exc:
            upload_problem = str(exc)[:300]
            steps.append({"step": "Image upload API", "ok": False, "detail": f"{upload_problem} Trying the blog record's '{img_field}' field directly."})
        else:
            data[img_field] = url
            if alt_field:
                data[alt_field] = alt
            r, existing = _send_post(c, conn, base, path, existing, data, steps, protect)
            return url, r, existing
        if style == "relative":  # its pages build the address from a path: embedded data would not display
            raise ReactSiteError(f"The featured image could not be stored: {upload_problem} This website keeps '{img_field}' as a file path "
                                 f"({str(sample[img_field])[:60]!r}), so the image cannot be embedded in the record instead. "
                                 "Fix the website's image upload API, then publish again. Nothing was published.")
    raw, last, last_len = img_path.read_bytes(), None, None
    for kb in _INLINE_KB:
        try:
            small, _note = _fit_size(raw, kb * 1024)
        except ReactSiteError:
            break
        if len(small) == last_len:
            continue  # already this small: the same bytes were refused
        last_len = len(small)
        value = "data:image/webp;base64," + base64.b64encode(small).decode()
        data[img_field] = value
        if alt_field:
            data[alt_field] = alt
        r, existing = _send_post(c, conn, base, path, existing, data, steps, protect)
        if r.status_code < 400:
            steps.append({"step": "Featured image", "ok": True, "detail": f"Stored in the blog record's '{img_field}' field ({len(small) // 1024} KB WebP)"
                                                                           + (" because the upload API failed" if upload_problem else "")})
            return value, r, existing
        if not _image_too_big(r, img_field):
            return value, r, existing  # refused for another reason: reported with the website's own message
        last = f"{_msg(r)} (at {len(small) // 1024} KB)"
    reasons = ([f"Upload API: {upload_problem}"] if upload_problem else []) + [f"The '{img_field}' field cannot hold the image itself: {last or 'it cannot be made small enough'}."]
    raise ReactSiteError("The featured image could not be stored. " + " ".join(reasons)
                         + " Fix the website's image upload API or enlarge that column (e.g. LONGTEXT), then publish again. Nothing was published.")


def publish(conn: ReactSiteConnection, a: Article, mode: str, when: datetime | None) -> dict:
    """Create the post (or update it when this article is already there). Returns {id, url, status, image_url, steps}."""
    from . import featured_images as fi

    if mode == "schedule" and (not when or when <= datetime.now(timezone.utc)):
        raise ReactSiteError("Pick a date and time in the future to schedule the post.")
    steps = [{"step": "Prepare the article", "ok": True, "detail": f"{len((a.body or '').split())} words, title: {a.title or a.keyword}"}]
    path = normalize_path(conn.publish_endpoint)
    if not path:
        raise ReactSiteError("Set the publishing endpoint in the React.js website connection first.")
    base = normalize_base(conn.api_base_url)
    existing = a.react_post_id if a.react_status != "deleted" else None
    img_path = fi.path_of(a.featured_image_path) if a.featured_image_path else None
    if a.featured_image_path and not img_path:
        raise ReactSiteError("The featured image file is missing in GrowZen. Upload it again in the Featured image section, then publish.")
    image_url, img_field = None, None
    try:
        with site_client(60) as c:
            sample = _site_sample(c, conn, base, path)
            raw = payload(a, mode, when, None)
            raw.pop("image"), raw.pop("image_alt")  # the image goes into the site's own field, set below
            profile = detect_profile(conn, sample, _last_list_text.get(base + path, ""))
            if profile == "cms":
                if mode == "schedule":
                    raise ReactSiteError("This website has no scheduled posts (its blog has only Draft and Published). Choose Save as draft or Publish now.")
                data, dropped = to_cms(a, raw, mode, when), []
                m = dict(conn.mapping or {})
                for k, v in (("image_delivery", "inline"), ("image_field", "coverImage"), ("image_alt_field", "imageAltText"), ("max_upload_mb", 0.5)):
                    if m.get(k) in (None, "", DEFAULT_MAPPING.get(k)):
                        m[k] = v  # this website keeps the image itself in coverImage (its admin form reads the file as a data URL)
                conn.mapping = m
                steps.append({"step": "Match the website's blog fields", "ok": True, "detail": "Sent in this website's own shape: content, isPublished, seoData, faqs"})
            else:
                data, dropped = fit_to_site(raw, sample)
            if dropped:
                steps.append({"step": "Match the website's blog fields", "ok": True, "detail": f"Not stored by this website: {', '.join(dropped)}"})
            if img_path:
                img_field = _image_fields(sample, mapping_of(conn))[0]
                image_url, r, existing = _send_with_image(c, conn, a, img_path, sample, data, steps, base, path, existing)
            else:
                r, existing = _send_post(c, conn, base, path, existing, data, steps, set())
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
    slug = _find(d, ("slug",)) or data.get("slug") or _slug(a.title or a.keyword)
    url = _find(d, ("url", "link", "permalink"))
    if not url:
        blog = (conn.blog_url or "").rstrip("/") or normalize_base(conn.website_url or conn.api_base_url) + "/blog"
        url = f"{blog}/{_page_key(conn, base, path, str(slug), str(pid))}"
    steps.append({"step": "Send to the website", "ok": True, "detail": f"Post {pid} {'updated' if existing else 'created'} as {data.get('status', STATUS_OUT[mode])}"})
    if image_url:
        _verify_image(conn, base, path, str(pid), image_url, steps, img_field)
    return {"id": str(pid), "url": url, "status": {"draft": "draft", "publish": "publish", "schedule": "scheduled"}[mode], "image_url": image_url, "steps": steps}


def _page_key(conn: ReactSiteConnection, base: str, path: str, slug: str, pid: str) -> str:
    """What follows /blog/ in the post's public address. A React blog page usually loads the post with the value from
    its address (GET {publish_endpoint}/{value}), so use the slug only when the site's API finds the post by slug;
    otherwise the post id (e.g. /blog/19), which the API always answers."""
    try:
        with site_client(15) as c:
            r = _send(c, conn, "GET", f"{base}{path}/{slug}")
            if r.status_code == 200:
                return slug
    except (httpx.HTTPError, SSRFValidationError, ReactSiteError):
        pass
    return pid


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
