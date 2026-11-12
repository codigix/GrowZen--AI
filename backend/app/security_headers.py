"""Web-security hardening that does not belong to one router: response headers, cross-site request checks, start-up guards.

install(app, settings)          adds the middlewares (call once, after CORS)
docs_kwargs(settings)           FastAPI(**docs_kwargs(settings)): no /docs or /openapi.json in production
startup_checks(settings)        refuses to start with a weak SECRET_KEY / wildcard CORS; warns about a readable .env
check_encryption_key(db, s)     refuses to start when Google connections exist but TOKEN_ENCRYPTION_KEY is missing or invalid
"""
import json
import logging
import os
import stat
from urllib.parse import urlsplit

from .config import Settings

log = logging.getLogger("seo.security")

MIN_SECRET_LENGTH = 32
# The browser-side app: its own scripts and styles, Google Fonts (index.html), images from anywhere over https (Google Business photos,
# favicons, OpenStreetMap tiles), data/blob images (QR codes, charts). `this.media='all'` is the font stylesheet's onload handler in index.html (allowed by its hash).
SPA_CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self' 'unsafe-hashes' 'sha256-MhtPZXr7+LpJUY5qtMutB+qWfQtMaPccfe7QXtCcEYc='",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])
API_CSP = "default-src 'none'; frame-ancestors 'none'"
# HTML that the API itself returns (audit and Lighthouse reports) keeps its own scripts and styles: it only may not be framed or embed plug-ins.
API_HTML_CSP = "frame-ancestors 'none'; object-src 'none'; base-uri 'none'"
BASE_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    "cross-origin-opener-policy": "same-origin",
}
# Public endpoints that take posts from anywhere: no origin check (they carry their own token / rate limit)
ORIGIN_EXEMPT = ("/intake/webhook", "/public/review/")
MUTATING = {"POST", "PUT", "PATCH", "DELETE"}


def _origin_of(url: str) -> str:
    p = urlsplit(url)
    return f"{p.scheme}://{p.netloc}".lower() if p.scheme and p.netloc else ""


class SecurityHeadersMiddleware:
    """Adds the security headers to every HTTP response (never overwrites one a route set itself)."""

    def __init__(self, app, settings: Settings):
        self.app = app
        self.api_prefix = settings.api_prefix.rstrip("/")
        self.hsts = settings.secure_cookies
        self.dev_docs = settings.environment.lower() != "production"

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope.get("path", "")
        is_https = scope.get("scheme") == "https"

        async def wrapped(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers") or [])
                have = {k.lower() for k, _ in headers}
                add = dict(BASE_HEADERS)
                if self.hsts or is_https:
                    add["strict-transport-security"] = "max-age=31536000; includeSubDomains"
                ctype = next((v.decode("latin-1") for k, v in headers if k.lower() == b"content-type"), "")
                if self.dev_docs and path in ("/docs", "/redoc", "/docs/oauth2-redirect"):
                    pass  # Swagger UI loads its script from a CDN; it only exists outside production
                elif ctype.startswith("text/html"):
                    add["content-security-policy"] = API_HTML_CSP if path.startswith(self.api_prefix + "/") else SPA_CSP
                else:
                    add["content-security-policy"] = API_CSP
                for k, v in add.items():
                    if k.encode() not in have:
                        headers.append((k.encode(), v.encode()))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, wrapped)


class OriginCheckMiddleware:
    """Cookie sessions need a cross-site request check. A browser sends Origin (or at least Referer) on every cross-site POST/PUT/PATCH/DELETE:
    when it names a site that is neither this one nor a configured frontend origin, the request is refused before it reaches a route.
    Requests with neither header (curl, servers) are not browser-driven and pass."""

    def __init__(self, app, settings: Settings):
        self.app = app
        self.allowed = {o.lower().rstrip("/") for o in settings.cors_list}
        self.allowed.add(_origin_of(settings.frontend_url))
        self.allowed.add(_origin_of(settings.public_base_url))
        self.enabled = settings.csrf_origin_check

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not self.enabled or scope["method"] not in MUTATING:
            return await self.app(scope, receive, send)
        path = scope.get("path", "")
        if any(x in path for x in ORIGIN_EXEMPT):
            return await self.app(scope, receive, send)
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        source = headers.get("origin")
        if source is None and headers.get("referer"):
            source = _origin_of(headers["referer"]) or "null"
        if source is not None:
            host = headers.get("host", "")
            same_site = bool(host) and source.lower() in (f"http://{host}".lower(), f"https://{host}".lower())
            if not same_site and source.lower().rstrip("/") not in self.allowed:
                log.warning("Refused a cross-site %s %s from origin %s", scope["method"], path, source[:80])
                body = json.dumps({"detail": "Cross-site request refused."}).encode()
                await send({"type": "http.response.start", "status": 403, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
                await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)


def install(app, settings: Settings) -> None:
    app.add_middleware(OriginCheckMiddleware, settings=settings)
    app.add_middleware(SecurityHeadersMiddleware, settings=settings)  # added last = outermost: it also dresses the refusals and the CORS answers


def docs_kwargs(settings: Settings) -> dict:
    """The interactive API docs list every route and parameter: not for a production server."""
    if settings.environment.lower() == "production":
        return {"docs_url": None, "redoc_url": None, "openapi_url": None}
    return {}


def startup_checks(settings: Settings) -> None:
    weak = settings.secret_key == "change-me" or len(settings.secret_key) < MIN_SECRET_LENGTH
    if weak and not settings.allow_insecure_dev:
        raise RuntimeError(
            f"SECRET_KEY is missing, the default 'change-me', or shorter than {MIN_SECRET_LENGTH} characters: sessions could be forged. "
            'Generate one with: python -c "import secrets; print(secrets.token_urlsafe(48))"  (ALLOW_INSECURE_DEV=true skips this check on a throw-away machine only).')
    if "*" in settings.cors_list:
        raise RuntimeError("CORS_ORIGINS must list the frontend addresses: '*' cannot be combined with cookie sessions.")
    if weak:
        log.warning("Running with a weak SECRET_KEY because ALLOW_INSECURE_DEV is on. Never do this on a server.")
    if os.name != "nt":
        from .config import _backend_dir, _repo_root
        for env in (_backend_dir / ".env", _repo_root / ".env"):
            try:
                if env.is_file() and env.stat().st_mode & (stat.S_IRWXG | stat.S_IRWXO):
                    log.warning("%s can be read by other users on this machine. Run: chmod 600 %s", env, env)
            except OSError:
                pass


def check_encryption_key(db, settings: Settings) -> None:
    """The Google refresh tokens are stored encrypted. If connections exist and the key is missing or not a valid Fernet key, nothing can be decrypted: stop early with the reason."""
    from sqlalchemy import func, select

    from .models import GoogleConnection
    try:
        n = db.scalar(select(func.count(GoogleConnection.id)))
    except Exception:  # noqa: BLE001 - tables not created yet (first start): nothing to protect
        return
    if not n:
        return
    key = settings.token_encryption_key
    try:
        from cryptography.fernet import Fernet
        Fernet(key.encode())
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError("TOKEN_ENCRYPTION_KEY is missing or invalid but Google connections are stored encrypted with it. "
                           'Restore the original key (a new key cannot decrypt them) or generate one with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"') from exc
