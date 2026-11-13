"""The issue sweep: every problem that exists today in every area of a project's online presence, turned into a fix task that lands on the page where it is fixed.

Sources (all real data, nothing invented):
  - the latest website audits (on-page crawl, technical/Lighthouse): with their age, and a "check first" label when the site is built with JavaScript
  - a Page X-Ray of the homepage as a browser sees it (SEO, AEO and GEO checks, security headers, certificate)
  - the Google Business Profile as it is stored now (profile checklist, reviews waiting for a reply)
  - listings and NAP, tracked searches and Maps visibility, the Business-in-ChatGPT checklist
A stored Google-profile or listing audit is NOT used: those are recomputed from today's data, because an old audit row can say "0 reviews" for a business that has some.

Each issue becomes a GrowthAction with period "fix", due by its severity (critical 3 days, serious 7, warning 14, info 30). A task whose issue stops being reported is
closed as "verified" (the data no longer shows it); a task a person marks done is only verified by a real check (see verify_rule).
"""
import logging
import re
from datetime import date, timedelta
from typing import Any
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, GrowthAction
from . import growth_content, growth_drafts

log = logging.getLogger("seo.growth")

SLA_DAYS = {"critical": 3, "serious": 7, "warning": 14, "info": 30}
ORDER = {"critical": 0, "serious": 1, "warning": 2, "info": 3}
CAPS = {"critical": 99, "serious": 99, "warning": 60, "info": 40}
VERIFY_KINDS = {"audit_issue", "profile_item", "listing", "ranking", "chatgpt_item", "xray_path", "field"} | growth_content.KINDS
AUDIT_KINDS = {"onpage": ("seo", "/website-audit", "On-page audit"), "technical": ("seo", "/website-audit", "Technical audit")}
HOW = {
    "javascript_only": ["Make the page's text part of the HTML the server sends (server-side rendering or pre-rendering), not only built in the browser.",
                        "Check it with View Source: the text should be there without running scripts.", "Why it matters: AI crawlers and many search bots do not run JavaScript, so they see an empty page."],
    "no_localbusiness_schema": ["Add LocalBusiness JSON-LD with name, address, phone, hours and sameAs to the home and contact pages (the ChatGPT module's Profile & Policies page can generate it).", "Test it in Page X-Ray."],
}
PROFILE_LINK = {"reviews": "/gmb-profile/reviews", "rating": "/gmb-profile/reviews", "reply_rate": "/gmb-profile/reviews", "photos": "/media-management", "logo": "/media-management", "cover": "/media-management",
                "posts": "/google-posts", "services": "/gmb-profile/profile?sub=edit&step=services", "prices": "/gmb-profile/profile?sub=edit&step=services", "attributes": "/gmb-profile/profile?sub=edit&step=highlights",
                "secondary_categories": "/gmb-profile/profile?sub=edit&step=details", "category": "/gmb-profile/profile?sub=edit&step=details", "description": "/gmb-profile/profile?sub=edit&step=about",
                "phone": "/gmb-profile/profile?sub=edit&step=contact", "website": "/gmb-profile/profile?sub=edit&step=contact", "hours": "/gmb-profile/profile?sub=hours", "address": "/gmb-profile/profile?sub=edit&step=location"}
CHATGPT_LINK = {"profile": "/chatgpt-business/profile", "policies": "/chatgpt-business/profile", "feed": "/chatgpt-business/feed", "verification": "/chatgpt-business/claim", "persona": "/chatgpt-business/claim",
                "logo": "/chatgpt-business/profile", "jsonld": "/chatgpt-business/profile", "agent": "/chatgpt-business/agent"}
SEC_HEADERS = {"hsts": ("HSTS (Strict-Transport-Security)", "serious"), "csp": ("Content-Security-Policy", "warning"), "x_frame_options": ("X-Frame-Options", "warning"),
               "x_content_type_options": ("X-Content-Type-Options", "warning"), "referrer_policy": ("Referrer-Policy", "info"), "permissions_policy": ("Permissions-Policy", "info")}


def slug(text: str, n: int = 40) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:n] or "x"


def make(key: str, area: str, source: str, severity: str, title: str, why: str, how: list[str], est: int, link: str, verify: dict[str, Any], *, found_at: str | None = None,
         confidence: str = "confirmed", note: str | None = None) -> dict[str, Any]:
    return {"key": ("fix." + key)[:80], "area": area, "source": source, "severity": severity, "title": title[:290], "why": why, "how": how, "est": est, "link": link, "verify": verify,
            "found_at": found_at, "confidence": confidence, "note": note}


