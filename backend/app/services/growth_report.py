"""Weekly and monthly growth reports, built only from what was really measured and checked, saved, and emailed once to the registered address.

A report says: how the presence score and each area moved (from the daily snapshots), which targets were met or missed, which tasks were verified by a real check and which were not,
which issues were fixed and which are still open (by severity), and what the next period asks for. The wording is fixed rules, not a model, so every sentence can be traced to a number.
The email goes to the address in the notification settings, else the project's contact email, else the owner's sign-in email. A weekly report is made for the last full Monday-to-Sunday
week, a monthly one for the last full calendar month; the daily job catches up when a roll-up was missed, and each report is emailed once.
"""
import html
import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Business, GrowthAction, GrowthReport, GrowthSnapshot, GrowthTarget, KeywordRankLog
from . import growth_plan as plan
from . import localtime
from .growth_plan import AREA_LABELS, SPEC

log = logging.getLogger("seo.growth.report")

PERIOD = {"week": "weekly", "month": "monthly"}
DEFAULT_PREFS = {"email": True, "weekly": True, "monthly": True, "alerts": True, "to": None}
EMAIL_RE = re.compile(r"^[^@\s,;<>\"']{1,64}@[^@\s,;<>\"']{1,185}\.[A-Za-z]{2,}$")
KEY_METRICS = ("gmb.profile_score", "gmb.reviews_total", "gmb.rating", "gmb.posts_30d", "gmb.photos_total", "gmb.unanswered", "local.citations_verified", "local.keywords_tracked", "seo.onpage_score",
               "seo.technical_score", "seo.security_headers", "aeo.score", "geo.score", "chatgpt.readiness")
OPEN = ("todo", "done", "unverified", "failed", "blocked")


# ------------------------------------------------------------------------------------------------------------------- preferences
def prefs(b: Business) -> dict[str, Any]:
    out = dict(DEFAULT_PREFS)
    out.update({k: v for k, v in (b.growth_notify or {}).items() if k in DEFAULT_PREFS or k == "last_alert"})
    return out


def save_prefs(db: Session, b: Business, body: dict[str, Any]) -> dict[str, Any]:
    cur = prefs(b)
    for k in ("email", "weekly", "monthly", "alerts"):
        if k in body and body[k] is not None:
            cur[k] = bool(body[k])
    if "to" in body:
        to = (body["to"] or "").strip()
        if to and (len(to) > 254 or not EMAIL_RE.match(to)):
            raise ValueError("Enter one valid email address.")
        cur["to"] = to or None
    b.growth_notify = cur
    db.add(b)
    db.flush()
    return public_prefs(db, b)


def recipient(db: Session, b: Business) -> str | None:
    from . import notify
    to = prefs(b).get("to")
    return to or notify._recipient(db, b)


def public_prefs(db: Session, b: Business) -> dict[str, Any]:
    p = prefs(b)
    s = get_settings()
    return {"email": p["email"], "weekly": p["weekly"], "monthly": p["monthly"], "alerts": p["alerts"], "to": p["to"], "sends_to": recipient(db, b), "smtp_ready": bool(s.smtp_host and s.smtp_from)}


# ------------------------------------------------------------------------------------------------------------------- windows
def last_window(period: str, today: date) -> tuple[date, date]:
    """The last full week (Monday to Sunday) or calendar month before `today`."""
    if period == "week":
        ws, _ = plan.week_bounds(today)
        return ws - timedelta(days=7), ws - timedelta(days=1)
    ms, _ = plan.month_bounds(today)
    return plan.month_bounds(ms - timedelta(days=1))


def current_window(period: str, today: date) -> tuple[date, date]:
    return plan.week_bounds(today) if period == "week" else plan.month_bounds(today)


# ------------------------------------------------------------------------------------------------------------------- the numbers
def _snap(db: Session, b: Business, start: date, end: date) -> tuple[GrowthSnapshot | None, GrowthSnapshot | None]:
    """The measurement the window started from (the last one before it, else its first) and the one it ended on."""
    before = db.scalar(select(GrowthSnapshot).where(GrowthSnapshot.business_id == b.id, GrowthSnapshot.day < start).order_by(GrowthSnapshot.day.desc()).limit(1))
    inside = list(db.scalars(select(GrowthSnapshot).where(GrowthSnapshot.business_id == b.id, GrowthSnapshot.day >= start, GrowthSnapshot.day <= end).order_by(GrowthSnapshot.day)))
    first = before or (inside[0] if inside else None)
    last = inside[-1] if inside else before
    return first, last


