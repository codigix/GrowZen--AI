"""Compare one of our own website audits against a competitor's audit.

Both sides come from the same underlying scan (`audits.website_audit`: a PageSpeed Insights run
plus a short crawl -- see services/audits.py), so the shapes line up already. This module never
re-runs an audit; it only reads audits already stored and reasons about the two reports:

- overall scores + Core Web Vitals (services/pagespeed.py's `normalise` output)
- the Lighthouse SEO audit checks (pass/fail per check, matched by id)
- on-page content, matched by page path (services/crawler.py's `crawl` output)
- keyword/content gaps: on-page keyword phrases extracted straight from each crawl's pages
  (services/crawler.py's `extract_keywords`, no external API needed), plus actual Google-search
  keyword rankings when a competitor-research run exists for the business (competitors/intel.py).
  Each of the two is marked unavailable on its own when its data isn't there yet.

Nothing here invents a score or a keyword: a side that has no data for a metric gets
`available: false` and a null value/difference, never a guessed one.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Audit, Business, Competitor

SCORE_METRICS = [
    ("performance", "Performance score"),
    ("seo", "SEO score"),
    ("accessibility", "Accessibility score"),
    ("best_practices", "Best Practices score"),
]
# (key, label, unit, direction) -- direction is "higher" (more is better) or "lower" (less is better).
VITAL_METRICS = [
    ("lcp", "Largest Contentful Paint", "ms", "lower"),
    ("fcp", "First Contentful Paint", "ms", "lower"),
    ("cls", "Cumulative Layout Shift", "", "lower"),
    ("tbt", "Total Blocking Time (lab)", "ms", "lower"),
    ("si", "Speed Index", "ms", "lower"),
]
CHECK_STATUS_UNAVAILABLE = {"na", "manual"}


class CompareError(RuntimeError):
    pass


@dataclass
class ResolvedAudit:
    audit_id: int
    kind: str
    business_id: int | None
    competitor_id: int | None
    target: str | None
    strategy: str | None
    status: str
    finished_at: Any
    payload: dict[str, Any]  # {"pagespeed": {...} | None, "crawl": {...} | None}


def _metric_value(raw: Any) -> float | None:
    """"4.1 s" -> 4100.0 (ms), "640 ms" -> 640.0, "0.05" -> 0.05 (unitless, e.g. CLS). None/'' -> None."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    m = re.match(r"^\s*([\d.]+)\s*(ms|s)?\s*$", str(raw), re.I)
    if not m:
        return None
    value = float(m.group(1))
    return value * 1000 if (m.group(2) or "").lower() == "s" else value


def _audit_payload(audit: Audit) -> dict[str, Any]:
    """Normalise an Audit row to {"pagespeed": ..., "crawl": ...}, whichever kind it is."""
    if audit.kind in ("website", "competitor"):
        return audit.result or {}
    if audit.kind == "technical":
        return {"pagespeed": audit.result or None}
    if audit.kind == "onpage":
        crawl = dict(audit.result or {})
        crawl["score"] = audit.score
        return {"crawl": crawl}
    return audit.result or {}


def _resolve(audit: Audit, competitor_id: int | None = None) -> ResolvedAudit:
    payload = _audit_payload(audit)
    strategy = (payload.get("pagespeed") or {}).get("strategy")
    return ResolvedAudit(audit_id=audit.id, kind=audit.kind, business_id=audit.business_id, competitor_id=competitor_id or audit.competitor_id,
                          target=audit.target, strategy=strategy, status=audit.status, finished_at=audit.finished_at, payload=payload)


