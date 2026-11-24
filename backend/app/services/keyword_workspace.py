"""The keyword workspace of one project: every keyword from every place in one list, each with where it came from, so the useful ones can be picked.

Order of work: confirm the competitors, collect from the sources, compare and pick, then use. A keyword found in several places is one row with all its
sources; phrases that differ only in word order, plural or small words ("dentist pune", "dentists in pune") are one row too.
Nothing is invented: a keyword is here only because a source gave it, and its volume is only what Google Keyword Planner reports (empty without it).
"""
from __future__ import annotations

import logging
import math
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Audit, Business, Keyword, KeywordCandidate
from . import competitor_keywords as ck, keyword_metrics, market
from .providers.base import intent_of

log = logging.getLogger("seo.keyword_workspace")

SOURCES = {
    "website": "Your website",
    "search_console": "Your Google searches (Search Console)",
    "profile": "Your Google profile and services",
    "competitors": "Competitor websites",
    "google_ideas": "Google suggestions",
    "planner": "Google Keyword Planner",
    "area": "Searches in your areas (Google)",
    "brief": "Business summary",
    "ai": "AI suggestions",
}
FACTS = {"search_console", "profile"}  # what the owner's own Google searches and services say: facts about the business, never judged by wording
OWN = {"website", "search_console", "profile"}  # places that show what you already say or rank for
_SMALL = frozenset({"in", "for", "of", "the", "a", "an", "to", "and", "best", "top"})
MAX_COMPETITORS = 5
PLANNER_MIN_SEARCHES = 30  # a Keyword Planner idea with fewer searches a month than this is not worth a row


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _stem(w: str) -> str:
    return w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w


def merge_key(text: str) -> str:
    """The same phrase written differently has the same key: lower case, plural and small words removed, words in order."""
    words = [_stem(w) for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if w not in _SMALL]
    return " ".join(sorted(words))[:255]


def clean(text: str | None) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s'’&-]", " ", (text or "").lower())).strip()


def _add(db: Session, b: Business, found: list[dict[str, Any]], existing: dict[str, KeywordCandidate]) -> int:
    """Save what a source found: a new row for a new phrase, else the source (and any competitor) added to the row it already has."""
    new = 0
    from . import keyword_quality  # noqa: PLC0415
    judged = [clean(f.get("keyword")) for f in found if f.get("kind") not in FACTS]
    junk = keyword_quality.check_all(b, judged) if judged else {}  # slogans, cut-off sentences, places on their own and off-topic words are not filed
    for f in found:
        kw = clean(f.get("keyword"))
        if f.get("kind") not in FACTS and kw in junk:
            continue
        if not (3 <= len(kw) <= 120 and 1 <= len(kw.split()) <= 10):
            continue
        key = merge_key(kw)
        if not key:
            continue
        row = existing.get(key)
        if row is None:
            row = KeywordCandidate(business_id=b.id, norm=key, keyword=kw, variants=[], sources=[], competitors=[], intent=intent_of(kw))
            db.add(row)
            existing[key] = row
            new += 1
        if kw != row.keyword and kw not in (row.variants or []):
            row.variants = [*(row.variants or []), kw][:6]
        src = {"kind": f["kind"], "label": f.get("label") or SOURCES.get(f["kind"], f["kind"]), "detail": f.get("detail") or "", "at": date.today().isoformat()}
        if not any(x.get("kind") == src["kind"] and x.get("label") == src["label"] for x in row.sources or []):
            row.sources = [*(row.sources or []), src]
        if f.get("competitor") and f["competitor"] not in (row.competitors or []):
            row.competitors = [*(row.competitors or []), f["competitor"]]
        for field in ("volume", "difficulty", "cpc"):
            if f.get(field) is not None and getattr(row, field) is None:
                setattr(row, field, f[field])
        if f.get("position") is not None:
            row.own_rank, row.impressions, row.clicks = round(float(f["position"]), 1), int(f.get("impressions") or 0), int(f.get("clicks") or 0)
    db.flush()
    return new


# ----------------------------------------------------------------------------------------------------------------------------- the places keywords come from
def tidy(db: Session, b: Business, rows: list[KeywordCandidate]) -> int:
    """Set aside (they stay under "Set aside" with the reason, and can be put back) the saved keywords that are not keywords: slogans, cut-off sentences, a place on its own, off-topic words.
    Keywords the owner picked, that rank, or that come from Search Console or the profile are never touched."""
    from . import keyword_quality  # noqa: PLC0415
    todo = [r for r in rows if not r.dismissed and not r.picked and r.own_rank is None and not any(s.get("kind") in FACTS for s in r.sources or [])]
    junk = keyword_quality.check_all(b, [r.keyword for r in todo])
    n = 0
    for r in todo:
        if r.keyword in junk and not (isinstance(r.fit, dict) and r.fit.get("fit") in ("yes", "maybe") and not r.fit.get("auto")):
            r.dismissed, r.fit = True, keyword_quality.explain(junk[r.keyword])
            n += 1
    db.flush()
    return n


