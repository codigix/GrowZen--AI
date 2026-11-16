"""The Growth Plan: daily, weekly and monthly targets that raise the strength of a project's online presence, and the tasks that serve them.

Areas: Google Business Profile (gmb), local SEO and listings (local), website SEO and security (seo), answer-engine readiness (aeo), AI-search readiness (geo)
and the Business-in-ChatGPT module (chatgpt). The numbers come from services/growth_metrics.py (real data only).

What makes the plan realistic and honest (the "reality checks"):
  * every target starts from a MEASURED baseline and is capped by what one window can really deliver (MONTHLY_CAPS); a metric that cannot be measured gets a
    'blocked' target and an action that unblocks it, never an invented number;
  * the targets shrink 25% after two windows that mostly missed and grow 25% (never beyond the caps) after two windows that were all met;
  * the number of tasks per day, week and month is limited by the project's plan (CAPACITY); what does not fit is reported as deferred, not hidden;
  * a task counts only when a REAL check of live data (or of the live page) says so: the person's click is never proof. A due task whose check fails becomes
    'failed' and is carried forward once, never silently dropped;
  * policy guards (POLICY): no bought, incentivised or selectively gated reviews, no fake Q&A, no keyword-stuffed names, no duplicate listings, no bought
    links, nothing that weakens a security setting.
"""
import logging
import math
import re
import time
from collections import defaultdict, deque
from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..errors import DataUnavailable
from ..models import Business, GrowthAction, GrowthTarget, KeywordRankLog, Notification, PageXRayRun, Post, Review, Schedule
from .activity import log

logger = logging.getLogger("seo.growth.plan")

PERIODS = ("daily", "weekly", "monthly")
CAPACITY = {"Starter": {"daily": 2, "weekly": 5, "monthly": 8}, "Growth": {"daily": 3, "weekly": 8, "monthly": 12}, "Pro": {"daily": 3, "weekly": 12, "monthly": 16},
            "Agency": {"daily": 3, "weekly": 16, "monthly": 22}}
SCORE_GOAL, RATE_GOAL, TOLERANCE = 85, 90, 2
MAX_POSTS_PER_WEEK, MAX_PHOTOS_PER_MONTH, MAX_FIX_ACTIONS_PER_WEEK = 3, 12, 4
SCALE_DOWN, SCALE_UP = 0.75, 1.25
GROWTH_JOBS = {"growth_daily": "daily", "growth_weekly": "weekly", "growth_monthly": "monthly"}
AREA_FALLBACK = {"gmb": 30, "local": 15, "seo": 20, "aeo": 10, "geo": 15, "chatgpt": 10}
AREA_LABELS = {"gmb": "Google Business Profile", "local": "Local SEO & listings", "seo": "Website SEO & security", "aeo": "Answer-engine readiness (AEO)",
               "geo": "AI-search readiness (GEO)", "chatgpt": "Business in ChatGPT"}

POLICY = [
    "Reviews: ask real customers, all ratings. Never buy, incentivise or selectively gate reviews, and never reply with an offer for a review.",
    "Google posts: at most 3 a week and 12 photos a month, real and relevant to the business. No keyword stuffing in the business name or posts.",
    "No fake questions or answers, no duplicate listings, no bought or exchanged links.",
    "AI crawlers: allow only public pages. Keep /wp-admin and every private area disallowed in robots.txt.",
    "Security: tasks only strengthen it (HTTPS, HSTS, CSP, certificate renewal). Nothing in this plan asks you to weaken a security setting.",
    "A task counts only after a real check of the live data or the live page passes. Your click alone never does.",
]

# ------------------------------------------------------------------------------------------------------------------- the metrics that get targets
def _cap_reviews(cur: float) -> float:
    return min(10, max(3, round(0.25 * cur)))


def _cap_issues(cur: float) -> float:
    return max(3, math.ceil(0.2 * cur))


# metric, area, label, unit, kind, goal, monthly cap (function of the baseline), share of the cap asked for normally, smallest gain, direction, primary, periods
SPECS: list[dict[str, Any]] = [
    dict(m="gmb.reviews_total", a="gmb", label="Google reviews", unit="reviews", kind="count", goal=25, cap=_cap_reviews, f=1.0, floor=3, d="up", primary=True, periods=("weekly", "monthly")),
    dict(m="gmb.rating", a="gmb", label="Average rating (hold, never chase)", unit="stars", kind="keep", goal=None, cap=None, f=1, floor=0, d="keep", primary=False, periods=("monthly",), tol=0.1),
    dict(m="gmb.reply_rate", a="gmb", label="Reviews replied to", unit="%", kind="rate", goal=RATE_GOAL, cap=lambda c: 30, f=1.0, floor=5, d="up", primary=False, periods=("weekly", "monthly")),
    dict(m="gmb.unanswered", a="gmb", label="Reviews waiting for a reply", unit="reviews", kind="count", goal=0, cap=lambda c: max(c, 1), f=1.0, floor=1, d="down", primary=False, periods=("daily", "weekly", "monthly")),
    dict(m="gmb.photos_total", a="gmb", label="Photos on the profile", unit="photos", kind="count", goal=20, cap=lambda c: MAX_PHOTOS_PER_MONTH, f=0.8, floor=3, d="up", primary=False, periods=("weekly", "monthly")),
    dict(m="gmb.posts_30d", a="gmb", label="Google posts in the last 30 days", unit="posts", kind="count", goal=8, cap=lambda c: 10, f=0.8, floor=3, d="up", primary=False, periods=("monthly",)),
    dict(m="gmb.profile_score", a="gmb", label="Google profile score", unit="score", kind="score", goal=SCORE_GOAL, cap=lambda c: 8, f=0.8, floor=3, d="up", primary=True, periods=("weekly", "monthly")),
    dict(m="gmb.completeness", a="gmb", label="Profile completeness", unit="%", kind="rate", goal=90, cap=lambda c: 8, f=0.8, floor=3, d="up", primary=False, periods=("monthly",)),
    dict(m="local.score", a="local", label="Local SEO score", unit="score", kind="score", goal=SCORE_GOAL, cap=lambda c: 8, f=0.8, floor=3, d="up", primary=True, periods=("weekly", "monthly")),
    dict(m="local.citations_verified", a="local", label="Listings checked and correct", unit="listings", kind="count", goal=8, cap=lambda c: 4, f=1.0, floor=1, d="up", primary=False, periods=("weekly", "monthly")),
    dict(m="local.keywords_tracked", a="local", label="Searches tracked", unit="searches", kind="count", goal=10, cap=lambda c: 10, f=0.5, floor=3, d="up", primary=False, periods=("monthly",)),
    dict(m="seo.onpage_score", a="seo", label="On-page score (site crawl)", unit="score", kind="score", goal=SCORE_GOAL, cap=lambda c: 8, f=0.8, floor=3, d="up", primary=True, periods=("weekly", "monthly")),
    dict(m="seo.technical_score", a="seo", label="Speed score (Lighthouse)", unit="score", kind="score", goal=SCORE_GOAL, cap=lambda c: 8, f=0.8, floor=3, d="up", primary=False, periods=("monthly",)),
    dict(m="seo.xray_seo", a="seo", label="Homepage SEO score (Page X-Ray)", unit="score", kind="score", goal=SCORE_GOAL, cap=lambda c: 12, f=0.8, floor=3, d="up", primary=False, periods=("weekly", "monthly")),
    dict(m="seo.audit_issues", a="seo", label="Open site audit issues", unit="issues", kind="count", goal=0, cap=_cap_issues, f=1.0, floor=3, d="down", primary=False, periods=("weekly", "monthly")),
    dict(m="seo.security_headers", a="seo", label="Security headers in place (of 6)", unit="of 6", kind="count", goal=5, cap=lambda c: 2, f=1.0, floor=1, d="up", primary=False, periods=("monthly",)),
    dict(m="seo.ssl_days_left", a="seo", label="Days left on the SSL certificate (stay above 30)", unit="days", kind="keep", goal=30, cap=None, f=1, floor=0, d="keep", primary=False, periods=("monthly",), tol=0),
    dict(m="aeo.score", a="aeo", label="Answer-engine (AEO) score", unit="score", kind="score", goal=SCORE_GOAL, cap=lambda c: 12, f=0.8, floor=3, d="up", primary=True, periods=("weekly", "monthly")),
    dict(m="geo.score", a="geo", label="AI-search (GEO) score", unit="score", kind="score", goal=SCORE_GOAL, cap=lambda c: 12, f=0.8, floor=3, d="up", primary=True, periods=("weekly", "monthly")),
    dict(m="geo.ai_bots_allowed", a="geo", label="AI crawlers allowed (of 7)", unit="of 7", kind="count", goal=5, cap=lambda c: 3, f=1.0, floor=1, d="up", primary=False, periods=("monthly",)),
    dict(m="geo.share_of_voice", a="geo", label="Share of AI answers that mention you", unit="%", kind="rate", goal=30, cap=lambda c: 10, f=0.8, floor=3, d="up", primary=False, periods=("monthly",)),
    dict(m="chatgpt.readiness", a="chatgpt", label="Business-in-ChatGPT readiness", unit="score", kind="score", goal=75, cap=lambda c: 25, f=0.8, floor=5, d="up", primary=True, periods=("weekly", "monthly")),
    dict(m="chatgpt.catalog_items", a="chatgpt", label="Products or services in the feed", unit="items", kind="count", goal=6, cap=lambda c: 5, f=1.0, floor=1, d="up", primary=False, periods=("monthly",), needs_started=True),
]
SPEC = {s["m"]: s for s in SPECS}
INTERNAL = {"gmb.posts_week": dict(a="gmb", label="Google posts published this week", unit="posts")}


# ------------------------------------------------------------------------------------------------------------------- dates
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _today(today: date | None = None, b: Business | None = None) -> date:
    """The project's own calendar day (services/localtime.py); UTC only when no project is given."""
    if today:
        return today
    if b is not None:
        from . import localtime
        return localtime.today(b)
    return _now().date()


