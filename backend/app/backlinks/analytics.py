"""Metrics, anchor analysis and competitor gap over the backlink graph (PRD 13).

Counts are always for *current* links (LIVE_STATES) and can be filtered by whether our crawler has verified them.
Verified and not-yet-verified figures are never merged into one unlabeled number.
"""
from collections import Counter
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from .lifecycle import LIVE_STATES
from .models import Backlink, BacklinkEvent, BiDomain

SourceDomain = aliased(BiDomain)
TargetDomain = aliased(BiDomain)


def _live_for(domain: str, verified_only: bool = False):
    q = (select(Backlink).join(TargetDomain, TargetDomain.id == Backlink.target_domain_id)
         .where(TargetDomain.registrable_domain == domain, Backlink.current_status.in_(LIVE_STATES)))
    return q.where(Backlink.verification_status == "CRAWLER_VERIFIED") if verified_only else q


def counts(db: Session, domain: str) -> dict:
    """Live-link totals for the dashboard and assistant: three aggregate queries, no rows loaded into Python."""
    base = (select(func.count(Backlink.id)).join(TargetDomain, TargetDomain.id == Backlink.target_domain_id)
            .where(TargetDomain.registrable_domain == domain, Backlink.current_status.in_(LIVE_STATES)))
    total = db.scalar(base) or 0
    verified = db.scalar(base.where(Backlink.verification_status == "CRAWLER_VERIFIED")) or 0
    ref = db.scalar(select(func.count(func.distinct(SourceDomain.registrable_domain))).select_from(Backlink)
                    .join(TargetDomain, TargetDomain.id == Backlink.target_domain_id).join(SourceDomain, SourceDomain.id == Backlink.source_domain_id)
                    .where(TargetDomain.registrable_domain == domain, Backlink.current_status.in_(LIVE_STATES))) or 0
    return {"backlinks": total, "referring_domains": ref, "crawler_verified": verified}


def summary(db: Session, domain: str, since: datetime | None = None) -> dict:
    live = _live_for(domain).subquery()
    total = db.scalar(select(func.count()).select_from(live)) or 0
    verified = db.scalar(select(func.count()).select_from(_live_for(domain, True).subquery())) or 0
    ref_domains = db.scalar(select(func.count(func.distinct(SourceDomain.registrable_domain)))
                            .select_from(Backlink).join(TargetDomain, TargetDomain.id == Backlink.target_domain_id)
                            .join(SourceDomain, SourceDomain.id == Backlink.source_domain_id)
                            .where(TargetDomain.registrable_domain == domain, Backlink.current_status.in_(LIVE_STATES))) or 0
    rels = Counter()
    for (rel,) in db.execute(select(Backlink.rel_attributes).join(TargetDomain, TargetDomain.id == Backlink.target_domain_id)
                             .where(TargetDomain.registrable_domain == domain, Backlink.current_status.in_(LIVE_STATES))):
        rels.update(rel or ["follow"])
    out = {"domain": domain, "backlinks": total, "referring_domains": ref_domains, "crawler_verified": verified, "not_yet_verified": total - verified,
           "rel_distribution": dict(rels)}
    ev = (select(BacklinkEvent.event_type, func.count(func.distinct(BacklinkEvent.backlink_id)))
          .join(Backlink, Backlink.id == BacklinkEvent.backlink_id).join(TargetDomain, TargetDomain.id == Backlink.target_domain_id)
          .where(TargetDomain.registrable_domain == domain, BacklinkEvent.event_type.in_(("NEW", "LOST_CONFIRMED", "RESTORED"))))
    if since:
        ev = ev.where(BacklinkEvent.event_at >= since)
    counts = dict(db.execute(ev.group_by(BacklinkEvent.event_type)).all())
    out.update(new_backlinks=counts.get("NEW", 0), lost_backlinks=counts.get("LOST_CONFIRMED", 0), restored_backlinks=counts.get("RESTORED", 0),
               net_change=counts.get("NEW", 0) - counts.get("LOST_CONFIRMED", 0))
    return out


