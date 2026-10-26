"""AI calls through an OpenAI-compatible API (DeepSeek, OpenAI or Gemini).

Every prompt is grounded in the business profile and carries the blueprint's rules: never
invent reviews, prices, credentials or statistics; keep the owner's tone; follow Google's
post and review-reply policies.
"""
import json
import re
from typing import Any

from openai import OpenAI

from ..config import get_settings

PROVIDERS = {
    "deepseek": ("https://api.deepseek.com", "deepseek_api_key", "deepseek-chat"),
    "gemini": ("https://generativelanguage.googleapis.com/v1beta/openai/", "gemini_api_key", "gemini-1.5-flash"),
    "openai": (None, "openai_api_key", "gpt-4o"),
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
    base, key_attr, model = PROVIDERS.get(s.ai_provider.lower(), PROVIDERS["openai"])
    return base, getattr(s, key_attr), model


def is_configured() -> bool:
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


def complete(system: str, user: str, *, json_mode: bool = False, temperature: float = 0.5, max_tokens: int = 1200) -> str:
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
