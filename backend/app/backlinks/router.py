"""Backlink Intelligence API. Everything is scoped to a business: a backlink is visible only if it points at a domain that
business tracks (its own site or a competitor), so one business never sees another's monitoring set."""
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from ..auth import current_user
from ..db import get_db, utcnow
from ..deps import get_business, in_background
from ..models import Business
from . import analytics, bot, engine, frontier, insights, outcomes, outreach, quality, sync, watch
from .lifecycle import ALL_STATES, LIVE_STATES
from .models import BiDomainReview, Backlink, BacklinkEvent, BacklinkObservation, BacklinkProvenance, BiDomain, BiPage, BiTrackedTarget
from .engine import aware
from .urls import host_of, normalize_url, registrable_domain

router = APIRouter(prefix="/businesses/{business_id}/backlink-intel", tags=["backlinks"], dependencies=[Depends(current_user)])

_fetcher: engine.PageFetcher | None = None


def get_fetcher() -> engine.PageFetcher:
    global _fetcher
    if _fetcher is None:
        _fetcher = engine.PageFetcher()
    return _fetcher


class TargetIn(BaseModel):
    domain: str = Field(min_length=3, max_length=255)
    name: str | None = Field(default=None, max_length=255)
    is_competitor: bool = False


class VerifyIn(BaseModel):
    backlink_ids: list[int] | None = Field(default=None, max_length=500)
    all_due: bool = False


class SeedIn(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=100)


class CrawlRunIn(BaseModel):
    limit: int = Field(default=10, ge=1, le=50)


def _targets(db: Session, b: Business) -> list[BiTrackedTarget]:
    return list(db.scalars(select(BiTrackedTarget).where(BiTrackedTarget.business_id == b.id).order_by(BiTrackedTarget.id)))


def _require_tracked(db: Session, b: Business, domain: str) -> str:
    reg = registrable_domain(host_of(domain))
    if reg not in {t.domain for t in _targets(db, b)}:
        raise HTTPException(404, f"{reg} is not tracked by this business; add it under /backlink-intel/targets first")
    return reg


def _target_out(t: BiTrackedTarget) -> dict:
    return {"id": t.id, "domain": t.domain, "name": t.name, "is_competitor": t.is_competitor, "monitoring_enabled": t.monitoring_enabled}


