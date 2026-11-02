"""AI layer (app/services/ai.py): model setting, retries, provider fallback and JSON handling. No network."""
from types import SimpleNamespace

import httpx
import pytest

from app.services import ai


def _settings(**kw):
    base = dict(ai_provider="claude", anthropic_api_key="ak", openai_api_key="", deepseek_api_key="", gemini_api_key="", claude_model="claude-sonnet-5-5")
    base.update(kw)
    return SimpleNamespace(**base)


def _resp(status, body=None, headers=None):
    return httpx.Response(status, json=body if body is not None else {}, headers=headers or {})


OK = {"content": [{"type": "text", "text": "hello"}]}


def test_parse_json_tolerates_fences_and_chatter():
    assert ai.parse_json('{"a": 1}') == {"a": 1}
    assert ai.parse_json('```json\n{"a": [1, 2]}\n```') == {"a": [1, 2]}
    assert ai.parse_json('Sure! Here you go: {"a": {"b": 2}} Hope that helps.') == {"a": {"b": 2}}
    assert ai.parse_json('noise {not json} then {"ok": true}') == {"ok": True}
    with pytest.raises(ValueError):
        ai.parse_json("no object here")


def test_claude_model_comes_from_the_setting_and_reaches_the_request(monkeypatch):
    monkeypatch.setattr(ai, "get_settings", lambda: _settings())
    seen = {}
    monkeypatch.setattr(ai, "_anthropic_post", lambda body, key: (seen.update(body=body, key=key), _resp(200, OK))[1])
    assert ai.complete("sys", "hi", temperature=0.2) == "hello"
    assert seen["body"]["model"] == "claude-sonnet-5-5" and seen["key"] == "ak"
    assert "temperature" not in seen["body"]  # the API rejects it for current Claude models
    assert seen["body"]["system"][0]["cache_control"] == {"type": "ephemeral"}


def test_transient_errors_are_retried_with_retry_after_but_client_errors_are_not(monkeypatch):
    monkeypatch.setattr(ai, "get_settings", lambda: _settings())
    calls, waits = [], []
    answers = [_resp(429, {"error": {"message": "slow down"}}, {"retry-after": "3"}), _resp(529, {}), _resp(200, OK)]
    monkeypatch.setattr(ai, "_anthropic_post", lambda body, key: (calls.append(1), answers[len(calls) - 1])[1])
    assert ai.complete("s", "u", sleep=waits.append) == "hello"
    assert len(calls) == 3 and waits[0] == 3.0 and len(waits) == 2

    calls.clear()
    waits.clear()
    monkeypatch.setattr(ai, "_anthropic_post", lambda body, key: (calls.append(1), _resp(400, {"error": {"message": "bad request"}}))[1])
    with pytest.raises(ai.AiUnavailable, match="bad request"):
        ai.complete("s", "u", sleep=waits.append)
    assert len(calls) == 1 and not waits


def test_network_timeouts_are_retryable_and_errors_do_not_leak_the_raw_body(monkeypatch):
    monkeypatch.setattr(ai, "get_settings", lambda: _settings())
    def boom(body, key):
        raise httpx.ReadTimeout("slow")
    monkeypatch.setattr(ai, "_anthropic_post", boom)
    waits = []
    with pytest.raises(ai.AiUnavailable, match="unreachable"):
        ai.complete("s", "u", sleep=waits.append)
    assert len(waits) == ai.MAX_ATTEMPTS - 1
    monkeypatch.setattr(ai, "_anthropic_post", lambda body, key: httpx.Response(500, text="<html>secret internals</html>"))
    with pytest.raises(ai.AiUnavailable) as e:
        ai.complete("s", "u", sleep=lambda s: None)
    assert "secret internals" not in str(e.value)


def test_falls_back_to_the_next_configured_provider_when_the_first_keeps_failing(monkeypatch):
    monkeypatch.setattr(ai, "get_settings", lambda: _settings(openai_api_key="ok"))
    assert ai.provider_chain() == ["claude", "openai"]
    monkeypatch.setattr(ai, "_anthropic_post", lambda body, key: _resp(503, {}))
    used = []
    monkeypatch.setattr(ai, "_complete_openai_compatible", lambda provider, system, user, **kw: (used.append(provider), "from openai")[1])
    assert ai.complete("s", "u", sleep=lambda s: None) == "from openai" and used == ["openai"]


def test_chain_skips_providers_without_keys_and_unconfigured_raises(monkeypatch):
    monkeypatch.setattr(ai, "get_settings", lambda: _settings(ai_provider="deepseek", anthropic_api_key="ak"))
    assert ai.provider_chain() == ["claude"] and ai.is_configured()
    monkeypatch.setattr(ai, "get_settings", lambda: _settings(anthropic_api_key=""))
    assert ai.provider_chain() == [] and not ai.is_configured()
    with pytest.raises(ai.AiUnavailable, match="not set up"):
        ai.complete("s", "u")


def test_complete_json_asks_once_more_when_the_reply_is_not_json(monkeypatch):
    replies = iter(["I cannot do that", '{"title": "ok"}'])
    monkeypatch.setattr(ai, "complete", lambda system, user, **kw: next(replies))
    assert ai.complete_json("s", "u") == {"title": "ok"}
    monkeypatch.setattr(ai, "complete", lambda system, user, **kw: "still not json")
    with pytest.raises(ValueError):
        ai.complete_json("s", "u")