def _mval(snap: GrowthSnapshot | None, key: str) -> float | None:
    if snap is None:
        return None
    from . import growth_metrics
    return growth_metrics.metric({"metrics": snap.metrics or {}}, key)


def _delta(a: float | None, b: float | None) -> float | None:
    return None if a is None or b is None else round(b - a, 2)


def _task_row(a: GrowthAction) -> dict[str, Any]:
    return {"title": a.title, "area": a.area, "status": a.status, "link": a.link, "details": (a.evidence or {}).get("details")}


def build(db: Session, b: Business, period: str, start: date, end: date, today: date | None = None) -> dict[str, Any]:
    today = today or localtime.today(b)
    pname = PERIOD[period]
    first, last = _snap(db, b, start, end)
    p0, p1 = (first.presence if first else None), (last.presence if last else None)
    if first is last:
        p0 = None  # a single measurement shows a level, not a movement
    areas = []
    for key, label in AREA_LABELS.items():
        a0 = ((first.areas or {}).get(key) if first and first is not last else None)
        a1 = (last.areas or {}).get(key) if last else None
        areas.append({"key": key, "label": label, "start": a0, "end": a1, "delta": _delta(a0, a1)})
    metrics = []
    for k in KEY_METRICS:
        s0, s1 = (_mval(first, k) if first is not last else None), _mval(last, k)
        if s1 is None and s0 is None:
            continue
        spec = SPEC.get(k) or {}
        metrics.append({"key": k, "label": spec.get("label") or k, "unit": spec.get("unit") or "", "start": s0, "end": s1, "delta": _delta(s0, s1), "direction": spec.get("d", "up")})
    ts = list(db.scalars(select(GrowthTarget).where(GrowthTarget.business_id == b.id, GrowthTarget.period == pname, GrowthTarget.window_start == start).order_by(GrowthTarget.area, GrowthTarget.metric)))
    closed = end < today
    tgt_items = [{"label": t.label, "area": t.area, "unit": t.unit or "", "baseline": t.baseline, "target": t.target, "final": t.current, "status": t.status if closed or t.status in ("met", "missed", "blocked") else "open"} for t in ts]
    tgt = {"met": sum(1 for t in tgt_items if t["status"] == "met"), "missed": sum(1 for t in tgt_items if t["status"] == "missed"), "open": sum(1 for t in tgt_items if t["status"] == "open"),
           "blocked": sum(1 for t in tgt_items if t["status"] == "blocked"), "total": len(tgt_items), "items": tgt_items}
    acts = list(db.scalars(select(GrowthAction).where(GrowthAction.business_id == b.id, GrowthAction.period != "fix", GrowthAction.due_on >= start, GrowthAction.due_on <= end).order_by(GrowthAction.due_on)))
    by = lambda s: [a for a in acts if a.status == s]  # noqa: E731
    tasks = {"total": len(acts), "verified": len(by("verified")), "unverified": len(by("unverified")), "failed": len(by("failed")), "skipped": len(by("skipped")),
             "open": sum(1 for a in acts if a.status in ("todo", "done", "blocked")), "done_items": [_task_row(a) for a in by("verified")[:10]],
             "missed_items": [_task_row(a) for a in (by("failed") + by("unverified"))[:8]]}
    fixes = list(db.scalars(select(GrowthAction).where(GrowthAction.business_id == b.id, GrowthAction.period == "fix")))
    sdt, edt = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc), datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    resolved = [a for a in fixes if a.status == "verified" and a.verified_at and sdt <= (a.verified_at if a.verified_at.tzinfo else a.verified_at.replace(tzinfo=timezone.utc)) < edt]
    opened = [a for a in fixes if a.status in OPEN]
    sev = lambda a: (a.evidence or {}).get("severity", "warning")  # noqa: E731
    order = {"critical": 0, "serious": 1, "warning": 2, "info": 3}
    counts = {k: sum(1 for a in opened if sev(a) == k) for k in order}
    issues = {"resolved": len(resolved), "resolved_items": [{"title": a.title, "area": a.area, "severity": sev(a)} for a in resolved[:10]], "open_total": len(opened), "open": counts,
              "overdue": sum(1 for a in opened if a.due_on < today), "as_of": today.isoformat(),
              "top_open": [{"title": a.title, "severity": sev(a), "area": a.area, "link": a.link, "due_on": a.due_on.isoformat(), "overdue": a.due_on < today}
                           for a in sorted(opened, key=lambda a: (order.get(sev(a), 9), a.due_on))[:8]]}
    nday = end + timedelta(days=1)
    nstart, nend = plan.week_bounds(nday) if period == "week" else plan.month_bounds(nday)
    nxt_t = list(db.scalars(select(GrowthTarget).where(GrowthTarget.business_id == b.id, GrowthTarget.period == pname, GrowthTarget.window_start == nstart).order_by(GrowthTarget.area)))
    nxt_a = list(db.scalars(select(GrowthAction).where(GrowthAction.business_id == b.id, GrowthAction.period == pname, GrowthAction.due_on >= nstart, GrowthAction.due_on <= nend)))
    nxt = {"start": nstart.isoformat(), "end": nend.isoformat(), "targets": [{"label": t.label, "baseline": t.baseline, "target": t.target, "unit": t.unit or ""} for t in nxt_t[:10]],
           "tasks": [{"title": a.title, "link": a.link} for a in nxt_a[:10]]}
    kw = _keyword_moves(db, b, start, end)
    data = {"period": period, "keywords": kw, "start": start.isoformat(), "end": end.isoformat(), "in_progress": not closed, "generated_at": datetime.now(timezone.utc).isoformat(), "business": {"id": b.id, "name": b.name},
            "presence": {"start": p0, "end": p1, "delta": _delta(p0, p1)}, "areas": areas, "metrics": metrics, "targets": tgt, "tasks": tasks, "issues": issues, "next": nxt,
            "measured_days": db.query(GrowthSnapshot).filter(GrowthSnapshot.business_id == b.id, GrowthSnapshot.day >= start, GrowthSnapshot.day <= end).count()}
    data["headline"], data["narrative"] = narrate(data)
    return data


