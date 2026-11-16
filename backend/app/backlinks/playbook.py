"""The link-building plan: places to get a link (where competitors have one and we do not, or AI-suggested for the business), what each would give the
business, how to get it, and how far along each one is. Statuses are set by the user; "live" is also confirmed by the crawler when the site really links to us.

Advice comes from AI when a key is set, and from plain category rules otherwise; each answer says which. AI-suggested platforms are suggestions, not facts:
the page says to check the site before approaching it."""
from __future__ import annotations

import logging
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import utcnow
from ..models import Business
from ..services import ai
from . import analytics, hub, quality
from .models import BiOpportunity

log = logging.getLogger("seo.backlinks.playbook")
STATUSES = ("planned", "contacted", "live", "skipped")
DOMAIN = re.compile(r"^(?=.{4,120}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$")
EFFORT = ("low", "medium", "high")

GET = {  # what a link from this kind of site gives, when the AI is not available
    "directory": ["Visitors who are looking for exactly your kind of business", "A consistent name, address and phone that local search trusts", "A link that is easy to earn and safe"],
    "blog": ["Readers who already like the topic and may become customers", "A contextual link inside real content, the kind search engines value most", "Your name beside a useful article"],
    "news": ["Visibility with a wide audience", "A trusted, editorial link", "Credibility you can quote on your own site"],
    "forum": ["Visits from people asking the very questions you answer", "Trust when your answers help", "Little ranking value: most forum links are nofollow"],
    "education": ["A rare, high-trust link", "Credibility with students and parents", "Often long-lasting"],
    "government": ["A high-trust link", "Proof that the business is genuine"],
    "social": ["Another place customers find you", "Consistent branding", "Little ranking value, but a trust signal"],
    "website": ["Visitors from a site whose readers match yours", "A link that shows other businesses know you"],
}
STEPS = {
    "directory": ["Open the site and search for your business: claim the listing if it exists.", "Fill in the same name, address, phone, hours and website as your Google profile.", "Pick the right category, add photos and a short description, then save."],
    "blog": ["Read two recent posts to see what they write about.", "Write a 3-line pitch with one idea that would help their readers (not a request for a link).", "Send it to the editor, offer to write or be quoted, and link to your site once published."],
    "news": ["Find the editor or the section that covers your field.", "Send a short note about something genuinely new: an event, a figure, an offer.", "Offer a quote or photo and follow up once after a week."],
    "forum": ["Create an honest profile that names your business.", "Answer three questions fully, without a link.", "Add your site only where it really answers the question."],
    "education": ["Find the right department or community office.", "Offer a talk, a free resource or a sponsorship.", "Ask for a mention on the page that lists partners."],
    "government": ["Check whether your type of business can register or be listed.", "Complete the application with your real details.", "Link to the listing from your website to confirm it."],
    "social": ["Create or complete the profile.", "Use your business name and add your website to the bio.", "Post a few times so it does not look abandoned."],
    "website": ["Read what the site is about and who reads it.", "Write a short, personal message saying what you offer and why it helps their readers.", "Offer something in return: a quote, a guest post or a partnership."],
}


def _own_site(b: Business) -> str:
    return (b.website or "").lower().replace("https://", "").replace("http://", "").removeprefix("www.").strip("/")


def _context(b: Business) -> str:
    return quality.business_context(b)


# ------------------------------------------------------------------------------------------------------------------------ the plan
def _row(db: Session, b: Business, domain: str) -> BiOpportunity | None:
    return db.scalar(select(BiOpportunity).where(BiOpportunity.business_id == b.id, BiOpportunity.domain == domain))


