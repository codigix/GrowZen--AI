"""Is a business on Google Maps really a competitor? Each one is rated on the six things that decide it, from Google's own data and an AI read of what it sells:

    Similar services     very high   do they sell what this business sells (a clothes RENTAL is not a clothes SHOP)
    Target area          very high   the same customers (distance from the pin, same neighbourhood)
    Keyword overlap      very high   do they show up for the same searches
    Google SERP presence very high   how high they rank for those searches (Maps position)
    Search intent        high        would a customer searching these words be happy with either (rent vs buy)
    Domain authority     medium      strength of the site: it never makes a business relevant by itself

Services and intent are judged by the AI from the business profile and what the competitor says about itself (name, Google category, address and the title and description of its
website). When no AI is set up, a word-overlap check does it. The result is a 0-100 score and a label: direct competitor, related business, or not a real competitor."""
from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any

log = logging.getLogger("seo.relevance")

# The weights: "very high" criteria 30/20/20/15, "high" 10, "medium" 5 (a factor that could not be measured is left out and the rest are scaled up)
WEIGHTS = {"services": 30, "area": 20, "keywords": 20, "serp": 15, "intent": 10, "authority": 5}
DIRECT_AT, RELATED_AT = 65, 40
LABEL = {"direct": "Direct competitor", "related": "Related business", "unrelated": "Not a real competitor"}

_RENT = re.compile(r"\b(rent|rental|rentals|on rent|for rent|hire|hiring|lease)\b", re.I)
_STOP = set("the and for with from your our you are all any can has have not this that shop store centre center services service company pvt ltd private limited india pune near best top in of to a an on at by".split())


def _words(text: str | None) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if len(w) > 2 and w not in _STOP}


def area_score(distance_m: float | None, same_place: bool) -> int:
    """The same customers: how near the competitor is to this business (straight line from its pin)."""
    if distance_m is None:
        return 70 if same_place else 45
    for limit, score in ((1000, 100), (3000, 88), (5000, 72), (10000, 50), (20000, 28)):
        if distance_m <= limit:
            return score
    return 8


def keyword_score(appearances: int, n_keywords: int) -> int:
    """Whether they show up for the same searches: the share of this business's searches they appear in."""
    return round(min(1.0, appearances / max(1, n_keywords)) * 100)


def serp_score(best: int | None, avg: float | None) -> int:
    """How high they rank for those searches (Google Maps position): first place is 100, the tenth is about 20."""
    if not best:
        return 0
    top = max(0, 100 - (best - 1) * 9)
    mean = max(0, 100 - ((avg or best) - 1) * 9)
    return round(0.6 * top + 0.4 * mean)


def heuristic_fit(own_text: str, rental: bool, cand: dict[str, Any]) -> dict[str, Any]:
    """Services and intent from the words alone, when the AI cannot be asked."""
    text = " ".join(str(cand.get(k) or "") for k in ("name", "category", "site_title", "site_description"))
    mine, theirs = _words(own_text), _words(text)
    overlap = len(mine & theirs) / max(1, min(len(mine), 12))
    cand_rental = bool(_RENT.search(text))
    services = round(min(1.0, overlap * 1.6) * 100)
    if rental and not cand_rental:
        services, intent, kind = min(services, 25), 12, "shop"
    elif rental:
        intent, kind = 95, "rental"
    elif cand_rental:
        intent, kind = 40, "rental"
    else:
        intent, kind = 75, "business"
    return {"services": services, "intent": intent, "kind": kind, "reason": "Judged from the words in its name, category and website (the AI was not available)."}