def _xray_url(url: str) -> str:
    return f"/page-xray?url={quote(url, safe='')}"


# ------------------------------------------------------------------------------------------------------------------- sources
def _homepage_report(db: Session, b: Business, live: bool) -> tuple[dict[str, Any] | None, str | None]:
    from . import growth_metrics
    report, why = growth_metrics._latest_xray(db, b)
    if report is None and live and (b.website or "").strip():
        report, why = growth_metrics._fresh_xray(db, b)
    return report, why


def _audit_issues(db: Session, b: Business, report: dict[str, Any] | None) -> list[dict[str, Any]]:
    from . import audits
    out: list[dict[str, Any]] = []
    js_built = bool(report and (report.get("rendering") or {}).get("js_required"))
    xray_ok = {c["key"] for g in ((report or {}).get("scores") or {}).values() for c in (g.get("checks") or []) if c.get("passed")} if report else set()
    latest = audits.latest(db, b, with_result=False)
    for kind, (area, link, label) in AUDIT_KINDS.items():
        a = latest.get(kind)
        if a is None or a.status != "done" or a.data_source == "sample":
            continue
        found = a.finished_at.date().isoformat() if getattr(a, "finished_at", None) else None
        groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for i in a.issues or []:
            groups.setdefault((str(i.get("code") or slug(i.get("title", ""))), str(i.get("level") or "warning")), []).append(i)
        for (code, level), items in groups.items():
            first = items[0]
            sev = level if level in ORDER else "warning"
            title = first.get("title", "Issue")
            confidence, note = "confirmed", None
            if len(items) > 1:
                title = f"{title} (and {len(items) - 1} more)"
            if js_built and code != "javascript_only":  # the crawler read plain HTML: the finding may not exist for a browser
                if code == "no_localbusiness_schema" and "org_schema" in xray_ok:
                    continue  # the rendered page has it: not an issue
                confidence, sev, note = "check_first", "info", "The audit crawler reads the plain HTML and this website is built with JavaScript. Confirm in Page X-Ray (Chrome) before fixing."
            why = f"{label}: {first.get('title', '')}" + (f". Also: {'; '.join(x.get('title', '') for x in items[1:4])}" if len(items) > 1 else "") + (f" (audit of {found})" if found else "")
            out.append(make(f"{kind}.{code}", area, f"audit:{kind}", sev, title, why, HOW.get(code) or [first.get("fix") or "Fix the reported problem, then run the audit again."], 30 if sev in ("critical", "serious") else 20, link,
                            {"type": "audit_issue", "kind": kind, "code": code, "title": first.get("title")}, found_at=found, confidence=confidence, note=note))
    return out


def _xray_issues(report: dict[str, Any] | None, url: str) -> list[dict[str, Any]]:
    from .growth_plan import FIX_HOW
    out: list[dict[str, Any]] = []
    if not report:
        return out
    for area in ("seo", "aeo", "geo"):
        for c in ((report.get("scores") or {}).get(area) or {}).get("checks", []):
            if c.get("passed") or c.get("key") == "cert":  # the certificate has its own issue below
                continue
            w = int(c.get("weight") or 1)
            sev = "serious" if w >= 10 else "warning" if w >= 6 else "info"
            title, steps, est = FIX_HOW.get(c["key"], (c.get("label") or c["key"], [c.get("fix") or "Fix it and check the page in Page X-Ray."], 20))
            out.append(make(f"xray.{c['key']}", area, "page_xray", sev, title, f"The live homepage fails “{c.get('label')}”: {c.get('detail') or ''}".strip(), steps, est, _xray_url(url),
                            {"type": "xray_check", "key": c["key"], "area": area, "url": url}, found_at=(report.get("fetched_at") or "")[:10] or None))
    ssl = report.get("ssl") or {}
    days = ssl.get("days_left")
    if isinstance(days, (int, float)) and days < 30:
        out.append(make("security.ssl_expiry", "seo", "page_xray", "critical" if days < 14 else "serious", f"Renew the SSL certificate ({int(days)} days left)",
                        f"The certificate expires in {int(days)} days. Browsers will warn visitors and rankings suffer when it lapses.",
                        ["Renew or reissue the certificate in the hosting panel (most hosts do it automatically when asked).", "Check the new expiry date in Page X-Ray."], 20, _xray_url(url),
                        {"type": "xray_path", "url": url, "path": "ssl.days_left", "op": ">=", "value": 30}))
    headers = ((report.get("tech") or {}).get("security_headers")) or {}
    for k, (label, sev) in SEC_HEADERS.items():
        if k in headers and not headers[k]:
            out.append(make(f"security.{k}", "seo", "page_xray", sev, f"Add the {label} header",
                            f"The website does not send {label}: a basic hardening header.", [f"Add {label} in the server or security plugin settings (it only strengthens security).", "Test the site still works, then check it in Page X-Ray."], 20,
                            _xray_url(url), {"type": "xray_path", "url": url, "path": f"tech.security_headers.{k}", "op": "==", "value": True}))
    return out


