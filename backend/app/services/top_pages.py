"""Top Pages: every page of the site that any real source knows, one row per page.

Sources (a page lists which of them know it):
- crawl:  the site's own crawl (words, issues, links, structured data, keywords mapped to the page)
- google: where it ranks for a tracked keyword (saved Google rank checks), and, when the data provider is connected, its estimated traffic
- ai:     AI answers that cite the page (stored AI checks)
Figures a source cannot give stay empty (None): nothing is estimated here.
"""
from datetime import date
from statistics import mean
from urllib.parse import urlparse

from .landscape import Obs


def norm(url: str | None) -> str:
    """One key per page: no scheme, no www, no fragment, no trailing slash (the query stays: ?category=x is another page)."""
    u = urlparse(url if (url or "").startswith("http") else f"https://{url or ''}")
    host = u.netloc.lower().removeprefix("www.")
    path = u.path.rstrip("/") or "/"
    return f"{host}{'' if path == '/' else path}" + (f"?{u.query}" if u.query else "")


def _blank(url: str) -> dict:
    return {"url": url, "key": norm(url), "sources": [], "traffic": None, "traffic_share": None, "index_keywords": None, "tracked": [], "avg_position": None, "position_change": None,
            "status": None, "llm_prompts": 0, "ai_engines": [], "ref_domains": None, "backlinks": None, "top_keyword": None, "intent": None, "words": None, "issues": None,
            "schema": [], "noindex": False, "http": None, "title": None, "inbound": None}


