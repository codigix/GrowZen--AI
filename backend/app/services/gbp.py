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
  Verifications        mybusinessverifications.googleapis.com/v1/{location}/VoiceOfMerchantState
"""
import secrets
import time
from concurrent.futures import ThreadPoolExecutor
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
VERIFY = "https://mybusinessverifications.googleapis.com/v1"
READ_MASK = "name,title,storefrontAddress,phoneNumbers,categories,websiteUri,latlng,metadata,profile,regularHours,specialHours,moreHours,serviceItems,serviceArea,labels,openInfo"
OPEN_STATUS = {"OPEN": "open", "CLOSED_TEMPORARILY": "closed_temporarily", "CLOSED_PERMANENTLY": "closed_permanently"}
STAR = {"ONE": 1, "TWO": 2, "THREE": 3, "FOUR": 4, "FIVE": 5}


class GbpError(RuntimeError):
    pass


def _redirect_uri() -> str:
    s = get_settings()
    return f"{s.public_base_url.rstrip('/')}{s.api_prefix}/connections/google/callback"


def _state_secret() -> str:
    """Signs the Google sign-in `state`. The app's own secret always exists; CRM_JWT_SECRET is optional."""
    return get_settings().secret_key


GSC_SCOPES = "openid email profile https://www.googleapis.com/auth/webmasters.readonly"


def auth_url(user_id: str, purpose: str = "gbp") -> str:
    s = get_settings()
    if not s.google_oauth_enabled:
        raise GbpError("Google sign-in is not set up: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.")
    if not s.token_encryption_key:
        raise GbpError("Add TOKEN_ENCRYPTION_KEY to the backend settings first: it encrypts the stored Google access.")
    state = jwt.encode({"sub": user_id, "purpose": purpose, "nonce": secrets.token_urlsafe(8), "exp": int(time.time()) + 600}, _state_secret(), algorithm="HS256")
    scope = GSC_SCOPES if purpose == "gsc" else f"{SCOPES} https://www.googleapis.com/auth/webmasters.readonly"  # a Business Profile sign-in also grants Search Console
    return f"{AUTH_URL}?{urlencode({'client_id': s.google_client_id, 'redirect_uri': _redirect_uri(), 'response_type': 'code', 'scope': scope, 'access_type': 'offline', 'prompt': 'consent', 'include_granted_scopes': 'true', 'state': state})}"


def read_purpose(state: str) -> str:
    try:
        return str(jwt.decode(state, _state_secret(), algorithms=["HS256"]).get("purpose") or "gbp")
    except jwt.InvalidTokenError:
        return "gbp"


def read_state(state: str) -> str:
    try:
        return str(jwt.decode(state, _state_secret(), algorithms=["HS256"])["sub"])
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

    def location(self, name: str) -> dict[str, Any]:
        return self._req("GET", f"{INFO}/{name}", params={"readMask": READ_MASK})

    def voice_of_merchant(self, name: str) -> dict[str, Any] | None:
        """Google's verification state for a location, or None when the Verifications API can't be read
        (not enabled for the project): callers then fall back to the location's metadata."""
        try:
            return self._req("GET", f"{VERIFY}/{name}/VoiceOfMerchantState")
        except GbpError:
            return None

    def all_locations(self, with_status: bool = True) -> list[dict[str, Any]]:
        """Every location of every account the user can see, with the account's name, type and the
        user's role, and (with_status) each location's verification state."""
        found = []
        for acc in self.accounts():
            for loc in self.locations(acc["name"]):
                found.append({"account": acc["name"], "account_role": acc.get("role"), "account_name": acc.get("accountName"),
                              "account_type": acc.get("type"), **loc})
        if with_status and found:
            with ThreadPoolExecutor(max_workers=6) as pool:
                for loc, vom in zip(found, pool.map(lambda l: self.voice_of_merchant(l["name"]), found)):
                    loc["voice_of_merchant"] = vom
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

    def attributes(self, location: str) -> list[dict[str, Any]]:
        return self._req("GET", f"{INFO}/{location}/attributes").get("attributes", [])

    def media(self, account: str, location: str, limit: int = 100) -> list[dict[str, Any]]:
        out, token = [], None
        while True:
            d = self._req("GET", f"{V4}/{account}/{location}/media", params={"pageSize": 100, **({"pageToken": token} if token else {})})
            out += d.get("mediaItems", [])
            token = d.get("nextPageToken")
            if not token or len(out) >= limit:
                return out[:limit]

    def local_posts(self, account: str, location: str, limit: int = 50) -> list[dict[str, Any]]:
        out, token = [], None
        while True:
            d = self._req("GET", f"{V4}/{account}/{location}/localPosts", params={"pageSize": 100, **({"pageToken": token} if token else {})})
            out += d.get("localPosts", [])
            token = d.get("nextPageToken")
            if not token or len(out) >= limit:
                return out[:limit]

    def search_keywords(self, location: str, months: int = 3) -> list[dict[str, Any]]:
        """The searches people used to find the profile, by month (Performance API); small counts come as a threshold."""
        end = date.today().replace(day=1) - timedelta(days=1)  # the last full month
        start = (end.replace(day=1) - timedelta(days=31 * (months - 1))).replace(day=1)
        params = [("monthlyRange.start_month.year", start.year), ("monthlyRange.start_month.month", start.month),
                  ("monthlyRange.end_month.year", end.year), ("monthlyRange.end_month.month", end.month), ("pageSize", 100)]
        out, token = [], None
        while True:
            d = self._req("GET", f"{PERF}/{location}/searchkeywords/impressions/monthly", params=params + ([("pageToken", token)] if token else []))
            out += d.get("searchKeywordsCounts", [])
            token = d.get("nextPageToken")
            if not token or len(out) >= 300:
                return out

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
    "mybusinessverifications": "My Business Verifications API",
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
        "configured": s.google_oauth_enabled and bool(s.token_encryption_key),
        "oauth_client": s.google_oauth_enabled,
        "token_key": bool(s.token_encryption_key),  # needed to store the Google refresh token encrypted
        "client_id": (s.google_client_id[:16] + "...") if s.google_client_id else None,
        "redirect_uri": _redirect_uri(),
        "scopes": SCOPES.split(),
        "apis": list(API_NAMES.values()),
        "access_form": ACCESS_FORM,
    }


