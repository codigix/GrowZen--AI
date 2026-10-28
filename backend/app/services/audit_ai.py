"""AI for the website audit report: a plain-words summary with the top actions and a message for the
client, and new titles / meta descriptions for every page that needs one.

Both work without an AI key (rules: issues ranked by severity, titles and descriptions built from the page
and the business), and are AI-written with one. The AI only rewords: facts come from the audit and the
business, and every result is checked (length limits) before it's returned.
"""
import json
import re
from types import SimpleNamespace
from typing import Any

from . import ai
from .copilot import _clip, _topic

LEVEL_ORDER = {"critical": 0, "serious": 1, "warning": 2, "info": 3}
EFFORT = {"missing_title": "5 min a page", "title_length": "5 min a page", "missing_meta_description": "5 min a page", "h1_count": "10 min a page",
          "missing_alt": "2 min an image", "no_viewport": "5 min", "noindex": "5 min", "no_sitemap": "15 min", "no_localbusiness_schema": "15 min",
          "robots_blocks_all": "5 min", "no_https": "30 min", "http_error": "10-30 min", "thin_content": "1-2 hours a page", "slow_mobile": "2-6 hours",
          "javascript_only": "1-3 days (developer)", "duplicate_titles": "5 min a page"}
TAB = {"slow_mobile": "speed"}  # where in the report each fix lives (default: fixes)