def referring_domains(db: Session, domain: str) -> dict[str, dict]:
    """source registrable domain -> {backlinks, verified} for current links to `domain`."""
    rows = db.execute(select(SourceDomain.registrable_domain, func.count(Backlink.id))
                      .select_from(Backlink).join(TargetDomain, TargetDomain.id == Backlink.target_domain_id)
                      .join(SourceDomain, SourceDomain.id == Backlink.source_domain_id)
                      .where(TargetDomain.registrable_domain == domain, Backlink.current_status.in_(LIVE_STATES))
                      .group_by(SourceDomain.registrable_domain)).all()
    verified = dict(db.execute(select(SourceDomain.registrable_domain, func.count(Backlink.id))
                               .select_from(Backlink).join(TargetDomain, TargetDomain.id == Backlink.target_domain_id)
                               .join(SourceDomain, SourceDomain.id == Backlink.source_domain_id)
                               .where(TargetDomain.registrable_domain == domain, Backlink.current_status.in_(LIVE_STATES),
                                      Backlink.verification_status == "CRAWLER_VERIFIED").group_by(SourceDomain.registrable_domain)).all())
    return {d: {"backlinks": n, "crawler_verified": verified.get(d, 0)} for d, n in rows}


def anchor_distribution(db: Session, domain: str, top: int = 20) -> list[dict]:
    c = Counter()
    for (a,) in db.execute(select(Backlink.anchor_text).join(TargetDomain, TargetDomain.id == Backlink.target_domain_id)
                           .where(TargetDomain.registrable_domain == domain, Backlink.current_status.in_(LIVE_STATES))):
        c[" ".join((a or "").lower().split()) or "(no anchor)"] += 1
    total = sum(c.values()) or 1
    return [{"anchor": a, "count": n, "share": round(n / total, 4)} for a, n in c.most_common(top)]


def gap(db: Session, client: str, competitors: list[str]) -> list[dict]:
    """Referring domains that link to at least one competitor but not to the client. A prospecting signal, not a to-do list."""
    mine = set(referring_domains(db, client))
    excluded = mine | {client, *competitors}
    found: dict[str, dict] = {}
    for comp in competitors:
        for dom, info in referring_domains(db, comp).items():
            if dom in excluded:
                continue
            g = found.setdefault(dom, {"domain": dom, "competitors": [], "backlinks": 0, "crawler_verified": 0})
            g["competitors"].append(comp)
            g["backlinks"] += info["backlinks"]
            g["crawler_verified"] += info["crawler_verified"]
    ranked = sorted(found.values(), key=lambda g: (-len(g["competitors"]), -g["crawler_verified"], -g["backlinks"], g["domain"]))
    for g in ranked:
        g["competitor_count"] = len(g["competitors"])
    return ranked


# ---- audit-style overview ---------------------------------------------------------------------------------------------

_COMMERCIAL = ("buy", "cheap", "best", "price", "pricing", "hire", "services", "service", "discount", "deal", "software", "near me", "quote", "shop", "online")
_GENERIC = ("click here", "here", "source", "read more", "website", "link", "this", "visit", "more", "homepage", "site", "learn more")
_NAKED = None


def classify_anchor(anchor: str | None, brand_terms: set[str]) -> str:
    """Heuristic anchor type: empty | naked | branded | compound | money | organic | other. Brand terms are lower-case words/domains."""
    import re
    global _NAKED
    _NAKED = _NAKED or re.compile(r"^(https?://)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(/\S*)?$")
    a = " ".join((anchor or "").lower().split())
    if not a:
        return "empty"
    if _NAKED.match(a):
        return "naked"
    has_brand = any(t and t in a for t in brand_terms)
    words = len(a.split())
    if has_brand:
        return "branded" if words <= 3 else "compound"
    if any(c in a for c in _COMMERCIAL):
        return "money"
    if a in _GENERIC or words == 1:
        return "organic"
    return "other"