def set_status(db: Session, b: Business, domain: str, status: str, note: str | None = None, source: str = "competitor", name: str | None = None) -> BiOpportunity:
    domain = domain.lower().strip().removeprefix("www.")
    if status not in STATUSES:
        raise ValueError("Unknown status")
    if not DOMAIN.match(domain):
        raise ValueError("That is not a website address")
    row = _row(db, b, domain) or BiOpportunity(business_id=b.id, domain=domain, source=source if source in ("competitor", "ai") else "competitor")
    if name:
        row.name = name[:160]
    if note is not None:
        row.note = note.strip()[:500] or None
    if row.status != status or row.id is None:
        row.status, row.status_at = status, utcnow()
    db.add(row)
    db.commit()
    return row


def _out(row: BiOpportunity, confirmed: bool) -> dict[str, Any]:
    status = "live" if confirmed else row.status
    return {"domain": row.domain, "name": row.name, "source": row.source, "status": status, "confirmed": confirmed, "note": row.note, "advice": row.advice,
            "status_at": row.status_at.isoformat() if row.status_at else None}


def plan(db: Session, b: Business) -> dict[str, Any]:
    """Everything in the plan with its status; a site that now really links to us (the crawler saw it) counts as live whatever was clicked."""
    me = hub.own_domain(db, b.id)
    mine = set(analytics.referring_domains(db, me)) if me else set()
    rows = list(db.scalars(select(BiOpportunity).where(BiOpportunity.business_id == b.id).order_by(BiOpportunity.status_at.desc().nullslast(), BiOpportunity.id.desc())))
    out = [_out(r, r.domain in mine) for r in rows]
    counts = {s: sum(1 for x in out if x["status"] == s) for s in STATUSES}
    return {"items": out, "counts": counts}


# ------------------------------------------------------------------------------------------------------------------------ advice for one place
SYSTEM = ai.RULES + """
You advise a small business on whether and how to get a backlink from one specific website, using ONLY the facts given.
Return JSON: {"what_it_is": "one sentence on what kind of site it is", "what_you_get": ["2-4 concrete benefits for THIS business (visitors, trust, local relevance, ranking value)"],
"effort": "low|medium|high", "steps": ["3-5 short, concrete steps to get the link"], "message": "a short, honest outreach message the owner can send, with [add ...] placeholders for missing facts",
"caution": "one sentence on what to watch out for, or an empty string"}
Do not promise rankings or traffic numbers. Do not claim you visited the site; if the facts are thin, say what to check first."""


def _rule_advice(category: str, follow: str, relevance: int | None) -> dict[str, Any]:
    key = category if category in GET else "website"
    why = list(GET[key])
    if follow != "dofollow":
        why.append("Their links are nofollow: expect visitors and trust, not ranking value")
    return {"what_it_is": f"A {key} site.", "what_you_get": why, "effort": "low" if key in ("directory", "social") else "medium" if key in ("blog", "website") else "high", "steps": list(STEPS[key]),
            "message": "Hello [add name],\n\nI run [add business name] in [add city]. I read [add page] and thought our [add what you offer] could help your readers. Would you consider mentioning us or featuring us? I am happy to send details or write something useful for you.\n\nThanks,\n[add your name]",
            "caution": "Never pay for a link or promise a link in return: it can hurt the site you are linking to and yours.", "method": "rules"}


