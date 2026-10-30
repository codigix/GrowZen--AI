"""Google organic positions of a project's tracked keywords: one live check (Serper), saved on the keyword and as a
daily history row, so the change and the trend are real. Used by the Organic Rankings page and the scheduled
rank job."""
from datetime import date, datetime, timezone
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..competitors import intel
from ..models import Business, Keyword, KeywordRankLog
from . import market


class RankCheckError(RuntimeError):
    pass


def host(url: str | None) -> str:
    h = urlparse(url if (url or "").startswith("http") else f"https://{url or ''}").netloc.lower()
    return h[4:] if h.startswith("www.") else h


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
        hit = next((o for o in res.get("organic", [])[:20] if host(o.get("link")) == me), None)
        k.prev_rank, k.rank, k.rank_checked_at = k.rank, hit.get("position") if hit else None, today
        log_row = db.scalar(select(KeywordRankLog).where(KeywordRankLog.business_id == b.id, KeywordRankLog.keyword == k.keyword, KeywordRankLog.day == today))
        if log_row:
            log_row.rank = k.rank
        else:
            db.add(KeywordRankLog(business_id=b.id, keyword=k.keyword, day=today, rank=k.rank, location=location))
        out.append({"keyword": k.keyword, "rank": k.rank, "prev_rank": k.prev_rank, "url": hit.get("link") if hit else None})
    db.commit()
    return {"checked": len(out), "credits": serper.credits, "results": out, "location": location}


def history(db: Session, b: Business, days: int = 90) -> dict[str, list[dict]]:
    """Per keyword, its checked positions, oldest first (null = not in the top 20 that day)."""
    since = date.fromordinal(date.today().toordinal() - days)
    out: dict[str, list[dict]] = {}
    for r in db.scalars(select(KeywordRankLog).where(KeywordRankLog.business_id == b.id, KeywordRankLog.day >= since).order_by(KeywordRankLog.day)):
        out.setdefault(r.keyword, []).append({"day": r.day.isoformat(), "rank": r.rank})
    return out