def _gbp_issues(db: Session, b: Business) -> list[dict[str, Any]]:
    from . import audits
    from .profile_score import score_profile
    out: list[dict[str, Any]] = []
    stats = audits.profile_stats(db, b)
    r = score_profile(b, stats)
    linked = bool(b.gbp_location and b.connection_id)
    if not linked:
        out.append(make("gbp.connect", "gmb", "gbp", "critical", "Connect the Google Business Profile", "The Google profile is not connected, so its reviews, posts and performance cannot be measured or managed here.",
                        ["Open Google Business Profile and press Connect Google account.", "Choose the account that owns the profile and pick the business.", "Press Sync now."], 10, "/gmb-profile/profile", {"type": "field", "field": "gbp_linked"}))
    for it in r.items:
        if it.get("ok"):
            continue
        w = int(it.get("weight") or 1)
        sev = "serious" if w >= 7 else "warning" if w >= 4 else "info"
        key = it["key"]
        steps = [it.get("fix") or "Improve it on the Google profile."]
        if key in ("reviews", "rating", "reply_rate"):
            steps = [it.get("fix") or "", "Ask real customers, all ratings. Never buy, incentivise or selectively gate reviews.", "Reply to every review, positive or negative, politely."]
        out.append(make(f"gbp.{key}", "gmb", "gbp", sev, it.get("label") or key, f"Google profile checklist: {it.get('label')}. {it.get('fix') or ''}".strip(), [s for s in steps if s], 20, PROFILE_LINK.get(key, "/gmb-profile/profile"),
                        {"type": "profile_item", "key": key}))
    return out


def _listing_issues(db: Session, b: Business) -> list[dict[str, Any]]:
    from ..routers import citations_manage
    out: list[dict[str, Any]] = []
    ov = citations_manage.overview(b, db)
    missing = 0
    for d in ov["directories"]:
        if d.get("managed"):
            continue
        if d["status"] == "inconsistent":
            out.append(make(f"listing.{d['key']}.nap", "local", "listings", "serious", f"Fix the name or phone on {d['label']}", f"{d['label']} shows details that differ from the profile: {d.get('note') or 'name or phone mismatch'}.",
                            ["Open the listing and make the name, address and phone exactly the same as on the Google profile.", "Press Check on the Listing Management page."], 20, "/off-page-seo/citations", {"type": "listing", "key": d["key"]}))
        elif d["status"] == "missing" and missing < 4:
            missing += 1
            out.append(make(f"listing.{d['key']}.add", "local", "listings", "info", f"Add the business to {d['label']}", f"{d['label']} has no listing that we can find. Consistent listings are a local ranking signal.",
                            ["Use the exact name, address and phone from the Google profile.", "Do not create a second listing if one already exists: claim it.", "Save its link on the Listing Management page and press Check."], 25, "/off-page-seo/citations", {"type": "listing", "key": d["key"]}))
    return out


