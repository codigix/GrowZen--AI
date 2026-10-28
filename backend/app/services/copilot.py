"""The AI copilot: drafts the actual change for each planned task, writes the daily briefing across
all clients, and explains alerts.

Every feature has a rule-based version, so the platform works without an AI key. With a key the AI
writes it instead, grounded in the business profile and the audit data (ai.RULES: never invent facts).
Safety never depends on the AI: a task's risk is at least what the rules say, and kinds that change
what the public sees always ask for approval (agent.ALWAYS_ASK).
"""
import json
import re
import threading
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import AgentTask, Audit, Business, InsightDay, Keyword, Review
from . import ai

RISKS = ["low", "medium", "high"]
# Website fixes that only add or improve text and markup: safe to approve in bulk.
LOW_RISK_CODES = {"missing_title", "title_length", "missing_meta_description", "h1_count", "missing_alt", "no_viewport",
                  "no_localbusiness_schema", "no_sitemap", "duplicate_titles", "thin_content"}
# Fixes that change whether the site can be found or reached at all.
HIGH_RISK_CODES = {"noindex", "robots_blocks_all", "no_https", "http_error", "javascript_only"}


def risk_of(kind: str, detail: dict[str, Any]) -> str:
    if kind == "profile_edit":
        return "high"  # changes what the public sees on Google
    if kind == "review_reply":
        return "high" if (detail.get("rating") or 5) <= 3 else "low"
    if kind == "website_fix":
        code = detail.get("code") or ""
        return "low" if code in LOW_RISK_CODES else "high" if code in HIGH_RISK_CODES else "medium"
    return "medium"  # posts, outreach emails


# ── drafts: the change itself, not just the issue ───────────────────────────
def _clip(s: str, n: int) -> str:
    return s if len(s) <= n else s[: n - 1].rsplit(" ", 1)[0] + "…"


def _place(b: Business) -> str:
    return (b.area or b.city or "").split(",")[0].strip()


def _page_for(db: Session, b: Business, title: str) -> dict[str, Any] | None:
    """The crawled page an on-page issue is about (its path starts the issue title)."""
    m = re.match(r"^(/\S*?)(?::|\s)", title or "")
    if not m:
        return None
    a = db.scalar(select(Audit).where(Audit.business_id == b.id, Audit.kind == "onpage", Audit.status == "done").order_by(Audit.finished_at.desc()))
    for p in ((a.result or {}).get("pages", []) if a else []):
        if (re.sub(r"^https?://[^/]+", "", p.get("url", "")) or "/") == m.group(1):
            return p
    return None


def _topic(page: dict[str, Any]) -> str:
    path = re.sub(r"^https?://[^/]+", "", page.get("url", "")).split("?")[0].strip("/").split("/")[-1]
    return (page.get("h1") or "").strip() or (path.replace("-", " ").replace("_", " ").capitalize() if path else "Home")


def rule_draft(b: Business, kind: str, detail: dict[str, Any], page: dict[str, Any] | None) -> dict[str, Any]:
    """A ready-to-use change built from the profile and the crawled page, without AI."""
    code, changes = detail.get("code") or "", []
    if page and code in ("missing_title", "title_length", "duplicate_titles"):
        home = re.sub(r"^https?://[^/]+", "", page["url"]) in ("", "/")
        after = f"{b.name} – {b.primary_category} in {_place(b)}" if home and b.primary_category and _place(b) else f"{_topic(page)} | {b.name}"
        changes.append({"label": "Page title", "before": page.get("title") or "(none)", "after": _clip(after, 60)})
    elif page and code == "missing_meta_description":
        where = f" in {_place(b)}" if _place(b) else ""
        cta = f" Call {b.phone} or book today." if b.phone else " Book today."
        changes.append({"label": "Meta description", "before": page.get("meta_description") or "(none)", "after": _clip(f"{_topic(page)} at {b.name}{where}.{cta}", 160)})
    elif page and code == "h1_count":
        changes.append({"label": "Main heading (H1)", "before": f"{page.get('h1_count', 0)} H1 headings", "after": _topic(page)})
    elif page and code == "missing_alt":
        for src in (page.get("images_without_alt") or [])[:5]:
            name = re.sub(r"[-_]+", " ", src.rsplit("/", 1)[-1].split("?")[0].rsplit(".", 1)[0]).strip()
            changes.append({"label": f"Alt text for {src.rsplit('/', 1)[-1][:40]}", "before": "(none)", "after": _clip(f"{name.capitalize() + ' – ' if name else ''}{b.name}{', ' + _place(b) if _place(b) else ''}", 110)})
    elif code == "no_viewport":
        changes.append({"label": "Add inside <head>", "before": "", "after": '<meta name="viewport" content="width=device-width, initial-scale=1">'})
    elif code == "no_localbusiness_schema":
        schema = {"@context": "https://schema.org", "@type": "LocalBusiness", "name": b.name, "url": b.website, "telephone": b.phone,
                  "address": {"@type": "PostalAddress", "streetAddress": b.address, "addressLocality": b.city, "addressCountry": "IN"} if b.address else None}
        changes.append({"label": "Add to the home page <head>", "before": "", "after": '<script type="application/ld+json">\n' + json.dumps({k: v for k, v in schema.items() if v}, indent=2) + "\n</script>"})
    elif kind == "outreach_email":
        changes.append({"label": "Email", "before": "", "after": f"Hello,\n\nWe're {b.name}{', ' + (b.primary_category or '').lower() if b.primary_category else ''} in {_place(b) or b.city or 'your area'}. "
                        f"We'd like to be listed on your site. Our details: {b.name}, {b.address or '[add address]'}, {b.phone or '[add phone]'}, {b.website or '[add website]'}.\n\nThank you,\n[your name]"})
    summary = detail.get("fix") or "Review and carry out this fix."
    return {"summary": summary, "changes": changes, "page": page.get("url") if page else None, "source": "rules"}


