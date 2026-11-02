"""AI calls through an OpenAI-compatible API (DeepSeek, OpenAI, Gemini) or Anthropic Claude.

Every prompt is grounded in the business profile and carries the blueprint's rules: never
invent reviews, prices, credentials or statistics; keep the owner's tone; follow Google's
post and review-reply policies.

Reliability: transient failures (rate limits, overloads, timeouts, 5xx) are retried with backoff, honouring Retry-After. If the chosen
provider still fails, the next configured provider is tried, so one vendor's outage does not take every AI feature down.
Claude's model comes from CLAUDE_MODEL (the same setting the article generator uses).
"""
import json
import logging
import random
import time
from typing import Any

import httpx
from openai import APIConnectionError, APIStatusError, APITimeoutError, OpenAI, RateLimitError

from ..config import get_settings

log = logging.getLogger("seo.ai")

PROVIDERS = {
    "deepseek": ("https://api.deepseek.com", "deepseek_api_key", "deepseek-chat"),
    "gemini": ("https://generativelanguage.googleapis.com/v1beta/openai/", "gemini_api_key", "gemini-1.5-flash"),
    "openai": (None, "openai_api_key", "gpt-4o"),
    "claude": ("https://api.anthropic.com", "anthropic_api_key", "claude-haiku-5-5"),
    "anthropic": ("https://api.anthropic.com", "anthropic_api_key", "claude-haiku-5-5"),
}
FALLBACK_ORDER = ("claude", "openai", "deepseek", "gemini")  # tried after the chosen provider, if they have a key
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
MAX_ATTEMPTS = 3
TIMEOUT_SECONDS = 60

RULES = """Rules you must follow:
- Use ONLY facts given to you. Never invent reviews, prices, credentials, awards, years in business, statistics or guarantees.
- If a needed fact is missing, write [add ...] as a placeholder instead of guessing.
- Keep the owner's tone. No keyword stuffing. Never promise rankings.
- Follow Google Business Profile policies: no phone numbers or URLs inside post text."""


class AiUnavailable(RuntimeError):
    """The AI could not answer. `retryable` marks transient failures worth another try."""

    def __init__(self, message: str, retryable: bool = False, retry_after: float | None = None):
        super().__init__(message)
        self.retryable = retryable
        self.retry_after = retry_after


def _norm(provider: str) -> str:
    p = (provider or "").lower()
    return "claude" if p in ("claude", "anthropic") else p


def _key_for(provider: str) -> str:
    s = get_settings()
    return getattr(s, PROVIDERS.get(_norm(provider), PROVIDERS["openai"])[1], "") or ""


def claude_model() -> str:
    return (getattr(get_settings(), "claude_model", "") or "claude-haiku-5-5").strip()


def _model_for(provider: str) -> str:
    return claude_model() if _norm(provider) == "claude" else PROVIDERS.get(_norm(provider), PROVIDERS["openai"])[2]


def provider_chain() -> list[str]:
    """The configured provider first, then every other provider that has an API key."""
    first = _norm(get_settings().ai_provider)
    chain = [first] if _key_for(first) else []
    chain += [p for p in FALLBACK_ORDER if p != first and _key_for(p)]
    return chain


def is_configured() -> bool:
    return bool(provider_chain())


_clients: dict[tuple[str | None, str], OpenAI] = {}


def _get_client(provider: str) -> OpenAI:
    base, key = PROVIDERS[_norm(provider)][0], _key_for(provider)
    if (base, key) not in _clients:  # keyed by credentials, so a changed key or provider takes effect without a restart
        _clients[(base, key)] = OpenAI(base_url=base, api_key=key, timeout=TIMEOUT_SECONDS, max_retries=0)  # retries are ours, below
    return _clients[(base, key)]