def _ai_fit(b: Any, cands: list[dict[str, Any]], keywords: list[str]) -> dict[int, dict[str, Any]]:
    from ..services import ai
    if not ai.is_configured():
        return {}
    listing = [{"i": i, "name": c.get("name"), "google_category": c.get("category"), "address": c.get("address"), "website": c.get("website"),
                "site_title": c.get("site_title"), "site_description": c.get("site_description")} for i, c in enumerate(cands)]
    system = ("You decide whether businesses found on Google Maps are real competitors of one business. Judge by what each one actually sells and to whom, not by how similar the names or "
              "Google categories look: a shop that SELLS clothes is not a competitor of a business that RENTS clothes, and a dentist is not a competitor of a dental lab. "
              "Reply with JSON only.")
    import json
    from ..services import business_understanding
    brief = business_understanding.prompt_block(b)
    user = (f"The business:\n{ai.profile_text(b)}\n\n{brief + chr(10) + chr(10) if brief else ''}Customers find it by searching: {', '.join(keywords)}\n\nBusinesses found nearby:\n{json.dumps(listing, ensure_ascii=False)}\n\n"
            "For each one give: same_services (0-100: does it offer the same products or services), same_intent (0-100: would a customer who searches the words above be satisfied by it "
            "instead, for example renting versus buying), kind (2 or 3 words: what it really is, e.g. 'clothing rental', 'saree shop', 'makeup studio') and reason (one short sentence naming "
            'the deciding fact). Answer exactly: {"results": [{"i": 0, "same_services": 0, "same_intent": 0, "kind": "", "reason": ""}]}')
    try:
        data = ai.complete_json(system, user, temperature=0.1, max_tokens=min(4000, 120 * len(cands) + 300))
    except Exception as exc:  # noqa: BLE001 - the word check below still gives an answer
        log.warning("AI relevance check failed: %s", exc)
        return {}
    out: dict[int, dict[str, Any]] = {}
    for r in data.get("results") or []:
        try:
            out[int(r["i"])] = {"services": max(0, min(100, int(r.get("same_services", 0)))), "intent": max(0, min(100, int(r.get("same_intent", 0)))),
                                "kind": str(r.get("kind") or "")[:40], "reason": str(r.get("reason") or "")[:220]}
        except (KeyError, ValueError, TypeError):
            continue
    return out


def _site_text(cands: list[dict[str, Any]], fetch) -> None:
    """The title and description of each competitor's own website (home page only), read in parallel: what it says about itself."""
    def one(c: dict[str, Any]) -> None:
        url = c.get("website")
        if not url:
            return
        try:
            pages = (fetch(url) or {}).get("pages") or []
        except Exception:  # noqa: BLE001 - a slow or broken site is simply not read
            return
        if pages:
            c["site_title"] = (pages[0].get("title") or "")[:160]
            c["site_description"] = (pages[0].get("meta_description") or pages[0].get("description") or "")[:260]
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(one, cands))


def rate(b: Any, candidates: list[dict[str, Any]], keywords: list[str], authority: dict[str, int] | None = None, fetch_site=None, own_rental: bool = False) -> dict[str, Any]:
    """Rate every candidate Maps business (the dicts are given a "relevance" entry). Returns the counts and how the services and intent were judged."""
    authority = authority or {}
    cands = candidates[:20]
    if fetch_site:
        _site_text(cands, fetch_site)
    g = lambda k, d=None: getattr(b, k, d)  # noqa: E731 - a plain object may lack some fields
    own_text = " ".join(str(x) for x in [g("name", ""), g("primary_category", ""), " ".join(g("secondary_categories") or []), " ".join((s.get("name") or "") for s in (g("services") or [])), (g("description") or "")[:500]])
    try:
        ai_out = _ai_fit(b, cands, keywords)
    except Exception as exc:  # noqa: BLE001 - never let the AI step stop the research
        log.warning("AI relevance step failed: %s", exc)
        ai_out = {}
    place_words = _words(f"{getattr(b, 'area', '') or ''} {getattr(b, 'city', '') or ''}")
    n_kw = max(1, len(keywords))
    counts = {"direct": 0, "related": 0, "unrelated": 0}
    for i, c in enumerate(cands):
        fit = heuristic_fit(own_text, own_rental, c)
        judged = "ai" if i in ai_out else "words"
        if i in ai_out:
            fit = {**fit, **ai_out[i]}
        same_place = bool(place_words & _words(c.get("address")))
        factors = {
            "services": fit["services"], "area": area_score(c.get("distance_m"), same_place), "keywords": keyword_score(c.get("appearances") or 0, n_kw),
            "serp": serp_score(c.get("best"), c.get("avg_position")), "intent": fit["intent"],
        }
        da = authority.get((c.get("domain") or "").lower())
        if da is not None:
            factors["authority"] = max(0, min(100, int(da)))
        weight = {k: WEIGHTS[k] for k in factors}
        total = round(sum(factors[k] * weight[k] for k in factors) / sum(weight.values()))
        # What a business is decides first: one that does not offer the same thing (or serve the same need) is not a competitor however near or visible it is.
        if min(factors["services"], factors["intent"]) < 40:
            total = min(total, RELATED_AT - 1)
        label = "direct" if total >= DIRECT_AT else "related" if total >= RELATED_AT else "unrelated"
        counts[label] += 1
        c["relevance"] = {"score": total, "label": label, "label_text": LABEL[label], "factors": factors, "kind": fit.get("kind"), "reason": fit.get("reason"), "judged_by": judged,
                          "authority_known": da is not None}
    return {"counts": counts, "ai": bool(ai_out), "weights": WEIGHTS, "rated": len(cands), "rental": own_rental}
