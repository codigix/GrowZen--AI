"""Google Search Console: the site's real Google traffic, read through the Google account the user connected.

It supplies what a Domain Overview needs and no estimate can: clicks (organic traffic), impressions, average
position, the queries and pages that earn them, the countries and devices, and the history. Nothing is invented:
without a connected account, the scope or a verified property for the site, the page says what is missing.
Needs the Search Console API enabled in the Google Cloud project and the read-only scope below.
"""
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Any
from urllib.parse import quote, urlparse

import httpx

from ..models import GoogleConnection
from . import gbp

SC = "https://www.googleapis.com/webmasters/v3"
SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
LAG_DAYS = 2  # Search Console data lags about two days
CACHE_SECONDS = 600
RANGES = {"28d": 28, "3m": 90, "6m": 180, "12m": 365, "16m": 480}

# Search Console reports countries as ISO alpha-3 in lower case.
A3 = {"afg": "AF", "alb": "AL", "dza": "DZ", "ago": "AO", "arg": "AR", "arm": "AM", "aus": "AU", "aut": "AT", "aze": "AZ", "bhr": "BH", "bgd": "BD", "blr": "BY", "bel": "BE", "bol": "BO",
      "bih": "BA", "bra": "BR", "bgr": "BG", "khm": "KH", "cmr": "CM", "can": "CA", "chl": "CL", "chn": "CN", "col": "CO", "cri": "CR", "hrv": "HR", "cyp": "CY", "cze": "CZ", "dnk": "DK",
      "dom": "DO", "ecu": "EC", "egy": "EG", "est": "EE", "eth": "ET", "fin": "FI", "fra": "FR", "geo": "GE", "deu": "DE", "gha": "GH", "grc": "GR", "gtm": "GT", "hkg": "HK", "hun": "HU",
      "isl": "IS", "ind": "IN", "idn": "ID", "irn": "IR", "irq": "IQ", "irl": "IE", "isr": "IL", "ita": "IT", "jam": "JM", "jpn": "JP", "jor": "JO", "kaz": "KZ", "ken": "KE", "kwt": "KW",
      "lva": "LV", "lbn": "LB", "ltu": "LT", "lux": "LU", "mys": "MY", "mus": "MU", "mex": "MX", "mar": "MA", "mmr": "MM", "npl": "NP", "nld": "NL", "nzl": "NZ", "nga": "NG", "nor": "NO",
      "omn": "OM", "pak": "PK", "pan": "PA", "per": "PE", "phl": "PH", "pol": "PL", "prt": "PT", "qat": "QA", "rou": "RO", "rus": "RU", "sau": "SA", "srb": "RS", "sgp": "SG", "svk": "SK",
      "svn": "SI", "zaf": "ZA", "kor": "KR", "esp": "ES", "lka": "LK", "swe": "SE", "che": "CH", "twn": "TW", "tza": "TZ", "tha": "TH", "tun": "TN", "tur": "TR", "uga": "UG", "ukr": "UA",
      "are": "AE", "gbr": "GB", "usa": "US", "ury": "UY", "uzb": "UZ", "ven": "VE", "vnm": "VN", "zmb": "ZM", "zwe": "ZW"}
A2_TO_A3 = {v: k for k, v in A3.items()}

_cache: dict[tuple, tuple[float, Any]] = {}
_lock = threading.Lock()


def has_scope(conn: GoogleConnection) -> bool:
    return SCOPE in (conn.scopes or "")


def host_of(url: str | None) -> str:
    u = (url or "").strip()
    h = urlparse(u if u.startswith("http") else f"https://{u}").netloc.lower()
    return h[4:] if h.startswith("www.") else h


class SearchConsole:
    def __init__(self, conn: GoogleConnection):
        self.client = gbp.GbpClient(conn)

    def _req(self, method: str, url: str, **kw: Any) -> dict[str, Any]:
        r = httpx.request(method, url, headers={"Authorization": f"Bearer {self.client._token()}"}, timeout=40, **kw)
        if r.status_code >= 400:
            try:
                msg = r.json().get("error", {}).get("message") or ""
            except ValueError:
                msg = r.text[:200]
            low = msg.lower()
            if "has not been used" in low or "is disabled" in low:
                raise gbp.GbpError("The Google Search Console API is not enabled in the Google Cloud project. Enable it (APIs & Services > Library), wait a few minutes, then try again.")
            if r.status_code == 403:
                raise gbp.GbpError(f"Google refused access to Search Console ({msg}). Connect the account again so it grants the Search Console permission, and make sure it can see the site in Search Console.")
            if r.status_code == 401:
                raise gbp.GbpError("Google sign-in expired or was revoked. Connect the account again.")
            raise gbp.GbpError(f"Search Console {r.status_code}: {msg}")
        return r.json() if r.content else {}

    def sites(self) -> list[dict[str, Any]]:
        return self._req("GET", f"{SC}/sites").get("siteEntry", [])

    def query(self, site: str, body: dict[str, Any]) -> list[dict[str, Any]]:
        return self._req("POST", f"{SC}/sites/{quote(site, safe='')}/searchAnalytics/query", json=body).get("rows", [])


