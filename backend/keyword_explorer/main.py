"""Main FastAPI Application Entrypoint for Keyword Explorer."""

from contextlib import asynccontextmanager
from typing import AsyncGenerator
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes.keywords import router as keywords_router
from .config import settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Lifespan context manager for resource management and startup logging."""
    print(f"[{settings.APP_NAME}] Starting v{settings.APP_VERSION}")
    print(f"[{settings.APP_NAME}] Concurrency Limit: {settings.KEYWORD_FETCH_CONCURRENCY}")
    print(f"[{settings.APP_NAME}] Request Timeout: {settings.KEYWORD_API_TIMEOUT_SECONDS}s")
    yield
    print(f"[{settings.APP_NAME}] Shutting down gracefully...")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description=(
        "Production-grade SEO Keyword Research API converted from Keyword Explorer. "
        "Aggregates real-time suggestions across Google, YouTube, Bing, Amazon, DuckDuckGo, "
        "eBay, App Stores, and Social platforms with transparent metrics provenance and low-memory optimizations."
    ),
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# Enable CORS for local client integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(keywords_router)


@app.get("/", tags=["General"])
async def root():
    """Root endpoint providing service information and API navigation links."""
    return {
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "online",
        "documentation": "/docs",
        "endpoints": {
            "search": "POST /api/keywords",
            "platforms": "GET /api/keywords/platforms",
            "export_csv": "GET /api/keywords/export",
        },
    }