def week_bounds(d: date) -> tuple[date, date]:
    start = d - timedelta(days=d.weekday())
    return start, start + timedelta(days=6)


def month_bounds(d: date) -> tuple[date, date]:
    start = d.replace(day=1)
    nxt = (start + timedelta(days=32)).replace(day=1)
    return start, nxt - timedelta(days=1)


def window(period: str, d: date) -> tuple[date, date]:
    return (d, d) if period == "daily" else week_bounds(d) if period == "weekly" else month_bounds(d)


# ------------------------------------------------------------------------------------------------------------------- measurement helpers
def _measure(db: Session, b: Business, live: bool = False) -> dict[str, Any]:
    """The project's measurements (services/growth_metrics.py). Never raises: when measuring fails the latest stored snapshot is used, else nothing is measured."""
    from . import growth_metrics
    try:
        return growth_metrics.measure(db, b, live=live)
    except DataUnavailable:
        raise
    except Exception as exc:  # noqa: BLE001 - a failing measurement must not stop the plan
        logger.warning("growth: measurement failed for business %s: %s", b.id, exc)
        db.rollback()
        return _from_snapshot(db, b)


def _from_snapshot(db: Session, b: Business) -> dict[str, Any]:
    from . import growth_metrics
    snap = growth_metrics.latest_snapshot(db, b.id)
    if snap is None:
        return {"at": None, "metrics": {}, "areas": {}, "presence": None, "weights": dict(AREA_FALLBACK)}
    return {"at": snap.day.isoformat(), "metrics": snap.metrics or {}, "areas": {a: {"score": s} for a, s in (snap.areas or {}).items()}, "presence": snap.presence, "weights": dict(AREA_FALLBACK)}


def _val(data: dict[str, Any], key: str) -> float | None:
    from . import growth_metrics
    return growth_metrics.metric(data, key)


def _why_missing(data: dict[str, Any], key: str) -> str:
    m = (data.get("metrics") or {}).get(key) or {}
    return str(m.get("reason") or "Not measured yet")


def _weights(data: dict[str, Any]) -> dict[str, int]:
    return {**AREA_FALLBACK, **(data.get("weights") or {})}


def _chatgpt_started(data: dict[str, Any]) -> bool:
    a = (data.get("areas") or {}).get("chatgpt") or {}
    return a.get("score") is not None or a.get("state") == "measured"


def _internal_value(db: Session, b: Business, metric: str, start: date, end: date) -> float | None:
    if metric == "gmb.posts_week":
        lo, hi = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc), datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
        return float(db.scalar(select(func.count(Post.id)).where(Post.business_id == b.id, Post.status == "published", Post.published_at >= lo, Post.published_at < hi)) or 0)
    return None


def _same_site(url: str | None, website: str | None) -> bool:
    """A stored check may only ever fetch the project's own website (a rule edited in the database must not point the server somewhere else)."""
    def host(u: str | None) -> str:
        h = (urlsplit(u if "://" in (u or "") else f"https://{u or ''}").hostname or "").lower()
        return h[4:] if h.startswith("www.") else h
    return bool(host(url)) and host(url) == host(website)


# ------------------------------------------------------------------------------------------------------------------- target math
def _gain(spec: dict[str, Any], baseline: float, scale: float) -> tuple[float, float]:
    """(the gain asked for this month, the cap) for a metric that is below its goal. The gain is 'normal' (a share of the cap), scaled by the recent record,
    never below the smallest useful gain and never above the cap."""
    cap = float(spec["cap"](baseline))
    gain = max(float(spec["floor"]), min(cap, round(cap * spec["f"] * scale)))
    return min(gain, cap), cap


def plan_target(spec: dict[str, Any], baseline: float, period: str, scale: float = 1.0) -> dict[str, Any]:
    """The target of one metric for one window, with the reality note when a cap limited it. Pure: no I/O."""
    d, goal = spec["d"], spec["goal"]
    out: dict[str, Any] = {"target": None, "direction": d, "mode": "build", "cap": None, "note": "", "confidence": "high"}
    if d == "keep":
        tol = spec.get("tol", 0)
        if spec["m"] == "seo.ssl_days_left":
            out.update(target=float(goal), mode="maintain" if baseline >= goal else "build", note="" if baseline >= goal else "The certificate must be renewed before it drops under 30 days.")
        else:
            out.update(target=round(baseline - tol, 2), mode="maintain", note="Hold the current level. Never chase a higher rating: reviews must come from real customers, all ratings.")
        return out
    if d == "down":
        if baseline <= goal:
            out.update(target=float(goal), mode="maintain")
            return out
        gain, cap = _gain(spec, baseline, scale)
        if period == "weekly":
            gain = math.ceil(gain / 4)
        elif period == "daily":
            gain = baseline
        out.update(target=float(max(goal, baseline - gain)), cap=cap)
        if gain < baseline - goal and period != "daily":
            out["note"] = f"Reduced by at most {int(gain)} this {'week' if period == 'weekly' else 'month'}: clearing all {int(baseline)} at once is not realistic."
        return out
    tol = TOLERANCE if spec["kind"] in ("score", "rate") else 0
    if baseline >= goal - tol:  # already healthy: hold it (a floor to stay above, not something to push higher)
        out.update(target=float(goal - tol), direction="keep", mode="maintain", note="")
        return out
    gain, cap = _gain(spec, baseline, scale)
    if period == "weekly":
        gain = math.ceil(gain / 4)
    target = min(baseline + gain, float(goal))
    limited = (goal - baseline) > (cap if period == "monthly" else math.ceil(cap / 4))
    out.update(target=float(target), cap=cap)
    if limited:
        out["note"] = f"Raised by at most {int(gain)} {(spec['unit'][:-1] if int(gain) == 1 and spec['unit'].endswith('s') else spec['unit']) if spec['kind'] == 'count' else ('point' if int(gain) == 1 else 'points')} this {'week' if period == 'weekly' else 'month'} (goal {int(goal)}): reaching it in one step would not be realistic."
    if scale < 1:
        out["confidence"], out["note"] = "low", (out["note"] + " Smaller because the recent targets were missed.").strip()
    elif gain > cap * 0.8:
        out["confidence"] = "medium"
    return out


def weekly_posts(cur_posts_30d: float | None) -> int:
    """Posts for the week: a steady 2 once the profile is active, up to the weekly cap while it builds up. Never above MAX_POSTS_PER_WEEK."""
    goal = SPEC["gmb.posts_30d"]["goal"]
    cur = cur_posts_30d or 0
    if cur >= goal:
        return 2
    return int(min(MAX_POSTS_PER_WEEK, max(1, math.ceil(min(10, goal - cur) / 4))))


def weekly_photos(cur_photos: float | None) -> int:
    goal = SPEC["gmb.photos_total"]["goal"]
    cur = cur_photos or 0
    if cur >= goal:
        return 0
    return int(min(math.ceil(MAX_PHOTOS_PER_MONTH / 4), max(1, math.ceil(min(MAX_PHOTOS_PER_MONTH, goal - cur) / 4))))


def scale_for(db: Session, b: Business, period: str, today: date) -> tuple[float, str | None]:
    """Reality adjustment from the last two CLOSED windows of this period: two mostly-missed windows shrink the goals, two fully-met ones grow them."""
    rows = list(db.scalars(select(GrowthTarget).where(GrowthTarget.business_id == b.id, GrowthTarget.period == period, GrowthTarget.closed_at.is_not(None), GrowthTarget.status.in_(("met", "missed")))
                           .order_by(GrowthTarget.window_start.desc())))
    by_window: dict[date, list[GrowthTarget]] = defaultdict(list)
    for r in rows:
        by_window[r.window_start].append(r)
    recent = [by_window[k] for k in sorted(by_window, reverse=True)[:2]]
    if len(recent) < 2:
        return 1.0, None
    missed = [sum(1 for t in w if t.status == "missed") / len(w) for w in recent]
    unit = {"daily": "days", "weekly": "weeks", "monthly": "months"}[period]
    this = {"daily": "today's", "weekly": "this week's", "monthly": "this month's"}[period]
    if all(x >= 0.5 for x in missed):
        return SCALE_DOWN, f"The last two {unit} missed more than half of the targets, so {this} goals are 25% smaller."
    if all(x == 0 for x in missed):
        return SCALE_UP, f"The last two {unit} met every target, so {this} goals are 25% bigger (never beyond the caps)."
    return 1.0, None


# ------------------------------------------------------------------------------------------------------------------- targets
def _status_of(direction: str, current: float | None, target: float | None) -> str | None:
    if current is None or target is None:
        return None
    ok = current <= target if direction == "down" else current >= target
    return "met" if ok else "missed"


