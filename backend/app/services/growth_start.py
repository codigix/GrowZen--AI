"""Start the plan: do everything the system can do by itself, in order, and say plainly what it did and what is left for a person.

Steps (each one isolated: a step that fails or cannot run is reported, and the next still runs):
  1 measure the project live          2 sync the Google profile (when linked)     3 run the website, technical, listing audits
  4 check the tracked rankings        5 sweep every area for issues -> fix tasks   6 draft review replies and a post for approval (when AI is set up)
  7 make today's, this week's and this month's targets and tasks              8 build the first weekly report, email "plan started"
Nothing is published or changed on Google, the website or any listing: drafts wait for a person's approval, and the tasks that need a person stay tasks.
One run per project at a time; the progress is kept in memory for the page to poll.
"""
import logging
import threading
import time
from datetime import date, datetime, timezone
from typing import Any

from ..db import SessionLocal
from ..models import Business

log = logging.getLogger("seo.growth.start")

STEPS = [("measure", "Measure the project"), ("gbp", "Sync the Google profile"), ("audits", "Run the audits"), ("rankings", "Check tracked rankings"), ("keywords", "Group keywords and assign pages"), ("sweep", "Find every issue and make fix tasks"), ("prospects", "Find link prospects among competitors"),
         ("drafts", "Prepare drafts for approval"), ("plan", "Set today's, this week's and this month's plan"), ("email", "Send the start email")]
_lock = threading.Lock()
_runs: dict[int, dict[str, Any]] = {}


def status(business_id: int) -> dict[str, Any]:
    with _lock:
        r = _runs.get(business_id)
        return _copy(r) if r else {"state": "idle", "steps": [], "started_at": None, "finished_at": None}


def _copy(r: dict[str, Any]) -> dict[str, Any]:
    return {**r, "steps": [dict(s) for s in r["steps"]]}


def begin(business_id: int, actor: str) -> bool:
    """Reserve the run. False when one is already going."""
    with _lock:
        cur = _runs.get(business_id)
        if cur and cur["state"] == "running":
            return False
        _runs[business_id] = {"state": "running", "actor": actor, "started_at": datetime.now(timezone.utc).isoformat(), "finished_at": None,
                              "steps": [{"key": k, "label": lab, "state": "waiting", "detail": None} for k, lab in STEPS], "summary": None}
        return True


def _set(business_id: int, key: str, state: str, detail: str | None = None) -> None:
    with _lock:
        for s in _runs[business_id]["steps"]:
            if s["key"] == key:
                s["state"], s["detail"] = state, (detail or "")[:300] or None


def start_background(business_id: int, actor: str) -> bool:
    if not begin(business_id, actor):
        return False
    threading.Thread(target=run, args=(business_id, actor), daemon=True, name=f"growth-start-{business_id}").start()
    return True


def _step(db, business_id: int, key: str, fn) -> Any:
    _set(business_id, key, "running")
    try:
        res = fn()
        detail, state = res if isinstance(res, tuple) else (None, "done")
        _set(business_id, key, state, detail)
        return res
    except Exception as exc:  # noqa: BLE001 - one step failing never stops the others
        db.rollback()
        msg = getattr(exc, "message", None) or str(exc)
        log.warning("growth start %s: step %s failed: %s", business_id, key, msg[:200])
        _set(business_id, key, "skipped", f"Could not run: {msg[:200]}")
        return None


