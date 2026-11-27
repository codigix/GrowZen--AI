"""Competitor analysis: for each competitor, only the numbers that matter for competing on Google: its Domain Authority and referring domains (Moz, through Apify), the keywords it ranks for and the
organic traffic they bring (a ranked-keywords read), and the pages that bring it. Nothing about the competitor's website is audited: no speed test, no crawl.

Everything is kept: a competitor shows what was last read and when. "Analyze" reads it again."""
from __future__ import annotations

import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, CompetitorKeyword
from . import apify_metrics
from . import competitor_keyword_report as ck


def _host(d: str) -> str:
    d = (d or "").lower().strip()
    return d[4:] if d.startswith("www.") else d


_DOMAIN = re.compile(r"^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$")


def valid_domain(d: str) -> bool:
    """A real website host such as example.com: letters, digits and hyphens in labels, at least one dot, a letter-only ending. 'null', 'localhost', an address with a path or a space are not."""
    return bool(_DOMAIN.match(_host(d)))


def _site_metrics(db: Session, domains: list[str]) -> dict[str, dict[str, Any]]:
    """Domain Authority, Page Authority, spam score and referring domains last read for each domain, with the date (whichever source read it)."""
    from ..backlinks.models import BiDomainMetric  # noqa: PLC0415
    out: dict[str, dict[str, Any]] = {}
    want = set(domains) | {f"www.{d}" for d in domains}
    for m in db.scalars(select(BiDomainMetric).where(BiDomainMetric.domain.in_(list(want) or [""]))):
        if m.da is not None:
            out[_host(m.domain)] = {"da": m.da, "pa": m.pa, "spam": m.spam_score, "rd": m.linking_domains, "read_at": m.fetched_at.isoformat() if m.fetched_at else None}
    return out


GONE = (404, 410)  # a ranking page that answers like this no longer exists: the traffic it was credited with is not counted


def metrics(db: Session, b: Business, domains: list[str]) -> dict[str, dict[str, Any]]:
    """{domain: {da, pa, spam, rd, keywords, traffic, top3, top10, avg_position, kw_read_at, status}} from what was kept. Status: analyzed (both read), partial (one), pending (none)."""
    domains = list(dict.fromkeys(_host(d) for d in domains if d))
    site = _site_metrics(db, domains)
    by: dict[str, list[CompetitorKeyword]] = {}
    for r in db.scalars(select(CompetitorKeyword).where(CompetitorKeyword.business_id == b.id, CompetitorKeyword.domain.in_(domains or [""]))):
        by.setdefault(r.domain, []).append(r)
    from ..models import CompetitorAnalysisRun  # noqa: PLC0415
    last: dict[str, Any] = {}
    for run in db.scalars(select(CompetitorAnalysisRun).where(CompetitorAnalysisRun.business_id == b.id, CompetitorAnalysisRun.domain.in_(domains or [""])).order_by(CompetitorAnalysisRun.id)):
        last[run.domain] = run  # the newest run of each domain wins
    from ..models import Competitor  # noqa: PLC0415
    kept_record = {_site_host(c.website): c for c in db.scalars(select(Competitor).where(Competitor.business_id == b.id)) if c.website and c.analysis_status}
    out: dict[str, dict[str, Any]] = {}
    for d in domains:
        rows = by.get(d, [])
        s = site.get(d) or {}
        pos = [r.position for r in rows if r.position]
        has_kw, has_site = bool(rows), s.get("da") is not None
        out[d] = {"da": s.get("da"), "pa": s.get("pa"), "spam": s.get("spam"), "rd": s.get("rd"), "site_read_at": s.get("read_at"),
                  "keywords": len(rows) if has_kw else None, "traffic": round(sum(r.traffic or 0 for r in rows if r.page_status not in GONE)) if has_kw else None,
                  "top3": sum(1 for p in pos if p <= 3) if has_kw else None, "top10": sum(1 for p in pos if p <= 10) if has_kw else None,
                  "avg_position": round(sum(pos) / len(pos), 1) if pos else None, "kw_read_at": max((r.read_at for r in rows), default=None).isoformat() if rows else None,
                  "status": "analyzed" if has_kw and has_site else "partial" if has_kw or has_site else "pending"}
        run = last.get(d)
        if run and out[d]["status"] == "pending" and run.status in ("failed", "retry"):
            out[d]["status"] = run.status  # tried and nothing could be read: say so instead of Pending
        if out[d]["status"] == "pending":  # nothing detailed is kept, but the competitor's own record may hold what an earlier analysis found
            kept = kept_record.get(d)
            if kept is not None and kept.analysis_status:
                out[d].update({k: getattr(kept, col) for k, col in SNAPSHOT.items() if getattr(kept, col) is not None}, status=kept.analysis_status, site_read_at=kept.analyzed_at.isoformat() if kept.analyzed_at else None)
        out[d]["last_run"] = {"status": run.status, "finished_at": run.finished_at.isoformat() if run.finished_at else None, "missing": run.missing or [], "error": run.error} if run else None
    return out