def _ranking_issues(db: Session, b: Business) -> list[dict[str, Any]]:
    from ..routers import seo
    out: list[dict[str, Any]] = []
    pos = seo.current_positions(b, db)
    sm, rows = pos["summary"], pos["rows"]
    if not sm["keywords"]:
        out.append(make("rank.none", "local", "rankings", "serious", "Start tracking the searches your customers use", "No searches are tracked, so rankings cannot be measured or improved.",
                        ["Open Position Tracking and press Start tracking (it adds searches such as “service in your city”).", "Check the rankings once."], 10, "/rank-tracking", {"type": "metric", "metric": "local.keywords_tracked", "op": ">=", "value": 1}))
    elif not sm["checked"]:
        out.append(make("rank.unchecked", "local", "rankings", "warning", "Check where the tracked searches rank today", f"{sm['keywords']} searches are tracked but none has been checked.", ["Press Check rankings now in Position Tracking."], 5, "/rank-tracking",
                        {"type": "job", "job": "rank_check"}))
    else:
        n = 0
        for r in rows:
            if r["checked"] and r["maps"]["checked"] and not r["maps"]["found"] and n < 3:
                n += 1
                out.append(make(f"rank.maps.{slug(r['keyword'])}", "local", "rankings", "warning", f"Not in Google Maps for “{r['keyword']}”", "The business does not appear in the Maps results for this search.",
                                ["Make sure the category and services match the search words.", "Collect real reviews and keep the NAP identical everywhere.", "Post an update that mentions the service and area."], 30, "/rank-tracking/geo",
                                {"type": "ranking", "keyword": r["keyword"]}))
    return out


def _chatgpt_issues(db: Session, b: Business) -> list[dict[str, Any]]:
    from ..models import CatalogItem, ChatGPTBusiness
    from . import chatgpt_business as cg
    out: list[dict[str, Any]] = []
    row = db.scalar(select(ChatGPTBusiness).where(ChatGPTBusiness.business_id == b.id))
    items = list(db.scalars(select(CatalogItem).where(CatalogItem.business_id == b.id)))
    r = cg.readiness(b, row, items)
    for it in r["items"]:
        if it.get("done"):
            continue
        core = bool(it.get("core"))
        out.append(make(f"chatgpt.{it['key']}", "chatgpt", "chatgpt", "warning" if core else "info", it.get("label") or it["key"], f"Business in ChatGPT: {it.get('label')}. {it.get('hint') or ''}".strip(),
                        [it.get("hint") or "Complete it in the ChatGPT module."], 25, CHATGPT_LINK.get(it["key"], "/chatgpt-business/claim"), {"type": "chatgpt_item", "key": it["key"]}))
    return out


# ------------------------------------------------------------------------------------------------------------------- collect and store
def collect(db: Session, b: Business, live: bool = False) -> dict[str, Any]:
    """Every issue found now, best-first, with what could not be checked. Never raises: a source that fails is reported, the rest still count."""
    issues: list[dict[str, Any]] = []
    skipped: list[str] = []
    report, why = _homepage_report(db, b, live) if (b.website or "").strip() else (None, "No website on the project")
    url = (report or {}).get("final_url") or (report or {}).get("url") or (b.website or "")
    for name, fn in (("website audits", lambda: _audit_issues(db, b, report)), ("homepage checks", lambda: _xray_issues(report, url)), ("Google profile", lambda: _gbp_issues(db, b)),
                     ("listings", lambda: _listing_issues(db, b)), ("rankings", lambda: _ranking_issues(db, b)), ("ChatGPT", lambda: _chatgpt_issues(db, b)),
                     ("keywords, content and backlinks", lambda: growth_content.issues(db, b, report))):
        try:
            issues += fn()
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            log.warning("growth issues: %s failed for business %s: %s", name, b.id, exc)
            skipped.append(f"{name}: {str(exc)[:80]}")
    if report is None and why:
        skipped.append(f"homepage checks: {why}")
    seen: set[str] = set()
    unique = []
    for i in sorted(issues, key=lambda x: (ORDER[x["severity"]], x["area"])):
        if i["key"] in seen:
            continue
        seen.add(i["key"])
        unique.append(i)
    counts: dict[str, int] = {}
    capped = []
    for i in unique:
        counts[i["severity"]] = counts.get(i["severity"], 0) + 1
        if counts[i["severity"]] <= CAPS[i["severity"]]:
            capped.append(i)
    return {"issues": capped, "skipped": skipped, "total_found": len(unique), "all_keys": {i["key"] for i in unique}}


