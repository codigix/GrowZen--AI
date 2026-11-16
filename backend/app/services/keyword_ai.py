"""AI keyword and topic suggestions, grounded in what the business has really done and what it could grow into, and where each one is for.

The AI is given only facts the platform holds (services, the saved keywords and how they rank, recent Google posts and articles, the competitor research, the failing AEO/GEO checks of the
homepage, the AI-search questions already tracked, the ChatGPT checklist). It writes the suggestions; nothing is saved until the user picks some. Every suggestion says why, and which
areas it is for: the blog, Google Business Profile posts, AEO (answers), GEO (AI search), the ChatGPT profile, or the website.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Article, Business, GeoPrompt, Keyword, Post
from . import ai, keywords as kwsvc

USES = {"blog": "Blog articles", "gmb_post": "Google Business Profile posts", "aeo": "AEO: direct answers and FAQs", "geo": "GEO: AI search questions", "chatgpt": "ChatGPT business profile", "website": "Website pages"}
HORIZON = {"done": "Builds on what you already do", "next": "Where you can grow next"}
MAX_ITEMS = 24

SYSTEM = (
    "You are a local-SEO strategist. You suggest search keywords and content topics for one business, using ONLY the facts you are given. "
    "Never invent facts about the business, its prices, results or reviews. Every suggestion must be a phrase real customers could type or ask, in the business's own area. "
    "Return JSON only."
)


def _clean(text: Any, n: int) -> str:
    return " ".join(str(text or "").split())[:n]


def evidence(db: Session, b: Business) -> dict[str, Any]:
    """The facts the suggestions are grounded in (also shown to the user, so they can see why)."""
    since = datetime.now(timezone.utc) - timedelta(days=180)
    saved = list(db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True)).order_by(Keyword.volume.desc().nullslast()).limit(40)))
    posts = [p for p in db.scalars(select(Post).where(Post.business_id == b.id, Post.status == "published").order_by(Post.published_at.desc().nullslast()).limit(10))]
    arts = list(db.scalars(select(Article).where(Article.business_id == b.id, Article.status == "completed").order_by(Article.id.desc()).limit(10)))
    prompts = [p.prompt for p in db.scalars(select(GeoPrompt).where(GeoPrompt.business_id == b.id).limit(12))]
    research = kwsvc.competitor_research(db, b)
    gaps = [g["keyword"] for g in ((research or {}).get("gaps") or {}).get("keywords", [])][:10]
    ideas = (research or {}).get("ideas") or {}
    failing: list[str] = []
    try:
        from . import growth_metrics
        report, _why = growth_metrics._latest_xray(db, b)
        for area in ("aeo", "geo"):
            failing += [f"{area.upper()}: {c.get('label')}" for c in ((report or {}).get("scores", {}).get(area) or {}).get("checks", []) if not c.get("passed")][:5]
    except Exception:  # noqa: BLE001 - no homepage check yet: the suggestions simply do not use it
        pass
    chatgpt_open: list[str] = []
    try:
        from ..models import CatalogItem, ChatGPTBusiness
        from . import chatgpt_business as cg
        row = db.scalar(select(ChatGPTBusiness).where(ChatGPTBusiness.business_id == b.id))
        r = cg.readiness(b, row, list(db.scalars(select(CatalogItem).where(CatalogItem.business_id == b.id))))
        chatgpt_open = [str(x.get("label") or x.get("key")) for x in r.get("items", []) if not x.get("done")][:5]
    except Exception:  # noqa: BLE001
        pass
    return {
        "services": [str(s.get("name") if isinstance(s, dict) else s) for s in (b.services or [])][:10],
        "saved": [{"keyword": k.keyword, "rank": k.rank, "volume": k.volume} for k in saved],
        "posts": [_clean(p.title or p.body, 90) for p in posts],
        "articles": [_clean(a.title or a.keyword, 90) for a in arts],
        "geo_prompts": prompts, "competitor_gaps": gaps, "competitor_questions": [str(q) for q in (ideas.get("questions") or [])][:8], "related_searches": [str(q) for q in (ideas.get("related") or [])][:8],
        "failing_ai_checks": failing, "chatgpt_open": chatgpt_open, "researched": research is not None, "since": since.date().isoformat(),
    }


def _prompt(b: Business, ev: dict[str, Any]) -> str:
    saved = "; ".join(f"{k['keyword']}" + (f" (rank {k['rank']})" if k.get("rank") else " (not ranking)") for k in ev["saved"][:25]) or "none yet"
    lines = [
        ai.profile_text(b),
        f"Services: {', '.join(ev['services'])}" if ev["services"] else "",
        f"Keywords already saved: {saved}",
        f"Recent Google Business Profile posts: {' | '.join(ev['posts'])}" if ev["posts"] else "No Google posts yet.",
        f"Blog articles already written: {' | '.join(ev['articles'])}" if ev["articles"] else "No blog articles yet.",
        f"Searches competitors win that this business does not track: {', '.join(ev['competitor_gaps'])}" if ev["competitor_gaps"] else "",
        f"Questions people ask on Google: {' | '.join(ev['competitor_questions'])}" if ev["competitor_questions"] else "",
        f"AI-search questions already tracked: {' | '.join(ev['geo_prompts'])}" if ev["geo_prompts"] else "No AI-search (GEO) questions tracked yet.",
        f"Failing answer-engine checks on the homepage: {'; '.join(ev['failing_ai_checks'])}" if ev["failing_ai_checks"] else "",
        f"Open items on the ChatGPT business profile: {'; '.join(ev['chatgpt_open'])}" if ev["chatgpt_open"] else "",
    ]
    return (
        "\n".join(x for x in lines if x)
        + f"\n\nSuggest up to {MAX_ITEMS} NEW keywords or questions this business should go after (not any already saved). "
        'Split them: "done" = builds directly on what the business already does or has published; "next" = a realistic growth direction for the next 3-6 months based on its services and area. '
        "For each give: keyword (2-9 words, how a customer would search or ask), topic (a short 2-4 word theme to group it under), why (one sentence tied to a fact above, no invention), "
        "intent (local, transactional, commercial or informational), "
        'uses (a list from: "blog" for an article, "gmb_post" for a Google Business Profile post, "aeo" for a direct-answer/FAQ, "geo" for an AI-search question, "chatgpt" for the ChatGPT profile, "website" for a page), '
        'and priority ("High", "Medium" or "Low"). Prefer questions for aeo/geo. Return {"items":[{"keyword":string,"topic":string,"why":string,"intent":string,"uses":[string],"priority":string,"horizon":"done"|"next"}]}'
    )


def normalise(raw: list[Any], saved: set[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen = set(saved)
    for it in raw:
        if not isinstance(it, dict):
            continue
        k = re.sub(r"\s+", " ", str(it.get("keyword") or "").lower()).strip(" ?.!,;:")
        if len(k) < 3 or len(k) > 120 or not 2 <= len(k.split()) <= 10 or k in seen:
            continue
        seen.add(k)
        uses = [u for u in dict.fromkeys(str(x).lower() for x in (it.get("uses") or [])) if u in USES] or ["blog"]
        out.append({"keyword": k, "topic": _clean(it.get("topic"), 60) or None, "why": _clean(it.get("why"), 260), "intent": str(it.get("intent") or "").lower() if str(it.get("intent") or "").lower() in ("local", "transactional", "commercial", "informational") else None,
                    "uses": uses, "priority": str(it.get("priority") or "Medium").title() if str(it.get("priority") or "").title() in ("High", "Medium", "Low") else "Medium",
                    "horizon": "next" if str(it.get("horizon") or "").lower() == "next" else "done"})
        if len(out) >= MAX_ITEMS:
            break
    return out


def suggest(db: Session, b: Business) -> dict[str, Any]:
    if not ai.is_configured():
        raise ai.AiUnavailable("AI is not set up on the SEO platform, so keywords cannot be suggested. Add an AI key to the backend .env.")
    ev = evidence(db, b)
    out = ai.complete_json(SYSTEM, _prompt(b, ev), temperature=0.4, max_tokens=4000)
    items = normalise(out.get("items") or [], {k["keyword"] for k in ev["saved"]})
    return {"items": items, "horizons": HORIZON, "uses": USES, "source": "ai",
            "evidence": {"services": len(ev["services"]), "saved": len(ev["saved"]), "posts": len(ev["posts"]), "articles": len(ev["articles"]), "competitor_gaps": len(ev["competitor_gaps"]),
                         "geo_prompts": len(ev["geo_prompts"]), "failing_ai_checks": len(ev["failing_ai_checks"]), "researched": ev["researched"]},
            "generated_at": datetime.now(timezone.utc).isoformat()}


# ------------------------------------------------------------------------------------------------------------------- where the saved keywords are used
QUESTION = re.compile(r"^(who|what|which|where|when|why|how|is|are|can|do|does|should|will)(?![a-z])", re.I)


def _question_headings(db: Session, b: Business, report: dict[str, Any] | None) -> list[str]:
    """Headings that are questions (the shape an answer engine quotes): the homepage's headings and the headings and titles of finished blog articles."""
    heads = [str(x.get("text") or "") for x in ((report or {}).get("content") or {}).get("outline", []) if isinstance(x, dict)]
    for a in db.scalars(select(Article).where(Article.business_id == b.id, Article.status == "completed")):
        heads.append(a.title or "")
        heads += re.findall(r"^\s{0,3}#{1,4}\s+(.+?)\s*$", a.body or "", re.M)
        heads += [re.sub(r"<[^>]+>", "", h) for h in re.findall(r"<h[1-4][^>]*>(.*?)</h[1-4]>", a.body or "", re.S | re.I)]
    return [h.strip() for h in heads if h.strip() and (h.strip().endswith("?") or QUESTION.match(h.strip()))]


