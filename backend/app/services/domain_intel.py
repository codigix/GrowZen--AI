"""Domain Overview figures from DataForSEO (a paid link and keyword index): authority, estimated organic and paid traffic, keywords,
positions, competitors, ads, and backlinks. Every figure is what the provider returned for that domain; nothing is made up.

Each section is fetched on its own, so one failing call leaves the rest of the page intact. Results are kept in
domain_intel_cache per domain/country/size and reused for the number of days in domain_checks.LIMITS, to keep data costs down.
"""
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import DomainIntelCache
from . import countries
from .providers.dataforseo import DataForSeoError, _post

log = logging.getLogger("seo")
LABS = "/dataforseo_labs/google"
BUCKETS = [("top3", ("pos_1", "pos_2_3")), ("p4_10", ("pos_4_10",)), ("p11_20", ("pos_11_20",)),
           ("p21_50", ("pos_21_30", "pos_31_40", "pos_41_50")), ("p51_100", ("pos_51_60", "pos_61_70", "pos_71_80", "pos_81_90", "pos_91_100"))]
TYPE_LABELS = {"anchor": "Text", "image": "Image", "form": "Form", "frame": "Frame", "redirect": "Redirect", "canonical": "Canonical", "alternate": "Alternate"}


def _loc(country: str) -> dict:
    return {"location_name": countries.name(country), "language_code": "en"}


def _items(task: dict) -> list[dict]:
    return ((task.get("result") or [{}])[0] or {}).get("items") or []


def _num(v: Any, digits: int | None = None) -> float | int | None:
    if v is None:
        return None
    return round(v, digits) if digits is not None else v


def _buckets(m: dict | None) -> dict:
    m = m or {}
    return {k: sum(m.get(p) or 0 for p in parts) for k, parts in BUCKETS}


def _metrics(m: dict | None) -> dict:
    m = m or {}
    return {"count": m.get("count") or 0, "traffic": _num(m.get("etv"), 1) or 0, "traffic_cost": _num(m.get("estimated_paid_traffic_cost"), 2) or 0, **_buckets(m)}


# Sections
def overview(host: str, country: str) -> dict:
    items = _items(_post(f"{LABS}/domain_rank_overview/live", [{"target": host, **_loc(country)}]))
    m = (items[0] if items else {}).get("metrics") or {}
    return {"organic": _metrics(m.get("organic")), "paid": _metrics(m.get("paid"))}


def history(host: str, country: str) -> list[dict]:
    items = _items(_post(f"{LABS}/historical_rank_overview/live", [{"target": host, **_loc(country)}]))
    out = []
    for i in sorted(items, key=lambda x: (x.get("year") or 0, x.get("month") or 0)):
        m = i.get("metrics") or {}
        o, p = _metrics(m.get("organic")), _metrics(m.get("paid"))
        out.append({"date": f"{i['year']}-{i['month']:02d}", "traffic": o["traffic"], "keywords": o["count"], "paid_traffic": p["traffic"], "paid_keywords": p["count"],
                    **{k: o[k] for k, _ in BUCKETS}})
    return out[-24:]


def _kw_rows(items: list[dict]) -> list[dict]:
    rows = []
    for i in items:
        kd, el = i.get("keyword_data") or {}, (i.get("ranked_serp_element") or {}).get("serp_item") or {}
        info = kd.get("keyword_info") or {}
        rows.append({"keyword": kd.get("keyword"), "intent": ((kd.get("search_intent_info") or {}).get("main_intent")), "position": el.get("rank_group"),
                     "volume": info.get("search_volume"), "cpc": _num(info.get("cpc"), 2), "traffic": _num(el.get("etv"), 2) or 0, "url": el.get("relative_url") or el.get("url"),
                     "title": el.get("title"), "description": el.get("description")})
    return [r for r in rows if r["keyword"]]


def keywords(host: str, country: str, limit: int, paid: bool = False) -> dict:
    task = _post(f"{LABS}/ranked_keywords/live", [{"target": host, **_loc(country), "limit": limit, "item_types": ["paid" if paid else "organic"],
                                                  "order_by": ["ranked_serp_element.serp_item.etv,desc"]}], timeout=90)
    res = (task.get("result") or [{}])[0] or {}
    rows = _kw_rows(res.get("items") or [])
    by: dict[str, dict] = {}
    for r in rows:
        k = (r["intent"] or "unknown").lower()
        d = by.setdefault(k, {"intent": k, "keywords": 0, "traffic": 0.0})
        d["keywords"] += 1
        d["traffic"] = round(d["traffic"] + r["traffic"], 2)
    return {"total": res.get("total_count") or len(rows), "rows": rows, "intents": sorted(by.values(), key=lambda d: -d["keywords"])}


