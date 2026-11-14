"""SEO platform API (FastAPI). Separate service from the CRM: own database, own process.

Run:  uvicorn app.main:app --port 8000
Docs: http://localhost:8000/docs
"""
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

# Ensure backend root is on sys.path for sibling packages like keyword_explorer
_backend_root = Path(__file__).resolve().parent.parent
if str(_backend_root) not in sys.path:
    sys.path.insert(0, str(_backend_root))

from keyword_explorer.api.routes.keywords import router as keyword_explorer_router

from .competitors import audit_router as competitor_audits, intel_router as competitor_research, router as competitors
from .auth import current_user
from .backlinks import router as backlinks
from .backlinks.crawler_api import router as crawler_router
from .backlinks.hub_router import router as hub_router
from .routers.blog_flow import router as blog_flow_router
from .routers.fix_plan import router as fix_plan_router
from .backlinks.router import lookup_router, outcomes_router, watch_router
from .config import get_settings
from .db import SessionLocal, engine
from .routers import agent, articles, assistant, auth, businesses, connections, copilot, discover, growth, intake, keyword_planner, keyword_trends, leads, gbp_manage, lighthouse, profile, react_site, seo, site_integration, system, website, workplan, tools
# from .routers import agent, articles, assistant, auth, businesses, connections, copilot, discover, growth, intake, keyword_planner, keyword_trends, leads, gbp_manage, lighthouse, profile, react_site, seo, site_integration, system, website, workplan, tools
# from .routers import agent, articles, assistant, auth, businesses, connections, copilot, discover, growth, intake, keyword_planner, keyword_trends, leads, gbp_manage, lighthouse, profile, react_site, seo, site_integration, system, website, workplan, tools
# from .routers import agent, articles, assistant, auth, businesses, connections, copilot, discover, growth, intake, keyword_planner, keyword_trends, leads, gbp_manage, lighthouse, profile, react_site, seo, site_integration, system, website
from . import startup_state
from .services import jobs, lighthouse_runner, schema, scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
# httpx logs every request URL at INFO, and PageSpeed Insights takes the API key in the query string.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
settings = get_settings()
from . import security_headers  # noqa: E402
security_headers.startup_checks(settings)  # weak SECRET_KEY / wildcard CORS stop the server in every environment


@asynccontextmanager
async def lifespan(_: FastAPI):
    with SessionLocal() as _db:
        security_headers.check_encryption_key(_db, settings)  # outside the try below on purpose: this one must stop the start
    startup_state.clear()
    log = logging.getLogger("seo")

    def step(name: str, fn) -> None:
        """Each start-up step on its own: one failing must not silently skip the ones after it, and it must be visible (log + /status)."""
        db = SessionLocal()
        try:
            fn(db)
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            log.error("Start-up step '%s' FAILED: %s", name, exc)
            startup_state.record(name, exc)
        finally:
            db.close()

    def schema_step(_db):
        if settings.schema_auto_sync and not schema.is_current(engine):
            schema.sync(engine)
            schema.mark_current(engine)

    def owners_step(db):
        from .deps import backfill_owners
        backfill_owners(db)
    step("schema update", schema_step)
    step("admin account", lambda db: auth.seed_admin(db, settings))
    step("project owners", owners_step)
    from .services import autopilot as _autopilot
    step("approval rules", _autopilot.enforce)
    step("interrupted Lighthouse audits", lighthouse_runner.recover_interrupted)
    step("interrupted jobs", lambda db: jobs.recover_stale(db, startup=True))
    scheduler.start()
    yield
    from .backlinks import stop as backlink_stop
    backlink_stop.STOP.set()  # let a running crawl finish its current page and leave, so shutdown does not hang
    scheduler.stop()
    lighthouse_runner.stop()


app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan, **security_headers.docs_kwargs(settings))


from fastapi.responses import JSONResponse  # noqa: E402
from .errors import DataUnavailable  # noqa: E402


@app.exception_handler(DataUnavailable)
async def _data_unavailable(_request, exc: DataUnavailable):
    """A real data source is not set up: say what to set up (503), never answer with invented numbers."""
    return JSONResponse(status_code=503, content={"detail": exc.message, "code": "data_unavailable"})

# max_age is short on purpose: browsers cache a preflight answer, and a stale one (from another process that held this port) would keep failing PATCH for 10 minutes.
from starlette.middleware.gzip import GZipMiddleware  # noqa: E402
app.add_middleware(GZipMiddleware, minimum_size=1000)  # JSON compresses ~10x: far less to send on every page
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_list, allow_credentials=True, allow_methods=["*"], allow_headers=["*"], max_age=30)
security_headers.install(app, settings)  # security headers + cross-site request check (outside CORS)

