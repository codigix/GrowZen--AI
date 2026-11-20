"""Business understanding: the first step of the SEO work. It reads the live website (the home page and a few service pages), the audit results and what is known about the business, and
writes one structured overview: what the business is and sells, to whom and where, how good its website is, the words customers search with, who its competitors are (and who they are not),
and the keyword themes and next steps that follow. The competitor and keyword research start from the search words written here.

The facts (scores, pages read, issues) come from what was measured. The reading of them (overview, audience, search words, competitor profile) comes from the AI; without an AI the
profile's own details fill the same shape, so the page always has something true to show."""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any

from bs4 import BeautifulSoup
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, Competitor
from . import audits, categories, market
from .net import site_client

log = logging.getLogger("seo.understanding")

_SERVICEISH = re.compile(r"/(services?|treatments?|solutions?|products?|collections?|rent|rental|about|what-we-do|offerings?|shop|categor)", re.I)


def _host(url: str) -> str:
    m = re.match(r"https?://([^/]+)", url or "")
    return (m.group(1) if m else "").lower().removeprefix("www.")


def _digest(url: str, soup: BeautifulSoup) -> dict[str, Any]:
    for t in soup(["script", "style", "noscript", "nav", "footer", "header", "svg"]):
        t.decompose()
    meta = soup.find("meta", attrs={"name": re.compile("^description$", re.I)})
    text = " ".join(soup.get_text(" ", strip=True).split())
    return {"url": url, "title": (soup.title.string or "").strip()[:160] if soup.title and soup.title.string else "",
            "description": ((meta.get("content") or "").strip() if meta else "")[:300], "h1": [h.get_text(" ", strip=True)[:140] for h in soup.find_all("h1")][:2],
            "h2": [h.get_text(" ", strip=True)[:100] for h in soup.find_all("h2")][:8], "words": len(text.split()), "text": text[:1100]}


def read_site(url: str | None, max_pages: int = 4) -> list[dict[str, Any]]:
    """What the website says: the home page and up to three pages about the services (title, description, headings and the start of the text). Empty when it cannot be read."""
    if not url:
        return []
    start = url if url.startswith("http") else f"https://{url}"
    client = site_client(8)
    pages: list[dict[str, Any]] = []
    try:
        try:
            r = client.get(start)
        except Exception as exc:  # noqa: BLE001 - an unreachable site is reported as no pages
            log.info("Could not read %s: %s", start, exc)
            return []
        if r.status_code >= 400 or "html" not in r.headers.get("content-type", ""):
            return []
        soup = BeautifulSoup(r.text, "html.parser")
        host = _host(str(r.url))
        links: list[str] = []
        for a in soup.find_all("a", href=True):
            href = a["href"].split("#")[0]
            if href.startswith("/"):
                href = f"{str(r.url).split('//')[0]}//{str(r.url).split('//')[1].split('/')[0]}{href}"
            if href.startswith("http") and _host(href) == host and href.rstrip("/") != str(r.url).rstrip("/") and href not in links and not re.search(r"\.(pdf|jpe?g|png|gif|webp|zip)$", href, re.I):
                links.append(href)
        links.sort(key=lambda h: 0 if _SERVICEISH.search(h) else 1)
        pages.append(_digest(str(r.url), soup))
        for href in links[: max_pages - 1]:
            try:
                pr = client.get(href)
            except Exception:  # noqa: BLE001
                continue
            if pr.status_code < 400 and "html" in pr.headers.get("content-type", ""):
                pages.append(_digest(str(pr.url), BeautifulSoup(pr.text, "html.parser")))
    finally:
        client.close()
    return pages


def facts(db: Session, b: Business, pages: list[dict[str, Any]]) -> dict[str, Any]:
    """The measured part: the audit scores, the biggest issues and what the website was found to contain."""
    latest = audits.latest(db, b, with_result=False)
    scores = {k: a.score for k, a in latest.items() if a.score is not None and a.data_source != "sample" and k in ("technical", "onpage", "gbp", "citations")}
    issues: list[dict[str, str]] = []
    for k in ("onpage", "technical"):
        a = latest.get(k)
        for i in (a.issues or []) if a else []:
            if i.get("level") in ("critical", "serious"):
                issues.append({"area": str(i.get("area") or k), "level": i["level"], "title": str(i.get("title") or "")[:120], "fix": str(i.get("fix") or "")[:160]})
    return {"scores": scores, "issues": issues[:8], "pages_read": len(pages), "website": b.website, "audited_at": max((a.finished_at.isoformat() for a in latest.values() if a.finished_at), default=None)}


