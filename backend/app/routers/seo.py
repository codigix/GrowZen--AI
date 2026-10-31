"""SEO toolkit pages built on data the platform really has: the site's own crawl and audits, the tracked keywords,
Google results from Serper, the competitor research and the backlink provider. Each response says where its figures
come from; what needs a paid index (organic traffic, backlink totals) is left out, never estimated."""
import re
from datetime import date, datetime, timezone
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
from ..models import Audit, Business, GeoPrompt, GeoResult, GoogleConnection, Keyword, KeywordRankLog
from ..backlinks.summary import own_site_links
from ..services import countries, domain_checks, geo, landscape as landscape_svc, top_pages as top_pages_svc, gsc, google_intel, market, organic
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


@router.get("/position-landscape")
def position_landscape(days: int = 30, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Visibility, estimated traffic, positions, movers, tags, competitors, SERP features, pages and cannibalization of the tracked
    keywords over the last `days`, computed from the saved rank checks (services/landscape.py)."""
    days = max(7, min(days, 365))
    me = organic.host(b.website)
    today = datetime.now(timezone.utc).date()
    start = date.fromordinal(today.toordinal() - days)
    tracked = list(db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True))))
    base = {"domain": me or None, "days": days, "tracked": len(tracked), "serper": intel.serper_enabled()}
    if get_settings().rank_landscape_mock_on and me:
        obs, meta = landscape_svc.mock_obs(me, days, today)
        return {**base, **landscape_svc.landscape(obs, meta, me, start, today), "mock": True}
    if not me:
        return {**base, "state": "no_website"}
    if not tracked:
        return {**base, "state": "no_keywords"}
    logs = list(db.scalars(select(KeywordRankLog).where(KeywordRankLog.business_id == b.id, KeywordRankLog.day >= start)))
    meta = {k.keyword: {"volume": k.volume, "tag": k.cluster} for k in tracked}
    out = landscape_svc.landscape(landscape_svc.from_logs([r for r in logs if r.keyword in meta]), meta, me, start, today)
    return {**base, **out}


@router.get("/organic-research")
def organic_research(days: int = 30, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Position changes and SERP features of the tracked keywords over the last `days`, from the saved rank checks."""
    days = max(7, min(days, 365))
    me = organic.host(b.website)
    today = datetime.now(timezone.utc).date()
    start = date.fromordinal(today.toordinal() - days)
    tracked = list(db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True))))
    base = {"domain": me or None, "days": days, "tracked": len(tracked), "serper": intel.serper_enabled()}
    if get_settings().rank_landscape_mock_on and me:
        obs, meta = landscape_svc.mock_obs(me, days, today)
        return {**base, **landscape_svc.organic_research(obs, meta, me, start, today), "mock": True}
    if not me:
        return {**base, "state": "no_website"}
    if not tracked:
        return {**base, "state": "no_keywords"}
    meta = {k.keyword: {"volume": k.volume, "tag": k.cluster, "intent": k.intent} for k in tracked}
    logs = [r for r in db.scalars(select(KeywordRankLog).where(KeywordRankLog.business_id == b.id, KeywordRankLog.day >= start)) if r.keyword in meta]
    return {**base, **landscape_svc.organic_research(landscape_svc.from_logs(logs), meta, me, start, today)}


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


