"""The keyword workspace of a project: every keyword from every source in one list, with where it came from; collect, compare, pick."""
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..auth import User, current_user
from ..deps import get_business
from ..models import Business
from ..services import keyword_workspace as kw
from ..services.activity import log

router = APIRouter(prefix="/businesses/{business_id}/keyword-workspace", tags=["keyword-workspace"])


class CollectIn(BaseModel):
    sources: list[str] | None = None


class IdsIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=500)


@router.get("")
def workspace(source: str = "", tag: str = "", q: str = Query("", max_length=80), show: str = Query("open", pattern="^(open|picked|dismissed|all)$"), b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return kw.overview(db, b, source=source, tag=tag, q=q, show=show)


class MetricsIn(BaseModel):
    place: str = Field(min_length=2, max_length=120)
    keywords: list[str] = Field(min_length=1, max_length=500)


@router.get("/places")
def table_places(extra: str = Query("", max_length=200), b: Business = Depends(get_business)):
    """The places the keyword table can be filtered by (the country, the city, the project's areas, and any added in `extra`)."""
    from ..services import keyword_locations
    return {"places": keyword_locations.places(b, [x.strip() for x in extra.split(",") if x.strip()][:3])}


class DifficultyIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=6)


@router.post("/difficulty")
def measure_difficulty(body: DifficultyIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Keyword difficulty (the full score, read from the real top 10 on Google) for a few keywords. The page calls it in small groups and shows the progress."""
    res = kw.measure_difficulty(db, b, body.ids)
    db.commit()
    return {"results": res}


@router.post("/search-console")
def refresh_search_console(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Google Search Console for the keyword list: each keyword's views, clicks and average position (last 90 days). The page calls it by itself when it opens."""
    out = kw.refresh_performance(db, b)
    db.commit()
    return out


@router.post("/trends")
def fill_trends(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Fills the last 12 months of searches for the keywords that have none yet. The page calls it by itself when it opens."""
    out = kw.fill_trends(db, b)
    db.commit()
    return out


class PlannerIn(BaseModel):
    q: str = Field(min_length=2, max_length=80)


@router.post("/planner-search")
def planner_search(body: PlannerIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Search the Google Keyword Planner for a word or phrase: the relevant ideas are added to the list with their searches and 12-month history."""
    out = kw.search_planner(db, b, body.q)
    db.commit()
    return out


@router.get("/area-search")
def area_search(q: str = Query("", max_length=80), country: str = Query("IN", max_length=2), b: Business = Depends(get_business)):
    """Google Maps suggestions for a place to target, inside a country, while typing."""
    from ..services import discovery, keyword_locations
    try:
        return {"results": keyword_locations.area_search(q, country)}
    except discovery.DiscoveryError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 -- the map service being down must not break the page
        raise HTTPException(502, f"The map service did not answer: {exc}") from exc


@router.post("/metrics")
def table_metrics(body: MetricsIn, b: Business = Depends(get_business)):
    """The figures of the table's keywords in one place: searches per month (with the last 12 months), competition index and cost per click."""
    from ..services import keyword_locations
    return keyword_locations.bulk(b, body.place.strip(), body.keywords)


@router.get("/locations")
def keyword_by_location(keyword: str = Query(min_length=2, max_length=120), extra: str = Query("", max_length=200), b: Business = Depends(get_business)):
    """One keyword place by place (country, city, the project's areas, and places added in `extra`, comma separated): searches per month, competition index, cost and the last 12 months."""
    from ..services import keyword_locations
    return keyword_locations.for_keyword(b, keyword, [x.strip() for x in extra.split(",") if x.strip()][:3])


@router.get("/usage")
def keyword_usage_detail(keyword: str = Query(min_length=2, max_length=120), b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Where one keyword is already used: the website pages (and in which place), the blogs, the FAQs, the Google posts and the Google profile."""
    from ..services import keyword_usage
    return keyword_usage.detail(keyword_usage.docs(db, b), " ".join(keyword.lower().split()))


@router.get("/summary")
def summary(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return kw.summary(db, b)


class IdeasIn(BaseModel):
    ideas: list[dict] = Field(min_length=1, max_length=200)
    label: str = Field(default="Check One Keyword", max_length=60)


@router.post("/add")
def add(body: IdeasIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return {"added": kw.add_ideas(db, b, body.ideas, body.label)}


@router.post("/collect")
def collect(body: CollectIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Read the chosen sources (all when none are named) and file the keywords they give. A source that cannot run says why."""
    report = kw.collect(db, b, body.sources)
    log(db, user.name, "keywords_collected", b.id, sources=",".join(report), new=sum(r["new"] for r in report.values()))
    db.commit()
    return {"report": report, **kw.overview(db, b)}


@router.post("/pick")
def pick(body: IdsIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    out = kw.pick(db, b, body.ids)
    log(db, user.name, "keywords_picked", b.id, added=out["picked"])
    db.commit()
    return out | kw.overview(db, b)


@router.post("/dismiss")
def dismiss(body: IdsIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return {"dismissed": kw.dismiss(db, b, body.ids, True)} | kw.overview(db, b)


@router.post("/restore")
def restore(body: IdsIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return {"restored": kw.dismiss(db, b, body.ids, False)} | kw.overview(db, b)


class PrepareIn(BaseModel):
    keywords: list[str] = Field(min_length=1, max_length=12)
    areas: list[str] | None = Field(default=None, max_length=5)


class SecondaryIn(BaseModel):
    primary: str = Field(min_length=2, max_length=120)


class CompetitorKwIn(BaseModel):
    domains: list[str] | None = Field(default=None, max_length=8)


class RankedIn(BaseModel):
    domain: str = Field(min_length=3, max_length=120)
    limit: int = Field(default=100, ge=10, le=300)


@router.post("/prepare")
def prepare_keywords(body: PrepareIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Picked keywords with their variants (near me, in each target area) and real Keyword Planner figures. Nothing is saved."""
    from ..services import keyword_prepare  # noqa: PLC0415
    return keyword_prepare.prepare(db, b, body.keywords, body.areas)


@router.post("/secondary")
def secondary_keywords(body: SecondaryIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    from ..services import keyword_prepare  # noqa: PLC0415
    return keyword_prepare.secondary(db, b, body.primary)


@router.post("/competitor-keywords")
def competitor_keywords(body: CompetitorKwIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """What the competitors' websites are about, from Keyword Planner (free), each keyword with a useful-or-not verdict. The sites are not crawled."""
    from ..services import competitor_keyword_report as ck  # noqa: PLC0415
    domains = body.domains or kw._competitor_domains(db, b)
    if not domains:
        return {"rows": [], "notes": {}, "competitors": [], "state": "no_competitors"}
    return {**ck.planner_ideas(db, b, domains), "competitors": domains, "state": "ok"}


@router.post("/competitor-rankings")
def competitor_rankings(body: RankedIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """The keywords one competitor really ranks for (paid per keyword at Apify; the cost is returned)."""
    from ..services import competitor_keyword_report as ck  # noqa: PLC0415
    return ck.ranked(db, b, body.domain, body.limit)


class BulkIn(BaseModel):
    keywords: list[str] = Field(min_length=1, max_length=100)
    country: str | None = Field(default=None, max_length=2)


@router.post("/bulk-metrics")
def bulk_metrics(body: BulkIn, b: Business = Depends(get_business)):
    """Real monthly searches and top-of-page bid from Keyword Planner for a pasted list, for one country."""
    from ..services import keyword_metrics, market  # noqa: PLC0415
    found, note = keyword_metrics.lookup(body.keywords, body.country or market.serp_country(b))
    return {"rows": [{"keyword": k, "volume": (found.get(k) or {}).get("volume"), "cpc": (found.get(k) or {}).get("cpc"), "competition": (found.get(k) or {}).get("competition")} for k in dict.fromkeys(" ".join(x.lower().split()) for x in body.keywords if x.strip())], "note": note}


class StrategyIn(BaseModel):
    seeds: list[str] = Field(min_length=1, max_length=5)
    country: str | None = Field(default=None, max_length=2)


@router.post("/strategy")
def strategy_builder(body: StrategyIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Seeds to a content plan: topics, each with a pillar page and subpages and the keywords for each. Nothing is saved."""
    from ..services import keyword_strategy  # noqa: PLC0415
    return keyword_strategy.build(db, b, body.seeds, body.country)


class NamesIn(BaseModel):
    keywords: list[str] = Field(min_length=1, max_length=500)


@router.post("/mark-picked")
def mark_picked(body: NamesIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return {"marked": kw.mark_picked(db, b, body.keywords)}


@router.get("/saved")
def saved_keywords(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    from ..services import keyword_prepare  # noqa: PLC0415
    return keyword_prepare.saved(db, b)


@router.get("/area-pin")
def area_pin(label: str = Query(min_length=2, max_length=160), country: str = Query("IN", max_length=2), b: Business = Depends(get_business)):
    """The map position of a chosen place, for the location map."""
    from ..services import keyword_locations  # noqa: PLC0415
    try:
        return {"pin": keyword_locations.place_pin(label, country)}
    except Exception as exc:  # noqa: BLE001 -- the map is a help: the place still works without a pin
        return {"pin": None, "reason": str(exc)[:160]}


@router.get("/area-at")
def area_at(lat: float = Query(ge=-90, le=90), lng: float = Query(ge=-180, le=180), country: str = Query("IN", max_length=2), b: Business = Depends(get_business)):
    """The place at a point clicked on the location map."""
    from ..services import keyword_locations  # noqa: PLC0415
    try:
        return {"place": keyword_locations.place_at(lat, lng, country)}
    except Exception as exc:  # noqa: BLE001
        return {"place": None, "reason": str(exc)[:160]}


@router.get("/competitor-gap")
def competitor_gap(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """The keyword gap: what the competitors rank for and where you stand, from their kept rankings and Google's top 10 on your tracked searches. Nothing of their websites is audited."""
    from ..services import competitor_keyword_report as ck  # noqa: PLC0415
    return ck.gap(db, b)


class AnalysisIn(BaseModel):
    domains: list[str] = Field(default_factory=list, max_length=60)


class AnalyzeIn(BaseModel):
    domain: str = Field(min_length=3, max_length=120)
    limit: int = Field(default=100, ge=10, le=300)


@router.post("/competitor-analysis")
def competitor_analysis(body: AnalysisIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """What was last read for each competitor domain (and for your own site): Domain Authority, referring domains, keywords, organic traffic, status. Nothing is read from Google or Apify here."""
    from ..services import competitor_analysis as ca  # noqa: PLC0415
    return {"metrics": ca.metrics(db, b, body.domains), "own": ca.own(db, b)}


@router.post("/competitor-analysis/analyze")
def competitor_analyze(body: AnalyzeIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Read one competitor now: its Domain Authority and the keywords it ranks for (paid per keyword at Apify). No website audit."""
    from ..services import competitor_analysis as ca  # noqa: PLC0415
    return ca.analyze_one(db, b, body.domain, body.limit)


@router.post("/competitor-analysis/pages")
def competitor_pages(body: AnalysisIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    from ..services import competitor_analysis as ca  # noqa: PLC0415
    return {"pages": ca.pages(db, b, body.domains)}


@router.post("/competitor-analysis/auto")
def competitor_auto(body: AnalysisIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Start analyzing, in the background, the listed competitors that were not analyzed yet (Domain Authority and ranked keywords). Nothing about their websites is audited."""
    from ..services import competitor_analysis as ca  # noqa: PLC0415
    return ca.start_auto(db, b, body.domains)


@router.get("/competitor-analysis/progress")
def competitor_auto_progress(b: Business = Depends(get_business)):
    from ..services import competitor_analysis as ca  # noqa: PLC0415
    return ca.progress(b.id)


@router.post("/competitor-analysis/stop")
def competitor_auto_stop(b: Business = Depends(get_business)):
    from ..services import competitor_analysis as ca  # noqa: PLC0415
    return ca.stop_auto(b.id)


class RatingsIn(BaseModel):
    location: str | None = Field(default=None, max_length=160)


@router.post("/competitor-analysis/ratings")
def competitor_ratings(body: RatingsIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Distance from the chosen place and the match score (nine factors) of every saved competitor, without needing a research run."""
    from ..services import competitor_analysis as ca  # noqa: PLC0415
    return ca.ratings(db, b, (body.location or "").strip() or None)
