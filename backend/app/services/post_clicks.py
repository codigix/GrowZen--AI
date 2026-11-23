"""Clicks on a Google post's button, counted from Google Analytics.

Google no longer reports per-post insights through its API (the localPosts:reportInsights call answers 404), so the clicks are counted another way: the button link of every post this
software publishes carries a campaign tag (utm_campaign=gbp-post-<id>). Google Analytics records a visit that arrives with that tag under the campaign name, and this reads those
counts back per post. A post published before the tag existed, or made outside this software, has no count (it is shown as such, not as zero).
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

PREFIX = "gbp-post-"


def tag_url(url: str | None, post_id: int) -> str | None:
    """The post's button link with its campaign tag (an own tag already on the link is kept: nothing is overwritten)."""
    if not url or not re.match(r"^https?://", url.strip(), re.I):
        return url
    parts = urlsplit(url.strip())
    q = parse_qsl(parts.query, keep_blank_values=True)
    have = {k for k, _ in q}
    for k, v in (("utm_source", "google"), ("utm_medium", "business-profile-post"), ("utm_campaign", f"{PREFIX}{post_id}")):
        if k not in have:
            q.append((k, v))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(q), parts.fragment))


def post_id_of(campaign: str | None) -> int | None:
    m = re.fullmatch(rf"{re.escape(PREFIX)}(\d+)", (campaign or "").strip())
    return int(m.group(1)) if m else None


def counts(ga: Any, prop: str, days: int = 90) -> dict[int, dict[str, int]]:
    """{post id: {"visits": sessions that arrived from that post's button, "users": people}} over the last `days` days."""
    end = date.today()
    body = {"dateRanges": [{"startDate": (end - timedelta(days=days)).isoformat(), "endDate": end.isoformat()}], "dimensions": [{"name": "sessionCampaignName"}],
            "metrics": [{"name": "sessions"}, {"name": "activeUsers"}], "limit": 500,
            "dimensionFilter": {"filter": {"fieldName": "sessionCampaignName", "stringFilter": {"matchType": "BEGINS_WITH", "value": PREFIX}}}}
    out: dict[int, dict[str, int]] = {}
    for r in ga.run(prop, body):
        pid = post_id_of(r.get("sessionCampaignName"))
        if pid is not None:
            out[pid] = {"visits": int(r.get("sessions") or 0), "users": int(r.get("activeUsers") or 0)}
    return out
