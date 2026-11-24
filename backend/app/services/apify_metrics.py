"""DA, PA (home page) and spam score for domains from Apify's `omkar-cloud/moz-domain-authority-checker` actor.

The tokens are APIFY_KEY, APIFY_KEY_1 ... APIFY_KEY_10 in the backend settings (never in code); a key that runs out of credit or hits its limit is skipped and the next one is used. Apify bills per run, so callers look up each SITE once. A site the actor does
not answer for is simply missing from the result: nothing is estimated.
"""
import logging
from datetime import datetime, timedelta, timezone
import threading
import time
from typing import Any

import httpx

from ..config import get_settings

log = logging.getLogger("seo.apify")
ACTOR = "omkar-cloud~moz-domain-authority-checker"
URL = f"https://api.apify.com/v2/actors/{ACTOR}/run-sync-get-dataset-items"
CHUNK = 4  # a few domains per run, so figures reach the page as each run ends


class ApifyError(Exception):
    pass


class NoKeyLeft(ApifyError):
    """Every configured key was refused (no credit, over its limit, or invalid): later runs would fail the same way."""


COOLDOWN = 1800  # seconds a refused key is left alone before it is tried again (credit is topped up, limits reset)
_cool: dict[int, float] = {}  # key number -> time it may be used again
_lock = threading.Lock()


def keys() -> list[tuple[int, str]]:
    """The configured tokens in order: APIFY_KEY, APIFY_KEY_1 ... APIFY_KEY_10 (numbered 0, 1 ... 10; empty ones are skipped)."""
    s = get_settings()
    found = [(n, str(getattr(s, "apify_key" if n == 0 else f"apify_key_{n}", "") or "").strip()) for n in range(0, 11)]
    return [(n, k) for n, k in found if k]


def configured() -> bool:
    return bool(keys())


def _num(v: Any) -> int | None:
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return None


def as_scores(x: dict[str, Any]) -> dict[str, Any] | None:
    da = _num(x.get("domain_authority"))
    if da is None:
        return None
    return {"da": da, "pa": _num(x.get("home_page_authority")), "spam": _num(x.get("spam_score")), "rd": _num(x.get("linking_root_domains")), "source": "Apify", "site_level": True}


def _run(token: str, domains: list[str]) -> list[dict[str, Any]]:
    try:
        r = httpx.post(URL, json={"domains": domains}, headers={"Authorization": f"Bearer {token}"}, timeout=150)
    except httpx.HTTPError as exc:
        raise ApifyError("Apify could not be reached.") from exc
    if r.status_code in (401, 402, 403, 429):
        raise _Refused(r.status_code)
    if r.status_code >= 300:
        raise ApifyError(f"Apify answered {r.status_code}.")
    try:
        rows = r.json()
    except ValueError as exc:
        raise ApifyError("Apify sent an unreadable answer.") from exc
    return [x for x in rows if isinstance(x, dict)] if isinstance(rows, list) else []


class _Refused(Exception):
    def __init__(self, code: int):
        self.code = code


def lookup(domains: list[str]) -> list[dict[str, Any]]:
    """One actor run for these domains. A key Apify refuses (out of credit, over its limit, invalid) is set aside for a while and the next key is used.
    Raises NoKeyLeft when every key was refused, ApifyError for any other failure. Keys are never put in messages: they are called "key 2" and so on."""
    ks = keys()
    if not ks:
        raise ApifyError("APIFY_KEY is not set in the backend settings.")
    now = time.time()
    with _lock:
        ready = [(n, k) for n, k in ks if _cool.get(n, 0) <= now]
    why: list[str] = []
    for n, token in ready:
        try:
            return _run(token, domains)
        except _Refused as e:
            with _lock:
                _cool[n] = time.time() + COOLDOWN
            why.append(f"key {n or 'main'}: " + {401: "invalid token", 402: "out of credit", 403: "limit reached or not allowed", 429: "too many requests"}[e.code])
            log.warning("Apify key %s refused (HTTP %s); trying the next key", n, e.code)
    if not ready:
        why = [f"key {n or 'main'}: waiting after a refusal" for n, _ in ks]
    raise NoKeyLeft("No Apify key could be used (" + "; ".join(why) + ").")


