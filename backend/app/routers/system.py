from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import User, current_user, require_admin
from ..config import get_settings
from ..db import get_db
from ..models import AppUser
from ..services.passwords import is_known_default
from ..services import ai, lighthouse

router = APIRouter(tags=["system"])


@router.get("/health")
def health():
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The signed-in user, and whether their password is one that was published in the source (the page then forces a change)."""
    u = db.get(AppUser, int(user.id)) if user.source == "seo" and str(user.id).isdigit() else None
    return user.__dict__ | {"is_admin": user.is_admin, "must_change_password": bool(u and is_known_default(u.password_hash))}


@router.get("/status")
def status(_: User = Depends(current_user)):
    """What is connected, so the UI can say which data is live and which is sample."""
    s = get_settings()
    return {
        "ai": {"configured": ai.is_configured(), "provider": s.ai_provider},
        "google_oauth": s.google_oauth_enabled,
        "pagespeed_key": bool(s.pagespeed_api_key),
        "lighthouse_local": s.lighthouse_local_enabled and lighthouse.is_available(),
        "places_key": bool(s.google_places_api_key or s.google_api_key),
        "dataforseo": s.dataforseo_enabled,
        "serper": bool(s.serper_api_key),
        # Where rank grids, backlinks and citations come from: paid DataForSEO, live Google results (Serper) or sample data.
        "rank_source": "dataforseo" if s.dataforseo_enabled else "serper" if s.serper_api_key else "sample",
        "intake_imap": s.imap_enabled,
        "intake_webhook": bool(s.intake_webhook_token),
        "smtp": bool(s.smtp_host and s.smtp_from),
        "geo_engines": [n for n, k in [("ChatGPT", s.openai_api_key), ("Gemini", s.gemini_api_key), ("Perplexity", s.perplexity_api_key), ("Claude", s.anthropic_api_key), ("DeepSeek", s.deepseek_api_key)] if k],
        "scheduler": s.scheduler_enabled,
        "google_trends": s.google_trends_enabled,
    }


@router.get("/system/diagnostics")
def diagnostics(db: Session = Depends(get_db), user: User = Depends(require_admin)):
    """What is wrong or stuck, in plain facts: unfinished runs, failing schedules, the task backlog, missing keys,
    accounts on the published password, how much of the data is sample, and database drift."""
    from sqlalchemy import func, select  # noqa: PLC0415

    from ..db import engine  # noqa: PLC0415
    from ..models import AgentTask, Audit, Schedule  # noqa: PLC0415
    from ..services import jobs, schema  # noqa: PLC0415
    from ..services.scheduler import LAST_TICK  # noqa: PLC0415

    s = get_settings()
    stuck = [{"id": a.id, "kind": a.kind, "status": a.status, "since": (a.updated_at or a.created_at).isoformat()} for a in db.scalars(select(Audit).where(Audit.status.in_(("queued", "running"))).order_by(Audit.id.desc()).limit(50))]
    failing = [{"business_id": x.business_id, "job": x.job, "error": (x.last_error or "")[:160]} for x in db.scalars(select(Schedule).where(Schedule.last_status == "failed"))]
    tasks = dict(db.execute(select(AgentTask.status, func.count()).group_by(AgentTask.status)).all())
    audits_total = db.scalar(select(func.count()).select_from(Audit)) or 0
    sample = db.scalar(select(func.count()).select_from(Audit).where(Audit.data_source == "sample")) or 0
    published = [u.email for u in db.scalars(select(AppUser)) if is_known_default(u.password_hash)]
    problems = []
    if stuck:
        problems.append(f"{len(stuck)} run(s) still marked running or queued: if the server restarted, they are dead and will be marked failed.")
    if failing:
        problems.append(f"{len(failing)} scheduled job(s) failed on their last run.")
    if tasks.get("pending", 0) > 50:
        problems.append(f"{tasks['pending']} AI changes are waiting: run Triage on the Autonomous AI Agents page.")
    if published:
        problems.append("These accounts use the password that was published in the source: " + ", ".join(published))
    if not ai.is_configured():
        problems.append("No AI model is configured: drafts, replies and the assistant use rules only.")
    if not s.serper_api_key:
        problems.append("SERPER_API_KEY is not set: competitor research, rank checks and keyword overview are off.")
    drift = schema.drift(engine)
    if drift["missing_tables"] or drift["missing_columns"]:
        problems.append("The database is missing tables or columns the app expects.")
    return {"problems": problems, "stuck_runs": stuck, "failing_schedules": failing, "tasks": tasks, "scheduler": {"enabled": s.scheduler_enabled, "last_tick": LAST_TICK},
            "providers": {"ai": ai.is_configured(), "serper": bool(s.serper_api_key), "pagespeed": bool(s.pagespeed_api_key), "places": bool(s.google_places_api_key or s.google_api_key),
                          "google_oauth": s.google_oauth_enabled, "dataforseo": s.dataforseo_enabled, "smtp": bool(s.smtp_host and s.smtp_from)},
            "data": {"audits": audits_total, "sample_share": round(sample / audits_total * 100) if audits_total else 0}, "accounts_on_published_password": published, "schema_drift": drift}
