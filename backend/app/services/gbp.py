"""Google Business Profile: OAuth connect, list locations, sync reviews / insights, publish.

Flow: the user signs in with the Google account that owns or manages the profile, granting
`business.manage`. We store the refresh token encrypted, list the account's locations, and
import the chosen ones as businesses. Writes (review replies, posts, profile edits) only run
from approved agent tasks.

APIs used (all need the project to be approved for the Business Profile APIs):
  Account Management  mybusinessaccountmanagement.googleapis.com/v1/accounts
  Business Information mybusinessbusinessinformation.googleapis.com/v1/{account}/locations
  Reviews, posts, media (v4) mybusiness.googleapis.com/v4/{account}/{location}/...
  Performance          businessprofileperformance.googleapis.com/v1/{location}:fetchMultiDailyMetricsTimeSeries
"""
import secrets
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Business, GoogleConnection, InsightDay, Review
from . import crypto

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
SCOPES = "openid email profile https://www.googleapis.com/auth/business.manage"
ACCOUNTS = "https://mybusinessaccountmanagement.googleapis.com/v1"
INFO = "https://mybusinessbusinessinformation.googleapis.com/v1"
V4 = "https://mybusiness.googleapis.com/v4"
PERF = "https://businessprofileperformance.googleapis.com/v1"
READ_MASK = "name,title,storefrontAddress,phoneNumbers,categories,websiteUri,latlng,metadata,profile,regularHours,serviceArea"
STAR = {"ONE": 1, "TWO": 2, "THREE": 3, "FOUR": 4, "FIVE": 5}


class GbpError(RuntimeError):
    pass


def _redirect_uri() -> str:
    s = get_settings()
    return f"{s.public_base_url.rstrip('/')}{s.api_prefix}/connections/google/callback"


def auth_url(user_id: str) -> str:
    s = get_settings()
    if not s.google_oauth_enabled:
        raise GbpError("Google sign-in is not set up: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.")
    state = jwt.encode({"sub": user_id, "nonce": secrets.token_urlsafe(8), "exp": int(time.time()) + 600}, s.crm_jwt_secret, algorithm="HS256")
    return f"{AUTH_URL}?{urlencode({'client_id': s.google_client_id, 'redirect_uri': _redirect_uri(), 'response_type': 'code', 'scope': SCOPES, 'access_type': 'offline', 'prompt': 'consent', 'include_granted_scopes': 'true', 'state': state})}"


def read_state(state: str) -> str:
    try:
        return str(jwt.decode(state, get_settings().crm_jwt_secret, algorithms=["HS256"])["sub"])
    except jwt.InvalidTokenError as exc:
        raise GbpError("Sign-in link expired. Start again.") from exc


def exchange_code(db: Session, code: str, actor: str) -> GoogleConnection:
    s = get_settings()
    r = httpx.post(TOKEN_URL, data={"code": code, "client_id": s.google_client_id, "client_secret": s.google_client_secret, "redirect_uri": _redirect_uri(), "grant_type": "authorization_code"}, timeout=20)
    tok = r.json()
    if r.status_code != 200:
        raise GbpError(tok.get("error_description") or tok.get("error") or "Google sign-in failed")
    info = httpx.get(USERINFO_URL, headers={"Authorization": f"Bearer {tok['access_token']}"}, timeout=20).json()
    email = info.get("email")
    if not email:
        raise GbpError("Google did not return the account email.")
    conn = db.scalar(select(GoogleConnection).where(GoogleConnection.email == email)) or GoogleConnection(email=email)
    conn.display_name = info.get("name")
    if tok.get("refresh_token"):
        conn.refresh_token_enc = crypto.seal(tok["refresh_token"])
    conn.scopes = tok.get("scope")
    conn.status = "active"
    conn.connected_by = actor
    conn.last_error = None
    db.add(conn)
    db.commit()
    _tokens[conn.id] = (time.time() + int(tok.get("expires_in", 3000)) - 60, tok["access_token"])
    return conn