def ensure_targets(db: Session, b: Business, data: dict[str, Any], today: date, periods: tuple[str, ...] = PERIODS) -> int:
    """Create the targets of the current windows that do not exist yet (idempotent). Returns how many were created."""
    made = 0
    for period in periods:
        start, end = window(period, today)
        have = {m for (m,) in db.execute(select(GrowthTarget.metric).where(GrowthTarget.business_id == b.id, GrowthTarget.period == period, GrowthTarget.window_start == start))}
        scale, _ = scale_for(db, b, period, today)
        started = _chatgpt_started(data)
        for spec in SPECS:
            if period not in spec["periods"] or spec["m"] in have:
                continue
            base = _val(data, spec["m"])
            if spec.get("needs_started") and not started:
                continue  # no catalog targets before the hub is started: the claim action comes first
            if base is None:
                if spec["primary"] and period == "monthly":  # one blocked target per area, so the plan says what cannot be measured and why
                    db.add(GrowthTarget(business_id=b.id, area=spec["a"], metric=spec["m"], label=spec["label"], period=period, window_start=start, window_end=end, baseline=None, target=None,
                                        unit=spec["unit"], direction=spec["d"], status="blocked", feasibility={"cap": None, "note": _why_missing(data, spec["m"]), "confidence": "none"},
                                        why="This cannot be measured yet, so no target is set (nothing is guessed)."))
                    made += 1
                continue
            if period == "daily" and spec["m"] != "gmb.unanswered":
                continue
            p = plan_target(spec, base, period, scale)
            unit = spec["unit"][:-1] if base == 1 and spec["unit"].endswith("s") and spec["unit"] not in ("points", "score") else spec["unit"]  # "1 review", not "1 reviews"
            why = (f"Measured {base:g} {unit} now." if p["mode"] == "build" else f"Already at {base:g} {unit}: hold it.")
            db.add(GrowthTarget(business_id=b.id, area=spec["a"], metric=spec["m"], label=spec["label"], period=period, window_start=start, window_end=end, baseline=base, target=p["target"],
                                unit=spec["unit"], direction=p["direction"], current=base, status="open", feasibility={"cap": p["cap"], "note": p["note"], "confidence": p["confidence"], "mode": p["mode"]}, why=why))
            made += 1
        if period == "weekly" and "gmb.posts_week" not in have and _val(data, "gmb.posts_30d") is not None:  # posts are counted per week (the 30-day figure rolls)
            n = weekly_posts(_val(data, "gmb.posts_30d"))
            db.add(GrowthTarget(business_id=b.id, area="gmb", metric="gmb.posts_week", label=INTERNAL["gmb.posts_week"]["label"], period="weekly", window_start=start, window_end=end, baseline=0, target=float(n),
                                unit="posts", direction="up", current=_internal_value(db, b, "gmb.posts_week", start, end) or 0, status="open",
                                feasibility={"cap": MAX_POSTS_PER_WEEK, "note": f"At most {MAX_POSTS_PER_WEEK} posts a week: more looks like spam to Google.", "confidence": "high", "mode": "build"},
                                why="Counted from the posts published this week."))
            made += 1
    db.flush()
    return made


def update_current(db: Session, b: Business, data: dict[str, Any], today: date) -> None:
    for t in db.scalars(select(GrowthTarget).where(GrowthTarget.business_id == b.id, GrowthTarget.closed_at.is_(None), GrowthTarget.status != "blocked")):
        v = _internal_value(db, b, t.metric, t.window_start, t.window_end) if t.metric in INTERNAL else _val(data, t.metric)
        if v is not None:
            t.current = v


def close_windows(db: Session, b: Business, data: dict[str, Any], today: date) -> dict[str, dict[str, int]]:
    """Close every window that ended before today's windows opened: met or missed from the data, blocked when the metric could not be read."""
    closed: dict[str, dict[str, int]] = {p: {"met": 0, "missed": 0, "blocked": 0} for p in PERIODS}
    for t in db.scalars(select(GrowthTarget).where(GrowthTarget.business_id == b.id, GrowthTarget.closed_at.is_(None), GrowthTarget.window_end < today)):
        start_now, _ = window(t.period, today)
        if t.window_end >= start_now:
            continue
        if t.status == "blocked":
            t.closed_at = _now()
            closed[t.period]["blocked"] += 1
            continue
        v = _internal_value(db, b, t.metric, t.window_start, t.window_end) if t.metric in INTERNAL else (t.current if t.period != "daily" else _val(data, t.metric))
        if t.metric not in INTERNAL and t.period != "daily":
            fresh = _val(data, t.metric)
            v = fresh if fresh is not None else v
        st = _status_of(t.direction, v, t.target)
        t.current = v if v is not None else t.current
        t.status = st or "blocked"
        t.closed_at = _now()
        closed[t.period][t.status] += 1
    db.flush()
    return closed


def progress_of(t: GrowthTarget) -> int:
    if t.baseline is None or t.target is None or t.current is None:
        return 0
    if t.direction == "keep":
        return 100 if t.current >= t.target else 0
    span = (t.target - t.baseline) if t.direction == "up" else (t.baseline - t.target)
    done = (t.current - t.baseline) if t.direction == "up" else (t.baseline - t.current)
    if span <= 0:
        return 100 if (t.current >= t.target if t.direction == "up" else t.current <= t.target) else 0
    return int(max(0, min(100, round(done / span * 100))))


def live_status(t: GrowthTarget, today: date) -> str:
    """'met', 'on_track' or 'at_risk' on read: the value against a straight line from the baseline to the target over the window."""
    if t.status in ("met", "missed", "blocked") and t.closed_at is not None:
        return t.status
    if t.status == "blocked":
        return "blocked"
    if t.baseline is None or t.target is None or t.current is None:
        return "open"
    if _status_of(t.direction, t.current, t.target) == "met" and (t.direction != "keep" or True):
        return "met"
    if t.direction == "keep":
        return "at_risk"
    if t.period == "daily" or t.window_end <= t.window_start:
        return "open"  # a one-day target is neither on track nor at risk until the day is over
    set_on = t.created_at.date() if getattr(t, "created_at", None) else t.window_start
    start = min(max(t.window_start, set_on), t.window_end)  # the baseline was measured when the target was set, so progress is judged from then
    length = max(1, (t.window_end - start).days + 1)
    elapsed = max(0.0, min(1.0, (today - start).days / length))  # nothing is expected on the day the target is set: a target made on a Friday must not start the week 'at risk'
    return "at_risk" if progress_of(t) + 25 < elapsed * 100 else "on_track"


def target_out(t: GrowthTarget, today: date) -> dict[str, Any]:
    return {"id": t.id, "area": t.area, "metric": t.metric, "label": t.label, "period": t.period, "window_start": t.window_start.isoformat(), "window_end": t.window_end.isoformat(),
            "baseline": t.baseline, "current": t.current, "target": t.target, "unit": t.unit, "direction": t.direction, "progress": progress_of(t), "status": live_status(t, today),
            "why": t.why, "feasibility": t.feasibility or {}}


# ------------------------------------------------------------------------------------------------------------------- the action catalog
FIX_HOW: dict[str, tuple[str, list[str], int]] = {
    "title": ("Write a clear page title (30 to 60 characters)", ["Start with the main service and the city, then the business name.", "Save it in the page's SEO settings (Yoast, Rank Math or the theme).", "Check the result in Page X-Ray."], 10),
    "description": ("Write a meta description (70 to 160 characters)", ["Describe what the page offers in one or two sentences with a reason to click.", "Do not copy the title.", "Save it in the SEO settings."], 10),
    "one_h1": ("Give the homepage exactly one H1", ["Keep one H1 that says what the business does and where.", "Turn the other H1s into H2 or H3.", "Check it in Page X-Ray."], 10),
    "canonical": ("Add a canonical tag that points to the page itself", ["Open the page's SEO settings and set the canonical to the page's own address (https, no tracking parameters).", "Make sure there is only one canonical tag."], 10),
    "indexable": ("Remove the noindex from the homepage", ["Open the page's SEO settings and allow search engines to index it.", "Check robots meta and the X-Robots-Tag header.", "Only the public pages should be indexable."], 10),
    "viewport": ("Add the mobile viewport meta tag", ["Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> to the page head (the theme usually does this).", "Test the page on a phone."], 10),
    "alt": ("Add alt text to the images", ["Describe each meaningful image in a few words.", "Leave decorative images with an empty alt.", "Aim for at least 90% of the images."], 20),
    "og": ("Add Open Graph tags (title, description, image)", ["Set og:title, og:description and a 1200 x 630 og:image in the SEO plugin.", "Test the link in a messenger preview."], 10),
    "internal_links": ("Add internal links to the key pages", ["Link the homepage to the main service pages, the contact page and the blog with descriptive link text.", "At least 3 internal links."], 15),
    "https": ("Serve the page over HTTPS only", ["Install or renew the SSL certificate in the hosting panel.", "Redirect every http:// address to https://.", "Never lower any other security setting to do this."], 20),
    "no_mixed_content": ("Remove http:// files from the https page", ["Find the images, scripts or styles loaded with http:// in the Page X-Ray report.", "Change them to https:// or upload them to the site."], 20),
    "faq_schema": ("Add an FAQ section with FAQPage schema", ["Write 4 to 6 real customer questions with short answers (2 to 4 sentences).", "Add the FAQPage structured data (an SEO plugin block or JSON-LD).", "Do not add questions nobody asks."], 30),
    "direct_answer": ("Lead the page with a short direct answer", ["Right after the main heading write a 40 to 60 word answer to the main customer question.", "State the service, the place and one proof point."], 15),
    "question_headings": ("Turn section headings into customer questions", ["Rewrite 2 or 3 H2 or H3 headings as the questions customers ask (What does it cost? How long does it take?).", "Answer each directly under the heading."], 15),
    "ai_crawlers": ("Allow the main AI crawlers in robots.txt", ["Open robots.txt and remove the Disallow rules for GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot and PerplexityBot.", "Allow only public pages; keep /wp-admin and private areas disallowed.", "Check it in Page X-Ray."], 10),
    "llms_txt": ("Publish an llms.txt file", ["Create a short /llms.txt that says who the business is, what it offers, where, and links to the key public pages.", "Never list private pages or contact data you do not publish elsewhere."], 20),
    "org_schema": ("Add Organization / LocalBusiness schema with sameAs", ["Generate the JSON-LD in the ChatGPT module (Profile & Policies) and place it in the homepage.", "Include name, url, logo, address, phone and sameAs links to the real profiles (Google, Facebook, Instagram)."], 20),
}
FIX_AREA = {"title": "seo", "description": "seo", "one_h1": "seo", "canonical": "seo", "indexable": "seo", "viewport": "seo", "alt": "seo", "og": "seo", "internal_links": "seo", "https": "seo",
            "no_mixed_content": "seo", "faq_schema": "aeo", "direct_answer": "aeo", "question_headings": "aeo", "ai_crawlers": "geo", "llms_txt": "geo", "org_schema": "geo"}


def fix_key(check_key: str) -> str:
    return f"seo.fix_issue_{check_key}" if FIX_AREA[check_key] == "seo" else f"{FIX_AREA[check_key]}.{check_key}"


