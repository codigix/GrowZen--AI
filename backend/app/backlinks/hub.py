"""The backlink workspace: our own links as our crawler found them, each one with what matters (follow or nofollow, anchor, kind of site, DA / PA / spam score, whether it is
useful), the referring domains behind them, the sites that link to competitors but not to us, and an audit of what needs attention.

Everything is read from what the crawler already stored in this platform (see crawler_sync.py): nothing is fetched here and nothing is invented.
- follow / nofollow / sponsored / ugc: the link's rel attributes as the crawler read them.
- anchor type: branded, exact-match / commercial, generic, a bare address...
- kind of site (category): fixed rules on the address and the page (see services/backlink_checker.categorize).
- DA / PA / spam score: Moz, only when MOZ_ACCESS_ID and MOZ_SECRET_KEY are set, cached per domain; otherwise shown as "not measured".
- useful or not: our own judgement (relevance to the business and spam risk, AI when configured, plain rules otherwise), combined with the link's follow type and Moz's figures
  when there are any. It says why. It is not a Google, Moz or Ahrefs metric.
"""
from __future__ import annotations

import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from ..db import utcnow
from ..models import Business
from . import analytics, quality
from .lifecycle import LIVE_STATES
from .models import Backlink, BiBotConfig, BiDomain, BiDomainMetric, BiPage, BiTrackedTarget

METRIC_TTL = timedelta(days=14)
MAX_LINKS = 5000
STATUS_LABEL = {"NEW": "New", "LIVE": "Live", "RESTORED": "Restored", "CHANGED": "Live (changed)", "BROKEN_TARGET": "Live (target page broken)", "REDIRECTED_SOURCE": "Live (source redirects)",
                "LOST_PENDING": "Maybe lost", "LOST_CONFIRMED": "Lost", "SOURCE_UNAVAILABLE": "Source unreachable", "UNKNOWN": "Unknown"}
HOW = {  # what to do, by the kind of site a competitor's link comes from
    "directory": "Create or claim a listing there with the same name, address and phone as your Google profile.",
    "blog": "Pitch a useful guest article or ask to be mentioned in a related post.",
    "news": "Send a short press note with something genuinely new (an event, a figure, an offer).",
    "forum": "Join the conversation and answer questions honestly; add a link only where it really helps.",
    "education": "Offer a talk, a sponsorship or a resource the institution can use.",
    "government": "Check whether a registration or a listing is open to your kind of business.",
    "reference": "Only if your business meets their notability rules: do not request it.",
    "social": "Create or complete the profile and link back to your website.",
    "comment": "Not worth chasing: comment links carry little value.",
    "website": "Write a short, personal message that says what you offer and why it helps their readers.",
}


def _aware(dt: datetime | None) -> datetime | None:
    return dt if dt is None or dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def own_domain(db: Session, business_id: int) -> str | None:
    return db.scalar(select(BiTrackedTarget.domain).where(BiTrackedTarget.business_id == business_id, BiTrackedTarget.is_competitor.is_(False)).order_by(BiTrackedTarget.id))


def brand_terms(b: Business, domain: str | None) -> set[str]:
    terms = {w for w in re.findall(r"[a-z0-9]{3,}", (b.name or "").lower())}
    if domain:
        terms.add(domain.split(".")[0])
    return terms


def follow_of(rel: list[str] | None) -> str:
    r = {x.lower() for x in (rel or [])}
    return "nofollow" if "nofollow" in r else "sponsored" if "sponsored" in r else "ugc" if "ugc" in r else "dofollow"


# ------------------------------------------------------------------------------------------------------------------------ Moz figures (cached)
def metrics_for(db: Session, domains: list[str]) -> dict[str, dict[str, Any]]:
    if not domains:
        return {}
    return {m.domain: {"da": m.da, "pa": m.pa, "spam": m.spam_score, "ref_domains": m.linking_domains, "fetched_at": _aware(m.fetched_at).isoformat() if m.fetched_at else None}
            for m in db.scalars(select(BiDomainMetric).where(BiDomainMetric.domain.in_(domains)))}