_tokens: dict[int, tuple[float, str]] = {}


class GbpClient:
    def __init__(self, conn: GoogleConnection):
        if not conn.refresh_token_enc:
            raise GbpError(f"{conn.email} has no stored refresh token; connect it again.")
        self.conn = conn

    def _token(self) -> str:
        hit = _tokens.get(self.conn.id)
        if hit and hit[0] > time.time():
            return hit[1]
        s = get_settings()
        r = httpx.post(TOKEN_URL, data={"client_id": s.google_client_id, "client_secret": s.google_client_secret, "refresh_token": crypto.unseal(self.conn.refresh_token_enc), "grant_type": "refresh_token"}, timeout=20)
        tok = r.json()
        if r.status_code != 200:
            raise GbpError(f"Google access for {self.conn.email} was revoked or expired: {tok.get('error_description') or tok.get('error')}")
        _tokens[self.conn.id] = (time.time() + int(tok.get("expires_in", 3000)) - 60, tok["access_token"])
        return tok["access_token"]

    def _req(self, method: str, url: str, **kw: Any) -> dict[str, Any]:
        r = httpx.request(method, url, headers={"Authorization": f"Bearer {self._token()}"}, timeout=30, **kw)
        if r.status_code >= 400:
            try:
                msg = r.json().get("error", {}).get("message") or ""
            except ValueError:
                msg = r.text[:200]
            raise GbpError(explain_google_error(r.status_code, msg, url))
        return r.json() if r.content else {}

    # Read
    def accounts(self) -> list[dict[str, Any]]:
        return self._req("GET", f"{ACCOUNTS}/accounts").get("accounts", [])

    def locations(self, account: str) -> list[dict[str, Any]]:
        out, token = [], None
        while True:
            params = {"readMask": READ_MASK, "pageSize": 100, **({"pageToken": token} if token else {})}
            d = self._req("GET", f"{INFO}/{account}/locations", params=params)
            out += d.get("locations", [])
            token = d.get("nextPageToken")
            if not token:
                return out

    def all_locations(self) -> list[dict[str, Any]]:
        found = []
        for acc in self.accounts():
            for loc in self.locations(acc["name"]):
                found.append({"account": acc["name"], "account_role": acc.get("role"), **loc})
        return found

    def reviews(self, account: str, location: str) -> list[dict[str, Any]]:
        out, token = [], None
        while True:
            d = self._req("GET", f"{V4}/{account}/{location}/reviews", params={"pageSize": 50, **({"pageToken": token} if token else {})})
            out += d.get("reviews", [])
            token = d.get("nextPageToken")
            if not token or len(out) >= 500:
                return out

    def media_count(self, account: str, location: str) -> int:
        return int(self._req("GET", f"{V4}/{account}/{location}/media", params={"pageSize": 1}).get("totalMediaItemCount", 0))

    def daily_metrics(self, location: str, start: date, end: date) -> dict[str, dict[str, int]]:
        metrics = ["CALL_CLICKS", "BUSINESS_DIRECTION_REQUESTS", "WEBSITE_CLICKS", "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH", "BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_MAPS", "BUSINESS_BOOKINGS"]
        params: list[tuple[str, Any]] = [("dailyMetrics", m) for m in metrics] + [
            ("dailyRange.start_date.year", start.year), ("dailyRange.start_date.month", start.month), ("dailyRange.start_date.day", start.day),
            ("dailyRange.end_date.year", end.year), ("dailyRange.end_date.month", end.month), ("dailyRange.end_date.day", end.day)]
        d = self._req("GET", f"{PERF}/{location}:fetchMultiDailyMetricsTimeSeries", params=params)
        days: dict[str, dict[str, int]] = {}
        for series in d.get("multiDailyMetricTimeSeries", []):
            for s in series.get("dailyMetricTimeSeries", []):
                for v in (s.get("timeSeries") or {}).get("datedValues", []):
                    dt = v["date"]
                    key = f"{dt['year']:04d}-{dt['month']:02d}-{dt['day']:02d}"
                    days.setdefault(key, {})[s["dailyMetric"]] = int(v.get("value", 0))
        return days

    # Write (approved tasks only)
    def reply_review(self, account: str, location: str, review_id: str, text: str) -> None:
        self._req("PUT", f"{V4}/{account}/{location}/reviews/{review_id}/reply", json={"comment": text})

    def create_post(self, account: str, location: str, post: dict[str, Any]) -> dict[str, Any]:
        body: dict[str, Any] = {"languageCode": "en", "summary": post["body"], "topicType": {"Offer": "OFFER", "Event": "EVENT"}.get(post.get("post_type"), "STANDARD")}
        if post.get("cta_type") and post.get("cta_url"):
            body["callToAction"] = {"actionType": post["cta_type"], "url": post["cta_url"]}
        if post.get("image_url"):
            body["media"] = [{"mediaFormat": "PHOTO", "sourceUrl": post["image_url"]}]
        if body["topicType"] in ("OFFER", "EVENT"):
            start = datetime.now(timezone.utc).date()
            end = start + timedelta(days=7)
            body["event"] = {"title": post.get("title") or "Offer", "schedule": {"startDate": {"year": start.year, "month": start.month, "day": start.day}, "endDate": {"year": end.year, "month": end.month, "day": end.day}}}
        return self._req("POST", f"{V4}/{account}/{location}/localPosts", json=body)