def add_issues(db: Session, b: Business, issues: list[dict[str, Any]], today: date) -> int:
    """Create a fix task for each issue that has none yet (open or closed today). Used by steps that find issues outside the sweep."""
    have = {a.key for a in db.scalars(select(GrowthAction).where(GrowthAction.business_id == b.id, GrowthAction.period == "fix", GrowthAction.status.in_(("todo", "done", "unverified", "failed", "blocked", "skipped"))))}
    n = 0
    for i in issues:
        if i["key"] in have:
            continue
        db.add(GrowthAction(business_id=b.id, target_id=None, area=i["area"], key=i["key"], period="fix", due_on=today + timedelta(days=SLA_DAYS[i["severity"]]), title=i["title"], why=i["why"], how=i["how"], est_minutes=i["est"],
                            mode="manual", link=i["link"], verify=i["verify"], status="todo",
                            evidence={"severity": i["severity"], "source": i["source"], "confidence": i["confidence"], "note": i["note"], "found_at": i["found_at"], "first_seen": today.isoformat(), "last_seen": today.isoformat()}))
        n += 1
    db.flush()
    return n


def sweep(db: Session, b: Business, today: date | None = None, live: bool = False) -> dict[str, Any]:
    """Create a fix task for every issue that has none, and close the tasks whose issue is gone. Idempotent. Returns counts and the new critical issues."""
    from . import localtime
    today = today or localtime.today(b)
    found = collect(db, b, live)
    open_states = ("todo", "done", "unverified", "failed", "blocked")
    existing = {a.key: a for a in db.scalars(select(GrowthAction).where(GrowthAction.business_id == b.id, GrowthAction.period == "fix", GrowthAction.status.in_(open_states + ("skipped",))))}  # a skipped issue stays skipped while it is still reported: a person's decision is not undone by the next scan
    keys_now = found.get("all_keys") or {i["key"] for i in found["issues"]}  # a task is closed only when its issue is really gone, never because the list was capped
    created, new_critical = 0, []
    for i in found["issues"]:
        row = existing.get(i["key"])
        if row is not None:  # still reported: keep the task, refresh its text and severity
            row.title, row.why, row.how, row.link, row.verify = i["title"], i["why"], i["how"], i["link"], i["verify"]
            ev = dict(row.evidence or {})
            ev.update({"severity": i["severity"], "source": i["source"], "confidence": i["confidence"], "note": i["note"], "found_at": i["found_at"], "last_seen": today.isoformat()})
            row.evidence = ev
            db.add(row)
            continue
        db.add(GrowthAction(business_id=b.id, target_id=None, area=i["area"], key=i["key"], period="fix", due_on=today + timedelta(days=SLA_DAYS[i["severity"]]), title=i["title"], why=i["why"], how=i["how"],
                            est_minutes=i["est"], mode="manual", link=i["link"], verify=i["verify"], status="todo",
                            evidence={"severity": i["severity"], "source": i["source"], "confidence": i["confidence"], "note": i["note"], "found_at": i["found_at"], "first_seen": today.isoformat(), "last_seen": today.isoformat()}))
        created += 1
        if i["severity"] == "critical":
            new_critical.append(i["title"])
    closed = 0
    if not found["skipped"]:  # a source that failed is not "the issue went away"
        from .growth_plan import _now
        for key, row in existing.items():
            if key not in keys_now and row.status in ("todo", "unverified", "failed") and not key.startswith("fix.bl.prospect."):  # prospects are closed by their own link check
                row.status, row.verified_at = "verified", _now()
                row.evidence = {**(row.evidence or {}), "passed": True, "details": "The issue is no longer reported by the latest data.", "checked_at": _now().isoformat()}
                db.add(row)
                closed += 1
    db.flush()
    return {"found": found["total_found"], "created": created, "closed": closed, "skipped": found["skipped"], "new_critical": new_critical}


# ------------------------------------------------------------------------------------------------------------------- verification of fix tasks
def _walk(d: Any, path: str) -> Any:
    for part in path.split("."):
        d = d.get(part) if isinstance(d, dict) else None
    return d


def _cmp(op: str, a: Any, b: Any) -> bool:
    try:
        return {">=": a >= b, "<=": a <= b, "==": a == b, ">": a > b, "<": a < b}[op]
    except TypeError:
        return False


