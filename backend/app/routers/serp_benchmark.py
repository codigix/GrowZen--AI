"""POST /businesses/{id}/articles/serp-benchmark: the real top Google results for a keyword, measured (see services/serp_benchmark.py)."""
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import User, current_user
from ..competitors import intel
from ..deps import get_business
from ..models import Business
from ..services import serp_benchmark

router = APIRouter(prefix="/businesses/{business_id}/articles", tags=["articles"])

_hits: dict[str, deque] = defaultdict(deque)  # user id -> recent call times
LIMIT, WINDOW = 20, 3600  # 20 benchmarks per hour per user: each one costs a Serper credit and fetches several pages


class BenchmarkIn(BaseModel):
    keyword: str = Field(min_length=2, max_length=160)


@router.post("/serp-benchmark")
def serp_benchmark_route(body: BenchmarkIn, b: Business = Depends(get_business), user: User = Depends(current_user)):
    if not intel.serper_enabled():
        raise HTTPException(503, "The Google results benchmark needs SERPER_API_KEY on the backend. Nothing is estimated without it.")
    now, q = time.time(), _hits[str(user.id)]
    while q and now - q[0] > WINDOW:
        q.popleft()
    if len(q) >= LIMIT:
        raise HTTPException(429, "You have run the benchmark 20 times in the last hour. Please wait a while.")
    q.append(now)
    try:
        return serp_benchmark.benchmark(b, body.keyword)
    except intel.IntelError as exc:
        raise HTTPException(502, str(exc)) from exc
