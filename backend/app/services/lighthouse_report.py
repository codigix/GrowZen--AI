"""Lighthouse reports (from PageSpeed Insights or the local CLI) in one stable shape, plus a
readable summary HTML for runs that have no original Lighthouse HTML (PageSpeed returns none)."""
import html as html_lib
from typing import Any

CATEGORY_IDS = ["performance", "accessibility", "best-practices", "seo"]

METRIC_AUDIT_IDS = [
    "first-contentful-paint",
    "largest-contentful-paint",
    "speed-index",
    "total-blocking-time",
    "cumulative-layout-shift",
    "interactive",
    "server-response-time",
    "max-potential-fid",
]

MAX_ITEMS_PER_AUDIT = 15

_CRUX_METRIC_MAP = {
    "FIRST_CONTENTFUL_PAINT_MS": "first-contentful-paint",
    "LARGEST_CONTENTFUL_PAINT_MS": "largest-contentful-paint",
    "CUMULATIVE_LAYOUT_SHIFT_SCORE": "cumulative-layout-shift",
    "INTERACTION_TO_NEXT_PAINT": "interaction-to-next-paint",
    "FIRST_INPUT_DELAY_MS": "first-input-delay",
    "EXPERIMENTAL_TIME_TO_FIRST_BYTE": "server-response-time",
}


def _score_to_100(score: float | None) -> float | None:
    if score is None:
        return None
    return round(score * 100)


def _classify_audit(audit: dict, group: str | None) -> str:
    mode = audit.get("scoreDisplayMode")
    details_type = (audit.get("details") or {}).get("type")

    if mode == "notApplicable":
        return "skip"
    if mode == "manual":
        return "manual"
    if mode in ("informative", "error"):
        return "informational"
    if details_type == "opportunity" or group == "load-opportunities":
        return "opportunities"
    if group == "diagnostics" and mode in ("numeric", "binary") and audit.get("score") != 1:
        return "diagnostics"

    score = audit.get("score")
    if score is None:
        return "informational"
    if score == 1:
        return "passed"
    return "failed"


def _extract_savings(audit: dict) -> dict[str, Any]:
    details = audit.get("details") or {}
    savings: dict[str, Any] = {}
    if "overallSavingsMs" in details:
        savings["savings_ms"] = details["overallSavingsMs"]
    if "overallSavingsBytes" in details:
        savings["savings_bytes"] = details["overallSavingsBytes"]
    return savings


def _extract_items(audit: dict) -> list[dict]:
    details = audit.get("details") or {}
    items = details.get("items")
    if not isinstance(items, list):
        return []
    return items[:MAX_ITEMS_PER_AUDIT]


def _summarize_audit(audit_id: str, audit: dict) -> dict:
    return {
        "id": audit_id,
        "title": audit.get("title"),
        "description": audit.get("description"),
        "score": audit.get("score"),
        "score_display_mode": audit.get("scoreDisplayMode"),
        "display_value": audit.get("displayValue"),
        **_extract_savings(audit),
        "items": _extract_items(audit),
        "item_count": len(((audit.get("details") or {}).get("items")) or []),
    }


def normalize_report(raw: dict, field_data: dict | None = None, origin_field_data: dict | None = None) -> dict:
    """Convert a raw Lighthouse result (CLI JSON or PSI ``lighthouseResult``)
    into the normalized structure used throughout the app."""
    categories_raw = raw.get("categories") or {}
    audits_raw = raw.get("audits") or {}

    categories: dict[str, dict] = {}
    audits_by_category: dict[str, dict[str, list]] = {}
    metrics: dict[str, dict] = {}

    for cat_id in CATEGORY_IDS:
        cat = categories_raw.get(cat_id)
        if cat is None:
            categories[cat_id] = {"id": cat_id, "title": cat_id.replace("-", " ").title(), "score": None}
            continue

        categories[cat_id] = {
            "id": cat_id,
            "title": cat.get("title", cat_id),
            "score": _score_to_100(cat.get("score")),
        }

        buckets: dict[str, list] = {
            "opportunities": [],
            "diagnostics": [],
            "failed": [],
            "passed": [],
            "manual": [],
            "informational": [],
        }

        group_by_audit_id = {
            ref["id"]: ref.get("group") for ref in (cat.get("auditRefs") or []) if "id" in ref
        }

        for ref in cat.get("auditRefs") or []:
            audit_id = ref.get("id")
            audit = audits_raw.get(audit_id)
            if audit is None:
                continue
            bucket = _classify_audit(audit, group_by_audit_id.get(audit_id))
            if bucket == "skip":
                continue
            buckets[bucket].append(_summarize_audit(audit_id, audit))

        audits_by_category[cat_id] = buckets

    for metric_id in METRIC_AUDIT_IDS:
        audit = audits_raw.get(metric_id)
        if audit is None:
            continue
        metrics[metric_id] = {
            "title": audit.get("title"),
            "display_value": audit.get("displayValue"),
            "numeric_value": audit.get("numericValue"),
            "numeric_unit": audit.get("numericUnit"),
            "score": audit.get("score"),
        }

    field_summary = _normalize_field_data(field_data) if field_data else None
    origin_summary = _normalize_field_data(origin_field_data) if origin_field_data else None

    return {
        "lighthouse_version": raw.get("lighthouseVersion"),
        "requested_url": raw.get("requestedUrl"),
        "final_url": raw.get("finalDisplayedUrl") or raw.get("finalUrl"),
        "fetch_time": raw.get("fetchTime"),
        "user_agent": raw.get("userAgent"),
        "categories": categories,
        "metrics": metrics,
        "audits_by_category": audits_by_category,
        "field_data": field_summary,
        "origin_field_data": origin_summary,
        "runtime_error": (raw.get("runtimeError") or {}).get("message"),
    }


