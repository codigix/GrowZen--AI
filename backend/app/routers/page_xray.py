"""Page X-Ray: POST /businesses/{id}/page-xray {url} reads one page (the project's own or any public page, such as a competitor's) and returns
its meta, structure, schema, technology, domain and certificate, and SEO / AEO / GEO check scores. Real fetched data only.

Abuse protection: public http(s) addresses only (SSRF guard in services/page_xray.py), 30 fresh X-Rays per user per hour, and a 10-minute cache per
(user, address, render) so repeating a check costs nothing. `render: true` also loads the page in headless Chrome: only for the project's own website,
and limited to 10 renders per user per hour.
"""
import time
from collections import defaultdict, deque
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import User, current_user
from ..deps import get_business
from ..models import Business
from ..services import page_xray as xray, ratelimit

router = APIRouter(prefix="/businesses/{business_id}/page-xray", tags=["page-xray"])

LIMIT, WINDOW = 30, 3600  # fresh (uncached) X-Rays per user per hour
RENDER_LIMIT = 10  # fresh Chrome renders per user per hour (a separate allowance: each one starts a browser)
CACHE_SECONDS = 600
_hits = ratelimit.Hits("page_xray")
_render_hits = ratelimit.Hits("page_xray_render")
_cache: dict[tuple[str, str, bool], tuple[float, dict[str, Any]]] = {}


class XrayIn(BaseModel):
    url: str = Field(min_length=3, max_length=2048)
    render: bool = False  # also read the page as Chrome renders it (the project's own website only)


def _throttle(user_id: str, render: bool = False) -> None:
    limit = RENDER_LIMIT if render else LIMIT
    if not (_render_hits if render else _hits).hit(user_id, limit, WINDOW):
        raise HTTPException(429, f"You can run {limit} {'rendered ' if render else ''}X-Rays per hour. Try again later.")


@router.post("")
def page_xray(body: XrayIn, b: Business = Depends(get_business), user: User = Depends(current_user)):
    try:
        url = xray.normalise_url(body.url)
        if body.render:
            xray.assert_own_site(url, b.website)  # refused before anything else: Chrome never visits another site
        key = (str(user.id), url, body.render)
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < CACHE_SECONDS:
            return hit[1]
        _throttle(str(user.id), body.render)  # only a real fetch counts
        result = xray.run(url, render=body.render, own_site=b.website)
    except xray.XrayError as exc:
        raise HTTPException(exc.status, exc.message) from exc
    if len(_cache) > 500:  # keep the cache small: drop what is already stale
        for k in [k for k, (t, _) in _cache.items() if time.time() - t >= CACHE_SECONDS]:
            _cache.pop(k, None)
    _cache[key] = (time.time(), result)
    return result