def _latest_crawl(db: Session, b: Business) -> dict[str, Any]:
    a = db.scalar(select(Audit).where(Audit.business_id == b.id, Audit.kind == "onpage", Audit.status == "done").order_by(Audit.id.desc()))
    return (a.result or {}) if a else {}


def _brand(b: Business, *extra: str) -> set[str]:
    return ck._brand_words(b.name or "", *extra, hosts=(b.website or "",))


def from_website(db: Session, b: Business) -> tuple[list[dict[str, Any]], str | None]:
    crawl = _latest_crawl(db, b)
    if not crawl.get("pages"):
        return [], "The website has not been scanned yet. Run the Website Audit first."
    rows = ck._drop_inside(ck._site_phrases(crawl, _brand(b)))
    return [{"keyword": k, "kind": "website", "detail": f"{len(v['pages'])} page{'s' if len(v['pages']) != 1 else ''}: " + ", ".join(p.get("url", "").split("//", 1)[-1][:60] for p in v["pages"][:2])}
            for k, v in rows.items()], None


def from_search_console(db: Session, b: Business) -> tuple[list[dict[str, Any]], str | None]:
    from . import google_rank, gsc, gsc_access
    host = google_rank.host_of(b.website)
    if not host:
        return [], "Add the project's website first."
    state, message, sc, site = gsc_access.search_console(db, b, host)
    if state != "ok":
        return [], message
    end = date.today() - timedelta(days=gsc.LAG_DAYS)
    try:
        rows = sc.query(site, gsc._body(end - timedelta(days=89), end, ["query"], 1000, market.serp_country(b)))
    except Exception as exc:  # noqa: BLE001 - Google's own message is the reason
        return [], str(exc)[:200]
    brand = _brand(b)
    out = []
    for r in rows:
        q = clean((r.get("keys") or [""])[0])
        if not q or any(w in q for w in brand if len(w) > 3) or int(r.get("impressions") or 0) < 3:
            continue  # searches for the brand name are not keywords to win
        out.append({"keyword": q, "kind": "search_console", "detail": f"{int(r.get('impressions') or 0)} views, {int(r.get('clicks') or 0)} clicks, position {round(float(r.get('position') or 0), 1)} (last 90 days)",
                    "position": r.get("position"), "impressions": r.get("impressions"), "clicks": r.get("clicks")})
    return out, None if out else "Search Console has no searches for this site in the last 90 days."


def from_profile(db: Session, b: Business) -> tuple[list[dict[str, Any]], str | None]:
    place = (b.city or b.area or "").strip().lower()
    names = [str((s or {}).get("name") or "") for s in (b.services or []) if isinstance(s, dict)] + [c for c in [b.primary_category, *(b.secondary_categories or [])] if c]
    out = []
    for n in dict.fromkeys(x.strip() for x in names if x and x.strip()):
        out.append({"keyword": n, "kind": "profile", "detail": "A service or category on the project"})
        if place and place not in n.lower():
            out.append({"keyword": f"{n} in {place}", "kind": "profile", "detail": "Service or category with the city"})
    return out, None if out else "The project has no services or categories yet. Add them in the Google profile."


def _competitor_domains(db: Session, b: Business) -> list[str]:
    from ..competitors import hygiene
    return hygiene.saved_competitor_domains(db, b, limit=MAX_COMPETITORS)


def _listing_rows(db: Session, b: Business) -> list[dict[str, Any]]:
    """The services and keywords the AI worked out from the Google listing of each competitor (the ones with no website too): evidence read from their own listing."""
    from ..models import Competitor
    out = []
    for c in db.scalars(select(Competitor).where(Competitor.business_id == b.id, Competitor.listing.is_not(None))):
        if c.selected is False:
            continue
        u = (c.listing or {}).get("understanding") or {}
        for kind, items in (("keyword", u.get("keywords")), ("service", u.get("services"))):
            for k in items or []:
                out.append({"keyword": k, "kind": "competitors", "label": c.name, "competitor": c.name,
                            "detail": f"{c.name}'s Google listing: {'a search word for it' if kind == 'keyword' else 'a service it offers'}"})
    return out


