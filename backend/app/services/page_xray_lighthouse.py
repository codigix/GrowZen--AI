"""Full page weight and colour contrast for Page X-Ray, from a real Lighthouse run (Google PageSpeed Insights).

The X-Ray itself reads the HTML document. Lighthouse loads the whole page in Chrome, so it knows what the HTML cannot say: every image, script,
style and font that was downloaded (total weight, requests, third-party share, the heaviest files) and, because it renders the page, the colour
contrast of the visible text. Nothing here is estimated: every number is read from the Lighthouse result.
"""
import re
from typing import Any

from . import pagespeed

_RATIO = re.compile(r"contrast of ([\d.]+) \(foreground color: (#[0-9a-fA-F]{3,8}), background color: (#[0-9a-fA-F]{3,8}), font size: ([^,]+), font weight: (\w+)\)\. Expected contrast ratio of ([\d.]+):1")
TYPES = {"document": "HTML", "script": "JavaScript", "stylesheet": "CSS", "image": "Images", "font": "Fonts", "media": "Media", "other": "Other", "third-party": "Third-party"}
SAVINGS = {"uses-text-compression": "Compress text files", "uses-optimized-images": "Optimise images", "modern-image-formats": "Serve images in modern formats", "uses-responsive-images": "Right-size images",
           "unused-javascript": "Remove unused JavaScript", "unused-css-rules": "Remove unused CSS", "total-byte-weight": None}


def _kb(n: Any) -> float:
    return round(float(n or 0) / 1024, 1)


def _contrast_items(audit: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for it in (audit.get("details") or {}).get("items", []):
        node = it.get("node") or {}
        text = node.get("explanation") or ""
        m = _RATIO.search(text)
        out.append({"selector": node.get("selector") or node.get("nodeLabel"), "snippet": (node.get("snippet") or "")[:200], "label": node.get("nodeLabel"),
                    "ratio": float(m.group(1)) if m else None, "fg": m.group(2).lower() if m else None, "bg": m.group(3).lower() if m else None,
                    "font_size": m.group(4).strip() if m else None, "font_weight": m.group(5) if m else None, "expected": float(m.group(6)) if m else None})
    return out


def extract(data: dict[str, Any], strategy: str) -> dict[str, Any]:
    """The weight and contrast facts of a PageSpeed Insights response (`lighthouseResult`)."""
    lh = data["lighthouseResult"]
    audits = lh.get("audits", {})
    cats = lh.get("categories", {})
    notes: list[str] = []

    # --- weight
    summary = {i.get("resourceType"): i for i in (audits.get("resource-summary", {}).get("details") or {}).get("items", [])}
    total = summary.get("total") or {}
    byte_weight = audits.get("total-byte-weight") or {}
    total_bytes = int(byte_weight.get("numericValue") or total.get("transferSize") or 0)
    by_type = [{"type": TYPES.get(k, k), "key": k, "requests": int(v.get("requestCount") or 0), "kb": _kb(v.get("transferSize"))}
               for k, v in summary.items() if k not in ("total", "third-party")]
    by_type.sort(key=lambda r: -r["kb"])
    third = summary.get("third-party") or {}
    heaviest = [{"url": i.get("url"), "kb": _kb(i.get("totalBytes"))} for i in (byte_weight.get("details") or {}).get("items", [])[:8]]
    savings = []
    for key, title in SAVINGS.items():
        a = audits.get(key) or {}
        b = (a.get("details") or {}).get("overallSavingsBytes")
        if title and b and b > 2048:
            savings.append({"id": key, "title": title, "kb": _kb(b)})
    savings.sort(key=lambda r: -r["kb"])
    if not summary:
        notes.append("Lighthouse did not report a resource summary for this page.")

    # --- contrast
    cc = audits.get("color-contrast") or {}
    mode = cc.get("scoreDisplayMode")
    checked = bool(cc) and mode not in ("notApplicable", "manual", "error", "informative")
    items = _contrast_items(cc) if checked else []
    contrast = {"checked": checked, "passed": (cc.get("score") == 1) if checked else None, "score": cc.get("score") if checked else None,
                "failing_count": len(items), "failing": items[:25]}
    if not checked:
        notes.append("Lighthouse could not test colour contrast on this page (no visible text found, or the test did not run).")
    elif len(items) > 25:
        notes.append(f"{len(items)} elements fail the contrast test; the first 25 are listed.")

    m = {k: (audits.get(v) or {}).get("displayValue") for k, v in {"lcp": "largest-contentful-paint", "fcp": "first-contentful-paint", "tbt": "total-blocking-time", "cls": "cumulative-layout-shift"}.items()}
    pct = lambda c: round(c["score"] * 100) if isinstance(c.get("score"), (int, float)) else None  # noqa: E731
    return {
        "url": lh.get("requestedUrl") or lh.get("finalUrl"), "final_url": lh.get("finalDisplayedUrl") or lh.get("finalUrl"), "strategy": strategy, "fetched_at": lh.get("fetchTime"), "source": "pagespeed",
        "weight": {"total_bytes": total_bytes, "total_kb": _kb(total_bytes), "requests": int(total.get("requestCount") or 0), "by_type": by_type,
                   "third_party": {"requests": int(third.get("requestCount") or 0), "kb": _kb(third.get("transferSize"))}, "heaviest": heaviest, "savings": savings[:6]},
        "contrast": contrast,
        "accessibility_score": pct(cats.get("accessibility", {})), "performance_score": pct(cats.get("performance", {})), "metrics": m, "notes": notes,
    }


def measure(url: str, strategy: str = "mobile") -> dict[str, Any]:
    """Run Lighthouse through PageSpeed Insights for `url` and return the weight and contrast facts. Raises pagespeed.PageSpeedError on failure."""
    return extract(pagespeed.fetch(url, strategy, timeout=100), strategy)
