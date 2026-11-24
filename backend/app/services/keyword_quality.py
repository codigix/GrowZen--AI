"""Is a phrase a keyword somebody could search, and is it about what this business sells?

Pages, competitor sites and suggestion lists hand over a lot of phrases that are not keywords at all: slogans ("we craft digital growth for bold brands"), cut-off pieces of a sentence
("pune for clinics", "vs regular seo what's"), a place on its own ("viman nagar"), or words that have nothing to do with the business ("smart investment", "maintenance tips").
`problem()` says why a phrase is not worth keeping, or returns None. It judges only the wording and the business's own words (its services, categories, summary and seeds):
it never guesses at the market, so what passes is still checked by the AI fit check.
"""
from __future__ import annotations

import re
from typing import Any

from ..models import Business

PERSON = frozenset({"we", "our", "your", "you", "us", "my", "i", "ours", "yours"})
SLOGAN = frozenset({"tailored", "bold", "crafted", "craft", "provides", "provide", "offering", "offers", "ensure", "ensures", "delivers", "essential", "empower", "empowers", "unlock", "transform"})
LEAD_BAD = frozenset({"to", "for", "of", "and", "with", "by", "in", "on", "at", "the", "a", "an", "from", "that", "or", "vs", "than"})
TRAIL_BAD = frozenset({"to", "for", "of", "and", "with", "by", "in", "on", "at", "the", "a", "an", "from", "that", "or", "is", "are", "vs", "what", "what's", "what’s", "than", "your", "our", "you", "we"})
GENERIC = frozenset({"best", "top", "online", "service", "services", "solution", "solutions", "company", "companies", "near", "me", "in", "for", "of", "the", "and", "pvt", "ltd", "india", "agency",
                     "agencies", "new", "good", "great", "right", "all", "more", "get", "free", "how", "what", "why", "with", "from", "that", "this", "full", "complete", "professional", "expert", "experts",
                     "management", "strategy", "strategies", "plan", "plans", "tips", "guide", "work", "team", "business", "businesses", "support", "help"})


QUESTION = frozenset({"how", "what", "why", "when", "where", "which", "who", "can", "does", "do", "is", "are", "should", "will"})
FAMILIES = (frozenset({"ad", "ads", "advertising", "advertisement", "advertisements", "ppc", "campaign", "campaigns", "paid"}),)  # words that mean the same thing for a business


def _stem(w: str) -> str:
    return w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w


def _words(text: str | None) -> list[str]:
    return re.findall(r"[a-z0-9'’&]+", (text or "").lower())


def vocabulary(b: Business) -> set[str]:
    """The stemmed words the business itself uses for what it sells: its service names, categories, summary offerings and keyword themes, and its seeds. Generic words and places are left out."""
    from . import keywords, market
    texts: list[str] = [str((s or {}).get("name") or "") if isinstance(s, dict) else str(s) for s in (b.services or [])]
    texts += [c for c in [b.primary_category, *(b.secondary_categories or [])] if c]
    brief = getattr(b, "business_brief", None) or {}
    texts += [str(x) for x in (brief.get("offerings") or [])] + [str(x) for x in (brief.get("customer_search_terms") or [])]
    for th in brief.get("keyword_themes") or []:
        texts.append(str(th.get("theme") or "") if isinstance(th, dict) else str(th))
    try:
        texts += [s for s in keywords.default_seeds(b) if isinstance(s, str)]
    except Exception:  # noqa: BLE001 -- the seeds are only one source of words
        pass
    places = {w for p in (market.places(b) or []) for w in _words(p)} | set(_words(b.city)) | set(_words(b.area)) | {w for a in (b.target_areas or []) for w in _words(a)}
    out = {_stem(w) for t in texts for w in _words(t) if len(w) > 2 and w not in GENERIC and w not in places and not w.isdigit()}
    out -= {_stem(g) for g in GENERIC}
    for fam in FAMILIES:  # one word of a family in the business's own words makes the whole family its own
        if {_stem(w) for w in fam} & out:
            out |= {_stem(w) for w in fam}
    return out


def problem(keyword: str, vocab: set[str], places: set[str] | None = None) -> str | None:
    """Why this phrase should not be kept as a keyword, or None when it can stay."""
    words = _words(keyword)
    if not words:
        return "Empty."
    question = words[0] in QUESTION
    if len(words) > (12 if question else 9):
        return "Too long to be a search: it is a sentence."
    if PERSON & set(words) and not question:
        return "Reads as a line of marketing copy (\"we\", \"our\", \"your\"), not something people search."
    if SLOGAN & set(words) and len(words) >= 4:
        return "Reads as a slogan, not a search."
    if words[0] in LEAD_BAD or words[-1] in TRAIL_BAD:
        return "A cut-off piece of a sentence, not a complete search."
    if not ({_stem(w) for w in words} & vocab):
        if places and all(w in places or w in GENERIC for w in words):
            return "Only a place name: it says nothing about what the business sells."
        return "Has none of the words the business uses for what it sells."
    return None


def check_all(b: Business, phrases: list[str]) -> dict[str, str]:
    """{phrase: reason} for the phrases that should not be kept."""
    from . import market
    vocab = vocabulary(b)
    if len(vocab) < 3:  # too little is known about the business to say what is off topic
        return {}
    places = {w for p in (market.places(b) or []) for w in _words(p)} | set(_words(b.city)) | set(_words(b.area))
    out: dict[str, str] = {}
    for p in phrases:
        why = problem(p, vocab, places)
        if why:
            out[p] = why
    return out


def explain(why: str) -> dict[str, Any]:
    return {"fit": "no", "why": why[:160], "for": "", "auto": True, "rule": True}