def verify_rule(db: Session, b: Business, rule: dict[str, Any], ctx: Any, today: date) -> dict[str, Any]:
    """The real check behind a fix task. Returns growth_plan's result dict: passed True/False, or None when it cannot be decided right now."""
    from .growth_plan import _result
    kind = rule.get("type")
    if kind in growth_content.KINDS:
        return growth_content.verify(db, b, rule, ctx, today)
    if kind == "xray_path":
        rep = ctx.xray(rule["url"])
        v = _walk(rep, rule["path"])
        if v is None:
            return _result(None, "The page did not report this value.")
        ok = _cmp(rule.get("op", "=="), v, rule["value"])
        return _result(ok, f"{rule['path']} is {v}; needs {rule.get('op', '==')} {rule['value']}." + ("" if ok else " Not there yet."), None, v)
    if kind == "audit_issue":
        from . import audits
        run = audits.run(db, b, rule["kind"])
        if getattr(run, "status", "done") != "done":
            return _result(None, "The audit did not finish: it will be checked again.")
        still = [i for i in (run.issues or []) if str(i.get("code") or slug(i.get("title", ""))) == rule["code"]]
        return _result(not still, f"The new {rule['kind']} audit no longer reports it." if not still else f"The new audit still reports it ({len(still)} place{'s' if len(still) != 1 else ''}): {still[0].get('title')}.", len(still) or None, len(still))
    if kind == "profile_item":
        if b.gbp_location and b.connection_id:
            try:
                from . import gbp
                gbp.sync_business(db, b)
            except Exception as exc:  # noqa: BLE001 - a failed sync is not a pass
                log.info("growth: sync before profile check failed: %s", exc)
        from . import audits
        from .profile_score import score_profile
        it = next((x for x in score_profile(b, audits.profile_stats(db, b)).items if x["key"] == rule["key"]), None)
        if it is None:
            return _result(None, "That checklist item no longer exists.")
        return _result(bool(it.get("ok")), "The profile checklist now passes this item." if it.get("ok") else f"Still failing: {it.get('label')}.", None, it.get("label"))
    if kind == "field":
        if rule["field"] == "gbp_linked":
            ok = bool(b.gbp_location and b.connection_id)
            return _result(ok, "The Google profile is connected." if ok else "The Google profile is still not connected.")
        v = getattr(b, rule["field"], None)
        return _result(bool(v), f"{rule['field']} is set." if v else f"{rule['field']} is still empty.")
    if kind == "listing":
        from ..routers import citations_manage
        row = next((d for d in citations_manage.overview(b, db)["directories"] if d["key"] == rule["key"]), None)
        ok = bool(row) and row["status"] == "listed"
        return _result(ok, "The listing is checked and matches the profile." if ok else "The listing is not confirmed yet: save its link and press Check on the Listing Management page.", None, row["status"] if row else None)
    if kind == "ranking":
        from ..routers import seo
        row = next((r for r in seo.current_positions(b, db)["rows"] if r["keyword"] == rule["keyword"]), None)
        ok = bool(row and row["maps"]["found"])
        return _result(ok, "The business now appears in Google Maps for this search." if ok else "Still not in the Maps results at the last check: run Check rankings now.", None, (row or {}).get("maps", {}).get("position"))
    if kind == "chatgpt_item":
        from ..models import CatalogItem, ChatGPTBusiness
        from . import chatgpt_business as cg
        row = db.scalar(select(ChatGPTBusiness).where(ChatGPTBusiness.business_id == b.id))
        r = cg.readiness(b, row, list(db.scalars(select(CatalogItem).where(CatalogItem.business_id == b.id))))
        it = next((x for x in r["items"] if x["key"] == rule["key"]), None)
        ok = bool(it and it.get("done"))
        return _result(ok, "This ChatGPT checklist item is done." if ok else f"Not done yet: {(it or {}).get('hint') or rule['key']}", None, ok)
    return _result(None, "This task has no automatic check.")


# ------------------------------------------------------------------------------------------------------------------- what the page reads
SOURCE_LABEL = {"audit:onpage": "Website audit (on-page crawl)", "audit:technical": "Website audit (technical)", "page_xray": "Page X-Ray of the live homepage", "gbp": "Google profile checklist",
                "listings": "Listing Management (NAP check)", "rankings": "Position Tracking (Google and Maps)", "chatgpt": "Business in ChatGPT checklist", "keywords": "Keyword Management and your content", "competitors": "Competitor research", "backlinks": "Backlink Intelligence (our crawler)",
                "content": "Blog and content"}