DEFAULTS: dict[str, Any] = {
    "auto_analyze": True,   # read newly found competitors by itself
    "authority": True,      # ... their Domain Authority (Moz, through Apify)
    "keywords": True,       # ... the keywords they rank for
    "retry_failed": True,   # try again when a read failed or only half worked
    "max_retries": 3,       # at most this many tries in a row
    "refresh_days": 0,      # read analyzed competitors again after this many days; 0 = never by itself
    "cache_hours": 168,     # a competitor read in the last 7 days is not read again unless asked with force (Refresh)
    "daily_limit": 30,      # most automatic reads a day for the project (each is paid at Apify)
}
RETRY_WAIT = 30 * 60        # seconds before a failed competitor is tried again
COOLDOWN = 60 * 60          # seconds a provider is left alone after it said quota / rate limit
_cooldown: dict[str, float] = {}


def get_config(b: Business) -> dict[str, Any]:
    return {**DEFAULTS, **(getattr(b, "competitor_config", None) or {})}


def set_config(db: Session, b: Business, patch: dict[str, Any]) -> dict[str, Any]:
    """Save the settings that were sent (unknown names are ignored, numbers are kept in range) and return all of them."""
    cfg = get_config(b)
    ranges = {"max_retries": (1, 10), "refresh_days": (0, 365), "cache_hours": (0, 720), "daily_limit": (1, 500)}
    for k, v in (patch or {}).items():
        if k in ranges:
            try:
                cfg[k] = max(ranges[k][0], min(ranges[k][1], int(v)))
            except (TypeError, ValueError):
                continue
        elif k in DEFAULTS and isinstance(DEFAULTS[k], bool):
            cfg[k] = bool(v)
    b.competitor_config = cfg
    db.commit()
    return cfg


def _is_quota(msg: str) -> bool:
    m = (msg or "").lower()
    # Apify's own words (services/apify_metrics.py): 402 out of credit, 403 limit reached or not allowed, 429 too many requests, 401 invalid token. All of them mean "stop asking for a while".
    return any(w in m for w in ("429", "402", "403", "401", "quota", "rate limit", "usage limit", "limit exceeded", "limit reached", "not allowed", "too many requests", "out of credit", "credit", "invalid token"))


def _retryable(msg: str) -> bool:
    m = (msg or "").lower()
    return _is_quota(m) or any(w in m for w in ("timeout", "timed out", "answered 5", "no apify key", "unavailable", "connect"))


def _paused(provider: str) -> str | None:
    until = _cooldown.get(provider, 0)
    if until > time.time():
        return time.strftime("%H:%M", time.localtime(until))
    return None


def _latest_runs(db: Session, b: Business, domain: str, n: int = 12) -> list[Any]:
    from ..models import CompetitorAnalysisRun  # noqa: PLC0415
    return list(db.scalars(select(CompetitorAnalysisRun).where(CompetitorAnalysisRun.business_id == b.id, CompetitorAnalysisRun.domain == domain).order_by(CompetitorAnalysisRun.id.desc()).limit(n)))


def runs_today(db: Session, b: Business, trigger: str | None = None) -> int:
    from datetime import datetime, timezone  # noqa: PLC0415
    from sqlalchemy import func  # noqa: PLC0415
    from ..models import CompetitorAnalysisRun  # noqa: PLC0415
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    q = select(func.count()).select_from(CompetitorAnalysisRun).where(CompetitorAnalysisRun.business_id == b.id, CompetitorAnalysisRun.started_at >= start)
    if trigger:
        # the daily limit guards spending: only reads that got data (analyzed or partly analyzed) count. An attempt the provider refused (limit reached, no key) cost nothing and does not use the day up.
        q = q.where(CompetitorAnalysisRun.trigger == trigger, CompetitorAnalysisRun.status.in_(("analyzed", "partial")))
    return int(db.scalar(q) or 0)


def due_reason(db: Session, b: Business, domain: str, cfg: dict[str, Any], now: float | None = None) -> str | None:
    """Why this competitor should be read now by itself: new (never read), retry (the last read failed or was half done, enough time has passed and tries are left),
    refresh (analyzed longer ago than the refresh period). None = leave it alone."""
    from datetime import datetime, timezone  # noqa: PLC0415
    now = now or time.time()
    runs = _latest_runs(db, b, domain)
    if not runs:
        return "new" if cfg["auto_analyze"] else None
    last = runs[0]
    ended = (last.finished_at or last.started_at)
    age = now - (ended.replace(tzinfo=timezone.utc) if ended.tzinfo is None else ended).timestamp()
    if last.status == "analyzing":
        return "retry" if age > 30 * 60 else None  # a read that never finished (the server stopped)
    if last.status == "analyzed":
        return "refresh" if cfg["refresh_days"] and age > cfg["refresh_days"] * 86400 else None
    tries = 0
    for r in runs:  # failed or half-done reads in a row, newest first
        if r.status == "analyzed":
            break
        tries += 1
    return "retry" if cfg["retry_failed"] and tries < cfg["max_retries"] and age > RETRY_WAIT else None


