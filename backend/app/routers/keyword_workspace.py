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


@router.post("/index")
def refresh_index(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Google Search Console for the keyword list: each keyword's views, clicks and position, and whether the page that targets it is indexed. The page calls it by itself when it opens."""
    out = kw.refresh_index(db, b)
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
