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

_SERVICEISH = re.compile(r"/(services?|treatments?|solutions?|products?|collections?|rent|rental|about|what-we-do|offerings?|shop|categor|industr|sectors?|who-we|we-serve|specialit|expertise|capabilit|case-stud|portfolio|work|clients?|seo|ppc|marketing|digital|design|development|packages?|pricing)", re.I)
EDITABLE_TEXT = ("business_type", "business_model", "industry_focus", "market", "competitors_are", "competitors_are_not")
EDITABLE_LISTS = ("offerings", "audience", "customer_search_terms", "competitor_queries")


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
            "h2": [h.get_text(" ", strip=True)[:100] for h in soup.find_all("h2")][:10], "words": len(text.split()), "text": text[:1700]}


def read_site(url: str | None, max_pages: int = 8) -> list[dict[str, Any]]:
    """What the website says: the home page and up to seven pages about the business, its services and who it serves (title, description, headings and the start of the text). Empty when it cannot be read."""
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
        "business_model": "rental" if rental else "", "business_type": (b.primary_category or "") if not rental else "rental", "industry_focus": "", "competitor_queries": [], "offerings": services[:8] or ([b.primary_category] if b.primary_category else []), "audience": [], "market": where,
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
              "years in business or customers. If something is not known, leave it out. Judge what the business really sells, to whom, and how it makes money (the service AND the customer group both decide who its competitors are): a clothes RENTAL business is not a "
              "clothes SHOP, a dental LAB is not a dental CLINIC. Reply with JSON only.")
    user = (f"The business profile:\n{ai.profile_text(b)}\n\nTarget market: {market.scope(b)}{', ' + ', '.join(market.places(b)[:6]) if market.places(b) else ''}\n\n"
            f"What its website says (pages read):\n{json.dumps(site, ensure_ascii=False)[:12000]}\n\nMeasured facts: {json.dumps(fct, ensure_ascii=False)}\n\n"
            'Write JSON exactly in this shape: {"overview": "3-4 sentences: what the business is, what it sells, to whom and where", "business_model": "one or two words, e.g. rental, retail, '
            'clinic, agency, restaurant", "business_type": "the SPECIFIC kind of business in 3 to 7 words, the way a customer would name it, including who it serves when that matters, e.g. '
            'digital marketing agency for healthcare, bridal wear rental shop, pediatric dental clinic. Never just a generic word like agency or shop", "industry_focus": "the industry or '
            'customer group it specialises in, or empty if it serves everyone", "offerings": ["main products or services, most important first, max 8"], "audience": ["who the customers are, max 4"], "market": "where it '
            'serves customers", "strengths": ["what the website/business does well, max 4, only from the facts"], "weaknesses": ["what holds the SEO back, max 5, from the audit facts and the '
            'site text"], "website_summary": "2-3 sentences: what the website says and how well it explains the business", "customer_search_terms": ["8 phrases real customers type into '
            'Google to find this business, in their own words, without the city"], "competitors_are": "one sentence naming the SAME service, the SAME kind of customer and the same area as this business", '
            '"competitors_are_not": "one sentence: what kind of businesses look similar but are NOT competitors", "competitor_queries": ["6 phrases a business owner would type into Google to '
            'find a provider like this one, including the city or area, e.g. healthcare digital marketing agency pune"], "keyword_themes": [{"theme": "name", "keywords": ["3-5 keywords"]}], '
            '"next_steps": ["5 short, ordered SEO actions for this business"]}')
    try:
        data = ai.complete_json(system, user, temperature=0.2, max_tokens=2800)
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
    from ..db import release_connection  # noqa: PLC0415
    release_connection(db)  # the facts are read: no connection is held while the AI answers
    ai_data = _ai(b, pages, fct)
    old_edits = dict((getattr(b, "business_brief", None) or {}).get("edits") or {})
    brief = _clean(ai_data, base) | {"facts": fct, "pages": [{"url": p["url"], "title": p["title"], "words": p["words"]} for p in pages], "by_ai": bool(ai_data),
                                    "built_at": datetime.now(timezone.utc).isoformat(),
                                    "competitors_saved": [c.name for c in db.scalars(select(Competitor).where(Competitor.business_id == b.id).limit(10))]}
    brief = _apply_edits(brief, old_edits)
    b.business_brief = brief
    db.commit()
    return brief