def from_competitors(db: Session, b: Business) -> tuple[list[dict[str, Any]], str | None]:
    from . import crawler
    domains = _competitor_domains(db, b)
    listed = _listing_rows(db, b)
    if not domains:
        return listed, (None if listed else "No competitors saved yet. Find the competitors first.")
    brand_me = _brand(b)

    def read(d: str) -> tuple[str, dict[str, Any]]:
        try:
            return d, crawler.crawl(f"https://{d}", max_pages=6, timeout=12)
        except Exception as exc:  # noqa: BLE001 - one unreachable competitor must not stop the rest
            log.info("competitor %s not read: %s", d, exc)
            return d, {}

    with ThreadPoolExecutor(max_workers=min(4, len(domains))) as pool:
        crawls = list(pool.map(read, domains))
    out, read_ok = [], 0
    for d, crawl in crawls:
        if not crawl.get("pages"):
            continue
        read_ok += 1
        rows = ck._drop_inside(ck._site_phrases(crawl, brand_me | ck._brand_words("", hosts=(d,))))
        out += [{"keyword": k, "kind": "competitors", "label": d, "competitor": d, "detail": f"{len(v['pages'])} page{'s' if len(v['pages']) != 1 else ''} of {d}"} for k, v in rows.items()]
    run = db.scalar(select(Audit).where(Audit.kind == "intel", Audit.target == f"business:{b.id}", Audit.status == "done").order_by(Audit.id.desc()))
    result = (run.result or {}) if run else {}
    for g in (result.get("gaps") or {}).get("keywords", []) or []:
        for c in g.get("competitors") or [{}]:
            out.append({"keyword": g.get("keyword"), "kind": "competitors", "label": c.get("domain") or "Competitor research", "competitor": c.get("domain"), "detail": "Competitor research: they rank for it and you do not"})
    for g in (result.get("ideas") or {}).get("competitor_keywords", []) or []:
        kw = g.get("keyword") if isinstance(g, dict) else g
        out.append({"keyword": kw, "kind": "competitors", "label": "Competitor research", "detail": "Competitor research"})
    out += listed
    note = None if (read_ok or listed) else "None of the competitor websites could be read right now."
    return out, note


def _areas(b: Business) -> list[str]:
    """The place names customers use: the target areas, the neighbourhood and the city, short and real."""
    from . import categories
    raw = [*(getattr(b, "target_areas", None) or []), getattr(b, "area", None), getattr(b, "city", None)]
    out: list[str] = []
    for x in raw:
        name = " ".join(str(x or "").split(",")[0].split())
        if name and len(name) <= 40 and categories.usable_area(name) and name.lower() not in [o.lower() for o in out]:
            out.append(name)
    return out[:4]


def from_area(db: Session, b: Business) -> tuple[list[dict[str, Any]], str | None]:
    """Searches that name one of the business's areas. Each is a customer word plus an area put to Google Autocomplete, and only what Google itself suggests is kept: nothing is made up."""
    from . import business_understanding, countries, keywords
    areas = _areas(b)
    terms = business_understanding.search_terms(b)[:4] or [s for s in keywords.default_seeds(b) if isinstance(s, str)][:3]
    if not areas or not terms:
        return [], "Add the target areas and some services first, so there is something to search for."
    gl = countries.gl(countries.of(b))
    combos = [(t, a) for t in terms for a in areas][:16]

    def ask(ta: tuple[str, str]) -> list[dict[str, Any]]:
        t, a = ta
        try:
            sug = keywords.autocomplete(f"{t} {a}", gl)
        except Exception:  # noqa: BLE001
            return []
        token = a.lower().split()[0]
        return [{"keyword": s, "kind": "area", "detail": f"Google suggests it for {a} (searched \"{t} {a}\")"} for s, _rank in sug[:6] if token in s.lower() and len(s.split()) >= 2]

    with ThreadPoolExecutor(max_workers=6) as pool:
        found = [x for part in pool.map(ask, combos) for x in part]
    return found, (None if found else "Google has no suggestion that names one of your areas for these search words.")


def from_brief(db: Session, b: Business) -> tuple[list[dict[str, Any]], str | None]:
    """What the business summary says: the services and solutions it sells, the keyword themes written for its customers and the words they search with."""
    brief = getattr(b, "business_brief", None) or {}
    if not brief:
        return [], "There is no business summary yet and it could not be built from the website. Add the website to the project, then collect again."
    out: list[dict[str, Any]] = []
    for k in brief.get("customer_search_terms") or []:
        out.append({"keyword": k, "kind": "brief", "detail": "A word your customers search with (business summary)"})
    for k in brief.get("offerings") or []:
        out.append({"keyword": k, "kind": "brief", "detail": "A service or solution the business offers (business summary)"})
    for th in brief.get("keyword_themes") or []:
        for k in th.get("keywords") or []:
            out.append({"keyword": k, "kind": "brief", "detail": f"Keyword theme \"{th.get('theme')}\" for {', '.join((brief.get('audience') or [])[:1]) or 'its customers'} (business summary)"})
    return out, (None if out else "The business summary has no search words yet.")


