"""Growth Plan measurements: where a project's online presence stands right now, in numbers read from the system.

Every metric comes from stored or live data and says where it came from. A metric that cannot be measured is `value: None, available: False` with a
reason, never 0 and never an estimate. Six areas (Google profile, local SEO and listings, website SEO and security, answer-engine readiness, AI-search
readiness, Business in ChatGPT) each get a score when they can be measured; the overall `presence` is the weighted average of the areas that were measured.

measure() -> {"at", "metrics": {key: {value, unit, area, source, available, reason}}, "areas": {area: {score, state, blockers}}, "presence", "weights"}
The website-page figures (SEO/AEO/GEO checks, security headers, SSL) come from a Page X-Ray of the project's OWN homepage: a saved run younger than 24 hours
is reused; otherwise it is run live only when asked (live=True). No other address is ever fetched.
"""
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Business, CatalogItem, ChatGPTBusiness, GrowthSnapshot, InsightDay, PageXRayRun, Post, Review

log = logging.getLogger("seo.growth")

AREA_LABELS = {"gmb": "Google Business Profile", "local": "Local SEO & listings", "seo": "Website SEO & security", "aeo": "Answer-engine readiness (AEO)",
               "geo": "AI-search readiness (GEO)", "chatgpt": "Business in ChatGPT"}
