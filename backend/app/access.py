"""The access checklist of one project: what must be in place before its website traffic and its Google Business Profile data are shown.

Website data needs: a website, a Google account linked to the project and still connected, the Analytics and Search Console permissions, a
Google Analytics 4 property for the site that the account can open, and the site verified in Search Console.
Google Business Profile data needs: the linked Google account, its Business Profile permission, and a Business Profile linked to the project.

`evaluate()` builds the checklist (GET /businesses/{id}/access-status); `require()` is what the data endpoints call, so the data cannot be
fetched by calling the API directly while a step is open. The two Google look-ups (Analytics property, Search Console property) cost API
calls, so their answers are remembered for a few minutes (a short time when they failed, so a fix shows up quickly); `refresh=True` skips that.
"""
import threading
import time
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .auth import User
from .conn_access import only_my_connections
from .models import Business, GoogleConnection
from .services import ga4, gbp, gsc

TTL_OK = 600  # a look-up that succeeded
TTL_NO = 45   # one that did not: a fix (connect, verify) should show up soon
_cache: dict[tuple, tuple[float, dict]] = {}
_lock = threading.Lock()

BAD_LISTING = {"suspended": "The listing is suspended by Google.", "disabled": "The listing is disabled by Google.", "conflict": "Google found an ownership conflict on this listing."}


def forget(business_id: int | None = None) -> None:
    """Drop the remembered Google look-ups (all, or those of one project's account) after a link / unlink / reconnect."""
    with _lock:
        _cache.clear()


def _remembered(key: tuple, fn, refresh: bool) -> dict:
    with _lock:
        hit = _cache.get(key)
    if hit and hit[0] > time.time() and not refresh:
        return hit[1]
    val = fn()
    with _lock:
        _cache[key] = (time.time() + (TTL_OK if val.get("ok") else TTL_NO), val)
    return val


def _step(id: str, label: str, status: str, detail: str, needs: list[str], fix: dict | None = None, **extra: Any) -> dict:
    return {"id": id, "label": label, "status": status, "detail": detail, "needs": needs, **({"fix": fix} if fix else {}), **extra}


def _ga4_property(conn: GoogleConnection, host: str) -> dict:
    try:
        chosen, seen = ga4.match_properties(ga4.Ga4(conn), {host})
    except ga4.Ga4Error as exc:
        return {"ok": False, "error": str(exc)[:240], "chosen": [], "seen": 0}
    return {"ok": bool(chosen), "chosen": chosen[:5], "seen": len(seen), "error": None}


def _search_console(conn: GoogleConnection, host: str) -> dict:
    try:
        sites = gsc.SearchConsole(conn).sites()
    except gbp.GbpError as exc:
        return {"ok": False, "state": "error", "error": str(exc)[:240]}
    site = gsc.match_property(sites, host)
    if site:
        return {"ok": True, "state": "ok", "property": site}
    unverified = [x["siteUrl"] for x in sites if x.get("permissionLevel") == "siteUnverifiedUser" and host in x["siteUrl"]]
    if unverified:
        return {"ok": False, "state": "unverified", "property": unverified[0]}
    return {"ok": False, "state": "no_property", "have": [x["siteUrl"] for x in sites][:6]}


def connection_options(db: Session, user: User, b: Business) -> list[dict]:
    """The user's own connected Google accounts that could be linked to this project."""
    from sqlalchemy import select
    rows = db.scalars(only_my_connections(select(GoogleConnection), user).order_by(GoogleConnection.email))
    return [{"id": c.id, "email": c.email, "status": c.status, "analytics": ga4.has_scope(c), "search_console": gsc.has_scope(c), "business": "business.manage" in (c.scopes or ""), "ads": gbp.ADS_SCOPE in (c.scopes or "")} for c in rows]


