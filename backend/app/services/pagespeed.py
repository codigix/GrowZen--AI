"""Google PageSpeed Insights (Lighthouse): SEO, performance, accessibility, best practices."""
import logging
import re
from typing import Any

import httpx

from ..config import get_settings

log = logging.getLogger("seo.pagespeed")
PSI = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"


class PageSpeedError(RuntimeError):
    pass


class PageSpeedQuotaError(PageSpeedError):
    pass


class PageSpeedTimeoutError(PageSpeedError):
    pass


def _plain(md: str) -> str:
    return re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", md or "").replace("`", "")


def _pct(score: float | None) -> int | None:
    return None if score is None else round(score * 100)


# What slows the site, from Lighthouse's own audits: every opportunity, diagnostic and failed check of Performance and Best practices, with the files, sizes and times behind it.
KIND_OF = {
    "render-blocking-resources": "css_js", "unused-css-rules": "css_js", "unused-javascript": "css_js", "unminified-css": "css_js", "unminified-javascript": "css_js",
    "legacy-javascript": "css_js", "duplicated-javascript": "css_js", "bootup-time": "css_js", "mainthread-work-breakdown": "css_js", "long-tasks": "css_js",
    "total-byte-weight": "css_js", "dom-size": "css_js", "non-composited-animations": "css_js", "unsized-images": "layout", "layout-shifts": "layout", "layout-shift-elements": "layout",
    "uses-optimized-images": "images", "uses-responsive-images": "images", "uses-webp-images": "images", "modern-image-formats": "images", "offscreen-images": "images",
    "efficient-animated-content": "images", "lcp-lazy-loaded": "images", "prioritize-lcp-image": "images", "largest-contentful-paint-element": "images",
    "font-display": "fonts", "preload-fonts": "fonts", "server-response-time": "server", "redirects": "server", "uses-text-compression": "server", "uses-long-cache-ttl": "server",
    "uses-http2": "server", "uses-rel-preconnect": "network", "uses-rel-preload": "network", "critical-request-chains": "network", "network-requests": "network",
    "third-party-summary": "third_party", "third-party-facades": "third_party", "errors-in-console": "errors", "inspector-issues": "errors", "deprecations": "errors",
    "cache-insight": "server", "render-blocking-insight": "css_js", "image-delivery-insight": "images", "font-display-insight": "fonts", "forced-reflow-insight": "css_js",
    "document-latency-insight": "server", "dom-size-insight": "css_js", "third-parties-insight": "third_party", "legacy-javascript-insight": "css_js", "duplicated-javascript-insight": "css_js",
    "cls-culprits-insight": "layout", "lcp-discovery-insight": "images", "network-dependency-tree-insight": "network", "viewport-insight": "layout",
    "js-libraries": "errors", "valid-source-maps": "errors", "is-on-https": "errors", "image-aspect-ratio": "images", "image-size-responsive": "images",
}
KIND_TITLE = {"css_js": "CSS and JavaScript", "images": "Images", "fonts": "Fonts", "server": "Server and caching", "network": "Network requests", "third_party": "Third-party code",
              "layout": "Layout shifts", "errors": "Errors and warnings in the browser", "other": "Other"}
KEEP = ("url", "label", "groupLabel", "entity", "totalBytes", "wastedBytes", "wastedMs", "transferSize", "resourceSize", "duration", "total", "scripting", "scriptParseCompile", "cacheLifetimeMs",
        "description", "sourceLocation", "source", "node", "subItems", "blockingTime", "mainThreadTime", "cls", "value", "timing", "failureReason", "reason", "line", "column")
SKIP_IDS = {"final-screenshot", "screenshot-thumbnails", "full-page-screenshot", "script-treemap-data", "main-thread-tasks", "metrics", "diagnostics", "network-rtt", "network-server-latency", "performance-budget", "timing-budget", "resource-summary", "largest-contentful-paint", "first-contentful-paint", "speed-index", "total-blocking-time", "cumulative-layout-shift", "interactive", "user-timings", "screenshot", "lcp-breakdown-insight", "max-potential-fid", "network-dependency-tree-insight", "interaction-to-next-paint-insight"}


def _one(v: Any) -> Any:
    if isinstance(v, dict):
        return v.get("url") or v.get("snippet") or v.get("selector") or v.get("text") or v.get("value") or v.get("path")
    return v


def _rows(a: dict[str, Any], limit: int = 12) -> list[dict[str, Any]]:
    items = (a.get("details") or {}).get("items")
    if not isinstance(items, list):
        return []
    out = []
    for it in items[:limit]:
        if not isinstance(it, dict):
            continue
        row: dict[str, Any] = {}
        for k in KEEP:
            v = it.get(k)
            if v is None or isinstance(v, list):
                continue
            v = _one(v)
            if isinstance(v, (str, int, float, bool)) and v != "":
                row[k] = round(v, 1) if isinstance(v, float) else (str(v)[:260] if isinstance(v, str) else v)
        if row:
            out.append(row)
    return out


def speed_problems(lh: dict[str, Any]) -> list[dict[str, Any]]:
    """Everything Lighthouse says is slow or broken for performance, most costly first."""
    audits = lh.get("audits") or {}
    found = []
    for cat in ("performance", "best-practices"):
        for ref in (lh.get("categories", {}).get(cat) or {}).get("auditRefs") or []:
            aid = ref.get("id")
            a = audits.get(aid) or {}
            mode = a.get("scoreDisplayMode")
            if not a or aid in SKIP_IDS or mode in ("notApplicable", "manual", "informative", "error") and not (a.get("details") or {}).get("items"):
                continue
            d = a.get("details") or {}
            score = a.get("score")
            if score == 1 or (score is None and not d.get("items")):
                continue
            ms, by = d.get("overallSavingsMs"), d.get("overallSavingsBytes")
            if mode == "informative" and not (ms or by):
                continue  # purely informational numbers are not a problem
            if not d.get("items") and not (ms or by) and mode != "binary":
                continue  # nothing to point at: a name without a file, size or time helps nobody
            found.append({"id": aid, "category": cat, "kind": KIND_OF.get(aid) or ("errors" if cat == "best-practices" else "other"), "title": a.get("title"), "description": _plain(a.get("description", "")),
                          "display_value": a.get("displayValue") or "", "score": None if score is None else round(score * 100), "savings_ms": round(ms) if ms else None,
                          "savings_bytes": round(by) if by else None, "items": _rows(a), "item_count": len(d.get("items") or [])})
    found.sort(key=lambda x: (-(x["savings_ms"] or 0), x["score"] if x["score"] is not None else 100))
    return found


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
        "speed_problems": speed_problems(lh),
        "opportunities": [{"title": a.get("title"), "savings_ms": round(a["details"].get("overallSavingsMs", 0)), "description": _plain(a.get("description", ""))} for a in opportunities],
        # What Lighthouse's Chrome actually saw (base64 JPEG data URIs): the loaded page and how it filled in.
        "screenshot": ((audits.get("final-screenshot") or {}).get("details") or {}).get("data"),
        "filmstrip": [{"ms": f.get("timing"), "data": f.get("data")} for f in (((audits.get("screenshot-thumbnails") or {}).get("details") or {}).get("items") or [])][:8],
    }


def fetch(url: str, strategy: str = "mobile", timeout: float = 90, use_key: bool = True) -> dict[str, Any]:
    """The raw PSI response: a full `lighthouseResult` (same shape as the Lighthouse CLI's JSON)
    plus CrUX field data in `loadingExperience` / `originLoadingExperience`.
    The key goes in the query string, so httpx request logging is kept off (see main.py)."""
    params: list[tuple[str, str]] = [("url", url), ("strategy", strategy)] + [("category", c) for c in ("SEO", "PERFORMANCE", "ACCESSIBILITY", "BEST_PRACTICES")]
    key = get_settings().pagespeed_api_key if use_key else ""
    if key:
        params.append(("key", key))
    try:
        r = httpx.get(PSI, params=params, timeout=timeout)
    except httpx.TimeoutException as exc:
        raise PageSpeedTimeoutError(f"PageSpeed Insights timed out after {timeout:g}s") from exc
    except httpx.HTTPError as exc:
        raise PageSpeedError(f"Could not reach PageSpeed Insights: {exc}") from exc
    data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    if r.status_code != 200:
        err = data.get("error") or {}
        msg = err.get("message") or f"HTTP {r.status_code}"
        if key and r.status_code == 400 and "api key not valid" in msg.lower():
            # A wrong PAGESPEED_API_KEY shouldn't stop audits: PageSpeed also works without a key (lower daily quota).
            log.warning("PAGESPEED_API_KEY was rejected; retrying without it. Fix or remove the key in .env.")
            return fetch(url, strategy, timeout, use_key=False)
        if r.status_code == 429 or err.get("status") == "RESOURCE_EXHAUSTED" or "quota" in msg.lower():
            raise PageSpeedQuotaError(f"PageSpeed quota used up: set PAGESPEED_API_KEY (free, 25,000/day). ({msg})")
        raise PageSpeedError(f"PageSpeed Insights error ({r.status_code}): {msg}")
    if "lighthouseResult" not in data:
        raise PageSpeedError("PageSpeed Insights returned no Lighthouse result (the page may be unreachable or blocked the crawler)")
    return data


def run(url: str, strategy: str = "mobile") -> dict[str, Any]:
    return normalise(fetch(url, strategy), strategy)


def issues_from(result: dict[str, Any]) -> list[dict[str, Any]]:
    out = [{"code": f"lighthouse:{c['id']}", "area": "Technical", "level": "serious", "title": c["title"], "fix": c["description"]} for c in result["seo_checks"] if c["status"] == "fail"]
    for p in result.get("speed_problems") or []:
        files = "; ".join(str(i.get("url") or i.get("label") or i.get("node") or "") for i in p["items"][:3] if i.get("url") or i.get("label") or i.get("node"))
        lvl = "serious" if (p["score"] is not None and p["score"] < 50) or (p["savings_ms"] or 0) >= 1000 else "warning"
        out.append({"code": f"lighthouse:{p['id']}", "area": "Speed", "level": lvl, "title": p["title"] + (f" ({p['display_value']})" if p["display_value"] else ""),
                    "fix": p["description"] + (f" Files: {files}." if files else "")})
    perf = result["scores"].get("performance")
    if perf is not None and perf < 50:
        out.append({"code": "slow_mobile", "area": "Speed", "level": "serious", "title": f"Mobile performance {perf}/100 (LCP {result['metrics'].get('lcp')})", "fix": "; ".join(o["title"] for o in result["opportunities"][:3])})
    return out