def _fallback(b: Business, pages: list[dict[str, Any]]) -> dict[str, Any]:
    """The same shape from the profile alone, when no AI is available."""
    from . import keywords
    services = [s.get("name") for s in (b.services or []) if s.get("name")]
    rental = categories.rental_seeds(b.name, b.primary_category, services, b.description)
    first = pages[0] if pages else {}
    where = ", ".join(x for x in [b.area, b.city] if x)
    return {
        "overview": (b.description or first.get("description") or f"{b.name} is a {b.primary_category or 'local business'}{f' in {where}' if where else ''}.")[:600],
        "business_model": "rental" if rental else "", "offerings": services[:8] or ([b.primary_category] if b.primary_category else []), "audience": [], "market": where,
        "strengths": [], "weaknesses": [], "website_summary": (first.get("description") or first.get("title") or ""), "customer_search_terms": keywords.default_seeds(b)[:8],
        "competitors_are": "", "competitors_are_not": "", "keyword_themes": [], "next_steps": [],
    }


def _ai(b: Business, pages: list[dict[str, Any]], fct: dict[str, Any]) -> dict[str, Any]:
    from . import ai
    import json
    if not ai.is_configured():
        return {}
    site = [{k: p[k] for k in ("url", "title", "description", "h1", "h2", "text")} for p in pages]
    system = ("You are an SEO strategist writing the business understanding that every later SEO step starts from. Use ONLY the facts given. Never invent services, prices, awards, "
              "years in business or customers. If something is not known, leave it out. Judge what the business really sells and how it makes money: a clothes RENTAL business is not a "
              "clothes SHOP, a dental LAB is not a dental CLINIC. Reply with JSON only.")
    user = (f"The business profile:\n{ai.profile_text(b)}\n\nTarget market: {market.scope(b)}{', ' + ', '.join(market.places(b)[:6]) if market.places(b) else ''}\n\n"
            f"What its website says (pages read):\n{json.dumps(site, ensure_ascii=False)[:6500]}\n\nMeasured facts: {json.dumps(fct, ensure_ascii=False)}\n\n"
            'Write JSON exactly in this shape: {"overview": "3-4 sentences: what the business is, what it sells, to whom and where", "business_model": "one or two words, e.g. rental, retail, '
            'clinic, agency, restaurant", "offerings": ["main products or services, most important first, max 8"], "audience": ["who the customers are, max 4"], "market": "where it '
            'serves customers", "strengths": ["what the website/business does well, max 4, only from the facts"], "weaknesses": ["what holds the SEO back, max 5, from the audit facts and the '
            'site text"], "website_summary": "2-3 sentences: what the website says and how well it explains the business", "customer_search_terms": ["8 phrases real customers type into '
            'Google to find this business, in their own words, without the city"], "competitors_are": "one sentence: what kind of businesses are real competitors", '
            '"competitors_are_not": "one sentence: what kind of businesses look similar but are NOT competitors", "keyword_themes": [{"theme": "name", "keywords": ["3-5 keywords"]}], '
            '"next_steps": ["5 short, ordered SEO actions for this business"]}')
    try:
        data = ai.complete_json(system, user, temperature=0.2, max_tokens=2200)
    except Exception as exc:  # noqa: BLE001 - the profile-only version below is used instead
        log.warning("Business understanding AI call failed: %s", exc)
        return {}
    return data if isinstance(data, dict) else {}


def _clean(data: dict[str, Any], base: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for k, v in data.items():
        if k not in base or v in (None, "", [], {}):
            continue
        if isinstance(base[k], list):
            if isinstance(v, list):
                out[k] = [x for x in v if x][:10] if k != "keyword_themes" else [{"theme": str(x.get("theme", ""))[:60], "keywords": [str(y)[:60] for y in (x.get("keywords") or [])][:6]}
                                                                                   for x in v if isinstance(x, dict) and x.get("theme")][:6]
        elif isinstance(v, str):
            out[k] = v.strip()[:900]
    out["offerings"] = [str(x)[:80] for x in out["offerings"]]
    out["customer_search_terms"] = list(dict.fromkeys(str(x).strip().lower()[:60] for x in out["customer_search_terms"] if str(x).strip()))[:10]
    return out


def build(db: Session, b: Business) -> dict[str, Any]:
    """Read the website, gather the measured facts, ask the AI and keep the result on the project (business_brief)."""
    pages = read_site(b.website)
    fct = facts(db, b, pages)
    base = _fallback(b, pages)
    ai_data = _ai(b, pages, fct)
    brief = _clean(ai_data, base) | {"facts": fct, "pages": [{"url": p["url"], "title": p["title"], "words": p["words"]} for p in pages], "by_ai": bool(ai_data),
                                    "built_at": datetime.now(timezone.utc).isoformat(),
                                    "competitors_saved": [c.name for c in db.scalars(select(Competitor).where(Competitor.business_id == b.id).limit(10))]}
    b.business_brief = brief
    db.commit()
    return brief


def search_terms(b: Business) -> list[str]:
    """The customer search words written in the business understanding (empty before it was built): competitor and keyword research start from these."""
    brief = getattr(b, "business_brief", None) or {}
    return [t for t in (brief.get("customer_search_terms") or []) if isinstance(t, str) and t.strip()]
