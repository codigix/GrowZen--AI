"""Page X-Ray: full page weight and colour contrast (a real Lighthouse run through Google PageSpeed Insights).

POST /businesses/{id}/page-xray/lighthouse   {url, strategy: mobile|desktop}
It takes 20 to 60 seconds. Google fetches the page itself, so only public web addresses work; private and internal addresses are refused here first.
"""
import re
import time
from collections import defaultdict, deque
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..auth import User, current_user
from ..deps import get_business
from ..models import Business
from ..services import page_xray_lighthouse as lighthouse, pagespeed, ratelimit
from ..services.url_safety import SSRFValidationError, resolve_and_validate, validate_url_shape

router = APIRouter(prefix="/businesses/{business_id}/page-xray", tags=["page-xray"])

LIMIT, WINDOW, TTL = 10, 3600, 1800  # 10 runs per user per hour; a result is reused for 30 minutes
_hits = ratelimit.Hits("page_xray_lighthouse")
_cache: dict[tuple, tuple[float, dict[str, Any]]] = {}


class LighthouseIn(BaseModel):
    url: str = Field(min_length=4, max_length=2000)
    strategy: Literal["mobile", "desktop"] = "mobile"


@router.post("/lighthouse")
def page_lighthouse(body: LighthouseIn, request: Request, b: Business = Depends(get_business), user: User = Depends(current_user)):
    url = body.url.strip()
    if not url.lower().startswith(("http://", "https://")):
        if re.match(r"^[a-z][a-z0-9+.-]*:(?!\d)", url, re.I) or "://" in url:  # javascript:, file:, ftp:// ... are not web pages (host:8080 still is)
            raise HTTPException(422, "Enter a web address that starts with http:// or https://.")
        url = f"https://{url}"
    try:
        validate_url_shape(url)
        resolve_and_validate(url)  # private, loopback and metadata addresses are refused (PageSpeed could not reach them anyway)
    except SSRFValidationError as exc:
        raise HTTPException(422, str(exc)) from exc
    key = (user.id, url, body.strategy)
    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit[0] < TTL:
        return hit[1]
    if not _hits.hit(str(user.id), LIMIT, WINDOW):
        raise HTTPException(429, "Too many Lighthouse runs: wait a few minutes. Each one takes up to a minute and uses Google's quota.")
    try:
        result = lighthouse.measure(url, body.strategy)
    except pagespeed.PageSpeedQuotaError as exc:
        raise HTTPException(429, str(exc)) from exc
    except pagespeed.PageSpeedTimeoutError as exc:
        raise HTTPException(504, "Lighthouse took too long to answer. Try again, or use the mobile setting.") from exc
    except pagespeed.PageSpeedError as exc:
        raise HTTPException(502, str(exc)) from exc
    _cache[key] = (now, result)
    return result