def log_usage(db: Session, b: Business | None, provider: str, target: str, ok: bool, detail: str | None = None, cost: float | None = None) -> None:
    """One line per provider call, so quota use and a failing provider can be seen. Never stops the analysis."""
    from datetime import datetime, timezone  # noqa: PLC0415
    from ..models import ApiUsageLog  # noqa: PLC0415
    try:
        db.add(ApiUsageLog(business_id=b.id if b else None, provider=provider, target=target[:255], ok=ok, detail=(detail or "")[:300] or None, cost=cost, at=datetime.now(timezone.utc)))
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()


def _call(db: Session, b: Business, provider: str, domain: str, fn) -> tuple[Any, str | None]:
    """One provider call with its rules: skipped while the provider is paused for quota, tried once more after a short wait on a temporary error, a quota answer pauses the provider for an hour."""
    until = _paused(provider)
    if until:
        return None, f"paused until {until} because the provider reported a quota or rate limit"
    err, out = None, None
    for attempt in (1, 2):
        try:
            out, err = fn()
        except Exception as exc:  # noqa: BLE001 -- a part that fails must not stop the other
            out, err = None, str(exc)[:200]
        if not err:
            return out, None
        if _is_quota(err):
            _cooldown[provider] = time.time() + COOLDOWN
            break
        if attempt == 1 and _retryable(err):
            time.sleep(2)
            continue
        break
    return out, str(err)[:200]


SNAPSHOT = {"da": "da", "pa": "pa", "spam": "spam_score", "rd": "ref_domains", "keywords": "kw_count", "traffic": "traffic_est", "top3": "top3", "top10": "top10", "avg_position": "avg_position"}


def _site_host(url: str | None) -> str:
    """The host of a saved competitor's website address (with or without the scheme), without www."""
    from urllib.parse import urlsplit  # noqa: PLC0415
    raw = (url or "").strip()
    return _host(urlsplit(raw if "//" in raw else f"//{raw}").hostname or "")


def _competitor_row(db: Session, b: Business, domain: str):
    from ..models import Competitor  # noqa: PLC0415
    for c in db.scalars(select(Competitor).where(Competitor.business_id == b.id)):
        if c.website and _site_host(c.website) == domain:
            return c
    return None


def save_snapshot(db: Session, b: Business, domain: str, m: dict[str, Any] | None = None) -> bool:
    """Keeps the figures of a competitor on the competitor itself. Only real figures are written (a missing one never empties what was kept); nothing is written when nothing was read."""
    from datetime import datetime, timezone  # noqa: PLC0415
    domain = _host(domain)
    c = _competitor_row(db, b, domain)
    if c is None:
        return False
    m = m or metrics(db, b, [domain]).get(domain) or {}
    if m.get("status") not in ("analyzed", "partial"):
        return False
    changed = False
    for key, col in SNAPSHOT.items():
        v = m.get(key)
        if v is not None and getattr(c, col) != v:
            setattr(c, col, v)
            changed = True
    if c.analysis_status != m["status"]:
        c.analysis_status, changed = m["status"], True
    if changed or c.analyzed_at is None:
        c.analyzed_at = datetime.now(timezone.utc)
        changed = True
    if not c.domain:
        c.domain, changed = domain, True
    if changed:
        db.commit()
    return changed


def backfill_snapshots(db: Session, b: Business) -> int:
    """Competitors analyzed before the record was kept on the competitor: their kept figures are copied there once (no provider is asked), and a missing domain is filled."""
    from ..models import Competitor  # noqa: PLC0415
    todo = [c for c in db.scalars(select(Competitor).where(Competitor.business_id == b.id)) if c.website and (c.analyzed_at is None or not c.domain)]
    if not todo:
        return 0
    hosts = [_site_host(c.website) for c in todo]
    got = metrics(db, b, hosts)
    n = 0
    for c in todo:
        h = _site_host(c.website)
        if not c.domain:
            c.domain = h
            n += 1
        if c.analyzed_at is None and save_snapshot(db, b, h, got.get(h)):
            n += 1
    db.commit()
    return n