def _homepage_checks(db: Session, b: Business, live: bool) -> list[dict[str, Any]]:
    """The failed Page X-Ray checks of the project's homepage that this plan knows how to fix: from the latest saved run (7 days), else a fresh run when `live`."""
    if not b.website:
        return []
    report = None
    since = _now() - timedelta(days=7)
    for r in db.scalars(select(PageXRayRun).where(PageXRayRun.business_id == b.id, PageXRayRun.created_at >= since).order_by(PageXRayRun.created_at.desc()).limit(30)):
        if _same_site(r.url, b.website) and (urlsplit(r.url).path or "/") in ("", "/") and r.report:
            from . import growth_metrics
            if growth_metrics.trustworthy_report(r.report):  # an empty-looking plain read of a script-built page is not trusted
                report = r.report
                break
    if report is None and live:
        try:
            from . import growth_metrics
            report = growth_metrics.read_own_page(b.website, b.website)
        except Exception as exc:  # noqa: BLE001 - a page that cannot be read gives no checks, and the plan says so elsewhere
            logger.info("growth: homepage X-Ray failed for business %s: %s", b.id, exc)
    out = []
    for area in ("seo", "aeo", "geo"):
        for c in ((report or {}).get("scores", {}).get(area, {}) or {}).get("checks", []):
            if not c.get("passed") and c.get("key") in FIX_HOW and FIX_AREA[c["key"]] == area:
                out.append({"area": area, "key": c["key"], "label": c.get("label"), "weight": int(c.get("weight") or 1), "detail": c.get("detail"), "fix": c.get("fix"),
                            "url": report.get("final_url") or report.get("url") or b.website})
    return out


def _fmt(v: float | None, unit: str = "") -> str:
    return "not measured" if v is None else f"{v:g}{(' ' + unit) if unit else ''}"