def resolve_our_side(db: Session, *, audit_id: int | None = None, business_id: int | None = None, strategy: str | None = None) -> ResolvedAudit:
    if audit_id is not None:
        audit = db.get(Audit, audit_id)
        if not audit or audit.kind not in ("website", "technical", "onpage"):
            raise CompareError(f"No website/technical/on-page audit found with id {audit_id}")
        if audit.status != "done":
            raise CompareError(f"Audit {audit_id} is {audit.status}, not done yet")
        resolved = _resolve(audit)
        if audit.kind in ("technical", "onpage") and audit.business_id:
            # These are saved in pairs by record_for_business(); bring in the sibling so both
            # pagespeed and crawl data are available, same as a "website" audit would have.
            other_kind = "onpage" if audit.kind == "technical" else "technical"
            sibling = db.scalar(select(Audit).where(Audit.business_id == audit.business_id, Audit.kind == other_kind, Audit.status == "done",
                                                     Audit.target == audit.target).order_by(Audit.finished_at.desc()))
            if sibling:
                resolved.payload = {**_audit_payload(sibling), **resolved.payload} if audit.kind == "technical" else {**resolved.payload, **_audit_payload(sibling)}
        return resolved

    if business_id is None:
        raise CompareError("Pass either our_audit_id or business_id")
    b = db.get(Business, business_id)
    if not b:
        raise CompareError(f"Business {business_id} not found")
    q = select(Audit).where(Audit.business_id == business_id, Audit.kind == "website", Audit.status == "done").order_by(Audit.finished_at.desc())
    web_audit = next((a for a in db.scalars(q) if not strategy or ((a.result or {}).get("pagespeed") or {}).get("strategy") == strategy), None)
    if web_audit:
        return _resolve(web_audit)
    # Fall back to the technical + on-page audits recorded for the business's own site.
    tech = db.scalar(select(Audit).where(Audit.business_id == business_id, Audit.kind == "technical", Audit.status == "done").order_by(Audit.finished_at.desc()))
    onpage = db.scalar(select(Audit).where(Audit.business_id == business_id, Audit.kind == "onpage", Audit.status == "done").order_by(Audit.finished_at.desc()))
    if not tech and not onpage:
        raise CompareError(f"Business {business_id} has no finished website audit yet (run a website audit or a full audit first)")
    base = tech or onpage
    payload = {**_audit_payload(tech or Audit(kind="technical")), **_audit_payload(onpage or Audit(kind="onpage"))}
    return ResolvedAudit(audit_id=base.id, kind="technical+onpage", business_id=business_id, competitor_id=None,
                          target=base.target, strategy=(payload.get("pagespeed") or {}).get("strategy"), status="done", finished_at=base.finished_at, payload=payload)


def resolve_competitor_side(db: Session, *, audit_id: int | None = None, competitor_id: int | None = None, business_id: int | None = None,
                             strategy: str | None = None) -> ResolvedAudit:
    if audit_id is not None:
        audit = db.get(Audit, audit_id)
        if not audit or audit.kind != "competitor":
            raise CompareError(f"No competitor audit found with id {audit_id}")
        if audit.status != "done":
            raise CompareError(f"Competitor audit {audit_id} is {audit.status}, not done yet")
        return _resolve(audit)

    if competitor_id is None:
        raise CompareError("Pass either a competitor audit id or a competitor_id")
    comp = db.get(Competitor, competitor_id)
    if not comp or (business_id is not None and comp.business_id != business_id):
        raise CompareError(f"Competitor {competitor_id} not found" + (f" for business {business_id}" if business_id else ""))
    q = select(Audit).where(Audit.kind == "competitor", Audit.competitor_id == competitor_id, Audit.status == "done").order_by(Audit.finished_at.desc())
    audit = next((a for a in db.scalars(q) if not strategy or ((a.result or {}).get("pagespeed") or {}).get("strategy") == strategy), None)
    if not audit:
        raise CompareError(f"Competitor {comp.name} ({comp.website}) has no finished audit yet; start one with POST /audit/competitors")
    return _resolve(audit, competitor_id=competitor_id)


