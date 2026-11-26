"""Runs the workflow stages and keeps every result with the article (Article.stats["workflow"]; an existing JSON column, no migration).

Research stages run one at a time from the editor (run_research_stage): the page shows each stage's progress and result, can retry one
failed stage, and lets the user edit the brief before the article is written. The article stages run inside the existing article job
(run_article_stages, called by articles.run_article), and any one of them can be run again later (retry_article_stage).
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from .. import articles as svc
from . import stages as st

log = logging.getLogger("seo.workflow")
ARTICLE_STAGES = ["meta_title", "meta_description", "expert", "human", "seo_expert"]  # after /write-seo-article
LABELS = {s[0]: s[2] for s in st.STAGES}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _record(ctx: dict, sid: str, status: str, output: dict | None = None, error: str = "") -> dict:
    rec = {"status": status, "output": output or {}, "error": error, "at": _now(), "basis": (output or {}).get("basis", "")}
    ctx.setdefault("stages", {})[sid] = rec
    return rec


# ── research stages (before writing) ─────────────────────────────────────────

def run_research_stage(sid: str, ctx: dict, b) -> dict:
    """Run one research stage on the context sent by the page; returns the updated context (the page keeps it and sends it back)."""
    if sid not in st.RESEARCH_FUNCS:
        raise ValueError(f"Unknown research stage: {sid}")
    ctx = dict(ctx or {})
    ctx.setdefault("input", {})
    try:
        out = st.RESEARCH_FUNCS[sid](ctx, b)
        _record(ctx, sid, "done", out)
        if sid == "content_brief":
            ctx["brief"] = out  # the page shows it for review and editing before the article is written
    except Exception as exc:  # noqa: BLE001 - the page shows the error and offers Retry for this stage only
        log.warning("Workflow stage %s failed: %s", sid, exc)
        _record(ctx, sid, "failed", error=str(exc)[:400])
    return ctx


# ── article stages (after writing) ───────────────────────────────────────────

def _finish_body(a, b, plain_body: str) -> str:
    """Article HTML after a text edit: cleaned, keywords and brand bolded again, the JSON-LD rebuilt from the final text
    (by the same refresh_schema the editor's save uses, so the address, image and dates stay right)."""
    from .. import article_publishing as ap
    # (not sanitize_html: that drops every link and attribute, which would remove the CTA's phone/website links; the edits are already
    # escaped plain text, so the HTML stays as the writer built it)
    a.body = svc.emphasize(svc.strip_emphasis(svc._SCHEMA_RE.sub("\n", plain_body)), a.keyword, a.secondary_keywords or [], svc.brand_of(b))
    ap.refresh_schema(a, b)
    return a.body


def _set_h1(body: str, title: str) -> str:
    import html
    return re.sub(r"<h1\b[^>]*>[\s\S]*?</h1>", f"<h1>{html.escape(title, quote=False)}</h1>", body, count=1, flags=re.I)


def run_article_stages(db, a, b, only: list[str] | None = None, progress=None) -> dict:
    """Run the article stages in order (or only the given ones) on the saved article; each one's result is kept, a failure never stops the rest."""
    from .. import seo_report
    wf = dict((a.stats or {}).get("workflow") or {})
    changed = False
    for sid in only or ARTICLE_STAGES:
        if progress:
            progress(f"{LABELS.get(sid, sid)}…")
        try:
            art = {"title": a.title or "", "meta": a.meta_description or "", "body": a.body or "", "primary": a.keyword, "secondary": a.secondary_keywords or []}
            if sid == "meta_title":
                out = st.shorten_meta_title(art, b)
                if out["changed"]:
                    same_h1 = svc.blog_title_of(a).strip().lower() == (a.title or "").strip().lower()
                    a.title = out["after"][:255]
                    if same_h1:  # the H1 followed the SEO title: keep them together; a separate Blog title (H1) is left as it is
                        a.body = _set_h1(a.body or "", a.title)
                    changed = True
            elif sid == "meta_description":
                out = st.shorten_meta_description(art, b)
                if out["changed"]:
                    a.meta_description, changed = out["after"], True
            elif sid in ("expert", "human"):
                out = (st.expert if sid == "expert" else st.human)(art, b)
                plain = svc.strip_emphasis(svc._SCHEMA_RE.sub("\n", a.body or ""))
                dens, uses, words = st.keyword_density(a.body or "", a.keyword)
                # only the human editor may thin out an over-used keyword, and only down to about 1.5%
                allow = max(0, uses - round(words * 0.02 / max(1, len(a.keyword.split())))) if sid == "human" and dens > 2.5 else 0
                new, results = st.apply_edits(plain, out.pop("edits"), a.keyword, max_kw_removals=allow)
                if sid == "human":
                    out["density_before"] = round(dens, 2)
                    out["density_after"] = round(st.keyword_density(new, a.keyword)[0], 2)
                out["edits"] = results
                out["applied"] = sum(1 for r in results if r["applied"])
                if out.get("heading_fixes"):  # grammar fixes for headings (human editor only), applied within safe limits
                    new, hres = st.apply_heading_fixes(new, out["heading_fixes"], a.keyword)
                    out["heading_fixes"] = hres
                    out["applied"] += sum(1 for r in hres if r["applied"])
                if sid == "human":  # the keyword still above 2%: a focused pass rewrites just enough body sentences (spread out) to bring it to ~1.5%
                    new, thin = st.thin_keyword(new, a.keyword)
                    if thin["rewritten"]:
                        out["applied"] += thin["rewritten"]
                        out["keyword_thinned"] = thin
                    out["density_after"] = round(st.keyword_density(new, a.keyword)[0], 2)
                if out["applied"]:
                    a.body, changed = _finish_body(a, b, new), True
            elif sid == "seo_expert":
                if changed:  # the schema and keyword marks must match the final text before it is reviewed
                    a.body = _finish_body(a, b, svc.strip_emphasis(a.body or ""))
                    changed = False
                rep = seo_report.build(db, a, b, with_ai=True, previous=(a.stats or {}).get("seo_report"))
                seo_report.save(db, a, rep)
                out = {"summary": rep["summary"], "ai_error": rep.get("ai_error", ""), "basis": "Python checks + AI review"}
                if rep.get("ai_error"):
                    raise RuntimeError(f"The AI part of the SEO review failed: {rep['ai_error']}")
            else:
                raise ValueError(f"Unknown article stage: {sid}")
            _record(wf, sid, "done", out)
        except Exception as exc:  # noqa: BLE001
            log.warning("Article stage %s failed for article %s: %s", sid, a.id, exc)
            _record(wf, sid, "failed", error=str(exc)[:400])
        a.stats = {**(a.stats or {}), "workflow": wf}
        db.commit()
    if changed:  # text changed after the last SEO review: rebuild the schema and refresh the measurable checks (the AI review is marked out of date)
        a.body = _finish_body(a, b, svc.strip_emphasis(a.body or ""))
        seo_report.save(db, a, seo_report.build(db, a, b, with_ai=False, previous=(a.stats or {}).get("seo_report")))
    a.headings = svc.headings_of(a.body or "")
    a.warnings = svc.validate(a.title or "", a.meta_description or "", a.body or "", a.keyword, a.secondary_keywords or [], svc.brand_of(b))
    a.stats = {**(a.stats or {}), "workflow": wf}
    db.commit()
    return wf


def retry_article_stage(db, a, b, sid: str) -> dict:
    if sid not in ARTICLE_STAGES:
        raise ValueError("Only the meta title, meta description, expert, human and SEO review stages can be run again here; regenerate the article to rewrite it.")
    return run_article_stages(db, a, b, only=[sid])
