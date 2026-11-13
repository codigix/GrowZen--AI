"""Backlink Intelligence API. Everything is scoped to a business: a backlink is visible only if it points at a domain that
business tracks (its own site or a competitor), so one business never sees another's monitoring set."""
import logging
from ..competitors import hygiene
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import case, distinct, false, func, or_, select
from sqlalchemy.orm import Session, aliased

from ..auth import User, current_user
from ..config import get_settings
from ..db import get_db, utcnow
from ..deps import get_business, in_background, my_business_ids
from ..models import Business
from . import analytics, bot, engine, frontier, insights, lookup, outcomes, outreach, quality, sync, watch
from .lifecycle import ALL_STATES, LIVE_STATES
from .models import BiDomainReview, Backlink, BacklinkEvent, BacklinkObservation, BacklinkProvenance, BiDomain, BiPage, BiTrackedTarget
from .engine import aware
from .urls import host_of, normalize_url, registrable_domain

from .lifecycle import LIVE_STATES  # noqa: E402
from .summary import own_site_links  # noqa: E402

log = logging.getLogger("seo.backlinks")

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


lookup_router = APIRouter(prefix="/backlink-intel", tags=["backlinks"], dependencies=[Depends(current_user)])


def _crawler_fallback(term: str) -> dict | None:
    """When nothing is stored locally for a domain-like query, ask our own deployed crawler. Returns None when the crawler is not set up
    or the term is not a usable domain; if it cannot be reached the reason is returned, never invented data."""
    from ..services import crawler_client

    if not get_settings().crawler_enabled:
        return None
    try:
        domain = crawler_client.normalize_domain(term)
    except ValueError:
        return None
    try:
        r = crawler_client.backlinks(domain, limit=25)
    except crawler_client.CrawlerError as exc:
        return {"state": "failed", "domain": domain, "error": str(exc)}
    return {"state": "done", "domain": domain, "status": r.get("status"), "message": r.get("message"), "total_backlinks": r.get("total_backlinks", 0),
            "total_referring_domains": r.get("total_referring_domains", 0), "backlinks": r.get("backlinks", [])}


