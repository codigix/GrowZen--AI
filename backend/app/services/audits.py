"""Run audits and store them: GBP, rankings, technical (PageSpeed), on-page (crawler),
backlinks, citations. Each audit saves a score, issues and whether the data was live or sample."""
from datetime import datetime, timedelta, timezone
from statistics import mean
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from ..models import Audit, Business, Keyword, Post, RankScan, Review
from . import crawler, pagespeed, providers
from .profile_score import ProfileStats, issues_from, score_profile

KINDS = ["gbp", "rankings", "technical", "onpage", "backlinks", "citations"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def profile_stats(db: Session, b: Business) -> ProfileStats:
    n, avg, replied = db.execute(select(func.count(Review.id), func.avg(Review.rating), func.sum(case((Review.reply_status == "posted", 1), else_=0))).where(Review.business_id == b.id)).one()
    since = _now() - timedelta(days=30)
    posts = db.scalar(select(func.count(Post.id)).where(Post.business_id == b.id, Post.status == "published", Post.published_at >= since)) or 0
    review_count = n or b.review_count or 0
    rating = float(avg) if avg else (b.rating or 0.0)
    return ProfileStats(review_count=review_count, rating=rating, reply_rate=(replied or 0) / n if n else 0.0, photos=b.photo_count or 0, posts_last_30=posts)


def _run_gbp(db: Session, b: Business) -> tuple[int, list[dict[str, Any]], dict[str, Any], str]:
    res = score_profile(b, profile_stats(db, b))
    return res.score, issues_from(res), {"factors": res.factors, "items": res.items, "alerts": res.alerts, "top_fixes": res.top_fixes, "linked_to_google": bool(b.gbp_location)}, "live"


def _run_rankings(db: Session, b: Business) -> tuple[int, list[dict[str, Any]], dict[str, Any], str]:
    keywords = [k.keyword for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True)).order_by(Keyword.volume.desc().nullslast()).limit(3))]
    if not keywords:
        keywords = [f"{b.primary_category or 'business'} near me".lower(), f"{b.primary_category or 'business'} in {b.area or b.city or ''}".strip().lower()]
    prov = providers.rank_provider()
    scans = []
    for kw in keywords:
        out = prov.scan_grid(b, kw, 7, 5.0)
        pts = out["points"]
        found = [p["rank"] for p in pts if p["rank"]]
        scan = RankScan(business_id=b.id, keyword=kw, grid_size=7, radius_km=5.0, points=pts, competitors=out["competitors"],
                        avg_rank=round(mean(found), 1) if found else None, top3=sum(1 for r in found if r <= 3), found=len(found), data_source=prov.source)
        db.add(scan)
        scans.append(scan)
    total = sum(s.grid_size ** 2 for s in scans)
    top3 = sum(s.top3 for s in scans)
    found = sum(s.found for s in scans)
    score = round((top3 / total) * 70 + (found / total) * 30) if total else 0
    issues = [{"area": "Rankings", "level": "serious" if s.top3 < 10 else "warning", "title": f"“{s.keyword}”: top 3 at {s.top3} of {s.grid_size ** 2} grid points", "fix": "Improve category, reviews and the matching landing page; add local posts."} for s in scans if s.top3 < 25]
    return score, issues, {"keywords": keywords, "scans": [{"keyword": s.keyword, "avg_rank": s.avg_rank, "top3": s.top3, "found": s.found} for s in scans]}, prov.source


def _run_technical(db: Session, b: Business) -> tuple[int, list[dict[str, Any]], dict[str, Any], str]:
    if not b.website:
        return 0, [{"area": "Website", "level": "critical", "title": "No website", "fix": "Build one from the profile (Website Builder)."}], {}, "live"
    result = pagespeed.run(b.website, "mobile")
    scores = [v for v in result["scores"].values() if v is not None]
    return round(mean(scores)) if scores else 0, pagespeed.issues_from(result), result, "live"


def _run_onpage(db: Session, b: Business) -> tuple[int, list[dict[str, Any]], dict[str, Any], str]:
    if not b.website:
        return 0, [], {}, "live"
    site = crawler.crawl(b.website, max_pages=25)
    score, issues = crawler.summarise(site)
    return score, issues, {k: v for k, v in site.items() if k != "pages"} | {"pages": site.get("pages", [])}, "live"


