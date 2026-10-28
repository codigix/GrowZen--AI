"""SEO platform API (FastAPI). Separate service from the CRM: own database, own process.

Run:  uvicorn app.main:app --port 8100
Docs: http://localhost:8100/docs
"""
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .config import get_settings
from .db import Base, SessionLocal, engine
from . import models  # noqa: F401 - register all tables
from .routers import agent, auth, businesses, connections, copilot, discover, growth, intake, leads, lighthouse, profile, system, website
from .services import lighthouse_runner, scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
# httpx logs every request URL at INFO, and PageSpeed Insights takes the API key in the query string.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Ensure database schema is created if running fresh or with SQLite
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as exc:
        logging.getLogger("seo").warning("Table creation skipped: %s", exc)

    db = SessionLocal()
    try:
        auth.seed_admin(db, settings)
        lighthouse_runner.recover_interrupted(db)
    except Exception as exc:  # e.g. migrations not run yet
        logging.getLogger("seo").warning("Start-up step skipped: %s", exc)
    finally:
        db.close()
    scheduler.start()
    yield
    scheduler.stop()
    lighthouse_runner.stop()


app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_list, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logging.getLogger("seo").exception("Unhandled server error on %s %s: %s", request.method, request.url.path, exc)
    response = JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {exc}"},
    )
    origin = request.headers.get("origin")
    if origin and (origin in settings.cors_list or "*" in settings.cors_list):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Methods"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "*"
    return response


for r in (system, auth, businesses, profile, growth, leads, intake, connections, discover, agent, copilot, website, lighthouse):
    app.include_router(r.router, prefix=settings.api_prefix)

# Production: serve the built frontend (frontend/dist) from the same address as the API.
_dist = (Path(__file__).resolve().parent.parent / settings.frontend_dist).resolve()
if (_dist / "index.html").is_file():
    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        if path.startswith(settings.api_prefix.strip("/")):
            raise HTTPException(404, "Not found")
        f = (_dist / path).resolve()
        return FileResponse(f if f.is_file() and _dist in f.parents else _dist / "index.html")