def from_google_ideas(db: Session, b: Business) -> tuple[list[dict[str, Any]], str | None]:
    from . import keywords
    ctx = keywords.context(db, b)
    seeds = [s if isinstance(s, str) else str((s or {}).get("keyword") or (s or {}).get("name") or "") for s in (ctx.get("seeds") or ctx.get("services") or [])][:4]
    seeds = [s for s in seeds if s] or [x for x in [b.primary_category] if x]
    if not seeds:
        return [], "Add services or a category first, so there is something to search from."
    res = keywords.discover(db, b, seeds, [])
    return [{"keyword": x["keyword"], "kind": "google_ideas", "detail": "What people type into Google for " + ", ".join(seeds[:2]), "volume": x.get("volume"), "difficulty": x.get("difficulty"), "cpc": x.get("cpc")}
            for x in res.get("keywords", [])], None


def from_ai(db: Session, b: Business) -> tuple[list[dict[str, Any]], str | None]:
    from . import ai, keyword_ai
    try:
        res = keyword_ai.suggest(db, b)
    except ai.AiUnavailable as exc:
        return [], str(exc)
    except Exception as exc:  # noqa: BLE001
        return [], f"The AI could not write suggestions right now: {str(exc)[:120]}"
    return [{"keyword": x["keyword"], "kind": "ai", "detail": x.get("why") or "AI suggestion"} for x in res.get("items", [])], None


def from_planner(db: Session, b: Business) -> tuple[list[dict[str, Any]], str | None]:
    """Related keywords from the Google Ads Keyword Planner (GenerateKeywordIdeas), with Google's own monthly searches, difficulty and cost per click. The seeds are the words customers
    use as written in the business understanding, then the business's own seeds. Ideas with almost no searches are left out."""
    from . import google_ads_client as ads
    from . import keywords
    if not keyword_metrics.enabled():
        return [], "Google Ads is not set up, so the Keyword Planner cannot be asked."
    seeds = list(dict.fromkeys(s for s in keywords.default_seeds(b) if isinstance(s, str) and s.strip()))[:4]
    if not seeds:
        return [], "Add services or a category first, so there is something to search from."
    geo = ads.geo_target_for(market.serp_country(b))
    out: list[dict[str, Any]] = []
    failed = ""
    for seed in seeds:
        try:
            ideas = ads.keyword_ideas([seed], limit=40, geo_target=geo)
        except ads.GoogleAdsNotConfigured as exc:
            return [], str(exc)
        except ads.GoogleAdsError as exc:
            failed = str(exc)[:160]
            continue
        for i in ideas:
            vol = i.get("avg_monthly_searches")
            if vol is None or vol < PLANNER_MIN_SEARCHES:
                continue
            out.append({"keyword": i["keyword"], "kind": "planner", "detail": f"Google Keyword Planner idea for \"{seed}\"", "volume": vol,
                        "difficulty": i.get("competition_index") if i.get("competition") not in (None, "UNSPECIFIED") else None, "cpc": i.get("high_top_of_page_bid") or None})
    return out, (failed or None) if not out else None


COLLECTORS = {"website": from_website, "search_console": from_search_console, "profile": from_profile, "competitors": from_competitors, "google_ideas": from_google_ideas, "planner": from_planner, "area": from_area, "brief": from_brief, "ai": from_ai}