def ai_draft(b: Business, kind: str, title: str, detail: dict[str, Any], page: dict[str, Any] | None, base: dict[str, Any]) -> dict[str, Any]:
    facts = {k: page.get(k) for k in ("url", "title", "meta_description", "h1", "h1_count", "word_count", "images_without_alt")} if page else {}
    out = ai.complete_json(
        f"You are an SEO specialist preparing a change for a person to approve. Write the exact change, ready to paste.\n{ai.RULES}",
        f"Business profile:\n{ai.profile_text(b)}\n\nTask ({kind}): {title}\nWhy: {detail.get('fix') or ''}\nPage facts: {json.dumps(facts)}\n"
        f"A rule-based draft (improve it, keep what is right): {json.dumps(base['changes'])}\n\n"
        'Return JSON {"summary": "one or two sentences: what to change and why", "changes": [{"label": "", "before": "", "after": ""}], '
        '"risk": "low"|"medium"|"high"}. Titles max 60 characters, meta descriptions 150-160, alt text under 110.',
        temperature=0.3, max_tokens=900)
    changes = [{"label": str(c.get("label", ""))[:120], "before": str(c.get("before", ""))[:2000], "after": str(c.get("after", ""))[:4000]}
               for c in out.get("changes") or [] if isinstance(c, dict) and c.get("after")]
    return {"summary": str(out.get("summary") or base["summary"])[:600], "changes": changes or base["changes"], "page": base["page"], "source": "ai",
            "ai_risk": out.get("risk") if out.get("risk") in RISKS else None}


def draft_for(db: Session, b: Business, task: AgentTask, use_ai: bool = True) -> dict[str, Any]:
    """Attach the drafted change and its risk to a task's detail (and return it)."""
    detail = dict(task.detail or {})
    if task.kind in ("review_reply", "gbp_post"):  # their text is the draft already
        draft = {"summary": "Approve to post on Google.", "changes": [{"label": "Text", "before": "", "after": detail.get("text") or detail.get("body") or ""}],
                 "page": None, "source": "ai" if ai.is_configured() else "rules"}
    else:
        page = _page_for(db, b, task.title)
        draft = rule_draft(b, task.kind, detail, page)
        if use_ai and ai.is_configured():
            try:
                draft = ai_draft(b, task.kind, task.title, detail, page, draft)
            except Exception as exc:  # the rule draft stands; say why the AI one is missing
                draft["ai_error"] = str(exc)[:200]
    risk = risk_of(task.kind, detail)
    if draft.get("ai_risk") and RISKS.index(draft["ai_risk"]) > RISKS.index(risk):
        risk = draft["ai_risk"]  # the AI may only raise the risk, never lower it
    detail.update(draft=draft, risk=risk)
    task.detail = detail
    return draft


# ── alerts ───────────────────────────────────────────────────────────────────
WHY = {
    "actions_drop": ("Fewer people called, asked for directions or visited the website from Google.", "Check the listing is open with correct hours, post an update, and look for a ranking drop."),
    "bad_review": ("A recent low rating is visible to everyone who finds the business.", "Reply within a day: thank them, acknowledge the issue, invite them to talk offline."),
    "rank_drop": ("A tracked keyword moved down in Google.", "Compare with competitors on the rank grid and refresh the page that targets it."),
    "score_drop": ("An audit score fell since the previous audit.", "Open the latest audit and fix the new critical and serious issues first."),
    "listing": ("Google is hiding or limiting the listing.", "Open the Business Profile and resolve it before any other work."),
}