VERIFICATION_TEXT = {
    "verified": "Verified: the listing shows on Google Search and Maps.",
    "pending": "Verification in progress: Google is reviewing it or a code is on its way.",
    "unverified": "Not verified: verify it so it can appear in the Map Pack.",
    "suspended": "Suspended by Google: fix the guideline issue and request reinstatement.",
    "disabled": "Disabled by Google: the listing is hidden. Contact Google Business Profile support.",
    "conflict": "Someone else has verified this listing: request ownership from Google.",
    "unknown": "Google didn't report a verification state.",
}


def verification_state(vom: dict[str, Any] | None, meta: dict[str, Any]) -> str:
    """Google's VoiceOfMerchantState -> verified | pending | unverified | suspended | disabled | conflict.
    Without it (Verifications API not enabled), only verified / unverified from the location metadata."""
    if vom is None:
        return "verified" if meta.get("hasVoiceOfMerchant") else "unverified"
    if "complyWithGuidelines" in vom:
        reason = (vom.get("complyWithGuidelines") or {}).get("recommendationReason")
        return "disabled" if reason == "BUSINESS_LOCATION_DISABLED" else "suspended"
    if "resolveOwnershipConflict" in vom:
        return "conflict"
    if vom.get("hasVoiceOfMerchant"):
        return "verified"
    if "waitForVoiceOfMerchant" in vom or (vom.get("verify") or {}).get("hasPendingVerification"):
        return "pending"
    return "unverified"