def match_property(sites: list[dict[str, Any]], host: str) -> str | None:
    """The Search Console property for a domain: the domain property, else the https / http address."""
    known = {s["siteUrl"] for s in sites if s.get("permissionLevel") != "siteUnverifiedUser"}
    for cand in (f"sc-domain:{host}", f"https://{host}/", f"https://www.{host}/", f"http://{host}/", f"http://www.{host}/"):
        if cand in known:
            return cand
    return None


def _body(start: date, end: date, dims: list[str] | None = None, limit: int = 1000, country: str | None = None, device: str | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"startDate": start.isoformat(), "endDate": end.isoformat(), "rowLimit": limit, "dataState": "final"}
    if dims:
        body["dimensions"] = dims
    filters = []
    if country and country.upper() in A2_TO_A3:
        filters.append({"dimension": "country", "operator": "equals", "expression": A2_TO_A3[country.upper()]})
    if device and device.upper() in ("DESKTOP", "MOBILE", "TABLET"):
        filters.append({"dimension": "device", "operator": "equals", "expression": device.upper()})
    if filters:
        body["dimensionFilterGroups"] = [{"groupType": "and", "filters": filters}]
    return body


def _totals(rows: list[dict[str, Any]]) -> dict[str, Any]:
    r = rows[0] if rows else {}
    return {"clicks": int(r.get("clicks", 0)), "impressions": int(r.get("impressions", 0)), "ctr": round(r.get("ctr", 0) * 100, 2), "position": round(r.get("position", 0), 1) or None}


def report(sc: SearchConsole, site: str, range_key: str = "3m", country: str | None = None, device: str | None = None) -> dict[str, Any]:
    """The traffic report for a property over the range, with the same-length period before it for the change."""
    days = RANGES.get(range_key, 90)
    end = date.today() - timedelta(days=LAG_DAYS)
    start = end - timedelta(days=days - 1)
    p_end, p_start = start - timedelta(days=1), start - timedelta(days=days)
    key = (sc.client.conn.id, site, start, end, (country or "").upper(), (device or "").upper())
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < CACHE_SECONDS:
            return hit[1]
    q = lambda s, e, dims=None, limit=1000: sc.query(site, _body(s, e, dims, limit, country, device))  # noqa: E731
    with ThreadPoolExecutor(max_workers=6) as pool:
        f = {
            "now": pool.submit(q, start, end), "prev": pool.submit(q, p_start, p_end),
            "series": pool.submit(q, start, end, ["date"], 1000), "countries": pool.submit(sc.query, site, _body(start, end, ["country"], 250, None, device)),
            "queries": pool.submit(q, start, end, ["query"], 1000), "queries_prev": pool.submit(q, p_start, p_end, ["query"], 1000),
            "pages": pool.submit(q, start, end, ["page"], 1000), "pages_prev": pool.submit(q, p_start, p_end, ["page"], 1000),
            "devices": pool.submit(sc.query, site, _body(start, end, ["device"], 10, country, None)),
        }
        got = {k: v.result() for k, v in f.items()}
    by_day = {r["keys"][0]: r for r in got["series"]}
    timeline = []
    d = start
    while d <= end:
        r = by_day.get(d.isoformat())
        timeline.append({"date": d.isoformat(), "clicks": int(r["clicks"]) if r else 0, "impressions": int(r["impressions"]) if r else 0})
        d += timedelta(days=1)
    now, prev = _totals(got["now"]), _totals(got["prev"])
    now["keywords"], prev["keywords"] = len(got["queries"]), len(got["queries_prev"])
    now["pages"], prev["pages"] = len(got["pages"]), len(got["pages_prev"])
    out = {
        "property": site, "range": range_key, "period": {"start": start.isoformat(), "end": end.isoformat(), "days": days},
        "totals": now, "previous": prev, "keywords_capped": len(got["queries"]) >= 1000,
        "timeline": timeline,
        "countries": [{"code": A3.get(r["keys"][0], r["keys"][0].upper()[:2]), "clicks": int(r["clicks"]), "impressions": int(r["impressions"]), "ctr": round(r["ctr"] * 100, 2), "position": round(r["position"], 1)}
                      for r in sorted(got["countries"], key=lambda r: -r["clicks"])[:60]],
        "keywords": [{"query": r["keys"][0], "clicks": int(r["clicks"]), "impressions": int(r["impressions"]), "ctr": round(r["ctr"] * 100, 2), "position": round(r["position"], 1)} for r in sorted(got["queries"], key=lambda r: (-r["clicks"], -r["impressions"]))[:100]],
        "pages": [{"page": r["keys"][0], "clicks": int(r["clicks"]), "impressions": int(r["impressions"]), "ctr": round(r["ctr"] * 100, 2), "position": round(r["position"], 1)} for r in sorted(got["pages"], key=lambda r: (-r["clicks"], -r["impressions"]))[:50]],
        "devices": [{"device": r["keys"][0].lower(), "clicks": int(r["clicks"]), "impressions": int(r["impressions"])} for r in got["devices"]],
    }
    with _lock:
        _cache[key] = (time.time(), out)
    return out
