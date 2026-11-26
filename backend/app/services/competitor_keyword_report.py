"""Competitor keywords only: the searches a competitor's website is about (Google Keyword Planner reads the address, no crawl of the site) and, for competitors the user chooses,
the keywords they really rank for with position, volume and the page that ranks (paid Apify actor). Each keyword gets a verdict for this business: useful or not, and why.
No website, speed or technical checks of the competitor are made."""
from __future__ import annotations

import re
from app.services.fanout import ThreadPoolExecutor
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, Keyword
from . import apify_metrics, keyword_quality, market
from . import google_ads_client as ads

ACTOR = "santhej~ranked-keywords-checker"
COST_PER_KEYWORD = 0.003
COST_START = 0.001
COST_OVERVIEW = 0.02
LOCATION_CODES = {"US": "2840", "GB": "2826", "UK": "2826", "CA": "2124", "AU": "2036", "IN": "2356", "DE": "2276", "FR": "2250", "ES": "2724", "IT": "2380", "BR": "2076", "NL": "2528", "AE": "2784", "SG": "2702",
                  "ID": "2360", "MX": "2484", "JP": "2392", "TR": "2792", "ZA": "2710", "SA": "2682", "PK": "2586", "BD": "2050", "NG": "2566", "NZ": "2554", "IE": "2372", "PH": "2608", "MY": "2458"}  # the countries a ranked-keywords read can be asked for


def _norm(t: str) -> str:
    return " ".join((t or "").lower().split())


def cost_note(keywords: int) -> float:
    return round(COST_START + COST_OVERVIEW + COST_PER_KEYWORD * keywords, 3)


def _brand_words(domain: str) -> set[str]:
    host = domain.split(".")[0].lower()
    return {host, *re.findall(r"[a-z]{4,}", host)} - {"digital", "media", "marketing", "agency", "seo"}


def verdict(b: Business, vocab: set[str], places: set[str], keyword: str, brand: set[str], have: set[str], volume: int | None) -> dict[str, str]:
    """Useful or not for this business, with the reason in plain words."""
    k = _norm(keyword)
    if k in have:
        return {"fit": "have", "why": "You already have this keyword."}
    if any(w and w in k.split() or (len(w) >= 5 and w in k.replace(" ", "")) for w in brand):
        return {"fit": "no", "why": "Contains the competitor's own brand name: nobody searching it wants you."}
    why = keyword_quality.problem(k, vocab, places)
    if why:
        return {"fit": "no", "why": why}
    if volume is not None and volume < 10:
        return {"fit": "maybe", "why": "On topic but almost nobody searches it (under 10 a month)."}
    return {"fit": "yes", "why": "On topic for what you sell" + (f" and about {volume:,} searches a month." if volume else ".")}


def _context(db: Session, b: Business) -> tuple[set[str], set[str], set[str]]:
    vocab = keyword_quality.vocabulary(b)
    places = {w for p in (market.places(b) or []) for w in keyword_quality._words(p)} | set(keyword_quality._words(b.city)) | set(keyword_quality._words(b.area))
    have = {_norm(k) for k in db.scalars(select(Keyword.keyword).where(Keyword.business_id == b.id))}
    return vocab, places, have


SHARED_WITHIN = 3  # both rank and are this many positions apart or fewer: "shared"

INTENT_POINTS = {"transactional": 15, "commercial": 12, "local": 12, "informational": 6, "navigational": 2}


def opportunity(r: dict[str, Any]) -> tuple[int, dict[str, int]]:
    """The keyword opportunity score, 0 to 100: how worth going after a keyword looks to you. It is OUR way of ranking your to-do list. It is not a Google ranking factor and does not
    predict a position. Five parts, each only from figures that were read (a missing figure gets a neutral middle value, never an invented one):
        searches  30   log scale: 10,000 searches a month and more give all 30
        ease      25   (100 - keyword difficulty) / 100 x 25; 12 when the difficulty is not known
        intent    15   transactional 15, commercial or local 12, informational 6, navigational 2, unknown 7
        distance  20   you do not rank: 20; you rank below them: 2 points per position behind (at most 20); shared: 4; ahead: 0
        fit       10   useful for your business 10, maybe 5, otherwise 0"""
    import math  # noqa: PLC0415
    vol = r.get("volume")
    searches = round(min(1.0, math.log10(vol + 1) / 4) * 30) if vol else 0
    kd = r.get("kd") if r.get("kd") is not None else r.get("difficulty")  # the real SEO difficulty when it was read, else the Google Ads competition index
    ease = round((100 - max(0, min(100, kd))) / 100 * 25) if kd is not None else 12
    intent = INTENT_POINTS.get(r.get("intent") or "", 7)
    st, diff = r.get("status"), r.get("difference") or 0
    distance = 20 if st == "missing" else min(20, max(0, diff) * 2) if st == "weak" else 4 if st == "shared" else 0
    fit = {"yes": 10, "maybe": 5}.get(r.get("fit"), 0)
    parts = {"searches": searches, "ease": ease, "intent": intent, "distance": distance, "fit": fit}
    return sum(parts.values()), parts


