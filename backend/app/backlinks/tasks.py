"""Connects the discovery bot to the rest of the platform: after a run, what it found shows up in the activity feed, new linkers get a quality score,
and risky ones become approval tasks for the Agents / Outreach pages. Nothing is sent or changed on anyone's site from here."""
import logging
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from ..db import utcnow
from ..models import AgentTask, Business
from . import outreach, quality
from .lifecycle import LIVE_STATES
from .models import Backlink, BacklinkEvent, BiDomain, BiDomainReview, BiPage, BiTrackedTarget

log = logging.getLogger("seo.backlinks.tasks")
MAX_TASKS_PER_RUN = 3
MIN_RISK_FOR_TASK = 70  # clearly spammy only: a client who credits you in their footer must never get a removal request
TASK_ACTOR = "backlink bot"


def _own_targets(db: Session, business_id: int) -> list[str]:
    return [t.domain for t in db.scalars(select(BiTrackedTarget).where(BiTrackedTarget.business_id == business_id, BiTrackedTarget.is_competitor.is_(False)))]


def after_run(db: Session, b: Business, stats: dict, since: datetime | None = None) -> dict:
    """Called by the bot after a cycle. Safe to call twice: tasks are de-duplicated and activity is only logged when something changed."""
    from ..services.activity import log as activity
    out = {"scored": 0, "tasks": 0, "lost": 0}
    own = _own_targets(db, b.id)
    if not own:
        return out
    since = since or (utcnow() - timedelta(days=1))
    SD, TD = aliased(BiDomain), aliased(BiDomain)

    lost = db.execute(select(SD.registrable_domain).join(Backlink, Backlink.source_domain_id == SD.id).join(BacklinkEvent, BacklinkEvent.backlink_id == Backlink.id)
                      .join(TD, TD.id == Backlink.target_domain_id).where(TD.registrable_domain.in_(own), BacklinkEvent.event_type == "LOST_CONFIRMED",
                                                                          BacklinkEvent.event_at >= since)).all()
    out["lost"] = len(lost)
    if lost:
        activity(db, TASK_ACTOR, "backlinks_lost", b.id, count=len(lost), domains=sorted({d for (d,) in lost})[:8])
    if stats.get("new_backlinks"):
        activity(db, TASK_ACTOR, "backlinks_found", b.id, count=stats["new_backlinks"], pages=stats.get("pages"))

    for target in own:  # score newly seen linking domains (AI when configured, rules otherwise)
        todo = quality.unscored_domains(db, b.id, target)
        if todo:
            out["scored"] += len(quality.score_domains(db, b, target, todo))

    reviewed = {r.source_domain for r in db.scalars(select(BiDomainReview).where(BiDomainReview.business_id == b.id))}
    existing = {t.detail.get("domain") for t in db.scalars(select(AgentTask).where(AgentTask.business_id == b.id, AgentTask.kind == "outreach_email", AgentTask.agent == "outreach"))
                if (t.detail or {}).get("source") == "backlink_bot"}
    for sc in db.scalars(select(quality.BiDomainScore).where(quality.BiDomainScore.business_id == b.id, quality.BiDomainScore.verdict == "risky", quality.BiDomainScore.risk >= MIN_RISK_FOR_TASK).order_by(quality.BiDomainScore.risk.desc())):
        if out["tasks"] >= MAX_TASKS_PER_RUN:
            break
        if sc.source_domain in reviewed or sc.source_domain in existing:
            continue
        rows = db.execute(select(Backlink, BiPage).join(BiPage, BiPage.id == Backlink.source_page_id).join(SD, SD.id == Backlink.source_domain_id).join(TD, TD.id == Backlink.target_domain_id)
                          .where(SD.registrable_domain == sc.source_domain, TD.registrable_domain.in_(own), Backlink.current_status.in_(LIVE_STATES)).limit(10)).all()
        if not rows:
            continue
        links = [{"source_url": p.normalized_url, "target_url": bl.target_url, "anchor_text": bl.anchor_text} for bl, p in rows]
        draft = outreach.draft_removal_email(b.name, sc.source_domain, own[0], links)
        t = AgentTask(business_id=b.id, agent="outreach", kind="outreach_email", title=f"Ask {sc.source_domain} to remove {len(links)} link{'s' if len(links) != 1 else ''}", impact="Medium",
                      detail={"source": "backlink_bot", "domain": sc.source_domain, "fix": f"Looks risky: {sc.reason}", "draft": draft, "links": links, "risk": sc.risk, "relevance": sc.relevance},
                      requires_approval=True)
        db.add(t)
        out["tasks"] += 1
    if out["tasks"]:
        activity(db, TASK_ACTOR, "backlink_tasks_created", b.id, count=out["tasks"])
    db.commit()
    return out
