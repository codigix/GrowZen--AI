"""Keywords, rank grids, GEO / AEO, backlinks and citations for a business."""
from statistics import mean

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_business, in_background
from ..models import Business, GeoPrompt, GeoResult, Keyword, RankScan
from ..schemas import GeoPromptIn, KeywordIdeasIn, KeywordIn, RankScanIn
from ..serialize import row, rows
from ..services import ai, audits, geo, providers
from ..services.providers.base import intent_of

router = APIRouter(prefix="/businesses/{business_id}", tags=["growth"])


# Keywords
@router.get("/keywords")
def list_keywords(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    found = list(db.scalars(select(Keyword).where(Keyword.business_id == b.id).order_by(Keyword.cluster, Keyword.volume.desc().nullslast())))
    clusters: dict[str, dict] = {}
    for k in found:
        c = clusters.setdefault(k.cluster or "Not grouped", {"name": k.cluster or "Not grouped", "keywords": 0, "volume": 0, "mapped": 0})
        c["keywords"] += 1
        c["volume"] += k.volume or 0
        c["mapped"] += 1 if k.target_url else 0
    return {"keywords": rows(found), "clusters": sorted(clusters.values(), key=lambda c: -c["volume"])}


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
    db.commit()
    return {"added": added, "total": len(body)}


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
    return {"data_source": prov.source, "ideas": prov.ideas(body.seed, body.location or ", ".join(x for x in [b.area, b.city] if x), b)}


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
    db.add(RankScan(business_id=b.id, keyword=keyword, grid_size=size, radius_km=radius, points=out["points"], competitors=out["competitors"],
                    avg_rank=round(mean(found), 1) if found else None, top3=sum(1 for r in found if r <= 3), found=len(found), data_source=prov.source))
    db.commit()


@router.post("/rank-scans", status_code=202)
def rank_scan(body: RankScanIn, tasks: BackgroundTasks, b: Business = Depends(get_business)):
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
    return {"share_of_voice": geo.share_of_voice(db, b), "prompts": prompts, "results": list(latest.values())}


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