def _anthropic_post(body: dict[str, Any], key: str) -> httpx.Response:
    with httpx.Client(timeout=TIMEOUT_SECONDS) as http:
        return http.post(ANTHROPIC_URL, headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"}, json=body)


def _retry_after(r: httpx.Response) -> float | None:
    try:
        return max(0.0, min(float(r.headers.get("retry-after", "")), 30.0))
    except ValueError:
        return None


def _complete_anthropic(system: str, user: str, *, json_mode: bool = False, temperature: float = 0.5, max_tokens: int = 1500) -> str:
    key = _key_for("claude")
    if not key:
        raise AiUnavailable("Claude AI is not set up: add ANTHROPIC_API_KEY to .env")
    sys_prompt = system
    if json_mode:
        sys_prompt += "\n\nCRITICAL: Respond ONLY with a valid JSON object. Do not include markdown code block syntax (like ```json), commentary, or other surrounding text."
    body = {
        "model": claude_model(), "max_tokens": max_tokens,  # no `temperature`: current Claude models reject it (400 "deprecated for this model")
        "thinking": {"type": "disabled"},  # direct text answers; thinking would spend the token budget before any text
        "system": [{"type": "text", "text": sys_prompt, "cache_control": {"type": "ephemeral"}}],  # long shared prompts are cached across calls
        "messages": [{"role": "user", "content": user}],
    }
    try:
        r = _anthropic_post(body, key)
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        raise AiUnavailable(f"Claude is unreachable: {exc}", retryable=True) from exc
    if r.status_code != 200:
        try:
            detail = r.json().get("error", {}).get("message", "")
        except ValueError:
            detail = ""
        raise AiUnavailable(f"Claude API error ({r.status_code}){': ' + detail[:200] if detail else ''}",
                            retryable=r.status_code in (408, 409, 429, 500, 502, 503, 504, 529), retry_after=_retry_after(r))
    parts = [c.get("text", "") for c in r.json().get("content", []) if c.get("type") == "text"]
    return "".join(parts).strip()


def _complete_openai_compatible(provider: str, system: str, user: str, *, json_mode: bool, temperature: float, max_tokens: int) -> str:
    if not _key_for(provider):
        raise AiUnavailable(f"AI is not set up: add the API key for '{provider}' to .env")
    kwargs: dict[str, Any] = {"model": _model_for(provider), "temperature": temperature, "max_tokens": max_tokens,
                              "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    try:
        r = _get_client(provider).chat.completions.create(**kwargs)
    except (APITimeoutError, APIConnectionError) as exc:
        raise AiUnavailable(f"{provider} is unreachable: {exc}", retryable=True) from exc
    except RateLimitError as exc:
        raise AiUnavailable(f"{provider} rate limit reached", retryable=True) from exc
    except APIStatusError as exc:
        raise AiUnavailable(f"{provider} API error ({exc.status_code})", retryable=exc.status_code >= 500 or exc.status_code in (408, 409)) from exc
    return (r.choices[0].message.content or "").strip()


def _call(provider: str, system: str, user: str, **kw: Any) -> str:
    if _norm(provider) == "claude":
        return _complete_anthropic(system, user, **kw)
    return _complete_openai_compatible(provider, system, user, **kw)


def _with_retries(provider: str, system: str, user: str, sleep=time.sleep, **kw: Any) -> str:
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            return _call(provider, system, user, **kw)
        except AiUnavailable as exc:
            if not exc.retryable or attempt == MAX_ATTEMPTS:
                raise
            delay = exc.retry_after if exc.retry_after is not None else min(2 ** attempt, 8) * random.uniform(0.8, 1.2)
            log.warning("%s failed (%s); retrying in %.1fs (attempt %s/%s)", provider, exc, delay, attempt, MAX_ATTEMPTS)
            sleep(delay)
    raise AiUnavailable("unreachable")  # pragma: no cover


def complete(system: str, user: str, *, json_mode: bool = False, temperature: float = 0.5, max_tokens: int = 1500, sleep=time.sleep) -> str:
    chain = provider_chain()
    if not chain:
        raise AiUnavailable(f"AI is not set up: add the API key for '{get_settings().ai_provider}' to .env")
    last: AiUnavailable | None = None
    for provider in chain:
        started = time.monotonic()
        try:
            out = _with_retries(provider, system, user, sleep=sleep, json_mode=json_mode, temperature=temperature, max_tokens=max_tokens)
            log.info("AI %s/%s answered in %.1fs", provider, _model_for(provider), time.monotonic() - started)
            return out
        except AiUnavailable as exc:
            last = exc
            log.warning("AI provider %s failed: %s%s", provider, exc, "; trying the next provider" if provider != chain[-1] else "")
    raise last or AiUnavailable("AI is unavailable")


def complete_json(system: str, user: str, **kw: Any) -> dict[str, Any]:
    """A JSON answer. A reply that is not valid JSON gets one corrective retry before giving up."""
    text = complete(system, user, json_mode=True, **kw)
    try:
        return parse_json(text)
    except ValueError:
        fixed = complete(system, f"{user}\n\nYour previous reply was not valid JSON. Reply again with ONLY the JSON object, nothing else.", json_mode=True, **kw)
        return parse_json(fixed)


def parse_json(text: str) -> dict[str, Any]:
    """The first JSON object in `text`, tolerating markdown fences and chatter before or after it."""
    t = (text or "").strip()
    decoder = json.JSONDecoder()
    start = t.find("{")
    while start != -1:
        try:
            obj, _ = decoder.raw_decode(t[start:])
            if isinstance(obj, dict):
                return obj
        except ValueError:
            pass
        start = t.find("{", start + 1)
    raise ValueError("No JSON object found in the AI reply")


def profile_text(b: Any) -> str:
    """The business profile as plain text, for grounding prompts."""
    services = "; ".join(f"{s.get('name')}{' (' + s['price'] + ')' if s.get('price') else ''}" for s in (b.services or []) if s.get("name"))
    lines = [
        f"Business name: {b.name}",
        f"Primary category: {b.primary_category or ''}",
        f"Other categories: {', '.join(b.secondary_categories or [])}" if b.secondary_categories else "",
        f"Location: {', '.join(x for x in [b.address, b.area, b.city] if x)}" if (b.address or b.city) else "",
        f"Services: {services}" if services else "",
        f"Current description: {b.description}" if b.description else "",
        f"What makes them different (owner): {b.usps}" if b.usps else "",
        f"Tone of voice: {b.tone}" if b.tone else "",
    ]
    return "\n".join(x for x in lines if x)