def candidates(db: Session, b: Business, data: dict[str, Any], today: date, live: bool = False) -> list[dict[str, Any]]:
    """Every action the plan could ask for today, with its impact. Pure apart from reading the stored homepage check."""
    w = _weights(data)
    out: list[dict[str, Any]] = []
    week_start, week_end = week_bounds(today)
    month_start, month_end = month_bounds(today)

    def add(key, area, period, title, why, how, est, mode, link, verify, impact, status="todo", due=None):
        out.append({"key": key, "area": area, "period": period, "title": title, "why": why, "how": how, "est": est, "mode": mode, "link": link, "verify": verify, "impact": impact,
                    "status": status, "due": due or {"daily": today, "weekly": week_end, "monthly": month_end}[period]})

    gmb_area = (data.get("areas") or {}).get("gmb") or {}
    gmb_ok = _val(data, "gmb.profile_score") is not None and gmb_area.get("state") != "blocked"  # the profile score is calculated from stored details even when Google is not linked
    unans, reviews, rating = _val(data, "gmb.unanswered"), _val(data, "gmb.reviews_total"), _val(data, "gmb.rating")
    posts30, photos = _val(data, "gmb.posts_30d"), _val(data, "gmb.photos_total")
    gw = w["gmb"] / 100
    # ---- Google Business Profile
    if not gmb_ok:
        reason = (gmb_area.get("blockers") or [None])[0] or _why_missing(data, "gmb.profile_score")
        add("gmb.connect_google", "gmb", "weekly", "Connect the Google Business Profile", f"The Google profile cannot be measured: {reason}.",
            ["Open Google Business Profile and press Connect Google account.", "Choose the account that owns or manages the profile and pick the business.", "Press Sync now."], 10, "manual", "/gmb-profile/profile",
            {"type": "metric", "metric": "gmb.profile_score", "op": "available"}, gw * 1.2)
        add("gmb.reply_reviews", "gmb", "daily", "Reply to every new review", "Replies need the Google profile to be connected first.", ["Connect the Google account (see the weekly task)."], 10, "assisted", "/gmb-profile/reviews",
            {"type": "metric", "metric": "gmb.unanswered", "op": "<=", "value": 0, "sync": True}, gw * 0.5, status="blocked")
        add("gmb.post", "gmb", "weekly", "Publish Google posts", "Posts need the Google profile to be connected first.", ["Connect the Google account (see the task above)."], 20, "assisted", "/google-posts",
            {"type": "count", "table": "posts", "delta": 1, "since": week_start.isoformat()}, gw * 0.6, status="blocked")
    else:
        if unans:
            add("gmb.reply_reviews", "gmb", "daily", f"Reply to the {int(unans)} review{'s' if unans != 1 else ''} waiting", f"{int(unans)} review{'s are' if unans != 1 else ' is'} still without a reply: replying to all of them is expected of an active profile.",
                ["Open Reviews & Reputation.", "Write a warm, specific reply (AI can draft one, you approve it). Thank positive reviews; answer negative ones calmly and offer to talk offline.", "Post the reply."], 10, "assisted",
                "/gmb-profile/reviews", {"type": "metric", "metric": "gmb.unanswered", "op": "<=", "value": 0, "sync": True}, gw * 1.0)
        if reviews is not None and reviews < SPEC["gmb.reviews_total"]["goal"]:
            gap = (SPEC["gmb.reviews_total"]["goal"] - reviews) / SPEC["gmb.reviews_total"]["goal"]
            add("gmb.ask_reviews", "gmb", "daily", "Ask 1 or 2 real customers for a Google review",
                f"The profile has {_fmt(reviews, 'reviews')}; {SPEC['gmb.reviews_total']['goal']} is the healthy level. Ask real customers, all ratings: never pick who to ask by how happy they seem.",
                ["Share the review link or QR code from Reviews & Reputation with a customer you just served.", "Ask every customer, whatever their rating. Never offer a reward or ask for only good reviews."], 5, "manual", "/gmb-profile/reviews",
                {"type": "deferred", "metric": "gmb.reviews_30d", "settle": "weekly", "baseline": _val(data, "gmb.reviews_30d")}, gw * (0.4 + gap))
        n = weekly_posts(posts30)
        add("gmb.post", "gmb", "weekly", f"Publish {n} Google post{'s' if n != 1 else ''} this week", f"{_fmt(posts30, 'posts')} in the last 30 days; an active profile posts about twice a week (never more than {MAX_POSTS_PER_WEEK}).",
            ["Write an update, offer or event about a real service, with one clear photo and a button.", "No keyword stuffing and no phone numbers in the text.", f"Share it on Google: {n} this week."], 20 * n, "assisted", "/google-posts",
            {"type": "count", "table": "posts", "delta": n, "since": week_start.isoformat()}, gw * 0.6)
        pn = weekly_photos(photos)
        if pn:
            add("gmb.photos", "gmb", "weekly", f"Add {pn} real photo{'s' if pn != 1 else ''} to the profile", f"{_fmt(photos, 'photos')} now; 20 is the healthy level. Real photos of the shop, the work and the team.",
                [f"Upload {pn} new, sharp photos in Photos & Media (exterior, interior, team, products).", "Never use stock images or photos of other businesses."], 10 * pn, "manual", "/media-management",
                {"type": "count", "metric": "gmb.photos_total", "delta": pn, "baseline": photos}, gw * 0.4)
        score = _val(data, "gmb.profile_score")
        if score is not None and score < SCORE_GOAL:
            tgt = min(score + 8, SCORE_GOAL)
            add("gmb.complete_profile", "gmb", "monthly", "Complete the missing parts of the Google profile", f"The profile scores {_fmt(score)} of 100. Fill what is missing: categories, hours, services, description, attributes.",
                ["Open the profile's Overview and follow the missing-information list.", "Use only true information that matches the signboard."], 40, "manual", "/gmb-profile/overview",
                {"type": "metric", "metric": "gmb.profile_score", "op": ">=", "value": tgt}, gw * (SCORE_GOAL - score) / SCORE_GOAL)
    # ---- local SEO and listings
    lw = w["local"] / 100
    cites, tracked = _val(data, "local.citations_verified"), _val(data, "local.keywords_tracked")
    if cites is not None and cites < SPEC["local.citations_verified"]["goal"]:
        add("local.citations", "local", "weekly", "Add one listing with the exact name, address and phone", f"{_fmt(cites, 'listings')} are checked and correct; {SPEC['local.citations_verified']['goal']} is the healthy level.",
            ["Open Listing Management and choose a directory that fits the business.", "Create the listing with exactly the same name, address and phone as the Google profile (no duplicates).", "Save the listing's link and press Check."], 25, "manual", "/off-page-seo/citations",
            {"type": "metric", "metric": "local.citations_verified", "op": ">=", "value": cites + 1, "baseline": cites}, lw * 0.8)
    if tracked is not None and tracked == 0 and b.website:
        add("local.track_keywords", "local", "weekly", "Start tracking the searches customers use", "No searches are tracked, so rankings cannot be measured.",
            ["Open the Local SEO page and press Start tracking, or add searches in Keyword Research.", "Pick searches a real customer would type (service + area)."], 10, "manual", "/gmb-profile/local-seo",
            {"type": "metric", "metric": "local.keywords_tracked", "op": ">=", "value": 1}, lw * 1.0, status="todo")
    elif tracked:
        add("local.rank_check", "local", "daily", "Check where the tracked searches rank today", f"{int(tracked)} searches are tracked; the history is what shows progress.", ["The rank check runs by itself. Open Position Tracking to read the result."], 2, "auto",
            "/rank-tracking/positions", {"type": "job", "job": "rank_check"}, lw * 0.3)
    if tracked is not None and 0 < tracked < SPEC["local.keywords_tracked"]["goal"] and b.website:
        n = int(min(5, SPEC["local.keywords_tracked"]["goal"] - tracked))
        add("local.keywords", "local", "monthly", f"Track {n} more searches", f"{int(tracked)} searches are tracked; {SPEC['local.keywords_tracked']['goal']} gives a fair picture.", ["Add real customer searches (service + area) in Keyword Research."], 15, "manual",
            "/keyword-management/discover", {"type": "metric", "metric": "local.keywords_tracked", "op": ">=", "value": tracked + n}, lw * 0.4)
    # ---- website: SEO, AEO, GEO from the homepage checks
    checks = _homepage_checks(db, b, live)
    fixes = sorted(checks, key=lambda c: -c["weight"] * w.get(c["area"], 10))[:MAX_FIX_ACTIONS_PER_WEEK + 2]
    for c in fixes:
        title, steps, est = FIX_HOW[c["key"]]
        add(fix_key(c["key"]), c["area"], "weekly", title, f"The live homepage fails the check “{c['label']}”: {c['detail']}", steps, est, "manual", "/page-xray",
            {"type": "xray_check", "key": c["key"], "area": c["area"], "url": c["url"]}, w.get(c["area"], 10) / 100 * (c["weight"] / 10))
    tech = _val(data, "seo.technical_score")
    if tech is not None and tech < SCORE_GOAL and b.website:
        add("seo.speed", "seo", "weekly", "Make the site faster", f"The speed score is {_fmt(tech)} of 100. Faster pages rank and convert better.",
            ["Compress and resize the biggest images (WebP).", "Turn on caching and compression.", "Remove unused plugins and scripts.", "Test again in Page X-Ray (Full page) or Site Audit."], 45, "manual", "/website-audit",
            {"type": "pagespeed", "min": min(100, tech + 3), "baseline": tech}, w["seo"] / 100 * (SCORE_GOAL - tech) / SCORE_GOAL)
    sec, ssl = _val(data, "seo.security_headers"), _val(data, "seo.ssl_days_left")
    if (sec is not None and sec < SPEC["seo.security_headers"]["goal"]) or (ssl is not None and ssl < 30):
        parts = []
        if sec is not None and sec < 5:
            parts.append(f"{int(sec)} of 6 security headers are set")
        if ssl is not None and ssl < 30:
            parts.append(f"the certificate has {int(ssl)} days left")
        add("seo.security", "seo", "monthly", "Strengthen the website security", "; ".join(parts).capitalize() + ".",
            ["Renew the SSL certificate if it has under 30 days left.", "Turn on HSTS, X-Content-Type-Options, X-Frame-Options and Referrer-Policy in the server or security plugin.", "Add a Content-Security-Policy in report-only mode first, then enforce it.", "Never disable a protection to make something work."], 30, "manual", "/page-xray",
            {"type": "metric_all", "checks": [{"metric": "seo.security_headers", "op": ">=", "value": min(5, (sec or 0) + 2)}, {"metric": "seo.ssl_days_left", "op": ">=", "value": 30}]}, w["seo"] / 100 * 0.8)
    onpage = _val(data, "seo.onpage_score")
    if b.website:
        add("seo.audit_review", "seo", "monthly", "Re-run the site audit and review the new findings", "A fresh crawl shows what changed and what is still broken.",
            ["Open Site Audit and start a new audit.", "Fix the top issues first (errors before warnings)."], 30, "auto", "/website-audit",
            {"type": "job", "job": "audit", "min": onpage if onpage is not None else 0}, w["seo"] / 100 * 0.5)
    sov = _val(data, "geo.share_of_voice")
    if sov is not None and sov < SPEC["geo.share_of_voice"]["goal"]:
        add("geo.share_of_voice", "geo", "monthly", "Improve how often AI answers mention the business", f"AI answers mention the business in {_fmt(sov, '%')} of the checked questions.",
            ["Open AI Visibility and read which questions miss you.", "Publish a clear, factual page for each missed question (FAQ with schema)."], 40, "manual", "/geo-optimization",
            {"type": "metric", "metric": "geo.share_of_voice", "op": ">=", "value": min(sov + 5, 100)}, w["geo"] / 100 * 0.6)
    # ---- Business in ChatGPT
    cw = w["chatgpt"] / 100
    claim, ready, items = _val(data, "chatgpt.claim"), _val(data, "chatgpt.readiness"), _val(data, "chatgpt.catalog_items")
    if not _chatgpt_started(data):
        add("chatgpt.claim", "chatgpt", "weekly", "Start the claim in ChatGPT Business Hub", "The business has not been set up for ChatGPT yet.",
            ["Open the Claim & Verification page and press Open ChatGPT Business Hub.", "Claim the business there and choose how to verify it (DNS record, email, phone or Shopify).", "Save the status and the verification method here."], 30, "manual", "/chatgpt-business/claim",
            {"type": "metric", "metric": "chatgpt.claim", "op": ">=", "value": 1}, cw * 1.0)
    else:
        if (claim or 0) < 2:
            add("chatgpt.claim", "chatgpt", "weekly", "Finish the ChatGPT claim and verification", "The claim is not approved yet.", ["Complete the verification in ChatGPT Business Hub.", "Update the status here once OpenAI approves it."], 20, "manual",
                "/chatgpt-business/claim", {"type": "metric", "metric": "chatgpt.claim", "op": ">=", "value": 2}, cw * 0.8)
        if ready is not None and ready < SPEC["chatgpt.readiness"]["goal"]:
            add("chatgpt.profile", "chatgpt", "weekly", "Complete the ChatGPT profile and policies", f"Readiness is {_fmt(ready)} of 100.", ["Fill the description (max 500 characters), delivery and return policy, website and logo.", "Use only true, current information."], 25, "manual",
                "/chatgpt-business/profile", {"type": "metric", "metric": "chatgpt.readiness", "op": ">=", "value": min(100, ready + 10), "baseline": ready}, cw * 0.7)
        if items is not None and items < SPEC["chatgpt.catalog_items"]["goal"]:
            n = int(min(3, SPEC["chatgpt.catalog_items"]["goal"] - items))
            add("chatgpt.feed", "chatgpt", "weekly", f"Add {n} product or service{'s' if n != 1 else ''} to the ChatGPT feed", f"The feed has {int(items)} item{'s' if items != 1 else ''}.", ["Import from the project's services or add items with true prices and links.", "Keep prices and availability current."], 20, "manual",
                "/chatgpt-business/feed", {"type": "metric", "metric": "chatgpt.catalog_items", "op": ">=", "value": items + n}, cw * 0.5)
    chatgpt_goal = SPEC["chatgpt.readiness"]["goal"]
    if ready is not None and ready < chatgpt_goal:
        aim = min(chatgpt_goal, ready + 20)
        started = _chatgpt_started(data)
        add("chatgpt.monthly", "chatgpt", "monthly", f"Bring the ChatGPT business page to {int(aim)} of 100" if started else "Set up the business in ChatGPT this month",
            f"ChatGPT readiness is {_fmt(ready)} of 100; {int(chatgpt_goal)} is a complete, claimed and verified page.",
            ["Claim the business in ChatGPT Business Hub and note the verification method (DNS record, Shopify, business email or phone).", "Write the description (max 500 characters) and the delivery and return policies in Profile & Policies.",
             "Add your real products or services to the feed and paste the feed link into the Business Hub.", "Place the JSON-LD from the Profile & Policies page on the website."], 60, "manual",
            "/chatgpt-business/profile" if started else "/chatgpt-business/claim", {"type": "metric", "metric": "chatgpt.readiness", "op": ">=", "value": aim, "baseline": ready}, cw * 0.9)
    aeo = _val(data, "aeo.score")
    if aeo is not None and aeo < SPEC["aeo.score"]["goal"]:
        aim = min(SPEC["aeo.score"]["goal"], aeo + 10)
        add("aeo.monthly", "aeo", "monthly", f"Make the homepage answer-ready: AEO score {int(aeo)} to {int(aim)}",
            f"The homepage scores {_fmt(aeo)} of 100 for answer engines. They quote pages that answer a customer's question directly.",
            ["Add an FAQ section with 4 to 6 real customer questions and short answers, with FAQPage structured data.", "Right under the main heading write a 40 to 60 word direct answer.",
             "Turn two section headings into the questions customers ask.", "Run Page X-Ray to check the score."], 60, "manual", "/page-xray",
            {"type": "metric", "metric": "aeo.score", "op": ">=", "value": aim, "baseline": aeo}, w["aeo"] / 100 * 1.0)
    # ---- the monthly review
    add("growth.review_targets", "gmb", "monthly", "Review this month's targets", "At the end of the month every target is closed as met or missed from the real numbers, and next month's goals are set from the result.",
        ["Open the Growth Plan and read the closed targets.", "Note what worked; no action is needed to close them."], 10, "auto", "/growth", {"type": "job", "job": "monthly_review"}, 0.05)
    return out


def _action_out(a: GrowthAction) -> dict[str, Any]:
    return {"id": a.id, "target_id": a.target_id, "area": a.area, "key": a.key, "period": a.period, "title": a.title, "why": a.why, "how": a.how or [], "est_minutes": a.est_minutes, "mode": a.mode, "link": a.link,
            "due_on": a.due_on.isoformat(), "status": a.status, "evidence": a.evidence, "verified_at": a.verified_at.isoformat() if a.verified_at else None, "note": a.note}


def capacity_of(b: Business) -> dict[str, int]:
    return CAPACITY.get(b.plan or "Starter", CAPACITY["Starter"])


def _target_for(db: Session, b: Business, period: str, metric: str | None, today: date) -> int | None:
    if not metric:
        return None
    start, _ = window(period, today)
    return db.scalar(select(GrowthTarget.id).where(GrowthTarget.business_id == b.id, GrowthTarget.period == period, GrowthTarget.window_start == start, GrowthTarget.metric == metric))


ACTION_TARGET = {"gmb.reply_reviews": "gmb.unanswered", "gmb.post": "gmb.posts_week", "gmb.photos": "gmb.photos_total", "gmb.complete_profile": "gmb.profile_score", "local.citations": "local.citations_verified",
                 "local.keywords": "local.keywords_tracked", "seo.speed": "seo.technical_score", "seo.security": "seo.security_headers", "seo.audit_review": "seo.onpage_score", "geo.share_of_voice": "geo.share_of_voice",
                 "chatgpt.profile": "chatgpt.readiness", "chatgpt.feed": "chatgpt.catalog_items", "chatgpt.claim": "chatgpt.readiness", "gmb.ask_reviews": "gmb.reviews_total"}


