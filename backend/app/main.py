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
from .backlinks.router import outcomes_router, watch_router
from .config import get_settings
from .db import SessionLocal, engine
from .routers import agent, articles, assistant, auth, businesses, connections, copilot, discover, growth, intake, keyword_trends, leads, gbp_manage, lighthouse, profile, seo, site_integration, system, website
from .services import jobs, lighthouse_runner, schema, scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
# httpx logs every request URL at INFO, and PageSpeed Insights takes the API key in the query string.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    db = SessionLocal()
    try:
        if settings.schema_auto_sync:
            schema.sync(engine)
        auth.seed_admin(db, settings)
        lighthouse_runner.recover_interrupted(db)
        jobs.recover_stale(db, startup=True)
    except Exception as exc:  # e.g. migrations not run yet
        logging.getLogger("seo").warning("Start-up step skipped: %s", exc)
    finally:
        db.close()
    scheduler.start()
    yield
    from .backlinks import stop as backlink_stop
    backlink_stop.STOP.set()  # let a running crawl finish its current page and leave, so shutdown does not hang
    scheduler.stop()
    lighthouse_runner.stop()


app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)
# max_age is short on purpose: browsers cache a preflight answer, and a stale one (from another process that held this port) would keep failing PATCH for 10 minutes.
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_list, allow_credentials=True, allow_methods=["*"], allow_headers=["*"], max_age=30)

for r in (system, auth, businesses, profile, gbp_manage, growth, seo, assistant, leads, intake, connections, discover, agent, copilot, website, lighthouse, keyword_trends, articles, site_integration, competitors, competitor_audits, competitor_research, backlinks):
    app.include_router(r.router, prefix=settings.api_prefix)

app.include_router(outcomes_router, prefix=settings.api_prefix)
app.include_router(watch_router, prefix=settings.api_prefix)

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