def refresh_metrics(db: Session, domains: list[str], limit: int = 50, force: bool = False) -> dict[str, Any]:
    """DA, PA and spam score from Moz for domains with no figures yet (or older than two weeks). Does nothing, and says so, when Moz is not set up."""
    from ..services import backlink_checker as bc
    if not bc.moz_configured():
        return {"configured": False, "refreshed": 0, "message": "DA, PA and spam score come from Moz: add MOZ_ACCESS_ID and MOZ_SECRET_KEY to the backend settings."}
    now = utcnow()
    have = {m.domain: m for m in db.scalars(select(BiDomainMetric).where(BiDomainMetric.domain.in_(domains or [""])))}
    todo = [d for d in dict.fromkeys(domains) if force or d not in have or not have[d].fetched_at or now - _aware(have[d].fetched_at) > METRIC_TTL][:limit]
    if not todo:
        return {"configured": True, "refreshed": 0, "message": "All figures are recent."}
    try:
        got = bc.moz_metrics([f"https://{d}/" for d in todo])
    except bc.CheckError as exc:
        return {"configured": True, "refreshed": 0, "message": str(exc)}
    n = 0
    for d in todo:
        m = got.get(f"https://{d}/") or got.get(d) or got.get(f"{d}/") or next((v for k, v in got.items() if k.lower().removeprefix("https://").removeprefix("www.").rstrip("/") == d), None)
        if not m:
            continue
        row = have.get(d) or BiDomainMetric(domain=d)
        row.da, row.pa, row.spam_score, row.linking_domains, row.fetched_at, row.source = m.get("da"), m.get("pa"), m.get("spam"), m.get("ref_domains"), now, "moz"
        db.add(row)
        n += 1
    db.commit()
    return {"configured": True, "refreshed": n, "message": f"Updated {n} domain{'s' if n != 1 else ''}." if n else "Moz returned no figures for these domains."}


# ------------------------------------------------------------------------------------------------------------------------ is it useful?
def judge(follow: str, score: dict | None, metric: dict | None, category: str) -> dict[str, Any]:
    """useful | neutral | risky | unscored, with the reason in one sentence. Our judgement, not a third party's metric."""
    spam = (metric or {}).get("spam")
    da = (metric or {}).get("da")
    if score is None and not metric:
        return {"label": "unscored", "why": "Not judged yet: the domain has no relevance or spam score. Press “Score the links”."}
    risky = bool(score and score["verdict"] == "risky") or (spam is not None and spam >= 50)
    if risky:
        why = score["reason"] if score and score["verdict"] == "risky" else f"Moz spam score {spam}%."
        return {"label": "risky", "why": why}
    if category == "comment":
        return {"label": "neutral", "why": "A comment link: it carries little value."}
    good = bool(score and score["verdict"] == "good") or (da is not None and da >= 30 and (spam is None or spam < 30))
    if follow == "dofollow" and good:
        return {"label": "useful", "why": (score["reason"] if score else f"A dofollow link from a site with DA {da}.")}
    if follow != "dofollow":
        return {"label": "neutral", "why": f"A {follow} link: it sends visitors and shows you are known, but passes little ranking value."}
    return {"label": "neutral", "why": (score["reason"] if score else "A dofollow link, but nothing says the site is a strong or relevant one.")}


# ------------------------------------------------------------------------------------------------------------------------ our links
def _rows(db: Session, domain: str, states: set[str] | frozenset[str] | None = None, limit: int = MAX_LINKS):
    SD, TD = aliased(BiDomain), aliased(BiDomain)
    q = (select(Backlink, BiPage, SD.registrable_domain).join(BiPage, BiPage.id == Backlink.source_page_id).join(SD, SD.id == Backlink.source_domain_id)
         .join(TD, TD.id == Backlink.target_domain_id).where(TD.registrable_domain == domain))
    if states:
        q = q.where(Backlink.current_status.in_(states))
    return db.execute(q.order_by(Backlink.last_seen_at.desc().nullslast(), Backlink.id.desc()).limit(limit)).all()


