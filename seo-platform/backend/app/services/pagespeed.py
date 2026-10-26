"""Google PageSpeed Insights (Lighthouse): SEO, performance, accessibility, best practices."""
import re
from typing import Any

import httpx

from ..config import get_settings

PSI = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"


class PageSpeedError(RuntimeError):
    pass


def _plain(md: str) -> str:
    return re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", md or "").replace("`", "")


def _pct(score: float | None) -> int | None:
    return None if score is None else round(score * 100)


def normalise(d: dict[str, Any], strategy: str) -> dict[str, Any]:
    lh = d["lighthouseResult"]
    audits = lh["audits"]
    checks = []
    for ref in lh["categories"]["seo"]["auditRefs"]:
        a = audits.get(ref["id"], {})
        mode = a.get("scoreDisplayMode")
        st = "na" if mode == "notApplicable" else "manual" if mode == "manual" else "pass" if a.get("score") == 1 else "na" if a.get("score") is None else "fail"
        checks.append({"id": ref["id"], "title": a.get("title"), "description": _plain(a.get("description", "")), "status": st, "display_value": a.get("displayValue", "")})
    opportunities = sorted(
        (a for a in audits.values() if (a.get("details") or {}).get("type") == "opportunity" and a.get("score") is not None and a["score"] < 0.9 and (a["details"].get("overallSavingsMs") or 0) > 0),
        key=lambda a: a["details"].get("overallSavingsMs", 0), reverse=True)[:6]
    field = (d.get("loadingExperience") or {}).get("metrics", {})
    return {
        "url": lh.get("finalDisplayedUrl") or lh.get("finalUrl"),
        "strategy": strategy,
        "fetched_at": lh.get("fetchTime"),
        "scores": {"seo": _pct(lh["categories"].get("seo", {}).get("score")), "performance": _pct(lh["categories"].get("performance", {}).get("score")),
                   "accessibility": _pct(lh["categories"].get("accessibility", {}).get("score")), "best_practices": _pct(lh["categories"].get("best-practices", {}).get("score"))},
        "seo_checks": checks,
        "metrics": {k: (audits.get(v) or {}).get("displayValue") for k, v in {"lcp": "largest-contentful-paint", "fcp": "first-contentful-paint", "cls": "cumulative-layout-shift", "tbt": "total-blocking-time", "si": "speed-index"}.items()},
        "field": {k: field.get(v, {}).get("category") for k, v in {"lcp": "LARGEST_CONTENTFUL_PAINT_MS", "inp": "INTERACTION_TO_NEXT_PAINT", "cls": "CUMULATIVE_LAYOUT_SHIFT_SCORE"}.items()},
        "opportunities": [{"title": a.get("title"), "savings_ms": round(a["details"].get("overallSavingsMs", 0)), "description": _plain(a.get("description", ""))} for a in opportunities],
    }


def run(url: str, strategy: str = "mobile") -> dict[str, Any]:
    params: list[tuple[str, str]] = [("url", url), ("strategy", strategy)] + [("category", c) for c in ("SEO", "PERFORMANCE", "ACCESSIBILITY", "BEST_PRACTICES")]
    key = get_settings().pagespeed_api_key
    if key:
        params.append(("key", key))
    try:
        r = httpx.get(PSI, params=params, timeout=90)
    except httpx.HTTPError as exc:
        raise PageSpeedError(f"Could not reach PageSpeed Insights: {exc}") from exc
    data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    if r.status_code != 200:
        msg = (data.get("error") or {}).get("message") or f"HTTP {r.status_code}"
        if r.status_code == 429 or "quota" in msg.lower():
            raise PageSpeedError("PageSpeed quota used up: set PAGESPEED_API_KEY (free, 25,000/day).")
        raise PageSpeedError(msg)
    return normalise(data, strategy)


def issues_from(result: dict[str, Any]) -> list[dict[str, Any]]:
    out = [{"area": "Technical", "level": "serious", "title": c["title"], "fix": c["description"]} for c in result["seo_checks"] if c["status"] == "fail"]
    perf = result["scores"].get("performance")
    if perf is not None and perf < 50:
        out.append({"area": "Speed", "level": "serious", "title": f"Mobile performance {perf}/100 (LCP {result['metrics'].get('lcp')})", "fix": "; ".join(o["title"] for o in result["opportunities"][:3])})
    return out