def run(business_id: int, actor: str) -> None:
    from . import audits, growth_issues, growth_plan, growth_report, organic
    from . import agent, gbp
    from .activity import log as activity
    db = SessionLocal()
    summary: dict[str, Any] = {}
    try:
        b = db.get(Business, business_id)
        if b is None:
            raise LookupError("project not found")
        from . import localtime
        today = localtime.today(b)

        _step(db, business_id, "measure", lambda: (growth_plan.refresh(db, b, actor, live=True) and ("Measured live and kept today's snapshot.", "done")))

        def gbp_step():
            if not (b.connection_id and b.gbp_location):
                return ("The Google profile is not connected; connect it to unlock reviews, posts and performance.", "skipped")
            gbp.sync_business(db, b)
            return ("Profile, reviews and performance synced.", "done")
        _step(db, business_id, "gbp", gbp_step)

        def audit_step():
            done, notes = [], []
            for kind in ("onpage", "technical", "citations"):
                if kind == "onpage" and not b.website:
                    notes.append("onpage: no website")
                    continue
                try:
                    a = audits.run(db, b, kind)
                    (done if a.status == "done" else notes).append(kind if a.status == "done" else f"{kind}: {a.error or a.status}"[:80])
                except Exception as exc:  # noqa: BLE001
                    db.rollback()
                    notes.append(f"{kind}: {(getattr(exc, 'message', None) or str(exc))[:80]}")
            return (f"Ran: {', '.join(done) or 'none'}." + (f" Skipped: {'; '.join(notes)}." if notes else ""), "done" if done else "skipped")
        _step(db, business_id, "audits", audit_step)

        def rank_step():
            if not b.website:
                return ("No website to rank.", "skipped")
            if not organic.intel.serper_enabled():
                return ("The rank data provider is not set up on this server.", "skipped")
            try:
                out = organic.check(db, b)
            except organic.RankCheckError as exc:
                return (str(exc)[:200], "skipped")
            return (f"Checked {out.get('checked', 0)} tracked searches.", "done")
        _step(db, business_id, "rankings", rank_step)

        def kw_step():
            from . import growth_content
            from . import growth_metrics
            added = growth_content.add_site_keywords(db, b, growth_metrics._latest_xray(db, b)[0])
            r = growth_content.group_keywords(db, b)
            db.commit()
            return ((f"Now tracking {len(added)} search{'es' if len(added) != 1 else ''} your website is about: {', '.join(added)}. " if added else "") + f"{r['grouped']} keywords grouped into topics, {r['targeted']} given a target page (only where exactly one page clearly covers it).", "done")
        _step(db, business_id, "keywords", kw_step)

        def sweep_step():
            res = growth_issues.sweep(db, b, today, live=True)
            db.commit()
            summary["issues"] = res
            if res["new_critical"]:
                growth_report.alert_critical(db, b, res["new_critical"], today)
            note = f"{res['found']} issues found, {res['created']} new fix tasks, {res['closed']} closed." + (f" Not checked: {'; '.join(res['skipped'])}." if res["skipped"] else "")
            return (note, "done")
        _step(db, business_id, "sweep", sweep_step)

        def prospects_step():
            from . import growth_content
            r = growth_content.add_prospects(db, b, today)
            db.commit()
            return (r["note"] or f"{r['created']} outreach task{'s' if r['created'] != 1 else ''} created.", "done" if not r["note"] else "skipped")
        _step(db, business_id, "prospects", prospects_step)

        def drafts_step():
            from . import ai
            if not ai.is_configured():
                return ("AI is not set up on this server, so no drafts were written.", "skipped")
            from datetime import timedelta
            from sqlalchemy import select
            from ..models import Post
            n = agent.draft_review_replies(db, b)
            recent = db.scalar(select(Post.id).where(Post.business_id == b.id, Post.status == "draft", Post.ai_generated.is_(True), Post.created_at >= datetime.now(timezone.utc) - timedelta(days=7)).limit(1))
            p = None if recent else agent.draft_weekly_post(db, b)  # a second Start never piles up a second draft
            from . import growth_drafts, growth_solutions
            made = growth_drafts.prefill(db, b)
            sols = growth_solutions.prefill(db, b)
            db.commit()
            return (f"{n} review repl{'y' if n == 1 else 'ies'}, {1 if p else 0} post and {made} fix-task draft{'s' if made != 1 else ''} written; exact solutions ready for {sols['built']} fix task{'s' if sols['built'] != 1 else ''}" + (" (a post draft from this week already waits for you)" if recent else "") + ". Nothing is published until you approve it.", "done")
        _step(db, business_id, "drafts", drafts_step)

        def plan_step():
            growth_plan.refresh(db, b, actor, live=False)
            from sqlalchemy import select
            from ..models import Schedule
            from . import schedules
            schedules.ensure_jobs(db, b)
            for s in db.scalars(select(Schedule).where(Schedule.business_id == b.id, Schedule.job.in_(tuple(growth_plan.GROWTH_JOBS)))):
                if s.every == "off":
                    s.every = schedules.JOB_DEFAULTS.get(s.job, "daily")
                    s.next_run_at = schedules.next_run(s.every)
                    db.add(s)
            db.commit()
            return ("Targets and tasks are set; the daily, weekly and monthly jobs are scheduled.", "done")
        _step(db, business_id, "plan", plan_step)

        def email_step():
            from . import notify
            to = growth_report.recipient(db, b)
            p = growth_report.prefs(b)
            if not p["email"] or not to:
                return ("Email is off or no address is set.", "skipped")
            row = growth_report.generate(db, b, "week", growth_report.current_window("week", today)[0], today)  # the week so far, as the first report
            d = row.data
            text = (f"The growth plan for {b.name} is running.\n\n{d['headline']}\n\n" + "\n".join(f"- {x}" for x in d["narrative"]) + f"\n\nOpen it: {growth_report._link('/growth')}\n\n"
                    "Weekly and monthly reports will arrive here automatically.")
            try:
                sent = notify.send_email(to, f"Growth plan started: {b.name}", text)
            except Exception as exc:  # noqa: BLE001
                return (f"The email could not be sent ({type(exc).__name__}). Press Email this report on the Reports tab to retry.", "skipped")
            db.commit()
            return ((f"Sent to {to}.", "done") if sent else ("Email is not set up on this server (SMTP settings are missing).", "skipped"))
        _step(db, business_id, "email", email_step)

        activity(db, actor, "growth_started", b.id)
        db.commit()
        with _lock:
            _runs[business_id].update(state="done", finished_at=datetime.now(timezone.utc).isoformat(), summary=summary.get("issues"))
    except Exception as exc:  # noqa: BLE001
        log.exception("growth start failed for %s", business_id)
        with _lock:
            _runs[business_id].update(state="failed", finished_at=datetime.now(timezone.utc).isoformat(), error=str(exc)[:200])
    finally:
        db.close()
        time.sleep(0)