API_NAMES = {
    "mybusinessaccountmanagement": "My Business Account Management API",
    "mybusinessbusinessinformation": "My Business Business Information API",
    "businessprofileperformance": "Business Profile Performance API",
    "mybusiness.googleapis.com": "Google My Business API (v4: reviews, posts, media)",
}
ACCESS_FORM = "https://developers.google.com/my-business/content/prereqs#request-access"


def explain_google_error(status: int, msg: str, url: str = "") -> str:
    """Google's API errors in plain words, with what to do."""
    api = next((v for k, v in API_NAMES.items() if k in url), "the Business Profile API")
    low = (msg or "").lower()
    if "has not been used" in low or "is disabled" in low or "service_disabled" in low:
        return f"{api} is not enabled in the Google Cloud project. Enable it (APIs & Services > Library), wait a few minutes, then try again."
    if status == 429 or "quota" in low:
        return ("Google has not approved Business Profile API access for this Google Cloud project yet (its quota is 0). "
                f"Request access: {ACCESS_FORM} (approval usually takes a few days).")
    if status == 403:
        return (f"Google refused access ({msg}). The signed-in account must own or manage the profile, "
                f"and the project needs approved Business Profile API access ({ACCESS_FORM}).")
    if status == 401:
        return "Google sign-in expired or was revoked. Connect the account again."
    return f"Google API {status}: {msg}"


def setup_info() -> dict[str, Any]:
    """What must be set up in Google Cloud for Connect Google to work."""
    s = get_settings()
    return {
        "configured": s.google_oauth_enabled,
        "client_id": (s.google_client_id[:16] + "...") if s.google_client_id else None,
        "redirect_uri": _redirect_uri(),
        "scopes": SCOPES.split(),
        "apis": list(API_NAMES.values()),
        "access_form": ACCESS_FORM,
    }