def listing_status(loc: dict[str, Any]) -> dict[str, Any]:
    """The listing's live state, kept on the business as gbp_status."""
    meta = loc.get("metadata") or {}
    state = verification_state(loc.get("voice_of_merchant"), meta)
    return {
        "verification": state, "verification_text": VERIFICATION_TEXT[state],
        "verification_source": "google" if loc.get("voice_of_merchant") is not None else "metadata",
        "open_status": OPEN_STATUS.get((loc.get("openInfo") or {}).get("status"), "unknown"),
        "pending_edits": bool(meta.get("hasPendingEdits")), "google_updated": bool(meta.get("hasGoogleUpdated")),
        "duplicate": bool(meta.get("duplicateLocation")), "can_post": meta.get("canOperateLocalPost"),
        "maps_url": meta.get("mapsUri"), "review_url": meta.get("newReviewUri"),
        "account_name": loc.get("account_name"), "account_role": loc.get("account_role"), "account_type": loc.get("account_type"),
        "checked_at": datetime.now(timezone.utc).isoformat(),
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
        "verification": verification_state(loc.get("voice_of_merchant"), meta),
        "duplicate_listing": bool(meta.get("duplicateLocation")),
        "hours": loc.get("regularHours") or {},
        "gbp_location": loc.get("name"),
        "gbp_account": loc.get("account"),
        "gbp_status": listing_status(loc),
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


def refresh_status(client: GbpClient, b: Business) -> dict[str, Any]:
    """Re-read the listing's state from Google (verification, open status, pending edits, links)."""
    loc = client.location(b.gbp_location) | {"voice_of_merchant": client.voice_of_merchant(b.gbp_location)}
    status = listing_status(loc) | {k: (b.gbp_status or {}).get(k) for k in ("account_name", "account_role", "account_type", "live")}
    b.verification, b.duplicate_listing, b.gbp_status = status["verification"], status["duplicate"], status
    return status


def _hhmm(t: dict[str, Any] | None) -> str | None:
    return f"{int((t or {}).get('hours', 0)):02d}:{int((t or {}).get('minutes', 0)):02d}" if t is not None else None


def special_hours_from(loc: dict[str, Any]) -> list[dict[str, Any]]:
    """Google specialHours -> the app's [{date, name, closed, open, close}]."""
    out = []
    for p in (loc.get("specialHours") or {}).get("specialHourPeriods", []):
        d = p.get("startDate") or {}
        if not d:
            continue
        out.append({"date": f"{d['year']:04d}-{d['month']:02d}-{d['day']:02d}", "name": "Special hours", "closed": bool(p.get("closed")),
                    "open": _hhmm(p.get("openTime")), "close": _hhmm(p.get("closeTime"))})
    return sorted(out, key=lambda x: x["date"])


def _media_item(m: dict[str, Any]) -> dict[str, Any]:
    return {"id": m.get("name"), "type": m.get("mediaFormat"), "url": m.get("googleUrl"), "thumb": m.get("thumbnailUrl"), "created": m.get("createTime"),
            "category": (m.get("locationAssociation") or {}).get("category") or (m.get("locationAssociation") or {}).get("priceListItemId"),
            "views": int((m.get("insights") or {}).get("viewCount") or 0), "description": m.get("description")}


def _post_item(p: dict[str, Any]) -> dict[str, Any]:
    cta = p.get("callToAction") or {}
    return {"id": p.get("name"), "type": p.get("topicType"), "state": p.get("state"), "summary": p.get("summary"), "created": p.get("createTime"), "updated": p.get("updateTime"),
            "url": p.get("searchUrl"), "cta": cta.get("actionType"), "cta_url": cta.get("url"), "image": next((m.get("googleUrl") for m in p.get("media") or [] if m.get("googleUrl")), None),
            "title": (p.get("event") or {}).get("title")}


def _keyword_item(k: dict[str, Any]) -> dict[str, Any]:
    v = k.get("insightsValue") or {}
    return {"keyword": k.get("searchKeyword"), "impressions": int(v["value"]) if v.get("value") is not None else None, "below": int(v["threshold"]) if v.get("threshold") is not None else None}


def _attribute_item(a: dict[str, Any]) -> dict[str, Any]:
    return {"id": a.get("name", "").split("/")[-1], "values": a.get("values") or [], "type": a.get("valueType")}


def fetch_live(client: "GbpClient", b: Business, loc: dict[str, Any]) -> dict[str, Any]:
    """Everything else Google holds about the listing, read live: photos, posts, attributes, services, special
    hours and the searches that found it. A part Google refuses (API not approved or enabled) is recorded
    under `errors` and the rest still loads."""
    parts: dict[str, Any] = {
        "media": lambda: [_media_item(m) for m in client.media(b.gbp_account, b.gbp_location)],
        "posts": lambda: [_post_item(p) for p in client.local_posts(b.gbp_account, b.gbp_location)],
        "attributes": lambda: [_attribute_item(a) for a in client.attributes(b.gbp_location)],
        "search_keywords": lambda: sorted((_keyword_item(k) for k in client.search_keywords(b.gbp_location)), key=lambda k: -(k["impressions"] or 0)),
    }
    live: dict[str, Any] = {"errors": {}}
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {name: pool.submit(fn) for name, fn in parts.items()}
        for name, fut in futures.items():
            try:
                live[name] = fut.result()
            except GbpError as exc:
                live[name], live["errors"][name] = [], str(exc)[:240]
    live["special_hours"] = special_hours_from(loc)
    live["more_hours"] = (loc.get("moreHours") or [])
    live["service_items"] = [{"name": ((i.get("structuredServiceItem") or {}).get("serviceTypeId") or (i.get("freeFormServiceItem") or {}).get("label", {}).get("displayName") or ""),
                              "description": ((i.get("freeFormServiceItem") or {}).get("label") or {}).get("description"),
                              "price": i.get("price")} for i in loc.get("serviceItems") or []]
    live["labels"] = loc.get("labels") or []
    live["synced_at"] = datetime.now(timezone.utc).isoformat()
    return live


def sync_business(db: Session, b: Business, days: int = 30) -> dict[str, Any]:
    """Refresh the listing's status, then pull reviews, photo count and daily insights for one connected business."""
    if not (b.connection and b.gbp_account and b.gbp_location):
        raise GbpError("This business is not linked to a connected Google account.")
    client = GbpClient(b.connection)
    loc = client.location(b.gbp_location) | {"voice_of_merchant": client.voice_of_merchant(b.gbp_location)}
    # Google is the source of truth for a linked profile: bring its name, categories, contact, address and hours in.
    for k, v in location_to_fields(loc).items():
        if k not in ("gbp_status", "gbp_account", "gbp_location") and v not in (None, "", [], {}):
            setattr(b, k, v)
    status = listing_status(loc) | {k: (b.gbp_status or {}).get(k) for k in ("account_name", "account_role", "account_type")}
    live = fetch_live(client, b, loc)
    if live["special_hours"]:
        b.special_hours = live["special_hours"]
    b.verification, b.duplicate_listing, b.gbp_status = status["verification"], status["duplicate"], status | {"live": live}
    db.commit()
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
    if "media" not in live["errors"]:
        b.photo_count = len(live["media"])
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
    return {"reviews": len(reviews), "new_reviews": added, "photos": b.photo_count, "posts": len(live["posts"]), "keywords": len(live["search_keywords"]),
            "verification": status["verification"], "open_status": status["open_status"], "errors": live["errors"]}