def _balanced(db: Session, b: Business, period: str, pool: list[dict[str, Any]], existing: dict[str, Any], today: date) -> list[dict[str, Any]]:
    """The order tasks are taken in when capacity is limited: one task per area in turn (best first), so no area with an open target is left without work.
    An area that had no task in the previous period of the same kind goes first, so over a few weeks every area gets its turn even on a small plan."""
    if period == "daily":
        return list(pool)  # daily tasks are habits tied to the daily targets: best impact first, no rotation
    served_now = {a.area for a in existing.values()}
    horizon = today - timedelta(days={"daily": 3, "weekly": 14, "monthly": 62}[period])
    recent = {a for (a,) in db.execute(select(GrowthAction.area).where(GrowthAction.business_id == b.id, GrowthAction.period == period, GrowthAction.due_on >= horizon,
                                                                       GrowthAction.due_on < {"daily": today, "weekly": week_bounds(today)[1], "monthly": month_bounds(today)[1]}[period]))}
    first = [c for c in pool if c["key"] == "gmb.connect_google"]  # the one task that unblocks the rest always comes first
    rest = [c for c in pool if c["key"] != "gmb.connect_google"]
    by_area: dict[str, list[dict[str, Any]]] = {}
    for c in rest:
        by_area.setdefault(c["area"], []).append(c)  # `pool` is already best-first
    order = sorted(by_area, key=lambda a: (a in served_now, a in recent, -by_area[a][0]["impact"]))
    out = list(first)
    while any(by_area.values()):
        for a in order:
            if by_area[a]:
                out.append(by_area[a].pop(0))
    return out


def ensure_actions(db: Session, b: Business, data: dict[str, Any], today: date, live: bool = False, periods: tuple[str, ...] = PERIODS) -> dict[str, list[str]]:
    """Create today's, this week's and this month's actions within the plan's capacity (idempotent). Returns {created, deferred} titles."""
    cap = capacity_of(b)
    cands = candidates(db, b, data, today, live)
    made: list[str] = []
    deferred: list[str] = []
    for period in periods:
        pool = sorted((c for c in cands if c["period"] == period), key=lambda c: (c["status"] != "todo" and c["key"] != "gmb.connect_google", -c["impact"]))
        existing = {a.key: a for a in db.scalars(select(GrowthAction).where(GrowthAction.business_id == b.id, GrowthAction.period == period,
                                                                           GrowthAction.due_on == {"daily": today, "weekly": week_bounds(today)[1], "monthly": month_bounds(today)[1]}[period]))}
        room = cap[period] - len(existing)
        for c in _balanced(db, b, period, pool, existing, today):
            row = existing.get(c["key"])
            if row is not None:  # a blocked task whose prerequisite is now met becomes a normal task again
                if row.status == "blocked" and c["status"] == "todo":
                    row.status, row.how, row.why, row.verify, row.title = "todo", c["how"], c["why"], c["verify"], c["title"]
                continue
            if room <= 0:
                deferred.append(c["title"])
                continue
            room -= 1
            row = GrowthAction(business_id=b.id, target_id=_target_for(db, b, period, ACTION_TARGET.get(c["key"]), today), area=c["area"], key=c["key"], period=period, due_on=c["due"], title=c["title"], why=c["why"], how=c["how"],
                               est_minutes=c["est"], mode=c["mode"], link=c["link"], verify=c["verify"], status=c["status"], evidence={"baseline_at": today.isoformat()})
            db.add(row)
            made.append(c["title"])
    db.flush()
    return {"created": made, "deferred": deferred}


# ------------------------------------------------------------------------------------------------------------------- verification (the real checks)
class _Pass:
    """One verification pass: a live measurement and a homepage X-Ray are done once and shared by every action checked in the same pass."""

    def __init__(self, db: Session, b: Business, live: bool = True):
        self.db, self.b, self.live = db, b, live
        self._data: dict[str, Any] | None = None
        self._xray: dict[str, dict[str, Any] | Exception] = {}

    def data(self) -> dict[str, Any]:
        if self._data is None:
            self._data = _measure(self.db, self.b, live=self.live)
        return self._data

    def xray(self, url: str) -> dict[str, Any]:
        if url not in self._xray:
            from . import growth_metrics
            try:
                self._xray[url] = growth_metrics.read_own_page(url, self.b.website)
            except Exception as exc:  # noqa: BLE001
                self._xray[url] = exc
        got = self._xray[url]
        if isinstance(got, Exception):
            raise got
        return got


def _cmp(op: str, a: float, b: float) -> bool:
    return {">=": a >= b, "<=": a <= b, ">": a > b, "<": a < b, "==": a == b}[op]


def _result(passed: bool | None, details: str, before: Any = None, after: Any = None) -> dict[str, Any]:
    return {"passed": passed, "details": details, "before": before, "after": after, "checked_at": _now().isoformat()}


def _check(db: Session, b: Business, a: GrowthAction, ctx: _Pass, today: date) -> dict[str, Any]:
    rule = a.verify or {}
    kind = rule.get("type")
    try:
        from . import growth_issues
        if kind in growth_issues.VERIFY_KINDS:  # a fix task for an issue found by the sweep
            return growth_issues.verify_rule(db, b, rule, ctx, today)
        if kind == "metric":
            if rule["op"] == "available":
                v = _val(ctx.data(), rule["metric"])
                return _result(v is not None, "The metric can now be measured." if v is not None else _why_missing(ctx.data(), rule["metric"]), None, v)
            v = _val(ctx.data(), rule["metric"])
            if v is None:
                return _result(False, f"Cannot be checked yet: {_why_missing(ctx.data(), rule['metric'])}", rule.get("baseline"), None)
            ok = _cmp(rule["op"], v, float(rule["value"]))
            return _result(ok, f"{rule['metric']} is {v:g}; needs {rule['op']} {float(rule['value']):g}." + ("" if ok else " Not there yet."), rule.get("baseline"), v)
        if kind == "metric_all":
            parts, ok_all = [], True
            for c in rule["checks"]:
                v = _val(ctx.data(), c["metric"])
                ok = v is not None and _cmp(c["op"], v, float(c["value"]))
                ok_all = ok_all and ok
                parts.append(f"{c['metric']} {('unknown' if v is None else format(v, 'g'))} (needs {c['op']} {c['value']:g})")
            return _result(ok_all, "; ".join(parts))
        if kind == "count":
            n = int(rule.get("delta") or 1)
            if rule.get("table") == "posts":
                since = datetime.combine(date.fromisoformat(rule["since"]), datetime.min.time(), tzinfo=timezone.utc)
                got = db.scalar(select(func.count(Post.id)).where(Post.business_id == b.id, Post.status == "published", Post.published_at >= since)) or 0
                return _result(got >= n, f"{got} post{'s' if got != 1 else ''} published since {rule['since']}; needs {n}.", 0, got)
            if rule.get("table") == "reviews":
                since = date.fromisoformat(rule["since"])
                got = db.scalar(select(func.count(Review.id)).where(Review.business_id == b.id, Review.review_date >= since)) or 0
                return _result(got >= n, f"{got} new review{'s' if got != 1 else ''} since {rule['since']}; needs {n}.", 0, got)
            v = _val(ctx.data(), rule["metric"])
            base = rule.get("baseline")
            if v is None or base is None:
                return _result(False, f"Cannot be checked yet: {_why_missing(ctx.data(), rule['metric'])}", base, v)
            return _result(v - base >= n, f"{rule['metric']} went from {base:g} to {v:g}; needs +{n}.", base, v)
        if kind == "xray_check":
            if not _same_site(rule.get("url"), b.website):
                return _result(False, "The check points outside the project's own website, so it was not run.")
            rep = ctx.xray(rule["url"])
            chk = next((c for c in (rep.get("scores", {}).get(rule["area"], {}) or {}).get("checks", []) if c.get("key") == rule["key"]), None)
            if chk is None:
                return _result(True, "The check no longer applies to this page.")
            return _result(bool(chk.get("passed")), (chk.get("detail") or "") + ("" if chk.get("passed") else f" Still failing. {chk.get('fix') or ''}".rstrip()), False, bool(chk.get("passed")))
        if kind == "pagespeed":
            if not _same_site(b.website, b.website) or not b.website:
                return _result(False, "The project has no website to test.")
            from . import pagespeed
            res = pagespeed.run(b.website, "mobile")
            vals = [v for v in (res.get("scores") or {}).values() if v is not None]
            score = round(sum(vals) / len(vals)) if vals else None
            if score is None:
                return _result(None, "PageSpeed returned no scores.")
            need = float(rule.get("min", 0))
            return _result(score >= need, f"The speed score is {score}; needs {need:g}.", rule.get("baseline"), score)
        if kind == "job":
            job = rule.get("job")
            if job == "rank_check":
                last = db.scalar(select(func.max(KeywordRankLog.day)).where(KeywordRankLog.business_id == b.id))
                ok = last is not None and last >= today
                return _result(ok, f"The last rank check was on {last}." if last else "No rank check has run yet.", None, str(last) if last else None)
            if job == "audit":
                from . import audits
                run = audits.run(db, b, "onpage")
                score = getattr(run, "score", None)
                if getattr(run, "status", "done") != "done" or score is None:
                    return _result(None, "The audit did not finish: it will be checked again.")
                need = float(rule.get("min", 0))
                return _result(score >= need, f"The new crawl scores {score}; it must not fall below {need:g}.", need, score)
            return _result(None, "This task is closed when the month ends.")
        if kind == "deferred":
            return _result(None, "Checked at the weekly roll-up, from the reviews that really arrived.")
    except DataUnavailable as exc:
        return _result(None, f"Cannot be checked right now: {exc.message}")
    except Exception as exc:  # noqa: BLE001 - a network failure must not mark a task failed
        logger.info("growth: verification of action %s could not run: %s", a.id, exc)
        db.rollback()
        return _result(None, f"Cannot be checked right now: {str(exc)[:140]}")
    return _result(None, "This task has no automatic check.")