def closes_when(rule: dict[str, Any]) -> str:
    """The real check behind a fix task, in plain words."""
    k = rule.get("type")
    if k == "audit_issue":
        return f"A fresh {rule.get('kind')} audit no longer reports “{rule.get('title') or rule.get('code')}”."
    if k == "xray_path":
        path = str(rule.get("path", ""))
        if path == "ssl.days_left":
            return f"The live certificate has at least {rule.get('value')} days left."
        if path.startswith("tech.security_headers."):
            return f"The live homepage sends the {path.rsplit('.', 1)[1].replace('_', '-')} header."
        return f"The live page reports {path} {rule.get('op', '==')} {rule.get('value')}."
    if k == "xray_check":
        return "The check passes when Page X-Ray reads the live homepage again."
    if k == "profile_item":
        return "After a fresh Google sync, this item of the profile checklist passes."
    if k == "field":
        return "The Google profile is connected to this project." if rule.get("field") == "gbp_linked" else f"The project's {rule.get('field')} is filled in."
    if k == "listing":
        return "The listing is found, and its name and phone match the Google profile (press Check on Listing Management)."
    if k == "ranking":
        return f"The business appears in the Google Maps results for “{rule.get('keyword')}” at the next rank check."
    if k == "chatgpt_item":
        return "The item is complete in the Business-in-ChatGPT checklist."
    texts = {"kw_count": f"At least {rule.get('min')} keywords are tracked.", "kw_grouped": "Every tracked keyword belongs to a topic group.", "kw_targets": "Every tracked keyword has a target page.",
             "kw_gap": "The competitor keywords listed are added to your tracked keywords.", "kw_terms": "The words your website uses appear in your tracked keywords.", "competitors_clean": "Every saved competitor is a real competitor website.", "kw_used": "The keywords listed now appear in that place (checked from your real pages, posts and articles).",
             "audit_probe": "A fresh site crawl no longer shows this problem.", "backlinks": f"The tracked website has at least {rule.get('min')} referring domains.", "articles_since": "An article has been written in the last 30 days.",
             "articles_meta": "Every article has a meta description.", "competitors_done": "A competitor research run has finished.", "bl_prospect": "Our crawler finds a link from that website to yours."}
    if k in texts:
        return texts[k]
    if k == "metric":
        return f"{rule.get('metric')} reaches {rule.get('op')} {rule.get('value')}."
    if k == "job":
        return "A rank check has run today."
    return "A person confirms it and the data agrees."


def listing(db: Session, b: Business, today: date | None = None) -> dict[str, Any]:
    """The fix tasks as the Issues page shows them: open ones by severity then due date, and the ones closed in the last 30 days."""
    from . import localtime
    from .growth_plan import _action_out
    today = today or localtime.today(b)
    rows = list(db.scalars(select(GrowthAction).where(GrowthAction.business_id == b.id, GrowthAction.period == "fix")))
    def item(a: GrowthAction) -> dict[str, Any]:
        ev = a.evidence or {}
        return {**_action_out(a), "severity": ev.get("severity", "warning"), "source": ev.get("source"), "confidence": ev.get("confidence", "confirmed"), "note_check": ev.get("note"),
                "found_at": ev.get("found_at"), "first_seen": ev.get("first_seen"), "source_label": SOURCE_LABEL.get(ev.get("source"), ev.get("source")), "closes_when": closes_when(a.verify or {}),
                "last_check": ev.get("details"), "checked_at": ev.get("checked_at"), "draft_kind": growth_drafts.kind_of(a), "draft": ev.get("draft"), "overdue": a.due_on < today and a.status not in ("verified", "skipped")}
    open_rows = sorted([item(a) for a in rows if a.status in ("todo", "done", "unverified", "failed", "blocked")], key=lambda x: (ORDER.get(x["severity"], 9), x["due_on"]))
    since = today - timedelta(days=30)
    closed = sorted([item(a) for a in rows if a.status == "verified" and a.verified_at and a.verified_at.date() >= since], key=lambda x: x["verified_at"], reverse=True)
    counts = {k: sum(1 for x in open_rows if x["severity"] == k) for k in ORDER}
    areas: dict[str, int] = {}
    for x in open_rows:
        areas[x["area"]] = areas.get(x["area"], 0) + 1
    return {"open": open_rows, "closed": closed[:30], "counts": counts, "open_total": len(open_rows), "overdue": sum(1 for x in open_rows if x["overdue"]), "by_area": areas,
            "scanned_at": max((a.evidence or {}).get("last_seen", "") for a in rows) or None if rows else None}
