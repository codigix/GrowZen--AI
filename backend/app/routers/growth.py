"""Keywords, rank grids, GEO / AEO, backlinks and citations for a business."""
from statistics import mean

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_business, in_background
from ..models import Business, GeoPrompt, GeoResult, Keyword, RankScan
from ..schemas import GeoPromptIn, KeywordDiscoverIn, KeywordIdeasIn, KeywordIn, RankScanIn
from ..serialize import row, rows
from ..services import ai, audits, geo, keyword_metrics, keywords, market, providers
from ..services.providers.base import intent_of

router = APIRouter(prefix="/businesses/{business_id}", tags=["growth"])


# Keywords
@router.get("/keywords")
def list_keywords(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    found = list(db.scalars(select(Keyword).where(Keyword.business_id == b.id).order_by(Keyword.cluster, Keyword.volume.desc().nullslast())))
    if any(k.volume is None for k in found) and keyword_metrics.enabled():  # saved before Google Ads was connected: fill once, cached for a day
        keyword_metrics.fill(found[:300], market.serp_country(b))
        db.commit()
    clusters: dict[str, dict] = {}
    for k in found:
        c = clusters.setdefault(k.cluster or "Not grouped", {"name": k.cluster or "Not grouped", "keywords": 0, "volume": 0, "mapped": 0})
        c["keywords"] += 1
        c["volume"] += k.volume or 0
        c["mapped"] += 1 if k.target_url else 0
    return {"keywords": rows(found), "clusters": sorted(clusters.values(), key=lambda c: -c["volume"])}


@router.post("/keywords/ai-suggestions")
def keyword_ai_suggestions(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """AI keyword and topic suggestions from what this business has really done and could grow into, each with why and where to use it. Nothing is saved."""
    from ..services import keyword_ai  # noqa: PLC0415
    try:
        return keyword_ai.suggest(db, b)
    except ai.AiUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - a failed AI call is said plainly, not a server error
        raise HTTPException(502, f"The AI could not write suggestions right now: {str(exc)[:160]}") from exc


@router.get("/keywords/usage")
def keyword_usage(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Where each saved keyword is used already (website, blog, Google posts, AI questions) and where it is meant to be used."""
    from ..services import keyword_ai  # noqa: PLC0415
    return keyword_ai.usage(db, b)


@router.post("/keywords/{keyword_id}/geo-prompt", status_code=201)
def keyword_to_geo_prompt(keyword_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Turn a saved keyword into a customer question that the AI-search (GEO/AEO) tracker asks the AI engines."""
    from ..services import keyword_ai  # noqa: PLC0415
    k = db.get(Keyword, keyword_id)
    if not k or k.business_id != b.id:
        raise HTTPException(404, "Keyword not found")
    q = keyword_ai.geo_question(k.keyword)
    exists = db.scalar(select(GeoPrompt).where(GeoPrompt.business_id == b.id, GeoPrompt.prompt == q))
    if not exists:
        db.add(GeoPrompt(business_id=b.id, prompt=q))
        if "geo" not in (k.uses or []):
            k.uses = [*(k.uses or []), "geo"]
        db.commit()
    return {"prompt": q, "added": not exists}


@router.get("/keywords/progress")
def keyword_progress(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """The four-step keyword path (find, save, group, track) and the next thing to do."""
    from ..services import keywords as kwsvc  # noqa: PLC0415
    return kwsvc.progress(db, b)


@router.post("/keywords", status_code=201)
def add_keywords(body: list[KeywordIn], b: Business = Depends(get_business), db: Session = Depends(get_db)):
    added = 0
    for k in body:
        text = " ".join(k.keyword.lower().split())
        row_ = db.scalar(select(Keyword).where(Keyword.business_id == b.id, Keyword.keyword == text))
        if not row_:
            row_ = Keyword(business_id=b.id, keyword=text)
            added += 1
        for f, v in k.model_dump(exclude={"keyword"}).items():
            if v is not None:
                setattr(row_, f, v)
        row_.intent = row_.intent or intent_of(text)
        db.add(row_)
    db.flush()
    note = keyword_metrics.fill([r for r in (db.scalar(select(Keyword).where(Keyword.business_id == b.id, Keyword.keyword == " ".join(k.keyword.lower().split()))) for k in body) if r], market.serp_country(b))
    db.commit()
    return {"added": added, "total": len(body), "metrics_note": note}


@router.patch("/keywords/{keyword_id}")
def update_keyword(keyword_id: int, body: KeywordIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    k = db.get(Keyword, keyword_id)
    if not k or k.business_id != b.id:
        raise HTTPException(404, "Keyword not found")
    for f, v in body.model_dump(exclude={"keyword"}, exclude_unset=True).items():
        setattr(k, f, v)
    db.commit()
    return row(k)


@router.delete("/keywords/{keyword_id}", status_code=204)
def delete_keyword(keyword_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    k = db.get(Keyword, keyword_id)
    if k and k.business_id == b.id:
        db.delete(k)
        db.commit()


@router.post("/keywords/ideas")
def keyword_ideas(body: KeywordIdeasIn, b: Business = Depends(get_business)):
    prov = providers.keyword_provider()
    try:
        ideas = prov.ideas(body.seed, body.location or ", ".join(x for x in [b.area, b.city] if x), b)
    except Exception as exc:  # Google Ads refused or is unreachable: say so rather than return invented numbers
        raise HTTPException(502, f"Google Ads Keyword Planner did not answer: {str(exc)[:200]}") from exc
    return {"data_source": prov.source, "ideas": ideas}


@router.get("/keywords/context")
def keyword_context(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """What keyword discovery starts from: category and services, area and nearby localities, the website's topics."""
    return keywords.context(db, b)


@router.post("/keywords/discover")
def discover_keywords(body: KeywordDiscoverIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Real searches from Google Autocomplete for the seeds and areas, grouped, scored and checked against the website."""
    return keywords.discover(db, b, body.seeds, body.areas)


@router.post("/keywords/cluster")
def cluster_keywords(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    found = list(db.scalars(select(Keyword).where(Keyword.business_id == b.id).limit(300)))
    if not found:
        return {"updated": 0}
    if not ai.is_configured():
        raise HTTPException(503, "AI is not set up on the SEO platform.")
    out = ai.complete_json("You group search keywords into topic clusters (one page per cluster). Return JSON only.",
                           "Group these into clusters with short names (2-4 words). Return {\"items\":[{\"id\":number,\"cluster\":string}]}\n\n" + "\n".join(f"#{k.id} {k.keyword}" for k in found),
                           temperature=0.2, max_tokens=3000)
    by_id = {k.id: k for k in found}
    n = 0
    for it in out.get("items", []):
        k = by_id.get(int(it.get("id", 0)))
        if k and it.get("cluster"):
            k.cluster = str(it["cluster"])[:160]
            n += 1
    db.commit()
    return {"updated": n}


# Rank grid
def _scan(db: Session, business_id: int, keyword: str, size: int, radius: float) -> None:
    b = db.get(Business, business_id)
    prov = providers.rank_provider()
    out = prov.scan_grid(b, keyword, size, radius)
    found = [p["rank"] for p in out["points"] if p["rank"]]
    db.add(RankScan(business_id=b.id, keyword=keyword, grid_size=out.get("grid_size", size), radius_km=radius, points=out["points"], competitors=out["competitors"],
                    avg_rank=round(mean(found), 1) if found else None, top3=sum(1 for r in found if r <= 3), found=len(found), data_source=prov.source))
    db.commit()


@router.post("/rank-scans", status_code=202)
def rank_scan(body: RankScanIn, tasks: BackgroundTasks, b: Business = Depends(get_business)):
    providers.rank_provider()  # no live Google results key: 503 data_unavailable now, not a scan that fails in the background
    tasks.add_task(in_background(_scan, b.id, body.keyword, body.grid_size, body.radius_km))
    return {"queued": True, "points": body.grid_size ** 2}


@router.get("/rank-scans")
def list_scans(keyword: str | None = None, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    q = select(RankScan).where(RankScan.business_id == b.id)
    if keyword:
        q = q.where(RankScan.keyword == keyword)
    return rows(db.scalars(q.order_by(RankScan.created_at.desc()).limit(50)))


# GEO / AEO
@router.get("/geo")
def geo_overview(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    prompts = rows(db.scalars(select(GeoPrompt).where(GeoPrompt.business_id == b.id)))
    latest = {}
    for g in db.scalars(select(GeoResult).where(GeoResult.business_id == b.id).order_by(GeoResult.created_at.desc()).limit(2000)):
        latest.setdefault((g.prompt_id, g.engine), row(g))
    return {"share_of_voice": geo.share_of_voice(db, b), "prompts": prompts, "results": list(latest.values()), "engines": geo.engine_status()}


@router.post("/geo/prompts", status_code=201)
def add_prompt(body: GeoPromptIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    p = GeoPrompt(business_id=b.id, prompt=body.prompt.strip())
    db.add(p)
    db.commit()
    return row(p)


@router.delete("/geo/prompts/{prompt_id}", status_code=204)
def delete_prompt(prompt_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    p = db.get(GeoPrompt, prompt_id)
    if p and p.business_id == b.id:
        db.delete(p)
        db.commit()


@router.post("/geo/run", status_code=202)
def geo_run(tasks: BackgroundTasks, b: Business = Depends(get_business)):
    geo.require_engines()  # no AI engine key: 503 data_unavailable now, not a run that stores nothing
    tasks.add_task(in_background(lambda db, bid: geo.run_prompts(db, db.get(Business, bid)), b.id))
    return {"queued": True}


# Backlinks & citations (latest audit results)
@router.get("/backlinks")
def backlinks(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    a = audits.latest(db, b).get("backlinks")
    return row(a) if a else {"result": None, "note": "Run the backlinks audit first"}


@router.get("/citations")
def citations(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    a = audits.latest(db, b).get("citations")
    return row(a) if a else {"result": None, "note": "Run the citations audit first"}