def alerts(db: Session, today: date | None = None) -> list[dict[str, Any]]:
    """Problems worth acting on this week, found by rules across every active business."""
    today = today or date.today()
    out: list[dict[str, Any]] = []
    for b in db.scalars(select(Business).where(Business.status != "paused")):
        week = db.execute(select(func.coalesce(func.sum(InsightDay.calls + InsightDay.directions + InsightDay.website_clicks), 0))
                          .where(InsightDay.business_id == b.id, InsightDay.day > today - timedelta(days=7), InsightDay.day <= today)).scalar_one()
        before = db.execute(select(func.coalesce(func.sum(InsightDay.calls + InsightDay.directions + InsightDay.website_clicks), 0))
                            .where(InsightDay.business_id == b.id, InsightDay.day > today - timedelta(days=35), InsightDay.day <= today - timedelta(days=7))).scalar_one() / 4
        if before >= 10 and week < before * 0.7:
            drop = round((1 - week / before) * 100)
            out.append({"type": "actions_drop", "level": "serious" if drop >= 50 else "warning", "business_id": b.id, "business": b.name,
                        "title": f"Customer actions down {drop}% this week ({week} vs about {round(before)} a week)", "action": "insights"})
        for r in db.scalars(select(Review).where(Review.business_id == b.id, Review.rating <= 2, Review.reply_status != "posted", Review.review_date >= today - timedelta(days=14))):
            out.append({"type": "bad_review", "level": "serious", "business_id": b.id, "business": b.name,
                        "title": f"{r.rating}★ review by {r.author or 'a customer'} has no reply yet", "action": "reviews"})
        for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.rank.is_not(None), Keyword.prev_rank.is_not(None))):
            if k.rank - k.prev_rank >= 3 or (k.prev_rank <= 10 < k.rank):
                out.append({"type": "rank_drop", "level": "serious" if k.prev_rank <= 10 < k.rank else "warning", "business_id": b.id, "business": b.name,
                            "title": f'"{k.keyword}" fell from #{k.prev_rank} to #{k.rank}', "action": "rank"})
        for kind in ("gbp", "technical", "onpage"):
            last = list(db.scalars(select(Audit).where(Audit.business_id == b.id, Audit.kind == kind, Audit.status == "done", Audit.score.is_not(None)).order_by(Audit.finished_at.desc()).limit(2)))
            if len(last) == 2 and last[1].score - last[0].score >= 10:
                label = {"gbp": "Profile", "technical": "Technical", "onpage": "On-page"}[kind]
                out.append({"type": "score_drop", "level": "warning", "business_id": b.id, "business": b.name,
                            "title": f"{label} score fell {last[1].score} → {last[0].score}", "action": "audit"})
        st = (b.gbp_status or {}).get("open_status")
        if b.verification in ("suspended", "disabled", "conflict") or (st or "").startswith("closed"):
            what = {"suspended": "suspended", "disabled": "disabled", "conflict": "claimed by someone else"}.get(b.verification) or st.replace("_", " ")
            out.append({"type": "listing", "level": "critical", "business_id": b.id, "business": b.name, "title": f"Google listing is {what}", "action": "gbp"})
    order = {"critical": 0, "serious": 1, "warning": 2}
    out.sort(key=lambda a: order[a["level"]])
    for i, a in enumerate(out):
        a["id"] = i
        a["why"], a["next"] = WHY[a["type"]]
    return out[:30]


def explain_alerts(found: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str]:
    """One AI call: a likely cause and next step for each alert (rules text without AI)."""
    if not found or not ai.is_configured():
        return found, "rules"
    try:
        out = ai.complete_json("You are a local SEO account manager. For each alert, give the most likely cause and the single best next step, "
                               f"in plain words, using only the data given.\n{ai.RULES}",
                               "Alerts: " + json.dumps([{k: a[k] for k in ("id", "type", "business", "title")} for a in found])
                               + '\nReturn JSON {"items": [{"id": number, "why": "", "next": ""}]}.', temperature=0.3, max_tokens=1500)
        by_id = {int(i["id"]): i for i in out.get("items", []) if isinstance(i, dict) and str(i.get("id", "")).isdigit()}
        for a in found:
            hit = by_id.get(a["id"])
            if hit and hit.get("why") and hit.get("next"):
                a["why"], a["next"] = str(hit["why"])[:300], str(hit["next"])[:300]
        return found, "ai"
    except Exception:
        return found, "rules"


# ── daily briefing ───────────────────────────────────────────────────────────
ACTIONS = {"approvals", "audit", "reviews", "gbp", "rank", "insights", "link_google", "jobs"}
_cache: dict[str, tuple[date, dict[str, Any]]] = {}
_lock = threading.Lock()