def analyze_one(db: Session, b: Business, domain: str, limit: int = 100, trigger: str = "manual", force: bool = False) -> dict[str, Any]:
    """Read one competitor: its site strength (Moz, through Apify) and the keywords it ranks for. Each part reports its own reason when it could not be read, and every run is kept
    (status, provider per part, what was missing, the figures at the end), so a refresh never overwrites the history. analyzed = both parts read; partial = one, or one switched off in the
    settings; retry / failed = none. A competitor analyzed within the cache period is not read again unless `force`. Automatic reads follow the settings (which parts, daily limit)."""
    from datetime import datetime, timezone  # noqa: PLC0415
    from ..models import CompetitorAnalysisRun  # noqa: PLC0415
    domain = _host(domain)
    cfg = get_config(b)
    prev = _latest_runs(db, b, domain, 1)
    if prev and prev[0].status == "analyzed" and not force and cfg["cache_hours"]:
        ended = prev[0].finished_at or prev[0].started_at
        age_h = (time.time() - (ended.replace(tzinfo=timezone.utc) if ended.tzinfo is None else ended).timestamp()) / 3600
        if age_h < cfg["cache_hours"]:
            return {"domain": domain, "metrics": metrics(db, b, [domain])[domain], "notes": [f"Read {max(1, round(age_h))} hour(s) ago: kept figures shown, no new request was made."], "cost": 0, "keywords_read": 0,
                    "cached": True, "run": {"id": prev[0].id, "status": prev[0].status, "missing": []}}
    run = CompetitorAnalysisRun(business_id=b.id, domain=domain, status="analyzing", trigger=trigger, started_at=datetime.now(timezone.utc), parts={})
    db.add(run)
    db.commit()
    notes: list[str] = []
    parts: dict[str, dict[str, Any]] = {}
    auto = trigger == "auto"
    if auto and not cfg["authority"]:
        parts["authority"] = {"provider": "Moz via Apify", "status": "skipped", "error": "turned off in the automatic analysis settings"}
    else:
        def moz():
            got = apify_metrics.check([domain], force=True)
            err = got[0].get("error") if got else "no answer"
            if not err and (not got or (got[0].get("scores") or {}).get("da") is None):
                err = "no figure returned"
            return got, (str(err) if err else None)
        _got, err = _call(db, b, "apify_moz", domain, moz)
        parts["authority"] = {"provider": "Moz via Apify", "status": "failed" if err else "ok", **({"error": err} if err else {})}
        if err:
            notes.append(f"Domain Authority: {err[:140]}")
        log_usage(db, b, "apify_moz", domain, not err, err)
    cost = None
    rows_read = 0
    if auto and not cfg["keywords"]:
        parts["keywords"] = {"provider": "Apify ranked-keywords actor", "status": "skipped", "error": "turned off in the automatic analysis settings"}
    else:
        def ranked():
            r = ck.ranked(db, b, domain, limit)
            return r, (str(r["note"]) if r.get("note") else "no ranked keywords returned" if not r.get("rows") else None)
        r, err = _call(db, b, "apify_ranked", domain, ranked)
        cost, rows_read = (r or {}).get("cost"), len((r or {}).get("rows") or [])
        parts["keywords"] = {"provider": "Apify ranked-keywords actor", "status": "failed" if err else "ok", **({"error": err} if err else {})}
        if err:
            notes.append(f"Keywords: {err[:140]}")
        log_usage(db, b, "apify_ranked", domain, not err, err, cost)
    ok = [k for k, v in parts.items() if v["status"] == "ok"]
    missing = [k for k, v in parts.items() if v["status"] != "ok"]
    errors = "; ".join(f"{k}: {v['error']}" for k, v in parts.items() if v.get("error") and v["status"] == "failed")
    run.status = "analyzed" if not missing else "partial" if ok else "retry" if _retryable(errors) else "failed"
    run.finished_at, run.parts, run.missing, run.error = datetime.now(timezone.utc), parts, missing, errors or None
    m = metrics(db, b, [domain])[domain]
    run.snapshot = {k: m.get(k) for k in ("da", "pa", "spam", "rd", "keywords", "traffic", "top3", "top10", "avg_position")}
    db.commit()
    m = metrics(db, b, [domain])[domain]
    try:
        save_snapshot(db, b, domain, m)  # the whole record is kept on the competitor
    except Exception:  # noqa: BLE001 -- keeping the copy must never fail an analysis
        db.rollback()
    return {"domain": domain, "metrics": m, "notes": notes, "cost": cost, "keywords_read": rows_read, "cached": False, "run": {"id": run.id, "status": run.status, "missing": missing}}


