from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .routers.keywords import router as keywords_router

logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="Google Trends Keyword Planner",
    description=(
        "Standalone keyword-research service built on the unofficial pytrends "
        "client. Self-contained inside the google_trends/ folder."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.include_router(keywords_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


_frontend_dir = Path(__file__).resolve().parent.parent / "frontend"
if _frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(_frontend_dir), html=True), name="frontend")