def _rule_priorities(projects: list[dict[str, Any]], found: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = [{"business_id": a["business_id"], "business": a["business"], "title": a["title"], "why": a["why"], "action": a["action"]} for a in found if a["level"] in ("critical", "serious")]
    for p in sorted(projects, key=lambda p: -p["issues"]["critical"]):
        if p["issues"]["critical"]:
            out.append({"business_id": p["id"], "business": p["name"], "title": f"Fix {p['issues']['critical']} critical audit issue{'s' if p['issues']['critical'] > 1 else ''}",
                        "why": "Critical issues stop the business showing in Google's local results.", "action": "audit"})
    for p in projects:
        if p["pending_tasks"]:
            out.append({"business_id": p["id"], "business": p["name"], "title": f"Approve {p['pending_tasks']} ready change{'s' if p['pending_tasks'] > 1 else ''}",
                        "why": "The agents have drafted them; nothing goes live until you approve.", "action": "approvals"})
        if not p["gbp_linked"] and p["status"] != "paused":
            out.append({"business_id": p["id"], "business": p["name"], "title": "Match the business to its Google listing",
                        "why": "Without it, reviews, ratings and open status can't be tracked.", "action": "link_google"})
        if any(s.get("last_status") == "failed" for s in p.get("services") or []):
            out.append({"business_id": p["id"], "business": p["name"], "title": "Check a failed scheduled job",
                        "why": "A recurring service didn't run, so its results are out of date.", "action": "jobs"})
        if not p.get("last_audit_at") and p["status"] != "paused":
            out.append({"business_id": p["id"], "business": p["name"], "title": "Run the first audit",
                        "why": "Nothing can be planned for this client until it's audited.", "action": "audit"})
    seen, unique = set(), []
    for x in out:
        if (x["business_id"], x["title"]) not in seen:
            seen.add((x["business_id"], x["title"]))
            unique.append(x)
    return unique[:5]


def briefing(db: Session, portfolio: dict[str, Any], refresh: bool = False) -> dict[str, Any]:
    """Today's top priorities across every client, cached for the day. AI-written with a key."""
    today = date.today()
    with _lock:
        hit = _cache.get("briefing")
        if hit and hit[0] == today and not refresh:
            return hit[1]
    projects = portfolio["projects"]
    found = alerts(db, today)
    priorities = _rule_priorities(projects, found)
    t = portfolio["totals"]
    headline = (f"{len(found)} alert{'s' if len(found) != 1 else ''}, {t['pending_tasks']} change{'s' if t['pending_tasks'] != 1 else ''} to approve "
                f"and {t['critical_issues']} critical issue{'s' if t['critical_issues'] != 1 else ''} across {t['projects']} project{'s' if t['projects'] != 1 else ''}.")
    result = {"date": today.isoformat(), "source": "rules", "headline": headline, "priorities": priorities, "generated_at": datetime.now(timezone.utc).isoformat()}
    if ai.is_configured() and projects:
        compact = [{"id": p["id"], "name": p["name"], "status": p["status"], "health": p["health"], "issues": p["issues"], "pending_tasks": p["pending_tasks"],
                    "unreplied_reviews": p.get("unreplied_reviews"), "leads_30": p.get("leads_30"), "actions_30": p.get("actions_30"),
                    "actions_prev_30": p.get("actions_prev_30"), "gbp_linked": p["gbp_linked"]} for p in projects[:40]]
        try:
            out = ai.complete_json(
                "You are the account manager of a local SEO agency planning today's work. Pick the 3-5 things that matter most for clients' "
                f"results today, most important first. Plain words, specific, no jargon.\n{ai.RULES}",
                f"Projects: {json.dumps(compact)}\nAlerts: {json.dumps([{k: a[k] for k in ('business_id', 'level', 'title')} for a in found])}\n"
                f'Return JSON {{"headline": "one sentence", "priorities": [{{"business_id": number, "title": "what to do", "why": "why it matters today", '
                f'"action": one of {sorted(ACTIONS)}}}]}}.', temperature=0.4, max_tokens=1200)
            names = {p["id"]: p["name"] for p in projects}
            picked = [{"business_id": int(x["business_id"]), "business": names[int(x["business_id"])], "title": str(x.get("title", ""))[:200],
                       "why": str(x.get("why", ""))[:300], "action": x.get("action") if x.get("action") in ACTIONS else "audit"}
                      for x in out.get("priorities", []) if isinstance(x, dict) and str(x.get("business_id", "")).isdigit() and int(x["business_id"]) in names and x.get("title")]
            if picked:
                result.update(source="ai", headline=str(out.get("headline") or headline)[:300], priorities=picked[:5])
        except Exception as exc:
            result["ai_error"] = str(exc)[:200]
    with _lock:
        _cache["briefing"] = (today, result)
    return result
