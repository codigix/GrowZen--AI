"""Google organic positions of a project's tracked keywords, read from Google Search Console (see google_rank.py) and saved on the keyword and as a daily history row,
so the change and the trend are real. The Google Maps position comes from the Google Places API. Used by the Organic Rankings page and the scheduled rank job."""
from datetime import date, datetime, timezone
import re
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..competitors import intel
from ..models import Business, Keyword, KeywordRankLog
from . import google_rank, market
from .google_rank import RankCheckError

# Names of the Google results-page features. Google gives no API for them, so nothing here is detected any more; landscape.py keeps the names for old saved rows.
FEATURES = {"answerBox": "Featured snippet", "knowledgeGraph": "Knowledge panel", "peopleAlsoAsk": "People also ask", "places": "Local pack", "videos": "Videos",
            "images": "Images", "topStories": "Top stories", "shopping": "Shopping", "relatedSearches": "Related searches"}


def host(url: str | None) -> str:
    h = urlparse(url if (url or "").startswith("http") else f"https://{url or ''}").netloc.lower()
    return h[4:] if h.startswith("www.") else h


# Search Console reports an average position, not a depth: kept for the page maths below.
DEPTH = None
PAGE_SIZE = 10


def page_of(position: int | None) -> int | None:
    """The Google results page a position is on: 1-10 -> page 1, 11-20 -> page 2 ... 91-100 -> page 10. None = not found."""
    return None if not position or position < 1 else (position - 1) // PAGE_SIZE + 1


def position_on_page(position: int | None) -> int | None:
    """The place on its results page: position 14 is the 4th result on page 2."""
    return None if not position or position < 1 else (position - 1) % PAGE_SIZE + 1


def _name_key(text: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", (text or "").lower())


def _digits(text: str | None) -> str:
    return re.sub(r"\D+", "", text or "")[-10:]  # the last 10 digits: the same number written with or without the country code


def find_listing(places: list[dict], b: Business) -> tuple[int | None, dict | None]:
    """(position, the result) of the business's own Google Business Profile in the Maps results. A listing is ours when, in this order, its
    Google place id matches, its phone number matches, its website's host matches, or its name is exactly ours (ignoring case and punctuation)."""
    me = host(b.website)
    phone = _digits(b.phone)
    name = _name_key(b.name)
    tests = [
        lambda p: bool(b.place_id) and (p.get("placeId") or p.get("place_id")) == b.place_id,
        lambda p: len(phone) >= 7 and _digits(p.get("phoneNumber") or p.get("phone")) == phone,
        lambda p: bool(me) and host(p.get("website")) == me,
        lambda p: bool(name) and _name_key(p.get("title")) == name,
    ]
    for test in tests:
        for i, p in enumerate(places):
            if test(p):
                return int(p.get("position") or i + 1), p
    return None, None


def targeting(b: Business) -> dict:
    """Where Google is asked from: the project's Position Tracking campaign (location, language, device), else its own area (market.py)."""
    cfg = b.track_config or {}
    return {"location": cfg.get("location") or intel.default_location(b), "language": cfg.get("language") or "en", "device": cfg.get("device") or "desktop",
            "country": market.serp_country(b)}


def check(db: Session, b: Business, only: list[str] | None = None, limit: int = 25, maps: bool = True) -> dict:
    """Read where the site stands on Google for each tracked keyword and save it.

    Organic: Google Search Console's average position over the last 28 days (one request for all keywords), with the clicks, impressions and the page that ranked.
    A keyword with no impressions in that time is not shown on Google yet (rank None). Maps: one Google Places request per keyword, around the business's pin, to find
    the business's own listing in Google's order. Nothing is estimated and no one else's website is read."""
    if not b.website:
        raise RankCheckError("Add the project's website first: positions are read from its Search Console property.")
    rows = [k for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True)))]
    if only:
        rows = [k for k in rows if k.keyword in set(only)]
    rows = rows[:limit]
    target = targeting(b)
    location = target["location"]
    data = google_rank.organic_positions(db, b, [k.keyword for k in rows])
    now = datetime.now(timezone.utc)
    today = now.date()
    maps_on = bool(maps and google_rank.maps_enabled())
    out = []
    for k in rows:
        d = data.get(k.keyword)
        rank = max(1, round(d["position"])) if d else None
        maps_rank = maps_total = None
        maps_listing = maps_first = None
        if maps_on:
            try:
                places = google_rank.maps_results(b, k.keyword)
            except Exception:  # noqa: BLE001 - the Maps request failing must not lose the organic result we already have
                places = None
            if places is not None:
                maps_total = len(places)
                maps_rank, mine_listing = find_listing(places, b)
                maps_listing = (mine_listing or {}).get("title")
                maps_first = places[0].get("title") if places else None
        k.prev_rank, k.rank, k.rank_checked_at = k.rank, rank, today
        log_row = db.scalar(select(KeywordRankLog).where(KeywordRankLog.business_id == b.id, KeywordRankLog.keyword == k.keyword, KeywordRankLog.day == today))
        detail = {"url": d["url"] if d else None, "own_urls": d["pages"] if d else [], "serp": None, "features": None, "own_features": None, "depth": None, "rank_page": page_of(rank),
                  "maps_rank": maps_rank, "maps_total": maps_total, "maps_listing": maps_listing, "maps_first": maps_first, "checked_at": now, "location": location,
                  "position": d["position"] if d else None, "clicks": d["clicks"] if d else None, "impressions": d["impressions"] if d else None, "source": "search_console"}
        if log_row:
            log_row.rank = k.rank
            for field, value in detail.items():
                setattr(log_row, field, value)
        else:
            db.add(KeywordRankLog(business_id=b.id, keyword=k.keyword, day=today, rank=k.rank, **detail))
        out.append({"keyword": k.keyword, "rank": k.rank, "prev_rank": k.prev_rank, "position": detail["position"], "clicks": detail["clicks"], "impressions": detail["impressions"],
                    "url": detail["url"], "page": page_of(rank), "position_on_page": position_on_page(rank), "maps_rank": maps_rank})
    db.commit()
    return {"checked": len(out), "results": out, "location": location, "source": "Google Search Console (28-day average position) and the Google Places API (Maps)", "days": google_rank.DAYS, "maps": maps_on}


def history(db: Session, b: Business, days: int = 90) -> dict[str, list[dict]]:
    """Per keyword, its checked positions, oldest first (null = not found in the results read that day)."""
    since = date.fromordinal(date.today().toordinal() - days)
    out: dict[str, list[dict]] = {}
    for r in db.scalars(select(KeywordRankLog).where(KeywordRankLog.business_id == b.id, KeywordRankLog.day >= since).order_by(KeywordRankLog.day)):
        out.setdefault(r.keyword, []).append({"day": r.day.isoformat(), "rank": r.rank})
    return out
