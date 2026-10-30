"""AI that reads the bot's findings: which competitor-linking sites are worth pursuing, and what a change in your links means.

Both answer from facts we pass in and nothing else, validate the model's JSON, and fall back to plain rules when the AI is off or unusable,
so the page always has an answer. The `source` field of every result says which one produced it."""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from ..db import utcnow
from ..models import Business
from ..services import ai
from . import analytics, quality
from .models import Backlink, BacklinkEvent, BiDomain, BiPage

log = logging.getLogger("seo.backlinks.insights")
WIN = ("high", "medium", "low")

GAP_SYSTEM = ai.RULES + """
You help a small business decide which websites that link to its competitors are worth approaching for a link of its own.
Use ONLY the facts given. For each prospect return:
- win_chance: "high" (a relevant, legitimate site that links to several competitors and plausibly would link to us), "medium", or "low" (irrelevant, spammy, paid or a closed network)
- angle: one concrete, honest way to earn the link (a useful resource, a guest article, a local listing, a partnership, a correction), at most 160 characters. Never suggest buying links, link exchanges or spam.
- reason: at most 140 characters, citing a fact
Order the prospects best first. Return JSON: {"prospects": [{"domain": "...", "win_chance": "high|medium|low", "angle": "...", "reason": "..."}]}"""


def _fallback_prospect(item: dict, facts: dict, context: str) -> dict:
    s = quality.rule_score(item["domain"], facts, context)
    chance = "low" if s["verdict"] == "risky" else "high" if s["relevance"] >= 60 and item["competitor_count"] >= 2 else "medium"
    angle = {"high": "Check the page for what it offers (resources, directory, guest posts) and pitch something genuinely useful to its readers.",
             "medium": "Read the linking page first; if it fits your niche, offer a useful resource or a local listing.",
             "low": "Probably not worth chasing: it looks irrelevant or low quality."}[chance]
    return {"domain": item["domain"], "win_chance": chance, "angle": angle, "reason": s["reason"][:140]}


def prioritize_gap(db: Session, b: Business, client: str, competitors: list[str], limit: int = 12) -> dict:
    gap = analytics.gap(db, client, competitors)[:30]
    if not gap:
        return {"prospects": [], "source": "rules", "considered": 0}
    context = quality.business_context(b)
    facts = quality.domain_facts(db, b.id, competitors, [g["domain"] for g in gap])
    by_domain = {g["domain"]: g for g in gap}
    source, prospects = "rules", []
    if ai.is_configured():
        lines = [f"- {g['domain']}: links to {g['competitors']} ({g['backlinks']} link(s)); anchors: {facts[g['domain']]['anchors']}; titles: {facts[g['domain']]['titles']}; "
                 f"snippet: {facts[g['domain']]['snippets'][:1]}" for g in gap]
        try:
            out = ai.complete_json(GAP_SYSTEM, f"Business: {context}\nCompetitors: {competitors}\n\nWebsites linking to competitors but not to the business:\n" + "\n".join(lines), max_tokens=2200)
            seen = set()
            for p in out.get("prospects", []) if isinstance(out, dict) else []:
                d = str(p.get("domain", "")).lower().strip()
                if d in by_domain and d not in seen and str(p.get("win_chance", "")).lower() in WIN and str(p.get("angle", "")).strip() and str(p.get("reason", "")).strip():
                    seen.add(d)
                    prospects.append({"domain": d, "win_chance": str(p["win_chance"]).lower(), "angle": str(p["angle"]).strip()[:200], "reason": str(p["reason"]).strip()[:200]})
            if prospects:
                source = "ai"
                prospects += [_fallback_prospect(g, facts[g["domain"]], context) for g in gap if g["domain"] not in seen]  # anything the AI skipped, ranked after its picks
        except (ai.AiUnavailable, ValueError) as exc:
            log.warning("AI gap prioritisation failed, using rules: %s", exc)
    if not prospects:
        prospects = sorted((_fallback_prospect(g, facts[g["domain"]], context) for g in gap), key=lambda p: (WIN.index(p["win_chance"]),))
    for p in prospects:
        g = by_domain[p["domain"]]
        p.update(competitors=g["competitors"], links=g["backlinks"], title=(facts[p["domain"]]["titles"] or [None])[0])
    return {"prospects": prospects[:limit], "source": source, "considered": len(gap)}


