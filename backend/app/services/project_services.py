"""Which services (modules) a project is onboarded for: SEO, GEO, AEO and GMB, and removing one without removing the project.

`Business.modules` is a list subset of MODULES. NULL means "not chosen yet": SEO, GEO and AEO are on for every project, and GMB is on
when a Google profile is linked (or a Google account is connected to it). Once a person changes a service the list is saved explicitly.

GEO and AEO share one dataset (GeoPrompt / GeoResult: the questions asked to AI engines and who they name), so they are split by engine:
  * GEO (generative engines): the chat assistants that write an answer from their own knowledge: ChatGPT, Gemini, Claude, DeepSeek.
  * AEO (answer engines): the engines that answer with live search and cite their sources: Perplexity (and any engine not listed above).
The prompts (questions) are shared; they are deleted only when both GEO and AEO are removed. Removing one deletes only that group's results.

Removing a service deletes this app's stored data for it and never touches Google, the website or any other account.
"""
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..models import Audit, Business, GeoPrompt, GeoResult, InsightDay, Keyword, KeywordRankLog, Post, RankScan, Review, Schedule

MODULES = ("seo", "geo", "aeo", "gmb")
LABELS = {"seo": "SEO", "geo": "GEO", "aeo": "AEO", "gmb": "GMB"}
GEO_ENGINES = {"ChatGPT", "Gemini", "Claude", "DeepSeek"}  # everything else (Perplexity) counts as an answer engine
# Scheduled jobs that belong to one service ("geo" runs for GEO or AEO).
JOB_MODULE = {"full_audit": "seo", "rank_scan": "seo", "technical": "seo", "report": "seo", "weekly_plan": "seo", "site_research": "seo", "site_crawl": "seo",
              "reviews": "gmb", "posts": "gmb", "geo": "geo", "autopilot": "gmb"}


def enabled(b: Business) -> list[str]:
    if b.modules is not None:
        return [m for m in MODULES if m in b.modules]
    return [m for m in MODULES if m != "gmb" or b.gbp_location or b.connection_id]


def job_enabled(b: Business, job: str) -> bool:
    """False for a scheduled job whose service was removed from the project, so the scheduler neither creates nor runs it."""
    mod = JOB_MODULE.get(job)
    if mod is None or b.modules is None:  # nothing removed yet: every job keeps running as before (a project may use reviews/posts before its Google profile is linked)
        return True
    on = enabled(b)
    return ("geo" in on or "aeo" in on) if mod == "geo" else mod in on


def _engine_filter(module: str):
    return GeoResult.engine.in_(GEO_ENGINES) if module == "geo" else GeoResult.engine.not_in(GEO_ENGINES)


def stats(db: Session, b: Business) -> dict[str, dict[str, Any]]:
    """Per service, what is stored for the project (shown on the Projects page and in the removal warning)."""
    audits_n = db.scalar(select(func.count()).select_from(Audit).where(Audit.business_id == b.id)) or 0
    prompts = db.scalar(select(func.count()).select_from(GeoPrompt).where(GeoPrompt.business_id == b.id)) or 0
    out: dict[str, dict[str, Any]] = {
        "seo": {"audits": audits_n, "score": b.last_audit_score, "keywords": db.scalar(select(func.count()).select_from(Keyword).where(Keyword.business_id == b.id)) or 0,
                "rank_scans": db.scalar(select(func.count()).select_from(RankScan).where(RankScan.business_id == b.id)) or 0},
        "gmb": {"linked": bool(b.gbp_location), "account": b.connection.email if b.connection else None, "reviews": db.scalar(select(func.count()).select_from(Review).where(Review.business_id == b.id)) or 0,
                "posts": db.scalar(select(func.count()).select_from(Post).where(Post.business_id == b.id)) or 0},
    }
    for m in ("geo", "aeo"):
        out[m] = {"prompts": prompts, "answers": db.scalar(select(func.count()).select_from(GeoResult).where(GeoResult.business_id == b.id, _engine_filter(m))) or 0}
    return out


def row_for(db: Session, b: Business) -> dict[str, Any]:
    return {"id": b.id, "name": b.name, "website": b.website, "city": b.city, "plan": b.plan, "status": b.status, "health": b.last_audit_score,
            "created_at": b.created_at.isoformat() if b.created_at else None, "owner_id": b.owner_id, "modules": enabled(b), "stats": stats(db, b)}


def remove(db: Session, b: Business, module: str) -> dict[str, int]:
    """Switch a service off for the project and delete only the data that belongs to it. Returns what was deleted."""
    gone: dict[str, int] = {}

    def wipe(label: str, stmt) -> None:
        gone[label] = db.execute(stmt).rowcount or 0

    on = [m for m in enabled(b) if m != module]
    if module == "seo":
        wipe("audits", delete(Audit).where((Audit.business_id == b.id) | (Audit.workspace_id == b.id)))
        wipe("keywords", delete(Keyword).where(Keyword.business_id == b.id))
        wipe("rank_scans", delete(RankScan).where(RankScan.business_id == b.id))
        wipe("rank_history", delete(KeywordRankLog).where(KeywordRankLog.business_id == b.id))
        b.last_audit_score = None
    elif module in ("geo", "aeo"):
        wipe("answers", delete(GeoResult).where(GeoResult.business_id == b.id, _engine_filter(module)))
        if "geo" not in on and "aeo" not in on:
            wipe("prompts", delete(GeoPrompt).where(GeoPrompt.business_id == b.id))
    elif module == "gmb":
        wipe("reviews", delete(Review).where(Review.business_id == b.id))
        wipe("posts", delete(Post).where(Post.business_id == b.id))
        wipe("insights", delete(InsightDay).where(InsightDay.business_id == b.id))
        b.connection_id = b.gbp_location = b.gbp_account = b.place_id = None
        b.gbp_status, b.verification, b.duplicate_listing = {}, "unknown", False
        b.rating = b.review_count = b.photo_count = None
    b.modules = on
    gone["schedules"] = db.execute(delete(Schedule).where(Schedule.business_id == b.id, Schedule.job.in_([j for j in JOB_MODULE if not job_enabled(b, j)]))).rowcount or 0
    return gone


def add(db: Session, b: Business, module: str) -> None:
    b.modules = [m for m in MODULES if m == module or m in enabled(b)]
