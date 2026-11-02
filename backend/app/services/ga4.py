"""Google Analytics 4: the website's real traffic (users, sessions, channels, countries, pages), read through the
Google account the user connected. Standalone: it only borrows the stored refresh token / access token of a
GoogleConnection (via gbp.GbpClient) and never changes it.

Needs, in the Google Cloud project: the "Google Analytics Data API" and "Google Analytics Admin API" enabled, and
the read-only scope below granted by the account (connect it with GET /analytics/ga4/start).
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from typing import Any

import httpx

from ..models import GoogleConnection
from . import gbp
from .gsc import host_of

SCOPE = "https://www.googleapis.com/auth/analytics.readonly"
DATA = "https://analyticsdata.googleapis.com/v1beta"
ADMIN = "https://analyticsadmin.googleapis.com/v1beta"

TOTAL_METRICS = ["activeUsers", "newUsers", "sessions", "engagedSessions", "engagementRate", "averageSessionDuration", "eventCount", "screenPageViews"]
# GA4's screens show "average engagement time per session" = total engagement time / sessions; the API's own averageSessionDuration is a different
# number (session length). So ask for the total engagement time and derive the average, kept under the averageSessionDuration key.
ASK_TOTALS = [("userEngagementDuration" if m == "averageSessionDuration" else m) for m in TOTAL_METRICS]
PERCENT = {"engagementRate", "bounceRate"}


class Ga4Error(RuntimeError):
    pass


def has_scope(conn: GoogleConnection) -> bool:
    return SCOPE in (conn.scopes or "")


def _num(v: Any) -> int | float:
    f = float(v)
    return int(f) if f.is_integer() else round(f, 4)


def _explain(status: int, msg: str, url: str) -> str:
    low = (msg or "").lower()
    api = "Google Analytics Admin API" if "analyticsadmin" in url else "Google Analytics Data API"
    if "has not been used" in low or "is disabled" in low or "service_disabled" in low:
        return f"The {api} is not enabled in the Google Cloud project. Enable it (APIs & Services > Library), wait a few minutes, then try again."
    if status == 401:
        return "Google sign-in expired or was revoked. Connect the account again."
    if status == 403:
        return f"Google refused access to Analytics ({msg}). Connect the account again so it grants the Analytics permission, and make sure it has access to the GA4 property."
    return f"Google Analytics {status}: {msg}"


class Ga4:
    def __init__(self, conn: GoogleConnection):
        try:
            self.client = gbp.GbpClient(conn)
        except gbp.GbpError as exc:
            raise Ga4Error(str(exc)) from exc

    def _req(self, method: str, url: str, **kw: Any) -> dict[str, Any]:
        try:
            token = self.client._token()
        except gbp.GbpError as exc:
            raise Ga4Error(str(exc)) from exc
        r = httpx.request(method, url, headers={"Authorization": f"Bearer {token}"}, timeout=40, **kw)
        if r.status_code >= 400:
            try:
                msg = r.json().get("error", {}).get("message") or ""
            except ValueError:
                msg = r.text[:200]
            raise Ga4Error(_explain(r.status_code, msg, url))
        return r.json() if r.content else {}

    # Admin: which properties the account can see, and the websites they measure
    def properties(self) -> list[dict[str, Any]]:
        out, token = [], None
        while True:
            d = self._req("GET", f"{ADMIN}/accountSummaries", params={"pageSize": 200, **({"pageToken": token} if token else {})})
            for acc in d.get("accountSummaries", []):
                for p in acc.get("propertySummaries", []):
                    out.append({"property": p["property"], "name": p.get("displayName"), "account": acc.get("displayName")})
            token = d.get("nextPageToken")
            if not token:
                return out

    def hosts(self, prop: str) -> list[str]:
        """The website hosts of the property's web data streams."""
        d = self._req("GET", f"{ADMIN}/{prop}/dataStreams", params={"pageSize": 50})
        return sorted({host_of((s.get("webStreamData") or {}).get("defaultUri")) for s in d.get("dataStreams", []) if (s.get("webStreamData") or {}).get("defaultUri")})

    # Data
    def run(self, prop: str, body: dict[str, Any]) -> list[dict[str, Any]]:
        d = self._req("POST", f"{DATA}/{prop}:runReport", json=body)
        dims, mets = [h["name"] for h in d.get("dimensionHeaders", [])], [h["name"] for h in d.get("metricHeaders", [])]
        out = []
        for r in d.get("rows", []):
            item: dict[str, Any] = {n: v["value"] for n, v in zip(dims, r.get("dimensionValues", []))}
            for n, v in zip(mets, r.get("metricValues", [])):
                item[n] = _num(v["value"])
            out.append(item)
        return out

    def realtime(self, prop: str) -> dict[str, Any]:
        d = self._req("POST", f"{DATA}/{prop}:runRealtimeReport", json={"metrics": [{"name": "activeUsers"}], "dimensions": [{"name": "country"}], "limit": 25})
        by = [{"country": r["dimensionValues"][0]["value"], "active_users": int(r["metricValues"][0]["value"])} for r in d.get("rows", [])]
        return {"active_users_30_min": sum(x["active_users"] for x in by), "by_country": by}


