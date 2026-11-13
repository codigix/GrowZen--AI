"""POST /businesses/{id}/serp-xray: the live Google results for one search, measured (see services/serp_xray.py)."""
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import User, current_user
from ..competitors import intel
from ..deps import get_business
from ..models import Business
from ..services import serp_xray, ratelimit

router = APIRouter(prefix="/businesses/{business_id}", tags=["serp-xray"])

_hits = ratelimit.Hits("serp_xray")  # user id -> calls, shared by every server process
LIMIT, WINDOW = 20, 3600  # 20 X-Rays per hour per user: each one costs Serper credits and opens up to 10 pages


class XrayIn(BaseModel):
    keyword: str = Field(min_length=2, max_length=160)
    location: str | None = Field(default=None, max_length=160)


@router.post("/serp-xray")
def serp_xray_route(body: XrayIn, b: Business = Depends(get_business), user: User = Depends(current_user)):
    if not intel.serper_enabled():
        raise HTTPException(503, "SERP X-Ray needs SERPER_API_KEY on the backend. Nothing is estimated without it.")
    if not body.keyword.strip() or len(body.keyword.split()) > 20:
        raise HTTPException(422, "Enter a search of 1 to 20 words.")
    if not _hits.hit(str(user.id), LIMIT, WINDOW):
        raise HTTPException(429, "You have run SERP X-Ray 20 times in the last hour. Please wait a while.")
    try:
        return serp_xray.xray(b, str(user.id), body.keyword, body.location)
    except intel.IntelError as exc:
        raise HTTPException(502, str(exc)) from exc
