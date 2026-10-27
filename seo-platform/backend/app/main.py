"""SEO platform API (FastAPI). Separate service from the CRM: own database, own process.

Run:  uvicorn app.main:app --port 8100
Docs: http://localhost:8100/docs
"""
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .config import get_settings
from .db import SessionLocal
from .routers import agent, auth, businesses, connections, discover, growth, intake, leads, profile, system, website
from .services import scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    db = SessionLocal()
    try:
        auth.seed_admin(db, settings)
    except Exception as exc:  # e.g. migrations not run yet
        logging.getLogger("seo").warning("Admin seed skipped: %s", exc)
    finally:
        db.close()
    scheduler.start()
    yield
    scheduler.stop()


app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_list, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

for r in (system, auth, businesses, profile, growth, leads, intake, connections, discover, agent, website):
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