def _link_out(bl: Backlink, page: BiPage, dom: str, score: dict | None, metric: dict | None, brand: set[str]) -> dict[str, Any]:
    from ..services import backlink_checker as bc
    follow = follow_of(bl.rel_attributes)
    cat = bc.categorize(page.normalized_url, bl.placement, page.title)
    j = judge(follow, score, metric, cat["key"])
    return {"id": bl.id, "source_url": page.normalized_url, "source_domain": dom, "source_title": page.title, "target_url": bl.target_url, "anchor": " ".join((bl.anchor_text or "").split()) or None,
            "anchor_type": analytics.classify_anchor(bl.anchor_text, brand), "follow": follow, "rel": list(bl.rel_attributes or []), "placement": bl.placement,
            "status": bl.current_status, "status_label": STATUS_LABEL.get(bl.current_status, bl.current_status.title()), "is_live": bl.current_status in LIVE_STATES,
            "verified": bl.verification_status == "CRAWLER_VERIFIED", "first_seen": _aware(bl.first_seen_at).isoformat() if bl.first_seen_at else None,
            "last_seen": _aware(bl.last_seen_at).isoformat() if bl.last_seen_at else None, "last_verified": _aware(bl.last_verified_at).isoformat() if bl.last_verified_at else None,
            "category": {"key": cat["key"], "label": cat["label"]}, "quality": ({"relevance": score["relevance"], "risk": score["risk"], "verdict": score["verdict"], "reason": score["reason"], "method": score["method"]} if score else None),
            "metrics": metric, "useful": j["label"], "useful_why": j["why"]}


def links(db: Session, b: Business, *, status: str = "live", follow: str = "", category: str = "", useful: str = "", q: str = "", sort: str = "recent", limit: int = 50, offset: int = 0) -> dict[str, Any]:
    domain = own_domain(db, b.id)
    if not domain:
        return {"state": "no_target", "domain": None}
    scores = quality.scores_for(db, b.id)
    rows = _rows(db, domain)
    metrics = metrics_for(db, sorted({d for _, _, d in rows}))
    brand = brand_terms(b, domain)
    out = [_link_out(bl, page, dom, scores.get(dom), metrics.get(dom), brand) for bl, page, dom in rows]
    facets = {"status": Counter("live" if x["is_live"] else "lost" for x in out), "follow": Counter(x["follow"] for x in out if x["is_live"]), "category": Counter(x["category"]["key"] for x in out if x["is_live"]),
              "useful": Counter(x["useful"] for x in out if x["is_live"])}
    live = [x for x in out if x["is_live"]]

    def keep(x: dict[str, Any]) -> bool:
        if status == "live" and not x["is_live"] or status == "lost" and x["is_live"]:
            return False
        if follow and x["follow"] != follow or category and x["category"]["key"] != category or useful and x["useful"] != useful:
            return False
        needle = q.strip().lower()
        return not needle or needle in f"{x['source_url']} {x['anchor'] or ''} {x['target_url']} {x['source_title'] or ''}".lower()

    shown = [x for x in out if keep(x)]
    key = {"recent": lambda x: x["last_seen"] or "", "domain": lambda x: x["source_domain"], "da": lambda x: (x["metrics"] or {}).get("da") or -1}.get(sort, lambda x: x["last_seen"] or "")
    shown.sort(key=key, reverse=sort != "domain")
    return {"state": "ok", "domain": domain, "links": shown[offset:offset + limit], "total": len(shown), "live_total": len(live), "offset": offset, "limit": limit,
            "facets": {k: dict(v) for k, v in facets.items()}, "metrics_ready": bool(metrics)}