def collect(db: Session, b: Business, kinds: list[str] | None = None) -> dict[str, Any]:
    """Run the chosen sources and file what they found. A source that cannot run says why; the others still run."""
    kinds = [k for k in (kinds or list(COLLECTORS)) if k in COLLECTORS]
    existing = {r.norm: r for r in db.scalars(select(KeywordCandidate).where(KeywordCandidate.business_id == b.id))}
    report: dict[str, Any] = {}
    summary_note = None
    if not (b.business_brief or {}) and b.website and any(k in kinds for k in ("brief", "area", "ai", "google_ideas")):
        # the business summary feeds several sources: it is built now (the site is read and the AI asked once) instead of sending the owner to another page first
        from . import business_understanding
        try:
            business_understanding.build(db, b)
            summary_note = "The business summary was built first, from your website."
        except Exception as exc:  # noqa: BLE001 - the sources that do not need it still run
            log.warning("business summary could not be built: %s", exc)
            db.rollback()
            summary_note = "The business summary could not be built just now, so sources that use it may find less."
    for k in kinds:
        try:
            found, note = COLLECTORS[k](db, b)
        except Exception as exc:  # noqa: BLE001 - never lose the other sources
            log.exception("keyword source %s failed", k)
            found, note = [], f"This source failed: {str(exc)[:150]}"
        report[k] = {"label": SOURCES[k], "found": len(found), "new": _add(db, b, found, existing) if found else 0, "note": note}
    if summary_note:
        report["summary"] = {"label": "Business summary", "found": 0, "new": 0, "note": summary_note}
    tidied = tidy(db, b, list(existing.values()))
    if tidied:
        report["tidy"] = {"label": "Wording check", "found": tidied, "new": 0, "note": f"{tidied} phrases set aside because they are not keywords (slogans, cut-off sentences, a place on its own, off-topic words)"}
    fill_metrics(db, b)
    fill_trends(db, b)
    from . import keyword_fit
    try:  # hide what does not fit this business (another brand, another service, another place), with the reason
        checked = keyword_fit.judge(db, b, list(existing.values()))
        if checked["checked"]:
            report["fit"] = {"label": "Relevance check", "found": checked["checked"], "new": 0, "note": f"{checked['hidden']} hidden as not a fit (under Set aside), {checked['fit']} kept"}
    except Exception as exc:  # noqa: BLE001 - the list is kept as it is
        log.warning("keyword fit check skipped: %s", exc)
    db.commit()
    return report


def trend_change(months: list[dict[str, Any]] | None) -> int | None:
    """How the searches moved over the last 12 months, in percent: the average of the last 3 months against the average of the first 3. None when Google gave fewer than 6 months."""
    v = [int(m.get("searches") or 0) for m in months or []]
    if len(v) < 6:
        return None
    first, last = sum(v[:3]) / 3, sum(v[-3:]) / 3
    if not first:
        return None if not last else 100
    return round((last - first) * 100 / first)


def fill_trends(db: Session, b: Business, limit: int = 500) -> dict[str, Any]:
    """The last 12 months of searches for each keyword that has no history yet, from Google Ads Keyword Planner (one request answers up to 500 keywords)."""
    from . import google_ads_client as ads  # noqa: PLC0415
    out: dict[str, Any] = {"filled": 0, "reason": None}
    if not keyword_metrics.enabled():
        out["reason"] = "Google Ads is not set up, so there is no search history."
        return out
    todo = [r for r in db.scalars(select(KeywordCandidate).where(KeywordCandidate.business_id == b.id, KeywordCandidate.trend.is_(None), KeywordCandidate.dismissed.is_(False)).limit(limit))]
    if not todo:
        return out
    try:
        got = ads.historical_metrics(list(dict.fromkeys(r.keyword.lower() for r in todo)), geo_target=ads.geo_target_for(market.serp_country(b)))
    except ads.GoogleAdsError as exc:
        out["reason"] = f"Google Ads did not answer ({'; '.join(getattr(exc, 'details', []) or [str(exc)])[:160]})."
        return out
    for r in todo:
        m = got.get(r.keyword.lower())
        if m and m.get("monthly"):
            r.trend = [{"year": x["year"], "month": x["month"], "searches": x["searches"]} for x in m["monthly"]][-12:]
            if r.volume is None:
                r.volume = m.get("volume")
            out["filled"] += 1
    db.flush()
    return out


def search_planner(db: Session, b: Business, query: str) -> dict[str, Any]:
    """Keyword Planner ideas for something the owner typed: filed in the list (with the same wording and topic check as every source), each with its searches and 12-month history.
    Returns how many Google gave, how many were new, and how many were left out as not about this business."""
    from . import google_ads_client as ads  # noqa: PLC0415
    from . import keyword_quality  # noqa: PLC0415
    seed = clean(query)
    if len(seed) < 2:
        return {"found": 0, "added": 0, "left_out": 0, "reason": "Type a word or a phrase first."}
    if not keyword_metrics.enabled():
        return {"found": 0, "added": 0, "left_out": 0, "reason": "Google Ads is not set up, so the Keyword Planner cannot be asked."}
    try:
        ideas = ads.keyword_ideas([seed], limit=300, include_monthly=True, geo_target=ads.geo_target_for(market.serp_country(b)))
    except ads.GoogleAdsError as exc:
        return {"found": 0, "added": 0, "left_out": 0, "reason": f"Google Ads did not answer ({'; '.join(getattr(exc, 'details', []) or [str(exc)])[:160]})."}
    ideas = [i for i in ideas if (i.get("avg_monthly_searches") or 0) >= PLANNER_MIN_SEARCHES]
    junk = keyword_quality.check_all(b, [clean(i["keyword"]) for i in ideas])
    keep = [i for i in ideas if clean(i["keyword"]) not in junk]
    found = [{"keyword": i["keyword"], "kind": "planner", "detail": f"Google Keyword Planner idea for \"{seed}\"", "volume": i["avg_monthly_searches"],
              "difficulty": i.get("competition_index") if i.get("competition") not in (None, "UNSPECIFIED") else None, "cpc": i.get("high_top_of_page_bid") or None} for i in keep]
    existing = {r.norm: r for r in db.scalars(select(KeywordCandidate).where(KeywordCandidate.business_id == b.id))}
    added = _add(db, b, found, existing)
    for i in keep:
        row = existing.get(merge_key(clean(i["keyword"])))
        if row is not None and row.trend is None and i.get("monthly_search_volumes"):
            row.trend = [{"year": m["year"], "month": m["month"], "searches": m["monthly_searches"]} for m in i["monthly_search_volumes"]][-12:]
    db.flush()
    return {"found": len(ideas), "added": added, "left_out": len(junk), "reason": None}