def _chatgpt_texts(db: Session, b: Business) -> list[str]:
    """What the ChatGPT business profile says: its profile copy, policies, the Hub topics people asked about, and the feed items."""
    from ..models import CatalogItem, ChatGPTBusiness
    row = db.scalar(select(ChatGPTBusiness).where(ChatGPTBusiness.business_id == b.id))
    texts: list[str] = []
    if row:
        texts += [row.business_name, row.category, row.description, row.delivery_policy, row.return_policy, row.agent_instructions]
        for m in row.insights or []:
            texts += [str(t) for t in (m.get("topics") or [])]
    for it in db.scalars(select(CatalogItem).where(CatalogItem.business_id == b.id)):
        texts += [it.title, it.description]
    return [t for t in texts if t]


def usage(db: Session, b: Business) -> dict[str, Any]:
    """For each saved keyword: where it is already used (read from the real crawl, profile, posts, articles, question headings, AI questions and the ChatGPT profile) and where it is meant to be used."""
    from . import growth_content as gc, growth_metrics
    rows = list(db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True)).order_by(Keyword.volume.desc().nullslast(), Keyword.keyword)))
    report = None
    try:
        report = growth_metrics._latest_xray(db, b)[0]
    except Exception:  # noqa: BLE001
        pass
    text = gc.surfaces_text(db, b, report, gc._crawl(db, b))
    prompts = gc._corpus([p.prompt for p in db.scalars(select(GeoPrompt).where(GeoPrompt.business_id == b.id))])
    heads = [gc._corpus([h]) for h in _question_headings(db, b, report)]
    chatgpt = gc._corpus(_chatgpt_texts(db, b))
    items = []
    for k in rows:
        used = {"website": gc.has_keyword(text["website"] | text["services"], k.keyword), "blog": gc.has_keyword(text["blog"], k.keyword), "gmb_post": gc.has_keyword(text["posts"], k.keyword),
                "geo": gc.has_keyword(prompts, k.keyword), "aeo": any(gc.has_keyword(h, k.keyword) for h in heads), "chatgpt": gc.has_keyword(chatgpt, k.keyword)}
        planned = [u for u in (k.uses or []) if u in USES]
        items.append({"id": k.id, "keyword": k.keyword, "cluster": k.cluster, "rank": k.rank, "volume": k.volume, "planned": planned, "used": used})
    areas = {a: {"label": label, "planned": sum(1 for i in items if a in i["planned"]), "used": sum(1 for i in items if i["used"].get(a))} for a, label in USES.items()}
    return {"items": items, "areas": areas, "uses": USES, "total": len(items)}