def _row(db_ctx: tuple[set[str], set[str], set[str]], b: Business, domain: str, kw: str, **extra: Any) -> dict[str, Any]:
    vocab, places, have = db_ctx
    v = verdict(b, vocab, places, kw, _brand_words(domain), have, extra.get("volume")) if len(vocab) >= 3 else {"fit": "maybe", "why": "Too little is known about your business to judge; add services to your profile."}
    return {"keyword": _norm(kw), "competitor": domain, **extra, **v}


def planner_ideas(db: Session, b: Business, domains: list[str], limit: int = 120) -> dict[str, Any]:
    """The searches each competitor's address is about, from Google Keyword Planner, with volume, cost per click and a verdict. Free, and nothing of the site is crawled."""
    ctx = _context(db, b)
    geo = ads.geo_target_for(market.serp_country(b))

    def one(d: str) -> tuple[str, list[dict[str, Any]] | None, str | None]:
        try:
            got = ads.keyword_ideas([], limit=limit, geo_target=geo, page_url=f"https://{d}")
            return d, got, None
        except Exception as exc:  # noqa: BLE001 -- one competitor failing must not stop the rest
            return d, None, str(exc)[:160]

    rows: list[dict[str, Any]] = []
    notes: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=min(4, max(1, len(domains)))) as pool:
        for d, got, err in pool.map(one, domains[:8]):
            if err:
                notes[d] = err
                continue
            for i in got or []:
                rows.append(_row(ctx, b, d, i.get("keyword") or "", volume=i.get("avg_monthly_searches") or 0, cpc=i.get("high_top_of_page_bid"), competition=i.get("competition"), position=None, url=None, source="planner"))
    return {"rows": _merge(rows), "notes": notes, "source": "Google Keyword Planner reading the competitor's address"}


def ranked(db: Session, b: Business, domain: str, limit: int = 100, min_volume: int = 10) -> dict[str, Any]:
    """What a competitor really ranks for (paid per keyword on Apify). Returns the cost with the rows."""
    ctx = _context(db, b)
    code = LOCATION_CODES.get(market.serp_country(b).upper(), "2840")
    items: list[dict[str, Any]] | None = None
    last = None
    for _i, tok in apify_metrics.keys():
        try:
            r = httpx.post(f"https://api.apify.com/v2/acts/{ACTOR}/run-sync-get-dataset-items", params={"token": tok, "timeout": 120},
                           json={"target": domain, "limit": limit, "minVolume": min_volume, "locationCode": code}, timeout=130)
        except httpx.HTTPError as exc:
            last = str(exc)[:120]
            continue
        if r.status_code in (200, 201) and isinstance(r.json(), list):
            items = r.json()
            break
        last = f"Apify answered {r.status_code}"
    if items is None:
        return {"rows": [], "cost": 0, "note": f"Real rankings could not be read ({last or 'no Apify key'})."}
    rows = []
    for x in items:
        kw = x.get("keyword")
        if not kw or x.get("record_type") not in (None, "ranked_keyword"):
            continue
        rows.append(_row(ctx, b, domain, kw, volume=x.get("search_volume", x.get("volume")), cpc=x.get("cpc"), competition=x.get("competition"), difficulty=x.get("keyword_difficulty", x.get("kd")),
                         intent=x.get("search_intent", x.get("intent")), position=x.get("position") or x.get("rank_absolute"), url=x.get("ranking_url", x.get("url")),
                         traffic=x.get("traffic_estimate", x.get("etv")), source="ranking"))
    if rows:
        store(db, b, domain, rows)
    return {"rows": rows, "cost": cost_note(len(rows)), "country": market.serp_country(b), "note": None if rows else "This competitor has no ranked keywords above the volume filter."}


