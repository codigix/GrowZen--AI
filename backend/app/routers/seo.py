"""SEO toolkit pages built on data the platform really has: the site's own crawl and audits, the tracked keywords,
Google results from Serper, the competitor research and the backlink provider. Each response says where its figures
come from; what needs a paid index (organic traffic, backlink totals) is left out, never estimated."""
import re
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..competitors import intel
from ..config import get_settings
from ..db import get_db
from ..deps import get_business, in_background
from ..models import Audit, Business, GeoPrompt, GeoResult, GoogleConnection, Keyword, KeywordRankLog, Competitor
from ..backlinks.summary import own_site_links
from ..services import countries, domain_checks, geo, landscape as landscape_svc, rank_report as rank_report_svc, top_pages as top_pages_svc, gsc, google_intel, keyword_metrics, market, organic, audits
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


@router.post("/seed-keywords")
def seed_keywords(b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Start tracking the searches a customer would type to find this business (services and category + area/city), so positions can be checked at once."""
    from ..competitors.intel import default_keywords
    added = 0
    for text in default_keywords(b):
        text = " ".join(text.lower().split())
        row_ = db.scalar(select(Keyword).where(Keyword.business_id == b.id, Keyword.keyword == text))
        if not row_:
            db.add(Keyword(business_id=b.id, keyword=text, tracked=True, intent=intent_of(text)))
            added += 1
        elif not row_.tracked:
            row_.tracked = True
    log(db, user.name, "keywords_seeded", b.id, added=added)
    db.commit()
    return {"added": added}


class CompetitorDomainIn(BaseModel):
    domain: str = Field(min_length=3, max_length=255)


@router.post("/track-competitor")
def track_competitor(body: CompetitorDomainIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Register a domain from the Google results as a competitor of this business (for audits and comparisons)."""
    domain = organic.host(body.domain)
    if not domain or domain == organic.host(b.website):
        raise HTTPException(400, "Enter a competitor's domain, not your own.")
    site = f"https://{domain}"
    row_ = db.scalar(select(Competitor).where(Competitor.business_id == b.id, Competitor.website == site))
    if not row_:
        db.add(Competitor(business_id=b.id, name=domain, website=site, source="manual"))
        log(db, user.name, "competitor_added", b.id, domain=domain)
        db.commit()
    return {"website": site}


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
    registered = [c.website for c in db.scalars(select(Competitor).where(Competitor.business_id == b.id))]
    keep = {u.lower().replace("https://", "").replace("http://", "").removeprefix("www.").split("/")[0] for u in registered if u}
    out = landscape_svc.landscape(landscape_svc.from_logs([r for r in logs if r.keyword in meta]), meta, me, start, today, keep)
    return {**base, **out, "location": next((r.location for r in sorted(logs, key=lambda r: r.day, reverse=True) if r.location), None) or intel.default_location(b),
            "country": market.serp_country(b), "device": "desktop", "tracked_competitors": registered}


@router.get("/rank-report")
def rank_report(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Per tracked keyword: Google position, the page that ranks, who is ahead and what to do to move up
    (services/rank_report.py). Uses the saved rank checks and the latest on-page crawl."""
    me = organic.host(b.website)
    tracked = list(db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True))))
    base = {"domain": me or None, "tracked": len(tracked), "serper": intel.serper_enabled()}
    if not me:
        return {**base, "state": "no_website", "rows": []}
    if not tracked:
        return {**base, "state": "no_keywords", "rows": []}
    since = date.fromordinal(datetime.now(timezone.utc).date().toordinal() - 60)
    names = {k.keyword for k in tracked}
    logs = [r for r in db.scalars(select(KeywordRankLog).where(KeywordRankLog.business_id == b.id, KeywordRankLog.day >= since)) if r.keyword in names]
    onpage = _latest(db, b, "onpage")
    pages = {}
    for p in ((onpage.result or {}).get("pages", []) if onpage else []):
        pages[_path(p["url"])] = {"title": p.get("title"), "h1": p.get("h1"), "words": p.get("word_count"), "inbound": p.get("inbound"), "status": p.get("status"),
                                  "noindex": bool(p.get("noindex")), "images_missing_alt": p.get("images_missing_alt"), "schema": p.get("schema_types") or []}
    out = rank_report_svc.report(logs, tracked, me, pages)
    return {**base, "state": "ok" if any(r["checked"] for r in out["rows"]) else "no_data", "crawled": bool(onpage), **out}


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
    live_m, metrics_note = keyword_metrics.lookup([kw], market.serp_country(b))
    lm = live_m.get(kw)
    metrics = {"volume": lm["volume"] if lm else (saved.volume if saved else None), "difficulty": lm["difficulty"] if lm else (saved.difficulty if saved else None),
               "cpc": lm["cpc"] if lm else (saved.cpc if saved else None), "tracked": bool(saved and saved.tracked)}
    return {
        "keyword": kw, "location": location, "intent": intent_of(kw), "credits": serper.credits,
        "you": {"organic": next((o["position"] for o in organic if o["mine"]), None), "local": next((p["position"] for p in local if p["mine"]), None)},
        "organic": organic, "local": local,
        "related": [q.get("query") for q in org.get("relatedSearches", []) if q.get("query")][:10], "questions": [q.get("question") for q in org.get("peopleAlsoAsk", []) if q.get("question")][:8],
        "serp_features": sorted({k for k in ("answerBox", "knowledgeGraph", "peopleAlsoAsk", "places", "topStories", "images", "videos", "shopping") if org.get(k)}),
        "metrics": metrics, "metrics_note": metrics_note,
        "volume_source": "Google Ads Keyword Planner" if live_m else ("saved keyword" if saved and saved.volume is not None else None),
    }


def _crawl_job(db: Session, business_id: int, max_pages: int) -> None:
    b = db.get(Business, business_id)
    if b:
        audits.run(db, b, "onpage", max_pages=max_pages)


@router.post("/crawl-pages", status_code=202)
def crawl_pages(background: BackgroundTasks, pages: int = 150, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Crawl the whole site in the background (sitemap first, then links) and save every page for Top Pages and Position Tracking."""
    if not b.website:
        raise HTTPException(400, "Add the project's website first.")
    if _crawl_running(db, b):
        return {"status": "running"}
    log(db, user.name, "site_crawl_started", b.id)
    db.commit()
    background.add_task(in_background(_crawl_job, b.id, max(10, min(pages, 300))))
    return {"status": "queued"}


def _crawl_running(db: Session, b: Business) -> bool:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=15)
    return bool(db.scalar(select(func.count()).select_from(Audit).where(Audit.business_id == b.id, Audit.kind == "onpage", Audit.status == "running", Audit.started_at >= cutoff)))


@router.get("/subdomains")
def subdomains(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Every subdomain of the site we can find (certificate logs, the crawl's links, Google results), each checked live."""
    from ..services import subdomains as sub
    me = organic.host(b.website)
    if not me:
        raise HTTPException(400, "Add the project's website first.")
    parts = me.split(".")
    root = ".".join(parts[-3:]) if len(parts) >= 3 and parts[-2] in ("co", "com", "org", "net", "ac", "gov") else ".".join(parts[-2:])
    onpage = _latest(db, b, "onpage")
    links = [l.get("href", "") for p in (onpage.result or {}).get("pages", []) if onpage for l in (p.get("links") or [])] + [p["url"] for p in (onpage.result or {}).get("pages", [])] if onpage else []
    logs = db.scalars(select(KeywordRankLog.serp).where(KeywordRankLog.business_id == b.id).order_by(KeywordRankLog.day.desc()).limit(200))
    ranking = {x.get("d") for serp in logs for x in (serp or []) if x.get("d")}
    return sub.discover(root, links, sorted(ranking), [])


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
            "audited_at": crawl.get("audited_at"), "crawling": _crawl_running(db, b), "serper": intel.serper_enabled(), "mock": bool(payload.get("mock")) or get_settings().rank_landscape_mock_on, "geo_source": results[0].data_source if results else None, **out}


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


def _own_connections(db: Session, b: Business, only: int | None = None) -> list[GoogleConnection]:
    """The Google account(s) this project may use: the one linked to it, nothing else. Another project's account is never tried, so one
    client's Search Console data cannot show up under another. `only` is an account the user picked on purpose for this request."""
    pick = only or b.connection_id
    if not pick:
        return []
    c = db.get(GoogleConnection, pick)
    return [c] if c and c.status == "active" and c.refresh_token_enc else []


def _search_console(db: Session, b: Business, host: str):
    """(state, message, SearchConsole, property) for the business's site, from a connected Google account that can see it."""
    conns = [c for c in _own_connections(db, b) if gsc.has_scope(c)]
    if not conns:
        linked = db.get(GoogleConnection, b.connection_id) if b.connection_id else None
        if linked and linked.status != "active":
            return "not_connected", f"The Google account linked to this project ({linked.email}) is disconnected. Reconnect it in Integrations.", None, None
        return "not_connected", "No Google account is linked to this project. Connect the account that owns this site in Search Console (Integrations) and link it to the project.", None, None
    notes: list[str] = []
    for conn in conns:
        try:
            sc = gsc.SearchConsole(conn)
            sites = sc.sites()
            site = gsc.match_property(sites, host)
        except GbpError as exc:
            notes.append(f"{conn.email}: {str(exc)[:160]}")
            continue
        if site:
            return "ok", conn.email, sc, site
        have = [x["siteUrl"] for x in sites if x.get("permissionLevel") != "siteUnverifiedUser"]
        unverified = [x["siteUrl"] for x in sites if x.get("permissionLevel") == "siteUnverifiedUser" and host in x["siteUrl"]]
        if unverified:
            notes.append(f"{conn.email} is listed on {unverified[0]} only as an unverified user, and Google returns no data at that level. Ask the site's owner to add it as a Full user in Search Console (Settings > Users and permissions).")
            continue
        notes.append(f"{conn.email} has no verified property for {host}" + (f" (it has: {', '.join(have[:6])}{'…' if len(have) > 6 else ''})." if have else " (it has no verified properties at all)."))
    msg = " ".join(notes) or "No verified Search Console property for this site."
    return "no_property", msg + " Add and verify the site in Search Console, or link the account that owns it to this project.", None, None


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
    conns = _own_connections(db, b, connection_id)
    # The accounts offered to pick from are only listed while the project has none of its own.
    pickable = [] if conns else list(db.scalars(select(GoogleConnection).where(GoogleConnection.status == "active", GoogleConnection.refresh_token_enc.is_not(None)).order_by(GoogleConnection.email)))
    out["traffic"]["accounts"] = [{"id": c.id, "email": c.email, "search_console": gsc.has_scope(c)} for c in (conns or pickable)]
    out["traffic"]["linked"] = bool(b.connection_id)
    if not host:
        out["traffic"] = {"state": "no_website", "message": "Add the project's website first: Search Console is matched by its domain."}
    elif not conns:
        out["traffic"].update(message="No Google account is linked to this project. Connect the account that owns this site in Search Console (Integrations) and link it to the project.")
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