def _keyword_moves(db: Session, b: Business, start: date, end: date) -> list[dict[str, Any]]:
    """Per tracked keyword: where it ranked at the start of the period (the last check before it, else the first inside) and at the end, in Google and in Maps. Only real checks."""
    logs: dict[str, list[KeywordRankLog]] = {}
    for r in db.scalars(select(KeywordRankLog).where(KeywordRankLog.business_id == b.id, KeywordRankLog.day <= end).order_by(KeywordRankLog.day)):
        logs.setdefault(r.keyword, []).append(r)
    out = []
    for kw, rows in logs.items():
        before = [r for r in rows if r.day < start]
        inside = [r for r in rows if r.day >= start]
        if not inside and not before:
            continue
        first = before[-1] if before else inside[0]
        last = inside[-1] if inside else before[-1]
        only = first is last
        s0, s1 = (None if only else first.rank), last.rank
        out.append({"keyword": kw, "start": s0, "end": s1, "change": (s0 - s1) if (s0 is not None and s1 is not None) else None, "maps_start": None if only else first.maps_rank, "maps_end": last.maps_rank,
                    "checked": last.day.isoformat(), "found": s1 is not None})
    return sorted(out, key=lambda x: (x["end"] is None, x["end"] or 0, x["keyword"]))[:25]


def _pts(v: float | None) -> str:
    return "n/a" if v is None else f"{v:+g}"