WEIGHTS = {"gmb": 30, "local": 15, "seo": 20, "aeo": 10, "geo": 15, "chatgpt": 10}
XRAY_MAX_AGE = timedelta(hours=24)
SOV_BLEND = 0.3  # the AI share of voice counts 30% of the GEO area score when real engine answers exist; the website readiness is the other 70%
WEBSITE_KEYS = ("seo.xray_seo", "seo.security_headers", "seo.ssl_days_left", "aeo.score", "aeo.faq_schema", "aeo.direct_answer", "geo.score", "geo.ai_bots_allowed", "geo.llms_txt", "geo.org_schema")
NO_XRAY = "No recent Page X-Ray of the website: run it, or refresh the plan"
UNITS = {
    "gmb.reviews_total": ("count", "gmb"), "gmb.rating": ("stars", "gmb"), "gmb.reviews_30d": ("count", "gmb"), "gmb.reply_rate": ("%", "gmb"), "gmb.unanswered": ("count", "gmb"),
    "gmb.photos_total": ("count", "gmb"), "gmb.posts_30d": ("count", "gmb"), "gmb.profile_score": ("score", "gmb"), "gmb.verified": ("0/1", "gmb"), "gmb.completeness": ("%", "gmb"),
    "gmb.views_30d": ("count", "gmb"), "gmb.calls_30d": ("count", "gmb"), "gmb.directions_30d": ("count", "gmb"), "gmb.website_clicks_30d": ("count", "gmb"),
    "local.score": ("score", "local"), "local.citations_verified": ("count", "local"), "local.citations_listed": ("count", "local"), "local.maps_top3": ("count", "local"),
    "local.keywords_tracked": ("count", "local"), "local.keywords_page1": ("count", "local"),
    "seo.onpage_score": ("score", "seo"), "seo.technical_score": ("score", "seo"), "seo.audit_issues": ("count", "seo"), "seo.ssl_days_left": ("days", "seo"),
    "seo.security_headers": ("of 6", "seo"), "seo.xray_seo": ("score", "seo"),
    "aeo.score": ("score", "aeo"), "aeo.faq_schema": ("0/1", "aeo"), "aeo.direct_answer": ("0/1", "aeo"),
    "geo.score": ("score", "geo"), "geo.ai_bots_allowed": ("of 7", "geo"), "geo.llms_txt": ("0/1", "geo"), "geo.org_schema": ("0/1", "geo"), "geo.share_of_voice": ("%", "geo"),
    "chatgpt.readiness": ("score", "chatgpt"), "chatgpt.claim": ("level", "chatgpt"), "chatgpt.catalog_items": ("count", "chatgpt"),
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _metric(value: Any, source: str, key: str, reason: str | None = None) -> dict[str, Any]:
    unit, area = UNITS[key]
    ok = value is not None
    return {"value": value, "unit": unit, "area": area, "source": source, "available": ok, "reason": None if ok and reason is None else reason}


class _Out:
    """Collects the metrics of one measurement."""

    def __init__(self) -> None:
        self.m: dict[str, dict[str, Any]] = {}

    def put(self, key: str, value: Any, source: str, reason: str | None = None) -> None:
        if value is None and not reason:
            reason = "Not measured yet"
        self.m[key] = _metric(value, source, key, reason)

    def get(self, key: str) -> float | None:
        v = self.m.get(key, {}).get("value")
        return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None

    def why(self, key: str) -> str | None:
        return self.m.get(key, {}).get("reason")


def metric(data: dict[str, Any], key: str) -> float | None:
    """The value of one metric from a measure() result or a stored snapshot's metrics; None when it was not measured."""
    m = (data.get("metrics") if "metrics" in data else data).get(key) if isinstance(data, dict) else None
    v = m.get("value") if isinstance(m, dict) else None
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


# ---------------------------------------------------------------------------------------------------- Google profile
def _linked(b: Business) -> bool:
    return bool(b.gbp_location and b.connection_id)


def _completeness(b: Business) -> int:
    checks = [bool((b.name or "").strip()), bool((b.primary_category or "").strip()), bool((b.phone or "").strip()), bool((b.website or "").strip()),
              len((b.description or "").strip()) >= 250, bool((b.hours or {}).get("periods")), bool((b.address or "").strip()), any((s or {}).get("name") for s in (b.services or [])),
              bool(b.attributes), bool((b.logo or "").strip()), bool((b.cover_photo or "").strip())]
    return round(sum(checks) / len(checks) * 100)


def _gmb(db: Session, b: Business, o: _Out) -> dict[str, Any]:
    from . import audits
    from .profile_score import score_profile
    linked = _linked(b)
    need = "Connect the Google account to measure the profile"
    now = _now()
    since = now - timedelta(days=30)
    rows = list(db.scalars(select(Review).where(Review.business_id == b.id)))
    n = len(rows)

    o.put("gmb.reviews_total", b.review_count, "google_business_profile", None if b.review_count is not None else (need if not linked else "Reviews have not been read from Google yet: press Sync now"))
    o.put("gmb.rating", b.rating, "google_business_profile", None if b.rating is not None else ("No rating yet: the profile has no reviews on Google" if linked else need))
    recent = sum(1 for r in rows if (_aware(r.review_at) or (datetime.combine(r.review_date, datetime.min.time(), tzinfo=timezone.utc) if r.review_date else None) or now - timedelta(days=9999)) >= since)
    if not linked and not n:
        o.put("gmb.reviews_30d", None, "google_business_profile", need)
    else:
        o.put("gmb.reviews_30d", recent, "google_business_profile", f"Google counts {b.review_count} reviews but only {n} have been read" if (b.review_count or 0) > n else None)
    if n:
        replied = sum(1 for r in rows if r.reply_status == "posted")
        o.put("gmb.reply_rate", round(replied / n * 100), "google_business_profile")
        o.put("gmb.unanswered", n - replied, "google_business_profile")
    else:
        why = "No reviews have been read yet" if linked else need
        o.put("gmb.reply_rate", None, "google_business_profile", why)
        o.put("gmb.unanswered", 0 if b.review_count == 0 else None, "google_business_profile", None if b.review_count == 0 else why)
    o.put("gmb.photos_total", b.photo_count, "google_business_profile", None if b.photo_count is not None else (need if not linked else "Photos have not been counted yet: press Sync now"))

    posts = {p.external_id for p in db.scalars(select(Post).where(Post.business_id == b.id, Post.status == "published", Post.published_at >= since)) if p.external_id}
    n_posts = db.scalar(select(func.count(Post.id)).where(Post.business_id == b.id, Post.status == "published", Post.published_at >= since)) or 0
    live = ((b.gbp_status or {}).get("live") or {}).get("posts") or []
    for p in live:
        created = None
        try:
            created = datetime.fromisoformat(str(p.get("created") or "").replace("Z", "+00:00"))
        except ValueError:
            pass
        if created and _aware(created) >= since and p.get("id") not in posts:
            posts.add(p.get("id"))
            n_posts += 1
    o.put("gmb.posts_30d", n_posts if (linked or n_posts) else None, "google_business_profile", None if (linked or n_posts) else need)

    result = score_profile(b, audits.profile_stats(db, b))
    o.put("gmb.profile_score", result.score, "calculated")
    o.put("gmb.verified", (1 if b.verification == "verified" else 0) if linked else None, "google_business_profile", None if linked else need)
    o.put("gmb.completeness", _completeness(b), "calculated")

    days = list(db.scalars(select(InsightDay).where(InsightDay.business_id == b.id, InsightDay.day >= date.today() - timedelta(days=30))))
    if not linked or not days:
        why = need if not linked else "No performance data has been read yet: press Sync now"
        for k in ("views_30d", "calls_30d", "directions_30d", "website_clicks_30d"):
            o.put(f"gmb.{k}", None, "google_business_profile", why)
    else:
        o.put("gmb.views_30d", sum((d.views_search or 0) + (d.views_maps or 0) for d in days), "google_business_profile")
        o.put("gmb.calls_30d", sum(d.calls or 0 for d in days), "google_business_profile")
        o.put("gmb.directions_30d", sum(d.directions or 0 for d in days), "google_business_profile")
        o.put("gmb.website_clicks_30d", sum(d.website_clicks or 0 for d in days), "google_business_profile")

    if not linked:
        return {"score": None, "state": "blocked", "blockers": [need]}
    from ..routers.gbp_local_seo import _reviews_score
    reviews = _reviews_score(b.rating, int(b.review_count or 0))
    return {"score": round((result.score + reviews) / 2), "state": "measured", "blockers": []}


# ---------------------------------------------------------------------------------------------------- local SEO and listings
def _local(db: Session, b: Business, o: _Out) -> dict[str, Any]:
    from ..routers import citations_manage, gbp_local_seo
    built = gbp_local_seo.build(b, db)
    o.put("local.score", built.get("score"), "calculated", None if built.get("score") is not None else "Nothing to score yet")
    summary = citations_manage.overview(b, db)["summary"]
    o.put("local.citations_verified", summary.get("verified", 0), "calculated")
    o.put("local.citations_listed", summary.get("listed", 0), "calculated")
    pos = (built.get("positions") or {}).get("summary") or {}
    tracked = int(pos.get("keywords") or 0)
    checked = int(pos.get("checked") or 0)
    o.put("local.keywords_tracked", tracked, "google")
    why = "Track at least one search" if not tracked else "No rank check has run yet: use Check rankings now"
    o.put("local.maps_top3", int(pos.get("in_pack") or 0) if checked else None, "google", None if checked else why)
    o.put("local.keywords_page1", int(pos.get("page1") or 0) if checked else None, "google", None if checked else why)
    if built.get("score") is None:
        return {"score": None, "state": "blocked", "blockers": ["Nothing in this area can be scored yet"]}
    return {"score": int(built["score"]), "state": "measured", "blockers": [] if tracked else ["Track at least one search to include rankings in this score"]}


# ---------------------------------------------------------------------------------------------------- website (audits and a Page X-Ray of the homepage)
def trustworthy_report(report: dict[str, Any] | None) -> bool:
    """A saved X-Ray may feed the plan only when it shows the real page: it was read by Chrome, or the plain HTML already has real content. A plain read that found almost
    no text is a page built by JavaScript (or a failed read): every check would fail for the wrong reason, so it is read again instead of being trusted."""
    if not isinstance(report, dict) or not report.get("scores"):
        return False
    if ((report.get("rendering") or {}).get("mode")) == "chrome":
        return True
    return int(((report.get("content") or {}).get("word_count")) or 0) >= 100


def _latest_xray(db: Session, b: Business) -> tuple[dict[str, Any] | None, str | None]:
    """(report, why not): the newest saved X-Ray of the project's homepage that is under 24 hours old."""
    from . import page_xray
    if not (b.website or "").strip():
        return None, "No website on the project"
    try:
        url = page_xray.normalise_url(b.website)
    except Exception:  # noqa: BLE001
        return None, "The project's website address is not valid"
    since = _now() - XRAY_MAX_AGE
    runs = list(db.scalars(select(PageXRayRun).where(PageXRayRun.business_id == b.id, PageXRayRun.created_at >= since).order_by(PageXRayRun.created_at.desc()).limit(25)))
    for r in runs:
        try:
            same = page_xray.normalise_url(r.url) == url
        except Exception:  # noqa: BLE001
            same = r.url == url
        if same and trustworthy_report(r.report):
            return r.report, None
    return None, NO_XRAY


def read_own_page(url: str, website: str | None) -> dict[str, Any]:
    """A Page X-Ray of the project's OWN page, read the way a browser sees it (headless Chrome runs the page's JavaScript first). A site built by JavaScript looks empty
    to a plain read and every check would fail for the wrong reason. When Chrome cannot be used the plain read is used (the report says so in `rendering`)."""
    from . import page_xray
    try:
        return page_xray.run(url, render=True, own_site=website)
    except Exception as exc:  # noqa: BLE001 - Chrome missing, a redirect off the site, a timeout: the plain read is still real data
        log.info("growth: rendered X-Ray not possible (%s); using the plain read", str(exc)[:100])
        return page_xray.run(url)


def _fresh_xray(db: Session, b: Business) -> tuple[dict[str, Any] | None, str | None]:
    """Run a Page X-Ray of the project's own homepage now (and keep it in the history so the next measurement can reuse it)."""
    from . import page_xray, page_xray_history
    try:
        url = page_xray.normalise_url(b.website)
        report = read_own_page(url, b.website)
    except Exception as exc:  # noqa: BLE001 - a blocked or unreachable page is a reason, not a crash
        return None, f"The website could not be read: {str(exc)[:120]}"
    try:
        page_xray_history.save_run(db, b, report, "server")
    except Exception as exc:  # noqa: BLE001 - saving is a convenience
        log.info("growth: could not save the X-Ray run: %s", exc)
        db.rollback()
    return report, None


def _check_passed(report: dict[str, Any], area: str, key: str) -> int | None:
    for c in ((report.get("scores") or {}).get(area) or {}).get("checks", []):
        if isinstance(c, dict) and c.get("key") == key:
            return 1 if c.get("passed") else 0
    return None


def _website(db: Session, b: Business, o: _Out, live: bool) -> dict[str, Any]:
    from . import audits
    latest = audits.latest(db, b, with_result=False)
    for kind, key in (("onpage", "seo.onpage_score"), ("technical", "seo.technical_score")):
        a = latest.get(kind)
        if a is not None and a.score is not None and a.data_source != "sample":
            o.put(key, a.score, "audit")
        else:
            o.put(key, None, "audit", "No website" if not (b.website or "").strip() else f"The {'on-page' if kind == 'onpage' else 'technical'} audit has not run yet: use Site Audit")
    on = latest.get("onpage")
    o.put("seo.audit_issues", len(on.issues or []) if on is not None and on.score is not None and on.data_source != "sample" else None, "audit",
          None if on is not None and on.score is not None and on.data_source != "sample" else "The on-page audit has not run yet: use Site Audit")

    report, why = _latest_xray(db, b)
    if report is None and live and (b.website or "").strip():
        report, why = _fresh_xray(db, b)
    if report is None:
        for k in WEBSITE_KEYS:
            o.put(k, None, "page_xray", why or NO_XRAY)
    else:
        sc = report.get("scores") or {}
        sec = ((report.get("tech") or {}).get("security_headers")) or {}
        ssl = report.get("ssl") or {}
        bots = ((report.get("robots") or {}).get("ai_crawlers")) or []
        o.put("seo.xray_seo", (sc.get("seo") or {}).get("score"), "page_xray")
        o.put("seo.security_headers", sum(1 for v in sec.values() if v) if sec else None, "page_xray", None if sec else "The security headers were not read")
        o.put("seo.ssl_days_left", ssl.get("days_left"), "page_xray", None if ssl.get("days_left") is not None else (ssl.get("error") or "The certificate was not read"))
        o.put("aeo.score", (sc.get("aeo") or {}).get("score"), "page_xray")
        o.put("aeo.faq_schema", _check_passed(report, "aeo", "faq_schema"), "page_xray", "The check was not part of this report")
        o.put("aeo.direct_answer", _check_passed(report, "aeo", "direct_answer"), "page_xray", "The check was not part of this report")
        o.put("geo.score", (sc.get("geo") or {}).get("score"), "page_xray")
        o.put("geo.ai_bots_allowed", sum(1 for x in bots if x.get("allowed") is True) if bots else None, "page_xray", None if bots else "robots.txt was not read")
        o.put("geo.llms_txt", (1 if (report.get("llms_txt") or {}).get("found") else 0) if (report.get("llms_txt") or {}).get("found") is not None else None, "page_xray", "llms.txt was not checked")
        o.put("geo.org_schema", _check_passed(report, "geo", "org_schema"), "page_xray", "The check was not part of this report")

    # share of voice: only answers that a real AI engine gave
    sov, sov_why = None, "No AI engine is connected"
    try:
        from . import geo
        if any(e.get("connected") for e in geo.engine_status()):
            r = geo.share_of_voice(db, b)
            if r.get("per_engine") and r.get("data_source") != "sample":
                sov = r.get("overall")
            else:
                sov_why = "No AI-visibility check has run yet"
    except Exception as exc:  # noqa: BLE001
        sov_why = f"AI visibility could not be read: {str(exc)[:100]}"
    o.put("geo.share_of_voice", sov, "ai_engines", sov_why if sov is None else None)

    parts = [v for v in (o.get("seo.onpage_score"), o.get("seo.technical_score")) if v is not None]
    if o.get("seo.security_headers") is not None:
        parts.append(o.get("seo.security_headers") / 6 * 100)
    if o.get("seo.ssl_days_left") is not None:
        parts.append(100 if o.get("seo.ssl_days_left") >= 30 else max(0, o.get("seo.ssl_days_left")) / 30 * 100)
    no_site = not (b.website or "").strip()
    if parts:
        seo = {"score": round(sum(parts) / len(parts)), "state": "measured", "blockers": []}
    else:
        seo = {"score": None, "state": "blocked", "blockers": ["No website on the project"] if no_site else ["Run a Site Audit or a Page X-Ray of the website"]}
    if o.get("aeo.score") is not None:
        aeo = {"score": int(o.get("aeo.score")), "state": "measured", "blockers": []}
    else:
        aeo = {"score": None, "state": "blocked", "blockers": [o.why("aeo.score") or NO_XRAY]}
    if o.get("geo.score") is not None:
        g = o.get("geo.score")
        sov_v = o.get("geo.share_of_voice")
        geo_score = round(g * (1 - SOV_BLEND) + sov_v * SOV_BLEND) if sov_v is not None else round(g)
        geo_area = {"score": int(geo_score), "state": "measured", "blockers": []}
    else:
        geo_area = {"score": None, "state": "blocked", "blockers": [o.why("geo.score") or NO_XRAY]}
    return {"seo": seo, "aeo": aeo, "geo": geo_area}


# ---------------------------------------------------------------------------------------------------- Business in ChatGPT
CLAIM_LEVEL = {"Unclaimed": 0, "Claim_Pending": 1, "Claim_Approved": 2, "Disputed": -1}


def _chatgpt(db: Session, b: Business, o: _Out) -> dict[str, Any]:
    from . import chatgpt_business
    row = db.scalar(select(ChatGPTBusiness).where(ChatGPTBusiness.business_id == b.id))
    items = list(db.scalars(select(CatalogItem).where(CatalogItem.business_id == b.id)))
    claim = row.claim_status if row else "Unclaimed"
    level = CLAIM_LEVEL.get(claim, 0)
    if claim == "Claim_Approved" and row and row.persona_verified:
        level = 3
    saved = bool(row and any((getattr(row, k) or "").strip() for k in ("business_name", "category", "description", "website_url", "logo_url", "delivery_policy", "return_policy", "agent_instructions")))
    started = claim != "Unclaimed" or bool(items) or saved
    ready = chatgpt_business.readiness(b, row, items)["score"]
    o.put("chatgpt.readiness", ready, "chatgpt_hub")
    o.put("chatgpt.claim", level, "chatgpt_hub")
    o.put("chatgpt.catalog_items", len(items), "chatgpt_hub")
    if not started:
        return {"score": None, "state": "not_started", "blockers": ["Not started: claim the business in ChatGPT Business Hub and fill in the profile"]}
    return {"score": int(ready), "state": "measured", "blockers": []}


# ---------------------------------------------------------------------------------------------------- the whole measurement
def measure(db: Session, b: Business, live: bool = False) -> dict[str, Any]:
    """Measure the project. live=False reads only what is already stored (no network); live=True may run a Page X-Ray of the project's own homepage."""
    o = _Out()
    areas: dict[str, dict[str, Any]] = {}
    for name, fn in (("gmb", _gmb), ("local", _local), ("chatgpt", _chatgpt)):
        try:
            areas[name] = fn(db, b, o)
        except Exception as exc:  # noqa: BLE001 - one area failing must not lose the others
            log.warning("growth: %s could not be measured for business %s: %s", name, b.id, exc)
            db.rollback()
            areas[name] = {"score": None, "state": "blocked", "blockers": [f"Could not be measured: {str(exc)[:120]}"]}
    try:
        areas.update(_website(db, b, o, live))
    except Exception as exc:  # noqa: BLE001
        log.warning("growth: the website could not be measured for business %s: %s", b.id, exc)
        db.rollback()
        for a in ("seo", "aeo", "geo"):
            areas[a] = {"score": None, "state": "blocked", "blockers": [f"Could not be measured: {str(exc)[:120]}"]}
    for key in UNITS:  # every key is always present, so a reader never has to guess
        o.m.setdefault(key, _metric(None, "calculated", key, "Not measured"))
    counted = {a: v["score"] for a, v in areas.items() if v["state"] == "measured" and v["score"] is not None}
    total = sum(WEIGHTS[a] for a in counted)
    presence = round(sum(WEIGHTS[a] * s for a, s in counted.items()) / total) if total else None
    return {"at": _now().isoformat(), "metrics": o.m, "areas": {a: areas[a] for a in WEIGHTS}, "presence": presence, "weights": dict(WEIGHTS)}


# ---------------------------------------------------------------------------------------------------- snapshots
def save_snapshot(db: Session, b: Business, data: dict[str, Any], source: str = "daily") -> GrowthSnapshot:
    """Keep this measurement as today's snapshot (a second one on the same day replaces the first)."""
    if source not in ("daily", "manual", "onboarding"):
        source = "manual"
    from . import localtime
    today = localtime.today(b)  # the project's own day: its snapshots, targets and reports all use the same calendar
    row = db.scalar(select(GrowthSnapshot).where(GrowthSnapshot.business_id == b.id, GrowthSnapshot.day == today))
    if row is None:
        row = GrowthSnapshot(business_id=b.id, day=today)
        db.add(row)
    row.metrics = data["metrics"]
    row.areas = {a: v.get("score") for a, v in data["areas"].items()}
    row.presence = data.get("presence")
    row.source = source
    db.flush()
    db.commit()
    return row


def latest_snapshot(db: Session, business_id: int) -> GrowthSnapshot | None:
    return db.scalar(select(GrowthSnapshot).where(GrowthSnapshot.business_id == business_id).order_by(GrowthSnapshot.day.desc()).limit(1))


def snapshots(db: Session, business_id: int, days: int = 90) -> list[GrowthSnapshot]:
    since = _now().date() - timedelta(days=max(1, min(int(days), 3650)))
    return list(db.scalars(select(GrowthSnapshot).where(GrowthSnapshot.business_id == business_id, GrowthSnapshot.day >= since).order_by(GrowthSnapshot.day.asc())))