def competitors(host: str, country: str, limit: int, paid: bool = False) -> list[dict]:
    items = _items(_post(f"{LABS}/competitors_domain/live", [{"target": host, **_loc(country), "limit": limit, "exclude_top_domains": True, "item_types": ["paid" if paid else "organic"]}], timeout=90))
    out = []
    for i in items:
        fm = ((i.get("full_domain_metrics") or {}).get("paid" if paid else "organic")) or {}
        out.append({"domain": i.get("domain"), "common": i.get("intersections") or 0, "keywords": fm.get("count") or 0, "traffic": _num(fm.get("etv"), 1) or 0,
                    "avg_position": _num(i.get("avg_position"), 1)})
    return [o for o in out if o["domain"]]


def pages(host: str, country: str, limit: int) -> list[dict]:
    items = _items(_post(f"{LABS}/relevant_pages/live", [{"target": host, **_loc(country), "limit": limit, "order_by": ["metrics.organic.etv,desc"]}]))
    return [{"url": i.get("page_address"), "traffic": _num(((i.get("metrics") or {}).get("organic") or {}).get("etv"), 1) or 0,
             "keywords": ((i.get("metrics") or {}).get("organic") or {}).get("count") or 0} for i in items if i.get("page_address")]


def subdomains(host: str, country: str, limit: int) -> list[dict]:
    items = _items(_post(f"{LABS}/subdomains/live", [{"target": host, **_loc(country), "limit": limit, "order_by": ["metrics.organic.etv,desc"]}]))
    out = [{"subdomain": i.get("subdomain"), "traffic": _num(((i.get("metrics") or {}).get("organic") or {}).get("etv"), 2) or 0,
            "keywords": ((i.get("metrics") or {}).get("organic") or {}).get("count") or 0} for i in items if i.get("subdomain")]
    total = sum(o["traffic"] for o in out) or 0
    return [{**o, "share": round(o["traffic"] / total * 100, 2) if total else 0} for o in out]


def _pct(now: float | None, before: float | None) -> float | None:
    return round((now - before) / before * 100, 1) if now is not None and before else None


def organic_summary(out: dict, brand_terms: list[str]) -> dict:
    """The headline figures of Organic Rankings: keywords, traffic and its cost with the change against the month before, and the
    branded / non-branded split of the traffic (branded = the keyword contains the brand; measured on the keywords fetched)."""
    ov = (out.get("overview") or {})
    if not ov.get("ok"):
        return {"ok": False, "error": ov.get("error") or "Not returned"}
    o = ov["data"]["organic"]
    hist = (out.get("history") or {}).get("data") or []
    prev = hist[-2] if len(hist) >= 2 else None
    rows = ((out.get("keywords") or {}).get("data") or {}).get("rows") or []
    terms = [t.lower() for t in brand_terms if t and len(t) >= 3]
    branded = round(sum(r["traffic"] for r in rows if any(t in r["keyword"].lower() for t in terms)), 2) if rows and terms else None
    traffic = o["traffic"]
    return {"ok": True, "data": {"keywords": o["count"], "keywords_change": _pct(o["count"], prev["keywords"] if prev else None), "traffic": traffic,
                                  "traffic_change": _pct(traffic, prev["traffic"] if prev else None), "traffic_cost": o["traffic_cost"],
                                  "branded": branded, "non_branded": round(max(traffic - branded, 0), 2) if branded is not None else None, "sample": len(rows)}}


def backlinks_summary(host: str) -> dict:
    res = (_post("/backlinks/summary/live", [{"target": host, "include_subdomains": True}]).get("result") or [{}])[0] or {}
    total = res.get("backlinks") or 0
    nofollow = (res.get("referring_links_attributes") or {}).get("nofollow") or 0
    types = [{"type": TYPE_LABELS.get(k, k.title()), "count": v, "share": round(v / total * 100, 1) if total else 0}
             for k, v in sorted((res.get("referring_links_types") or {}).items(), key=lambda kv: -kv[1]) if v][:6]
    return {"authority": round((res.get("rank") or 0) / 10), "rank": res.get("rank"), "backlinks": total, "referring_domains": res.get("referring_domains") or 0,
            "follow": max(total - nofollow, 0), "nofollow": nofollow, "types": types, "spam_score": res.get("backlinks_spam_score")}