def verify_action(db: Session, b: Business, a: GrowthAction, live: bool = True, today: date | None = None, ctx: _Pass | None = None) -> dict[str, Any]:
    """Run the REAL check for one action and set its status from it: verified when it passes, unverified when a done task does not pass. The person's click is never proof."""
    today = _today(today, b)
    res = _check(db, b, a, ctx or _Pass(db, b, live), today)
    ev = dict(a.evidence or {})
    ev.update({"checked_at": res["checked_at"], "details": res["details"], "before": res["before"], "after": res["after"], "passed": res["passed"]})
    a.evidence = ev
    if res["passed"] is True:
        if a.status in ("todo", "done", "unverified", "failed"):
            a.status, a.verified_at = "verified", _now()
    elif res["passed"] is False and a.status == "done":
        a.status = "unverified"
    db.add(a)
    db.flush()
    return res


def mark_done(db: Session, b: Business, a: GrowthAction, actor: str, note: str | None = None) -> GrowthAction:
    if a.status == "blocked":
        raise ValueError("This task is blocked: do the unblocking step first.")
    if a.status in ("verified", "skipped"):
        raise ValueError(f"This task is already {a.status}.")
    a.status, a.completed_by, a.note = "done", actor, (note or a.note)
    db.add(a)
    db.flush()
    return a


def skip_action(db: Session, b: Business, a: GrowthAction, reason: str, actor: str) -> GrowthAction:
    if len((reason or "").strip()) < 5:
        raise ValueError("Give a reason of at least 5 characters.")
    if a.status == "verified":
        raise ValueError("A verified task cannot be skipped.")
    a.status, a.note, a.completed_by = "skipped", reason.strip(), actor
    db.add(a)
    db.flush()
    return a


def verify_open(db: Session, b: Business, today: date, live: bool = True, limit: int = 12) -> dict[str, int]:
    """The daily pass: really check every 'done' task and every task due now (so a task that is already satisfied is credited, and a click without the result is not)."""
    ctx = _Pass(db, b, live)
    rows = list(db.scalars(select(GrowthAction).where(GrowthAction.business_id == b.id, GrowthAction.status.in_(("todo", "done", "unverified")), GrowthAction.due_on <= window("weekly", today)[1]
                                                      if False else GrowthAction.due_on >= today - timedelta(days=7)).order_by(GrowthAction.due_on).limit(60)))
    out = {"checked": 0, "verified": 0}
    for a in rows:
        if (a.verify or {}).get("type") in ("deferred", None) or (a.verify or {}).get("job") == "monthly_review" or a.period == "fix":
            continue  # fix tasks are closed by the issue sweep, or by the person's Verify button
        if out["checked"] >= limit:
            break
        out["checked"] += 1
        before = a.status
        verify_action(db, b, a, live, today, ctx)
        out["verified"] += int(a.status == "verified" and before != "verified")
    return out


def settle_overdue(db: Session, b: Business, today: date) -> int:
    """A task whose due date passed without being verified becomes 'failed' (never silently dropped). Deferred review asks wait for the weekly roll-up."""
    n = 0
    for a in db.scalars(select(GrowthAction).where(GrowthAction.business_id == b.id, GrowthAction.due_on < today, GrowthAction.status.in_(("todo", "done", "unverified")))):
        if (a.verify or {}).get("type") == "deferred" and a.due_on >= today - timedelta(days=7):
            continue
        if (a.verify or {}).get("job") == "monthly_review" or a.period == "fix":  # a fix task stays open and shows as overdue until the issue is gone
            continue
        a.status, a.note = "failed", (a.note or "") + (" " if a.note else "") + "Not verified by its due date."
        n += 1
    db.flush()
    return n


def _settle_deferred(db: Session, b: Business, week_start: date, week_end: date) -> dict[str, Any]:
    """The daily 'ask real customers for a review' tasks of a closed week are judged together by the reviews that really arrived that week."""
    asks = list(db.scalars(select(GrowthAction).where(GrowthAction.business_id == b.id, GrowthAction.key == "gmb.ask_reviews", GrowthAction.due_on >= week_start, GrowthAction.due_on <= week_end,
                                                      GrowthAction.status.in_(("done", "todo", "unverified")))))
    if not asks:
        return {"asks": 0, "reviews": 0}
    got = db.scalar(select(func.count(Review.id)).where(Review.business_id == b.id, Review.review_date >= week_start, Review.review_date <= week_end)) or 0
    for a in asks:
        ev = dict(a.evidence or {})
        ev.update({"checked_at": _now().isoformat(), "details": f"{got} new review{'s' if got != 1 else ''} arrived in the week.", "after": got, "passed": got > 0 if a.status == "done" else False})
        a.evidence = ev
        if a.status == "done" and got > 0:
            a.status, a.verified_at = "verified", _now()
        else:
            a.status = "unverified" if a.status == "done" else "failed"
    db.flush()
    return {"asks": len(asks), "reviews": got}


def _carry_forward(db: Session, b: Business, today: date) -> int:
    """Unfinished weekly tasks of last week return once, this week, with a note. Last week's copy is closed as failed (it was not done in time)."""
    start, end = week_bounds(today)
    n = 0
    for a in list(db.scalars(select(GrowthAction).where(GrowthAction.business_id == b.id, GrowthAction.period == "weekly", GrowthAction.due_on < start, GrowthAction.due_on >= start - timedelta(days=7),
                                                         GrowthAction.status.in_(("todo", "unverified", "failed"))))):
        if (a.evidence or {}).get("carried_from") or (a.evidence or {}).get("carried") or a.status == "failed" and "carried" in (a.note or ""):
            continue
        if db.scalar(select(GrowthAction.id).where(GrowthAction.business_id == b.id, GrowthAction.key == a.key, GrowthAction.due_on == end)):
            a.status, a.note = "failed", (a.note or "") + " Not done last week."
            continue
        rule = dict(a.verify or {})
        if rule.get("since"):
            rule["since"] = start.isoformat()
        db.add(GrowthAction(business_id=b.id, target_id=None, area=a.area, key=a.key, period="weekly", due_on=end, title=a.title, why=a.why, how=a.how, est_minutes=a.est_minutes, mode=a.mode, link=a.link,
                            verify=rule, status="todo", evidence={"carried_from": a.id, "baseline_at": today.isoformat()}, note=f"Carried forward from the week of {a.due_on - timedelta(days=6)}: it was not finished in time."))
        a.status, a.note, a.evidence = "failed", (a.note or "") + (" " if a.note else "") + "Not done in time; carried forward once.", {**(a.evidence or {}), "carried": True}
        n += 1
    db.flush()
    return n


# ------------------------------------------------------------------------------------------------------------------- rolls and refresh
def _notify(db: Session, b: Business, title: str, body: str) -> None:
    try:
        db.add(Notification(business_id=b.id, owner_id=b.owner_id, kind="growth", title=title, body=body, link="/growth"))
    except Exception:  # noqa: BLE001 - a notification problem never stops a roll
        logger.exception("growth: could not create the notification for business %s", b.id)


def _roll_all(db: Session, b: Business, data: dict[str, Any], today: date, live: bool, notify: bool = True) -> dict[str, Any]:
    """Close what ended, then make sure every current window and its tasks exist. Safe to call any number of times a day."""
    info: dict[str, Any] = {}
    ws, we = week_bounds(today)
    ms, me = month_bounds(today)
    prev_week = (ws - timedelta(days=7), ws - timedelta(days=1))
    info["closed"] = close_windows(db, b, data, today)
    if db.scalar(select(func.count(GrowthTarget.id)).where(GrowthTarget.business_id == b.id, GrowthTarget.period == "weekly", GrowthTarget.window_start == prev_week[0])):
        info["deferred_reviews"] = _settle_deferred(db, b, *prev_week)
    info["carried"] = _carry_forward(db, b, today)
    info["settled_overdue"] = settle_overdue(db, b, today)
    info["targets_created"] = ensure_targets(db, b, data, today)
    update_current(db, b, data, today)
    info["actions"] = ensure_actions(db, b, data, today, live)
    if notify:
        w_missed = info["closed"]["weekly"]["missed"]
        m_closed = sum(info["closed"]["monthly"].values())
        if w_missed:
            _notify(db, b, f"{w_missed} weekly target{'s' if w_missed != 1 else ''} missed", f"Last week's Growth Plan closed with {info['closed']['weekly']['met']} met and {w_missed} missed. This week's goals are set.")
        if m_closed:
            _notify(db, b, "Monthly growth targets closed", f"Last month: {info['closed']['monthly']['met']} met, {info['closed']['monthly']['missed']} missed. This month's goals are set.")
    return info


def refresh(db: Session, b: Business, actor: str, live: bool = False, source: str | None = None, today: date | None = None) -> dict[str, Any]:
    """Measure the project, keep the snapshot, and make sure today's, this week's and this month's targets and tasks exist. Returns the payload."""
    from . import growth_metrics
    today = _today(today, b)
    data = _measure(db, b, live=live)
    if data.get("metrics"):
        try:
            growth_metrics.save_snapshot(db, b, data, source or ("onboarding" if actor == "system" else "manual"))
        except Exception:  # noqa: BLE001 - a snapshot problem must not lose the plan
            db.rollback()
            logger.exception("growth: could not save the snapshot for business %s", b.id)
    _roll_all(db, b, data, today, live)
    log(db, actor, "growth_refreshed", b.id, live=live)
    db.commit()
    return payload(db, b, today)


def _sweep_and_report(db: Session, b: Business, today: date, info: dict[str, Any]) -> None:
    """The issue sweep (new fix tasks, closed ones, a critical-issue email at most once a day) and any growth report that is due. Never stops a roll."""
    from . import growth_issues, growth_report
    try:
        res = growth_issues.sweep(db, b, today, live=False)
        info["issues"] = {k: res[k] for k in ("found", "created", "closed")}
        if res["new_critical"]:
            growth_report.alert_critical(db, b, res["new_critical"], today)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.warning("growth: issue sweep failed for business %s: %s", b.id, exc)
    try:
        info["reports"] = growth_report.ensure_due(db, b, today)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.warning("growth: report failed for business %s: %s", b.id, exc)