def measure_difficulty(db: Session, b: Business, ids: list[int]) -> list[dict[str, Any]]:
    """The keyword difficulty score (the full formula, from the real top 10 on Google) of up to a few keywords at once. Saved on the row, so the list can be sorted by it.
    A keyword whose results could not be read says why and keeps no score."""
    from concurrent.futures import ThreadPoolExecutor  # noqa: PLC0415

    from . import keyword_difficulty as kd  # noqa: PLC0415
    rows = [r for r in db.scalars(select(KeywordCandidate).where(KeywordCandidate.business_id == b.id, KeywordCandidate.id.in_(ids or [0])))][:6]
    country = market.serp_country(b)

    def one(r: KeywordCandidate) -> tuple[KeywordCandidate, dict[str, Any] | None, str | None]:
        try:
            return r, kd.score(r.keyword, country, r.volume, use_cache=True), None
        except kd.DifficultyError as exc:
            return r, None, str(exc)
        except Exception as exc:  # noqa: BLE001 -- one keyword failing must not lose the others
            log.warning("difficulty of %s failed: %r", r.keyword, exc)
            return r, None, "The Google results could not be read just now."
    with ThreadPoolExecutor(max_workers=3) as pool:
        done = list(pool.map(one, rows))
    out = []
    for r, res, err in done:
        if res and res.get("score") is not None:
            r.kd = int(res["score"])
            r.kd_detail = {"at": _now().isoformat(), "parts": res["formula"], "sites": res["sites_with_figures"], "of": res["sites"], "weight_used": res["weight_used"]}
            out.append({"id": r.id, "kd": r.kd, "detail": r.kd_detail})
        else:
            out.append({"id": r.id, "kd": None, "error": err or "Google gave too few results with figures to score this keyword."})
    db.flush()
    return out


def fill_metrics(db: Session, b: Business, limit: int = 150) -> str | None:
    """Real monthly searches, difficulty and cost per click from Google Keyword Planner, for the keywords that have none yet."""
    if not keyword_metrics.enabled():
        return "Google Ads is not set up, so there are no search volumes. Keywords are ordered by where they were found."
    todo = [r for r in db.scalars(select(KeywordCandidate).where(KeywordCandidate.business_id == b.id, KeywordCandidate.volume.is_(None), KeywordCandidate.dismissed.is_(False)).limit(limit))]
    if not todo:
        return None
    metrics, why = keyword_metrics.lookup([r.keyword for r in todo], market.serp_country(b))
    for r in todo:
        m = metrics.get(r.keyword)
        if m:
            r.volume, r.difficulty, r.cpc = m.get("volume"), m.get("difficulty"), m.get("cpc")
    return why


# ----------------------------------------------------------------------------------------------------------------------------- reading the list
def tag_of(r: KeywordCandidate) -> str:
    kinds = {s.get("kind") for s in r.sources or []}
    mine, theirs = bool(kinds & OWN) or r.own_rank is not None, bool(r.competitors)
    if r.own_rank is not None and r.own_rank <= 3:
        return "win"
    if r.own_rank is not None and 10 < r.own_rank <= 20:
        return "almost"
    if theirs and not mine:
        return "gap"
    if theirs and mine:
        return "shared"
    if mine:
        return "yours"
    return "idea"


TAGS = {"gap": "Gap: competitors have it, you do not", "win": "Win: you already rank in the top 3", "almost": "Almost: you are on page 2", "shared": "Shared: you both use it",
        "yours": "Yours only", "idea": "Idea: from Google or AI"}


