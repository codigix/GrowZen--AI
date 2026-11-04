"""Position Tracking "Landscape": visibility, estimated traffic, average position, distribution, movers, tags, competitors, SERP
features, pages and cannibalization, all computed from the dated rank checks in keyword_rank_log (see services/organic.py).

Nothing here is invented: a figure is derived from what a check recorded. Two choices are modelled and stated on the page:
- Visibility = the share of the clicks the tracked keywords could win: sum of the expected click-through rate at each position,
  divided by (keywords x the click-through rate of position 1).
- Estimated traffic = search volume x expected click-through rate at the position, summed (keywords without a volume count 0).
Checks read the top 10 results (Serper), so "not ranking" means "not in the top 10".
"""
from dataclasses import dataclass, field
from datetime import date, timedelta
from statistics import mean, pstdev

from ..models import KeywordRankLog
from .organic import FEATURES

# Expected click-through rate by position (a common published curve); positions beyond the results read get nothing.
CTR = [0.30, 0.15, 0.10, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018, 0.012, 0.011, 0.010, 0.009, 0.008, 0.007, 0.006, 0.005, 0.004, 0.003]
OUT = 21  # rank used to compare a keyword that is not ranking


def ctr(rank: int | None) -> float:
    return CTR[rank - 1] if rank and 1 <= rank <= len(CTR) else 0.0


@dataclass
class Obs:
    keyword: str
    day: date
    rank: int | None
    url: str | None = None
    own_urls: list[str] = field(default_factory=list)
    serp: list[dict] = field(default_factory=list)
    features: list[str] = field(default_factory=list)
    own_features: list[str] = field(default_factory=list)


def from_logs(rows: list[KeywordRankLog]) -> list[Obs]:
    return [Obs(r.keyword, r.day, r.rank, r.url, r.own_urls or [], r.serp or [], r.features or [], r.own_features or []) for r in rows]


def _r1(x: float | None, d: int = 1) -> float | None:
    return None if x is None else round(x, d)


def _delta(now: float | None, before: float | None, d: int = 1) -> float | None:
    return None if now is None or before is None else round(now - before, d)


def _vis(ranks: list[int | None], n: int) -> float:
    return sum(ctr(r) for r in ranks) / (n * CTR[0]) * 100 if n else 0.0


def _bucket(rank: int | None) -> str:
    return "top3" if rank and rank <= 3 else "p4_10" if rank and rank <= 10 else "p11_20" if rank else "out"