def _normalize_field_data(crux: dict) -> dict:
    out = {"overall_category": crux.get("overall_category"), "metrics": {}}
    for crux_key, metric_id in _CRUX_METRIC_MAP.items():
        metric = (crux.get("metrics") or {}).get(crux_key)
        if not metric:
            continue
        out["metrics"][metric_id] = {
            "category": metric.get("category"),
            "percentile": metric.get("percentile"),
        }
    return out


def extract_scores(normalized: dict) -> dict[str, float | None]:
    cats = normalized.get("categories", {})
    return {
        "performance": (cats.get("performance") or {}).get("score"),
        "accessibility": (cats.get("accessibility") or {}).get("score"),
        "best_practices": (cats.get("best-practices") or {}).get("score"),
        "seo": (cats.get("seo") or {}).get("score"),
    }


def render_summary_html(normalized: dict, audit_meta: dict) -> str:
    """Render a clearly-labeled, human-readable *summary* HTML report built
    from normalized data. This is NOT the original Lighthouse-generated HTML
    report and is always labeled as such.
    """
    scores = extract_scores(normalized)

    def score_cell(label: str, value: float | None) -> str:
        display = "N/A" if value is None else f"{value:.0f}"
        color = "#999"
        if value is not None:
            color = "#0cce6b" if value >= 90 else "#ffa400" if value >= 50 else "#ff4e42"
        return (
            f'<div class="score"><div class="score-circle" style="border-color:{color};'
            f'color:{color}">{display}</div><div class="score-label">{html_lib.escape(label)}</div></div>'
        )

    def audit_row(a: dict) -> str:
        title = html_lib.escape(str(a.get("title") or a.get("id")))
        desc = html_lib.escape(str(a.get("description") or ""))
        display_value = a.get("display_value")
        suffix = f" &mdash; {html_lib.escape(str(display_value))}" if display_value else ""
        return f"<li><strong>{title}</strong>{suffix}<div class='desc'>{desc}</div></li>"

    def audit_list(title: str, items: list[dict]) -> str:
        if not items:
            return ""
        rows = "".join(audit_row(a) for a in items)
        return f"<h4>{html_lib.escape(title)}</h4><ul>{rows}</ul>"

    sections = []
    for cat_id, buckets in normalized.get("audits_by_category", {}).items():
        cat_title = normalized["categories"].get(cat_id, {}).get("title", cat_id)
        section = f"<section><h3>{html_lib.escape(cat_title)}</h3>"
        section += audit_list("Failed audits", buckets.get("failed", []))
        section += audit_list("Opportunities", buckets.get("opportunities", []))
        section += audit_list("Diagnostics", buckets.get("diagnostics", []))
        section += audit_list("Passed audits", buckets.get("passed", []))
        section += audit_list("Manual checks", buckets.get("manual", []))
        section += "</section>"
        sections.append(section)

    metrics_rows = "".join(
        f"<tr><td>{html_lib.escape(str(m.get('title') or mid))}</td>"
        f"<td>{html_lib.escape(str(m.get('display_value') or 'N/A'))}</td></tr>"
        for mid, m in normalized.get("metrics", {}).items()
    )

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Audit Summary Report (non-original) - {html_lib.escape(audit_meta.get('url', ''))}</title>
<style>
body {{ font-family: "Roboto", sans-serif; margin: 2rem; color: #222; background:#fafafa; }}
.banner {{ background:#fff3cd; border:1px solid #ffe69c; padding: .75rem 1rem; border-radius: 6px; margin-bottom:1.5rem; }}
.scores {{ display:flex; gap:2rem; margin-bottom:2rem; }}
.score-circle {{ width:72px;height:72px;border-radius:50%;border:4px solid; display:flex;align-items:center;justify-content:center;font-size:1.4rem;font-weight:bold; }}
.score-label {{ text-align:center;margin-top:.5rem;font-size:.85rem; }}
section {{ margin-bottom:2rem; }}
ul {{ list-style:none;padding:0; }}
li {{ padding:.5rem 0;border-bottom:1px solid #eee; }}
.desc {{ color:#666;font-size:.85rem;margin-top:.25rem; }}
table {{ border-collapse:collapse;width:100%; max-width:500px; }}
td {{ padding:.4rem .6rem;border-bottom:1px solid #eee; }}
</style>
</head>
<body>
<div class="banner"><strong>This is a generated summary report</strong>, not the original Lighthouse-generated HTML report. It is built from normalized audit data for readability.</div>
<h1>Audit Summary: {html_lib.escape(audit_meta.get('url', ''))}</h1>
<p>Strategy: {html_lib.escape(audit_meta.get('strategy', ''))} &nbsp;|&nbsp; Engine: {html_lib.escape(audit_meta.get('engine', ''))} &nbsp;|&nbsp; Generated: {html_lib.escape(str(audit_meta.get('completed_at', '')))}</p>
<div class="scores">
{score_cell('Performance', scores['performance'])}
{score_cell('Accessibility', scores['accessibility'])}
{score_cell('Best Practices', scores['best_practices'])}
{score_cell('SEO', scores['seo'])}
</div>
<h2>Performance metrics (lab data)</h2>
<table>{metrics_rows}</table>
<h2>Detailed findings</h2>
{''.join(sections)}
</body>
</html>"""