def narrate(d: dict[str, Any]) -> tuple[str, list[str]]:
    """Plain sentences from the numbers, nothing else."""
    pr, t, k, i = d["presence"], d["targets"], d["tasks"], d["issues"]
    word = "week" if d["period"] == "week" else "month"
    lines: list[str] = []
    if pr["end"] is None:
        head = f"The presence score could not be measured for this {word}."
        lines.append("No daily measurement exists for this period, so no movement is reported rather than a guess.")
    elif pr["delta"] is None:
        head = f"Presence score {pr['end']:g}/100 (no earlier measurement to compare with)."
    elif pr["delta"] > 0:
        head = f"Presence score rose {pr['delta']:g} points to {pr['end']:g}/100."
    elif pr["delta"] < 0:
        head = f"Presence score fell {abs(pr['delta']):g} points to {pr['end']:g}/100."
    else:
        head = f"Presence score unchanged at {pr['end']:g}/100."
    moved = sorted([a for a in d["areas"] if a["delta"]], key=lambda a: -abs(a["delta"]))[:3]
    if moved:
        lines.append("Biggest moves: " + "; ".join(f"{a['label']} {_pts(a['delta'])}" for a in moved) + ".")
    if t["total"]:
        finished = t["met"] + t["missed"]
        lines.append(f"Targets: {t['met']} met, {t['missed']} missed" + (f", {t['open']} still open" if t["open"] else "") + (f", {t['blocked']} could not be measured" if t["blocked"] else "") + f" of {t['total']}." if finished or t["open"] else f"Targets: {t['total']} set.")
    else:
        lines.append("No targets were set for this period.")
    if k["total"]:
        lines.append(f"Tasks: {k['verified']} verified by a real check, {k['unverified'] + k['failed']} not verified, {k['skipped']} skipped, {k['open']} still open (of {k['total']}). A task counts only when the live data confirms it.")
    if i["resolved"]:
        lines.append(f"Issues fixed this {word}: {i['resolved']}.")
    if i["open_total"]:
        o = i["open"]
        lines.append(f"Issues still open: {i['open_total']} ({o['critical']} critical, {o['serious']} serious, {o['warning']} warning, {o['info']} info)" + (f"; {i['overdue']} past their due date." if i["overdue"] else "."))
    else:
        lines.append("No open issues in the latest sweep.")
    if d.get("in_progress"):
        lines.append(f"This {word} is still in progress: the figures are to date.")
    return head, lines


# ------------------------------------------------------------------------------------------------------------------- store
def generate(db: Session, b: Business, period: str, start: date | None = None, today: date | None = None) -> GrowthReport:
    """Create (or refresh) the report of one window. A window that has not ended is shown to date and marked in progress."""
    if period not in PERIOD:
        raise ValueError("period must be week or month")
    today = today or localtime.today(b)
    if start is None:
        start, end = last_window(period, today)
    else:
        start, end = plan.week_bounds(start) if period == "week" else plan.month_bounds(start)
    row = db.scalar(select(GrowthReport).where(GrowthReport.business_id == b.id, GrowthReport.period == period, GrowthReport.period_start == start))
    if row is None:
        row = GrowthReport(business_id=b.id, period=period, period_start=start, period_end=end)
        db.add(row)
    row.period_end = end
    row.data = build(db, b, period, start, end, today)
    db.flush()
    return row


def out(row: GrowthReport, full: bool = True) -> dict[str, Any]:
    d = row.data or {}
    base = {"id": row.id, "period": row.period, "start": row.period_start.isoformat(), "end": row.period_end.isoformat(), "headline": d.get("headline"), "presence": d.get("presence"),
            "in_progress": d.get("in_progress"), "emailed_at": row.emailed_at.isoformat() if row.emailed_at else None, "emailed_to": row.emailed_to, "email_error": row.email_error,
            "targets": {k: (d.get("targets") or {}).get(k) for k in ("met", "missed", "total")}, "issues_resolved": (d.get("issues") or {}).get("resolved"), "issues_open": (d.get("issues") or {}).get("open_total")}
    return {**base, "data": d} if full else base


def listing(db: Session, b: Business, limit: int = 30) -> list[GrowthReport]:
    return list(db.scalars(select(GrowthReport).where(GrowthReport.business_id == b.id).order_by(GrowthReport.period_start.desc(), GrowthReport.id.desc()).limit(limit)))


# ------------------------------------------------------------------------------------------------------------------- email
def _link(path: str | None) -> str:
    base = (get_settings().frontend_url or "").rstrip("/")
    return f"{base}{path}" if path and path.startswith("/") and base else (base + "/growth" if base else "")