def history(db: Session, b: Business, domain: str, limit: int = 20) -> list[dict[str, Any]]:
    """The earlier analyses of one competitor, newest first."""
    from ..models import CompetitorAnalysisRun  # noqa: PLC0415
    d = _host(domain)
    q = select(CompetitorAnalysisRun).where(CompetitorAnalysisRun.business_id == b.id, CompetitorAnalysisRun.domain == d).order_by(CompetitorAnalysisRun.id.desc()).limit(limit)
    out = [{"id": r.id, "status": r.status, "trigger": r.trigger, "started_at": r.started_at.isoformat() if r.started_at else None, "finished_at": r.finished_at.isoformat() if r.finished_at else None,
            "parts": r.parts or {}, "missing": r.missing or [], "error": r.error, "snapshot": r.snapshot or {}} for r in db.scalars(q)]
    if not out and valid_domain(d):
        # Analyzed before runs were kept: show what is stored, with its real read dates, as one earlier entry. Nothing is invented and nothing is written.
        m = metrics(db, b, [d]).get(d) or {}
        if m.get("status") in ("analyzed", "partial"):
            when = max(filter(None, [m.get("kw_read_at"), m.get("site_read_at")]), default=None)
            parts = {"authority": {"provider": "Moz via Apify", "status": "ok" if m.get("da") is not None else "failed"},
                     "keywords": {"provider": "Apify ranked-keywords actor", "status": "ok" if m.get("keywords") is not None else "failed"}}
            out = [{"id": None, "status": m["status"], "trigger": "earlier", "started_at": when, "finished_at": when, "parts": parts, "missing": [k for k, v in parts.items() if v["status"] != "ok"], "error": None,
                    "snapshot": {k: m.get(k) for k in ("da", "pa", "spam", "rd", "keywords", "traffic", "top3", "top10", "avg_position")}, "earlier": True}]
    return out


def usage(db: Session, b: Business, limit: int = 50) -> dict[str, Any]:
    """Provider calls made for this project: totals per provider and the latest calls."""
    from sqlalchemy import case, func  # noqa: PLC0415
    from ..models import ApiUsageLog  # noqa: PLC0415
    tot = db.execute(select(ApiUsageLog.provider, func.count(), func.sum(case((ApiUsageLog.ok.is_(False), 1), else_=0)), func.coalesce(func.sum(ApiUsageLog.cost), 0.0))
                     .where(ApiUsageLog.business_id == b.id).group_by(ApiUsageLog.provider)).all()
    last = db.scalars(select(ApiUsageLog).where(ApiUsageLog.business_id == b.id).order_by(ApiUsageLog.id.desc()).limit(limit))
    cfg = get_config(b)
    return {"providers": [{"provider": p, "calls": c, "failed": int(f or 0), "cost": round(float(x or 0), 4), "paused_until": _paused(p)} for p, c, f, x in tot],
            "today": {"automatic": runs_today(db, b, "auto"), "all": runs_today(db, b), "daily_limit": cfg["daily_limit"]}, "paused": {p: _paused(p) for p in ("apify_moz", "apify_ranked") if _paused(p)},
            "latest": [{"provider": r.provider, "target": r.target, "ok": r.ok, "detail": r.detail, "cost": r.cost, "at": r.at.isoformat() if r.at else None} for r in last]}


PAGE_KEYWORDS = 15  # keywords kept in the detail of each page


def pages(db: Session, b: Business, domains: list[str], limit: int = 200) -> list[dict[str, Any]]:
    """The pages that bring each competitor its organic traffic, from the kept keyword reads: per page the keywords it ranks for, their estimated traffic, its best position and its top keyword (the
    most searched one) with that keyword's position, and the page's best keywords with where YOU stand on each. The page's title and its backlinks are not read by any provider here, so they are not given."""
    from . import competitor_keyword_report as ck  # noqa: PLC0415
    domains = list(dict.fromkeys(_host(d) for d in domains if d))
    agg: dict[tuple[str, str], dict[str, Any]] = {}
    for r in db.scalars(select(CompetitorKeyword).where(CompetitorKeyword.business_id == b.id, CompetitorKeyword.domain.in_(domains or [""]))):
        if not r.url:
            continue
        e = agg.setdefault((r.domain, r.url), {"domain": r.domain, "url": r.url, "keywords": 0, "traffic": 0.0, "best": None, "top_keyword": None, "top_volume": -1, "top_position": None, "list": []})
        e["keywords"] += 1
        gone = r.page_status in GONE
        e["traffic"] += 0 if gone else (r.traffic or 0)
        e["traffic_was"] = e.get("traffic_was", 0) + (r.traffic or 0)
        e["read_at"] = max(filter(None, [e.get("read_at"), r.read_at]), default=None)
        e["page_status"], e["checked_at"] = r.page_status, (r.page_checked_at if r.page_status is not None else e.get("checked_at"))
        if r.position and (e["best"] is None or r.position < e["best"]):
            e["best"] = r.position
        if (r.volume or 0) > e["top_volume"]:
            e["top_keyword"], e["top_volume"], e["top_position"] = r.keyword, r.volume or 0, r.position
            e["top_kd"] = r.kd
        e["list"].append({"keyword": r.keyword, "position": r.position, "volume": r.volume, "difficulty": r.difficulty, "cpc": r.cpc, "intent": r.intent, "kd": r.kd, "traffic": round(r.traffic or 0, 1)})
    out = sorted(agg.values(), key=lambda e: (-e["traffic"], -e["keywords"]))[:limit]
    for e in out:
        e["list"] = sorted(e["list"], key=lambda k: (-(k["traffic"] or 0), -(k["volume"] or 0)))[:PAGE_KEYWORDS]
    wanted = list({k["keyword"] for e in out for k in e["list"]})
    shared = ck.kd_known(db, b, [k["keyword"] for e in out for k in e["list"] if k.get("kd") is None])  # read in the Keyword Workspace
    for e in out:
        for k in e["list"]:
            if k.get("kd") is None and k["keyword"] in shared:
                k["kd"] = shared[k["keyword"]]
        top = next((k for k in e["list"] if k["keyword"] == e.get("top_keyword")), None)
        if top and top.get("kd") is not None:
            e["top_kd"] = top["kd"]
    mine = ck._own_positions(db, b, wanted) if wanted else {}
    for e in out:
        e["traffic"] = round(e["traffic"])
        e["traffic_was"] = round(e.get("traffic_was") or 0)
        e["read_at"] = e["read_at"].isoformat() if e.get("read_at") else None
        e["checked_at"] = e["checked_at"].isoformat() if e.get("checked_at") else None
        e["live"] = None if e.get("page_status") is None else (False if e["page_status"] in GONE else True if e["page_status"] < 400 else None)  # None = not checked, or answered something that says nothing (a block, a timeout)
        e.pop("top_volume", None)
        for k in e["list"]:
            k["yours"] = mine.get(k["keyword"])
        e["title"] = None  # not read by any provider here
        e["backlinks"] = None  # page-level backlinks are not read either
    return out