for r in (system, auth, businesses, profile, gbp_manage, growth, seo, assistant, leads, intake, connections, discover, agent, copilot, website, lighthouse, keyword_trends, keyword_planner, articles, site_integration, react_site, competitors, competitor_audits, competitor_research, backlinks, workplan, tools):
# for r in (system, auth, businesses, profile, gbp_manage, growth, seo, assistant, leads, intake, connections, discover, agent, copilot, website, lighthouse, keyword_trends, keyword_planner, articles, site_integration, react_site, competitors, competitor_audits, competitor_research, backlinks, workplan, tools):
# for r in (system, auth, businesses, profile, gbp_manage, growth, seo, assistant, leads, intake, connections, discover, agent, copilot, website, lighthouse, keyword_trends, keyword_planner, articles, site_integration, react_site, competitors, competitor_audits, competitor_research, backlinks, workplan, tools):
# for r in (system, auth, businesses, profile, gbp_manage, growth, seo, assistant, leads, intake, connections, discover, agent, copilot, website, lighthouse, keyword_trends, keyword_planner, articles, site_integration, react_site, competitors, competitor_audits, competitor_research, backlinks):
    app.include_router(r.router, prefix=settings.api_prefix)

app.include_router(lookup_router, prefix=settings.api_prefix)
app.include_router(crawler_router, prefix=settings.api_prefix)
app.include_router(hub_router, prefix=settings.api_prefix)
app.include_router(blog_flow_router, prefix=settings.api_prefix)
app.include_router(fix_plan_router, prefix=settings.api_prefix)
app.include_router(outcomes_router, prefix=settings.api_prefix)
app.include_router(watch_router, prefix=settings.api_prefix)

from .routers import review_link  # noqa: E402
from .routers import growth_plan as growth_plan_router  # noqa: E402
from .routers import autopilot as autopilot_router  # noqa: E402
from .routers import backlink_check as backlink_check_router  # noqa: E402
from .routers import flow as flow_router  # noqa: E402
app.include_router(flow_router.router, prefix=settings.api_prefix)
app.include_router(flow_router.projects_router, prefix=settings.api_prefix)
app.include_router(backlink_check_router.router, prefix=settings.api_prefix)
app.include_router(autopilot_router.router, prefix=settings.api_prefix)
app.include_router(growth_plan_router.router, prefix=settings.api_prefix)
app.include_router(growth_plan_router.overview_router, prefix=settings.api_prefix)
from .routers import page_xray_lighthouse  # noqa: E402
app.include_router(page_xray_lighthouse.router, prefix=settings.api_prefix)
from .routers import page_xray  # noqa: E402
app.include_router(page_xray.router, prefix=settings.api_prefix)
from .routers import page_xray_history  # noqa: E402
app.include_router(page_xray_history.router, prefix=settings.api_prefix)
from .routers import gbp_reports  # noqa: E402
app.include_router(gbp_reports.router, prefix=settings.api_prefix)
from .routers import gbp_local_seo  # noqa: E402
app.include_router(gbp_local_seo.router, prefix=settings.api_prefix)
from .routers import gbp_competitors  # noqa: E402
app.include_router(gbp_competitors.router, prefix=settings.api_prefix)
from .routers import citations_manage  # noqa: E402
app.include_router(citations_manage.router, prefix=settings.api_prefix)
from .routers import notifications  # noqa: E402
app.include_router(notifications.router, prefix=settings.api_prefix)
from .routers import gbp_create  # noqa: E402
app.include_router(gbp_create.router, prefix=settings.api_prefix)
from .routers import gbp_location  # noqa: E402
app.include_router(gbp_location.router, prefix=settings.api_prefix)
app.include_router(review_link.router, prefix=settings.api_prefix)
app.include_router(review_link.public_router, prefix=settings.api_prefix)
from .routers import chatgpt_business  # noqa: E402
for _r in (chatgpt_business.router, chatgpt_business.overview_router, chatgpt_business.public_router, chatgpt_business.alias_router): app.include_router(_r, prefix=settings.api_prefix)
from .routers import gbp_admin  # noqa: E402
app.include_router(gbp_admin.router, prefix=settings.api_prefix)

from .routers import analytics_by_email  # noqa: E402
app.include_router(analytics_by_email.router, prefix=settings.api_prefix)

from .routers import ga4_by_email  # noqa: E402
app.include_router(ga4_by_email.router, prefix=settings.api_prefix)

# Keyword Explorer endpoints (/api/keywords)
# Signed-in users only: it calls external suggestion engines on our server's behalf, so it must not be open to the internet.
app.include_router(keyword_explorer_router, dependencies=[Depends(current_user)])

# Production: serve the built frontend (frontend/dist) from the same address as the API.
_dist = (Path(__file__).resolve().parent.parent / settings.frontend_dist).resolve()
if (_dist / "index.html").is_file():
    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        if path.startswith(settings.api_prefix.strip("/")) or path.startswith("api/"):
            raise HTTPException(404, "Not found")
        f = (_dist / path).resolve()
        return FileResponse(f if f.is_file() and _dist in f.parents else _dist / "index.html")