def render_text(d: dict[str, Any]) -> str:
    word = "Weekly" if d["period"] == "week" else "Monthly"
    out = [f"{word} growth report: {d['business']['name']}", f"{d['start']} to {d['end']}" + ("  (in progress)" if d.get("in_progress") else ""), "", d["headline"], ""]
    out += [f"- {x}" for x in d["narrative"]]
    if d["metrics"]:
        out += ["", "Key numbers (start -> end):"] + [f"  {m['label']}: {'n/a' if m['start'] is None else format(m['start'], 'g')} -> {'n/a' if m['end'] is None else format(m['end'], 'g')}" for m in d["metrics"]]
    if d.get("keywords"):
        out += ["", "Keyword rankings (Google position, start -> end):"] + [f"  {k['keyword']}: {k['start'] if k['start'] is not None else 'n/a'} -> {k['end'] if k['end'] is not None else 'not in top results'}" for k in d["keywords"][:10]]
    if d["issues"]["top_open"]:
        out += ["", "Fix next:"] + [f"  [{x['severity']}] {x['title']} (due {x['due_on']})" + (f" {_link(x['link'])}" if x.get("link") else "") for x in d["issues"]["top_open"][:5]]
    if d["next"]["tasks"]:
        out += ["", f"Next {d['period']}:"] + [f"  - {x['title']}" for x in d["next"]["tasks"][:6]]
    out += ["", f"Open the Growth Plan: {_link('/growth')}", "", "Every figure comes from real measurements and live checks; a task is counted only when the data confirms it."]
    return "\n".join(out)


def render_html(d: dict[str, Any]) -> str:
    e = html.escape
    word = "Weekly" if d["period"] == "week" else "Monthly"
    rows = "".join(f"<tr><td style='padding:4px 10px 4px 0;color:#475569'>{e(str(m['label']))}</td><td style='padding:4px 0;text-align:right'>{'n/a' if m['start'] is None else e(format(m['start'], 'g'))} → <b>{'n/a' if m['end'] is None else e(format(m['end'], 'g'))}</b></td></tr>" for m in d["metrics"])
    def fix_item(x: dict[str, Any]) -> str:
        colour = "#b91c1c" if x["severity"] == "critical" else "#b45309" if x["severity"] in ("serious", "warning") else "#475569"
        href = _link(x["link"]) if x.get("link") else ""
        title = f'<a href="{e(href)}" style="color:#4338ca">{e(x["title"])}</a>' if href else e(x["title"])
        return f"<li style='margin:3px 0'><b style='color:{colour}'>{e(x['severity'])}</b> · {title} <span style='color:#64748b'>(due {e(x['due_on'])})</span></li>"
    fix = "".join(fix_item(x) for x in d["issues"]["top_open"][:5])
    nxt = "".join(f"<li style='margin:3px 0'>{e(x['title'])}</li>" for x in d["next"]["tasks"][:6])
    kwrows = "".join(f"<tr><td style='padding:4px 10px 4px 0;color:#475569'>{e(k['keyword'])}</td><td style='padding:4px 0;text-align:right'>{'n/a' if k['start'] is None else k['start']} → <b>{k['end'] if k['end'] is not None else 'not found'}</b></td></tr>" for k in (d.get("keywords") or [])[:10])
    bullets = "".join(f"<li style='margin:4px 0'>{e(x)}</li>" for x in d["narrative"])
    btn = f"<p style='margin:18px 0 0'><a href=\"{e(_link('/growth'))}\" style='background:#4f46e5;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-weight:600'>Open the Growth Plan</a></p>" if _link("/growth") else ""
    return (f"<div style=\"font-family:Segoe UI,Arial,sans-serif;color:#0f172a;max-width:620px;margin:0 auto;padding:18px\"><p style='margin:0;color:#64748b;font-size:13px'>{word} growth report · {e(d['start'])} to {e(d['end'])}"
            f"{' · in progress' if d.get('in_progress') else ''}</p><h2 style='margin:4px 0 2px;font-size:20px'>{e(d['business']['name'])}</h2><p style='margin:0 0 12px;font-size:16px'><b>{e(d['headline'])}</b></p>"
            f"<ul style='padding-left:18px;margin:0 0 12px;font-size:14px'>{bullets}</ul>"
            + (f"<h3 style='font-size:14px;margin:16px 0 4px'>Key numbers</h3><table style='font-size:13px;width:100%;border-collapse:collapse'>{rows}</table>" if rows else "")
            + (f"<h3 style='font-size:14px;margin:16px 0 4px'>Keyword rankings</h3><table style='font-size:13px;width:100%;border-collapse:collapse'>{kwrows}</table>" if kwrows else "")
            + (f"<h3 style='font-size:14px;margin:16px 0 4px'>Fix next</h3><ul style='padding-left:18px;font-size:13px;margin:0'>{fix}</ul>" if fix else "")
            + (f"<h3 style='font-size:14px;margin:16px 0 4px'>Next {e(d['period'])}</h3><ul style='padding-left:18px;font-size:13px;margin:0'>{nxt}</ul>" if nxt else "")
            + btn + "<p style='font-size:11px;color:#94a3b8;margin-top:20px'>Every figure comes from real measurements and live checks; a task is counted only when the data confirms it.</p></div>")


