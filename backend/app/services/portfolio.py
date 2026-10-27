"""Every client at a glance: status, plan, health, the SEO services running for it, and what needs
attention. Read-only (unlike GET /businesses/{id}/schedules, it never creates schedules)."""
from datetime import date, datetime, timedelta, timezone
from statistics import mean
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import AgentTask, Audit, Business, InsightDay, Lead, Playbook, Review, Schedule
from . import ai
from .audits import KINDS
from .playbook import DEFAULT_APPROVAL
from .schedules import JOBS

LEVELS = ["critical", "serious", "warning", "info"]
ZERO = {"calls": 0, "directions": 0, "website_clicks": 0}
SERVICE_LABELS = {
    "full_audit": "Full SEO audit", "rank_scan": "Rank tracking", "technical": "Technical SEO", "reviews": "Review management",
    "posts": "GBP posts", "report": "Monthly report", "geo": "AI search visibility",
}


AGENTS = {
    "audit": ("Website agent", "Technical and on-page fixes"),
    "gbp": ("Profile agent", "Business Profile edits and posts"),
    "review": ("Review agent", "Replies to Google reviews"),
    "outreach": ("Outreach agent", "Citations and backlink outreach"),
}


def _iso(v: Any) -> str | None:
    return v.isoformat() if v else None


def _ai_summary(db: Session, since: date) -> dict[str, Any]:
    """What the AI side is doing: provider, autopilot rules, and each agent's workload."""
    s = get_settings()
    start = datetime.combine(since, datetime.min.time(), tzinfo=timezone.utc)
    pb = db.get(Playbook, 1)  # read only: never create the playbook here
    rules = (pb.approval_rules if pb and pb.approval_rules else DEFAULT_APPROVAL)
    agents = {k: {"label": label, "does": does, "pending": 0, "proposed_30": 0, "applied_30": 0, "rejected_30": 0, "failed_30": 0} for k, (label, does) in AGENTS.items()}
    for agent_name, status, n in db.execute(select(AgentTask.agent, AgentTask.status, func.count()).where(AgentTask.status == "pending").group_by(AgentTask.agent, AgentTask.status)):
        agents.setdefault(agent_name, {"label": agent_name.title(), "does": "", "pending": 0, "proposed_30": 0, "applied_30": 0, "rejected_30": 0, "failed_30": 0})["pending"] = n
    for agent_name, status, n in db.execute(select(AgentTask.agent, AgentTask.status, func.count()).where(AgentTask.created_at >= start).group_by(AgentTask.agent, AgentTask.status)):
        a = agents.setdefault(agent_name, {"label": agent_name.title(), "does": "", "pending": 0, "proposed_30": 0, "applied_30": 0, "rejected_30": 0, "failed_30": 0})
        a["proposed_30"] += n
        if status in ("applied", "rejected", "failed"):
            a[f"{status}_30"] += n
    return {
        "engine": {"configured": ai.is_configured(), "provider": s.ai_provider},
        "autopilot": {"auto": sorted(k for k, needs in rules.items() if not needs), "manual": sorted(k for k, needs in rules.items() if needs)},
        "agents": agents,
        "applied_30": sum(a["applied_30"] for a in agents.values()),
    }


