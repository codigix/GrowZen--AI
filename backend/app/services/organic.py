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


def check(db: Session, b: Business, only: list[str] | None = None, limit: int = 25) -> dict:
    if not intel.serper_enabled():
        raise RankCheckError("Rank checks need Google results: set SERPER_API_KEY on the SEO backend (serper.dev).")
    if not b.website:
        raise RankCheckError("Add the project's website first: positions are matched by its domain.")
    me = host(b.website)
    rows = [k for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True)))]
    if only:
        rows = [k for k in rows if k.keyword in set(only)]
    rows = rows[:limit]
    location = intel.default_location(b)
    serper = intel.Serper(market.serp_country(b))
    today = datetime.now(timezone.utc).date()
    out = []
    for k in rows:
        try:
            res = serper.search(k.keyword, location)
        except intel.IntelError as exc:
            raise RankCheckError(str(exc)) from exc
        organic = res.get("organic", [])[:20]
        hit = next((o for o in organic if result_host(o) == me), None)
        mine = [_shown(o)[1] for o in organic if result_host(o) == me]
        features, own_features = serp_features(res, me)
        serp = [{"d": result_host(o), "p": o.get("position")} for o in organic if result_host(o)]
        k.prev_rank, k.rank, k.rank_checked_at = k.rank, hit.get("position") if hit else None, today
        log_row = db.scalar(select(KeywordRankLog).where(KeywordRankLog.business_id == b.id, KeywordRankLog.keyword == k.keyword, KeywordRankLog.day == today))
        detail = {"url": _shown(hit)[1] if hit else None, "own_urls": mine, "serp": serp, "features": features, "own_features": own_features}
        if log_row:
            log_row.rank = k.rank
            for field, value in detail.items():
                setattr(log_row, field, value)
        else:
            db.add(KeywordRankLog(business_id=b.id, keyword=k.keyword, day=today, rank=k.rank, location=location, **detail))
        out.append({"keyword": k.keyword, "rank": k.rank, "prev_rank": k.prev_rank, "url": _shown(hit)[1] if hit else None})
    db.commit()
    return {"checked": len(out), "credits": serper.credits, "results": out, "location": location}


def history(db: Session, b: Business, days: int = 90) -> dict[str, list[dict]]:
    """Per keyword, its checked positions, oldest first (null = not in the top 20 that day)."""
    since = date.fromordinal(date.today().toordinal() - days)
    out: dict[str, list[dict]] = {}
    for r in db.scalars(select(KeywordRankLog).where(KeywordRankLog.business_id == b.id, KeywordRankLog.day >= since).order_by(KeywordRankLog.day)):
        out.setdefault(r.keyword, []).append({"day": r.day.isoformat(), "rank": r.rank})
    return out