def backlinks_list(host: str, limit: int) -> list[dict]:
    items = _items(_post("/backlinks/backlinks/live", [{"target": host, "mode": "as_is", "limit": limit, "order_by": ["rank,desc"], "backlinks_status_type": "live"}], timeout=90))
    return [{"title": i.get("page_from_title"), "url_from": i.get("url_from"), "anchor": i.get("anchor"), "url_to": i.get("url_to"), "follow": bool(i.get("dofollow")),
             "domain": i.get("domain_from")} for i in items]


def anchors(host: str, limit: int) -> list[dict]:
    items = _items(_post("/backlinks/anchors/live", [{"target": host, "limit": limit, "order_by": ["backlinks,desc"]}]))
    return [{"anchor": i.get("anchor") or "(empty)", "domains": i.get("referring_domains") or 0, "backlinks": i.get("backlinks") or 0} for i in items]


def ref_domains(host: str, limit: int) -> list[dict]:
    items = _items(_post("/backlinks/referring_domains/live", [{"target": host, "limit": limit, "order_by": ["backlinks,desc"]}]))
    return [{"domain": i.get("domain"), "backlinks": i.get("backlinks") or 0, "authority": round((i.get("rank") or 0) / 10), "country": i.get("country"), "first_seen": i.get("first_seen")}
            for i in items if i.get("domain")]


def indexed_pages(host: str, limit: int) -> list[dict]:
    items = _items(_post("/backlinks/domain_pages/live", [{"target": host, "limit": limit, "order_by": ["page_summary.backlinks,desc"]}]))
    out = []
    for i in items:
        ps = i.get("page_summary") or {}
        out.append({"url": i.get("page"), "title": (i.get("meta") or {}).get("title"), "domains": ps.get("referring_domains") or 0, "backlinks": ps.get("backlinks") or 0})
    return [o for o in out if o["url"]]


def _safe(fn: Callable[[], Any]) -> dict:
    try:
        return {"ok": True, "data": fn()}
    except DataForSeoError as exc:
        return {"ok": False, "error": str(exc)}
    except Exception as exc:  # a malformed answer must not take the whole page down
        log.warning("domain intel section failed: %s", exc)
        return {"ok": False, "error": f"Unexpected answer from the data provider: {str(exc)[:120]}"}


def fetch(host: str, country: str, limits: dict, brand_terms: list[str] | None = None) -> dict:
    """All sections for one domain in one country. Paid competitors and ads are only requested when the domain has paid keywords."""
    jobs = {
        "overview": lambda: overview(host, country),
        "history": lambda: history(host, country),
        "keywords": lambda: keywords(host, country, limits["keywords"]),
        "competitors": lambda: competitors(host, country, limits["competitors"]),
        "pages": lambda: pages(host, country, limits["pages"]),
        "subdomains": lambda: subdomains(host, country, 10),
        "links": lambda: backlinks_summary(host),
        "backlinks": lambda: backlinks_list(host, limits["backlinks"]),
        "anchors": lambda: anchors(host, 10),
        "ref_domains": lambda: ref_domains(host, 10),
        "indexed_pages": lambda: indexed_pages(host, 10),
    }
    with ThreadPoolExecutor(max_workers=5) as ex:
        futures = {k: ex.submit(_safe, fn) for k, fn in jobs.items()}
        out = {k: f.result() for k, f in futures.items()}
    out["organic"] = organic_summary(out, brand_terms or [])
    paid_count = ((out["overview"].get("data") or {}).get("paid") or {}).get("count") or 0
    if paid_count:
        out["paid_keywords"] = _safe(lambda: keywords(host, country, limits["keywords"], paid=True))
        out["paid_competitors"] = _safe(lambda: competitors(host, country, limits["competitors"], paid=True))
    else:
        none = {"ok": True, "data": None}
        out["paid_keywords"], out["paid_competitors"] = none, none
    return out


def by_country(host: str, codes: list[str]) -> list[dict]:
    """Organic and paid keywords and traffic in each target market."""
    def one(code: str) -> dict:
        r = _safe(lambda: overview(host, code))
        return {"code": code, "name": countries.name(code), **({"organic": r["data"]["organic"], "paid": r["data"]["paid"]} if r["ok"] else {"error": r["error"]})}
    with ThreadPoolExecutor(max_workers=4) as ex:
        return list(ex.map(one, codes[:6]))


