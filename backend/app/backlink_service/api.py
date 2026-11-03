import asyncio
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from ..auth import current_user
from . import repository as repo
from . import lifecycle, slots

router = APIRouter(prefix="/backlinks", tags=["Seed Backlink Finder"], dependencies=[Depends(current_user)])


class CrawlRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target: str


class SeedsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    seed_urls: list[str] = Field(min_length=1, max_length=1000)


class BacklinkOut(BaseModel):
    source_url: str
    source_site: str
    source_title: str
    target_url: str
    anchor_text: str
    context: str
    found_in: str
    link_type: str
    rel: list[str]
    crawl_depth: int
    discovered_at: datetime
    last_seen_at: datetime


class BacklinksResponse(BaseModel):
    query: str
    match_mode: str
    total: int
    backlinks: list[BacklinkOut]


def _db():
    if lifecycle.state.db is None:
        raise HTTPException(503, "Backlink service database is not available.")
    return lifecycle.state.db


@router.post("/crawl", status_code=202)
async def start_crawl(body: CrawlRequest):
    """Register a target. The background worker then reads every known site for links to it, continuously."""
    db = _db()
    try:
        target, created = await asyncio.to_thread(repo.register_target, db, body.target)
    except ValueError:
        raise HTTPException(422, f"Invalid target: {body.target!r}")
    cfg = lifecycle.state.settings
    if created and slots.plain_mode(len(await asyncio.to_thread(repo.list_targets, db)), cfg.slot_businesses, cfg.slot_hours):
        await asyncio.to_thread(repo.recrawl_all, db)  # one group: sites crawled earlier are read again for the new target
    await asyncio.to_thread(repo.set_crawl_enabled, db, True)  # the crawler process looks at this flag
    if lifecycle.state.worker:
        lifecycle.state.worker.wake()
    return {
        "target": target.target,
        "match_mode": target.match_mode,
        "status": "queued" if created else "already_registered",
        "message": "Crawling started. Query /backlinks?query=" + target.domain + " to read what has been found.",
    }


@router.post("/seeds", status_code=202)
async def add_seeds(body: SeedsRequest):
    """Only saves websites in bulk to the seed list. It does not start crawling: the crawler (started by
    POST /backlinks/crawl) reads every seed stored in the database, these included, also seeds added while it runs."""
    db = _db()
    result = await asyncio.to_thread(repo.add_user_seeds, db, body.seed_urls)
    if lifecycle.state.worker:
        lifecycle.state.worker.notify()  # a crawl that is already running picks the new seeds up
    counts = await asyncio.to_thread(repo.seed_counts, db)
    return {**result, "total_seeds": sum(counts.values()),
            "message": "Seeds saved. They are crawled when the crawler runs (POST /backlinks/crawl)."}


@router.get("", response_model=BacklinksResponse)
async def get_backlinks(query: str = Query(..., min_length=3, description="A domain (codigix.co) or a URL")):
    """Every backlink stored in the database for a domain (incl. subdomains) or for one exact page."""
    try:
        mode, rows = await asyncio.to_thread(repo.search_backlinks, _db(), query)
    except ValueError:
        raise HTTPException(422, f"Invalid domain or URL: {query!r}")
    return BacklinksResponse(query=query, match_mode=mode, total=len(rows), backlinks=[
        BacklinkOut(**{k: getattr(b, k) for k in BacklinkOut.model_fields}) for b in rows])