EXPLAIN_SYSTEM = ai.RULES + """
You explain changes in a business's backlinks to its owner in plain words. Use ONLY the facts given: counts, dates, domains and statuses. Do not guess causes
you were not given; say "we can't tell why" when that is the truth. Return JSON: {"summary": "3-5 short sentences", "actions": ["up to 3 concrete next steps"]}"""


def explain_changes(db: Session, b: Business, domain: str, days: int = 30, now: datetime | None = None) -> dict:
    now = now or utcnow()
    since = now - timedelta(days=days)
    SD, TD = aliased(BiDomain), aliased(BiDomain)
    evs = db.execute(select(BacklinkEvent.event_type, BacklinkEvent.event_at, SD.registrable_domain, BiPage.normalized_url, Backlink.anchor_text)
                     .join(Backlink, Backlink.id == BacklinkEvent.backlink_id).join(BiPage, BiPage.id == Backlink.source_page_id).join(SD, SD.id == Backlink.source_domain_id)
                     .join(TD, TD.id == Backlink.target_domain_id).where(TD.registrable_domain == domain, BacklinkEvent.event_at >= since)
                     .order_by(BacklinkEvent.event_at.desc())).all()
    kinds: dict[str, list] = {}
    for kind, at, dom, url, anchor in evs:
        kinds.setdefault(kind, []).append((dom, url, anchor))
    now_counts = analytics.counts(db, domain)
    facts = {"domain": domain, "window_days": days, "live_links_now": now_counts["backlinks"], "referring_domains_now": now_counts["referring_domains"],
             "new": len(kinds.get("NEW", [])), "lost_confirmed": len(kinds.get("LOST_CONFIRMED", [])), "lost_pending": len(kinds.get("LOST_PENDING", [])),
             "restored": len(kinds.get("RESTORED", [])), "anchor_changed": len(kinds.get("ANCHOR_CHANGED", [])), "rel_changed": len(kinds.get("REL_CHANGED", [])),
             "broken_target": len(kinds.get("BROKEN_TARGET", [])),
             "lost_examples": [{"domain": d, "page": u, "anchor": a} for d, u, a in kinds.get("LOST_CONFIRMED", [])[:6]],
             "new_domains": sorted({d for d, _, _ in kinds.get("NEW", [])})[:8]}
    fallback_parts = [f"In the last {days} days {domain} gained {facts['new']} link(s) and lost {facts['lost_confirmed']} (confirmed by our crawler); it now has {facts['live_links_now']} live links from {facts['referring_domains_now']} domains."]
    if facts["lost_confirmed"]:
        fallback_parts.append("Lost links: " + ", ".join(sorted({x["domain"] for x in facts["lost_examples"]})) + ". We can't tell from the crawl why a link was removed.")
    if facts["broken_target"]:
        fallback_parts.append(f"{facts['broken_target']} link(s) now point at a page that returns an error.")
    actions = []
    if facts["lost_confirmed"]:
        actions.append("Open the Backlink explorer, filter by status LOST_CONFIRMED, and decide which lost links are worth asking to restore.")
    if facts["broken_target"]:
        actions.append("Fix or redirect the pages those links point to.")
    if not facts["new"] and not facts["lost_confirmed"]:
        actions.append("Run the Discovery bot again, or give it more seed pages, to find more links.")
    result = {"summary": " ".join(fallback_parts), "actions": actions[:3], "facts": facts, "source": "rules"}
    if ai.is_configured() and any(facts[k] for k in ("new", "lost_confirmed", "lost_pending", "restored", "anchor_changed", "rel_changed", "broken_target")):
        try:
            out = ai.complete_json(EXPLAIN_SYSTEM, f"Business: {b.name}\nFacts: {facts}", max_tokens=700)
            summary, acts = str(out.get("summary", "")).strip(), [str(a).strip() for a in out.get("actions", []) if str(a).strip()]
            if summary and acts:
                result.update(summary=summary[:900], actions=acts[:3], source="ai")
        except (ai.AiUnavailable, ValueError) as exc:
            log.warning("AI explanation failed, using rules: %s", exc)
    return result