def send(db: Session, b: Business, row: GrowthReport, force: bool = False) -> dict[str, Any]:
    """Email the report once to the registered address. Returns {sent, reason}. A report already emailed is not sent again unless forced."""
    from . import notify
    p = prefs(b)
    if not force:
        if row.emailed_at:
            return {"sent": False, "reason": "Already emailed."}
        if not p["email"] or not p["weekly" if row.period == "week" else "monthly"]:
            return {"sent": False, "reason": "Email is switched off for this report in the notification settings."}
        if (row.data or {}).get("in_progress"):
            return {"sent": False, "reason": "The period has not ended yet."}
    to = recipient(db, b)
    if not to:
        row.email_error = "No email address on the project or its owner."
        return {"sent": False, "reason": row.email_error}
    d = row.data or {}
    word = "Weekly" if row.period == "week" else "Monthly"
    subject = f"{word} growth report: {b.name} ({row.period_start.isoformat()} to {row.period_end.isoformat()})"
    try:
        ok = notify.send_email(to, subject, render_text(d), html=render_html(d))
    except Exception as exc:  # noqa: BLE001 - a mail failure is recorded, never raised into the scheduler
        log.warning("growth report email failed for business %s: %s", b.id, type(exc).__name__)
        row.email_error = f"The email could not be sent ({type(exc).__name__})."
        return {"sent": False, "reason": row.email_error}
    if not ok:
        row.email_error = "Email is not set up on this server (SMTP settings are missing)."
        return {"sent": False, "reason": row.email_error}
    row.emailed_at, row.emailed_to, row.email_error = datetime.now(timezone.utc), to, None
    return {"sent": True, "reason": f"Sent to {to}."}


def _bell(db: Session, b: Business, row: GrowthReport) -> None:
    d = row.data or {}
    plan._notify(db, b, f"{'Weekly' if row.period == 'week' else 'Monthly'} growth report is ready", d.get("headline") or "Open the Growth Plan to read it.")


def ensure_due(db: Session, b: Business, today: date | None = None, periods: tuple[str, ...] = ("week", "month")) -> list[dict[str, Any]]:
    """Make (and email, once) the report of the last full week and month if it does not exist yet. Idempotent; a project that was not measured before the window ended gets none."""
    today = today or localtime.today(b)
    made = []
    for period in periods:
        start, end = last_window(period, today)
        if not db.scalar(select(GrowthSnapshot.id).where(GrowthSnapshot.business_id == b.id, GrowthSnapshot.day <= end).limit(1)):
            continue
        row = db.scalar(select(GrowthReport).where(GrowthReport.business_id == b.id, GrowthReport.period == period, GrowthReport.period_start == start))
        fresh = row is None
        if fresh:
            row = generate(db, b, period, start, today)
            _bell(db, b, row)
        if not row.emailed_at:
            res = send(db, b, row)
            made.append({"period": period, "start": start.isoformat(), "created": fresh, **res})
        elif fresh:
            made.append({"period": period, "start": start.isoformat(), "created": True, "sent": False, "reason": "Already emailed."})
    db.flush()
    return made