@router.get("/top-pages-report")
def top_pages_report(days: int = 30, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Every page of the site any real source knows, one row each: crawl facts, Google positions (saved rank checks) and traffic and
    referring domains (data provider, when connected), and the AI answers that cite it (services/top_pages.py)."""
    days = max(7, min(days, 365))
    me = organic.host(b.website)
    today = datetime.now(timezone.utc).date()
    start = date.fromordinal(today.toordinal() - days)
    base = {"domain": me or None, "days": days}
    if not me:
        return {**base, "state": "no_website"}
    crawl = top_pages(b, db)
    payload = domain_intel_report(country=None, refresh=False, b=b, db=db)

    def sec(key: str):
        s = payload.get(key) if payload.get("state") == "ok" else None
        return s["data"] if s and s.get("ok") else None
    index = {"pages": sec("pages"), "indexed": sec("indexed_pages"), "history": sec("history")}
    tracked = list(db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True))))
    meta = {k.keyword: {"volume": k.volume, "intent": k.intent} for k in tracked}
    if get_settings().rank_landscape_mock_on:
        obs, meta = landscape_svc.mock_obs(me, days, today)
    else:
        obs = landscape_svc.from_logs([r for r in db.scalars(select(KeywordRankLog).where(KeywordRankLog.business_id == b.id, KeywordRankLog.day >= start)) if r.keyword in meta])
    results = list(db.scalars(select(GeoResult).where(GeoResult.business_id == b.id).order_by(GeoResult.created_at.desc()).limit(2000)))
    geo_rows = [{"prompt_id": g.prompt_id, "engine": g.engine, "urls": g.cited_urls or [], "day": g.created_at.date().isoformat() if g.created_at else None} for g in results]
    out = top_pages_svc.build(crawl["pages"], obs, meta, geo_rows, index, me, start, today, db.query(GeoPrompt).filter(GeoPrompt.business_id == b.id).count())
    return {**base, "state": "ok", "intel_state": payload.get("state"), "internal": payload.get("internal"), "country_name": payload.get("country_name"), "markets": payload.get("markets"),
            "audited_at": crawl.get("audited_at"), "serper": intel.serper_enabled(), "mock": bool(payload.get("mock")) or get_settings().rank_landscape_mock_on, "geo_source": results[0].data_source if results else None, **out}


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


def _brand_terms(b: Business, host: str) -> list[str]:
    """What makes a keyword "branded": the domain's name and the business name."""
    name = re.sub(r"[^a-z0-9 ]", "", (b.name or "").lower()).strip()
    return list(dict.fromkeys(t for t in (host.split(".")[0], name, name.replace(" ", "")) if len(t) >= 3))


def _search_console(db: Session, b: Business, host: str):
    """(state, message, SearchConsole, property) for the business's site, from a connected Google account that can see it."""
    conns = [c for c in db.scalars(select(GoogleConnection).where(GoogleConnection.status == "active", GoogleConnection.refresh_token_enc.is_not(None))) if gsc.has_scope(c)]
    conns.sort(key=lambda c: c.id != b.connection_id)
    if not conns:
        return "not_connected", "Connect a Google account that can see this site in Search Console (Integrations).", None, None
    last = None
    for conn in conns:
        try:
            sc = gsc.SearchConsole(conn)
            site = gsc.match_property(sc.sites(), host)
        except GbpError as exc:
            last = str(exc)
            continue
        if site:
            return "ok", conn.email, sc, site
        last = f"{conn.email} has no verified Search Console property for {host}. Add and verify the site in Search Console, or connect the account that owns it."
    return "no_property", last or "No verified Search Console property for this site.", None, None


@router.get("/domain-intel")
def domain_intel_report(country: str | None = None, refresh: bool = False, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """The site's Google data (Search Console): organic clicks, queries, pages, countries and history, cached (see services/google_intel.py).
    Figures Google has no API for (authority, backlinks, competitor traffic, ads) come back as unavailable sections."""
    host = gsc.host_of(b.website)
    internal = domain_checks.is_internal(b)
    limits = domain_checks.limits_for(internal)
    codes = market.target_countries(b)
    cc = countries.code(country) if country else codes[0]
    out: dict = {"domain": host or None, "internal": internal, "limits": limits, "country": cc, "country_name": countries.name(cc),
                 "markets": [{"code": c, "name": countries.name(c)} for c in codes], "state": "ok", "source": "google_search_console"}
    out["brand"] = _brand_terms(b, host)
    if not host or host in domain_checks.PLACEHOLDER_HOSTS:
        return {**out, "state": "no_website"}
    state, message, sc, site = _search_console(db, b, host)
    if state != "ok":
        return {**out, "state": state, "message": message}
    out["account"] = message
    tier = "internal" if internal else "client"
    brand = out["brand"]
    main = google_intel.cached(db, f"g1:{cc}", host, tier, limits["cache_days"], refresh, lambda: google_intel.fetch(sc, site, cc, limits, brand))
    table = google_intel.cached(db, "g1-countries:" + ",".join(codes[:6]), host, tier, limits["cache_days"], refresh, lambda: google_intel.by_country(sc, site, codes))
    return {**out, **main["data"], "by_country": table["data"], "fetched_at": main["fetched_at"], "cached": main["cached"]}


@router.get("/domain")
def domain(range: str = "3m", country: str | None = None, device: str | None = None, connection_id: int | None = None,
           b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Domain overview from real sources: Google traffic from Search Console (the connected Google account), AI
    visibility from the stored AI checks, and keyword positions from the rank checks. Authority, backlinks and paid
    figures need a link index or Google Ads and are reported as unavailable, never estimated."""
    host = gsc.host_of(b.website)
    internal = domain_checks.is_internal(b)
    out: dict = {"domain": host or None, "name": b.name, "internal": internal, "limits": domain_checks.limits_for(internal), "market": market.summary(b), "range": range if range in gsc.RANGES else "3m",
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
    own = own_site_links(db, b.id)
    out["links"] = {"available": bool(own and own["backlinks"]), "source": "codigix_bot", "domain": own["domain"] if own else None,
                    "backlinks": own["backlinks"] if own else None, "referring_domains": own["referring_domains"] if own else None, "authority": None,
                    "reason": None if own and own["backlinks"] else (
                        "Our Discovery bot has not found backlinks yet: open Backlink Intelligence and run it." if own
                        else "Add your site under Backlink Intelligence and run the Discovery bot to see your backlinks.")}
    out["checks"] = domain_checks.checks(db, b, internal, out["traffic"])
    out["unavailable"]["paid"] = "Paid traffic and paid keywords come from Google Ads or a paid index; they aren't available for this project."
    return out