def roll_daily(db: Session, b: Business, today: date | None = None, live_checks: bool = True) -> dict[str, Any]:
    """The daily job: measure what is stored, keep the snapshot, make today's windows, and really verify the tasks that are done or due."""
    from . import growth_metrics
    today = _today(today, b)
    data = _measure(db, b, live=False)
    if data.get("metrics"):
        try:
            growth_metrics.save_snapshot(db, b, data, "daily")
        except Exception:  # noqa: BLE001
            db.rollback()
    info = _roll_all(db, b, data, today, False)
    info["verification"] = verify_open(db, b, today, live=live_checks)
    update_current(db, b, _measure(db, b, live=False) if info["verification"]["checked"] else data, today)
    _sweep_and_report(db, b, today, info)
    log(db, "scheduler", "growth_daily", b.id, **{k: str(v)[:200] for k, v in info.items()})
    db.commit()
    return info


def roll_weekly(db: Session, b: Business, today: date | None = None) -> dict[str, Any]:
    """The weekly job: close last week, settle the review asks, carry unfinished tasks forward once, set this week's goals (adapted to the record)."""
    today = _today(today, b)
    data = _measure(db, b, live=False)
    info = _roll_all(db, b, data, today, False)
    _sweep_and_report(db, b, today, info)
    log(db, "scheduler", "growth_weekly", b.id, closed=str(info["closed"]["weekly"]))
    db.commit()
    return info


def roll_monthly(db: Session, b: Business, today: date | None = None) -> dict[str, Any]:
    """The monthly job: close last month, mark its review task done, set this month's goals (adapted to the record)."""
    today = _today(today, b)
    data = _measure(db, b, live=False)
    info = _roll_all(db, b, data, today, False)
    ms, _ = month_bounds(today)
    prev_end = ms - timedelta(days=1)
    for a in db.scalars(select(GrowthAction).where(GrowthAction.business_id == b.id, GrowthAction.key == "growth.review_targets", GrowthAction.due_on == prev_end, GrowthAction.status.in_(("todo", "done")))):
        a.status, a.verified_at, a.evidence = "verified", _now(), {**(a.evidence or {}), "details": "The month closed and its targets were counted.", "passed": True, "checked_at": _now().isoformat()}
    _sweep_and_report(db, b, today, info)
    log(db, "scheduler", "growth_monthly", b.id, closed=str(info["closed"]["monthly"]))
    db.commit()
    return info


# ------------------------------------------------------------------------------------------------------------------- the payload the page reads
def _level(score: int | None) -> str:
    return "none" if score is None else "good" if score >= 75 else "warning" if score >= 45 else "critical"


def _area_rows(data: dict[str, Any]) -> list[dict[str, Any]]:
    w = _weights(data)
    out = []
    for key in AREA_FALLBACK:
        a = (data.get("areas") or {}).get(key) or {}
        score = a.get("score")
        blockers = list(a.get("blockers") or [])
        state = a.get("state") or ("measured" if score is not None else ("not_started" if key == "chatgpt" else "blocked"))
        if not blockers and score is None:
            reasons = []
            for m, meta in (data.get("metrics") or {}).items():
                if isinstance(meta, dict) and meta.get("area") == key and not meta.get("available", True) and meta.get("reason") and meta["reason"] not in reasons:
                    reasons.append(meta["reason"])
            blockers = reasons[:2]
        out.append({"key": key, "label": AREA_LABELS[key], "score": score, "weight": w[key], "state": state, "blockers": blockers})
    return out


def payload(db: Session, b: Business, today: date | None = None) -> dict[str, Any]:
    """Everything the Growth Plan page shows, from stored rows (no network)."""
    from . import growth_metrics
    today = _today(today, b)
    data = _from_snapshot(db, b)
    snaps = growth_metrics.snapshots(db, b.id, 90)
    trend = [{"day": s.day.isoformat(), "score": s.presence} for s in snaps if s.presence is not None]
    now_score = data.get("presence")
    old = next((s.presence for s in snaps if s.presence is not None and s.day <= today - timedelta(days=30)), None) if snaps else None
    if old is None and len(trend) >= 2:
        old = trend[0]["score"]
    delta = (now_score - old) if (now_score is not None and old is not None and len(trend) >= 2) else None
    targets = {p: [target_out(t, today) for t in db.scalars(select(GrowthTarget).where(GrowthTarget.business_id == b.id, GrowthTarget.period == p, GrowthTarget.window_start == window(p, today)[0])
                                                         .order_by(GrowthTarget.area, GrowthTarget.metric))] for p in PERIODS}
    ws, we = week_bounds(today)
    ms, me = month_bounds(today)
    acts = lambda p, lo, hi: [_action_out(a) for a in db.scalars(select(GrowthAction).where(GrowthAction.business_id == b.id, GrowthAction.period == p, GrowthAction.due_on >= lo, GrowthAction.due_on <= hi).order_by(GrowthAction.id))]  # noqa: E731
    actions = {"today": acts("daily", today, today), "week": acts("weekly", ws, we), "month": acts("monthly", ms, me)}
    history = []
    for p, n in (("weekly", 8), ("monthly", 3)):
        starts = sorted({s for (s,) in db.execute(select(GrowthTarget.window_start).where(GrowthTarget.business_id == b.id, GrowthTarget.period == p, GrowthTarget.closed_at.is_not(None)))}, reverse=True)[:n]
        for s in starts:
            rows = list(db.scalars(select(GrowthTarget).where(GrowthTarget.business_id == b.id, GrowthTarget.period == p, GrowthTarget.window_start == s, GrowthTarget.status.in_(("met", "missed")))))
            history.append({"period": p, "start": s.isoformat(), "met": sum(1 for r in rows if r.status == "met"), "total": len(rows)})
    adjustments = [n for n in (scale_for(db, b, "weekly", today)[1], scale_for(db, b, "monthly", today)[1]) if n]
    caps = [f"{t['label']}: {t['feasibility']['note']}" for p in PERIODS for t in targets[p] if (t["feasibility"] or {}).get("note") and t["status"] != "blocked"]
    blocked = [f"{t['label']}: {t['feasibility'].get('note') or 'cannot be measured yet'}" for p in PERIODS for t in targets[p] if t["status"] == "blocked"] + \
              [f"{a['title']} (blocked)" for k in actions for a in actions[k] if a["status"] == "blocked"]
    created = {a["key"] for k in actions for a in actions[k]}
    deferred = [c["title"] for c in candidates(db, b, data, today, False) if c["key"] not in created and c["status"] == "todo"] if data.get("metrics") else []
    sched = {j: db.scalar(select(Schedule.next_run_at).where(Schedule.business_id == b.id, Schedule.job == j)) for j in GROWTH_JOBS}
    fixes = [a for a in db.scalars(select(GrowthAction).where(GrowthAction.business_id == b.id, GrowthAction.period == "fix", GrowthAction.status.in_(("todo", "done", "unverified", "failed", "blocked"))))]
    issues = {"open": len(fixes), "critical": sum(1 for a in fixes if (a.evidence or {}).get("severity") == "critical")}
    return {"business_id": b.id, "generated_at": _now().isoformat(), "issues": issues, "plan": b.plan or "Starter", "mode": "maintain" if (now_score or 0) >= SCORE_GOAL else "build",
            "presence": {"score": now_score, "level": _level(now_score), "delta_30d": delta, "areas": _area_rows(data), "trend": trend},
            "targets": targets, "actions": actions, "history": history,
            "reality": {"capacity": capacity_of(b), "adjustments": adjustments, "caps": caps, "blocked": blocked, "deferred": deferred, "policy": POLICY},
            "next": {"daily": sched["growth_daily"].isoformat() if sched["growth_daily"] else None, "weekly": sched["growth_weekly"].isoformat() if sched["growth_weekly"] else None,
                     "monthly": sched["growth_monthly"].isoformat() if sched["growth_monthly"] else None}}


def overview_row(db: Session, b: Business, today: date | None = None) -> dict[str, Any]:
    from . import growth_metrics
    today = _today(today, b)
    snap = growth_metrics.latest_snapshot(db, b.id)
    snaps = growth_metrics.snapshots(db, b.id, 90)
    old = next((s.presence for s in snaps if s.presence is not None and s.day <= today - timedelta(days=30)), None)
    open_today = db.scalar(select(func.count(GrowthAction.id)).where(GrowthAction.business_id == b.id, GrowthAction.period == "daily", GrowthAction.due_on == today, GrowthAction.status.in_(("todo", "unverified")))) or 0
    at_risk = sum(1 for t in db.scalars(select(GrowthTarget).where(GrowthTarget.business_id == b.id, GrowthTarget.closed_at.is_(None), GrowthTarget.status == "open")) if live_status(t, today) == "at_risk")
    return {"business_id": b.id, "name": b.name, "presence": snap.presence if snap else None, "delta_30d": (snap.presence - old) if (snap and snap.presence is not None and old is not None) else None,
            "actions_today_open": int(open_today), "targets_at_risk": int(at_risk), "updated_at": snap.updated_at.isoformat() if snap and snap.updated_at else None}


def run_job(db: Session, b: Business, job: str) -> None:
    """The scheduler's entry point for the three Growth Plan jobs."""
    {"growth_daily": roll_daily, "growth_weekly": roll_weekly, "growth_monthly": roll_monthly}[job](db, b)


class RateLimit:
    """A limiter for the endpoints that cost real checks, shared by every server process (services/ratelimit.py). `name` must be stable and unique."""

    def __init__(self, limit: int, window: int = 3600, name: str = "growth"):
        from .ratelimit import Hits
        self.limit, self.window, self.hits = limit, window, Hits(name)

    def hit(self, key: Any) -> bool:
        return self.hits.hit(str(key), self.limit, self.window)