def build(crawl: list[dict], obs: list[Obs], meta: dict[str, dict], geo: list[dict], index: dict, me: str, start: date, end: date, prompts_total: int) -> dict:
    """crawl: rows of /seo/top-pages. geo: [{prompt_id, engine, urls, day}] (latest answer per prompt and engine for the rows, all answers for the chart).
    index: {pages, indexed, history} from the data provider, each None when it is not available."""
    rows: dict[str, dict] = {}

    def row(url: str, source: str) -> dict:
        r = rows.setdefault(norm(url), _blank(url))
        if source not in r["sources"]:
            r["sources"].append(source)
        return r

    for p in crawl:
        r = row(p["url"], "crawl")
        r.update(words=p.get("words"), issues=p.get("issues"), schema=p.get("schema") or [], noindex=bool(p.get("noindex")), http=p.get("status"), title=p.get("title"), inbound=p.get("inbound"))
        r["tracked"] = [{"keyword": m["keyword"], "rank": m["rank"]} for m in p.get("mapped") or [] if m.get("rank")]

    # Google: traffic from the data provider
    total = sum(p["traffic"] for p in index.get("pages") or []) or 0
    for p in index.get("pages") or []:
        r = row(p["url"], "google")
        r["traffic"], r["index_keywords"] = p["traffic"], p["keywords"]
        r["traffic_share"] = round(p["traffic"] / total * 100, 2) if total else None
    for p in index.get("indexed") or []:
        r = row(p["url"], "google") if norm(p["url"]) in rows else None
        if r:
            r["ref_domains"], r["backlinks"] = p["domains"], p["backlinks"]
            r["title"] = r["title"] or p.get("title")

    # Google: positions of the tracked keywords (saved checks), first check against the latest in the period
    obs = [o for o in obs if start <= o.day <= end]
    days = sorted({o.day for o in obs})
    first: dict[str, Obs] = {}
    last: dict[str, Obs] = {}
    for o in sorted(obs, key=lambda x: x.day):
        first.setdefault(o.keyword, o)
        last[o.keyword] = o
    comparable = len(days) > 1
    now: dict[str, list[tuple[str, int]]] = {}
    was: dict[str, list[tuple[str, int]]] = {}
    for src, store in ((last, now), (first, was)):
        for k, o in src.items():
            if o.rank and o.url:
                store.setdefault(norm(o.url), []).append((k, o.rank))
    for key, hits in now.items():
        url = next(o.url for o in last.values() if o.url and norm(o.url) == key)
        r = row(url, "google")
        r["tracked"] = [{"keyword": k, "rank": rk} for k, rk in hits]
        r["avg_position"] = round(mean(rk for _, rk in hits), 2)
        prev = was.get(key)
        if comparable and prev:
            r["position_change"] = round(mean(rk for _, rk in prev) - mean(rk for _, rk in hits), 2)  # positive = moved up
        r["status"] = "new" if comparable and not prev else None
    if comparable:
        for key, hits in was.items():
            if key not in now:
                url = next(o.url for o in first.values() if o.url and norm(o.url) == key)
                r = row(url, "google")
                r["status"] = "lost"
                r["tracked"] = []
    for r in rows.values():
        r["tracked"].sort(key=lambda t: t["rank"])
        if r["tracked"]:
            best = r["tracked"][0]["keyword"]
            r["top_keyword"], r["intent"] = best, (meta.get(best) or {}).get("intent")

    # AI: pages the answers cite
    prompts: dict[str, set] = {}
    engines: dict[str, set] = {}
    for g in geo:
        for u in g["urls"]:
            if norm(u).split("/")[0].split("?")[0] == me:
                key = norm(u)
                prompts.setdefault(key, set()).add(g["prompt_id"])
                engines.setdefault(key, set()).add(g["engine"])
    for key, ps in prompts.items():
        url = next(u for g in geo for u in g["urls"] if norm(u) == key)
        r = row(url, "ai")
        r["llm_prompts"], r["ai_engines"] = len(ps), sorted(engines[key])

    out = sorted(rows.values(), key=lambda r: (-(r["traffic"] or 0), -(len(r["tracked"]) or r["index_keywords"] or 0), r["avg_position"] or 99, -(r["llm_prompts"]), r["key"]))
    for r in out:
        r["keywords"] = r["index_keywords"] if r["index_keywords"] is not None else len(r["tracked"])

    # Summary and the two charts
    hist = index.get("history")
    traffic = round(total, 1) if index.get("pages") else None
    traffic_change = None
    if hist and len(hist) >= 2 and hist[-2]["traffic"]:
        traffic_change = round((hist[-1]["traffic"] - hist[-2]["traffic"]) / hist[-2]["traffic"] * 100, 1)
    ranking_pages = {k for k in now}
    organic_pages = sum(1 for r in out if "google" in r["sources"] and r["status"] != "lost") if (index.get("pages") or ranking_pages) else None
    cited = [r for r in out if "ai" in r["sources"]]
    per_day = []
    for d in days:
        urls = {norm(o.url) for o in obs if o.day == d and o.rank and o.url}
        per_day.append({"date": d.isoformat(), "ranking_pages": len(urls)})
    ai_days: dict[str, set] = {}
    for g in geo:
        for u in g["urls"]:
            if norm(u).split("/")[0].split("?")[0] == me and g.get("day"):
                ai_days.setdefault(g["day"], set()).add(norm(u))
    series: dict[str, dict] = {x["date"]: dict(x) for x in per_day}
    for d, urls in ai_days.items():
        series.setdefault(d, {"date": d})["cited_pages"] = len(urls)
    return {
        "rows": out, "total": len(out), "new": sum(1 for r in out if r["status"] == "new"), "lost": sum(1 for r in out if r["status"] == "lost"), "comparable": comparable,
        "summary": {"traffic": traffic, "traffic_change": traffic_change, "organic_pages": organic_pages, "cited_pages": len(cited) if (prompts_total and geo) else None, "prompts": prompts_total,
                    "crawled": sum(1 for r in out if "crawl" in r["sources"])},
        "traffic_history": [{"date": h["date"], "traffic": h["traffic"]} for h in hist] if hist else None,
        "tracked_series": [series[d] for d in sorted(series)],
        "has": {"crawl": bool(crawl), "index": bool(index.get("pages")), "ranks": bool(obs), "ai": bool(geo), "ref_domains": bool(index.get("indexed"))},
    }