# ------------------------------------------------------------------------------------------------------------------------ referring domains
def domains(db: Session, b: Business, *, sort: str = "links", q: str = "", verdict: str = "", limit: int = 100, offset: int = 0) -> dict[str, Any]:
    domain = own_domain(db, b.id)
    if not domain:
        return {"state": "no_target", "domain": None}
    scores = quality.scores_for(db, b.id)
    rows = _rows(db, domain)
    metrics = metrics_for(db, sorted({d for _, _, d in rows}))
    brand = brand_terms(b, domain)
    from ..services import backlink_checker as bc
    groups: dict[str, dict[str, Any]] = {}
    for bl, page, dom in rows:
        g = groups.setdefault(dom, {"domain": dom, "links": 0, "live": 0, "lost": 0, "dofollow": 0, "nofollow": 0, "anchors": Counter(), "categories": Counter(), "pages": set(), "first_seen": None, "last_seen": None,
                                    "sample": page.normalized_url, "title": page.title})
        g["links"] += 1
        live = bl.current_status in LIVE_STATES
        g["live" if live else "lost"] += 1
        if live:
            g["dofollow" if follow_of(bl.rel_attributes) == "dofollow" else "nofollow"] += 1
            g["anchors"][" ".join((bl.anchor_text or "").split()) or "(no anchor)"] += 1
            g["categories"][bc.categorize(page.normalized_url, bl.placement, page.title)["key"]] += 1
            g["pages"].add(page.id)
        fs, ls = _aware(bl.first_seen_at), _aware(bl.last_seen_at)
        g["first_seen"] = min([x for x in (g["first_seen"], fs) if x], default=None)
        g["last_seen"] = max([x for x in (g["last_seen"], ls) if x], default=None)
    out = []
    for dom, g in groups.items():
        if not g["live"] and not g["lost"]:
            continue
        cat = g["categories"].most_common(1)[0][0] if g["categories"] else "website"
        follow = "dofollow" if g["dofollow"] >= g["nofollow"] and g["dofollow"] else "nofollow" if g["nofollow"] else "dofollow"
        sc, mt = scores.get(dom), metrics.get(dom)
        j = judge(follow, sc, mt, cat)
        out.append({"domain": dom, "links": g["links"], "live": g["live"], "lost": g["lost"], "dofollow": g["dofollow"], "nofollow": g["nofollow"], "pages": len(g["pages"]), "category": {"key": cat, "label": bc.categorize(f"https://{dom}/", None, None)["label"] if cat == "website" else bc.categorize(g["sample"], None, g["title"])["label"]},
                    "anchors": [a for a, _ in g["anchors"].most_common(3)], "first_seen": g["first_seen"].isoformat() if g["first_seen"] else None, "last_seen": g["last_seen"].isoformat() if g["last_seen"] else None,
                    "quality": ({"relevance": sc["relevance"], "risk": sc["risk"], "verdict": sc["verdict"], "reason": sc["reason"], "method": sc["method"]} if sc else None), "metrics": mt, "useful": j["label"], "useful_why": j["why"], "sample_url": g["sample"]})
    needle = q.strip().lower()
    out = [x for x in out if (not needle or needle in x["domain"]) and (not verdict or x["useful"] == verdict)]
    key = {"links": lambda x: -x["live"], "da": lambda x: -((x["metrics"] or {}).get("da") or -1), "domain": lambda x: x["domain"], "risk": lambda x: -((x["quality"] or {}).get("risk") or 0), "recent": lambda x: x["last_seen"] or ""}.get(sort, lambda x: -x["live"])
    out.sort(key=key, reverse=sort == "recent")
    return {"state": "ok", "domain": domain, "domains": out[offset:offset + limit], "total": len(out), "offset": offset, "limit": limit}