def cached(db: Session, key: str, host: str, tier: str, days: int, refresh: bool, build: Callable[[], Any]) -> dict:
    """Reuse a stored result younger than `days`; a result with a failed section is not kept, so the next view tries again."""
    row = db.scalar(select(DomainIntelCache).where(DomainIntelCache.domain == host, DomainIntelCache.key == key, DomainIntelCache.tier == tier))
    now = datetime.now(timezone.utc)
    if row and not refresh and row.fetched_at.replace(tzinfo=row.fetched_at.tzinfo or timezone.utc) > now - timedelta(days=days):
        return {"data": row.payload, "fetched_at": row.fetched_at, "cached": True}
    data = build()
    failed = isinstance(data, dict) and any(isinstance(v, dict) and v.get("ok") is False for v in data.values())
    if not failed:
        if not row:
            row = DomainIntelCache(domain=host, key=key, tier=tier)
            db.add(row)
        row.payload, row.fetched_at = data, now
        db.commit()
    return {"data": data, "fetched_at": now, "cached": False}


# Sample data (DOMAIN_INTEL_MOCK, development only): the same shapes the sections above return, so the page can be tested without a provider.
def mock(host: str, country: str, limits: dict, brand_terms: list[str] | None = None) -> dict:
    import random
    rnd = random.Random(f"{host}:{country}")
    ok = lambda d: {"ok": True, "data": d}  # noqa: E731
    months = []
    t, k = 2.0, 6
    for i in range(24):
        y, m = divmod(2026 * 12 + 9 - 23 + i, 12)  # the 24 months ending 2026-10
        t, k = t * rnd.uniform(0.95, 1.22), int(k * rnd.uniform(0.96, 1.2)) + 1
        row = {"date": f"{y}-{m + 1:02d}", "traffic": round(t, 1), "keywords": k, "paid_traffic": round(t * 0.15, 1) if i > 14 else 0, "paid_keywords": (k // 12) if i > 14 else 0}
        row.update(top3=k // 14, p4_10=k // 7, p11_20=k // 6, p21_50=k * 2 // 5, p51_100=k - k // 14 - k // 7 - k // 6 - k * 2 // 5)
        months.append(row)
    last = months[-1]
    organic = {"count": last["keywords"], "traffic": last["traffic"], "traffic_cost": round(last["traffic"] * 3.1, 2), **{b: last[b] for b, _ in BUCKETS}}
    paid = {"count": last["paid_keywords"], "traffic": last["paid_traffic"], "traffic_cost": round(last["paid_traffic"] * 4.2, 2), "top3": 1, "p4_10": 2, "p11_20": 1, "p21_50": 1, "p51_100": 0}
    topics = ["trade compliance software", "customs automation", "hs code classification", "tariff management", "import export compliance", "duty drawback guide",
              "restricted party screening", "customs broker software", "landed cost calculator", "free trade agreement checker", "export control classification", "customs audit checklist"]
    intents = ["informational"] * 6 + ["navigational"] * 3 + ["commercial", "transactional", "informational"]
    kws = [{"keyword": f"{topic} {host.split('.')[0]}" if i % 5 == 4 else topic, "intent": intents[i % len(intents)], "position": rnd.choice([1, 3, 5, 6, 8, 12, 18, 26, 34, 47]),
            "volume": rnd.choice([30, 50, 70, 90, 110, 260, 480, 1000]), "cpc": round(rnd.uniform(0, 17), 2), "traffic": round(rnd.uniform(0.5, 43), 2), "url": f"/blog/{topic.replace(' ', '-')}",
            "title": None, "description": None} for i, topic in enumerate(topics)]
    scale = organic["traffic"] * 0.9 / (sum(r["traffic"] for r in kws) or 1)  # the listed keywords carry about 90% of the domain's traffic
    for r in kws:
        r["traffic"] = round(r["traffic"] * scale, 2)
    kws.sort(key=lambda r: -r["traffic"])
    by_intent: dict[str, dict] = {}
    for r in kws:
        d = by_intent.setdefault(r["intent"], {"intent": r["intent"], "keywords": 0, "traffic": 0.0})
        d["keywords"] += 1
        d["traffic"] = round(d["traffic"] + r["traffic"], 2)
    rivals = ["sample-rival-one.com", "sample-rival-two.io", "sample-rival-three.net", "sample-rival-four.co", "sample-rival-five.ai"]
    comp = [{"domain": d, "common": rnd.randint(1, 12), "keywords": rnd.randint(30, 400), "traffic": round(rnd.uniform(1, 130), 1), "avg_position": round(rnd.uniform(8, 40), 1)} for d in rivals]
    paid_rows = [{"keyword": q, "intent": "commercial", "position": rnd.randint(1, 3), "volume": rnd.choice([50, 90, 210]), "cpc": round(rnd.uniform(1, 9), 2), "traffic": round(rnd.uniform(0.2, 4), 2), "url": f"https://{host}/",
                  "title": f"{q.title()} | {host}", "description": f"Sample ad text for “{q}”. Replaced by real ads once DataForSEO is connected."}
                 for q in ["customs compliance software", "hs code lookup tool", "tariff software demo"]]
    total = rnd.randint(1800, 2600)
    nofollow = total // 7
    pages = [{"url": f"https://{host}/blog/{t.replace(' ', '-')}", "traffic": round(rnd.uniform(0.5, 12), 1), "keywords": rnd.randint(3, 40)} for t in topics[:8]]
    anchors = ["import compliance software", "features that matter", "common classification problems", "this guide to HS codes", "smarter trade compliance"]
    sub = [{"subdomain": host, "traffic": round(organic["traffic"] * 0.88, 2), "keywords": organic["count"] * 4 // 5}, {"subdomain": f"blog.{host}", "traffic": round(organic["traffic"] * 0.12, 2), "keywords": organic["count"] // 5}]
    sub = [{**s_, "share": round(s_["traffic"] / (sum(x["traffic"] for x in sub) or 1) * 100, 2)} for s_ in sub]
    out = {
        "subdomains": ok(sub), "overview": ok({"organic": organic, "paid": paid}), "history": ok(months),
        "keywords": ok({"total": organic["count"], "rows": kws[:limits["keywords"]], "intents": sorted(by_intent.values(), key=lambda d: -d["keywords"])}),
        "competitors": ok(comp), "pages": ok(sorted(pages, key=lambda p: -p["traffic"])),
        "links": ok({"authority": rnd.randint(8, 34), "rank": 90, "backlinks": total, "referring_domains": total * 3 // 4, "follow": total - nofollow, "nofollow": nofollow,
                     "types": [{"type": "Text", "count": total - 6, "share": 99.7}, {"type": "Image", "count": 5, "share": 0.2}, {"type": "Form", "count": 1, "share": 0.1}], "spam_score": 12}),
        "backlinks": ok([{"title": f"Sample article {i + 1}: how importers can stay compliant", "url_from": f"https://sample-blog-{i + 1}.example.com/post-{i + 1}", "anchor": a,
                          "url_to": f"https://{host}/blog/{topics[i].replace(' ', '-')}", "follow": i % 4 != 2, "domain": f"sample-blog-{i + 1}.example.com"} for i, a in enumerate(anchors)]),
        "anchors": ok([{"anchor": a, "domains": rnd.randint(10, 150), "backlinks": rnd.randint(20, 400)} for a in [host, "customs software", "click here", "trade compliance guide", "read more"]]),
        "ref_domains": ok([{"domain": f"sample-site-{i + 1}.example.com", "backlinks": rnd.randint(5, 40), "authority": rnd.randint(5, 60), "country": rnd.choice(["US", "IN", "GB", "DE", "AE"]), "first_seen": None} for i in range(5)]),
        "indexed_pages": ok([{"url": f"https://{host}{p}", "title": t, "domains": rnd.randint(1, 70), "backlinks": rnd.randint(1, 130)}
                             for p, t in [("/", "Home"), ("/products/classification", "Classification"), ("/blog/what-is-trade-compliance", "What is trade compliance?"), ("/pricing", "Pricing")]]),
        "paid_keywords": ok({"total": len(paid_rows), "rows": paid_rows, "intents": []}) if paid["count"] else ok(None),
        "paid_competitors": ok([{"domain": d, "common": rnd.randint(1, 5), "keywords": rnd.randint(5, 60), "traffic": round(rnd.uniform(1, 30), 1)} for d in rivals[:3]]) if paid["count"] else ok(None),
    }
    out["organic"] = organic_summary(out, brand_terms or [])
    return out


def mock_by_country(host: str, codes: list[str]) -> list[dict]:
    import random
    out = []
    for c in codes[:6]:
        rnd = random.Random(f"{host}:{c}")
        k = rnd.randint(20, 150)
        base = {"top3": k // 14, "p4_10": k // 7, "p11_20": k // 6, "p21_50": k * 2 // 5, "p51_100": k // 5}
        out.append({"code": c, "name": countries.name(c), "organic": {"count": k, "traffic": round(k * rnd.uniform(0.1, 0.4), 1), "traffic_cost": 0, **base},
                    "paid": {"count": rnd.randint(0, 6), "traffic": round(rnd.uniform(0, 5), 1), "traffic_cost": 0, **base}})
    return out
