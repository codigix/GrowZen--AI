"""SERP X-Ray: what the live Google results for one search look like, and where the project stands in them.

Everything is read, never estimated:
  * the organic results, the SERP features and the project's own position come from Google's results through Serper (one request, the top 100),
  * each of the top 10 pages is opened through the SSRF-safe client for its length, headings, FAQ, schema and technology,
  * the domain's age and registrar come from RDAP (public registry data).
A page or lookup that cannot be read keeps null fields and is counted in `notes`: no value is ever guessed.
"""
import statistics
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

from bs4 import BeautifulSoup

from ..competitors import intel
from . import organic, page_xray, serp_benchmark

CACHE_SECONDS = 600  # the same search by the same user answers from memory for 10 minutes (protects the Serper quota)
RDAP_CACHE_SECONDS = 7 * 24 * 3600  # a domain's registration date does not change from one day to the next
TOP = 10
THIN_WORDS = 50  # below this a page is not a comparable article
_cache: dict[tuple, tuple[float, dict[str, Any]]] = {}
_rdap_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_lock = threading.Lock()


# ----------------------------------------------------------------------------------------------------------------- Google
def _serper_search(b: Any, keyword: str, location: str, language: str, country: str) -> dict[str, Any]:
    """One live request for the top 100 results (never from Serper's own cache: the X-Ray shows Google as it is now)."""
    return intel.Serper(country, language, fresh=True).search(keyword, location, num=organic.DEPTH)


def parse_features(res: dict[str, Any]) -> dict[str, Any]:
    """The SERP features Google returned for this search, in plain fields."""
    box = res.get("answerBox") or None
    snippet = None
    if box:
        snippet = {"type": "answer" if box.get("answer") else "snippet", "title": box.get("title"), "url": box.get("link"),
                   "text": box.get("answer") or box.get("snippet") or None}
    paa = [{"question": q.get("question"), "snippet": q.get("snippet"), "url": q.get("link")} for q in res.get("peopleAlsoAsk") or [] if q.get("question")]
    related = [q.get("query") for q in res.get("relatedSearches") or [] if q.get("query")]
    pack = [{"name": p.get("title"), "rating": p.get("rating"), "reviews": p.get("ratingCount") or p.get("reviews")} for p in res.get("places") or [] if p.get("title")]
    return {"featured_snippet": snippet, "people_also_ask": paa, "related_searches": related, "knowledge_graph": bool(res.get("knowledgeGraph")),
            "local_pack": pack, "videos": len(res.get("videos") or []), "images": bool(res.get("images")), "top_stories": len(res.get("topStories") or []),
            "shopping": bool(res.get("shopping"))}


# ----------------------------------------------------------------------------------------------------------------- enrichment
def rdap_cached(host: str) -> dict[str, Any]:
    root = page_xray._host_key(host)
    if not root:
        return {"age_days": None, "registrar": None}
    with _lock:
        hit = _rdap_cache.get(root)
        if hit and time.time() - hit[0] < RDAP_CACHE_SECONDS:
            return hit[1]
    try:
        d = page_xray.rdap_lookup(root)
    except Exception:  # noqa: BLE001 - a lookup that fails is a null, never an error for the whole answer
        d = {}
    slim = {"age_days": d.get("age_days"), "registrar": d.get("registrar")}
    if slim["age_days"] is not None or slim["registrar"]:  # a failed lookup is not cached, so the next X-Ray tries again
        with _lock:
            _rdap_cache[root] = (time.time(), slim)
    return slim


def _read_page(url: str) -> dict[str, Any] | None:
    """Length, headings, FAQ, schema types, CMS and analytics of one result page, from ONE fetch. None when the page cannot be read."""
    try:
        f = page_xray.fetch_page(url)
    except Exception:  # noqa: BLE001 - blocked address, timeout, non-HTML: the page is simply not read
        return None
    if f.status >= 400 or not f.html:
        return None
    base = serp_benchmark.analyse_html(f.html)
    try:
        soup = BeautifulSoup(f.html, "html.parser")
        _blocks, objects, _errors = page_xray.parse_json_ld(soup)
        types = sorted({t for o in objects for t in page_xray._types_of(o)})
    except Exception:  # noqa: BLE001
        types = []
    try:
        tech = page_xray.detect_tech(f)
    except Exception:  # noqa: BLE001
        tech = {}
    return {"word_count": base["word_count"], "headings": base["headings"], "has_faq": bool(base["has_faq"] or "FAQPage" in types), "schema_types": types,
            "cms": tech.get("cms"), "analytics": list(tech.get("analytics") or [])}


