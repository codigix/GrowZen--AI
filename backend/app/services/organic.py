"""Google organic positions of a project's tracked keywords: one live check (Serper), saved on the keyword and as a
daily history row, so the change and the trend are real. Used by the Organic Rankings page and the scheduled
rank job."""
from datetime import date, datetime, timezone
import re
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..competitors import intel
from ..models import Business, Keyword, KeywordRankLog
from . import market


class RankCheckError(RuntimeError):
    pass


# Serper result keys that mark a SERP feature, and the name shown for it.
FEATURES = {"answerBox": "Featured snippet", "knowledgeGraph": "Knowledge panel", "peopleAlsoAsk": "People also ask", "places": "Local pack", "videos": "Videos",
            "images": "Images", "topStories": "Top stories", "shopping": "Shopping", "relatedSearches": "Related searches"}


def serp_features(res: dict, me: str) -> tuple[list[str], list[str]]:
    """(features on the page, those the site appears in)."""
    on, own = [], []
    for key, name in FEATURES.items():
        v = res.get(key)
        if not v:
            continue
        on.append(name)
        items = v if isinstance(v, list) else [v]
        if any(isinstance(i, dict) and host(i.get("link") or i.get("source") or "") == me for i in items):
            own.append(name)
    return on, own


def host(url: str | None) -> str:
    h = urlparse(url if (url or "").startswith("http") else f"https://{url or ''}").netloc.lower()
    return h[4:] if h.startswith("www.") else h


def _is_redirect(link: str) -> bool:
    """Serper returns most results below the third as Google click-tracking links (google.com/goto?url=...), not the page's address."""
    u = urlparse(link or "")
    return u.netloc.lower().endswith("google.com") and u.path.startswith("/goto")


def _shown(o: dict) -> tuple[str, str]:
    """(host, url) of a result. For a redirect link the real site is read from the displayed address ("https://site.com › blog › post"):
    the host is exact, the path may be shortened by Google."""
    link = o.get("link") or ""
    if not _is_redirect(link):
        return host(link), link
    parts = [x.strip(" .…") for x in re.split(r"\s*[›»]\s*", (o.get("displayedLink") or "").strip()) if x.strip(" .…")]
    if not parts or not parts[0].startswith(("http://", "https://")):
        return "", ""
    path: list[str] = []
    for seg in parts[1:]:  # a segment with spaces is a page title (breadcrumb), not a path: stop there
        if " " in seg:
            break
        path.append(seg)
    return host(parts[0]), "/".join([parts[0].split()[0], *path])


def result_host(o: dict) -> str:
    return _shown(o)[0]


# How deep a check reads Google's results: 100 = ten results pages.
DEPTH = 100
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
    """Read Google right now for each tracked keyword, from the project's targeted area, and save where the site stands.

    Per keyword this asks Serper for the top 100 organic results in ONE request (so the Google results page, 1-10, and the place on it are
    known, not only "top 20"), and, when `maps` is on, for the Google Maps / local results in a second request to find the business's own
    profile. Credit trade-off (Serper bills what its answer's `credits` field says, and `serper.credits` here adds exactly that): up to 10
    results cost 1 credit, a 100-result answer costs more than that, and the Maps request is one more. A check is therefore a few credits
    per keyword, capped at `limit` keywords (25) per call. Answers are never taken from the 12-hour cache: "check now" is Google as it is now.
    """
    if not intel.serper_enabled():
        raise RankCheckError("Rank checks need Google results: set SERPER_API_KEY on the SEO backend (serper.dev).")
    if not b.website:
        raise RankCheckError("Add the project's website first: positions are matched by its domain.")
    me = host(b.website)
    rows = [k for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True)))]
    if only:
        rows = [k for k in rows if k.keyword in set(only)]
    rows = rows[:limit]
    target = targeting(b)  # Position Tracking targeting: where and in which language Google is asked
    location = target["location"]
    serper = intel.Serper(target["country"], target["language"], fresh=True)
    now = datetime.now(timezone.utc)
    today = now.date()
    out = []
    for k in rows:
        try:
            res = serper.search(k.keyword, location, num=DEPTH)
        except intel.IntelError as exc:
            raise RankCheckError(str(exc)) from exc
        organic = res.get("organic", [])[:DEPTH]
        for i, o in enumerate(organic):  # the position Google gives; fall back to the order when it is missing
            o.setdefault("position", i + 1)
        hit = next((o for o in organic if result_host(o) == me), None)
        mine = [_shown(o)[1] for o in organic if result_host(o) == me]
        features, own_features = serp_features(res, me)
        serp = [{"d": result_host(o), "p": o.get("position")} for o in organic[:20] if result_host(o)]  # the history keeps the first two pages
        rank = int(hit["position"]) if hit else None
        maps_rank = maps_total = None
        maps_listing = maps_first = None
        if maps:
            try:
                places = (serper.places(k.keyword, location).get("places") or [])
            except intel.IntelError:
                places = None  # the Maps request failing must not lose the organic result we already have
            if places is not None:
                maps_total = len(places)
                maps_rank, mine_listing = find_listing(places, b)
                maps_listing = (mine_listing or {}).get("title")
                maps_first = (places[0].get("title") if places else None)
        k.prev_rank, k.rank, k.rank_checked_at = k.rank, rank, today
        log_row = db.scalar(select(KeywordRankLog).where(KeywordRankLog.business_id == b.id, KeywordRankLog.keyword == k.keyword, KeywordRankLog.day == today))
        detail = {"url": _shown(hit)[1] if hit else None, "own_urls": mine, "serp": serp, "features": features, "own_features": own_features,
                  "depth": DEPTH, "rank_page": page_of(rank), "maps_rank": maps_rank, "maps_total": maps_total, "maps_listing": maps_listing, "maps_first": maps_first,
                  "checked_at": now, "location": location}
        if log_row:
            log_row.rank = k.rank
            for field, value in detail.items():
                setattr(log_row, field, value)
        else:
            db.add(KeywordRankLog(business_id=b.id, keyword=k.keyword, day=today, rank=k.rank, **detail))
        out.append({"keyword": k.keyword, "rank": k.rank, "prev_rank": k.prev_rank, "url": detail["url"], "page": page_of(rank), "position_on_page": position_on_page(rank),
                    "maps_rank": maps_rank})
    db.commit()
    return {"checked": len(out), "credits": serper.credits, "results": out, "location": location, "depth": DEPTH}


def history(db: Session, b: Business, days: int = 90) -> dict[str, list[dict]]:
    """Per keyword, its checked positions, oldest first (null = not found in the results read that day)."""
    since = date.fromordinal(date.today().toordinal() - days)
    out: dict[str, list[dict]] = {}
    for r in db.scalars(select(KeywordRankLog).where(KeywordRankLog.business_id == b.id, KeywordRankLog.day >= since).order_by(KeywordRankLog.day)):
        out.setdefault(r.keyword, []).append({"day": r.day.isoformat(), "rank": r.rank})
    return out
