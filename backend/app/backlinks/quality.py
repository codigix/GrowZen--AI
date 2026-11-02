"""Link quality: how relevant a referring domain is to a business and how spammy it looks, with a one-line reason.

This is our own score, built from what our bot saw (page title and snippet, anchors, placement, how many links) and the business profile. With an
AI key one model call judges up to 15 domains at a time; without one, or when the AI answer is unusable for a domain, transparent rules are used,
and each score says which method produced it. It is not a Google, Moz, Ahrefs or Semrush metric and is never presented as one."""
import logging
import re
from collections import Counter
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import utcnow
from ..models import Business
from ..services import ai
from .lifecycle import LIVE_STATES
from .models import Backlink, BiDomainScore, BiPage, BiDomain
from sqlalchemy.orm import aliased

log = logging.getLogger("seo.backlinks.quality")
BATCH = 15
VERDICTS = ("good", "ok", "risky")
SPAMMY_TLDS = frozenset({"shop", "site", "online", "xyz", "top", "click", "icu", "cfd", "sbs", "space", "website", "link", "buzz", "monster", "homes", "store", "fun", "live", "vip", "work"})
SPAM_WORDS = re.compile(r"\b(casino|poker|betting|viagra|cialis|payday|loan|porn|escort|replica|crypto|forex|seo[- ]?(?:link|backlink|package)s?|backlinks?|buy (?:cheap|now)|cheap)\b", re.I)
_STOP = frozenset("the and for with from your you our are was this that have has not but all can will near best top services service company india limited ltd pvt private inc llc".split())


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]{3,}", (text or "").lower()) if w not in _STOP}


def business_context(b: Business) -> str:
    services = "; ".join(s.get("name", "") for s in (b.services or []) if s.get("name"))
    return " | ".join(x for x in [b.name, b.primary_category, ", ".join(b.secondary_categories or []), services, b.city, b.description or ""] if x)[:600]


def domain_facts(db: Session, business_id: int, targets: str | list[str], domains: list[str]) -> dict[str, dict]:
    """What the bot knows about each linking domain: page titles/snippets, anchors, placement, rel, number of links and pages."""
    targets = [targets] if isinstance(targets, str) else list(targets)
    SD, TD = aliased(BiDomain), aliased(BiDomain)
    rows = db.execute(select(Backlink, BiPage, SD.registrable_domain).join(BiPage, BiPage.id == Backlink.source_page_id).join(SD, SD.id == Backlink.source_domain_id)
                      .join(TD, TD.id == Backlink.target_domain_id).where(TD.registrable_domain.in_(targets), SD.registrable_domain.in_(domains or [""]),
                                                                          Backlink.current_status.in_(LIVE_STATES))).all()
    facts: dict[str, dict] = {d: {"links": 0, "pages": set(), "anchors": Counter(), "placements": Counter(), "nofollow": 0, "titles": [], "snippets": []} for d in domains}
    for bl, page, dom in rows:
        f = facts[dom]
        f["links"] += 1
        f["pages"].add(page.id)
        f["anchors"][" ".join((bl.anchor_text or "").split())[:80] or "(no anchor)"] += 1
        f["placements"][bl.placement or "unknown"] += 1
        f["nofollow"] += 1 if "nofollow" in (bl.rel_attributes or []) else 0
        if page.title and page.title not in f["titles"]:
            f["titles"].append(page.title[:120])
        if page.snippet and len(f["snippets"]) < 2 and page.snippet[:160] not in f["snippets"]:
            f["snippets"].append(page.snippet[:240])
    for d, f in facts.items():
        f["pages"] = len(f["pages"])
        f["anchors"] = [a for a, _ in f["anchors"].most_common(3)]
        f["placements"] = dict(f["placements"])
        f["titles"] = f["titles"][:2]
    return facts


def rule_score(domain: str, f: dict, context: str) -> dict:
    """Transparent heuristics. Each rule that fires appears in the reason, so the score can be argued with."""
    tld = domain.rsplit(".", 1)[-1]
    text = " ".join([*f.get("titles", []), *f.get("snippets", []), *f.get("anchors", []), domain.replace("-", " ").replace(".", " ")])
    risk, why = 10, []
    if tld in SPAMMY_TLDS:
        risk += 30
        why.append(f".{tld} domains are often throwaway")
    if SPAM_WORDS.search(text):
        risk += 30
        why.append("spam-style wording")
    if re.search(r"\d{3,}", domain) or domain.split(".")[0].count("-") >= 2 or len(domain.split(".")[0]) > 25:
        risk += 15
        why.append("odd domain name")
    anchors = f.get("anchors", [])
    if any(len(a.split()) >= 9 for a in anchors):
        risk += 15
        why.append("very long keyword-style anchor")
    if f.get("links", 0) >= 20 and set(f.get("placements", {})) <= {"footer", "sidebar", "navigation", "unknown"}:
        risk += 10
        why.append("sitewide footer/sidebar link")
    overlap = len(_words(context) & _words(text))
    relevance = min(100, 25 + overlap * 18) if text.strip() else 30
    if not why:
        why.append("no spam signals seen")
    risk = min(risk, 100)
    verdict = "risky" if risk >= 60 else "good" if relevance >= 60 and risk < 35 else "ok"
    return {"relevance": relevance, "risk": risk, "verdict": verdict, "reason": ("; ".join(why) + f"; topic overlap {overlap} word(s)")[:400]}