def top_keywords(db: Session, b: Business, domains: list[str], per_domain: int = 8) -> dict[str, list[dict[str, Any]]]:
    """For each competitor, the keywords that bring it the most estimated visits, from its kept ranked keywords."""
    domains = list(dict.fromkeys(_host(d) for d in domains if d))
    by: dict[str, list[CompetitorKeyword]] = {}
    for r in db.scalars(select(CompetitorKeyword).where(CompetitorKeyword.business_id == b.id, CompetitorKeyword.domain.in_(domains or [""]))):
        by.setdefault(r.domain, []).append(r)
    return {d: [{"keyword": r.keyword, "position": r.position, "volume": r.volume, "traffic": round(r.traffic or 0, 1), "url": r.url}
                for r in sorted(rs, key=lambda r: -(r.traffic or 0))[:per_domain]] for d, rs in by.items()}


def trend(db: Session, b: Business, domains: list[str], limit: int = 24) -> dict[str, list[dict[str, Any]]]:
    """Each competitor's figures at the end of every analysis run that read them (traffic and keywords). That is the only history there is: nothing is filled in between runs, and a competitor
    analyzed once has one point. Oldest first."""
    from ..models import CompetitorAnalysisRun  # noqa: PLC0415
    domains = list(dict.fromkeys(_host(d) for d in domains if d))
    out: dict[str, list[dict[str, Any]]] = {}
    q = select(CompetitorAnalysisRun).where(CompetitorAnalysisRun.business_id == b.id, CompetitorAnalysisRun.domain.in_(domains or [""])).order_by(CompetitorAnalysisRun.id)
    for r in db.scalars(q):
        snap = r.snapshot or {}
        if snap.get("traffic") is None and snap.get("keywords") is None:
            continue
        out.setdefault(r.domain, []).append({"at": (r.finished_at or r.started_at).isoformat(), "traffic": snap.get("traffic"), "keywords": snap.get("keywords"), "top10": snap.get("top10")})
    return {d: v[-limit:] for d, v in out.items()}


def own(db: Session, b: Business) -> dict[str, Any] | None:
    """Your own site in the same terms: Domain Authority and referring domains as last read, the tracked keywords that rank, and Google clicks in the last 28 days (Search Console)."""
    from ..backlinks.overview import _gsc_clicks  # noqa: PLC0415
    from ..models import Keyword  # noqa: PLC0415
    from . import google_rank  # noqa: PLC0415
    host = _host(google_rank.host_of(b.website) or "")
    if not host:
        return None
    m = dict(metrics(db, b, [host]).get(host) or {})
    ranked = [k.rank for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True))) if k.rank]
    m.update({"domain": host, "keywords": len(ranked), "top3": sum(1 for r in ranked if r <= 3), "top10": sum(1 for r in ranked if r <= 10),
              "avg_position": round(sum(ranked) / len(ranked), 1) if ranked else None, "traffic": _gsc_clicks(db, b), "traffic_note": "Google clicks, last 28 days (Search Console)", "kw_read_at": None})
    return m


# ---------------------------------------------------------------------------------------------------------------------------------- automatic analysis
import threading  # noqa: E402
import time  # noqa: E402

_progress: dict[int, dict[str, Any]] = {}
_lock = threading.Lock()
MAX_AUTO = 10


def progress(business_id: int) -> dict[str, Any]:
    p = _progress.get(business_id)
    return dict(p) if p else {"running": False, "total": 0, "done": 0, "current": None, "queue": [], "failed": {}, "finished_at": None}