def alert_critical(db: Session, b: Business, titles: list[str], today: date | None = None) -> bool:
    """At most one email a day when the issue sweep finds NEW critical issues."""
    from . import notify
    today = today or localtime.today(b)
    p = prefs(b)
    if not titles or not p["email"] or not p["alerts"] or p.get("last_alert") == today.isoformat():
        return False
    to = recipient(db, b)
    if not to:
        return False
    items = titles[:8]
    text = (f"{len(titles)} critical issue{'s' if len(titles) != 1 else ''} found on {b.name}:\n\n" + "\n".join(f"- {t}" for t in items) + (f"\n...and {len(titles) - len(items)} more" if len(titles) > len(items) else "")
            + f"\n\nSee the fix tasks: {_link('/growth')}\n")
    body = f"<div style='font-family:Segoe UI,Arial,sans-serif;color:#0f172a'><p><b>{len(titles)} critical issue{'s' if len(titles) != 1 else ''} found on {html.escape(b.name)}</b></p><ul>" \
           + "".join(f"<li>{html.escape(t)}</li>" for t in items) + "</ul>" + (f"<p><a href=\"{html.escape(_link('/growth'))}\">Open the fix tasks</a></p>" if _link("/growth") else "") + "</div>"
    try:
        sent = notify.send_email(to, f"Critical issue{'s' if len(titles) != 1 else ''} found: {b.name}", text, html=body)
    except Exception as exc:  # noqa: BLE001
        log.warning("growth alert email failed for business %s: %s", b.id, type(exc).__name__)
        return False
    if sent:
        p["last_alert"] = today.isoformat()
        b.growth_notify = p
        db.add(b)
    return bool(sent)


def render_pdf(d: dict[str, Any]) -> bytes:
    """The report as a PDF (reportlab). Every value is drawn as text, never interpreted."""
    from io import BytesIO
    from xml.sax.saxutils import escape
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    st = getSampleStyleSheet()
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm, title="Growth report")
    p = lambda t, style="BodyText": Paragraph(escape(str(t)), st[style])  # noqa: E731
    word = "Weekly" if d["period"] == "week" else "Monthly"
    flow = [p(f"{word} growth report", "Title"), p(f"{d['business']['name']} · {d['start']} to {d['end']}" + (" · in progress" if d.get("in_progress") else "")), Spacer(1, 6), p(d["headline"], "Heading2")]
    flow += [p("• " + x) for x in d["narrative"]]

    def cell(c: Any) -> Paragraph:
        return Paragraph(escape("n/a" if c is None else str(c)), st["BodyText"])

    def table(head: list[str], rows: list[list[Any]]) -> Table:
        t = Table([[cell(h) for h in head]] + [[cell(c) for c in r] for r in rows], repeatRows=1)
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")), ("FONTSIZE", (0, 0), (-1, -1), 8.5), ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        return t
    if any(a["end"] is not None for a in d["areas"]):
        flow += [Spacer(1, 8), p("Areas", "Heading3"), table(["Area", "Start", "End", "Change"], [[a["label"], a["start"], a["end"], a["delta"]] for a in d["areas"]])]
    if d["metrics"]:
        flow += [Spacer(1, 8), p("Key numbers", "Heading3"), table(["Metric", "Start", "End", "Change"], [[m["label"], m["start"], m["end"], m["delta"]] for m in d["metrics"]])]
    if d.get("keywords"):
        flow += [Spacer(1, 8), p("Keyword rankings (Google position)", "Heading3"), table(["Keyword", "Start", "End", "Change", "Maps now"], [[k["keyword"], k["start"], k["end"], k["change"], k["maps_end"]] for k in d["keywords"]])]
    if d["targets"]["items"]:
        flow += [Spacer(1, 8), p("Targets", "Heading3"), table(["Target", "From", "To", "Goal", "Result"], [[t["label"], t["baseline"], t["final"], t["target"], t["status"]] for t in d["targets"]["items"]])]
    if d["issues"]["top_open"]:
        flow += [Spacer(1, 8), p("Fix next", "Heading3"), table(["Severity", "Issue", "Due"], [[x["severity"], x["title"], x["due_on"]] for x in d["issues"]["top_open"]])]
    if d["next"]["tasks"]:
        flow += [Spacer(1, 8), p(f"Next {d['period']}", "Heading3")] + [p("• " + x["title"]) for x in d["next"]["tasks"][:8]]
    flow += [Spacer(1, 10), p("Every figure comes from real measurements and live checks; a task is counted only when the data confirms it.", "Italic")]
    doc.build(flow)
    return buf.getvalue()