def summary(db: Session) -> dict[str, Any]:
    businesses = list(db.scalars(select(Business).order_by(Business.name)))
    since = date.today() - timedelta(days=30)

    def per_business(stmt) -> dict[int, int]:
        return {bid: n for bid, n in db.execute(stmt).all()}

    pending = per_business(select(AgentTask.business_id, func.count()).where(AgentTask.status == "pending").group_by(AgentTask.business_id))
    leads = per_business(select(Lead.business_id, func.count()).where(Lead.lead_date > since).group_by(Lead.business_id))
    unreplied = per_business(select(Review.business_id, func.count()).where(Review.reply_status.in_(["none", "draft"])).group_by(Review.business_id))
    running = {bid for (bid,) in db.execute(select(Audit.business_id).where(Audit.business_id.is_not(None), Audit.status.in_(["queued", "running"]))).all()}

    # Google customer actions: last 30 days and the 30 before, per business, and per day across all.
    def actions(a: date, z: date) -> dict[int, dict[str, int]]:
        stmt = (select(InsightDay.business_id, func.sum(InsightDay.calls), func.sum(InsightDay.directions), func.sum(InsightDay.website_clicks))
                .where(InsightDay.day > a, InsightDay.day <= z).group_by(InsightDay.business_id))
        return {bid: {"calls": int(c or 0), "directions": int(d or 0), "website_clicks": int(w or 0)} for bid, c, d, w in db.execute(stmt)}

    today = date.today()
    actions_now, actions_before = actions(since, today), actions(since - timedelta(days=30), since)
    daily = [{"day": d.isoformat(), "calls": int(c or 0), "directions": int(r or 0), "website_clicks": int(w or 0)} for d, c, r, w in db.execute(
        select(InsightDay.day, func.sum(InsightDay.calls), func.sum(InsightDay.directions), func.sum(InsightDay.website_clicks))
        .where(InsightDay.day > since).group_by(InsightDay.day).order_by(InsightDay.day))]

    schedules: dict[int, list[Schedule]] = {}
    for s in db.scalars(select(Schedule)):
        schedules.setdefault(s.business_id, []).append(s)

    # Newest finished audit per business and area (only the columns needed, not the large results).
    latest: dict[tuple[int, str], Any] = {}
    cols = (Audit.business_id, Audit.kind, Audit.status, Audit.score, Audit.issues, Audit.error, Audit.finished_at, Audit.data_source)
    for a in db.execute(select(*cols).where(Audit.business_id.is_not(None), Audit.status.in_(["done", "failed"])).order_by(Audit.created_at.desc(), Audit.id.desc())):
        latest.setdefault((a.business_id, a.kind), a)

    projects = []
    for b in businesses:
        areas, critical, serious, last_audit = {}, 0, 0, None
        for kind in KINDS:
            a = latest.get((b.id, kind))
            if not a:
                continue
            areas[kind] = {"score": a.score, "status": a.status, "finished_at": _iso(a.finished_at), "data_source": a.data_source, "error": a.error}
            if a.status == "done":
                critical += sum(1 for i in a.issues or [] if i.get("level") == "critical")
                serious += sum(1 for i in a.issues or [] if i.get("level") == "serious")
            if a.finished_at and (last_audit is None or a.finished_at > last_audit):
                last_audit = a.finished_at

        rows = sorted(schedules.get(b.id, []), key=lambda s: JOBS.index(s.job) if s.job in JOBS else 99)
        active = [s for s in rows if s.every != "off"]
        services = [{"job": s.job, "label": SERVICE_LABELS.get(s.job, s.job), "every": s.every, "last_run_at": _iso(s.last_run_at),
                     "last_status": s.last_status, "last_error": s.last_error, "next_run_at": _iso(s.next_run_at)} for s in active]
        upcoming = min((s for s in active if s.next_run_at), key=lambda s: s.next_run_at, default=None)

        attention = []  # most important first
        if b.status == "needs_approval":
            attention.append({"level": "serious", "text": "Profile waiting for approval"})
        if critical:
            attention.append({"level": "critical", "text": f"{critical} critical SEO issue{'s' if critical > 1 else ''}"})
        failed_areas = [k for k, v in areas.items() if v["status"] == "failed"]
        if failed_areas:
            attention.append({"level": "serious", "text": f"Audit failed: {', '.join(failed_areas)}"})
        failed_jobs = [SERVICE_LABELS.get(s.job, s.job) for s in active if s.last_status == "failed"]
        if failed_jobs:
            attention.append({"level": "serious", "text": f"Job failed: {', '.join(failed_jobs)}"})
        if pending.get(b.id):
            attention.append({"level": "warning", "text": f"{pending[b.id]} task{'s' if pending[b.id] > 1 else ''} to approve"})
        if not b.gbp_location:
            attention.append({"level": "warning", "text": "Google profile not linked"})
        if not b.website:
            attention.append({"level": "warning", "text": "No website"})
        if not rows:
            attention.append({"level": "info", "text": "No services scheduled"})
        if not areas:
            attention.append({"level": "info", "text": "Never audited"})
        attention.sort(key=lambda a: LEVELS.index(a["level"]))  # stable: same-level items keep their order

        projects.append({
            "id": b.id, "name": b.name, "category": b.primary_category, "area": b.area, "city": b.city, "website": b.website,
            "plan": b.plan, "status": b.status, "source": b.source, "contact_name": b.contact_name, "created_at": _iso(b.created_at),
            "gbp_linked": bool(b.gbp_location), "verification": b.verification, "rating": b.rating, "review_count": b.review_count,
            "health": b.last_audit_score, "areas": areas, "last_audit_at": _iso(last_audit), "audit_running": b.id in running,
            "issues": {"critical": critical, "serious": serious},
            "services": services, "services_configured": bool(rows),
            "next_job": {"job": upcoming.job, "label": SERVICE_LABELS.get(upcoming.job, upcoming.job), "at": _iso(upcoming.next_run_at)} if upcoming else None,
            "business_services": [s.get("name") for s in (b.services or []) if isinstance(s, dict) and s.get("name")],
            "pending_tasks": pending.get(b.id, 0), "leads_30": leads.get(b.id, 0), "unreplied_reviews": unreplied.get(b.id, 0),
            "actions_30": actions_now.get(b.id, ZERO), "actions_prev_30": actions_before.get(b.id, ZERO),
            "attention": attention,
        })

    scores = [p["health"] for p in projects if p["health"] is not None]
    areas = {}
    for kind in KINDS:
        found = [p["areas"][kind] for p in projects if kind in p["areas"]]
        done = [a["score"] for a in found if a["status"] == "done" and a["score"] is not None]
        areas[kind] = {"avg": round(mean(done)) if done else None, "audited": len(done), "failed": sum(1 for a in found if a["status"] == "failed")}
    by_id = {p["id"]: p for p in projects}
    upcoming = sorted(((s, by_id[bid]) for bid, rows in schedules.items() if bid in by_id for s in rows
                       if s.every != "off" and s.next_run_at and by_id[bid]["status"] != "paused"), key=lambda x: x[0].next_run_at)[:12]
    return {
        "ai": _ai_summary(db, since),
        "insights": {
            "last_30": {k: sum(v[k] for v in actions_now.values()) for k in ZERO},
            "previous_30": {k: sum(v[k] for v in actions_before.values()) for k in ZERO},
            "daily": daily,
        },
        "areas": areas,
        "coverage": {job: {"label": SERVICE_LABELS[job], "projects": sum(1 for p in projects if any(s["job"] == job for s in p["services"]))} for job in JOBS},
        "upcoming": [{"project_id": p["id"], "project": p["name"], "job": s.job, "label": SERVICE_LABELS.get(s.job, s.job), "every": s.every, "at": _iso(s.next_run_at)} for s, p in upcoming],

        "totals": {
            "projects": len(projects),
            "by_status": {s: sum(1 for p in projects if p["status"] == s) for s in ("active", "needs_approval", "paused")},
            "avg_health": round(mean(scores)) if scores else None,
            "pending_tasks": sum(pending.values()),
            "leads_30": sum(p["leads_30"] for p in projects),
            "critical_issues": sum(p["issues"]["critical"] for p in projects),
            "active_services": sum(len(p["services"]) for p in projects),
            "gbp_linked": sum(1 for p in projects if p["gbp_linked"]),
            "needs_attention": sum(1 for p in projects if any(a["level"] in ("critical", "serious") for a in p["attention"])),
        },
        "projects": projects,
    }