def match_properties(ga: Ga4, hosts: set[str]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """(matching properties, every property seen), each with the hosts it measures."""
    props = ga.properties()[:40]

    def look(p: dict[str, Any]) -> dict[str, Any]:
        try:
            return p | {"hosts": ga.hosts(p["property"])}
        except Ga4Error:
            return p | {"hosts": []}

    with ThreadPoolExecutor(max_workers=8) as pool:
        seen = list(pool.map(look, props))
    return [p for p in seen if hosts & set(p["hosts"])], seen


def _body(start: date, end: date, metrics: list[str], dims: list[str] | None = None, limit: int = 100, order: str | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"dateRanges": [{"startDate": start.isoformat(), "endDate": end.isoformat()}], "metrics": [{"name": m} for m in metrics], "limit": limit}
    if dims:
        body["dimensions"] = [{"name": d} for d in dims]
    if order:
        body["orderBys"] = [{"metric": {"metricName": order}, "desc": True}]
    return body


def _clean(row: dict[str, Any]) -> dict[str, Any]:
    out = {k: (round(v * 100, 2) if k in PERCENT else (round(v, 2) if isinstance(v, float) else v)) for k, v in row.items()}
    if "userEngagementDuration" in row:  # seconds of engagement per session, as GA4 reports it
        out["averageSessionDuration"] = round(row["userEngagementDuration"] / row["sessions"], 1) if row.get("sessions") else 0
        if "activeUsers" in row:  # the Reports snapshot's "Average engagement time" is per active user
            out["engagementTimePerUser"] = round(row["userEngagementDuration"] / row["activeUsers"], 1) if row.get("activeUsers") else 0
        out.pop("userEngagementDuration", None)
    return out


def _change(now: dict[str, Any], prev: dict[str, Any]) -> dict[str, float | None]:
    return {m: (round((now.get(m, 0) - prev.get(m, 0)) * 100 / prev[m], 1) if prev.get(m) else None) for m in [*TOTAL_METRICS, "engagementTimePerUser"]}


def report(ga: Ga4, prop: str, days: int = 28) -> dict[str, Any]:
    """The GA4 overview for one property: totals with the previous period, timeline, channels, countries, pages, devices, sources, realtime.
    A part Google refuses is recorded under `errors` and the rest still loads."""
    end = date.today() - timedelta(days=1)  # GA4's "last N days" stop at yesterday: today is still incomplete
    start = end - timedelta(days=days - 1)
    p_end, p_start = start - timedelta(days=1), start - timedelta(days=days)
    parts = {
        "now": lambda: ga.run(prop, _body(start, end, ASK_TOTALS)),
        "prev": lambda: ga.run(prop, _body(p_start, p_end, ASK_TOTALS)),
        "key_events": lambda: ga.run(prop, _body(start, end, ["keyEvents"])),
        "timeline": lambda: ga.run(prop, _body(start, end, ["activeUsers", "sessions", "eventCount"], ["date"], 400)),
        "channels": lambda: ga.run(prop, _body(start, end, ["sessions", "engagedSessions", "engagementRate", "userEngagementDuration", "eventsPerSession", "eventCount"], ["sessionPrimaryChannelGroup"], 25, "sessions")),
        "channel_timeline": lambda: ga.run(prop, _body(start, end, ["sessions"], ["date", "sessionPrimaryChannelGroup"], 2000)),
        "countries": lambda: ga.run(prop, _body(start, end, ["activeUsers", "sessions"], ["country"], 25, "activeUsers")),
        "pages": lambda: ga.run(prop, _body(start, end, ["screenPageViews", "activeUsers", "eventCount", "bounceRate"], ["pageTitle"], 25, "screenPageViews")),
        "paths": lambda: ga.run(prop, _body(start, end, ["screenPageViews", "activeUsers", "userEngagementDuration", "eventCount", "keyEvents"], ["unifiedPagePathScreen"], 50, "screenPageViews")),
        "first_sources": lambda: ga.run(prop, _body(start, end, ["activeUsers"], ["firstUserSourceMedium"], 25, "activeUsers")),
        "new_vs_returning": lambda: ga.run(prop, _body(start, end, ["activeUsers"], ["date", "newVsReturning"], 1000)),
        "cities": lambda: ga.run(prop, _body(start, end, ["activeUsers"], ["city"], 25, "activeUsers")),
        "audiences": lambda: ga.run(prop, _body(start, end, ["activeUsers"], ["audienceName"], 25, "activeUsers")),
        "key_events_platform": lambda: ga.run(prop, _body(start, end, ["keyEvents"], ["platform"], 10, "keyEvents")),
        "devices": lambda: ga.run(prop, _body(start, end, ["activeUsers", "sessions"], ["deviceCategory"], 10, "sessions")),
        "sources": lambda: ga.run(prop, _body(start, end, ["sessions", "activeUsers"], ["sessionSourceMedium"], 25, "sessions")),
        "realtime": lambda: ga.realtime(prop),
    }
    got: dict[str, Any] = {}
    errors: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {k: pool.submit(fn) for k, fn in parts.items()}
        for k, fut in futures.items():
            try:
                got[k] = fut.result()
            except Ga4Error as exc:
                got[k], errors[k] = ([] if k != "realtime" else None), str(exc)[:240]

    first = lambda rows: _clean(rows[0]) if rows else {m: 0 for m in TOTAL_METRICS}  # noqa: E731
    now, prev = first(got["now"]), first(got["prev"])
    if got["key_events"]:
        now["keyEvents"] = got["key_events"][0].get("keyEvents", 0)
    elif "key_events" not in errors:  # Google returns no row when the property has no key events set up
        now["keyEvents"] = 0
    day = lambda s: datetime.strptime(s, "%Y%m%d").date().isoformat()  # noqa: E731
    return {
        "property": prop,
        "period": {"days": days, "start": start.isoformat(), "end": end.isoformat(), "previous_start": p_start.isoformat(), "previous_end": p_end.isoformat()},
        "realtime": got["realtime"],
        "totals": now, "previous": prev, "change_percent": _change(now, prev),
        "timeline": sorted(({"date": day(r["date"]), "active_users": r["activeUsers"], "sessions": r["sessions"], "events": r["eventCount"]} for r in got["timeline"]), key=lambda x: x["date"]),
        "channels": [_clean(r) | {"channel": r["sessionPrimaryChannelGroup"]} for r in got["channels"]],
        "channel_timeline": sorted(({"date": day(r["date"]), "channel": r["sessionPrimaryChannelGroup"], "sessions": r["sessions"]} for r in got["channel_timeline"]), key=lambda x: (x["date"], x["channel"])),
        "countries": [{"country": r["country"], "active_users": r["activeUsers"], "sessions": r["sessions"]} for r in got["countries"]],
        "pages": [{"title": r["pageTitle"], "views": r["screenPageViews"], "active_users": r["activeUsers"], "event_count": r["eventCount"], "bounce_rate": round(r["bounceRate"] * 100, 1)} for r in got["pages"]],
        "paths": [{"path": r["unifiedPagePathScreen"], "views": r["screenPageViews"], "active_users": r["activeUsers"],
                   "views_per_user": round(r["screenPageViews"] / r["activeUsers"], 2) if r["activeUsers"] else 0,
                   "engagement_per_user": round(r["userEngagementDuration"] / r["activeUsers"], 1) if r["activeUsers"] else 0,
                   "event_count": r["eventCount"], "key_events": r["keyEvents"]} for r in got["paths"]],
        "first_sources": [{"source_medium": r["firstUserSourceMedium"], "active_users": r["activeUsers"]} for r in got["first_sources"]],
        "new_vs_returning": sorted(({"date": day(r["date"]), "kind": r["newVsReturning"], "active_users": r["activeUsers"]} for r in got["new_vs_returning"] if r["newVsReturning"] in ("new", "returning")), key=lambda x: (x["date"], x["kind"])),
        "cities": [{"city": r["city"], "active_users": r["activeUsers"]} for r in got["cities"]],
        "audiences": [{"audience": r["audienceName"], "active_users": r["activeUsers"]} for r in got["audiences"]],
        "key_events_platform": [{"platform": r["platform"], "key_events": r["keyEvents"]} for r in got["key_events_platform"] if r["keyEvents"]],
        "devices": [{"device": r["deviceCategory"], "active_users": r["activeUsers"], "sessions": r["sessions"]} for r in got["devices"]],
        "sources": [{"source_medium": r["sessionSourceMedium"], "sessions": r["sessions"], "active_users": r["activeUsers"]} for r in got["sources"]],
        "errors": errors,
    }


def realtime_report(ga: Ga4, prop: str) -> dict[str, Any]:
    """GA4's Realtime overview and Realtime pages: the last 30 minutes (and 5), per minute, by location, audience, page and event.
    The realtime API has no first-user-source or page-path dimension, so those two GA4 cards are not part of it."""
    def rt(metrics: list[str], dims: list[str] | None = None, limit: int = 25, **extra: Any) -> list[dict[str, Any]]:
        body: dict[str, Any] = {"metrics": [{"name": m} for m in metrics], "limit": limit, **extra}
        if dims:
            body["dimensions"] = [{"name": d} for d in dims]
        d = ga._req("POST", f"{DATA}/{prop}:runRealtimeReport", json=body)
        dn, mn = [h["name"] for h in d.get("dimensionHeaders", [])], [h["name"] for h in d.get("metricHeaders", [])]
        return [{**{n: v["value"] for n, v in zip(dn, r.get("dimensionValues", []))}, **{n: _num(v["value"]) for n, v in zip(mn, r.get("metricValues", []))}} for r in d.get("rows", [])]

    parts = {
        "total30": lambda: rt(["activeUsers", "screenPageViews", "eventCount"]),
        "total5": lambda: rt(["activeUsers"], minuteRanges=[{"startMinutesAgo": 4, "endMinutesAgo": 0}]),
        "minutes": lambda: rt(["activeUsers"], ["minutesAgo"], 60),
        "locations": lambda: rt(["activeUsers"], ["country", "city"], 50),
        "audiences": lambda: rt(["activeUsers"], ["audienceName"]),
        "screens": lambda: rt(["screenPageViews", "activeUsers"], ["unifiedScreenName"], 50),
        "events": lambda: rt(["eventCount"], ["eventName"], 50),
        "key_events": lambda: rt(["keyEvents"], ["eventName"], 50),
    }
    got: dict[str, Any] = {}
    errors: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {k: pool.submit(fn) for k, fn in parts.items()}
        for k, fut in futures.items():
            try:
                got[k] = fut.result()
            except Ga4Error as exc:
                got[k], errors[k] = [], str(exc)[:240]
    t30 = got["total30"][0] if got["total30"] else {}
    by_min = {int(r["minutesAgo"]): r["activeUsers"] for r in got["minutes"]}
    return {
        "property": prop,
        "active_users_30": t30.get("activeUsers", 0), "active_users_5": got["total5"][0]["activeUsers"] if got["total5"] else 0,
        "views_30": t30.get("screenPageViews", 0), "events_30": t30.get("eventCount", 0),
        "per_minute": [{"minutes_ago": m, "active_users": by_min.get(m, 0)} for m in range(29, -1, -1)],
        "locations": [{"country": r["country"], "city": r["city"], "active_users": r["activeUsers"]} for r in sorted(got["locations"], key=lambda r: -r["activeUsers"])],
        "audiences": [{"audience": r["audienceName"], "active_users": r["activeUsers"]} for r in got["audiences"]],
        "screens": [{"title": r["unifiedScreenName"], "views": r["screenPageViews"], "active_users": r["activeUsers"]} for r in sorted(got["screens"], key=lambda r: -r["screenPageViews"])],
        "events": [{"event": r["eventName"], "count": r["eventCount"]} for r in sorted(got["events"], key=lambda r: -r["eventCount"])],
        "key_events": [{"event": r["eventName"], "count": r["keyEvents"]} for r in got["key_events"] if r["keyEvents"]],
        "errors": errors,
    }

