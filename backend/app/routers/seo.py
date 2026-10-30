"""SEO toolkit pages built on data the platform really has: the site's own crawl and audits, the tracked keywords,
Google results from Serper, the competitor research and the backlink provider. Each response says where its figures
come from; what needs a paid index (organic traffic, backlink totals) is left out, never estimated."""
import re
from datetime import datetime, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..competitors import intel
from ..config import get_settings
from ..db import get_db
from ..deps import get_business
from ..models import Audit, Business, GeoPrompt, GeoResult, GoogleConnection, Keyword
from ..services import countries, geo, gsc, market, organic
from ..services.gbp import GbpError
from ..services.providers.base import intent_of
from ..services.activity import log

router = APIRouter(prefix="/businesses/{business_id}/seo", tags=["seo"])


def _latest(db: Session, b: Business, kind: str) -> Audit | None:
    return db.scalar(select(Audit).where(Audit.business_id == b.id, Audit.kind == kind, Audit.status == "done").order_by(Audit.id.desc()))


def _research(db: Session, b: Business) -> dict | None:
    a = db.scalar(select(Audit).where(Audit.kind == "intel", Audit.target == f"business:{b.id}", Audit.status == "done").order_by(Audit.id.desc()))
    return a.result if a and a.result and a.result.get("summary") else None


def _host(url: str | None) -> str:
    return re.sub(r"^www\.", "", urlparse(url if (url or "").startswith("http") else f"https://{url or ''}").netloc)


def _path(url: str | None) -> str:
    p = urlparse(url or "").path or "/"
    return p if p == "/" else p.rstrip("/")