@lookup_router.get("/lookup")
def lookup_backlinks(background: BackgroundTasks,
                     q: str = Query(default="", max_length=300, description="A domain, URL or word, e.g. codigix, codigix.co or https://codigix.co/blog. Leave empty or use * to list every backlink"),
                     limit: int = Query(default=10, ge=1, le=lookup.MAX_LIMIT, description="How many top results to return (up to 5000)"),
                     db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    """Search every backlink stored in the database (admins: all businesses; everyone else: only links to the domains their own projects track) by domain, URL or word with fuzzy matching: `codigix` returns the
    best-matching backlinks to or from codigix.co, codigixinfotech.com, blog.codigix.co and so on. Each result says whether it is `inbound` (the link
    points at what you searched for) or `outbound` (it comes from it), and inbound results come first. Leave `q` empty or use `*` to list every backlink.
    Reads the database only, except when a domain or URL query has no stored matches: then it asks our own backlink crawler for that domain
    and returns the answer as `crawler_fallback`."""
    list_all = q.strip() in ("", "*")
    pq = None
    if not list_all:
        try:
            pq = lookup.parse_query(q)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        if len(pq.term) < lookup.MIN_TERM:
            raise HTTPException(422, "Enter at least 2 characters, or leave the query empty (or *) to list everything")

    TD, SD = aliased(BiDomain), aliased(BiDomain)  # the whole table: every backlink with its source page and both domains
    base = (select(Backlink, BiPage, SD).join(BiPage, BiPage.id == Backlink.source_page_id).join(SD, SD.id == Backlink.source_domain_id)
            .join(TD, TD.id == Backlink.target_domain_id))
    ids = my_business_ids(db, user)
    if ids is not None:  # a signed-in user sees backlinks to their own projects' tracked domains, never another account's
        own = list(db.scalars(select(BiTrackedTarget.domain).where(BiTrackedTarget.business_id.in_(ids))))
        base = base.where(TD.registrable_domain.in_(own or [""]))
    esc = {"escape": "\\"}
    tconds, sconds, oconds, tmatch, smatch = [], [], [], {}, {}  # conditions on the link's target side, source side, and anchor text
    if list_all:
        sel = base
    else:
        if pq.kind == "url":  # a URL with a path: matched as text against the stored URLs
            like = lookup.like_pattern(pq.term + pq.path)
            tconds.append(Backlink.target_url.ilike(like, **esc))
            sconds.append(BiPage.normalized_url.ilike(like, **esc))
        else:
            like = lookup.like_pattern(pq.term)
            tmatch = lookup.match_domains(pq.term, set(db.scalars(base.with_only_columns(TD.registrable_domain, maintain_column_froms=True).distinct())), lookup.MIN_SCORE)
            smatch = lookup.match_domains(pq.term, set(db.scalars(base.with_only_columns(SD.registrable_domain, maintain_column_froms=True).distinct())), lookup.MIN_SCORE)
            if tmatch:
                tconds.append(TD.registrable_domain.in_(list(tmatch)))
            if smatch:
                sconds.append(SD.registrable_domain.in_(list(smatch)))
            tconds.append(Backlink.target_url.ilike(like, **esc))
            sconds.append(BiPage.normalized_url.ilike(like, **esc))
            oconds.append(Backlink.anchor_text.ilike(lookup.like_pattern(pq.phrase), **esc))
        sel = base.where(or_(*tconds, *sconds, *oconds))

    total = db.scalar(sel.with_only_columns(func.count(Backlink.id), maintain_column_froms=True)) or 0
    referring = db.scalar(sel.with_only_columns(func.count(distinct(SD.id)), maintain_column_froms=True)) or 0
    by_status = dict(db.execute(sel.with_only_columns(Backlink.current_status, func.count(Backlink.id), maintain_column_froms=True).group_by(Backlink.current_status)).all())
    summary = {"total_backlinks": total, "returned": 0, "referring_domains": referring, "by_status": by_status}
    order = [Backlink.id.desc()]
    if not list_all:
        # inbound = the link points at what was searched: its target domain matches, or its target URL contains the text and it does not come from a matching domain
        # (so codigix.co linking to facebook.com/codigix.infotech is outbound, not inbound). outbound = anything else that matched on the source side.
        t_dom = TD.registrable_domain.in_(list(tmatch)) if tmatch else false()
        s_dom = SD.registrable_domain.in_(list(smatch)) if smatch else false()
        t_cond = t_dom | (~s_dom & tconds[-1])
        s_cond = or_(*sconds)
        n_in, n_out = db.execute(sel.with_only_columns(func.sum(case((t_cond, 1), else_=0)), func.sum(case((s_cond & ~t_cond, 1), else_=0)), maintain_column_froms=True)).one()
        summary |= {"inbound": int(n_in or 0), "outbound": int(n_out or 0)}  # inbound = points at what you searched; outbound = comes from it
        strong = [d for d, sc in {**tmatch, **smatch}.items() if sc >= 92]  # exact or "contains" matches next
        order = [case((t_cond, 0), else_=1)] + ([case((or_(TD.registrable_domain.in_(strong), SD.registrable_domain.in_(strong)), 0), else_=1)] if strong else []) + order
    page = sel.add_columns(TD.registrable_domain).order_by(*order).limit(limit)

    data = []
    needle = "" if list_all else ((pq.term + pq.path) if pq.kind == "url" else pq.term)
    for bl, src, sd, target_domain in db.execute(page).all():
        on, score, direction = [], None, None
        if not list_all:
            score = 0
            if target_domain in tmatch:
                on.append("target_domain")
                score = max(score, tmatch[target_domain])
            if sd.registrable_domain in smatch:
                on.append("source_domain")
                score = max(score, smatch[sd.registrable_domain])
            if needle in (bl.target_url or "").lower():
                on.append("target_url")
                score = max(score, 100 if pq.kind == "url" else 90)
            if needle in (src.normalized_url or "").lower():
                on.append("source_url")
                score = max(score, 100 if pq.kind == "url" else 90)
            if pq.kind != "url" and pq.phrase in (bl.anchor_text or "").lower():
                on.append("anchor_text")
                score = max(score, 85)
            inbound = "target_domain" in on or ("source_domain" not in on and "target_url" in on)
            direction = "inbound" if inbound else "outbound" if {"source_domain", "source_url"} & set(on) else "other"
        data.append(_backlink_out(bl, src, sd) | {"target_domain": target_domain, "direction": direction, "matched_on": on, "match_score": score})
    summary["returned"] = len(data)

    crawler_fallback = None
    if not list_all and not data and pq.kind in ("domain", "url"):
        try:
            crawler_fallback = _crawler_fallback(pq.term)
        except Exception:  # noqa: BLE001 - the fallback must never break a search that otherwise succeeded
            log.exception("Crawler fallback for backlink lookup %r failed", q)

    def _counts(col, found: dict[str, int]) -> list[dict]:
        if not found:
            return []
        rows = db.execute(base.with_only_columns(col, func.count(Backlink.id), maintain_column_froms=True).where(col.in_(list(found))).group_by(col)).all()
        return sorted(({"domain": d, "score": found[d], "backlinks": n} for d, n in rows), key=lambda x: (-x["score"], -x["backlinks"], x["domain"]))

    as_target, as_source = _counts(TD.registrable_domain, tmatch), _counts(SD.registrable_domain, smatch)
    print(f"\n[backlink lookup] query={q!r} read as {'ALL' if list_all else pq.kind} {'' if list_all else repr(pq.term) + (pq.path or '')} | limit={limit}", flush=True)
    print(f"[backlink lookup] {summary}", flush=True)
    print(f"[backlink lookup] matched as target: {[(m['domain'], m['score'], m['backlinks']) for m in as_target]}", flush=True)
    print(f"[backlink lookup] matched as source: {[(m['domain'], m['score'], m['backlinks']) for m in as_source]}", flush=True)
    for i, d in enumerate(data[:50], 1):
        print(f"[backlink lookup] {i}. [{d['direction']}] {d['source_url']} -> {d['target_url']} | anchor={d['anchor_text']!r} | rel={d['rel_attributes']} | status={d['status']} "
              f"| score={d['match_score']}", flush=True)
    if len(data) > 50:
        print(f"[backlink lookup] ... and {len(data) - 50} more in the response", flush=True)
    return {"query": q, "interpreted_as": {"type": "all" if list_all else pq.kind, "term": None if list_all else pq.term, "path": None if list_all else (pq.path or None)},
            "summary": summary, "matched_domains": {"as_target": as_target, "as_source": as_source}, "data": data, "crawler_fallback": crawler_fallback}


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
    comps = [d for d in hygiene.saved_competitor_domains(db, b) if d != me]
    if not comps:
        raise HTTPException(409, "Save at least one competitor first (the Competitors page or Backlink Intelligence targets)")
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


@router.get("/domain-overview")
def domain_overview(b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """The Backlinks part of Domain Overview for the project's own site: sample links, follow and nofollow, link types, top anchors, referring domains and the
    pages that receive links. Built from the links our discovery bot has found and verified: not an index of the whole web."""
    from collections import defaultdict

    own = own_site_links(db, b.id)
    if not own:
        return {"state": "no_target"}
    q, TD, SD = _scoped(db, b)
    rows = db.execute(q.where(TD.registrable_domain == own["domain"], Backlink.current_status.in_(LIVE_STATES)).order_by(Backlink.id.desc()).limit(5000)).all()
    follow = nofollow = 0
    types: dict[str, int] = defaultdict(int)
    anchors: dict[str, dict] = {}
    doms: dict[str, dict] = {}
    pages: dict[str, dict] = {}
    for bl, src, sd in rows:
        rel = [x.lower() for x in (bl.rel_attributes or [])]
        if any(x in ("nofollow", "ugc", "sponsored") for x in rel):
            nofollow += 1
        else:
            follow += 1
        types[bl.link_type or "other"] += 1
        a = anchors.setdefault(" ".join((bl.anchor_text or "").lower().split()) or "(no anchor)", {"backlinks": 0, "domains": set()})
        a["backlinks"] += 1
        a["domains"].add(sd.registrable_domain)
        d = doms.setdefault(sd.registrable_domain, {"backlinks": 0, "verified": 0})
        d["backlinks"] += 1
        d["verified"] += 1 if bl.verification_status == "CRAWLER_VERIFIED" else 0
        p = pages.setdefault(bl.target_url, {"backlinks": 0, "domains": set()})
        p["backlinks"] += 1
        p["domains"].add(sd.registrable_domain)
    total = len(rows) or 1
    return {"state": "ok", "domain": own["domain"], "backlinks": own["backlinks"], "referring_domains": own["referring_domains"], "verified": own["crawler_verified"],
            "follow": follow, "nofollow": nofollow, "types": [{"type": k, "backlinks": n, "share": round(n / total * 100)} for k, n in sorted(types.items(), key=lambda kv: -kv[1])],
            "sample": [_backlink_out(*r) for r in rows[:5]],
            "anchors": [{"anchor": k, "backlinks": v["backlinks"], "domains": len(v["domains"])} for k, v in sorted(anchors.items(), key=lambda kv: -kv[1]["backlinks"])[:6]],
            "domains": [{"domain": k, **v} for k, v in sorted(doms.items(), key=lambda kv: -kv[1]["backlinks"])[:6]],
            "pages": [{"url": k, "backlinks": v["backlinks"], "domains": len(v["domains"])} for k, v in sorted(pages.items(), key=lambda kv: (-len(kv[1]["domains"]), -kv[1]["backlinks"]))[:6]]}


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
    comps = [d for d in hygiene.saved_competitor_domains(db, b) if d != me]
    if not comps:
        raise HTTPException(409, "Save at least one competitor first (the Competitors page or Backlink Intelligence targets)")
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
    bot.run_cycle(db, business_id)


@router.post("/bot/run", status_code=202)
def bot_run(background: BackgroundTasks, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Start one sync from our backlink crawler now. It runs in the background; poll GET /bot for progress."""
    if not get_settings().crawler_enabled:
        raise HTTPException(409, "Our backlink crawler is not connected: set CRAWLER_URL and CRAWLER_API_KEY in the backend settings.")
    if not _targets(db, b):
        raise HTTPException(409, "Add a tracked domain first: the sync starts from the domains you track")
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