def overview(db: Session, domain: str, brand_terms: set[str] | None = None, weeks: int = 12, now: datetime | None = None,
             reviews: dict[str, str] | None = None, scores: dict[str, dict] | None = None) -> dict:
    """Everything an audit-style report needs for one tracked domain, computed from the links our crawler found and their history."""
    from datetime import timedelta, timezone
    now = now or datetime.now(timezone.utc)
    reviews = reviews or {}
    scores = scores or {}
    brand = {t.lower() for t in (brand_terms or set()) if t} | {domain.lower(), domain.split(".")[0].lower()}

    def aw(d):
        return d if d is None or d.tzinfo else d.replace(tzinfo=timezone.utc)

    links = db.execute(select(Backlink, SourceDomain.registrable_domain).join(TargetDomain, TargetDomain.id == Backlink.target_domain_id)
                       .join(SourceDomain, SourceDomain.id == Backlink.source_domain_id).where(TargetDomain.registrable_domain == domain)).all()
    live = [(b, d) for b, d in links if b.current_status in LIVE_STATES]
    lost = [(b, d) for b, d in links if b.current_status == "LOST_CONFIRMED"]
    month_ago, two_months_ago = now - timedelta(days=30), now - timedelta(days=60)

    by_dom: dict[str, list[Backlink]] = {}
    for b, d in live:
        by_dom.setdefault(d, []).append(b)
    first_seen_dom: dict[str, datetime] = {}
    for b, d in links:
        if b.first_seen_at and (d not in first_seen_dom or aw(b.first_seen_at) < first_seen_dom[d]):
            first_seen_dom[d] = aw(b.first_seen_at)
    lost_dom = {d for d in {d for _, d in lost} if d not in by_dom}
    new_dom = [d for d in by_dom if first_seen_dom.get(d) and first_seen_dom[d] >= month_ago]
    prev_new = [d for d in by_dom if first_seen_dom.get(d) and two_months_ago <= first_seen_dom[d] < month_ago]

    rel, ltype, anchor_types = Counter(), Counter(), Counter()
    anchors: dict[str, dict] = {}
    targets: dict[str, dict] = {}
    for b, d in live:
        r = b.rel_attributes or []
        rel["follow"] += 0 if "nofollow" in r else 1
        for k in ("nofollow", "sponsored", "ugc"):
            rel[k] += 1 if k in r else 0
        ltype[b.link_type or "other"] += 1
        atype = classify_anchor(b.anchor_text, brand)
        anchor_types[atype] += 1
        key = " ".join((b.anchor_text or "").split()) or "(no anchor)"
        a = anchors.setdefault(key, {"anchor": key, "type": atype, "domains": set(), "backlinks": 0})
        a["domains"].add(d)
        a["backlinks"] += 1
        t = targets.setdefault(b.target_url, {"target_url": b.target_url, "domains": set(), "backlinks": 0})
        t["domains"].add(d)
        t["backlinks"] += 1

    n_live, n_dom = len(live) or 1, len(by_dom) or 1
    lost_at: dict[str, datetime] = {}
    for ev_at, d in db.execute(select(BacklinkEvent.event_at, SourceDomain.registrable_domain).join(Backlink, Backlink.id == BacklinkEvent.backlink_id)
                               .join(TargetDomain, TargetDomain.id == Backlink.target_domain_id).join(SourceDomain, SourceDomain.id == Backlink.source_domain_id)
                               .where(TargetDomain.registrable_domain == domain, BacklinkEvent.event_type == "LOST_CONFIRMED")):
        if d in lost_dom and (d not in lost_at or aw(ev_at) > lost_at[d]):
            lost_at[d] = aw(ev_at)
    start = (now - timedelta(weeks=weeks - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    start -= timedelta(days=start.weekday())
    known = {d for d in first_seen_dom if d in by_dom or d in lost_dom}
    series = []
    for i in range(weeks):
        w0 = start + timedelta(weeks=i)
        w1 = w0 + timedelta(weeks=1)
        series.append({"week": w0.date().isoformat(), "new": sum(1 for d in known if w0 <= first_seen_dom[d] < w1),
                       "lost": sum(1 for t in lost_at.values() if w0 <= t < w1),
                       "total": max(sum(1 for d in known if first_seen_dom[d] < w1) - sum(1 for t in lost_at.values() if t < w1), 0)})

    review_n = Counter(reviews.get(d) for d in by_dom if reviews.get(d))
    pending_links = sum(len(bs) for d, bs in by_dom.items() if not reviews.get(d))
    whitelisted_links = sum(len(bs) for d, bs in by_dom.items() if reviews.get(d) == "whitelisted")
    broken = sum(1 for b, _ in live if b.current_status == "BROKEN_TARGET")
    alerts = []
    if len(new_dom) >= 5 and len(new_dom) > 2 * max(len(prev_new), 1):
        alerts.append({"id": "spike", "tone": "amber", "title": "Spike in referring domains", "count": len(new_dom),
                       "detail": f"{len(new_dom)} new domains in 30 days vs {len(prev_new)} in the 30 days before"})
    if lost_dom:
        alerts.append({"id": "lost", "tone": "red", "title": "Domains lost", "count": len(lost_dom), "detail": f"{len(lost_dom)} referring domain(s) no longer link to you (confirmed by our crawler)"})
    if broken:
        alerts.append({"id": "broken", "tone": "amber", "title": "Links to broken pages", "count": broken, "detail": f"{broken} backlink(s) point at a page that returns an error"})

    top_domains = sorted(by_dom.items(), key=lambda kv: (-len(kv[1]), kv[0]))[:100]
    return {
        "domain": domain, "generated_at": now, "alerts": alerts,
        "referring_domains": {"total": len(by_dom), "new": len(new_dom), "lost": len(lost_dom),
                              "follow_pct": round(100 * sum(1 for bs in by_dom.values() if any("nofollow" not in (b.rel_attributes or []) for b in bs)) / n_dom, 1)},
        "backlinks": {"total": len(live), "follow_pct": round(100 * rel["follow"] / n_live, 1),
                      "new": sum(1 for b, _ in live if b.first_seen_at and aw(b.first_seen_at) >= month_ago),
                      "broken": broken, "lost": len(lost), "crawler_verified": sum(1 for b, _ in live if b.verification_status == "CRAWLER_VERIFIED")},
        "review": {"to_review": {"pending": pending_links, "whitelisted": whitelisted_links},
                   "removal": {k: review_n.get(k, 0) for k in ("to_contact", "not_replied", "replied", "removed")},
                   "disavow": {"marked": review_n.get("disavow", 0)}},
        "trend": series,
        "top_referring_domains": [{"domain": d, "backlinks": len(bs), "crawler_verified": sum(1 for b in bs if b.verification_status == "CRAWLER_VERIFIED"),
                                   "follow_pct": round(100 * sum(1 for b in bs if "nofollow" not in (b.rel_attributes or [])) / len(bs)),
                                   "first_seen_at": first_seen_dom.get(d), "tld": d.split(".", 1)[-1], "review": reviews.get(d), "quality": scores.get(d)} for d, bs in top_domains],
        "quality": {"scored": sum(1 for d in by_dom if d in scores), "unscored": sum(1 for d in by_dom if d not in scores),
                    **{v: sum(1 for d in by_dom if scores.get(d, {}).get("verdict") == v) for v in ("good", "ok", "risky")}},
        "anchor_types": {k: anchor_types.get(k, 0) for k in ("money", "compound", "branded", "organic", "other", "naked", "empty")},
        "top_anchors": [{"anchor": a["anchor"], "type": a["type"], "domains": len(a["domains"]), "backlinks": a["backlinks"]}
                        for a in sorted(anchors.values(), key=lambda x: (-x["backlinks"], x["anchor"]))[:100]],
        "target_pages": [{"target_url": t["target_url"], "domains": len(t["domains"]), "domain_share": round(len(t["domains"]) / n_dom, 4), "backlinks": t["backlinks"],
                          "share": round(t["backlinks"] / n_live, 4)} for t in sorted(targets.values(), key=lambda x: (-len(x["domains"]), x["target_url"]))[:5]],
        "attributes": {k: rel.get(k, 0) for k in ("follow", "nofollow", "sponsored", "ugc")},
        "link_types": {k: ltype.get(k, 0) for k in ("text", "image", "other")},
    }