def landscape(obs: list[Obs], meta: dict[str, dict], me: str, start: date, end: date, keep: set[str] | None = None) -> dict:
    """meta: keyword -> {volume, tag}. me: the tracked domain. keep: domains always counted as competitors (the ones the user tracks)."""
    from ..competitors.intel import is_directory
    obs = [o for o in obs if start <= o.day <= end]
    if not obs:
        return {"state": "no_data"}
    by_day: dict[date, dict[str, Obs]] = {}
    for o in sorted(obs, key=lambda x: x.day):
        by_day.setdefault(o.day, {})[o.keyword] = o
    days = sorted(by_day)
    kws = sorted({o.keyword for o in obs})
    n = len(kws)
    vol = lambda k: (meta.get(k) or {}).get("volume") or 0  # noqa: E731
    has_volume = any(vol(k) for k in kws)

    def snap(kind: str) -> dict[str, Obs]:
        """Each keyword's earliest ('first') or latest ('last') check in the period."""
        out: dict[str, Obs] = {}
        for d in days if kind == "first" else reversed(days):
            for k, o in by_day[d].items():
                out.setdefault(k, o)
        return out

    first, last = snap("first"), snap("last")
    comparable = len(days) > 1

    # Daily series
    series = []
    for d in days:
        cur = by_day[d]
        ranks = [o.rank for o in cur.values()]
        ranked = [r for r in ranks if r]
        series.append({
            "date": d.isoformat(), "visibility": _r1(_vis(ranks, len(cur)), 2), "traffic": _r1(sum(vol(k) * ctr(o.rank) for k, o in cur.items()), 2) if has_volume else None,
            "avg_position": _r1(mean(ranked), 2) if ranked else None, "keywords": len(cur), **{b: sum(1 for r in ranks if _bucket(r) == b) for b in ("top3", "p4_10", "p11_20", "out")},
            "top10": sum(1 for r in ranks if r and r <= 10), "top20": len(ranked),
            "cannibal": sum(1 for o in cur.values() if len(set(o.own_urls)) >= 2),
        })
    s0, s1 = series[0], series[-1]

    def card(key: str) -> dict:
        v = [x[key] for x in series]
        return {"value": s1[key], "change": _delta(s1[key], s0[key], 2) if comparable else None, "series": v}
    cards = {"visibility": card("visibility"), "traffic": card("traffic"), "avg_position": card("avg_position")}

    # Keywords: top N with new / lost against the first check
    def bucket_stats(limit: int, key: str) -> dict:
        now = {k for k, o in last.items() if o.rank and o.rank <= limit}
        was = {k for k, o in first.items() if o.rank and o.rank <= limit}
        return {"count": len(now), "new": len(now - was) if comparable else None, "lost": len(was - now) if comparable else None, "series": [x[key] for x in series]}
    keywords = {"top3": bucket_stats(3, "top3"), "top10": bucket_stats(10, "top10"), "top20": bucket_stats(20, "top20")}

    # Movers
    rows = []
    for k in kws:
        a, z = first[k].rank, last[k].rank
        gain = (ctr(z) - ctr(a)) / (n * CTR[0]) * 100
        rows.append({"keyword": k, "rank": z, "was": a, "change": (a or OUT) - (z or OUT) if comparable else None, "visibility": _r1(ctr(z) / (n * CTR[0]) * 100, 3), "gain": _r1(gain, 2),
                     "volume": vol(k) or None, "traffic": _r1(vol(k) * ctr(z), 2) if vol(k) else None, "traffic_was": _r1(vol(k) * ctr(a), 2) if vol(k) else None,
                     "visibility_was": _r1(ctr(a) / (n * CTR[0]) * 100, 3), "tag": (meta.get(k) or {}).get("tag"), "intent": (meta.get(k) or {}).get("intent"),
                     "id": (meta.get(k) or {}).get("id"), "kd": (meta.get(k) or {}).get("difficulty"), "cpc": (meta.get(k) or {}).get("cpc"), "sf": len(last[k].features), "checked": last[k].day.isoformat(), "url": last[k].url})
    improved = sum(1 for r in rows if r["change"] and r["change"] > 0)
    declined = sum(1 for r in rows if r["change"] and r["change"] < 0)
    top = sorted(rows, key=lambda r: (r["rank"] or 99, -(r["volume"] or 0), r["keyword"]))[:5]
    pos = sorted((r for r in rows if r["gain"] and r["gain"] > 0), key=lambda r: -r["gain"])
    neg = sorted((r for r in rows if r["gain"] and r["gain"] < 0), key=lambda r: r["gain"])
    movers = {"improved": improved, "declined": declined, "unchanged": n - improved - declined}

    # Tags (keyword groups)
    tags = []
    for tag in sorted({r["tag"] for r in rows if r["tag"]}):
        group = [r for r in rows if r["tag"] == tag]
        ks = [r["keyword"] for r in group]
        ranked = [r["rank"] for r in group if r["rank"]]
        v_now = _vis([last[k].rank for k in ks], len(ks))
        v_was = _vis([first[k].rank for k in ks], len(ks))
        t_now = sum(vol(k) * ctr(last[k].rank) for k in ks)
        t_was = sum(vol(k) * ctr(first[k].rank) for k in ks)
        ranked_was = [first[k].rank for k in ks if first[k].rank]
        tags.append({"tag": tag, "keywords": len(ks), "visibility": _r1(v_now, 2), "visibility_change": _delta(v_now, v_was, 2) if comparable else None,
                     "traffic": _r1(t_now, 2), "traffic_change": _delta(t_now, t_was, 2) if comparable else None,
                     "avg_position": _r1(mean(ranked), 1) if ranked else None, "avg_position_change": _delta(mean(ranked), mean(ranked_was), 1) if ranked and ranked_was and comparable else None,
                     "volume": sum(vol(k) for k in ks) or None})
    tags.sort(key=lambda t: -(t["visibility"] or 0))

    # Competitors: every domain in the results of the tracked keywords
    def positions(snapshot: dict[str, Obs]) -> dict[str, dict[str, int]]:
        out: dict[str, dict[str, int]] = {}
        for k, o in snapshot.items():
            best: dict[str, int] = {}
            for x in o.serp:
                if x.get("d") and x.get("p"):
                    best[x["d"]] = min(best.get(x["d"], 99), x["p"])
            if o.rank:
                best[me] = min(best.get(me, 99), o.rank)
            for d, p in best.items():
                out.setdefault(d, {})[k] = p
        return out
    p_now, p_was = positions(last), positions(first)
    comp = []
    for d, ps in p_now.items():
        v = _vis(list(ps.values()), n)
        w = _vis(list(p_was.get(d, {}).values()), n)
        was_ps = p_was.get(d, {})
        dist = {}
        for limit in (3, 10, 20):
            now_k = {k for k, p in ps.items() if p <= limit}
            was_k = {k for k, p in was_ps.items() if p <= limit}
            dist[f"top{limit}"] = {"count": len(now_k), "diff": len(now_k) - len(was_k) if comparable else None, "new": len(now_k - was_k) if comparable else None, "lost": len(was_k - now_k) if comparable else None}
        both = [k for k in ps if k in was_ps]
        t_now = sum(vol(k) * ctr(p) for k, p in ps.items())
        t_was = sum(vol(k) * ctr(p) for k, p in was_ps.items())
        comp.append({"domain": d, "you": d == me, "visibility": _r1(v, 2), "change": _delta(v, w, 2) if comparable else None, "keywords": len(ps), "avg_position": _r1(mean(ps.values()), 1),
                     "avg_position_change": _delta(mean(ps.values()), mean(was_ps.values()), 1) if was_ps and comparable else None,
                     "avg_position_sd": _r1(pstdev(ps.values()), 2) if len(ps) > 1 else 0.0, "kw": sorted(ps, key=lambda k: ps[k])[:60],
                     "traffic": _r1(t_now, 2), "traffic_change": _delta(t_now, t_was, 2) if comparable else None, **dist,
                     "improved": sum(1 for k in both if ps[k] < was_ps[k]) if comparable else None, "declined": sum(1 for k in both if ps[k] > was_ps[k]) if comparable else None})
    if not any(c["you"] for c in comp):  # not in the top 20 for any tracked keyword yet: still shown, with zeros
        z = {"count": 0, "diff": 0 if comparable else None, "new": 0 if comparable else None, "lost": 0 if comparable else None}
        comp.append({"domain": me, "you": True, "visibility": 0.0, "change": 0.0 if comparable else None, "keywords": 0, "avg_position": None, "avg_position_change": None,
                     "traffic": 0.0, "traffic_change": 0.0 if comparable else None, "top3": dict(z), "top10": dict(z), "top20": dict(z),
                     "improved": 0 if comparable else None, "declined": 0 if comparable else None, "not_ranking": True})
    # Directories, social networks and marketplaces rank, but they are places to be listed on, not businesses to outrank: kept apart.
    keep = {h.lower() for h in (keep or set())}
    platforms = [c for c in comp if not c["you"] and c["domain"] not in keep and is_directory(c["domain"])]
    comp = [c for c in comp if c not in platforms]
    comp.sort(key=lambda c: (-(c["visibility"] or 0), c["domain"]))
    platforms.sort(key=lambda c: (-(c["visibility"] or 0), c["domain"]))
    shown = comp[:10]
    if not any(c["you"] for c in shown):
        shown = comp[:9] + [c for c in comp if c["you"]]
    for i, c in enumerate(comp, 1):
        c["rank"] = i

    # Each domain's day-by-day visibility, traffic, average position and share of voice (the Overview chart compares them)
    domain_series: dict[str, list[dict]] = {}
    wanted = [c["domain"] for c in comp[:15]]
    if me not in wanted:
        wanted.append(me)
    for dom in wanted:
        domain_series[dom] = []
    for d in days:
        cur = by_day[d]
        per: dict[str, dict[str, int]] = {}
        for k, o in cur.items():
            best: dict[str, int] = {}
            for x in o.serp:
                if x.get("d") and x.get("p"):
                    best[x["d"]] = min(best.get(x["d"], 99), x["p"])
            if o.rank:
                best[me] = min(best.get(me, 99), o.rank)
            for dm, p in best.items():
                per.setdefault(dm, {})[k] = p
        nk = len(cur)
        vis_of = {dm: _vis(list(ps.values()), nk) for dm, ps in per.items()}
        total_day = sum(v for dm, v in vis_of.items() if dm == me or dm in keep or not is_directory(dm))  # businesses only, as in the Competitors lists
        for dom in wanted:
            ps = per.get(dom, {})
            v = vis_of.get(dom, 0.0)
            domain_series[dom].append({"date": d.isoformat(), "visibility": _r1(v, 2), "traffic": _r1(sum(vol(k) * ctr(p) for k, p in ps.items()), 2) if has_volume else None,
                                       "avg_position": _r1(mean(ps.values()), 2) if ps else None, "sov": _r1(v / total_day * 100, 2) if total_day else 0.0})
    for i, row_ in enumerate(series):
        row_["sov"] = domain_series[me][i]["sov"]
    # Each keyword's position over time for your domain and the others (the row's chart)
    for r in rows:
        hist = []
        for d in days:
            o = by_day[d].get(r["keyword"])
            if not o:
                continue
            at: dict[str, int] = {}
            for x in o.serp:
                if x.get("d") in domain_series and x.get("p"):
                    at[x["d"]] = min(at.get(x["d"], 99), x["p"])
            if o.rank:
                at[me] = min(at.get(me, 99), o.rank)
            hist.append({"date": d.isoformat(), "ranks": at})
        r["history"] = hist

    # SERP features at the latest check
    feats = {}
    for o in last.values():
        for f in o.features:
            feats.setdefault(f, {"feature": f, "keywords": 0, "yours": 0})["keywords"] += 1
        for f in o.own_features:
            feats.setdefault(f, {"feature": f, "keywords": 0, "yours": 0})["yours"] += 1

    # Share of voice: our visibility as a share of all the visibility in these results (ours + every domain that appears)
    total_vis = sum(c["visibility"] or 0 for c in comp)
    me_vis = next((c["visibility"] or 0 for c in comp if c["you"]), 0)
    share_of_voice = {"value": _r1(me_vis / total_vis * 100, 1) if total_vis else 0.0, "domains": len(comp)}

    # Featured snippets and answer boxes at the latest check: where one is shown, and whether it is ours
    snippet_words = ("featured snippet", "answer box", "people also ask", "knowledge")
    snippets = [{"keyword": k, "feature": next(f for f in o.features if any(w in f.lower() for w in snippet_words)),
                 "yours": any(any(w in f.lower() for w in snippet_words) for f in o.own_features), "rank": o.rank, "volume": vol(k) or None,
                 "potential": _r1(vol(k) * CTR[0], 1) if vol(k) else None, "was": any(any(w in f.lower() for w in snippet_words) for f in first[k].features) if k in first else False}
                for k, o in sorted(last.items()) if any(any(w in f.lower() for w in snippet_words) for f in o.features)]

    # Pages: the page that ranked, per keyword
    def page_stats(snapshot: dict[str, Obs]) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for k, o in snapshot.items():
            if o.rank and o.url:
                p = out.setdefault(o.url, {"ranks": [], "traffic": 0.0})
                p["ranks"].append(o.rank)
                p["traffic"] += vol(k) * ctr(o.rank)
        return out
    pg_now, pg_was = page_stats(last), page_stats(first)
    pages = []
    for u, p in pg_now.items():
        w = pg_was.get(u)
        pages.append({"url": u, "keywords": len(p["ranks"]), "avg_position": _r1(mean(p["ranks"]), 2), "avg_position_change": _delta(mean(p["ranks"]), mean(w["ranks"]), 2) if w and comparable else None,
                      "traffic": _r1(p["traffic"], 2), "traffic_change": _delta(p["traffic"], w["traffic"] if w else 0.0, 2) if comparable else None})
    by_traffic = sorted(pages, key=lambda p: (-(p["traffic"] or 0), -p["keywords"], p["url"]))
    for p in by_traffic:
        p["new"] = comparable and p["url"] not in pg_was
    lost_pages = [{"url": u, "keywords": len(w["ranks"]), "avg_position": _r1(mean(w["ranks"]), 2), "traffic": _r1(w["traffic"], 2)} for u, w in pg_was.items() if comparable and u not in pg_now]

    # Cannibalization: more than one page of the site ranking for the same keyword
    def own_positions(o: Obs) -> dict[str, int]:
        """Each of the site's pages in the results with its position (own_urls and the site's rows in the results are in the same order)."""
        ps = [x["p"] for x in o.serp if x.get("d") == me and x.get("p")]
        out: dict[str, int] = {}
        for u, at in zip(o.own_urls, ps):
            out.setdefault(u, at)
        for u in o.own_urls:
            out.setdefault(u, o.rank or 0)
        return out
    affected = {k for k, o in last.items() if len(set(o.own_urls)) >= 2}
    was_affected = {k for k, o in first.items() if len(set(o.own_urls)) >= 2}
    c_pages: dict[str, dict] = {}
    c_kws = []
    for k in sorted(affected):
        now_pos = own_positions(last[k])
        was_pos = own_positions(first[k]) if k in first else {}
        c_kws.append({"keyword": k, "volume": vol(k) or None, "rank": last[k].rank,
                      "pages": [{"url": u, "position": at, "traffic": _r1(vol(k) * ctr(at), 2)} for u, at in sorted(now_pos.items(), key=lambda x: x[1])]})
        for u, at in now_pos.items():
            pg = c_pages.setdefault(u, {"url": u, "keywords": [], "was": [], "traffic": 0.0, "traffic_was": 0.0, "volume": 0})
            hist = [{"date": dd.isoformat(), "position": own_positions(by_day[dd][k]).get(u)} for dd in days if k in by_day[dd]]
            pg["keywords"].append({"keyword": k, "position": at, "volume": vol(k) or None, "history": hist})
            pg["traffic"] += vol(k) * ctr(at)
            pg["volume"] += vol(k)
            if u in was_pos:
                pg["was"].append(was_pos[u])
                pg["traffic_was"] += vol(k) * ctr(was_pos[u])
    cannibal_pages = []
    for pg in c_pages.values():
        now_avg = mean(x["position"] for x in pg["keywords"])
        cannibal_pages.append({"url": pg["url"], "affected": len(pg["keywords"]), "avg_position": _r1(now_avg, 1),
                               "avg_position_change": _delta(now_avg, mean(pg["was"]), 1) if pg["was"] and comparable else None,
                               "traffic": _r1(pg["traffic"], 2), "traffic_change": _delta(pg["traffic"], pg["traffic_was"], 2) if comparable else None,
                               "volume": pg["volume"] or None, "keywords": sorted(pg["keywords"], key=lambda x: x["position"])})
    cannibal_pages.sort(key=lambda p: (-p["affected"], p["avg_position"] or 99, p["url"]))
    health = (n - len(affected)) / n * 100
    cannibal = {"affected": len(affected), "keywords": n, "pages": len(c_pages), "pages_total": len(pages),
                "health": _r1(health, 0), "health_change": _delta(health, (n - len(was_affected)) / n * 100, 0) if comparable else None,
                "rate": "good" if health >= 80 else "medium" if health >= 60 else "low",
                "series": [{"date": x["date"], "health": _r1((x["keywords"] - x["cannibal"]) / x["keywords"] * 100, 0), "affected": x["cannibal"]} for x in series],
                "page_rows": cannibal_pages[:200], "rows": sorted(c_kws, key=lambda r: (-(r["volume"] or 0), r["keyword"]))[:200]}

    # Summary: plain sentences from the figures above
    summary = []
    if comparable:
        summary.append(f"Positions improved for {improved} keyword{'s' if improved != 1 else ''} and went down for {declined}; {movers['unchanged']} did not change.")
    k3 = keywords["top3"]
    summary.append(f"{me} has {k3['count']} keyword{'s' if k3['count'] != 1 else ''} in the top 3" + (f" ({k3['new']} new, {k3['lost']} lost)" if comparable else "")
                   + f" and {keywords['top10']['count']} in the top 10, out of {n} tracked.")
    if comparable and cards["visibility"]["change"] is not None:
        summary.append(f"Visibility {'went up' if cards['visibility']['change'] > 0 else 'went down' if cards['visibility']['change'] < 0 else 'did not change'} "
                       f"({cards['visibility']['value']}%, {cards['visibility']['change']:+}).")
    rival = next((c for c in comp if not c["you"]), None)
    if rival:
        me_v = next((c["visibility"] for c in comp if c["you"]), 0)
        summary.append(f"The strongest competitor in these results is {rival['domain']} with {rival['visibility']}% visibility" + (f" against your {me_v}%." if me_v is not None else "."))
    if pos:
        summary.append(f"Biggest gain: “{pos[0]['keyword']}” ({pos[0]['gain']:+}% visibility).")
    if neg:
        summary.append(f"Biggest loss: “{neg[0]['keyword']}” ({neg[0]['gain']:+}% visibility).")

    return {
        "state": "ok", "domain": me, "period": {"start": days[0].isoformat(), "end": days[-1].isoformat(), "checks": len(days)}, "tracked": n, "has_volume": has_volume, "comparable": comparable,
        "cards": cards, "summary": summary, "distribution": series, "keywords": keywords, "movers": movers, "top": top,
        "positive": {"total": _r1(sum(r["gain"] for r in pos), 2), "count": len(pos), "rows": pos[:5]}, "negative": {"total": _r1(sum(r["gain"] for r in neg), 2), "count": len(neg), "rows": neg[:5]},
        "all_keywords": sorted(rows, key=lambda r: (r["rank"] or 99, r["keyword"])), "tags": tags, "competitors": shown, "domain_series": domain_series, "competitors_all": comp[:99] + [c for c in comp[99:] if c["you"]], "competitor_total": len(comp), "platforms": platforms[:50], "platform_total": len(platforms),
        "serp_features": sorted(feats.values(), key=lambda f: -f["keywords"]), "pages": {"top": by_traffic[:8], "improved": [p for p in by_traffic if (p["traffic_change"] or 0) > 0][:8],
                                                                                   "declined": [p for p in by_traffic if (p["traffic_change"] or 0) < 0][:8], "total": len(pages),
                                                                                   "all": by_traffic[:200], "lost": lost_pages[:100]},
        "cannibal": cannibal, "share_of_voice": share_of_voice, "snippets": snippets,
    }