def ttl() -> timedelta:
    return timedelta(hours=max(1, get_settings().apify_cache_hours))


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def cached(domains: list[str]) -> dict[str, dict[str, Any] | None]:
    """Domains Apify was already asked about within the last 24 h (APIFY_CACHE_HOURS): {domain: scores}, or {domain: None} when Apify had no figures for it then.
    Figures do not change within a day, so these are never paid for twice."""
    from sqlalchemy import select

    from ..backlinks.models import BiDomainMetric
    from ..db import SessionLocal
    db = SessionLocal()
    try:
        limit = datetime.now(timezone.utc) - ttl()
        out: dict[str, dict[str, Any] | None] = {}
        for m in db.scalars(select(BiDomainMetric).where(BiDomainMetric.domain.in_(domains or [""]), BiDomainMetric.source == "apify")):
            if m.fetched_at and _aware(m.fetched_at) >= limit:
                out[m.domain] = {"da": m.da, "pa": m.pa, "spam": m.spam_score, "rd": m.linking_domains, "source": "Apify", "site_level": True} if m.da is not None else None
        return out
    except Exception:  # noqa: BLE001 - a cache that cannot be read only means asking Apify
        db.rollback()
        return {}
    finally:
        db.close()


def _remember(domain: str, sc: dict[str, Any] | None) -> None:
    """Save what Apify answered (or that it had nothing) so the same domain is not asked again for 24 h."""
    from sqlalchemy import select

    from ..backlinks.models import BiDomainMetric
    from ..db import SessionLocal
    db = SessionLocal()
    try:
        m = db.scalar(select(BiDomainMetric).where(BiDomainMetric.domain == domain)) or BiDomainMetric(domain=domain)
        m.da, m.pa, m.spam_score, m.fetched_at, m.source = (sc or {}).get("da"), (sc or {}).get("pa"), (sc or {}).get("spam"), datetime.now(timezone.utc), "apify"
        m.linking_domains = (sc or {}).get("rd")
        db.add(m)
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
    finally:
        db.close()


def check(domains: list[str], on_result=None, force: bool = False, save: bool = True) -> list[dict[str, Any]]:
    """Figures for every domain; on_result({"domain", "scores"|"error"}) is called per domain as it is known.
    A domain asked about in the last 24 h is answered from the saved figures and Apify is not called (force=True skips that). Only real answers are saved:
    a refused key or a network failure is never remembered, so the next press tries again."""
    out: list[dict[str, Any]] = []

    def emit(res: dict[str, Any]) -> None:
        out.append(res)
        if on_result:
            on_result(res)
    domains = list(dict.fromkeys(domains))
    seen = {} if force else cached(domains)
    for d in domains:
        if d in seen:
            emit({"domain": d, "scores": seen[d], "cached": True} if seen[d] else {"domain": d, "error": "Apify had no figures for this site when it was asked less than a day ago", "cached": True})
    todo = [d for d in domains if d not in seen]
    for i in range(0, len(todo), CHUNK):
        part = todo[i:i + CHUNK]
        got: dict[str, dict[str, Any]] = {}
        err, stop = None, False
        try:
            for x in lookup(part):
                d = str(x.get("domain") or "").lower().removeprefix("www.")
                sc = as_scores(x)
                if d and sc:
                    got[d] = sc
        except ApifyError as exc:
            err, stop = str(exc), isinstance(exc, NoKeyLeft)
        for d in part:
            if got.get(d):
                if save:
                    _remember(d, got[d])
                emit({"domain": d, "scores": got[d]})
            else:
                if err is None and save:
                    _remember(d, None)  # Apify answered but had nothing for this site: do not pay to ask again today
                emit({"domain": d, "error": err or "Apify has no figures for this site"})
        if stop:  # every key was refused: later runs would fail the same way
            for d in todo[i + CHUNK:]:
                emit({"domain": d, "error": err})
            break
    return out