def _enrich(item: dict[str, Any]) -> dict[str, Any]:
    page = _read_page(item["url"]) if item.pop("_fetchable", False) else None
    dom = rdap_cached(item["domain"])
    listing = intel.is_directory(item["domain"])  # social profiles, marketplaces and listing sites: not articles to compare with
    thin = bool(page) and page["word_count"] < THIN_WORDS  # almost no readable text: a page built by JavaScript, a login wall or a redirect
    note = ("A social or listing site: its page is not an article, so it is left out of the length and FAQ comparison." if listing and page else
            "Very little readable text: the page is probably built by JavaScript or blocked, so it is left out of the comparison." if thin else None)
    return {**item, "domain_age_days": dom.get("age_days"), "registrar": dom.get("registrar"), "fetched": bool(page),
            "word_count": page["word_count"] if page else None, "headings": page["headings"] if page else None, "has_faq": page["has_faq"] if page else None,
            "schema_types": page["schema_types"] if page else [], "cms": page["cms"] if page else None, "analytics": page["analytics"] if page else [],
            "comparable": bool(page) and not listing and not thin, "note": note}


# ----------------------------------------------------------------------------------------------------------------- insights
def build_insights(keyword: str, your: dict[str, Any], results: list[dict[str, Any]], features: dict[str, Any], you_in_pack: int | None) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    pos = your.get("position")
    if not your.get("domain"):
        out.append({"level": "info", "title": "Add the project's website to see where you rank", "fix": "Positions are matched by the website's domain. Add it in the profile."})
    elif pos is None:
        out.append({"level": "critical", "title": f"Your site is not in the top {organic.DEPTH} for “{keyword}”", "fix": "Create or improve a page that answers this search, then track the keyword to watch it move."})
    elif pos <= 3:
        out.append({"level": "good", "title": f"You are #{pos} for “{keyword}”", "fix": "Protect the position: keep the page fresh and keep earning links and reviews."})
    elif pos <= 10:
        out.append({"level": "info", "title": f"You are #{pos}, on page 1", "fix": "Compare your page with the results above you: length, headings, FAQ and schema are in the table."})
    else:
        out.append({"level": "warning", "title": f"You are #{pos} (Google page {organic.page_of(pos)})", "fix": "Most clicks go to page 1. Study the top 10 below and close the gaps."})

    read = [r for r in results if r.get("comparable") and r["word_count"] is not None]
    skipped = sum(1 for r in results if r["fetched"] and not r.get("comparable"))
    if len(read) < 2 and results:
        out.append({"level": "info", "title": "Too few readable article pages in the top results to compare length and FAQs",
                    "fix": "The top results are mostly social or listing pages, or pages that build their text with JavaScript. Look at the individual rows below."})
    elif read:
        med = int(statistics.median(r["word_count"] for r in read))
        mine = next((r for r in read if r["is_you"]), None)
        fix = f"Aim for about {med} words with clear H2/H3 sections."
        if mine and mine["word_count"] < med * 0.7:
            out.append({"level": "warning", "title": f"Your page has {mine['word_count']} words; the typical top result has {med}", "fix": fix})
        else:
            out.append({"level": "info", "title": f"The top results are about {med} words long (median of {len(read)} article pages read{f', {skipped} social, listing or script-built pages left out' if skipped else ''})", "fix": fix})
        faq = sum(1 for r in read if r["has_faq"])
        if faq:
            share = round(faq / len(read) * 100)
            out.append({"level": "warning" if share >= 40 else "info", "title": f"{faq} of {len(read)} top pages have an FAQ section ({share}%)",
                        "fix": "Add a short FAQ with FAQPage schema if your page has none."})
    ages = [r["domain_age_days"] for r in results if r["domain_age_days"] is not None]
    if ages:
        avg = sum(ages) / len(ages) / 365.25
        out.append({"level": "info", "title": f"The sites in the top {TOP} are {avg:.1f} years old on average ({len(ages)} lookups)",
                    "fix": "A young domain needs better content and links to compete with older ones; domain age alone does not decide rankings."})
    if features["local_pack"]:
        where = f"You are #{you_in_pack} in it." if you_in_pack else "Your business is not in it."
        out.append({"level": "info" if you_in_pack else "warning", "title": f"Google shows a local map pack for this search. {where}",
                    "fix": "Keep the Google Business Profile complete, collect reviews and keep the name, address and phone identical everywhere."})
    if features["people_also_ask"]:
        qs = [q["question"] for q in features["people_also_ask"][:3]]
        out.append({"level": "info", "title": f"People also ask shows {len(features['people_also_ask'])} question{'s' if len(features['people_also_ask']) != 1 else ''} for this search",
                    "fix": "Answer them under their own headings with a short direct answer. Start with: " + " | ".join(qs)})
    if features["featured_snippet"]:
        out.append({"level": "info", "title": "A featured snippet is shown above the results", "fix": "Put a direct 40-60 word answer right under the heading to compete for it."})
    return out