def _group(issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Issues grouped by kind, worst first: one action per kind ("3 pages have no meta description")."""
    groups: dict[str, dict[str, Any]] = {}
    for i in issues:
        code = i.get("code") or i.get("title", "")
        g = groups.setdefault(code, {"code": code, "level": i.get("level", "info"), "count": 0, "example": i.get("title", ""), "fix": i.get("fix", ""), "area": i.get("area", "")})
        g["count"] += 1
        if LEVEL_ORDER.get(i.get("level"), 9) < LEVEL_ORDER.get(g["level"], 9):
            g["level"] = i["level"]
    return sorted(groups.values(), key=lambda g: (LEVEL_ORDER.get(g["level"], 9), -g["count"]))


def summary(report: dict[str, Any]) -> dict[str, Any]:
    """{headline, summary, actions: [{title, why, level, effort, code, tab}], client_message, source}."""
    target = re.sub(r"^https?://", "", report.get("target") or "").rstrip("/")
    score = report.get("score")
    scores = report.get("scores") or {}
    groups = _group(report.get("issues") or [])
    crit = sum(1 for g in groups if g["level"] == "critical")
    actions = [{"title": (f"{g['example']}" if g["count"] == 1 else f"{g['example']} (+{g['count'] - 1} more like it)")[:160],
                "why": g["fix"] or "Fix it to improve how the site shows in Google.", "level": g["level"], "effort": EFFORT.get(g["code"], "varies"),
                "code": g["code"], "tab": TAB.get(g["code"], "fixes")} for g in groups[:3]]
    weak = [k.replace("_", " ") for k, v in scores.items() if v is not None and v < 50]
    headline = (f"{target} scores {score}/100. " if score is not None else f"{target} was audited. ") + (
        f"{crit} critical problem{'s' if crit != 1 else ''} to fix first." if crit else "No critical problems; the fixes below raise the score further.")
    text = (f"The audit checked {report.get('pages', 0)} page{'s' if report.get('pages') != 1 else ''} and Google's Lighthouse tests. "
            + (f"Weakest areas: {', '.join(weak)}. " if weak else "")
            + (f"Start with: {actions[0]['title']}." if actions else "Nothing urgent was found."))
    client = (f"Hi,\n\nWe've audited {target}. It scores {score if score is not None else '—'}/100 for SEO health. "
              + (f"The most important fixes: " + "; ".join(a["title"] for a in actions) + ". " if actions else "There's nothing urgent to fix. ")
              + "We'll take care of these and re-check the site afterwards.\n\nThanks")
    result = {"headline": headline, "summary": text, "actions": actions, "client_message": client, "source": "rules"}
    if not ai.is_configured():
        return result
    try:
        out = ai.complete_json(
            "You are an SEO consultant explaining a website audit to a local business agency. Plain words, specific, no jargon, no hype.\n" + ai.RULES,
            "Audit: " + json.dumps({"site": target, "score": score, "scores": scores, "pages_checked": report.get("pages"),
                                    "vitals": report.get("vitals"), "issue_groups": [{k: g[k] for k in ("code", "level", "count", "example", "fix")} for g in groups[:15]]})
            + '\nReturn JSON {"headline": "one sentence", "summary": "2-3 sentences: what this means for the business", '
            '"actions": [{"code": "an issue_groups code", "title": "what to do", "why": "why it matters for customers"}] (the 3 most valuable, in order), '
            '"client_message": "a short friendly email to the business owner: what we found and what we will fix, 80-120 words"}.',
            temperature=0.3, max_tokens=1200)
        by_code = {g["code"]: g for g in groups}
        picked = [{"title": str(a.get("title", ""))[:160], "why": str(a.get("why", ""))[:300], "level": by_code[a["code"]]["level"],
                   "effort": EFFORT.get(a["code"], "varies"), "code": a["code"], "tab": TAB.get(a["code"], "fixes")}
                  for a in out.get("actions") or [] if isinstance(a, dict) and a.get("code") in by_code and a.get("title")]
        result.update({k: str(out[k])[:1500] for k in ("headline", "summary", "client_message") if out.get(k)})
        if picked:
            result["actions"] = picked[:3]
        result["source"] = "ai"
    except Exception as exc:
        result["ai_error"] = str(exc)[:200]
    return result


def _biz(b: dict[str, Any]) -> SimpleNamespace:
    return SimpleNamespace(name=b.get("name") or "", primary_category=b.get("category") or "", phone=b.get("phone") or "", area=b.get("area") or "", city=b.get("city") or "")


def _rule_text(kind: str, page: dict[str, Any], b: SimpleNamespace) -> str:
    place = (b.area or b.city or "").split(",")[0].strip()
    home = re.sub(r"^https?://[^/]+", "", page.get("url", "")) in ("", "/")
    if kind == "title":
        if home and b.primary_category and place:
            return _clip(f"{b.name} – {b.primary_category} in {place}", 60)
        return _clip(f"{_topic(page)} | {b.name}" if b.name else _topic(page), 60)
    where = f" in {place}" if place else ""
    cta = f" Call {b.phone} or book today." if b.phone else " Book today."
    return _clip(f"{_topic(page)} at {b.name}{where}.{cta}" if b.name else f"{_topic(page)}{where}.{cta}", 160)


def needs_rewrite(kind: str, page: dict[str, Any]) -> bool:
    if (page.get("status") or 0) >= 400 or page.get("noindex"):
        return False
    if kind == "title":
        n = len(page.get("title") or "")
        return n == 0 or n < 25 or n > 60
    return not (page.get("meta_description") or "").strip()


def rewrite(kind: str, business: dict[str, Any], pages: list[dict[str, Any]]) -> dict[str, Any]:
    """New titles (kind="title", max 60) or meta descriptions (kind="meta", 120-160) for the pages that need one."""
    b = _biz(business)
    todo = [p for p in pages if needs_rewrite(kind, p)][:30]
    rows = [{"url": p["url"], "before": (p.get("title") if kind == "title" else p.get("meta_description")) or "", "after": _rule_text(kind, p, b)} for p in todo]
    result = {"kind": kind, "rows": rows, "source": "rules"}
    if not rows or not ai.is_configured():
        return result
    limit = 60 if kind == "title" else 160
    try:
        out = ai.complete_json(
            f"You write {'page titles (max 60 characters)' if kind == 'title' else 'meta descriptions (130-160 characters, with a reason to click)'} for a local business website.\n{ai.RULES}",
            "Business: " + json.dumps({k: business.get(k) for k in ("name", "category", "area", "city")}) + "\nPages: "
            + json.dumps([{"url": p["url"], "title": p.get("title"), "h1": p.get("h1"), "meta_description": p.get("meta_description")} for p in todo])
            + '\nReturn JSON {"items": [{"url": "", "text": ""}]} with one item per page. Each text must describe that page specifically.',
            temperature=0.4, max_tokens=2500)
        by_url = {str(i.get("url")): str(i.get("text") or "").strip() for i in out.get("items") or [] if isinstance(i, dict)}
        for r in rows:
            t = by_url.get(r["url"])
            if t and len(t) <= limit and (kind == "title" or len(t) >= 70):  # only keep AI text that meets the limits
                r["after"], r["source"] = t, "ai"
        result["source"] = "ai" if any(r.get("source") == "ai" for r in rows) else "rules"
    except Exception as exc:
        result["ai_error"] = str(exc)[:200]
    return result