def _score_comparison(ours: dict[str, Any], theirs: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for key, label in SCORE_METRICS:
        ov, tv = (ours.get("scores") or {}).get(key), (theirs.get("scores") or {}).get(key)
        out.append(_metric_row(key, label, "score", "higher", ov, tv, ov, tv))
    return out


def _vitals_comparison(ours: dict[str, Any], theirs: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for key, label, unit, direction in VITAL_METRICS:
        ov_raw, tv_raw = (ours.get("metrics") or {}).get(key), (theirs.get("metrics") or {}).get(key)
        out.append(_metric_row(key, label, unit, direction, _metric_value(ov_raw), _metric_value(tv_raw), ov_raw, tv_raw))
    return out


def _field_comparison(ours: dict[str, Any], theirs: dict[str, Any]) -> list[dict[str, Any]]:
    """CrUX field data (real-user), including INP -- categorical ("FAST"/"AVERAGE"/"SLOW"), not a
    number, and never conflated with lab TBT."""
    out = []
    for key, label in (("lcp", "Largest Contentful Paint (field)"), ("inp", "Interaction to Next Paint (field)"), ("cls", "Cumulative Layout Shift (field)")):
        ov, tv = (ours.get("field") or {}).get(key), (theirs.get("field") or {}).get(key)
        out.append({"key": f"field_{key}", "label": label, "unit": "category", "direction": "not_comparable", "ours": ov, "competitor": tv,
                    "difference": None, "better": None, "available": bool(ov or tv), "both_available": bool(ov and tv)})
    return out


def _metric_row(key: str, label: str, unit: str, direction: str, ours_num: float | None, theirs_num: float | None, ours_raw: Any, theirs_raw: Any) -> dict[str, Any]:
    available = ours_num is not None and theirs_num is not None
    diff = None
    better = "unavailable"
    if available:
        diff = round(ours_num - theirs_num, 4) if direction == "higher" else round(theirs_num - ours_num, 4)
        better = "ours" if diff > 0 else "competitor" if diff < 0 else "tie"
    return {
        "key": key, "label": label, "unit": unit, "direction": f"{direction}_is_better",
        "ours": ours_num, "competitor": theirs_num, "ours_display": ours_raw, "competitor_display": theirs_raw,
        "difference": diff, "better": better, "available": available,
        "ours_available": ours_num is not None, "competitor_available": theirs_num is not None,
    }


def _classify_check(ours: dict[str, Any] | None, theirs: dict[str, Any] | None) -> str:
    os_, ts_ = (ours or {}).get("status"), (theirs or {}).get("status")
    if ours is None or theirs is None:
        return "incomparable"
    if os_ in CHECK_STATUS_UNAVAILABLE or ts_ in CHECK_STATUS_UNAVAILABLE:
        return "both_unavailable" if os_ in CHECK_STATUS_UNAVAILABLE and ts_ in CHECK_STATUS_UNAVAILABLE else "incomparable"
    if os_ == "pass" and ts_ == "pass":
        return "both_pass"
    if os_ == "fail" and ts_ == "fail":
        return "both_fail"
    if os_ == "fail" and ts_ == "pass":
        return "ours_fail_competitor_pass"
    if os_ == "pass" and ts_ == "fail":
        return "ours_pass_competitor_fail"
    return "incomparable"


def _technical_seo_comparison(ours: dict[str, Any], theirs: dict[str, Any]) -> list[dict[str, Any]]:
    our_checks = {c["id"]: c for c in (ours.get("seo_checks") or [])}
    their_checks = {c["id"]: c for c in (theirs.get("seo_checks") or [])}
    out = []
    for check_id in sorted(set(our_checks) | set(their_checks)):
        oc, tc = our_checks.get(check_id), their_checks.get(check_id)
        base = oc or tc
        out.append({
            "id": check_id, "title": base.get("title"), "description": base.get("description"),
            "ours": oc and {"status": oc.get("status"), "display_value": oc.get("display_value")},
            "competitor": tc and {"status": tc.get("status"), "display_value": tc.get("display_value")},
            "status": _classify_check(oc, tc),
        })
    return out


def _path(url: str | None) -> str:
    if not url:
        return "/"
    p = urlparse(url).path or "/"
    return p.rstrip("/") or "/"


def _page_summary(p: dict[str, Any]) -> dict[str, Any]:
    return {"url": p.get("url"), "status": p.get("status"), "title": p.get("title"), "title_length": p.get("title_length"),
            "meta_description": p.get("meta_description"), "meta_description_length": p.get("meta_description_length"),
            "h1": p.get("h1"), "h1_count": p.get("h1_count"), "word_count": p.get("word_count"),
            "images": p.get("images"), "images_missing_alt": p.get("images_missing_alt"), "schema_types": p.get("schema_types") or []}


def _page_comparison(ours: dict[str, Any], theirs: dict[str, Any]) -> dict[str, Any]:
    our_pages = {_path(p.get("url")): p for p in (ours.get("pages") or [])}
    their_pages = {_path(p.get("url")): p for p in (theirs.get("pages") or [])}
    matched = []
    for path in sorted(set(our_pages) & set(their_pages)):
        op, tp = our_pages[path], their_pages[path]
        matched.append({
            "path": path, "ours": _page_summary(op), "competitor": _page_summary(tp),
            "word_count_difference": (op.get("word_count") or 0) - (tp.get("word_count") or 0) if op.get("word_count") is not None and tp.get("word_count") is not None else None,
        })
    return {
        "available": True,
        "matched": matched,
        "unmatched_ours": [_page_summary(our_pages[p]) for p in sorted(set(our_pages) - set(their_pages))],
        "unmatched_competitor": [_page_summary(their_pages[p]) for p in sorted(set(their_pages) - set(our_pages))],
        "ours_crawled": len(our_pages), "competitor_crawled": len(their_pages),
        "note": "Only the pages each crawl actually visited are compared, matched by URL path -- not every page on either site.",
    }


def _aggregate_page_keywords(crawl: dict[str, Any], top_n: int = 30) -> list[dict[str, Any]] | None:
    """Site-wide keyword counts from every crawled page's `top_keywords` (services/crawler.py).
    None (not just []) means this crawl predates keyword extraction -- distinguish "no data yet"
    from "crawled, but nothing repeats"."""
    pages = crawl.get("pages") or []
    if not pages or not any("top_keywords" in p for p in pages):
        return None
    totals: dict[str, int] = {}
    for p in pages:
        for row in p.get("top_keywords") or []:
            totals[row["keyword"]] = totals.get(row["keyword"], 0) + row["count"]
    return [{"keyword": k, "count": c} for k, c in sorted(totals.items(), key=lambda kv: -kv[1])[:top_n]]


def _onpage_keyword_comparison(our_crawl: dict[str, Any], their_crawl: dict[str, Any]) -> dict[str, Any]:
    """Keyword gaps derived straight from each site's own crawled content (title, headings, alt
    text, body copy) -- no external API or quota needed, unlike the Serper-based search keywords
    below, so this works for every audit pair as soon as both have been crawled."""
    ours, theirs = _aggregate_page_keywords(our_crawl), _aggregate_page_keywords(their_crawl)
    if ours is None or theirs is None:
        missing = [label for label, v in (("our", ours), ("the competitor's", theirs)) if v is None]
        return {"available": False, "reason": f"No on-page keyword data on {' and '.join(missing)} audit yet -- re-run it to extract keywords from the crawled pages."}
    our_set, their_set = {r["keyword"] for r in ours}, {r["keyword"] for r in theirs}
    return {
        "available": True, "source": "on-page content (crawled titles, headings, alt text and body copy)",
        "ours_top_keywords": ours, "competitor_top_keywords": theirs,
        "shared_keywords": sorted(our_set & their_set),
        "ours_only_keywords": sorted(our_set - their_set),
        "competitor_only_keywords": sorted(their_set - our_set),  # the gap: what they emphasise that we don't
    }


def _search_keyword_gap(db: Session, business_id: int | None, competitor_target: str | None) -> dict[str, Any]:
    """Actual Google-search keyword rankings and gaps come from the competitor-research run
    (competitors/intel.py, Serper-backed), not from PageSpeed or a crawl. Without a finished run,
    this is explicitly unavailable -- never guessed."""
    if business_id is None:
        return {"available": False, "reason": "No business_id given, so there is no competitor-research run to read keyword data from.",
                "required_source": "Pass business_id, with a completed POST /businesses/{id}/competitor-research run."}
    run = db.scalar(select(Audit).where(Audit.kind == "intel", Audit.target == f"business:{business_id}", Audit.status == "done").order_by(Audit.id.desc()))
    if not run:
        return {"available": False, "reason": "No completed competitor-research run for this business.",
                "required_source": "POST /businesses/{id}/competitor-research (needs SERPER_API_KEY)."}
    result = run.result or {}
    host = urlparse(competitor_target or "").hostname or ""
    host = host.removeprefix("www.")
    gaps = [g for g in (result.get("gaps") or {}).get("keywords", []) if any(c.get("domain") == host for c in g.get("competitors", []))] if host else []
    competitor_keywords = (result.get("ideas") or {}).get("competitor_keywords", [])
    return {
        "available": True, "source": "competitor-research (Serper)", "research_run_id": run.id, "analysed_at": result.get("analysed_at"),
        "keyword_gaps": gaps if host else (result.get("gaps") or {}).get("keywords", []),
        "competitor_target_keywords": competitor_keywords,
        "note": "From the business's competitor-research run, not this PageSpeed audit; may be stale relative to it." if not host else None,
    }


def _keyword_gap_comparison(db: Session, business_id: int | None, competitor_target: str | None, our_crawl: dict[str, Any], their_crawl: dict[str, Any]) -> dict[str, Any]:
    return {
        "on_page": _onpage_keyword_comparison(our_crawl, their_crawl),
        "search": _search_keyword_gap(db, business_id, competitor_target),
    }


def compare(db: Session, ours: ResolvedAudit, theirs: ResolvedAudit) -> dict[str, Any]:
    our_ps, their_ps = ours.payload.get("pagespeed") or {}, theirs.payload.get("pagespeed") or {}
    our_crawl, their_crawl = ours.payload.get("crawl") or {}, theirs.payload.get("crawl") or {}
    compatible = bool(ours.strategy) and bool(theirs.strategy) and ours.strategy == theirs.strategy
    competitor = db.get(Competitor, theirs.competitor_id) if theirs.competitor_id else None
    return {
        "ours": {"audit_id": ours.audit_id, "business_id": ours.business_id, "target": ours.target, "strategy": ours.strategy, "finished_at": ours.finished_at and ours.finished_at.isoformat()},
        "competitor": {"audit_id": theirs.audit_id, "competitor_id": theirs.competitor_id, "name": competitor.name if competitor else None,
                        "target": theirs.target, "strategy": theirs.strategy, "finished_at": theirs.finished_at and theirs.finished_at.isoformat()},
        "compatibility": {"compatible": compatible, "ours_strategy": ours.strategy, "competitor_strategy": theirs.strategy,
                          "note": None if compatible else "The two audits use different strategies (mobile vs desktop); scores and Core Web Vitals are not directly comparable."},
        "overall": {
            "scores": _score_comparison(our_ps, their_ps) if our_ps or their_ps else [],
            "core_web_vitals": _vitals_comparison(our_ps, their_ps) if our_ps or their_ps else [],
            "field_data": _field_comparison(our_ps, their_ps) if our_ps or their_ps else [],
            "available": bool(our_ps and their_ps),
        },
        "technical_seo": {
            "checks": _technical_seo_comparison(our_ps, their_ps) if our_ps or their_ps else [],
            "available": bool(our_ps and their_ps),
        },
        "pages": _page_comparison(our_crawl, their_crawl) if our_crawl or their_crawl else {"matched": [], "unmatched_ours": [], "unmatched_competitor": [], "available": False},
        "keywords_and_content_gaps": _keyword_gap_comparison(db, ours.business_id, theirs.target, our_crawl, their_crawl),
    }