@router.post("/targets", status_code=201)
def add_target(body: TargetIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    host = host_of(body.domain)
    if not host or "." not in host:
        raise HTTPException(422, "Enter a valid domain, e.g. example.com")
    reg = registrable_domain(host)
    t = db.scalar(select(BiTrackedTarget).where(BiTrackedTarget.business_id == b.id, BiTrackedTarget.domain == reg))
    if t is None:
        t = BiTrackedTarget(business_id=b.id, domain=reg, name=body.name, is_competitor=body.is_competitor)
        db.add(t)
        engine.get_domain(db, reg)
        db.commit()
    return _target_out(t)


@router.get("/targets")
def list_targets(b: Business = Depends(get_business), db: Session = Depends(get_db)) -> list[dict]:
    return [_target_out(t) for t in _targets(db, b)]


@router.delete("/targets/{target_id}", status_code=204)
def remove_target(target_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> None:
    t = db.get(BiTrackedTarget, target_id)
    if not t or t.business_id != b.id:
        raise HTTPException(404, "Target not found")
    db.delete(t)
    db.commit()


def _backlink_out(bl: Backlink, src: BiPage, src_domain: BiDomain, provenance: list[BacklinkProvenance] | None = None) -> dict:
    out = {"id": bl.id, "source_url": src.normalized_url, "source_domain": src_domain.registrable_domain, "target_url": bl.target_url, "anchor_text": bl.anchor_text,
           "rel_attributes": bl.rel_attributes or [], "link_type": bl.link_type, "placement": bl.placement, "status": bl.current_status,
           "verification_status": bl.verification_status, "provider_status": bl.provider_status, "first_seen_at": bl.first_seen_at, "last_seen_at": bl.last_seen_at,
           "last_verified_at": bl.last_verified_at}
    if provenance is not None:
        out["provenance"] = [{"source": p.source, "provider_record_id": p.provider_record_id, "provider_observed_at": p.provider_observed_at, "imported_at": p.imported_at,
                              "license_class": p.license_class} for p in provenance]
    return out


def _scoped(db: Session, b: Business):
    """Base query: backlinks whose target domain this business tracks."""
    TD = aliased(BiDomain)
    mine = [t.domain for t in _targets(db, b)]
    SD = aliased(BiDomain)
    return (select(Backlink, BiPage, SD).join(BiPage, BiPage.id == Backlink.source_page_id).join(SD, SD.id == Backlink.source_domain_id)
            .join(TD, TD.id == Backlink.target_domain_id).where(TD.registrable_domain.in_(mine or [""])), TD, SD)


@router.get("")
def search(b: Business = Depends(get_business), db: Session = Depends(get_db), target: str | None = None, status: str | None = None,
           verification_status: str | None = None, source_domain: str | None = None, rel: str | None = None, anchor: str | None = Query(default=None, max_length=200),
           cursor: int | None = None, limit: int = Query(default=50, ge=1, le=200)) -> dict:
    q, TD, SD = _scoped(db, b)
    if target:
        q = q.where(TD.registrable_domain == _require_tracked(db, b, target))
    if status:
        if status.upper() not in ALL_STATES:
            raise HTTPException(422, f"Unknown status; one of {sorted(ALL_STATES)}")
        q = q.where(Backlink.current_status == status.upper())
    if verification_status:
        q = q.where(Backlink.verification_status == verification_status.upper())
    if source_domain:
        q = q.where(SD.registrable_domain == registrable_domain(host_of(source_domain)))
    if anchor:
        q = q.where(Backlink.anchor_text.ilike(f"%{anchor}%"))
    if cursor:
        q = q.where(Backlink.id > cursor)
    rows = db.execute(q.order_by(Backlink.id).limit(limit + 1)).all()
    if rel:
        rows = [r for r in rows if rel.lower() in (r[0].rel_attributes or [])]
    more = len(rows) > limit
    rows = rows[:limit]
    return {"data": [_backlink_out(*r) for r in rows], "pagination": {"next_cursor": rows[-1][0].id if more and rows else None, "has_more": more}}


def _one(db: Session, b: Business, backlink_id: int):
    q, *_ = _scoped(db, b)
    r = db.execute(q.where(Backlink.id == backlink_id)).first()
    if not r:
        raise HTTPException(404, "Backlink not found")
    return r


@router.get("/summary")
def summary(domain: str, since: datetime | None = None, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    return analytics.summary(db, _require_tracked(db, b, domain), since)


@router.get("/overview")
def overview(domain: str, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Audit-style report for one tracked domain: totals, weekly trend, top referring domains, anchors, target pages, attributes."""
    reg = _require_tracked(db, b, domain)
    own = any(t.domain == reg and not t.is_competitor for t in _targets(db, b))
    brand = {b.name.lower()} | {w for w in b.name.lower().split() if len(w) > 3} if own else set()  # a competitor's brand is its own domain name
    reviews = {x.source_domain: x.status for x in db.scalars(select(BiDomainReview).where(BiDomainReview.business_id == b.id, BiDomainReview.target_domain == reg))}
    return analytics.overview(db, reg, brand, reviews=reviews, scores=quality.scores_for(db, b.id))


REVIEW_STATUSES = {"whitelisted", "disavow", "to_contact", "not_replied", "replied", "removed"}


class ReviewIn(BaseModel):
    domain: str = Field(min_length=3, max_length=255)  # tracked target
    source_domains: list[str] = Field(min_length=1, max_length=200)
    status: str | None = None  # None clears the decision


@router.put("/reviews")
def set_review(body: ReviewIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Record what to do about referring domains: whitelist, disavow, or track a removal request."""
    reg = _require_tracked(db, b, body.domain)
    if body.status is not None and body.status not in REVIEW_STATUSES:
        raise HTTPException(422, f"status must be one of {sorted(REVIEW_STATUSES)} or null")
    n = 0
    for sd in body.source_domains:
        src = registrable_domain(host_of(sd))
        row = db.scalar(select(BiDomainReview).where(BiDomainReview.business_id == b.id, BiDomainReview.target_domain == reg, BiDomainReview.source_domain == src))
        if body.status is None:
            if row:
                db.delete(row)
                n += 1
        elif row:
            row.status = body.status
            n += 1
        else:
            db.add(BiDomainReview(business_id=b.id, target_domain=reg, source_domain=src, status=body.status))
            n += 1
    if body.status in ("to_contact", "removed"):
        for sd in body.source_domains:
            outcomes.start(db, b.id, "removal_request", f"domain:{registrable_domain(host_of(sd))}", f"Removal request: {registrable_domain(host_of(sd))}")
    db.commit()
    return {"updated": n}


class DraftIn(BaseModel):
    domain: str = Field(min_length=3, max_length=255)  # tracked target
    source_domain: str = Field(min_length=3, max_length=255)


@router.post("/reviews/draft-removal")
def draft_removal(body: DraftIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """A ready-to-edit removal request for one referring domain. Nothing is sent: copy it into your own email."""
    reg = _require_tracked(db, b, body.domain)
    src = registrable_domain(host_of(body.source_domain))
    q, TD, SD = _scoped(db, b)
    rows = db.execute(q.where(TD.registrable_domain == reg, SD.registrable_domain == src, Backlink.current_status.in_(LIVE_STATES)).order_by(Backlink.id).limit(10)).all()
    if not rows:
        raise HTTPException(404, f"{src} has no live links to {reg}")
    links = [{"source_url": page.normalized_url, "target_url": bl.target_url, "anchor_text": bl.anchor_text} for bl, page, _ in rows]
    return {"source_domain": src, "links": links, **outreach.draft_removal_email(b.name, src, reg, links)}


@router.post("/targets/sync")
def sync_from_platform(b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Track the business's own website and the competitors saved in Competitor Research (nothing the user added is changed or removed)."""
    return sync.sync_targets(db, b)


class ScoreIn(BaseModel):
    domain: str = Field(min_length=3, max_length=255)
    limit: int = Field(default=15, ge=1, le=15)
    rescore: bool = False


@router.post("/scores/run")
def run_scores(body: ScoreIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Score up to 15 linking domains that have no score yet (AI when configured, transparent rules otherwise)."""
    reg = _require_tracked(db, b, body.domain)
    todo = quality.unscored_domains(db, b.id, reg, body.limit, rescore_older_than=datetime.now() if body.rescore else None)
    rows = quality.score_domains(db, b, reg, todo) if todo else []
    left = len(quality.unscored_domains(db, b.id, reg, 500))
    return {"scored": [{"domain": x.source_domain, "relevance": x.relevance, "risk": x.risk, "verdict": x.verdict, "reason": x.reason, "method": x.method} for x in rows], "remaining": left}


class GapIn(BaseModel):
    client: str = Field(min_length=3, max_length=255)


@router.post("/gap/prioritize")
def prioritize_gap(body: GapIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """The competitor-gap domains ranked by how realistic they are to win, each with an honest way to approach it."""
    me = _require_tracked(db, b, body.client)
    comps = [t.domain for t in _targets(db, b) if t.is_competitor and t.domain != me]
    if not comps:
        raise HTTPException(409, "Add at least one competitor target first")
    return {"client": me, "competitors": comps, **insights.prioritize_gap(db, b, me, comps)}


class ExplainIn(BaseModel):
    domain: str = Field(min_length=3, max_length=255)
    days: int = Field(default=30, ge=7, le=90)


@router.post("/explain")
def explain(body: ExplainIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Plain-words explanation of what changed in the links to a tracked domain."""
    return insights.explain_changes(db, b, _require_tracked(db, b, body.domain), body.days)


@router.get("/disavow", response_class=PlainTextResponse)
def disavow_file(domain: str, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> str:
    """Google disavow-format file (`domain:` lines) of the domains marked for disavow."""
    reg = _require_tracked(db, b, domain)
    doms = sorted(x.source_domain for x in db.scalars(select(BiDomainReview).where(BiDomainReview.business_id == b.id, BiDomainReview.target_domain == reg,
                                                                                    BiDomainReview.status == "disavow")))
    return f"# Disavow file for {reg}\n# Generated {datetime.now().date().isoformat()}\n" + "".join(f"domain:{d}\n" for d in doms)


@router.get("/anchors")
def anchors(domain: str, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> list[dict]:
    return analytics.anchor_distribution(db, _require_tracked(db, b, domain))


@router.get("/referring-domains")
def ref_domains(domain: str, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> list[dict]:
    d = analytics.referring_domains(db, _require_tracked(db, b, domain))
    return [{"domain": k, **v} for k, v in sorted(d.items(), key=lambda kv: -kv[1]["backlinks"])]


@router.get("/gap")
def competitor_gap(client: str, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Domains linking to the business's competitors but not to `client`. A prospecting signal; each needs human relevance review."""
    me = _require_tracked(db, b, client)
    comps = [t.domain for t in _targets(db, b) if t.is_competitor and t.domain != me]
    if not comps:
        raise HTTPException(409, "Add at least one competitor target first")
    return {"client": me, "competitors": comps, "gap": analytics.gap(db, me, comps)}


@router.get("/{backlink_id:int}")
def detail(backlink_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    bl, page, dom = _one(db, b, backlink_id)
    prov = list(db.scalars(select(BacklinkProvenance).where(BacklinkProvenance.backlink_id == bl.id)))
    return _backlink_out(bl, page, dom, prov)


@router.get("/{backlink_id:int}/history")
def history(backlink_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    bl, *_ = _one(db, b, backlink_id)
    obs = db.scalars(select(BacklinkObservation).where(BacklinkObservation.backlink_id == bl.id).order_by(BacklinkObservation.observed_at.desc()).limit(200))
    ev = db.scalars(select(BacklinkEvent).where(BacklinkEvent.backlink_id == bl.id).order_by(BacklinkEvent.event_at.desc()).limit(200))
    return {"events": [{"type": e.event_type, "previous": e.previous_value, "new": e.new_value, "at": e.event_at, "confirmations": e.confirmation_count,
                        "evidence_observation_id": e.evidence_observation_id} for e in ev],
            "observations": [{"id": o.id, "type": o.observation_type, "at": o.observed_at, "source_http_status": o.source_http_status, "link_found": o.link_found,
                              "anchor_text": o.anchor_text, "rel_attributes": o.rel_attributes, "method": o.verification_method, "detail": o.detail} for o in obs]}


@router.post("/verify", status_code=202)
def verify(body: VerifyIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Queue source pages for re-verification by the crawler. Returns immediately; run the worker (POST /crawl/run or a scheduler)."""
    if not body.backlink_ids and not body.all_due:
        raise HTTPException(422, "Pass backlink_ids or all_due=true")
    q, *_ = _scoped(db, b)
    if body.backlink_ids:
        q = q.where(Backlink.id.in_(body.backlink_ids))
    queued = 0
    for bl, page, _dom in db.execute(q).all():
        if body.all_due and not body.backlink_ids and bl.next_verify_at and aware(bl.next_verify_at) > utcnow():
            continue
        if frontier.enqueue(db, page.normalized_url, "user", 0, priority=90.0, queue="verification"):
            queued += 1
    db.commit()
    return {"queued": queued}


@router.post("/crawl/seed", status_code=202)
def seed(body: SeedIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    added = 0
    for u in body.urls:
        try:
            normalize_url(u)
        except ValueError:
            continue
        if frontier.enqueue(db, u, "user", 0, priority=50.0):
            added += 1
    db.commit()
    return {"queued": added}


@router.post("/crawl/run")
def crawl_run(body: CrawlRunIn, b: Business = Depends(get_business), db: Session = Depends(get_db), fetcher: engine.PageFetcher = Depends(get_fetcher)) -> dict:
    """Run one worker tick inline (claims fair work from the frontier and processes it)."""
    if not _targets(db, b):
        raise HTTPException(409, "Add a tracked target first")
    results = engine.run_batch(db, fetcher, body.limit)
    return {"processed": len(results), "results": results}


@router.get("/crawl/status")
def crawl_status(b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    return {"frontier": frontier.stats(db)}


class BotConfigIn(BaseModel):
    enabled: bool | None = None
    pages_per_run: int | None = Field(default=None, ge=5, le=500)
    interval_minutes: int | None = Field(default=None, ge=5, le=1440)
    max_hops: int | None = Field(default=None, ge=0, le=3)
    render_js: bool | None = None


@router.get("/bot")
def bot_status(b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """The discovery bot: settings, whether it is running, totals and the pages it fetched most recently."""
    return bot.status(db, b.id)


@router.put("/bot")
def bot_configure(body: BotConfigIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    cfg = bot.get_config(db, b.id)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(cfg, k, v)
    db.commit()
    return bot.status(db, b.id)


def _bot_job(db: Session, business_id: int) -> None:
    bot.run_cycle(db, get_fetcher(), business_id)


@router.post("/bot/run", status_code=202)
def bot_run(background: BackgroundTasks, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Start one exploration run now. It runs in the background; poll GET /bot for progress."""
    if not _targets(db, b):
        raise HTTPException(409, "Add a tracked domain first: the bot starts from the domains you track")
    if bot.is_running(bot.get_config(db, b.id)):
        raise HTTPException(409, "The bot is already running")
    background.add_task(in_background(_bot_job, b.id))
    return {"started": True}


outcomes_router = APIRouter(prefix="/businesses/{business_id}/outcomes", tags=["outcomes"], dependencies=[Depends(current_user)])


@outcomes_router.get("")
def list_outcomes(b: Business = Depends(get_business), db: Session = Depends(get_db), limit: int = Query(default=20, ge=1, le=100)) -> dict:
    """What recent actions changed (rankings, links, reviews) 14 and 30 days after they were taken."""
    return {"summary": outcomes.summary(db, b.id), "items": outcomes.recent(db, b.id, limit)}


watch_router = APIRouter(prefix="/businesses/{business_id}/competitor-watch", tags=["competitor-watch"], dependencies=[Depends(current_user)])


class WatchConfigIn(BaseModel):
    enabled: bool


@watch_router.get("")
def watch_status(b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """The latest weekly summary, what changed on each competitor's site, and when the next visit is due."""
    return watch.status(db, b)


@watch_router.put("")
def watch_configure(body: WatchConfigIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    cfg = bot.get_config(db, b.id)
    cfg.watch_enabled = body.enabled
    db.commit()
    return watch.status(db, b)


def _watch_job(db: Session, business_id: int) -> None:
    b = db.get(Business, business_id)
    if b is not None:
        watch.run_watch(db, get_fetcher(), b)


@watch_router.post("/run", status_code=202)
def watch_run(background: BackgroundTasks, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Visit the competitors now instead of waiting for the weekly run. Runs in the background; poll GET for the result."""
    if not watch.competitor_domains(db, b.id):
        raise HTTPException(409, "Track at least one competitor first (Backlink Intelligence > Targets, or Competitor Research)")
    if watch.is_running(bot.get_config(db, b.id)):
        raise HTTPException(409, "The competitor watch is already running")
    background.add_task(in_background(_watch_job, b.id))
    return {"started": True}