def score_of(r: KeywordCandidate, tag: str) -> int:
    """0 to 100, how worth picking this keyword looks. A suggestion only: searches, ease, a gap or page-2 position, intent, and how many places agree."""
    s = 0.0
    if r.volume:
        s += min(40, math.log10(max(r.volume, 1)) * 11)
    if r.difficulty is not None:
        s += (100 - r.difficulty) * 0.2
    elif not r.volume:
        s += 8
    s += {"gap": 18, "almost": 16, "idea": 6, "shared": 4, "yours": 3, "win": 0}[tag]
    s += min(12, len({x.get("kind") for x in r.sources or []}) * 4) + min(6, len(r.competitors or []) * 2)
    s += 6 if r.intent in ("transactional", "commercial", "local") else 0
    return min(100, round(s * (0.8 if tag in ("yours", "shared", "win") else 1)))


def item(r: KeywordCandidate, saved: set[str]) -> dict[str, Any]:
    tag = tag_of(r)
    return {"id": r.id, "keyword": r.keyword, "variants": r.variants or [], "sources": r.sources or [], "competitors": r.competitors or [], "volume": r.volume, "difficulty": r.kd, "index": r.difficulty, "kd_detail": r.kd_detail, "trend": r.trend, "change": trend_change(r.trend), "gsc": {"views": r.impressions, "clicks": r.clicks, "position": r.own_rank, "ctr": round(100 * (r.clicks or 0) / r.impressions, 1) if r.impressions else None}, "cpc": r.cpc,
            "intent": r.intent, "rank": r.own_rank, "impressions": r.impressions, "clicks": r.clicks, "fit": r.fit, "tag": tag, "score": score_of(r, tag), "picked": merge_key(r.keyword) in saved,
            "dismissed": r.dismissed}


