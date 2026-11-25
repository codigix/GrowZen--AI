"""SERP features: which special results (People also ask, Local pack, Videos, Ads, AI overview...) Google shows on the searches the project tracks.
Each live read of a results page is kept on that day's rank log row, so the presence of every feature builds up over time. Nothing is estimated: a feature is present when Google's page showed it."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, Keyword, KeywordRankLog
from . import keyword_difficulty as kd
from . import market, organic

FEATURES = ["Ads", "People also ask", "Local pack", "Knowledge panel", "Videos", "Shopping", "Discussions", "AI overview"]
MAX_SCAN = 12


def _read(keyword: str, country: str) -> dict[str, Any] | None:
    try:
        r = kd.serp(keyword, country, None)
    except Exception:  # noqa: BLE001 -- one search failing must not stop the others
        return None
    feats = {n: bool((r.get("features") or {}).get(n)) for n in FEATURES}
    feats["AI overview"] = feats["AI overview"] or bool(r.get("ai_overview"))
    feats["Ads"] = feats["Ads"] or bool(r.get("ads"))
    feats["People also ask"] = feats["People also ask"] or bool(r.get("questions"))
    return {"features": feats, "ads": [str(a.get("title") or "")[:90] for a in (r.get("ads") or []) if isinstance(a, dict)][:4], "questions": [str(q)[:120] for q in (r.get("questions") or [])][:5],
            "related": [str(x)[:100] for x in (r.get("related") or [])][:6], "serp": [{"d": o.get("site"), "p": o.get("position")} for o in (r.get("organic") or [])][:10],
            "read_at": datetime.now(timezone.utc).isoformat()}


def scan(db: Session, b: Business, keywords: list[str] | None = None) -> dict[str, Any]:
    """Read Google's results page now for the tracked keywords (up to 12) and keep what each showed on today's row."""
    rows = [k for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True)).order_by(Keyword.volume.desc().nullslast()))]
    if keywords:
        want = {" ".join(k.lower().split()) for k in keywords}
        rows = [k for k in rows if k.keyword in want]
    rows = rows[:MAX_SCAN]
    country = market.serp_country(b)
    with ThreadPoolExecutor(max_workers=4) as pool:
        got = list(pool.map(lambda k: _read(k.keyword, country), rows))
    today = date.today()
    done = 0
    for k, g in zip(rows, got):
        if not g:
            continue
        row = db.scalar(select(KeywordRankLog).where(KeywordRankLog.business_id == b.id, KeywordRankLog.keyword == k.keyword, KeywordRankLog.day == today))
        if row is None:
            row = KeywordRankLog(business_id=b.id, keyword=k.keyword, day=today, rank=k.rank, source="serp_read")
            db.add(row)
        row.serp_extra = {key: g[key] for key in ("features", "ads", "questions", "related", "read_at")}
        row.features = [n for n, on in g["features"].items() if on]
        row.serp = g["serp"]
        done += 1
    db.commit()
    return {"read": done, "of": len(rows), "failed": len(rows) - done}


def report(db: Session, b: Business, keyword: str | None, days: int = 90) -> dict[str, Any]:
    """Presence of each feature on the tracked searches (or one search), its trend over the days read, the searches it appears on, and where the tracked keywords rank."""
    kws = {k.keyword: k for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True)))}
    one = " ".join((keyword or "").lower().split()) or None
    scope = [one] if one else list(kws)
    since = date.today() - timedelta(days=max(7, min(days, 365)))
    logs = [r for r in db.scalars(select(KeywordRankLog).where(KeywordRankLog.business_id == b.id, KeywordRankLog.day >= since).order_by(KeywordRankLog.day)) if r.keyword in scope and r.serp_extra]
    by_day: dict[str, dict[str, dict[str, bool]]] = {}
    latest: dict[str, KeywordRankLog] = {}
    for r in logs:
        by_day.setdefault(r.day.isoformat(), {})[r.keyword] = r.serp_extra.get("features") or {}
        latest[r.keyword] = r
    n_read = len(latest)
    detail = []
    for name in FEATURES:
        series = [{"day": d, "pct": round(100 * sum(1 for f in per.values() if f.get(name)) / len(per), 1)} for d, per in sorted(by_day.items())]
        on = [k for k, r in latest.items() if (r.serp_extra.get("features") or {}).get(name)]
        examples: list[dict[str, str]] = []
        if name == "People also ask":
            examples = [{"text": q, "keyword": k} for k, r in latest.items() for q in (r.serp_extra.get("questions") or [])[:2]][:4]
        elif name == "Ads":
            examples = [{"text": a, "keyword": k} for k, r in latest.items() for a in (r.serp_extra.get("ads") or [])[:1]][:4]
        examples = examples or [{"text": k, "keyword": k} for k in on[:4]]
        detail.append({"feature": name, "presence": round(100 * len(on) / n_read, 1) if n_read else None, "count": len(on), "series": series, "examples": examples})
    any_series = [{"day": d, "with": round(100 * sum(1 for f in per.values() if any(f.values())) / len(per), 1)} for d, per in sorted(by_day.items())]
    with_any = sum(1 for r in latest.values() if any((r.serp_extra.get("features") or {}).values()))
    ranks = [k.rank for k in kws.values() if (not one or k.keyword == one)]
    tracked = len(ranks)
    vis = round(100 * sum(organic._ctr(r) for r in ranks if r) / tracked, 1) if tracked else None
    return {"scope": one or "all", "tracked": tracked, "read": n_read, "with_features": with_any, "with_pct": round(100 * with_any / n_read, 1) if n_read else None,
            "visibility": vis, "top3": sum(1 for r in ranks if r and r <= 3), "top10": sum(1 for r in ranks if r and r <= 10), "top100": sum(1 for r in ranks if r and r <= 100),
            "features": detail, "series": any_series, "last_read": max((r.serp_extra.get("read_at") for r in latest.values()), default=None), "days_read": len(by_day)}


def insights(db: Session, b: Business, keyword: str | None = None) -> dict[str, Any]:
    """Tracking insights for the tracked keywords: intent mix, who is visible on the same searches (from the stored reads of Google's results), what changed since the last check,
    which SERP features the searches show, and the visibility over the days checked. Every figure is counted from stored reads; the visibility is an estimate from an average click curve."""
    from collections import Counter  # noqa: PLC0415

    from ..competitors import hygiene  # noqa: PLC0415
    from . import gsc  # noqa: PLC0415
    kws = list(db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True))))
    n = len(kws)
    one = " ".join((keyword or "").lower().split()) or None
    ranks = [k.rank for k in kws]
    prevs = [k.prev_rank for k in kws]
    have_prev = any(p for p in prevs)
    vis = lambda rs: round(100 * sum(organic._ctr(r) for r in rs if r) / len(rs), 1) if rs else None  # noqa: E731
    count = lambda rs, top: sum(1 for r in rs if r and r <= top)  # noqa: E731
    intents = Counter((k.intent or "unknown") for k in kws)
    since = date.today() - timedelta(days=90)
    logs = [r for r in db.scalars(select(KeywordRankLog).where(KeywordRankLog.business_id == b.id, KeywordRankLog.day >= since).order_by(KeywordRankLog.day)) if r.keyword in {k.keyword for k in kws}]
    latest: dict[str, KeywordRankLog] = {}
    for r in logs:
        if r.serp_extra:
            latest[r.keyword] = r
    read = len(latest)
    own = gsc.host_of(b.website) or ""
    own = own[4:] if own.startswith("www.") else own
    rivals = {x.replace("www.", "") for x in hygiene.saved_competitor_domains(db, b, limit=20)}
    dom: dict[str, float] = {}
    for r in latest.values():
        for row in (r.serp or []):
            d = str(row.get("d") or "").replace("www.", "")
            if d and row.get("p"):
                dom[d] = dom.get(d, 0.0) + organic._ctr(row["p"])
    own_rank = {k.keyword: k.rank for k in kws}
    own_vis = round(100 * sum(organic._ctr(own_rank.get(kw)) for kw in latest) / read, 1) if read else None
    land = [{"domain": d, "visibility": round(100 * v / read, 1), "competitor": d in rivals, "you": False} for d, v in dom.items() if d != own] if read else []
    land.sort(key=lambda x: -x["visibility"])
    land = land[:5]
    if own_vis is not None:
        land.append({"domain": own or "your site", "visibility": own_vis, "competitor": False, "you": True})
        land.sort(key=lambda x: -x["visibility"])
    rep = report(db, b, None, 90)
    opp = []
    for f in rep["features"]:
        if not f["count"]:
            continue
        pct = f["presence"] or 0
        mine = None
        if f["feature"] == "Local pack":
            mine = sum(1 for r in latest.values() if r.maps_rank) if read else None
        opp.append({"feature": f["feature"], "likelihood": "High" if pct >= 50 else "Medium" if pct >= 25 else "Low", "presence": pct, "count": f["count"],
                    "yours": None if mine is None else {"yes": mine, "of": read}})
    by_day: dict[str, list[float]] = {}
    for r in logs:
        by_day.setdefault(r.day.isoformat(), []).append(organic._ctr(r.rank))
    trend = [{"day": d, "visibility": round(100 * sum(v) / len(v), 1), "keywords": len(v)} for d, v in sorted(by_day.items())]
    ranked = [r for r in ranks if r]
    mine_kw = next((k for k in kws if k.keyword == one), None)
    return {"tracked": n, "read": read, "keyword": one, "keyword_intent": mine_kw.intent if mine_kw else None,
            "visibility": vis(ranks), "visibility_prev": vis(prevs) if have_prev else None,
            "top3": count(ranks, 3), "top3_prev": count(prevs, 3) if have_prev else None, "top10": count(ranks, 10), "top10_prev": count(prevs, 10) if have_prev else None,
            "top100": count(ranks, 100), "top100_prev": count(prevs, 100) if have_prev else None,
            "intents": [{"intent": i, "count": c, "pct": round(100 * c / n, 1)} for i, c in intents.most_common()] if n else [],
            "landscape": land, "opportunities": opp, "trend": trend, "feature_types": sum(1 for f in rep["features"] if f["count"]),
            "average_position": round(sum(ranked) / len(ranked), 1) if ranked else None, "not_ranking": n - len(ranked), "have_prev": have_prev}
