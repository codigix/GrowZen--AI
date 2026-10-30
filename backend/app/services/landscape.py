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
from statistics import mean

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


def landscape(obs: list[Obs], meta: dict[str, dict], me: str, start: date, end: date) -> dict:
    """meta: keyword -> {volume, tag}. me: the tracked domain."""
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
        rows.append({"keyword": k, "rank": z, "was": a, "change": (a or OUT) - (z or OUT) if comparable else None, "visibility": _r1(ctr(z) / (n * CTR[0]) * 100, 2), "gain": _r1(gain, 2),
                     "volume": vol(k) or None, "tag": (meta.get(k) or {}).get("tag"), "url": last[k].url})
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
        comp.append({"domain": d, "you": d == me, "visibility": _r1(v, 2), "change": _delta(v, w, 2) if comparable else None, "keywords": len(ps), "avg_position": _r1(mean(ps.values()), 1)})
    comp.sort(key=lambda c: (-(c["visibility"] or 0), c["domain"]))
    shown = comp[:10]
    if not any(c["you"] for c in shown):
        shown = comp[:9] + [c for c in comp if c["you"]]
    for i, c in enumerate(comp, 1):
        c["rank"] = i

    # SERP features at the latest check
    feats = {}
    for o in last.values():
        for f in o.features:
            feats.setdefault(f, {"feature": f, "keywords": 0, "yours": 0})["keywords"] += 1
        for f in o.own_features:
            feats.setdefault(f, {"feature": f, "keywords": 0, "yours": 0})["yours"] += 1

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

    # Cannibalization: more than one page of the site ranking for the same keyword
    affected = {k for k, o in last.items() if len(set(o.own_urls)) >= 2}
    cannibal = {"affected": len(affected), "keywords": n, "pages": len({u for k in affected for u in set(last[k].own_urls)}),
                "health": _r1((n - len(affected)) / n * 100, 0), "health_change": _delta((n - len(affected)) / n * 100, (n - sum(1 for o in first.values() if len(set(o.own_urls)) >= 2)) / n * 100, 0) if comparable else None,
                "series": [{"date": x["date"], "health": _r1((x["keywords"] - x["cannibal"]) / x["keywords"] * 100, 0)} for x in series]}

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
        "all_keywords": sorted(rows, key=lambda r: (r["rank"] or 99, r["keyword"])), "tags": tags, "competitors": shown, "competitor_total": len(comp),
        "serp_features": sorted(feats.values(), key=lambda f: -f["keywords"]), "pages": {"top": by_traffic[:8], "improved": [p for p in by_traffic if (p["traffic_change"] or 0) > 0][:8],
                                                                                   "declined": [p for p in by_traffic if (p["traffic_change"] or 0) < 0][:8], "total": len(pages)},
        "cannibal": cannibal,
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
    return {
        "state": "ok", "domain": me, "period": {"start": days[0].isoformat(), "end": days[-1].isoformat(), "checks": len(days)}, "tracked": len(last), "comparable": comparable,
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