def organic_research(obs: list[Obs], meta: dict[str, dict], me: str, start: date, end: date) -> dict:
    """Position changes (new, lost, improved, declined) and the SERP features of the tracked keywords, first check against the latest
    in the period, plus how many keywords had each feature on every check day."""
    obs = [o for o in obs if start <= o.day <= end]
    if not obs:
        return {"state": "no_data"}
    by_day: dict[date, dict[str, Obs]] = {}
    for o in sorted(obs, key=lambda x: x.day):
        by_day.setdefault(o.day, {})[o.keyword] = o
    days = sorted(by_day)
    first: dict[str, Obs] = {}
    last: dict[str, Obs] = {}
    for d in days:
        for k, o in by_day[d].items():
            first.setdefault(k, o)
            last[k] = o
    comparable = len(days) > 1
    changes: dict[str, list] = {"new": [], "lost": [], "improved": [], "declined": []}
    for k in sorted(last):
        a, z = first[k].rank, last[k].rank
        row = {"keyword": k, "rank": z, "was": a, "change": (a or OUT) - (z or OUT), "volume": (meta.get(k) or {}).get("volume"), "url": last[k].url or first[k].url}
        if not comparable or a == z:
            continue
        kind = "new" if a is None else "lost" if z is None else "improved" if z < a else "declined"
        changes[kind].append(row)
    for kind, rows in changes.items():
        rows.sort(key=lambda r: (-(r["volume"] or 0), -abs(r["change"]), r["keyword"]))

    names = list(FEATURES.values())
    trend = {name: [sum(1 for o in by_day[d].values() if name in o.features) for d in days] for name in names}
    present = {n: sum(1 for o in last.values() if n in o.features) for n in names}
    yours = {n: sum(1 for o in last.values() if n in o.own_features) for n in names}
    f_changes = {"new": [], "lost": []}
    if comparable:
        for k in sorted(last):
            for n in names:
                was, now = n in first[k].features, n in last[k].features
                if now and not was:
                    f_changes["new"].append({"keyword": k, "feature": n})
                elif was and not now:
                    f_changes["lost"].append({"keyword": k, "feature": n})
    # What the saved checks show about the whole tracked set: used when the domain-wide index is not connected.
    base = landscape(obs, meta, me, start, end)
    rows = []
    for r in base["all_keywords"]:
        serp = last[r["keyword"]].serp
        lead = next((x["d"] for x in sorted(serp, key=lambda x: x.get("p") or 99)[:1]), None)
        k = r["keyword"]
        hist = [{"date": d.isoformat(), "rank": by_day[d][k].rank, "url": by_day[d][k].url} for d in days if k in by_day[d]]
        rows.append({**r, "intent": (meta.get(k) or {}).get("intent"), "leader": lead, "features": len(last[k].features), "feature_list": list(last[k].features), "own_feature_list": list(last[k].own_features),
                     "checked": last[k].day.isoformat(), "history": hist, "serp_top": [x for x in sorted(last[k].serp, key=lambda x: x.get("p") or 99)[:5]]})
    hosts: dict[str, dict] = {}
    for p in base["pages"]["top"] + [x for x in base["pages"]["improved"] if x not in base["pages"]["top"]]:
        h = p["url"].split("/")[2] if p["url"].count("/") >= 2 else p["url"]
        e = hosts.setdefault(h, {"subdomain": h, "keywords": 0})
        e["keywords"] += p["keywords"]
    intents: dict[str, int] = {}
    for r in rows:
        intents[r["intent"] or "unknown"] = intents.get(r["intent"] or "unknown", 0) + 1
    ranking = [r for r in rows if r["rank"]]
    tracked = {"keywords": len(rows), "ranking": len(ranking), "top3": sum(1 for r in ranking if r["rank"] <= 3), "top10": sum(1 for r in ranking if r["rank"] <= 10),
               "avg_position": base["cards"]["avg_position"]["value"], "visibility": base["cards"]["visibility"]["value"], "domains": base["competitor_total"], "checks": len(days)}
    return {
        "state": "ok", "domain": me, "period": {"start": days[0].isoformat(), "end": days[-1].isoformat(), "checks": len(days)}, "tracked": len(last), "comparable": comparable,
        "tracked_summary": tracked, "tracked_rows": rows, "distribution": base["distribution"], "competitors": base["competitors"], "competitor_total": base["competitor_total"],
        "own_pages": base["pages"], "own_hosts": sorted(hosts.values(), key=lambda h: -h["keywords"]), "intents": sorted(({"intent": k, "keywords": v} for k, v in intents.items()), key=lambda i: -i["keywords"]),
        "features_reported": any(o.features for o in obs),
        "changes": changes, "counts": {k: len(v) for k, v in changes.items()},
        "features": {"dates": [d.isoformat() for d in days], "trend": trend, "names": names, "linking": [{"feature": n, "keywords": yours[n]} for n in names],
                     "not_linking": [{"feature": n, "keywords": present[n] - yours[n]} for n in names], "changes": f_changes},
    }