def advice(db: Session, b: Business, domain: str, force: bool = False) -> dict[str, Any]:
    from ..services import backlink_checker as bc
    domain = domain.lower().strip().removeprefix("www.")
    row = _row(db, b, domain)
    if row and row.advice and not force:
        return row.advice
    facts = hub.opportunities(db, b, limit=300)
    item = next((x for x in facts.get("opportunities", []) if x["domain"] == domain), None)
    category = (item or {}).get("category", {}).get("key") or bc.categorize(f"https://{domain}/", None, None)["key"]
    follow = (item or {}).get("follow", "dofollow")
    relevance = (item or {}).get("quality", {}).get("relevance")
    result = _rule_advice(category, follow, relevance)
    if ai.is_configured():
        known = f"Competitors that link there: {', '.join(item['competitors'])}; example page {item['sample']['url']}, anchor {item['sample']['anchor']}; follow type {follow}." if item else "Suggested for this business; no competitor link was seen there."
        try:
            out = ai.complete_json(SYSTEM, f"Business: {_context(b)}\nWebsite to approach: {domain} (kind of site by rules: {category}).\n{known}", max_tokens=900)
            steps = [str(x)[:220] for x in out.get("steps", []) if str(x).strip()][:5]
            gets = [str(x)[:220] for x in out.get("what_you_get", []) if str(x).strip()][:4]
            msg = str(out.get("message", "")).strip()[:900]
            if steps and gets and msg:
                effort = str(out.get("effort", "")).lower()
                result = {"what_it_is": str(out.get("what_it_is", ""))[:240], "what_you_get": gets, "effort": effort if effort in EFFORT else "medium", "steps": steps, "message": msg,
                          "caution": str(out.get("caution", ""))[:240], "method": "ai"}
        except (ai.AiUnavailable, ValueError) as exc:
            log.warning("AI link advice failed, using rules: %s", exc)
    row = row or BiOpportunity(business_id=b.id, domain=domain, source="competitor" if item else "ai", status="planned", status_at=utcnow())
    row.advice = result
    db.add(row)
    db.commit()
    return result


# ------------------------------------------------------------------------------------------------------------------------ AI: where else could this business get links
PLATFORM_SYSTEM = ai.RULES + """
You suggest real, well-known websites where THIS kind of business can legitimately earn a backlink: business and local directories, trade associations, chambers of commerce,
review or comparison sites, industry blogs and publications, community and event sites, and similar. Prefer sites in the business's country and city.
Return JSON: {"platforms": [{"domain": "example.com", "name": "Site name", "kind": "directory|blog|news|association|education|forum|social|other",
"why": "what this business gets from a link there, in one sentence", "how": "the one concrete first step"}]} with up to 10 entries.
Only suggest sites you are confident exist. Do not suggest the business's own site, its competitors, social networks' main pages, or paid link sellers."""


def suggest_platforms(db: Session, b: Business) -> dict[str, Any]:
    if not ai.is_configured():
        return {"state": "no_ai", "message": "AI suggestions need an AI key in the backend settings. Competitor-based opportunities above work without one.", "platforms": []}
    me = hub.own_domain(db, b.id)
    comps = hub.hygiene_competitors(db, b)
    have = set(analytics.referring_domains(db, me)) if me else set()
    planned = {r.domain for r in db.scalars(select(BiOpportunity).where(BiOpportunity.business_id == b.id))}
    try:
        out = ai.complete_json(PLATFORM_SYSTEM, f"Business: {_context(b)}\nCountry/region: {b.country or 'not given'}\nAlready linking to it: {sorted(have)[:30]}\nCompetitors (do not suggest): {comps}", max_tokens=1400)
    except (ai.AiUnavailable, ValueError) as exc:
        return {"state": "error", "message": f"The AI could not answer now: {exc}", "platforms": []}
    skip = have | planned | set(comps) | {me or "", _own_site(b)}
    seen: set[str] = set()
    items = []
    for p in out.get("platforms", []) if isinstance(out, dict) else []:
        try:
            d = str(p["domain"]).lower().strip().removeprefix("https://").removeprefix("http://").removeprefix("www.").strip("/").split("/")[0]
            why, how = str(p["why"]).strip(), str(p["how"]).strip()
        except (KeyError, TypeError):
            continue
        if not DOMAIN.match(d) or d in skip or d in seen or not why or not how:
            continue
        seen.add(d)
        items.append({"domain": d, "name": str(p.get("name", ""))[:80] or d, "kind": str(p.get("kind", "other"))[:20], "why": why[:300], "how": how[:300]})
    return {"state": "ok", "platforms": items[:10], "note": "Suggested by AI from your business details. Open each site and check it is real, active and fits before you approach it."}