# ------------------------------------------------------------------------------------------------------------------------ where competitors have links and we do not
def opportunities(db: Session, b: Business, *, q: str = "", category: str = "", limit: int = 60) -> dict[str, Any]:
    from ..competitors import hygiene
    from ..services import backlink_checker as bc
    me = own_domain(db, b.id)
    comps = [d for d in hygiene.saved_competitor_domains(db, b) if d != me]
    if not me:
        return {"state": "no_target", "domain": None, "competitors": comps}
    if not comps:
        return {"state": "no_competitors", "domain": me, "competitors": []}
    gap = analytics.gap(db, me, comps)
    if not gap:
        return {"state": "ok", "domain": me, "competitors": comps, "opportunities": [], "total": 0, "note": "No site links to your competitors and not to you yet: the crawler is still learning their links."}
    gap = gap[:300]
    names = [g["domain"] for g in gap]
    context = quality.business_context(b)
    facts = quality.domain_facts(db, b.id, comps, names)
    scores = quality.scores_for(db, b.id)
    metrics = metrics_for(db, names)
    SD, TD = aliased(BiDomain), aliased(BiDomain)
    sample: dict[str, dict[str, Any]] = {}
    for bl, page, sdom, tdom in db.execute(select(Backlink, BiPage, SD.registrable_domain, TD.registrable_domain).join(BiPage, BiPage.id == Backlink.source_page_id).join(SD, SD.id == Backlink.source_domain_id)
                                           .join(TD, TD.id == Backlink.target_domain_id).where(SD.registrable_domain.in_(names), TD.registrable_domain.in_(comps), Backlink.current_status.in_(LIVE_STATES))
                                           .order_by(Backlink.id)):
        s = sample.setdefault(sdom, {"url": page.normalized_url, "title": page.title, "anchor": bl.anchor_text, "target": bl.target_url, "rel": bl.rel_attributes, "placement": bl.placement, "dofollow": 0, "total": 0})
        s["total"] += 1
        s["dofollow"] += 1 if follow_of(bl.rel_attributes) == "dofollow" else 0
    out = []
    for g in gap:
        dom = g["domain"]
        s = sample.get(dom)
        if not s:
            continue
        sc = scores.get(dom) or quality.rule_score(dom, facts.get(dom, {"links": 0, "pages": 0, "anchors": [], "placements": {}, "nofollow": 0, "titles": [], "snippets": []}), context)
        method = (scores.get(dom) or {}).get("method", "rules")
        cat = bc.categorize(s["url"], s["placement"], s["title"])
        follow = "dofollow" if s["dofollow"] * 2 >= s["total"] else "nofollow"
        mt = metrics.get(dom)
        j = judge(follow, {**sc, "method": method}, mt, cat["key"])
        if j["label"] == "risky":
            continue  # never suggest chasing a spammy site just because a competitor has it
        da = (mt or {}).get("da") or 0
        priority = sc["relevance"] * 0.5 + g["competitor_count"] * 15 + (15 if follow == "dofollow" else 0) + da * 0.3 - sc["risk"] * 0.5
        out.append({"domain": dom, "competitors": g["competitors"], "competitor_count": g["competitor_count"], "links": g["backlinks"], "category": {"key": cat["key"], "label": cat["label"]}, "follow": follow,
                    "sample": {"url": s["url"], "title": s["title"], "anchor": " ".join((s["anchor"] or "").split()) or None, "competitor_page": s["target"]},
                    "quality": {"relevance": sc["relevance"], "risk": sc["risk"], "verdict": sc["verdict"], "reason": sc["reason"], "method": method}, "metrics": mt, "useful": j["label"], "useful_why": j["why"],
                    "how": HOW.get(cat["key"], HOW["website"]), "priority_score": round(priority, 1)})
    needle = q.strip().lower()
    out = [x for x in out if (not needle or needle in x["domain"]) and (not category or x["category"]["key"] == category)]
    out.sort(key=lambda x: -x["priority_score"])
    for i, x in enumerate(out):
        x["priority"] = "high" if i < 8 and x["priority_score"] >= 45 else "medium" if x["priority_score"] >= 30 else "low"
    return {"state": "ok", "domain": me, "competitors": comps, "opportunities": out[:limit], "total": len(out)}