PROVIDER = re.compile(r"(?<![a-z])(agency|agencies|company|companies|clinic|clinics|hospital|hospitals|dentist|dentists|doctor|doctors|consultant|consultants|services?|shop|shops|store|stores|firm|firms|expert|experts|specialist|specialists|studio|studios|centre|centres|center|centers|institute|institutes|classes|salon|salons|lawyer|lawyers|plumber|plumbers|contractor|contractors|designer|designers|developer|developers|photographer|photographers|restaurant|restaurants)(?![a-z])", re.I)


def geo_question(keyword: str) -> str:
    """A customer question from a keyword, for the AI-search (GEO/AEO) tracker. Rules only: always works, and reads naturally for the usual shapes."""
    k = " ".join(keyword.split()).strip(" ?.")
    if QUESTION.match(k):
        return k[0].upper() + k[1:] + "?"
    if re.search(r"(?<![a-z])(cost|price|prices|fees|fee|charges|rate|rates|pricing)(?![a-z])", k, re.I):
        return f"What is the {k}?"
    if PROVIDER.search(k):
        return f"Which is the best {k}?" if not k.lower().startswith("best ") else f"Which is the {k}?"
    return f"Who offers {k}?"


def polished_question(keyword: str) -> str:
    """The same question, rewritten naturally by the AI when it is set up; the rule-based question otherwise (and whenever the AI fails or returns something odd)."""
    base = geo_question(keyword)
    if not ai.is_configured():
        return base
    try:
        out = ai.complete("You rewrite search keywords as one natural question a customer would ask an AI assistant. Keep every place name and the exact meaning; add nothing that is not in the keyword. Reply with the question only.",
                          f"Keyword: {keyword}" + chr(10) + f"Rule-based draft: {base}", temperature=0.2, max_tokens=60)
        q = " ".join(str(out).split()).strip(chr(34) + chr(39) + " ")
        return q if 8 <= len(q) <= 200 and q.endswith("?") else base
    except Exception:  # noqa: BLE001 - the draft is good enough: never block the action on the AI
        return base
