"""Render one HTML report for a competitor audit: the Lighthouse scores (home page) plus the
on-page SEO findings for every page the crawl actually visited (title, meta, H1, word count,
images, issues) -- so the frontend can show the whole site in one page instead of just one score."""
import html as html_lib
from typing import Any

from ..models import Audit, LighthouseAudit
from ..services.lighthouse_report import extract_scores

LEVEL_COLOR = {"critical": "#ff4e42", "serious": "#ff8a00", "warning": "#ffa400", "info": "#999"}


def _score_cell(label: str, value: float | None) -> str:
    display = "N/A" if value is None else f"{value:.0f}"
    color = "#999" if value is None else "#0cce6b" if value >= 90 else "#ffa400" if value >= 50 else "#ff4e42"
    return (f'<div class="score"><div class="score-circle" style="border-color:{color};color:{color}">{display}</div>'
            f'<div class="score-label">{html_lib.escape(label)}</div></div>')


def _page_section(p: dict[str, Any], index: int) -> str:
    issues = p.get("issues") or []
    issues_html = "".join(
        f'<li style="border-left:4px solid {LEVEL_COLOR.get(i.get("level"), "#999")}">'
        f'<strong>{html_lib.escape(str(i.get("level", "")).upper())}</strong> &mdash; {html_lib.escape(i.get("title", ""))}'
        f'<div class="desc">{html_lib.escape(i.get("fix", ""))}</div></li>'
        for i in issues
    ) or '<li class="ok">No issues found on this page.</li>'
    url = html_lib.escape(p.get("url") or "")
    return f"""
<section class="page">
  <h3>{index}. <a href="{url}" target="_blank" rel="noopener">{url}</a> <span class="status">HTTP {p.get('status')}</span></h3>
  <table>
    <tr><td>Title</td><td>{html_lib.escape(p.get('title') or '(missing)')} <small>({p.get('title_length', 0)} chars)</small></td></tr>
    <tr><td>Meta description</td><td>{html_lib.escape(p.get('meta_description') or '(missing)')} <small>({p.get('meta_description_length', 0)} chars)</small></td></tr>
    <tr><td>H1</td><td>{html_lib.escape(p.get('h1') or '(missing)')} <small>({p.get('h1_count', 0)} H1 tags)</small></td></tr>
    <tr><td>Word count</td><td>{p.get('word_count', 0)}</td></tr>
    <tr><td>Images</td><td>{p.get('images', 0)} total, {p.get('images_missing_alt', 0)} missing alt text</td></tr>
    <tr><td>Viewport tag</td><td>{'Yes' if p.get('has_viewport') else 'No'}</td></tr>
    <tr><td>Structured data</td><td>{html_lib.escape(', '.join(p.get('schema_types') or []) or 'None')}</td></tr>
  </table>
  <strong>Issues ({len(issues)})</strong>
  <ul>{issues_html}</ul>
</section>"""


def render_competitor_report(audit: Audit, lh: LighthouseAudit | None) -> str:
    crawl = (audit.result or {}).get("crawl") or {}
    pages = crawl.get("pages") or []
    scores = extract_scores(lh.report) if lh and lh.report else {"performance": None, "accessibility": None, "best_practices": None, "seo": None}
    pages_html = "".join(_page_section(p, i) for i, p in enumerate(pages, 1)) or "<p>No pages were crawled for this audit.</p>"

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Competitor Audit - {html_lib.escape(audit.target or '')}</title>
<style>
body {{ font-family: "Barlow", sans-serif;; margin: 2rem; color: #222; background:#fafafa; }}
.scores {{ display:flex; gap:2rem; margin-bottom:1.5rem; }}
.score-circle {{ width:72px;height:72px;border-radius:50%;border:4px solid; display:flex;align-items:center;justify-content:center;font-size:1.4rem;font-weight:bold; }}
.score-label {{ text-align:center;margin-top:.5rem;font-size:.85rem; }}
.summary {{ color:#555; margin-bottom:1.5rem; }}
section.page {{ background:#fff; border:1px solid #e5e5e5; border-radius:8px; padding:1rem 1.5rem; margin-bottom:1.5rem; }}
.status {{ color:#888; font-size:.85rem; font-weight:normal; }}
ul {{ list-style:none; padding:0; }}
li {{ padding:.5rem .75rem; border-bottom:1px solid #eee; }}
li.ok {{ color:#0a7d33; border-left:4px solid #0cce6b; }}
.desc {{ color:#666; font-size:.85rem; margin-top:.25rem; }}
table {{ border-collapse:collapse; width:100%; max-width:700px; margin-bottom:1rem; }}
td {{ padding:.4rem .6rem; border-bottom:1px solid #eee; vertical-align:top; }}
td:first-child {{ color:#888; width:160px; white-space:nowrap; }}
</style>
</head>
<body>
<h1>Competitor Audit: {html_lib.escape(audit.target or '')}</h1>
<p class="summary">Overall score: <strong>{audit.score if audit.score is not None else 'N/A'}</strong> &nbsp;|&nbsp;
HTTPS: {'Yes' if crawl.get('https') else 'No'} &nbsp;|&nbsp;
Sitemap: {'Found' if crawl.get('sitemap') else 'Not found'} &nbsp;|&nbsp;
Pages crawled: {len(pages)}</p>
<div class="scores">
{_score_cell('Performance', scores['performance'])}
{_score_cell('Accessibility', scores['accessibility'])}
{_score_cell('Best Practices', scores['best_practices'])}
{_score_cell('SEO', scores['seo'])}
</div>
<h2>Pages ({len(pages)})</h2>
{pages_html}
</body>
</html>"""