# ------------------------------------------------------------------------------------------------------------------------ what needs attention
def audit(db: Session, b: Business) -> dict[str, Any]:
    domain = own_domain(db, b.id)
    if not domain:
        return {"state": "no_target", "domain": None}
    data = links(db, b, status="all", limit=MAX_LINKS)
    allrows = data["links"]
    live = [x for x in allrows if x["is_live"]]
    lost = [x for x in allrows if not x["is_live"]]
    items: list[dict[str, Any]] = []
    risky = [x for x in live if x["useful"] == "risky"]
    if risky:
        doms = sorted({x["source_domain"] for x in risky})
        items.append({"key": "risky", "severity": "serious", "title": f"{len(risky)} link{'s' if len(risky) != 1 else ''} from {len(doms)} risky site{'s' if len(doms) != 1 else ''}", "why": "These links look spammy, paid or automated, and can drag your site down.",
                      "fix": "Ask the site to remove the link; if it will not, add the domain to the disavow file.", "examples": [{"url": x["source_url"], "note": x["useful_why"]} for x in risky[:5]], "count": len(risky),
                      "action": {"label": "Download disavow file", "href": f"/api/v1/businesses/{b.id}/backlink-intel/disavow?domain={domain}"}})
    if lost:
        items.append({"key": "lost", "severity": "warning", "title": f"{len(lost)} link{'s' if len(lost) != 1 else ''} lost", "why": "A link that was there is gone: the page was removed, edited or the link deleted.",
                      "fix": "Check the page. If it was removed by mistake, ask the owner to restore it.", "examples": [{"url": x["source_url"], "note": f"{x['status_label']} · last seen {(x['last_seen'] or '')[:10]}"} for x in lost[:5]], "count": len(lost)})
    nofollow = [x for x in live if x["follow"] != "dofollow"]
    if live and len(nofollow) / len(live) > 0.6:
        items.append({"key": "nofollow", "severity": "info", "title": f"{round(len(nofollow) / len(live) * 100)}% of your links are nofollow, sponsored or ugc", "why": "These links bring visitors but pass little ranking value, so your link profile is weaker than the count suggests.",
                      "fix": "Aim for editorial dofollow links: guest articles, partners, local associations and relevant directories.", "examples": [{"url": x["source_url"], "note": x["follow"]} for x in nofollow[:4]], "count": len(nofollow)})
    money = [x for x in live if x["anchor_type"] == "money"]
    if live and len(money) / len(live) > 0.3:
        items.append({"key": "anchors", "severity": "warning", "title": f"{round(len(money) / len(live) * 100)}% of anchors are keyword or commercial phrases", "why": "A profile where most anchors are exact keywords looks manipulated to Google.",
                      "fix": "Earn links with your brand name and plain words as the anchor. Never ask a site to use a keyword anchor.", "examples": [{"url": x["source_url"], "note": f"anchor “{x['anchor']}”"} for x in money[:4]], "count": len(money)})
    unscored = [x for x in live if x["useful"] == "unscored"]
    if unscored:
        items.append({"key": "unscored", "severity": "info", "title": f"{len(unscored)} link{'s' if len(unscored) != 1 else ''} not judged yet", "why": "Their sites have no relevance or spam score yet, so they could be good or bad.",
                      "fix": "Press “Score the links” on the Referring domains page.", "examples": [{"url": x["source_url"], "note": "no score"} for x in unscored[:4]], "count": len(unscored)})
    sitewide = Counter(x["source_domain"] for x in live)
    heavy = [d for d, n in sitewide.items() if n >= 20]
    if heavy:
        items.append({"key": "sitewide", "severity": "info", "title": f"{len(heavy)} site{'s' if len(heavy) != 1 else ''} link to you 20 times or more", "why": "Many links from one site (often a footer) count as roughly one link.",
                      "fix": "Do not count these as separate wins; ask for a single, editorial link instead.", "examples": [{"url": d, "note": f"{sitewide[d]} links"} for d in heavy[:4]], "count": len(heavy)})
    return {"state": "ok", "domain": domain, "items": items, "live": len(live), "lost": len(lost), "healthy": not any(i["severity"] in ("serious", "warning") for i in items)}


