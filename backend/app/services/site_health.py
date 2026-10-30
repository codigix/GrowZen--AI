"""The Site Audit table: every project's health broken into the parameters an SEO tool reports (site health, AI
search health, errors, warnings, crawlability, HTTPS, international SEO, site performance, internal linking, markups,
Core Web Vitals), with the change since the audit before. All read from audits already stored (the crawl and the
Lighthouse run); a figure the stored audit cannot support (older audits did not record links or page language) is None
and fills in after the next audit, never guessed."""
import re
from statistics import mean
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Audit, Business
from . import geo, market

KEYS = ["site_health", "ai_search", "errors", "warnings", "crawlability", "https", "int_seo", "performance", "internal_linking", "markups", "core_web_vitals"]
VITALS = {"lcp": 2.5, "cls": 0.1, "tbt": 200}  # "good" thresholds: seconds, score, milliseconds


def _number(display: Any) -> float | None:
    m = re.search(r"[\d.]+", str(display or "").replace(",", ""))
    return float(m.group()) if m else None


def _pct(part: int, whole: int) -> int | None:
    return round(part / whole * 100) if whole else None


def breakdown(crawl: dict[str, Any] | None, crawl_score: int | None, ps: dict[str, Any] | None, issues: list[dict[str, Any]]) -> dict[str, Any]:
    """The figures for one audit (a crawl and/or a Lighthouse run). Percentages are 0-100, higher is better."""
    pages = (crawl or {}).get("pages") or []
    n = len(pages)
    out: dict[str, Any] = {k: None for k in KEYS}
    out["pages_crawled"] = n
    seo = ((ps or {}).get("scores") or {}).get("seo")
    parts = [x for x in (seo, crawl_score) if x is not None]
    out["site_health"] = round(mean(parts)) if parts else None
    out["errors"] = sum(1 for i in issues if i.get("level") in ("critical", "serious"))
    out["warnings"] = sum(1 for i in issues if i.get("level") == "warning")
    if n:
        ok = sum(1 for p in pages if (p.get("status") or 0) < 400 and not p.get("noindex") and not p.get("javascript_only"))
        crawlable = 0 if crawl.get("robots_blocks_all") else (ok / n * 100) - (0 if crawl.get("sitemap") else 5)
        out["crawlability"] = max(0, round(crawlable))
        out["https"] = 0 if not crawl.get("https") else _pct(sum(1 for p in pages if str(p.get("url", "")).startswith("https")), n)
        out["markups"] = _pct(sum(1 for p in pages if p.get("schema_types")), n)
        if all("lang" in p for p in pages):  # older crawls did not record the page language
            out["int_seo"] = _pct(sum(1 for p in pages if p.get("lang")), n)
        deep = pages[1:]  # the homepage is the entry, so it cannot be an orphan
        if all("inbound" in p for p in pages):
            out["internal_linking"] = 100 if not deep else _pct(sum(1 for p in deep if p["inbound"] > 0 and p.get("internal_out", 0) > 0), len(deep))
    scores = (ps or {}).get("scores") or {}
    out["performance"] = scores.get("performance")
    metrics = (ps or {}).get("metrics") or {}
    checked = [(k, _number(metrics.get(k))) for k in VITALS]
    checked = [(k, v) for k, v in checked if v is not None]
    if checked:
        out["core_web_vitals"] = _pct(sum(1 for k, v in checked if v <= VITALS[k]), len(checked))
    return out


def _latest_two(db: Session, b: Business, kind: str) -> list[Audit]:
    return list(db.scalars(select(Audit).where(Audit.business_id == b.id, Audit.kind == kind, Audit.status == "done").order_by(Audit.id.desc()).limit(2)))


def _issues(*audits: Audit | None) -> list[dict[str, Any]]:
    return [i for a in audits if a for i in (a.issues or [])]


def _of(rows: list[Audit], i: int) -> Audit | None:
    return rows[i] if len(rows) > i else None


def table(db: Session) -> list[dict[str, Any]]:
    """One row per project, newest audit first: the figures, and the change against the audit before."""
    rows = []
    for b in db.scalars(select(Business).order_by(Business.name)):
        onpage, technical = _latest_two(db, b, "onpage"), _latest_two(db, b, "technical")

        def figures(i: int) -> dict[str, Any]:
            op, te = _of(onpage, i), _of(technical, i)
            return breakdown(op.result if op else None, op.score if op else None, te.result if te else None, _issues(op, te))

        now = figures(0)
        before = figures(1) if len(onpage) > 1 or len(technical) > 1 else None
        sov = geo.share_of_voice(db, b)
        now["ai_search"] = sov["overall"] if sov.get("data_source") else None
        metrics = {}
        for k in KEYS:
            v, p = now[k], (before or {}).get(k)
            metrics[k] = {"value": v, "delta": (v - p) if v is not None and p is not None else None}
        stamps = [a.finished_at for a in (_of(onpage, 0), _of(technical, 0)) if a and a.finished_at]
        rows.append({"id": b.id, "name": b.name, "domain": re.sub(r"^https?://(www\.)?|/.*$", "", b.website or "") or None, "website": b.website,
                     "market": market.summary(b), "last_update": max(stamps).isoformat() if stamps else None, "pages_crawled": now["pages_crawled"], "audits": len(onpage) + len(technical), "metrics": metrics})
    rows.sort(key=lambda r: r["last_update"] or "", reverse=True)
    return rows
