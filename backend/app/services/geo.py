"""GEO / AEO tracker: does the business get named when customers ask AI engines?

Runs each prompt through every configured engine (OpenAI-compatible: OpenAI, Gemini, DeepSeek,
Perplexity; plus Anthropic), then checks the answer for the business name, its position in a
list, cited URLs and competitors. Engines without a key are skipped; with none at all, sample
results are stored and labelled. API answers can differ from logged-in apps: read as a trend.
"""
import random
import re
from typing import Any

import httpx
from openai import OpenAI
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Business, GeoPrompt, GeoResult

URL_RE = re.compile(r"https?://[^\s)\]>\"']+")


def _engines() -> dict[str, Any]:
    s = get_settings()
    found: dict[str, Any] = {}
    if s.openai_api_key:
        found["ChatGPT"] = ("openai", None, s.openai_api_key, "gpt-4o-mini")
    if s.gemini_api_key:
        found["Gemini"] = ("openai", "https://generativelanguage.googleapis.com/v1beta/openai/", s.gemini_api_key, "gemini-1.5-flash")
    if s.perplexity_api_key:
        found["Perplexity"] = ("openai", "https://api.perplexity.ai", s.perplexity_api_key, "sonar")
    if s.deepseek_api_key:
        found["DeepSeek"] = ("openai", "https://api.deepseek.com", s.deepseek_api_key, "deepseek-chat")
    if s.anthropic_api_key:
        found["Claude"] = ("anthropic", None, s.anthropic_api_key, "claude-haiku-5-5")
    return found


def _ask(engine: tuple, prompt: str) -> str:
    kind, base, key, model = engine
    if kind == "anthropic":
        r = httpx.post("https://api.anthropic.com/v1/messages", headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
                       json={"model": model, "max_tokens": 800, "messages": [{"role": "user", "content": prompt}]}, timeout=60)
        r.raise_for_status()
        return "".join(c.get("text", "") for c in r.json().get("content", []))
    client = OpenAI(base_url=base, api_key=key, timeout=60)
    r = client.chat.completions.create(model=model, max_tokens=800, messages=[{"role": "user", "content": prompt}])
    return r.choices[0].message.content or ""


def analyse_answer(answer: str, business: Business, competitors: list[str]) -> dict[str, Any]:
    """Is the business named, where in a list, with which competitors and cited URLs (pure)."""
    low = answer.lower()
    names = [business.name.lower()] + ([business.name.split(" ")[0].lower()] if len(business.name.split(" ")[0]) > 4 else [])
    hit = next((low.find(n) for n in names if n in low), -1)
    position = None
    if hit >= 0:
        # List items started before the mention, its own line included: the 2nd item -> 2.
        position = max(1, len(re.findall(r"(?m)^\s*(?:\d+[.)]|[-*•])\s+", answer[:hit])))
    tone = None
    if hit >= 0:
        window = low[max(0, hit - 200): hit + 300]
        tone = "negative" if re.search(r"complain|poor|bad|avoid|negative", window) else "positive" if re.search(r"highly|recommend|best|excellent|top|trusted|popular", window) else "neutral"
    return {"mentioned": hit >= 0, "position": position, "sentiment": tone,
            "competitors": [c for c in competitors if c.lower() in low], "cited_urls": URL_RE.findall(answer)[:10],
            "excerpt": answer[max(0, hit - 150): hit + 350] if hit >= 0 else answer[:400]}


def default_prompts(b: Business) -> list[str]:
    cat = (b.primary_category or "business").lower()
    place = b.area or b.city or ""
    svc = [s.get("name", "").lower() for s in (b.services or []) if s.get("name")]
    out = [f"best {cat} in {place}", f"{cat} near {place} {b.city or ''}".strip(), f"is {b.name} good", f"top rated {cat} {b.city or place}"]
    if svc:
        out += [f"{svc[0]} in {b.city or place} cost", f"where to get {svc[0]} in {place}"]
    return out


def run_prompts(db: Session, b: Business, competitors: list[str] | None = None) -> dict[str, Any]:
    prompts = list(db.scalars(select(GeoPrompt).where(GeoPrompt.business_id == b.id, GeoPrompt.active.is_(True))))
    if not prompts:
        prompts = [GeoPrompt(business_id=b.id, prompt=p) for p in default_prompts(b)]
        db.add_all(prompts)
        db.commit()
    engines = _engines()
    competitors = competitors or []
    saved = 0
    if engines:
        for p in prompts:
            for name, engine in engines.items():
                try:
                    a = analyse_answer(_ask(engine, p.prompt), b, competitors)
                except Exception as exc:  # one engine failing must not stop the run
                    a = {"mentioned": False, "position": None, "sentiment": None, "competitors": [], "cited_urls": [], "excerpt": f"error: {exc}"[:400]}
                db.add(GeoResult(business_id=b.id, prompt_id=p.id, engine=name, mentioned=a["mentioned"], position=a["position"], sentiment=a["sentiment"],
                                 competitors=a["competitors"], cited_urls=a["cited_urls"], answer_excerpt=a["excerpt"], data_source="live"))
                saved += 1
    else:
        r = random.Random(f"geo-{b.id}")
        for p in prompts:
            for name in ("ChatGPT", "Gemini", "Perplexity", "Claude", "AI Overviews"):
                m = r.random() < 0.35
                db.add(GeoResult(business_id=b.id, prompt_id=p.id, engine=name, mentioned=m, position=r.randint(1, 5) if m else None,
                                 sentiment="positive" if m else None, data_source="sample"))
                saved += 1
    db.commit()
    return share_of_voice(db, b)


def share_of_voice(db: Session, b: Business) -> dict[str, Any]:
    """Share of prompts naming the business, per engine, from the latest result per prompt+engine."""
    latest: dict[tuple[int, str], GeoResult] = {}
    for g in db.scalars(select(GeoResult).where(GeoResult.business_id == b.id).order_by(GeoResult.created_at.desc())):
        latest.setdefault((g.prompt_id, g.engine), g)
    by_engine: dict[str, list[bool]] = {}
    for (_, engine), g in latest.items():
        by_engine.setdefault(engine, []).append(g.mentioned)
    per = {e: round(sum(v) / len(v) * 100) for e, v in by_engine.items() if v}
    sources: dict[str, int] = {}
    for g in latest.values():
        for u in g.cited_urls or []:
            host = re.sub(r"^https?://(www\.)?", "", u).split("/")[0]
            sources[host] = sources.get(host, 0) + 1
    return {"overall": round(sum(per.values()) / len(per)) if per else 0, "per_engine": per,
            "top_sources": sorted(({"host": h, "citations": n} for h, n in sources.items()), key=lambda x: -x["citations"])[:10],
            "data_source": next(iter(latest.values())).data_source if latest else None}