# Sample data (RANK_LANDSCAPE_MOCK, development only): generated checks run through the same code as real ones.
def mock_obs(me: str, days: int, today: date) -> tuple[list[Obs], dict[str, dict]]:
    import random
    rnd = random.Random(me)
    topics = {
        "trade compliance": ["trade compliance challenges", "trade compliance software", "ai trade compliance", "trade compliance training", "trade compliance checklist"],
        "hs code classification": ["hs code classification software", "automated hts code classification", "hs code lookup tool", "what is hs code"],
        "tariff": ["tariff management tool", "tariff software", "tariff classification software", "tariff impact calculator"],
        "landed cost": ["landed cost calculation software", "landed cost calculator", "landed cost formula"],
        "customs": ["customs management system", "customs software solution", "customs broker software"],
    }
    meta = {k: {"volume": rnd.choice([30, 70, 110, 260, 480, 1000, 2400]), "tag": t} for t, ks in topics.items() for k in ks}
    rivals = [f"sample-rival-{n}.com" for n in ("one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten")]
    features = ["Featured snippet", "People also ask", "Videos", "Images", "Related searches", "Local pack", "Knowledge panel", "Top stories"]
    out: list[Obs] = []
    for k in meta:
        base = rnd.uniform(5, 24)
        slope = rnd.uniform(0.0, 0.22)
        prone = rnd.random() < 0.3  # two of the site's pages compete for this keyword
        kf = rnd.sample(features, rnd.randint(1, 4))
        pages = [f"https://{me}/blog/{k.replace(' ', '-')}", f"https://{me}/products/{k.split()[0]}-software"]
        field_ = rnd.sample(rivals, 6)  # who usually appears for this keyword
        for i in range(days + 1):
            d = today - timedelta(days=days - i)
            raw = base - slope * i + rnd.uniform(-2.0, 2.0)
            rank = None if raw > 10.4 else max(1, round(raw))
            order = [r for r in rnd.sample(field_, 5) if rnd.random() < 0.9]
            serp, pos = [], 1
            for r in order:
                if rank == pos:
                    pos += 1
                serp.append({"d": r, "p": pos})
                pos += 1
            out.append(Obs(k, d, rank, pages[0] if rank else None, (pages if prone else pages[:1]) if rank else [], serp, kf, rnd.sample(kf, 1) if rank and rank <= 3 and rnd.random() < 0.4 else []))
    return out, meta