def _apply_edits(brief: dict[str, Any], edits: dict[str, Any]) -> dict[str, Any]:
    """What a person wrote stays, whatever the next AI reading says: their words are laid over the new brief and listed in `edits` so the page can say so."""
    keep = {k: v for k, v in (edits or {}).items() if k in (*EDITABLE_TEXT, *EDITABLE_LISTS)}
    return {**brief, **keep, "edits": keep}


def save_edits(db: Session, b: Business, changes: dict[str, Any], reset: list[str] | None = None, who: str = "") -> dict[str, Any]:
    """The owner corrects the understanding by hand: the competitor and keyword research then start from these words. `reset` hands a field back to the AI's own reading on the next refresh."""
    brief = dict(getattr(b, "business_brief", None) or {})
    if not brief:
        raise ValueError("Build the business understanding first, then correct it.")
    edits = dict(brief.get("edits") or {})
    for k, v in changes.items():
        if k in EDITABLE_TEXT:
            edits[k] = str(v or "").strip()[:900]
        elif k in EDITABLE_LISTS:
            items = v if isinstance(v, list) else str(v or "").splitlines()
            low = k == "customer_search_terms"  # search words are kept in lower case, once each
            edits[k] = list(dict.fromkeys((str(x).strip().lower() if low else str(x).strip())[:90] for x in items if str(x).strip()))[:12]
    for k in reset or []:
        edits.pop(k, None)
    brief = _apply_edits(brief, edits)
    brief["edited_at"], brief["edited_by"] = datetime.now(timezone.utc).isoformat(), who
    b.business_brief = brief
    db.commit()
    return brief


def prompt_block(b: Any) -> str:
    """The business understanding as text for an AI prompt: the facts every competitor and keyword decision must respect (empty before the summary was built)."""
    brief = getattr(b, "business_brief", None) or {}
    if not brief:
        return ""
    lines = [
        "BUSINESS UNDERSTANDING (decide everything below by this):",
        f"- Kind of business: {brief.get('business_type') or brief.get('business_model')}" if (brief.get("business_type") or brief.get("business_model")) else "",
        f"- Industry or customer group it serves: {brief.get('industry_focus')}" if brief.get("industry_focus") else "",
        f"- Target area: {brief.get('market')}" if brief.get("market") else "",
        f"- What it sells: {'; '.join(brief.get('offerings') or [])}" if brief.get("offerings") else "",
        f"- Customers: {'; '.join(brief.get('audience') or [])}" if brief.get("audience") else "",
        f"- Words customers search with: {', '.join(brief.get('customer_search_terms') or [])}" if brief.get("customer_search_terms") else "",
        f"- Counts as a competitor: {brief.get('competitors_are')}" if brief.get("competitors_are") else "",
        f"- Does NOT count as a competitor, never suggest for it: {brief.get('competitors_are_not')}" if brief.get("competitors_are_not") else "",
        f"- Phrases that find providers like this one: {', '.join(brief.get('competitor_queries') or [])}" if brief.get("competitor_queries") else "",
    ]
    return "\n".join(x for x in lines if x)


def basis(b: Any) -> dict[str, Any]:
    """What a competitor or keyword run was based on, for the page to show: the kind of business, area, search words and whether the summary exists."""
    brief = getattr(b, "business_brief", None) or {}
    return {"used": bool(brief), "model": brief.get("business_type") or brief.get("business_model"), "industry": brief.get("industry_focus"), "edited": sorted((brief.get("edits") or {}).keys()), "market": brief.get("market"), "terms": search_terms(b)[:8], "offerings": (brief.get("offerings") or [])[:6],
            "counts": brief.get("competitors_are"), "does_not_count": brief.get("competitors_are_not"), "built_at": brief.get("built_at")}


def search_terms(b: Business) -> list[str]:
    """The customer search words written in the business understanding (empty before it was built): competitor and keyword research start from these."""
    brief = getattr(b, "business_brief", None) or {}
    return [t for t in (brief.get("customer_search_terms") or []) if isinstance(t, str) and t.strip()]
