from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.base import BaseHTTPMiddleware

from app.api import audits as audits_api
from app.api import health as health_api
from app.api import site_audits as site_audits_api
from app.config import get_settings
from app.database import init_db
from app.services.audit_service import AuditManager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("lighthouse_app")

# httpx logs the full request URL (including query-string params) at INFO
# level by default. The PageSpeed Insights API only supports passing the API
# key as a query parameter, so that default would otherwise print the secret
# key straight into the server log on every request. Silence it explicitly.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

settings = get_settings()

MAX_REQUEST_BODY_BYTES = 64 * 1024  # API payloads here are small JSON bodies only.


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith("/api/"):
            content_length = request.headers.get("content-length")
            if content_length and int(content_length) > MAX_REQUEST_BODY_BYTES:
                return JSONResponse(status_code=413, content={"detail": "Request body too large"})
        return await call_next(request)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple in-memory sliding-window rate limiter.

    Single-process only -- adequate for local/dev use. A multi-instance
    deployment should move this to a shared store (e.g. Redis).
    """

    def __init__(self, app, limit_per_minute: int) -> None:
        super().__init__(app)
        self.limit = limit_per_minute
        self._hits: dict[str, deque] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next):
        if request.method == "POST" and request.url.path in ("/api/audits", "/api/site-audits"):
            client_ip = request.client.host if request.client else "unknown"
            now = time.monotonic()
            window = self._hits[client_ip]
            while window and now - window[0] > 60:
                window.popleft()
            if len(window) >= self.limit:
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Too many audit requests. Please wait a minute and try again."},
                )
            window.append(now)
        return await call_next(request)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    manager = AuditManager(settings)
    manager.recover_interrupted_audits()
    app.state.audit_manager = manager
    logger.info(
        "Startup: pagespeed_configured=%s local_lighthouse_enabled=%s "
        "max_concurrent_audits=%s max_concurrent_pagespeed_audits=%s",
        settings.pagespeed_configured,
        settings.local_lighthouse_enabled,
        settings.max_concurrent_audits,
        settings.max_concurrent_pagespeed_audits,
    )
    yield


app = FastAPI(title="Lighthouse Audit Tool", lifespan=lifespan)

app.add_middleware(BodySizeLimitMiddleware)
app.add_middleware(RateLimitMiddleware, limit_per_minute=settings.rate_limit_per_minute)

app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")

app.include_router(health_api.router)
app.include_router(audits_api.router)
app.include_router(site_audits_api.router)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception for %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/")
async def dashboard(request: Request):
    return templates.TemplateResponse(request, "dashboard.html", {})