SYSTEM = ai.RULES + """
You judge whether a website that links to a business is a good or a bad link for that business, using ONLY the facts given.
For every linking domain return:
- relevance: 0-100, how well the linking site's topic and audience fit the business's niche
- risk: 0-100, how spammy, paid, automated or manipulative the link looks (throwaway TLDs, keyword-stuffed anchors, link farms, unrelated sites)
- verdict: "good" (relevant and safe), "ok", or "risky"
- reason: one plain sentence, at most 140 characters, citing a concrete fact
If the facts are too thin to judge, say so in the reason and keep relevance and risk near 40-50. Never invent facts about the site.
Return JSON: {"scores": [{"domain": "...", "relevance": 0, "risk": 0, "verdict": "good|ok|risky", "reason": "..."}]} with one entry per domain given."""


def _ai_scores(context: str, facts: dict[str, dict]) -> dict[str, dict]:
    lines = []
    for d, f in facts.items():
        lines.append(f"- {d}: {f['links']} link(s) on {f['pages']} page(s); anchors: {f['anchors']}; placement: {f['placements']}; nofollow: {f['nofollow']}; "
                     f"titles: {f['titles']}; snippet: {f['snippets'][:1]}")
    out = ai.complete_json(SYSTEM, f"Business: {context}\n\nLinking domains:\n" + "\n".join(lines), max_tokens=1800)
    good: dict[str, dict] = {}
    for s in out.get("scores", []) if isinstance(out, dict) else []:
        try:
            d = str(s["domain"]).lower().strip()
            rel, risk = int(s["relevance"]), int(s["risk"])
            verdict, reason = str(s["verdict"]).lower(), str(s["reason"]).strip()
        except (KeyError, TypeError, ValueError):
            continue
        if d in facts and 0 <= rel <= 100 and 0 <= risk <= 100 and verdict in VERDICTS and reason:
            good[d] = {"relevance": rel, "risk": risk, "verdict": verdict, "reason": reason[:400]}
    return good


def score_domains(db: Session, b: Business, target_domain: str, domains: list[str], now: datetime | None = None) -> list[BiDomainScore]:
    """Score the given linking domains and store the result. One AI call per batch; rules fill in anything the AI did not answer properly."""
    now = now or utcnow()
    context = business_context(b)
    facts = domain_facts(db, b.id, target_domain, domains)
    ai_out: dict[str, dict] = {}
    model = None
    if domains and ai.is_configured():
        try:
            ai_out = _ai_scores(context, facts)
            model = ai.claude_model() if ai.provider_chain()[0] == "claude" else ai.provider_chain()[0]
        except (ai.AiUnavailable, ValueError) as exc:
            log.warning("AI link scoring failed, using rules: %s", exc)
    saved = []
    for d in domains:
        res, method = (ai_out[d], "ai") if d in ai_out else (rule_score(d, facts[d], context), "rules")
        row = db.scalar(select(BiDomainScore).where(BiDomainScore.business_id == b.id, BiDomainScore.source_domain == d)) or BiDomainScore(business_id=b.id, source_domain=d)
        row.relevance, row.risk, row.verdict, row.reason, row.method, row.model, row.scored_at = res["relevance"], res["risk"], res["verdict"], res["reason"], method, model if method == "ai" else None, now
        db.add(row)
        saved.append(row)
    db.commit()
    return saved


def unscored_domains(db: Session, business_id: int, target_domain: str, limit: int = BATCH, rescore_older_than: datetime | None = None) -> list[str]:
    """Linking domains with live links to `target_domain` that have no score yet (biggest linkers first)."""
    SD, TD = aliased(BiDomain), aliased(BiDomain)
    rows = db.execute(select(SD.registrable_domain, Backlink.id).join(Backlink, Backlink.source_domain_id == SD.id).join(TD, TD.id == Backlink.target_domain_id)
                      .where(TD.registrable_domain == target_domain, Backlink.current_status.in_(LIVE_STATES))).all()
    counts = Counter(d for d, _ in rows)
    done = {r.source_domain: r.scored_at for r in db.scalars(select(BiDomainScore).where(BiDomainScore.business_id == business_id))}
    todo = [d for d, _ in counts.most_common() if d not in done or (rescore_older_than and done[d] and done[d].replace(tzinfo=None) < rescore_older_than.replace(tzinfo=None))]
    return todo[:limit]


def scores_for(db: Session, business_id: int) -> dict[str, dict]:
    return {r.source_domain: {"relevance": r.relevance, "risk": r.risk, "verdict": r.verdict, "reason": r.reason, "method": r.method}
            for r in db.scalars(select(BiDomainScore).where(BiDomainScore.business_id == business_id))}