def location_to_fields(loc: dict[str, Any]) -> dict[str, Any]:
    """A Business Information location -> Business columns."""
    addr = loc.get("storefrontAddress") or {}
    lines = addr.get("addressLines") or []
    cats = loc.get("categories") or {}
    meta = loc.get("metadata") or {}
    latlng = loc.get("latlng") or {}
    return {
        "name": loc.get("title"),
        "primary_category": (cats.get("primaryCategory") or {}).get("displayName"),
        "secondary_categories": [c.get("displayName") for c in cats.get("additionalCategories") or [] if c.get("displayName")],
        "description": (loc.get("profile") or {}).get("description"),
        "phone": (loc.get("phoneNumbers") or {}).get("primaryPhone"),
        "website": loc.get("websiteUri"),
        "address": ", ".join([*lines, addr.get("locality", ""), addr.get("postalCode", "")]).strip(", ") or None,
        "area": lines[-1] if lines else None,
        "city": addr.get("locality"),
        "lat": latlng.get("latitude"), "lng": latlng.get("longitude"),
        "place_id": meta.get("placeId"),
        "verification": "verified" if meta.get("hasVoiceOfMerchant") else "unverified",
        "duplicate_listing": bool(meta.get("duplicateLocation")),
        "hours": loc.get("regularHours") or {},
        "gbp_location": loc.get("name"),
        "gbp_account": loc.get("account"),
    }


def import_location(db: Session, conn: GoogleConnection, loc: dict[str, Any], actor: str) -> Business:
    fields = location_to_fields(loc)
    b = db.scalar(select(Business).where(Business.gbp_location == fields["gbp_location"])) or Business(source="google", created_by=actor)
    for k, v in fields.items():
        if v not in (None, "", [], {}):
            setattr(b, k, v)
    b.connection_id = conn.id
    db.add(b)
    db.flush()
    return b


def sync_business(db: Session, b: Business, days: int = 30) -> dict[str, Any]:
    """Pull reviews, photo count and daily insights for one connected business."""
    if not (b.connection and b.gbp_account and b.gbp_location):
        raise GbpError("This business is not linked to a connected Google account.")
    client = GbpClient(b.connection)
    reviews = client.reviews(b.gbp_account, b.gbp_location)
    added = 0
    for rv in reviews:
        ext = rv.get("reviewId") or rv.get("name")
        row = db.scalar(select(Review).where(Review.business_id == b.id, Review.external_id == ext))
        if not row:
            row = Review(business_id=b.id, external_id=ext)
            added += 1
        row.author = (rv.get("reviewer") or {}).get("displayName")
        row.rating = STAR.get(rv.get("starRating"), 0)
        row.body = rv.get("comment")
        row.review_date = datetime.fromisoformat(rv["createTime"].replace("Z", "+00:00")).date() if rv.get("createTime") else None
        if rv.get("reviewReply"):
            row.reply_text = rv["reviewReply"].get("comment")
            row.reply_status = "posted"
        row.sentiment = row.sentiment or ("positive" if row.rating >= 4 else "negative" if row.rating <= 2 else "neutral")
        db.add(row)
    b.review_count = len(reviews)
    b.rating = round(sum(STAR.get(r.get("starRating"), 0) for r in reviews) / len(reviews), 1) if reviews else None
    b.photo_count = client.media_count(b.gbp_account, b.gbp_location)
    end = date.today() - timedelta(days=2)  # performance data lags a few days
    for day, m in client.daily_metrics(b.gbp_location, end - timedelta(days=days), end).items():
        d = date.fromisoformat(day)
        row = db.get(InsightDay, (b.id, d)) or InsightDay(business_id=b.id, day=d)
        row.calls = m.get("CALL_CLICKS", 0)
        row.directions = m.get("BUSINESS_DIRECTION_REQUESTS", 0)
        row.website_clicks = m.get("WEBSITE_CLICKS", 0)
        row.views_search = m.get("BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", 0) + m.get("BUSINESS_IMPRESSIONS_MOBILE_SEARCH", 0)
        row.views_maps = m.get("BUSINESS_IMPRESSIONS_DESKTOP_MAPS", 0) + m.get("BUSINESS_IMPRESSIONS_MOBILE_MAPS", 0)
        row.bookings = m.get("BUSINESS_BOOKINGS", 0)
        db.add(row)
    b.connection.last_sync_at = datetime.now(timezone.utc)
    db.commit()
    return {"reviews": len(reviews), "new_reviews": added, "photos": b.photo_count}
