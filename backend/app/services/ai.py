"""AI calls through an OpenAI-compatible API (DeepSeek, OpenAI, Gemini) or Anthropic Claude.

Every prompt is grounded in the business profile and carries the blueprint's rules: never
invent reviews, prices, credentials or statistics; keep the owner's tone; follow Google's
post and review-reply policies.
"""
import json
import re
from typing import Any

import httpx
from openai import OpenAI

from ..config import get_settings

PROVIDERS = {
    "deepseek": ("https://api.deepseek.com", "deepseek_api_key", "deepseek-chat"),
    "gemini": ("https://generativelanguage.googleapis.com/v1beta/openai/", "gemini_api_key", "gemini-1.5-flash"),
    "openai": (None, "openai_api_key", "gpt-4o"),
    "claude": ("https://api.anthropic.com", "anthropic_api_key", "claude-haiku-5-5"),
    "anthropic": ("https://api.anthropic.com", "anthropic_api_key", "claude-haiku-5-5"),
}

RULES = """Rules you must follow:
- Use ONLY facts given to you. Never invent reviews, prices, credentials, awards, years in business, statistics or guarantees.
- If a needed fact is missing, write [add ...] as a placeholder instead of guessing.
- Keep the owner's tone. No keyword stuffing. Never promise rankings.
- Follow Google Business Profile policies: no phone numbers or URLs inside post text."""


class AiUnavailable(RuntimeError):
    pass


def _config() -> tuple[str | None, str, str]:
    s = get_settings()
    prov = s.ai_provider.lower()
    if prov in ("claude", "anthropic"):
        return "https://api.anthropic.com", s.anthropic_api_key, "claude-haiku-5-5"
    base, key_attr, model = PROVIDERS.get(prov, PROVIDERS["openai"])
    return base, getattr(s, key_attr), model


def is_configured() -> bool:
    s = get_settings()
    prov = s.ai_provider.lower()
    if prov in ("claude", "anthropic"):
        return bool(s.anthropic_api_key)
    if s.anthropic_api_key and not getattr(s, PROVIDERS.get(prov, ("", "openai_api_key", ""))[1], None):
        return True
    return bool(_config()[1])


_client: OpenAI | None = None


def _get_client() -> tuple[OpenAI, str]:
    global _client
    base, key, model = _config()
    if not key:
        raise AiUnavailable(f"AI is not set up: add the API key for '{get_settings().ai_provider}' to .env")
    if _client is None:
        _client = OpenAI(base_url=base, api_key=key, timeout=60)
    return _client, model


def _complete_anthropic(system: str, user: str, *, json_mode: bool = False, max_tokens: int = 1500) -> str:
    s = get_settings()
    key = s.anthropic_api_key
    if not key:
        raise AiUnavailable("Claude AI is not set up: add ANTHROPIC_API_KEY to .env")

    sys_prompt = system
    if json_mode:
        sys_prompt += "\n\nCRITICAL: Respond ONLY with a valid JSON object. Do not include markdown code block syntax (like ```json), commentary, or other surrounding text."

    headers = {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
    }
    # Note: claude-haiku-5-5 requires thinking disabled for fast direct text completion without token exhaustion
    body = {
        "model": "claude-haiku-5-5",
        "max_tokens": max_tokens,
        "thinking": {"type": "disabled"},
        "system": sys_prompt,
        "messages": [{"role": "user", "content": user}]
    }
    with httpx.Client(timeout=60) as http:
        r = http.post("https://api.anthropic.com/v1/messages", headers=headers, json=body)
        if r.status_code != 200:
            raise AiUnavailable(f"Claude API error ({r.status_code}): {r.text}")
        data = r.json()
        parts = [c.get("text", "") for c in data.get("content", []) if c.get("type") == "text"]
        return "".join(parts).strip()


def complete(system: str, user: str, *, json_mode: bool = False, temperature: float = 0.5, max_tokens: int = 1500) -> str:
    s = get_settings()
    prov = s.ai_provider.lower()
    if prov in ("claude", "anthropic") or (s.anthropic_api_key and not getattr(s, PROVIDERS.get(prov, ("", "openai_api_key", ""))[1], None)):
        return _complete_anthropic(system, user, json_mode=json_mode, max_tokens=max_tokens)

    client, model = _get_client()
    kwargs: dict[str, Any] = {"model": model, "temperature": temperature, "max_tokens": max_tokens,
                              "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    r = client.chat.completions.create(**kwargs)
    return (r.choices[0].message.content or "").strip()


def complete_json(system: str, user: str, **kw: Any) -> dict[str, Any]:
    return parse_json(complete(system, user, json_mode=True, **kw))


def parse_json(text: str) -> dict[str, Any]:
    t = text.strip()
    t = re.sub(r"^```(json)?", "", t).strip()
    t = re.sub(r"```$", "", t).strip()
    return json.loads(t)


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
