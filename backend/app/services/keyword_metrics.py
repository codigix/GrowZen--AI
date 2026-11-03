"""Real keyword numbers from the Google Ads Keyword Planner: monthly searches, CPC and a competition-based difficulty.

Soft by design: when Google Ads is not set up or a call fails, the keyword is left as it was (volume stays empty) and the
reason is returned, so a page can say why instead of showing invented figures. Answers are cached for a day per
keyword and country because Keyword Planner data moves monthly.
"""
import logging
import threading
import time

from ..config import get_settings
from . import google_ads_client as ads

log = logging.getLogger("seo.keyword_metrics")
TTL = 24 * 3600
BATCH = 700  # Keyword Planner accepts up to 1000 keywords per request
_cache: dict[tuple[str, str], tuple[float, dict]] = {}
_lock = threading.Lock()


def enabled() -> bool:
    return get_settings().google_ads_enabled


def lookup(keywords: list[str], country: str | None = None) -> tuple[dict[str, dict], str | None]:
    """({keyword: {volume, cpc, difficulty, competition}}, reason-if-unavailable)."""
    wanted = list(dict.fromkeys(" ".join(k.lower().split()) for k in keywords if k and k.strip()))
    if not wanted:
        return {}, None
    if not enabled():
        return {}, "Google Ads Keyword Planner is not set up (GOOGLE_ADS_* in the backend .env), so search volume is not available."
    cc = (country or "IN").upper()
    now = time.time()
    found: dict[str, dict] = {}
    todo: list[str] = []
    with _lock:
        for k in wanted:
            hit = _cache.get((cc, k))
            if hit and now - hit[0] < TTL:
                found[k] = hit[1]
            else:
                todo.append(k)
    reason = None
    for i in range(0, len(todo), BATCH):
        chunk = todo[i:i + BATCH]
        try:
            got = ads.historical_metrics(chunk, geo_target=ads.geo_target_for(cc))
        except ads.GoogleAdsError as exc:
            reason = "Google Ads did not answer: " + ("; ".join(getattr(exc, "details", []) or []) or str(exc))[:200]
            break
        with _lock:
            for k in chunk:
                m = got.get(k) or {"volume": 0, "competition": "UNSPECIFIED", "competition_index": 0, "cpc": None}
                row = {"volume": m["volume"], "cpc": m["cpc"], "competition": m["competition"],
                       "difficulty": m["competition_index"] if m["competition"] != "UNSPECIFIED" else None}
                _cache[(cc, k)] = (now, row)
                found[k] = row
    return found, reason


def fill(keywords: list, country: str | None = None) -> str | None:
    """Fill volume / cpc / difficulty on Keyword rows that lack them. Returns why it could not, or None."""
    need = [k for k in keywords if k.volume is None]
    if not need:
        return None
    data, reason = lookup([k.keyword for k in need], country)
    for k in need:
        m = data.get(k.keyword)
        if m:
            k.volume = m["volume"]
            if k.cpc is None:
                k.cpc = m["cpc"]
            if k.difficulty is None:
                k.difficulty = m["difficulty"]
    return reason