def overview(db: Session, b: Business, *, source: str = "", tag: str = "", q: str = "", show: str = "open", limit: int = 400) -> dict[str, Any]:
    rows = list(db.scalars(select(KeywordCandidate).where(KeywordCandidate.business_id == b.id)))
    saved = {merge_key(k.keyword) for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id))}
    items = [item(r, saved) for r in rows]
    for i in items:
        i["suggested"] = False
    pool = sorted((i for i in items if not i["picked"] and not i["dismissed"]), key=lambda i: -i["score"])
    for i in pool[: max(3, len(pool) // 5)]:
        i["suggested"] = i["score"] >= 40
    counts_src = {k: sum(1 for i in items if any(s["kind"] == k for s in i["sources"])) for k in SOURCES}
    counts_tag = {t: sum(1 for i in items if i["tag"] == t and not i["dismissed"]) for t in TAGS}
    out = [i for i in items if (show == "all" or (show == "picked" and i["picked"]) or (show == "dismissed" and i["dismissed"]) or (show == "open" and not i["picked"] and not i["dismissed"]))
           and (not source or any(s["kind"] == source for s in i["sources"])) and (not tag or i["tag"] == tag) and (not q or q.lower() in i["keyword"] or any(q.lower() in v for v in i["variants"]))]
    out.sort(key=lambda i: (-i["score"], i["keyword"]))
    domains = _competitor_domains(db, b)
    last = max((r.updated_at for r in rows if r.updated_at), default=None)
    shown = out[:limit]
    return {"competitors": {"count": len(domains), "domains": domains, "done": bool(domains)},
            "sources": [{"kind": k, "label": v, "count": counts_src[k]} for k, v in SOURCES.items()],
            "tags": [{"tag": t, "label": v, "count": counts_tag[t]} for t, v in TAGS.items()],
            "totals": {"suggested": sum(1 for i in items if i["suggested"] and not i["picked"] and not i["dismissed"]), "all": len(items), "open": sum(1 for i in items if not i["picked"] and not i["dismissed"]), "picked": sum(1 for i in items if i["picked"]), "dismissed": sum(1 for i in items if i["dismissed"])},
            "volumes": keyword_metrics.enabled(), "last_collected": last.isoformat() if last else None, "items": shown, "shown": len(out)}


# ----------------------------------------------------------------------------------------------------------------------------- Google Search Console: how each keyword performs
_gsc_refreshed: dict[int, float] = {}
GSC_EVERY = 3600  # seconds between two reads of the keyword figures from Search Console


def refresh_performance(db: Session, b: Business) -> dict[str, Any]:
    """Asks Google Search Console for the keyword figures of the last 90 days (views, clicks, average position) and files them on the keywords, at most once an hour.
    Returns how many keywords it had figures for and, when Search Console cannot be reached, why."""
    import time  # noqa: PLC0415
    out: dict[str, Any] = {"performance": 0, "error": None}
    if time.time() - _gsc_refreshed.get(b.id, 0) <= GSC_EVERY:
        return out
    found, note = from_search_console(db, b)
    if note and not found:
        out["error"] = note
        return out
    existing = {r.norm: r for r in db.scalars(select(KeywordCandidate).where(KeywordCandidate.business_id == b.id))}
    _add(db, b, found, existing)
    _gsc_refreshed[b.id] = time.time()
    out["performance"] = len(found)
    return out


# ----------------------------------------------------------------------------------------------------------------------------- choosing
def pick(db: Session, b: Business, ids: list[int]) -> dict[str, Any]:
    """Save the chosen keywords to the project's keyword list with where each came from."""
    added = 0
    for r in db.scalars(select(KeywordCandidate).where(KeywordCandidate.business_id == b.id, KeywordCandidate.id.in_(ids))):
        first = (r.sources or [{}])[0]
        src = {"kind": first.get("kind") or "workspace", "label": first.get("label") or "Keyword workspace", "from": "keyword_workspace", "searches": r.volume, "at": date.today().isoformat(),
               "pages": [], "sources": [{"kind": s.get("kind"), "label": s.get("label"), "detail": s.get("detail")} for s in r.sources or []], "competitors": r.competitors or []}
        k = db.scalar(select(Keyword).where(Keyword.business_id == b.id, Keyword.keyword == r.keyword))
        if k is None:
            k = Keyword(business_id=b.id, keyword=r.keyword, volume=r.volume, difficulty=r.difficulty, cpc=r.cpc, intent=r.intent or intent_of(r.keyword), tracked=True, source=src,
                        priority="High" if score_of(r, tag_of(r)) >= 70 else "Medium")
            db.add(k)
            added += 1
        r.picked, r.dismissed = True, False
    db.commit()
    return {"picked": added}


def dismiss(db: Session, b: Business, ids: list[int], on: bool = True) -> int:
    n = 0
    for r in db.scalars(select(KeywordCandidate).where(KeywordCandidate.business_id == b.id, KeywordCandidate.id.in_(ids))):
        r.dismissed = on
        n += 1
    db.commit()
    return n


# ----------------------------------------------------------------------------------------------------------------------------- the other keyword pages feed the same list
def mirror(db: Session, b: Business, keywords: list[Keyword]) -> None:
    """Keywords saved anywhere (Find Keywords, Check One Keyword, the workspace) also stand in the workspace, each with where it came from."""
    found = []
    for k in keywords:
        src = k.source or {}
        kind = src.get("kind") if src.get("kind") in SOURCES else "google_ideas" if src.get("kind") in ("discover", "planner", "explorer", "autocomplete") else None
        found.append({"keyword": k.keyword, "kind": kind or "google_ideas", "label": src.get("label") or ("Saved by hand" if not src else None), "detail": src.get("from") and f"Saved from {src.get('from')}" or "Saved to your list",
                      "volume": k.volume, "difficulty": k.difficulty, "cpc": k.cpc})
    existing = {r.norm: r for r in db.scalars(select(KeywordCandidate).where(KeywordCandidate.business_id == b.id))}
    _add(db, b, found, existing)
    for f in found:
        row = existing.get(merge_key(clean(f["keyword"])))
        if row:
            row.picked, row.dismissed = True, False


def add_ideas(db: Session, b: Business, ideas: list[dict[str, Any]], label: str) -> int:
    """Ideas seen on another page (the related keywords of Check One Keyword) go to the workspace list to be compared, not saved yet."""
    existing = {r.norm: r for r in db.scalars(select(KeywordCandidate).where(KeywordCandidate.business_id == b.id))}
    n = _add(db, b, [{"keyword": i.get("keyword"), "kind": "google_ideas", "label": label, "detail": i.get("detail") or label, "volume": i.get("volume")} for i in ideas if i.get("keyword")], existing)
    db.commit()
    return n


def summary(db: Session, b: Business) -> dict[str, Any]:
    """The small counts the keyword pages show in their shared step bar."""
    saved = list(db.scalars(select(Keyword).where(Keyword.business_id == b.id)))
    keys = {merge_key(k.keyword) for k in saved}
    cands = list(db.scalars(select(KeywordCandidate).where(KeywordCandidate.business_id == b.id)))
    return {"competitors": len(_competitor_domains(db, b)), "workspace": sum(1 for r in cands if merge_key(r.keyword) not in keys and not r.dismissed), "saved": len(saved),
            "ranking": sum(1 for k in saved if k.rank and k.rank <= 10)}