def start_auto(db: Session, b: Business, domains: list[str], limit: int = 100) -> dict[str, Any]:
    """Analyze, one after another in the background, the competitors that are due by the project's settings: new ones, failed or half-done ones that may be tried again, and analyzed ones older than
    the refresh period. At most MAX_AUTO at once and no more than the daily limit a day. Progress is kept for the page to follow."""
    cfg = get_config(b)
    with _lock:
        cur = _progress.get(b.id)
        if cur and cur.get("running"):
            return dict(cur)
        now = time.time()
        due = {}
        for d in dict.fromkeys(_host(x) for x in domains if x):
            if not valid_domain(d):
                continue  # not a website: nothing to read, and nothing to spend on
            why = due_reason(db, b, d, cfg, now)
            if why:
                due[d] = why
        room = max(0, cfg["daily_limit"] - runs_today(db, b, "auto"))
        todo = list(due)[:min(MAX_AUTO, room)]
        if not todo:
            return progress(b.id) | {"running": False, "limit_reached": bool(due) and room <= 0, "due": len(due)}
        _progress[b.id] = {"running": True, "total": len(todo), "done": 0, "current": todo[0], "queue": list(todo), "failed": {}, "finished_at": None, "stop": False, "why": {d: due[d] for d in todo}}
    threading.Thread(target=_work, args=(b.id, todo, limit), daemon=True, name=f"competitor-analysis-{b.id}").start()
    return progress(b.id)


def run_scheduled(db: Session) -> int:
    """Called by the scheduler: for each project that switched on refreshing or retrying, start the reads that are due. Returns how many projects started one."""
    n = 0
    for b in db.scalars(select(Business)):
        cfg = get_config(b)
        if not (cfg["auto_analyze"] or cfg["refresh_days"] or cfg["retry_failed"]):
            continue
        from ..models import Competitor  # noqa: PLC0415
        hosts = [c.domain or _host(c.website) for c in db.scalars(select(Competitor).where(Competitor.business_id == b.id)) if (c.website or c.domain) and c.selected is not False]
        if hosts and start_auto(db, b, hosts).get("running"):
            n += 1
    return n


def stop_auto(business_id: int) -> dict[str, Any]:
    with _lock:
        if business_id in _progress:
            _progress[business_id]["stop"] = True
    return progress(business_id)


def _work(business_id: int, todo: list[str], limit: int) -> None:
    from ..db import SessionLocal  # noqa: PLC0415
    db = SessionLocal()
    try:
        b = db.get(Business, business_id)
        for d in todo:
            p = _progress[business_id]
            if p.get("stop") or b is None:
                break
            p["current"] = d
            try:
                r = analyze_one(db, b, d, limit, trigger="auto")
                if r["notes"] and r["metrics"]["status"] == "pending":
                    p["failed"][d] = r["notes"][0]
            except Exception as exc:  # noqa: BLE001 -- one competitor failing must not stop the rest
                db.rollback()
                p["failed"][d] = str(exc)[:160]
            p["done"] += 1
            p["queue"] = [x for x in p["queue"] if x != d]
    finally:
        db.close()
        with _lock:
            p = _progress.get(business_id)
            if p:
                p.update({"running": False, "current": None, "queue": [], "finished_at": time.time()})


# ---------------------------------------------------------------------------------------------------------------------------------- location and match for every saved competitor
_rated: dict[tuple, tuple[float, dict[str, Any]]] = {}


def _km(a: tuple[float, float], b: tuple[float, float]) -> float:
    import math  # noqa: PLC0415
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    d = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b[1] - a[1]) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(d))