def _run_backlinks(db: Session, b: Business) -> tuple[int, list[dict[str, Any]], dict[str, Any], str]:
    prov = providers.backlink_provider()
    domain = urlparse(b.website).netloc if b.website else None
    if not domain:
        return 0, [{"area": "Backlinks", "level": "warning", "title": "No website, so no backlink profile", "fix": "Build a website first."}], {}, prov.source
    s = prov.summary(domain)
    rd = s.get("referring_domains") or 0
    score = min(100, round(rd * 1.6))
    issues = []
    if rd < 20:
        issues.append({"area": "Backlinks", "level": "warning", "title": f"Only {rd} referring domains", "fix": "Earn links from local news, associations and directories; see the link gap."})
    if s.get("toxic"):
        issues.append({"area": "Backlinks", "level": "warning", "title": f"{s['toxic']} toxic links", "fix": "Review them; disavow only clear spam."})
    return score, issues, s, prov.source


def _run_citations(db: Session, b: Business) -> tuple[int, list[dict[str, Any]], dict[str, Any], str]:
    prov = providers.citation_provider()
    rows = prov.check(b)
    ok = sum(1 for r in rows if r["status"] == "listed")
    issues = [{"area": "Citations", "level": "warning" if r["status"] == "inconsistent" else "info", "title": f"{r['directory']}: {'NAP mismatch' if r['status'] == 'inconsistent' else 'not listed'}", "fix": "Correct the listing to match the Business Profile exactly." if r["status"] == "inconsistent" else "Submit the business."} for r in rows if r["status"] != "listed"]
    return round(ok / len(rows) * 100) if rows else 0, issues, {"directories": rows}, prov.source


RUNNERS = {"gbp": _run_gbp, "rankings": _run_rankings, "technical": _run_technical, "onpage": _run_onpage, "backlinks": _run_backlinks, "citations": _run_citations}


def run(db: Session, b: Business, kind: str) -> Audit:
    audit = Audit(business_id=b.id, kind=kind, target=b.website, status="running", started_at=_now())
    db.add(audit)
    db.commit()
    try:
        score, issues, result, source = RUNNERS[kind](db, b)
        audit.score, audit.issues, audit.result, audit.data_source, audit.status = score, issues, result, source, "done"
    except Exception as exc:  # one failed area must not stop the others
        audit.status, audit.error = "failed", str(exc)[:1000]
    audit.finished_at = _now()
    db.commit()
    return audit


def run_all(db: Session, b: Business, kinds: list[str] | None = None) -> list[Audit]:
    done = [run(db, b, k) for k in (kinds or KINDS)]
    b.last_audit_score = overall(db, b)
    db.commit()
    return done


def latest(db: Session, b: Business) -> dict[str, Audit]:
    out: dict[str, Audit] = {}
    for a in db.scalars(select(Audit).where(Audit.business_id == b.id, Audit.status == "done").order_by(Audit.finished_at.desc())):
        out.setdefault(a.kind, a)
    return out


def overall(db: Session, b: Business) -> int | None:
    """Average of the latest score per area (areas that don't apply, e.g. no website, left out)."""
    scores = [a.score for k, a in latest(db, b).items() if a.score is not None and not (k in ("technical", "onpage") and not b.website)]
    return round(mean(scores)) if scores else None


def website_audit(db: Session, url: str, strategy: str = "mobile", crawl_pages: int = 10, audit: Audit | None = None) -> Audit:
    """One-off audit of any URL (no business needed): PageSpeed + a short crawl."""
    audit = audit or Audit(kind="website", target=url)
    audit.status, audit.started_at = "running", _now()
    db.add(audit)
    db.commit()
    result: dict[str, Any] = {}
    issues: list[dict[str, Any]] = []
    errors = []
    try:
        result["pagespeed"] = pagespeed.run(url, strategy)
        issues += pagespeed.issues_from(result["pagespeed"])
    except Exception as exc:
        errors.append(f"PageSpeed: {exc}")
    try:
        site = crawler.crawl(url, max_pages=crawl_pages)
        crawl_score, crawl_issues = crawler.summarise(site)
        result["crawl"] = site | {"score": crawl_score}
        issues += crawl_issues
    except Exception as exc:
        errors.append(f"Crawl: {exc}")
    seo = (result.get("pagespeed") or {}).get("scores", {}).get("seo")
    parts = [x for x in [seo, (result.get("crawl") or {}).get("score")] if x is not None]
    audit.score = round(mean(parts)) if parts else None
    audit.result, audit.issues = result, issues
    audit.status = "done" if parts else "failed"
    audit.error = "; ".join(errors) or None
    audit.finished_at = _now()
    db.commit()
    return audit