# ------------------------------------------------------------------------------------------------------------------------ the summary and where the data is used
def summary(db: Session, b: Business) -> dict[str, Any]:
    from ..config import get_settings
    from ..models import AgentTask, GrowthAction
    from ..services import backlink_checker as bc
    domain = own_domain(db, b.id)
    s = get_settings()
    cfg = db.scalar(select(BiBotConfig).where(BiBotConfig.business_id == b.id))
    crawler = {"configured": s.crawler_enabled, "last_sync_at": _aware(cfg.last_run_at).isoformat() if cfg and cfg.last_run_at else None, "last_error": ((cfg.last_stats or {}).get("error") if cfg else None),
               "domains": (cfg.last_stats or {}).get("domains") if cfg else None, "links_read": (cfg.last_stats or {}).get("links_read") if cfg else None, "running": bool(cfg and cfg.running)}
    moz = {"configured": bc.moz_configured()}
    if not domain:
        return {"state": "no_target", "domain": None, "crawler": crawler, "moz": moz}
    data = links(db, b, status="all", limit=MAX_LINKS)
    rows = data["links"]
    live = [x for x in rows if x["is_live"]]
    since = utcnow() - timedelta(days=30)
    new30 = sum(1 for x in live if x["first_seen"] and datetime.fromisoformat(x["first_seen"]) >= since)
    lost30 = sum(1 for x in rows if not x["is_live"] and x["last_seen"] and datetime.fromisoformat(x["last_seen"]) >= since)
    das = [(x["metrics"] or {}).get("da") for x in live if (x["metrics"] or {}).get("da") is not None]
    doms = {x["source_domain"] for x in live}
    follow = Counter(x["follow"] for x in live)
    useful = Counter(x["useful"] for x in live)
    anchors = Counter(x["anchor_type"] for x in live)
    cats = Counter(x["category"]["key"] for x in live)
    bl_tasks = db.scalars(select(GrowthAction).where(GrowthAction.business_id == b.id, GrowthAction.period == "fix", GrowthAction.key.like("fix.bl.%"), GrowthAction.status.in_(("todo", "done", "unverified", "failed", "blocked")))).all()
    outreach = db.scalars(select(AgentTask).where(AgentTask.business_id == b.id, AgentTask.agent == "outreach", AgentTask.status.in_(("pending", "approved")))).all() if hasattr(AgentTask, "status") else []
    used = [
        {"where": "Growth Plan", "what": f"{len(bl_tasks)} open backlink task{'s' if len(bl_tasks) != 1 else ''}: ask sites that link to competitors, grow referring domains, fix risky links.", "to": "/growth#issues"},
        {"where": "Journey, step 9", "what": "“Build and check backlinks” turns green when working backlinks are confirmed by the crawler.", "to": "/dashboard"},
        {"where": "Weekly and monthly reports", "what": "Referring domains and links gained or lost are part of the report that is emailed.", "to": "/growth#reports"},
        {"where": "Outreach and approvals", "what": f"{len(outreach)} removal or outreach draft{'s' if len(outreach) != 1 else ''} waiting for your approval. Nothing is sent without it.", "to": "/google-posts"},
        {"where": "Backlink Checker", "what": "Check any list of links: is it working, follow or nofollow, the anchor, DA / PA / spam score.", "to": "/backlink-checker"},
    ]
    return {"state": "ok", "domain": domain, "crawler": crawler, "moz": moz, "totals": {"live": len(live), "lost": len(rows) - len(live), "new_30d": new30, "lost_30d": lost30, "referring_domains": len(doms),
            "dofollow": follow.get("dofollow", 0), "nofollow": len(live) - follow.get("dofollow", 0), "dofollow_share": round(follow.get("dofollow", 0) / len(live) * 100) if live else None,
            "avg_da": round(sum(das) / len(das), 1) if das else None, "verified": sum(1 for x in live if x["verified"])},
            "useful": dict(useful), "follow": dict(follow), "anchors": dict(anchors), "categories": dict(cats), "used_in": used}