# ----------------------------------------------------------------------------------------------------------------- the X-Ray
def xray(b: Any, user_key: str, keyword: str, location: str | None = None) -> dict[str, Any]:
    kw = " ".join(keyword.split())
    target = organic.targeting(b)
    loc = (location or "").strip() or target["location"]
    key = (user_key, b.id, kw.lower(), loc.lower())
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < CACHE_SECONDS:
            return hit[1]
    res = _serper_search(b, kw, loc, target["language"], target["country"])
    organic_rows = (res.get("organic") or [])[: organic.DEPTH]
    for i, o in enumerate(organic_rows):
        o.setdefault("position", i + 1)
    me = organic.host(b.website)
    notes: list[str] = []

    mine = next((o for o in organic_rows if me and organic.result_host(o) == me), None)
    your = {"found": bool(mine), "position": int(mine["position"]) if mine else None, "page": organic.page_of(int(mine["position"])) if mine else None,
            "url": organic._shown(mine)[1] if mine else None, "domain": me or None}

    items: list[dict[str, Any]] = []
    approx = 0
    for o in organic_rows[:TOP]:
        host, url = organic._shown(o)
        if not host:
            continue
        redirect = organic._is_redirect(o.get("link") or "")
        approx += 1 if redirect else 0
        items.append({"position": int(o.get("position") or len(items) + 1), "title": o.get("title") or host, "url": url, "domain": host, "snippet": o.get("snippet"),
                      "sitelinks": [{"title": s.get("title"), "url": s.get("link")} for s in o.get("sitelinks") or [] if s.get("link")][:6],
                      "is_you": bool(me) and host == me, "_fetchable": bool(url) and not redirect})
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(_enrich, items))
    if approx:
        notes.append(f"{approx} result{'s' if approx != 1 else ''} came as Google tracking links, so their page was not opened (domain details are still shown).")
    unread = sum(1 for r in results if not r["fetched"])
    if unread - approx > 0:
        notes.append(f"{unread - approx} result page{'s' if unread - approx != 1 else ''} could not be opened (blocked, slow or not HTML); their fields are empty, not guessed.")
    if not b.website:
        notes.append("The project has no website, so your own position cannot be matched.")

    features = parse_features(res)
    you_in_pack, _listing = organic.find_listing(res.get("places") or [], b) if res.get("places") else (None, None)
    your["maps_position"] = you_in_pack
    out = {"keyword": kw, "location": loc, "source": "serper", "fetched_at": datetime.now(timezone.utc).isoformat(), "your": your, "results": results,
           "features": features, "insights": build_insights(kw, your, results, features, you_in_pack), "notes": notes}
    with _lock:
        _cache[key] = (time.time(), out)
    return out
