"""Things the assistant can DO, not just talk about. It only ever proposes: the user confirms with a button, and only the actions listed here can run.

Intent matching is plain pattern matching on purpose: an AI model must never decide by itself to start a crawl or change a project's lists."""
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, Competitor

ACTIONS = {
    "run_bot": {"label": "Run the discovery bot now", "does": "Starts one crawl run from your tracked sites to find backlinks (about a minute or two)."},
    "sync_targets": {"label": "Track my site and saved competitors", "does": "Adds your website and the competitors from Competitor Research to Backlink Intelligence."},
    "score_linkers": {"label": "Score the sites that link to me", "does": "Rates up to 15 linking sites for relevance and spam risk."},
    "explain_links": {"label": "Explain what changed in my links", "does": "Summarises the last 30 days of link changes in plain words."},
    "add_competitor": {"label": "Add competitor {domain}", "does": "Saves {domain} as a competitor and tracks its backlinks."},
}
_DOMAIN = r"((?:https?://)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,})"
RULES = [
    ("add_competitor", re.compile(rf"\badd\b[^.?!]*\bcompetitor\b[^a-z0-9]*{_DOMAIN}", re.I)),
    ("add_competitor", re.compile(rf"\btrack\b[^.?!]*{_DOMAIN}[^.?!]*\bcompetitor\b", re.I)),
    ("run_bot", re.compile(r"\b(run|start|launch|kick ?off)\b[^.?!]*\b(bot|crawler|crawl|discovery)\b", re.I)),
    ("run_bot", re.compile(r"\b(find|discover|look for|search for)\b[^.?!]*\b(new )?(backlinks?|links)\b", re.I)),
    ("sync_targets", re.compile(r"\b(sync|import|track)\b[^.?!]*\b(competitors?|my (site|website))\b", re.I)),
    ("score_linkers", re.compile(r"\b(score|rate|rank|check)\b[^.?!]*\b(linking|backlinks?|links|linkers?)\b", re.I)),
    ("score_linkers", re.compile(r"\bwhich\b[^.?!]*\b(backlinks?|links)\b[^.?!]*\b(bad|spam|spammy|toxic|risky)\b", re.I)),
    ("explain_links", re.compile(r"\b(explain|why|what changed)\b[^.?!]*\b(backlinks?|links)\b", re.I)),
]


def _clean_domain(raw: str) -> str:
    from ..backlinks.urls import host_of, registrable_domain
    return registrable_domain(host_of(raw))


def propose(message: str) -> dict[str, Any] | None:
    """The one action this message asks for, or None. Questions that merely mention backlinks ("how many backlinks do I have") match nothing."""
    for key, rx in RULES:
        m = rx.search(message or "")
        if not m:
            continue
        params: dict[str, Any] = {}
        if key == "add_competitor":
            domain = _clean_domain(m.group(1))
            if "." not in domain:
                continue
            params["domain"] = domain
        a = ACTIONS[key]
        return {"id": key, "label": a["label"].format(**params), "does": a["does"].format(**params), "params": params}
    return None


def execute(db: Session, b: Business, action: str, params: dict[str, Any], start_bot) -> dict[str, Any]:
    """Run a confirmed action. `start_bot` queues a background discovery run (the caller owns the request's background tasks)."""
    from ..backlinks import insights, quality, sync
    from ..backlinks.models import BiTrackedTarget
    if action not in ACTIONS:
        raise ValueError(f"Unknown action {action!r}")
    if action == "run_bot":
        own = db.scalar(select(BiTrackedTarget.id).where(BiTrackedTarget.business_id == b.id))
        if not own:
            sync.sync_targets(db, b)
            if not db.scalar(select(BiTrackedTarget.id).where(BiTrackedTarget.business_id == b.id)):
                return {"ok": False, "message": "Nothing to start from yet: add your website to the business profile or a domain under Backlink Intelligence first.", "link": {"label": "Open Backlink Intelligence", "to": "/backlink-intelligence?tab=targets"}}
        start_bot(b.id)
        return {"ok": True, "message": "Started. The bot is crawling now; results appear under Discovery bot in a minute or two.", "link": {"label": "Watch the bot", "to": "/backlink-intelligence?tab=bot"}}
    if action == "sync_targets":
        r = sync.sync_targets(db, b)
        names = ", ".join(a["domain"] for a in r["added"])
        return {"ok": True, "message": f"Added {len(r['added'])}: {names}." if r["added"] else "Already up to date: your site and saved competitors are all tracked.", "link": {"label": "See targets", "to": "/backlink-intelligence?tab=targets"}}
    if action == "add_competitor":
        domain = _clean_domain(str(params.get("domain", "")))
        if "." not in domain:
            return {"ok": False, "message": "I could not read a domain from that."}
        site = f"https://{domain}"
        if not db.scalar(select(Competitor.id).where(Competitor.business_id == b.id, Competitor.website == site)):
            db.add(Competitor(business_id=b.id, name=domain, website=site, source="manual"))  # the same list Competitor Research uses
            db.commit()
        r = sync.sync_targets(db, b)
        return {"ok": True, "message": f"{domain} is now a competitor, tracked for backlinks. Run the discovery bot to start finding who links to it.", "link": {"label": "Open the competitor gap", "to": "/backlink-intelligence?tab=gap"}}
    own_site = db.scalar(select(BiTrackedTarget).where(BiTrackedTarget.business_id == b.id, BiTrackedTarget.is_competitor.is_(False)).order_by(BiTrackedTarget.id))
    if own_site is None:
        return {"ok": False, "message": "Your own site isn't tracked yet. Use “Track my site and saved competitors” first.", "link": {"label": "Open Backlink Intelligence", "to": "/backlink-intelligence?tab=targets"}}
    if action == "score_linkers":
        todo = quality.unscored_domains(db, b.id, own_site.domain)
        rows = quality.score_domains(db, b, own_site.domain, todo) if todo else []
        risky = [r.source_domain for r in rows if r.verdict == "risky"]
        return {"ok": True, "message": (f"Scored {len(rows)} linking site(s); {len(risky)} look risky: {', '.join(risky)}." if rows else "Every linking site is already scored."), "link": {"label": "See the results", "to": "/backlink-intelligence?tab=overview"}}
    out = insights.explain_changes(db, b, own_site.domain)
    return {"ok": True, "message": out["summary"] + ("\n\n" + "\n".join(f"• {a}" for a in out["actions"]) if out["actions"] else ""), "link": {"label": "Open Backlink Intelligence", "to": "/backlink-intelligence"}}