@router.get("/top-pages")
def top_pages(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """The site's pages from its latest crawl with what each one carries: content depth, structure, links in, the
    issues on it and the tracked keywords mapped to it."""
    onpage = _latest(db, b, "onpage")
    if not onpage:
        return {"pages": [], "audited_at": None}
    kws = list(db.scalars(select(Keyword).where(Keyword.business_id == b.id)))
    out = []
    for p in (onpage.result or {}).get("pages", []):
        path = _path(p["url"])
        mapped = [k for k in kws if k.target_url and _path(k.target_url) == path]
        out.append({"url": p["url"], "path": path, "status": p.get("status"), "title": p.get("title"), "h1": p.get("h1"), "words": p.get("word_count"), "inbound": p.get("inbound"),
                    "links_out": p.get("internal_out"), "schema": p.get("schema_types") or [], "images": p.get("images"), "images_missing_alt": p.get("images_missing_alt"),
                    "noindex": bool(p.get("noindex")), "issues": len(p.get("issues") or []), "keywords": [p2 for p2 in (p.get("top_keywords") or [])][:6],
                    "mapped": [{"keyword": k.keyword, "rank": k.rank} for k in mapped], "best_rank": min((k.rank for k in mapped if k.rank), default=None)})
    return {"pages": out, "audited_at": onpage.finished_at.isoformat() if onpage.finished_at else None, "score": onpage.score}


class CheckIn(BaseModel):
    keywords: list[str] | None = Field(default=None, max_length=25)


@router.post("/check-ranks")
def check_ranks(body: CheckIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Google's organic position of the site for each tracked keyword (live results from Serper), saved so the next
    check shows the change and the history chart grows."""
    try:
        out = organic.check(db, b, body.keywords)
    except organic.RankCheckError as exc:
        raise HTTPException(400 if "SERPER_API_KEY" in str(exc) or "website" in str(exc) else 502, str(exc)) from exc
    log(db, user.name, "ranks_checked", b.id, keywords=out["checked"])
    db.commit()
    return out


@router.get("/rank-history")
def rank_history(days: int = 90, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Each tracked keyword's checked positions over time."""
    return {"history": organic.history(db, b, max(7, min(days, 365)))}


class OverviewIn(BaseModel):
    keyword: str = Field(min_length=2, max_length=120)


@router.post("/keyword-overview")
def keyword_overview(body: OverviewIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """One keyword, as Google shows it from the business's place: the top 10, the Maps pack, related searches, the
    questions people ask, where the business stands, and the volume and difficulty when a provider supplies them."""
    if not intel.serper_enabled():
        raise HTTPException(400, "Keyword overview needs Google results: set SERPER_API_KEY on the SEO backend (serper.dev).")
    kw = " ".join(body.keyword.lower().split())
    location = intel.default_location(b)
    serper = intel.Serper(market.serp_country(b))
    try:
        org = serper.search(kw, location)
        try:
            plc = serper.places(kw, location)
        except intel.IntelError:
            plc = {}
    except intel.IntelError as exc:
        raise HTTPException(502, str(exc)) from exc
    host = _host(b.website)
    organic = [{"position": o.get("position"), "domain": _host(o.get("link")), "url": o.get("link"), "title": o.get("title"), "snippet": o.get("snippet"),
                "type": "directory" if intel.is_directory(_host(o.get("link"))) else "business", "mine": bool(host) and _host(o.get("link")) == host} for o in org.get("organic", [])[:10]]
    local = [{"position": p.get("position"), "name": p.get("title"), "rating": p.get("rating"), "reviews": p.get("ratingCount") or 0, "category": p.get("category"), "address": p.get("address"),
              "mine": intel._is_me_place(p, b, host)} for p in plc.get("places", [])[:10]]
    saved = db.scalar(select(Keyword).where(Keyword.business_id == b.id, Keyword.keyword == kw))
    return {
        "keyword": kw, "location": location, "intent": intent_of(kw), "credits": serper.credits,
        "you": {"organic": next((o["position"] for o in organic if o["mine"]), None), "local": next((p["position"] for p in local if p["mine"]), None)},
        "organic": organic, "local": local,
        "related": [q.get("query") for q in org.get("relatedSearches", []) if q.get("query")][:10], "questions": [q.get("question") for q in org.get("peopleAlsoAsk", []) if q.get("question")][:8],
        "serp_features": sorted({k for k in ("answerBox", "knowledgeGraph", "peopleAlsoAsk", "places", "topStories", "images", "videos", "shopping") if org.get(k)}),
        "metrics": {"volume": saved.volume if saved else None, "difficulty": saved.difficulty if saved else None, "cpc": saved.cpc if saved else None, "tracked": bool(saved and saved.tracked)},
        "volume_source": "saved keyword" if saved and saved.volume else None,
    }


def _ai_search(db: Session, b: Business, host: str) -> dict:
    """Does AI answer with the business? From the AI visibility results already stored: mentions, the pages AI cites, per engine."""
    latest: dict[tuple[int, str], GeoResult] = {}
    for g in db.scalars(select(GeoResult).where(GeoResult.business_id == b.id).order_by(GeoResult.created_at.desc()).limit(2000)):
        latest.setdefault((g.prompt_id, g.engine), g)
    if not latest:
        return {"measured": False, "prompts": db.query(GeoPrompt).filter(GeoPrompt.business_id == b.id).count(), "engines": []}
    engines: dict[str, dict] = {}
    for (_, eng), g in latest.items():
        e = engines.setdefault(eng, {"engine": eng, "checked": 0, "mentions": 0, "cited": 0})
        e["checked"] += 1
        e["mentions"] += 1 if g.mentioned else 0
        e["cited"] += sum(1 for u in (g.cited_urls or []) if gsc.host_of(u) == host)
    for e in engines.values():
        e["visibility"] = round(e["mentions"] / e["checked"] * 100)
    total = sum(e["checked"] for e in engines.values())
    return {"measured": True, "visibility": round(sum(e["mentions"] for e in engines.values()) / total * 100), "mentions": sum(e["mentions"] for e in engines.values()),
            "cited_pages": sum(e["cited"] for e in engines.values()), "engines": sorted(engines.values(), key=lambda e: -e["visibility"]),
            "data_source": next(iter(latest.values())).data_source}


@router.get("/domain")
def domain(range: str = "3m", country: str | None = None, device: str | None = None, connection_id: int | None = None,
           b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Domain overview from real sources: Google traffic from Search Console (the connected Google account), AI
    visibility from the stored AI checks, and keyword positions from the rank checks. Authority, backlinks and paid
    figures need a link index or Google Ads and are reported as unavailable, never estimated."""
    host = gsc.host_of(b.website)
    out: dict = {"domain": host or None, "name": b.name, "market": market.summary(b), "range": range if range in gsc.RANGES else "3m",
                 "ai": _ai_search(db, b, host), "traffic": {"state": "not_connected"}, "unavailable": {}}
    conns = list(db.scalars(select(GoogleConnection).where(GoogleConnection.status == "active", GoogleConnection.refresh_token_enc.is_not(None))))
    if connection_id:
        conns = [c for c in conns if c.id == connection_id]
    conns.sort(key=lambda c: (c.id != b.connection_id, not gsc.has_scope(c)))
    out["traffic"]["accounts"] = [{"id": c.id, "email": c.email, "search_console": gsc.has_scope(c)} for c in conns]
    if not host:
        out["traffic"] = {"state": "no_website", "message": "Add the project's website first: Search Console is matched by its domain."}
    elif not conns:
        out["traffic"].update(message="Connect a Google account that can see this site in Search Console.")
    elif not any(gsc.has_scope(c) for c in conns):
        out["traffic"].update(state="scope_missing", message="The connected Google account hasn't granted Search Console access. Connect it again to add it.")
    else:
        conn = next(c for c in conns if gsc.has_scope(c))
        try:
            sc = gsc.SearchConsole(conn)
            site = gsc.match_property(sc.sites(), host)
            if not site:
                out["traffic"].update(state="no_property", account=conn.email, message=f"{conn.email} has no verified Search Console property for {host}. Add and verify the site in Search Console, or connect the account that owns it.")
            else:
                out["traffic"].update(state="ok", account=conn.email, report=gsc.report(sc, site, out["range"], country, device))
        except GbpError as exc:
            out["traffic"].update(state="error", message=str(exc))
    kws = list(db.scalars(select(Keyword).where(Keyword.business_id == b.id)))
    out["rankings"] = {"tracked": len(kws), "ranking": sum(1 for k in kws if k.rank), "checked_at": max((k.rank_checked_at for k in kws if k.rank_checked_at), default=None)}
    links = _latest(db, b, "backlinks")
    live_links = get_settings().dataforseo_enabled and links and links.data_source != "sample"
    r = (links.result or {}) if live_links else {}
    out["links"] = {"available": bool(live_links), "backlinks": r.get("total"), "referring_domains": r.get("referring_domains"), "authority": r.get("authority"),
                    "reason": None if live_links else "A link index is needed for authority score, backlinks and referring domains: connect DataForSEO (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD)."}
    out["unavailable"]["paid"] = "Paid traffic and paid keywords come from Google Ads or a paid index; they aren't available for this project."
    return out
