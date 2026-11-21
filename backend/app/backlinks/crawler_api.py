"""Backlink report and crawler status from our own deployed backlink crawler (CRAWLER_URL / CRAWLER_API_KEY).

GET /backlink-intel/crawler/report?domain=...   one domain: totals, referring domains, anchors, recent backlinks and history
GET /backlink-intel/crawler/status              the crawler's own health: workers, domains and links found, discovery sources

Read-only. Only what the crawler has stored is returned: a domain it has not seen says so, nothing is estimated."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..auth import current_user
from ..db import get_db
from ..deps import get_business
from ..models import Business
from ..services import crawler_client as cc
from . import sync

router = APIRouter(prefix="/backlink-intel/crawler", tags=["backlinks"], dependencies=[Depends(current_user)])


def _guard(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except cc.CrawlerError as exc:
        raise HTTPException(503, str(exc)) from exc


@router.get("/report")
def report(domain: str = Query(min_length=3, max_length=300), limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)) -> dict:
    try:
        name = cc.normalize_domain(domain)
    except ValueError:
        raise HTTPException(422, f"Not a valid domain: {domain!r}") from None
    b = _guard(cc.backlinks, name, limit=limit, offset=offset)
    rd = _guard(cc.referring_domains, name)
    an = _guard(cc.anchors, name)
    hi = _guard(cc.history, name, 30)
    return {"domain": name, "status": b.get("status"), "message": b.get("message"),
            "total_backlinks": b.get("total_backlinks", 0), "verified_backlinks": b.get("verified_backlinks", 0),
            "total_referring_domains": b.get("total_referring_domains", 0), "limit": limit, "offset": offset,
            "backlinks": b.get("backlinks", []), "referring_domains": rd.get("referring_domains", [])[:100],
            "anchors": an.get("anchors", [])[:50], "history": hi.get("events", [])}


@router.get("/status")
def status() -> dict:
    g = _guard(cc.global_status)
    d = _guard(cc.discovery_status)
    workers = [{k: w.get(k) for k in ("name", "status", "healthy", "runs", "errors", "last_success_at")} for w in g.get("workers", [])]
    return {"paused": g.get("paused"), "workers": workers, "discovered_domains": g.get("discovered_domains"), "discovered_urls": g.get("discovered_urls"),
            "outgoing_links": g.get("outgoing_links"), "domains_by_status": g.get("domains_by_status"), "urls_by_status": g.get("urls_by_status"),
            "sources": [{k: s.get(k) for k in ("name", "enabled", "status", "items_imported", "last_run")} for s in d.get("sources", [])]}


biz_router = APIRouter(prefix="/businesses/{business_id}/backlink-intel/crawler", tags=["backlinks"], dependencies=[Depends(current_user)])


@biz_router.get("/gap")
def gap(competitor: str | None = Query(None, max_length=300), limit: int = Query(200, ge=1, le=2000), b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Competitor backlink gap from our crawler for this business: who links the competitors but not the business. `competitor` (a domain) narrows it to
    one competitor; without it all of the business's competitors are included. Also returns the competitors to choose from."""
    domain = sync._domain_of(b.website)
    if not domain:
        raise HTTPException(422, "This project has no website, so there is no domain to compare.")
    if competitor:
        try:
            competitor = cc.normalize_domain(competitor)
        except ValueError:
            raise HTTPException(422, f"Not a valid domain: {competitor!r}") from None
    g_all = None
    try:
        listed = cc.business_competitors(domain).get("competitors", [])
        choices = [{"domain": c.get("competitor_domain"), "status": c.get("discovery_status"), "known_backlinks": c.get("known_backlinks", 0)} for c in listed]
    except cc.CrawlerError as exc:
        # The crawler's competitor list can fail for one business (a 500 from its side) while its gap report still works: the gap report names the
        # same competitors, so take the choices from it instead of showing nothing.
        g_all = _guard(cc.backlink_gap, domain, None, 1)
        if not g_all.get("competitors"):
            raise HTTPException(503, str(exc)) from exc
        choices = [{"domain": d, "status": ((g_all.get("coverage") or {}).get("discovery_status") or {}).get(d), "known_backlinks": None} for d in g_all["competitors"]]
    choices = [c for c in choices if c["domain"] and not c["domain"].startswith(".")]  # a malformed entry such as ".edu.in" is not a website to compare
    if competitor and competitor not in {c["domain"] for c in choices}:
        raise HTTPException(404, f"{competitor} is not one of this business's competitors on the crawler.")
    if not choices:
        return {"business_domain": domain, "competitors_available": [], "selected": None, "gap": None}
    g = _guard(cc.backlink_gap, domain, competitor, limit)
    return {"business_domain": domain, "competitors_available": choices, "selected": competitor, "gap": g}
