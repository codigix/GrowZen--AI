import asyncio
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field

from ..auth import current_user
from . import repository as repo
from . import ahrefs, lifecycle, slots

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


class AhrefsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    domain: str = Field(min_length=3, max_length=300, description="A domain, e.g. bakulcatering.com (a URL is reduced to its domain)")
    mode: Literal["subdomains", "exact", "prefix", "domain"] = "subdomains"
    refresh: bool = Field(default=False, description="Look it up again even if a report from the last day exists")


@router.post("/ahrefs", status_code=202)
async def request_ahrefs_report(body: AhrefsRequest, background: BackgroundTasks, response: Response):
    """Get the Ahrefs backlink report for a domain: domain rating, backlinks, linking websites and the referring-pages table, saved in the database.
    The lookup takes about a minute, so this returns 202 with a report_id at once; read the result with GET /backlinks/ahrefs?domain=.
    A report from the last day is returned straight away (200) unless refresh is true; a lookup already running for the domain is not started twice."""
    db = _db()
    try:
        domain = ahrefs.normalize_domain(body.domain)
    except ValueError:
        raise HTTPException(422, f"Invalid domain: {body.domain!r}")
    report, kind = await asyncio.to_thread(ahrefs.request_report, db, domain, body.mode, body.refresh)
    if kind == "queued":
        background.add_task(ahrefs.run_report, db, report.id)
    elif kind == "cached":
        response.status_code = 200
        return {"state": "cached", **(await asyncio.to_thread(ahrefs.report_view, db, report.id))}
    return {"state": kind, "report_id": report.id, "domain": domain, "mode": body.mode, "status": report.status,
            "message": f"Looking up {domain} on Ahrefs. Read it with GET /backlinks/ahrefs?domain={domain} (status goes queued, running, done or failed)."}


@router.get("/ahrefs")
async def get_ahrefs_report(domain: str = Query(..., min_length=3, description="The domain that was looked up"),
                            mode: Literal["subdomains", "exact", "prefix", "domain"] | None = Query(default=None, description="Only reports made in this mode")):
    """For showing clients: the latest finished Ahrefs report stored for a domain, read from the database only (Ahrefs is never called here).
    While the daily refresh is queued or running, the previous report stays visible and `refresh` shows the newer lookup's status.
    If the domain has no finished report yet, the newest attempt is returned (status queued, running or failed)."""
    db = _db()
    try:
        name = ahrefs.normalize_domain(domain)
    except ValueError:
        raise HTTPException(422, f"Invalid domain: {domain!r}")
    view = await asyncio.to_thread(ahrefs.client_view, db, name, mode)
    if view is None:
        raise HTTPException(404, f"No Ahrefs report for {name} yet; start one with POST /backlinks/ahrefs")
    return view


@router.get("/href")
async def href_lookup(domain: str = Query(..., min_length=3, description="e.g. bakulcatering.com"),
                      mode: Literal["subdomains", "exact", "prefix", "domain"] = "subdomains",
                      refresh: bool = Query(default=True, description="true: always look it up live now; false: reuse a report from the last day")):
    """Test route: runs the Ahrefs lookup right now, waits for it (about 30-120 seconds), saves it in the database and returns the data in this response.
    Use POST /backlinks/ahrefs (returns at once, result read later) in the application."""
    db = _db()
    try:
        name = ahrefs.normalize_domain(domain)
    except ValueError:
        raise HTTPException(422, f"Invalid domain: {domain!r}")
    report, kind = await asyncio.to_thread(ahrefs.request_report, db, name, mode, refresh)
    if kind == "queued":
        await asyncio.to_thread(ahrefs.run_report, db, report.id)
    return {"state": kind, **(await asyncio.to_thread(ahrefs.report_view, db, report.id))}
