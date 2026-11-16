"""Backlink report and crawler status from our own deployed backlink crawler (CRAWLER_URL / CRAWLER_API_KEY).

GET /backlink-intel/crawler/report?domain=...   one domain: totals, referring domains, anchors, recent backlinks and history
GET /backlink-intel/crawler/status              the crawler's own health: workers, domains and links found, discovery sources

Read-only. Only what the crawler has stored is returned: a domain it has not seen says so, nothing is estimated."""
from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth import current_user
from ..services import crawler_client as cc

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