def evaluate(db: Session, user: User, b: Business, refresh: bool = False, only: str | None = None) -> dict:
    """`only` = "website" or "gmb" leaves out the other list's steps (and so its Google look-ups): the Business Profile pages do not need Analytics calls."""
    want_web, want_gmb = only in (None, "website"), only in (None, "gmb")
    host = gsc.host_of(b.website)
    conn = b.connection
    usable = bool(conn and conn.status == "active" and conn.refresh_token_enc)
    W, G = ["website"], ["gmb"]
    steps: list[dict] = []

    # 1. The project's website.
    steps.append(_step("website", "Website added to the project", "ok" if host else "missing",
                       host or "This project has no website address yet. Website traffic is shown for the project's own website only.", W,
                       None if host else {"action": "edit_project", "label": "Add the website"}))

    # 2. The Google account linked to the project.
    if not conn:
        opts = connection_options(db, user, b)
        steps.append(_step("account", "Google account linked", "missing", "No Google account is linked to this project. Link the account that owns the website's Analytics, Search Console and Business Profile.",
                           W + G, {"action": "link_account", "label": "Link a Google account", "options": opts}))
    elif not usable:
        steps.append(_step("account", "Google account linked", "missing", f"The linked Google account ({conn.email}) is disconnected or its access was revoked. Sign in with it again.",
                           W + G, {"action": "reconnect_google", "label": "Reconnect Google account", "email": conn.email, "options": connection_options(db, user, b)}, email=conn.email))
    else:
        steps.append(_step("account", "Google account linked", "ok", f"Linked: {conn.email}", W + G, None, email=conn.email))
    account_ok = steps[-1]["status"] == "ok"

    def waiting(label_id: str, label: str, needs: list[str]) -> dict:
        return _step(label_id, label, "blocked", "Complete the Google account step first.", needs)

    # 3. Permissions the account granted.
    wants = [("scope_analytics", "Analytics read access granted", W, ga4.has_scope, "grant_analytics", "Allow Analytics access",
              "The account has not allowed read-only Google Analytics access yet."),
             ("scope_search_console", "Search Console read access granted", W, gsc.has_scope, "grant_search_console", "Allow Search Console access",
              "The account has not allowed Search Console access yet."),
             ("scope_business", "Business Profile access granted", G, lambda c: "business.manage" in (c.scopes or ""), "grant_business", "Allow Business Profile access",
              "The account has not allowed Business Profile management yet.")]
    for sid, label, needs, has, action, button, miss in wants:
        if not account_ok:
            steps.append(waiting(sid, label, needs))
        elif has(conn):
            steps.append(_step(sid, label, "ok", "Granted.", needs))
        else:
            steps.append(_step(sid, label, "missing", miss + f" Sign in with {conn.email} and approve it.", needs, {"action": action, "label": button, "email": conn.email}))
    scope = {s["id"]: s["status"] == "ok" for s in steps}

    # 4. Google Analytics 4 property of the site.
    if not want_web:
        pass
    elif not host:
        steps.append(_step("ga4_property", "Google Analytics property found", "blocked", "Add the project's website first.", W))
    elif not (account_ok and scope["scope_analytics"]):
        steps.append(waiting("ga4_property", "Google Analytics property found", W))
    else:
        r = _remembered(("ga4", conn.id, host), lambda: _ga4_property(conn, host), refresh)
        if r["ok"]:
            names = ", ".join(p.get("name") or p["property"] for p in r["chosen"])
            steps.append(_step("ga4_property", "Google Analytics property found", "ok", f"Measuring {host}: {names}", W, None, properties=[p["property"].split("/")[-1] for p in r["chosen"]]))
        elif r.get("error"):
            steps.append(_step("ga4_property", "Google Analytics property found", "missing", f"Google Analytics did not answer: {r['error']}", W, {"action": "recheck", "label": "Check again"}))
        else:
            steps.append(_step("ga4_property", "Google Analytics property found", "missing",
                               f"{conn.email} can see {r['seen']} Analytics propert{'y' if r['seen'] == 1 else 'ies'}, but none measures {host}. Give this account access to the site's property in Google Analytics (Admin > Property access management), or link the account that already has it.",
                               W, {"action": "open_ga4", "label": "Open Google Analytics", "url": "https://analytics.google.com/analytics/web/#/a/admin", "options": connection_options(db, user, b)}))

    # 5. The site verified in Search Console.
    if not want_web:
        pass
    elif not host:
        steps.append(_step("search_console", "Site verified in Search Console", "blocked", "Add the project's website first.", W))
    elif not (account_ok and scope["scope_search_console"]):
        steps.append(waiting("search_console", "Site verified in Search Console", W))
    else:
        r = _remembered(("gsc", conn.id, host), lambda: _search_console(conn, host), refresh)
        url = "https://search.google.com/search-console/welcome"
        if r["ok"]:
            steps.append(_step("search_console", "Site verified in Search Console", "ok", f"Verified property: {r['property']}", W))
        elif r["state"] == "error":
            steps.append(_step("search_console", "Site verified in Search Console", "missing", f"Search Console did not answer: {r['error']}", W, {"action": "recheck", "label": "Check again"}))
        elif r["state"] == "unverified":
            steps.append(_step("search_console", "Site verified in Search Console", "missing",
                               f"{r['property']} is listed for {conn.email} but is NOT verified, so Google returns no data (and Bing, which imports from Search Console, also loses ownership). Verify it again: add the DNS TXT record, the HTML tag or the HTML file Search Console gives you, then press Verify.",
                               W, {"action": "open_search_console", "label": "Open Search Console to verify", "url": url}))
        else:
            have = f" It has: {', '.join(r['have'])}." if r.get("have") else ""
            steps.append(_step("search_console", "Site verified in Search Console", "missing",
                               f"{conn.email} has no verified Search Console property for {host}.{have} Add the property and verify ownership (DNS record, HTML tag or file), or link the account that owns it.",
                               W, {"action": "open_search_console", "label": "Open Search Console", "url": url, "options": connection_options(db, user, b)}))

    # 6. The Business Profile linked to the project.
    if not want_gmb:
        pass
    elif not account_ok:
        steps.append(waiting("gbp", "Google Business Profile linked", G))
    elif not b.gbp_location:
        steps.append(_step("gbp", "Google Business Profile linked", "missing", "No Business Profile is linked to this project. Find the listing under the linked Google account and connect it.", G, {"action": "connect_gbp", "label": "Connect the Business Profile"}))
    else:
        warn = BAD_LISTING.get(b.verification or "")
        note = {"verified": "Linked and verified.", "pending": "Linked. Google verification is pending.", "unverified": "Linked, but the listing is not verified on Google yet."}.get(b.verification or "", "Linked.")
        steps.append(_step("gbp", "Google Business Profile linked", "ok", warn or note, G, None, verification=b.verification, warning=bool(warn or b.verification in ("unverified", "pending"))))

    steps = [s for s in steps if only is None or only in s["needs"]]

    def complete(kind: str) -> bool | None:
        if only not in (None, kind):
            return None  # not evaluated
        return all(s["status"] == "ok" for s in steps if kind in s["needs"])

    return {"business_id": b.id, "website": {"complete": complete("website"), "host": host or None}, "gmb": {"complete": complete("gmb")}, "steps": steps,
            "connection": {"id": conn.id, "email": conn.email, "status": conn.status} if conn else None, "checked_at": time.time()}


def require(db: Session, user: User, b: Business, kind: str) -> dict:
    """409 {code: 'access_incomplete'} unless every step for `kind` ('website' | 'gmb') is done. Admins are not exempt."""
    status = evaluate(db, user, b, only=kind)
    if not status[kind]["complete"]:
        todo = [s for s in status["steps"] if kind in s["needs"] and s["status"] != "ok"]
        raise HTTPException(409, detail={"code": "access_incomplete", "kind": kind, "business_id": b.id, "steps": todo,
                                         "message": "Finish the access checklist for this project before its " + ("website traffic" if kind == "website" else "Google Business Profile data") + " can be shown."})
    return status


def ga4_properties(db: Session, user: User, b: Business) -> list[dict]:
    """The Analytics properties (already proven to measure the project's site) that the website data may be read from."""
    require(db, user, b, "website")
    host = gsc.host_of(b.website)
    hit = _cache.get(("ga4", b.connection_id, host))
    return (hit[1]["chosen"] if hit else _ga4_property(b.connection, host)["chosen"])