def ratings(db: Session, b: Business, location: str | None) -> dict[str, Any]:
    """For every saved competitor: its address, how far it is from the place searched, and how well it matches the business (the nine factors). Works from the saved list, so it does not
    need a research run. A competitor's map point is found once from its address and kept. Cached for six hours."""
    from ..competitors import intel, intel_router, relevance  # noqa: PLC0415
    from ..models import Audit, Competitor  # noqa: PLC0415
    from ..services import keyword_locations, market  # noqa: PLC0415
    comps = list(db.scalars(select(Competitor).where(Competitor.business_id == b.id).order_by(Competitor.id)))
    key = (b.id, (location or "").lower(), tuple(c.id for c in comps))
    hit = _rated.get(key)
    if hit and time.time() - hit[0] < 6 * 3600:
        return hit[1]
    centre = intel_router._centre(b, location) or ((b.lat, b.lng) if getattr(b, "lat", None) is not None and getattr(b, "lng", None) is not None else None)
    country = market.serp_country(b)
    geocoded = 0
    for c in comps:  # find each competitor's point once and keep it
        if c.lat is None and c.address and geocoded < 30:
            geocoded += 1
            try:
                pin = keyword_locations.place_pin(f"{c.name}, {c.address}"[:160], country) or keyword_locations.place_pin(c.address[:160], country)
            except Exception:  # noqa: BLE001 -- without a point the distance is simply not shown
                pin = None
            if pin:
                c.lat, c.lng = pin["lat"], pin["lng"]
    db.commit()
    run = db.scalar(select(Audit).where(Audit.kind == "intel", Audit.target == f"business:{b.id}", Audit.status == "done").order_by(Audit.id.desc()))
    result = (run.result or {}) if run else {}
    keywords = list(result.get("keywords") or [])[:8] or [k for k in intel.default_keywords(b)[:5]]
    seen = {_host((e.get("domain") or e.get("website") or "")): e for e in (result.get("local_competitors") or [])}
    cands = []
    for c in comps:
        dom = _host(c.website or "")
        dom = dom.split("/")[0] if dom else ""
        e = seen.get(dom) or {}
        cands.append({"_id": c.id, "name": c.name, "category": e.get("category"), "address": c.address, "website": c.website, "domain": dom, "cid": c.place_id,
                      "distance_m": round(_km(centre, (c.lat, c.lng)) * 1000) if centre and c.lat is not None else None,
                      "appearances": e.get("appearances"), "best": e.get("best"), "avg_position": e.get("avg_position"), "mine": False})
    authority: dict[str, int] = {}
    try:
        from ..backlinks.models import BiDomainMetric  # noqa: PLC0415
        authority = {m.domain.lower().removeprefix("www."): m.da for m in db.scalars(select(BiDomainMetric)) if m.da is not None}
    except Exception:  # noqa: BLE001
        pass
    try:
        extra = intel_router._context(db, b, {})
    except Exception:  # noqa: BLE001
        extra = {}
    from ..services import categories as _categories  # noqa: PLC0415
    own_rental = bool(_categories.rental_seeds(getattr(b, "name", None), getattr(b, "primary_category", None), [s.get("name") for s in (getattr(b, "services", None) or [])], getattr(b, "description", None)))
    relevance.rate(b, cands, keywords, authority, lambda u: intel.scan_site(u, max_pages=0, timeout=6), own_rental, extra)
    out: dict[str, Any] = {"centre": {"lat": centre[0], "lng": centre[1]} if centre else None, "keywords": keywords, "by_id": {}, "weights": relevance.WEIGHTS, "labels": relevance.LABELS, "direct_at": relevance.DIRECT_AT, "related_at": relevance.RELATED_AT}
    for x in cands:
        out["by_id"][str(x["_id"])] = {"address": x.get("address"), "distance_m": x.get("distance_m"), "relevance": x.get("relevance")}
    _rated[key] = (time.time(), out)
    return out


def check_pages(db: Session, b: Business, domains: list[str], limit: int = 40, force: bool = False) -> dict[str, Any]:
    """Asks each ranking page of the chosen competitors whether it still exists (a plain page request, no paid service; the top pages by traffic first, at most `limit`).
    A page checked in the last day is not asked again unless `force`. 404 and 410 mean it is gone: its traffic is no longer counted. The answer is kept on every keyword row of that page."""
    from datetime import datetime, timedelta, timezone  # noqa: PLC0415

    import httpx  # noqa: PLC0415

    from .url_safety import SSRFSafeTransport  # noqa: PLC0415
    cutoff = datetime.now(timezone.utc) - timedelta(days=1)
    rows = list(db.scalars(select(CompetitorKeyword).where(CompetitorKeyword.business_id == b.id, CompetitorKeyword.domain.in_(list(dict.fromkeys(_host(d) for d in domains if d)) or [""]), CompetitorKeyword.url.is_not(None))))
    traffic: dict[str, float] = {}
    for r in rows:
        traffic[r.url] = traffic.get(r.url, 0) + (r.traffic or 0)

    def recent(r: CompetitorKeyword) -> bool:
        at = r.page_checked_at
        return bool(at) and (at if at.tzinfo else at.replace(tzinfo=timezone.utc)) >= cutoff
    skip = set() if force else {r.url for r in rows if recent(r)}
    urls = [u for u, _t in sorted(traffic.items(), key=lambda x: -x[1]) if u not in skip][:max(1, min(limit, 80))]
    status: dict[str, int] = {}
    if urls:
        def one(u: str) -> tuple[str, int]:
            try:
                with httpx.Client(transport=SSRFSafeTransport(retries=0), timeout=10, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 (compatible; GrowZenPageCheck/1.0)"}) as c:
                    with c.stream("GET", u) as resp:
                        return u, resp.status_code
            except Exception:  # noqa: BLE001 -- unreachable: not a verdict on the page
                return u, 0
        from concurrent.futures import ThreadPoolExecutor  # noqa: PLC0415
        with ThreadPoolExecutor(max_workers=6) as pool:
            status = dict(pool.map(one, urls))
        now = datetime.now(timezone.utc)
        for r in rows:
            if r.url in status:
                r.page_status, r.page_checked_at = status[r.url], now
        db.commit()
    gone = sum(1 for v in status.values() if v in GONE)
    return {"checked": len(status), "gone": gone, "unreachable": sum(1 for v in status.values() if v == 0), "kept": len(skip)}
