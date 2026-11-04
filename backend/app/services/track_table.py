"""The Position Tracking home table: one row per project with its visibility, how it moved, how many keywords improved or declined, and when it was last
checked, for Google (SEO) and for AI answers (AI Search). Read from the saved rank checks and AI answers; nothing is estimated beyond the same click-rate model
the Landscape uses."""
import re
from datetime import date, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Business, GeoPrompt, GeoResult, Keyword, KeywordRankLog
from . import geo
from .landscape import CTR, OUT, ctr

ENGINE = {"google": "Google", "chatgpt": "ChatGPT", "gemini": "Gemini"}
LANG = {"en": "English", "hi": "Hindi", "mr": "Marathi", "es": "Spanish", "fr": "French", "de": "German", "ar": "Arabic"}


def _vis(ranks: list[int | None]) -> float:
    return round(sum(ctr(r) for r in ranks) / (len(ranks) * CTR[0]) * 100, 2) if ranks else 0.0


def table(db: Session, days: int = 30) -> list[dict[str, Any]]:
    start = date.today() - timedelta(days=days)
    logs: dict[int, dict[str, list[KeywordRankLog]]] = {}
    for r in db.scalars(select(KeywordRankLog).where(KeywordRankLog.day >= start).order_by(KeywordRankLog.day)):
        logs.setdefault(r.business_id, {}).setdefault(r.keyword, []).append(r)
    tracked = dict(db.execute(select(Keyword.business_id, func.count()).where(Keyword.tracked.is_(True)).group_by(Keyword.business_id)).all())
    prompts = dict(db.execute(select(GeoPrompt.business_id, func.count()).group_by(GeoPrompt.business_id)).all())
    last_ai = dict(db.execute(select(GeoResult.business_id, func.max(GeoResult.created_at)).group_by(GeoResult.business_id)).all())
    out = []
    for b in db.scalars(select(Business).order_by(Business.name)):
        cfg = b.track_config or {}
        per = logs.get(b.id, {})
        seo = None
        if per or tracked.get(b.id):
            first = [v[0].rank for v in per.values()]
            last = [v[-1].rank for v in per.values()]
            improved = sum(1 for a, z in zip(first, last) if (z or OUT) < (a or OUT))
            declined = sum(1 for a, z in zip(first, last) if (z or OUT) > (a or OUT))
            days_checked = {r.day for v in per.values() for r in v}
            seo = {"visibility": _vis(last) if per else None, "diff": round(_vis(last) - _vis(first), 2) if len(days_checked) > 1 else None,
                   "improved": improved if len(days_checked) > 1 else None, "declined": declined if len(days_checked) > 1 else None,
                   "keywords": tracked.get(b.id, len(per)), "updated": max(days_checked).isoformat() if days_checked else None}
        ai = None
        if prompts.get(b.id):
            sov = geo.share_of_voice(db, b)
            ai = {"visibility": sov.get("overall") if sov.get("data_source") else None, "diff": None, "improved": None, "declined": None, "keywords": prompts[b.id],
                  "updated": last_ai[b.id].date().isoformat() if last_ai.get(b.id) else None}
        engines = [ENGINE.get(e, e) for e in (cfg.get("engines") or ["google"])]
        out.append({"id": b.id, "name": b.name, "domain": re.sub(r"^https?://(www\.)?|/.*$", "", b.website or "") or None, "seo": seo, "ai": ai,
                    "device": cfg.get("device") or "desktop", "location": cfg.get("location") or b.city or None, "engines": engines, "language": LANG.get(cfg.get("language") or "en", cfg.get("language") or "en"),
                    "configured": bool(cfg), "period": {"start": start.isoformat(), "end": date.today().isoformat()}})
    out.sort(key=lambda r: ((r["seo"] or {}).get("updated") or (r["ai"] or {}).get("updated") or "", r["name"]), reverse=True)
    return out