def _merge(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One row per keyword, with every competitor that has it."""
    by: dict[str, dict[str, Any]] = {}
    for r in rows:
        e = by.setdefault(r["keyword"], {**r, "competitors": []})
        if r["competitor"] not in e["competitors"]:
            e["competitors"].append(r["competitor"])
    out = list(by.values())
    out.sort(key=lambda r: ({"yes": 0, "maybe": 1, "have": 2, "no": 3}[r["fit"]], -len(r["competitors"]), -(r.get("volume") or 0)))
    return out



# ---------------------------------------------------------------------------------------------------------------------------------- kept rankings and the gap
def store(db: Session, b: Business, domain: str, rows: list[dict[str, Any]]) -> None:
    """Keep what a ranked-keywords read found for a competitor (the earlier read of that competitor is replaced)."""
    from datetime import datetime, timezone  # noqa: PLC0415

    from ..models import CompetitorKeyword  # noqa: PLC0415
    domain = domain.lower().removeprefix("www.")
    kept: dict[str, Any] = {}
    for old in db.scalars(select(CompetitorKeyword).where(CompetitorKeyword.business_id == b.id, CompetitorKeyword.domain == domain)):
        kept[old.keyword] = (old.difficulty, old.intent, old.metrics_at, old.kd, old.kd_at)  # what was already looked up for a keyword is not lost when the competitor is read again
        db.delete(old)
    db.flush()
    now = datetime.now(timezone.utc)
    seen: set[str] = set()
    for r in rows:
        k = _norm(r.get("keyword") or "")[:255]
        if not k or k in seen:
            continue
        seen.add(k)
        db.add(CompetitorKeyword(business_id=b.id, domain=domain, keyword=k, position=r.get("position"), volume=r.get("volume"), cpc=r.get("cpc"), difficulty=r.get("difficulty") if r.get("difficulty") is not None else (kept.get(k) or (None, None, None, None, None))[0],
                                 intent=r.get("intent") or (kept.get(k) or (None, None, None, None, None))[1], url=r.get("url"), traffic=r.get("traffic"), read_at=now,
                                 metrics_at=(kept.get(k) or (None, None, None, None, None))[2],
                                 kd=(kept.get(k) or (None, None, None, None, None))[3], kd_at=(kept.get(k) or (None, None, None, None, None))[4]))
    db.commit()


def _own_positions(db: Session, b: Business, keywords: list[str]) -> dict[str, int | None]:
    """Where the project ranks for each keyword: the tracked keyword's checked position, else Search Console's average position for it (when Google showed the site for it)."""
    from . import google_rank  # noqa: PLC0415
    tracked = {k.keyword: k.rank for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id))}
    out: dict[str, int | None] = {k: tracked.get(k) for k in keywords}
    missing = [k for k in keywords if not out.get(k)]
    if missing:
        try:
            got = google_rank.organic_positions(db, b, missing[:2000], days=90)
            for k, v in got.items():
                if v.get("position"):
                    out[_norm(k)] = max(1, round(v["position"]))
        except Exception:  # noqa: BLE001 -- Search Console may not be linked: the position is then simply unknown
            pass
    return out


def kd_known(db: Session, b: Business, keywords: list[str]) -> dict[str, int]:
    """The SEO difficulty already read for these keywords in the Keyword Workspace, by exact keyword: one figure for a keyword, wherever it is shown."""
    from ..models import KeywordCandidate  # noqa: PLC0415
    from .keyword_workspace import merge_key  # noqa: PLC0415
    keys = {merge_key(k): k for k in keywords}
    out: dict[str, int] = {}
    if not keys:
        return out
    for c in db.scalars(select(KeywordCandidate).where(KeywordCandidate.business_id == b.id, KeywordCandidate.norm.in_(list(keys)), KeywordCandidate.kd.is_not(None))):
        out[keys[c.norm]] = c.kd
    return out


def share_kd(db: Session, b: Business, keyword: str, score: int, at: Any) -> None:
    """A difficulty read anywhere is kept for the same keyword everywhere: on its competitor rows and in the Keyword Workspace."""
    from ..models import CompetitorKeyword, KeywordCandidate  # noqa: PLC0415
    from .keyword_workspace import merge_key  # noqa: PLC0415
    for row in db.scalars(select(CompetitorKeyword).where(CompetitorKeyword.business_id == b.id, CompetitorKeyword.keyword == keyword)):
        row.kd, row.kd_at = score, at
    cand = db.scalar(select(KeywordCandidate).where(KeywordCandidate.business_id == b.id, KeywordCandidate.norm == merge_key(keyword)))
    if cand is not None and cand.kd != score:
        cand.kd = score
        cand.kd_detail = {**(cand.kd_detail or {}), "at": at.isoformat(), "note": "Read from the competitor keywords"}


METRICS_FRESH_DAYS = 30  # a keyword Google Keyword Planner answered for is not asked again for this long, unless a sync is asked for


def fill_missing(db: Session, b: Business, rows: list[Any], sync: bool = False) -> dict[str, int]:
    """The ranked-keywords read gives no difficulty and no intent. Difficulty (and a missing volume or cost per click) is asked from Google Keyword Planner (the competition index of the
    keyword, 0-100); intent comes from the wording. What is found is kept on the row with the day it was asked, so:
      - a keyword already looked up is never asked again, whether Google had a figure or not, until it is older than METRICS_FRESH_DAYS;
      - the same keyword on another competitor reuses the figure already kept;
      - `sync` asks again for every keyword (or the old ones) and updates the kept figures when Google's answer changed.
    Returns {asked, updated, reused}."""
    from datetime import datetime, timedelta, timezone  # noqa: PLC0415

    from . import keyword_metrics  # noqa: PLC0415
    from .providers.base import intent_of  # noqa: PLC0415
    now = datetime.now(timezone.utc)
    fresh_after = now - timedelta(days=METRICS_FRESH_DAYS)

    def stale(r: Any) -> bool:
        at = r.metrics_at
        if at is None:
            return True
        at = at if at.tzinfo else at.replace(tzinfo=timezone.utc)
        return sync or at < fresh_after

    known = {_norm(r.keyword): r for r in rows if r.difficulty is not None and not stale(r)}  # figures kept and still fresh, reusable by the same keyword elsewhere
    stats = {"asked": 0, "updated": 0, "reused": 0}
    changed = False
    todo: list[Any] = []
    for r in rows:
        if r.intent is None:
            r.intent, changed = intent_of(r.keyword), True
        if not stale(r):
            continue
        twin = known.get(_norm(r.keyword))
        if twin is not None and twin is not r:  # same keyword, already looked up on another competitor
            r.difficulty, r.metrics_at, changed = twin.difficulty, twin.metrics_at, True
            r.volume = r.volume if r.volume is not None else twin.volume
            r.cpc = r.cpc if r.cpc is not None else twin.cpc
            stats["reused"] += 1
            continue
        todo.append(r)
    if todo:
        words = list(dict.fromkeys(_norm(r.keyword) for r in todo))
        try:
            found, why = keyword_metrics.lookup(words, market.serp_country(b))
        except Exception as exc:  # noqa: BLE001 -- Google Ads being unavailable must not stop the page
            found, why = {}, str(exc)
        if why and not found:
            todo = []  # Google could not answer at all: nothing is marked as looked up, so the next time asks again
        stats["asked"] = len(words) if todo else 0
        for r in todo:
            m = found.get(_norm(r.keyword)) or {}
            new = m.get("difficulty")
            if new != r.difficulty:
                stats["updated"] += 1
            r.difficulty = new if new is not None else r.difficulty  # a keyword Google no longer has a figure for keeps the one kept
            if m.get("volume"):
                r.volume = m["volume"] if (sync or r.volume is None) else r.volume
            if m.get("cpc") is not None and (sync or r.cpc is None):
                r.cpc = m["cpc"]
            r.metrics_at, changed = now, True
    if changed:
        db.commit()
    return stats


def gap(db: Session, b: Business, sync: bool = False) -> dict[str, Any]:
    """The keyword gap against the competitors: for each keyword a competitor ranks for (from its kept ranked-keywords read, and from Google's top 10 on your tracked searches) where you stand.
    missing = they rank and you do not; weak = both rank and they are more than SHARED_WITHIN positions above you; strong = both rank and you are more than that above them;
    shared = both rank within SHARED_WITHIN positions of each other; only_you = only you rank. Each row says whether the keyword is useful for the business, and carries an opportunity score
    (see opportunity())."""
    from ..competitors import hygiene  # noqa: PLC0415
    from ..models import CompetitorKeyword, KeywordRankLog  # noqa: PLC0415
    domains = [d.replace("www.", "") for d in hygiene.saved_competitor_domains(db, b, limit=12)]
    ctx = _context(db, b)
    by: dict[str, dict[str, Any]] = {}
    reads: dict[str, dict[str, Any]] = {d: {"domain": d, "keywords": 0, "read_at": None, "from_google": 0} for d in domains}

    def add(kw: str, dom: str, pos: int | None, url: str | None, source: str, volume: int | None = None, traffic: float | None = None, **extra: Any) -> None:
        e = by.setdefault(kw, {"keyword": kw, "volume": volume, "competitors": {}, **{k: v for k, v in extra.items() if v is not None}})
        if volume and not e.get("volume"):
            e["volume"] = volume
        if extra.get("kd") is not None and e.get("kd") is None:
            e["kd"] = extra["kd"]
        cur = e["competitors"].get(dom)
        if cur is None or (pos is not None and (cur["position"] is None or pos < cur["position"])):
            e["competitors"][dom] = {"domain": dom, "position": pos, "url": url, "source": source, "traffic": round(traffic, 1) if traffic is not None else None}

    kept = list(db.scalars(select(CompetitorKeyword).where(CompetitorKeyword.business_id == b.id, CompetitorKeyword.domain.in_(domains or [""]))))  # only the chosen competitors: a found one that was not chosen feeds nothing
    stats = fill_missing(db, b, kept, sync=sync)
    shared = kd_known(db, b, [r.keyword for r in kept if r.kd is None])  # read in the Keyword Workspace
    for r in kept:
        add(r.keyword, r.domain, r.position, r.url, "ranked", r.volume, r.traffic, intent=r.intent, difficulty=r.difficulty, cpc=r.cpc, kd=r.kd if r.kd is not None else shared.get(r.keyword))
        s = reads.setdefault(r.domain, {"domain": r.domain, "keywords": 0, "read_at": None, "from_google": 0})
        s["keywords"] += 1
        s["read_at"] = max(filter(None, [s["read_at"], r.read_at.isoformat() if r.read_at else None]), default=None)
    tracked = {k.keyword: k for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True)))}
    latest: dict[str, Any] = {}
    for r in db.scalars(select(KeywordRankLog).where(KeywordRankLog.business_id == b.id).order_by(KeywordRankLog.day)):
        if r.serp and r.keyword in tracked:
            latest[r.keyword] = r
    for kw, r in latest.items():
        for row in r.serp:
            d = str(row.get("d") or "").replace("www.", "")
            if d in reads and row.get("p"):
                add(kw, d, int(row["p"]), None, "google", tracked[kw].volume)
                reads[d]["from_google"] += 1
    own = _own_positions(db, b, list(by) + [k for k, t in tracked.items() if t.rank])
    rows = []
    for kw, e in by.items():
        comps = sorted(e["competitors"].values(), key=lambda c: (c["position"] is None, c["position"] or 999))
        best = next((c for c in comps if c["position"]), None)
        mine = own.get(kw)
        if best is None:
            continue
        status = "missing" if not mine else ("weak" if mine - best["position"] > SHARED_WITHIN else "strong" if best["position"] - mine > SHARED_WITHIN else "shared")
        v = _row(ctx, b, best["domain"], kw, volume=e.get("volume"))
        rows.append({"keyword": kw, "volume": e.get("volume"), "intent": e.get("intent"), "difficulty": e.get("difficulty"), "kd": e.get("kd"), "cpc": e.get("cpc"), "competitors": comps, "best": best, "yours": mine,
                     "status": status, "difference": (mine - best["position"]) if mine else None, "fit": v["fit"], "why": v["why"]})
        rows[-1]["score"], rows[-1]["score_parts"] = opportunity(rows[-1])
    for kw, t in tracked.items():
        if t.rank and kw not in by:
            rows.append({"keyword": kw, "volume": t.volume, "intent": t.intent, "difficulty": t.difficulty, "cpc": t.cpc, "competitors": [], "best": None, "yours": t.rank, "status": "only_you", "difference": None, "fit": "have", "why": "Only you rank for it among the competitors read.", "score": None, "score_parts": None})
    order = {"missing": 0, "weak": 1, "shared": 2, "strong": 3, "only_you": 4}
    rows.sort(key=lambda r: (order[r["status"]], -(r["score"] or 0), {"yes": 0, "maybe": 1, "have": 2, "no": 3}[r["fit"]], -(r["volume"] or 0)))
    counts = {s: sum(1 for r in rows if r["status"] == s) for s in order}
    counts["useful_gaps"] = sum(1 for r in rows if r["status"] == "missing" and r["fit"] in ("yes", "maybe"))
    return {"competitors": list(reads.values()), "rows": rows[:2000], "counts": counts, "total": len(rows), "country": market.serp_country(b), "own_read": bool(own and any(own.values())), "difficulty_sync": stats}


KD_BATCH = 20  # the most keywords whose real SEO difficulty is read in one go
KD_FRESH_DAYS = 30


def read_kd(db: Session, b: Business, limit: int = KD_BATCH, force: bool = False, keywords: list[str] | None = None) -> dict[str, Any]:
    """The real SEO difficulty (from the top 10 on Google, as the Keyword Magic Tool works it out) for the best keywords of the gap only: the useful ones with the highest score, at most `limit`.
    Each read costs Apify credit (one Google search and the Domain Authority of its results), so it is never done for the whole list. A keyword already read in the last KD_FRESH_DAYS is not read
    again unless `force`. The result is kept on every row of that keyword, with the day."""
    from datetime import datetime, timedelta, timezone  # noqa: PLC0415

    from ..models import CompetitorKeyword  # noqa: PLC0415
    from . import keyword_difficulty as kdm  # noqa: PLC0415
    limit = max(1, min(int(limit or KD_BATCH), 40))
    if keywords:  # the keywords asked for by name (the ones one page ranks for): read as they are, at most `limit`
        stored_vol = {r.keyword: r.volume for r in db.scalars(select(CompetitorKeyword).where(CompetitorKeyword.business_id == b.id, CompetitorKeyword.keyword.in_(keywords[:40])))}
        rows = [{"keyword": k, "volume": stored_vol.get(k)} for k in dict.fromkeys(keywords) if k in stored_vol]
    else:
        rows = [r for r in gap(db, b)["rows"] if r.get("fit") in ("yes", "maybe") and r.get("status") in ("missing", "weak") and r.get("score") is not None]
        rows.sort(key=lambda r: -(r["score"] or 0))
    cutoff = datetime.now(timezone.utc) - timedelta(days=KD_FRESH_DAYS)
    stored = {r.keyword: r for r in db.scalars(select(CompetitorKeyword).where(CompetitorKeyword.business_id == b.id))}

    def fresh(kw: str) -> bool:
        at = getattr(stored.get(kw), "kd_at", None)
        return bool(at) and (at if at.tzinfo else at.replace(tzinfo=timezone.utc)) >= cutoff and stored[kw].kd is not None

    chosen = [r for r in rows if force or not fresh(r["keyword"])][:limit]
    country = market.serp_country(b)
    out = {"read": 0, "failed": 0, "skipped_fresh": sum(1 for r in rows[:limit] if fresh(r["keyword"]) and not force), "errors": []}

    def one(r: dict[str, Any]) -> tuple[str, int | None, str | None]:
        try:
            res = kdm.score(r["keyword"], country, r.get("volume"), use_cache=True)
            return r["keyword"], (int(res["score"]) if res.get("score") is not None else None), None if res.get("score") is not None else "Google gave too few results with figures to score it."
        except Exception as exc:  # noqa: BLE001 -- one keyword failing must not lose the others
            return r["keyword"], None, str(exc)[:140]
    with ThreadPoolExecutor(max_workers=3) as pool:
        done = list(pool.map(one, chosen))
    now = datetime.now(timezone.utc)
    for kw, score, err in done:
        if score is None:
            out["failed"] += 1
            if err and err not in out["errors"]:
                out["errors"].append(err)
            continue
        share_kd(db, b, kw, score, now)
        out["read"] += 1
    db.commit()
    return out
