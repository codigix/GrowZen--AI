"""One long blog article from a topic, a primary keyword and secondary keywords, written by a local Ollama model.

The article is written in parts so every Ollama call stays well inside the timeout on a CPU: a plan (title, meta
description, introduction, section headings, and which secondary keyword goes in which section), then each section,
the FAQs and the conclusion. The model answers in JSON and the HTML is built here, so labels like "META:", markdown
and placeholder text never reach the article. Afterwards the title, meta description, keyword use and unsupported
claims get targeted corrections, and everything is validated.
"""
import html
import json
import logging
import re
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout

try:
    import httpx
except ImportError:
    import requests as httpx
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from ..config import get_settings
from ..db import utcnow
from ..models import Article, Business
from . import ai, durable

log = logging.getLogger("seo.articles")

_ollama_lock = threading.Lock()  # Ollama answers one request at a time: batches take turns
_stats = threading.local()  # .run = {"calls", "ollama_seconds"} while an article is being written

TITLE_MAX = 60
META_MIN, META_MAX = 120, 160
_MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december"
CLAIM_PATTERNS = {
    "price or amount": r"(?:₹|\$|€|£|\brs\.?|\binr\b|\busd\b)\s?\d[\d,.]*|\d[\d,.]*\s?(?:rupees|dollars|usd|inr)\b",
    "percentage": r"\d+(?:\.\d+)?\s?%",
    "large number": r"\d[\d,.]*\s?(?:million|billion|crore|lakh|thousand)\b",
    "specific date": rf"\b(?:{_MONTHS})\s+\d{{1,2}}\b|\b\d{{1,2}}(?:st|nd|rd|th)?\s+(?:{_MONTHS})\b",
    "news claim": r"\b(?:announced|unveiled|reportedly|according to|breaking news|just launched|officially launched|press release)\b",
}
ALLOWED_TAGS = {"p", "h1", "h2", "h3", "h4", "ul", "ol", "li", "strong", "b", "em", "i", "br", "blockquote", "div", "span", "script", "mark"}
PLACEHOLDER = re.compile(r"\[[^\]]{2,}\]|\b(?:lorem ipsum|write about|insert here|to be added|your text here)\b", re.I)


class OllamaAnswerError(RuntimeError):
    """Claude AI answered with an error or invalid payload: caller can retry or skip this part."""
    pass


def _thinking_params(model: str) -> dict:
    """Keep the token budget for the article text. Current Claude models think by default, and the thinking counts
    against max_tokens, which left short paragraph calls with stop_reason=max_tokens and no text at all.
    Haiku 5.5 / Opus 5 / Sonnet 5 / 4.x accept thinking disabled; Opus 5.5, Sonnet 5.5 and Fable/Mythos reject it
    (400), so those get the lowest effort instead."""
    m = (model or "").lower()
    if m.startswith(("claude-opus-5-5", "claude-sonnet-5-5", "claude-fable", "claude-mythos")):
        return {"output_config": {"effort": "low"}}
    return {"thinking": {"type": "disabled"}}


def _chat(prompt: str, *, as_json: bool = True, num_predict: int | None = None, timeout: int | None = None, temperature: float | None = None) -> str:
    s = get_settings()
    key = s.anthropic_api_key
    if not key:
        raise RuntimeError("Claude API is not configured: please set ANTHROPIC_API_KEY in .env")

    headers = {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
    }

    sys_prompt = "You are an experienced, elite SEO blog copywriter."
    if as_json:
        sys_prompt += "\n\nCRITICAL: Answer ONLY with a valid JSON object. Do NOT include markdown code fences (no ```json), no prefix or explanations."

    model = getattr(s, "claude_model", "claude-haiku-5-5") or "claude-haiku-5-5"
    body = {
        "model": model,
        "max_tokens": num_predict or 4096,
        "system": sys_prompt,
        "messages": [{"role": "user", "content": prompt}],
        **_thinking_params(model),
    }

    wait = timeout or getattr(s, "claude_timeout_seconds", 90)
    started = time.time()
    try:
        r = httpx.post("https://api.anthropic.com/v1/messages", headers=headers, json=body, timeout=wait)
        if r.status_code != 200:
            raise OllamaAnswerError(f"Claude API error {r.status_code}: {r.text[:300]}")
        data = r.json()
        text = "".join(item["text"] for item in data.get("content", []) if item.get("type") == "text")
    except httpx.ConnectError:
        raise RuntimeError("Claude API (https://api.anthropic.com) is not reachable. Check your internet connection.")
    except httpx.TimeoutException:
        raise OllamaAnswerError(f"Claude API did not answer within {wait}s.")
    except httpx.HTTPStatusError as e:
        raise OllamaAnswerError(f"Claude API error {e.response.status_code}: {e.response.text[:200]}")
    finally:
        run = getattr(_stats, "run", None)
        if run is not None:
            run["calls"] += 1
            run["ollama_seconds"] += time.time() - started
    return text.strip()


def _stream_text(prompt: str, *, num_predict: int = 500, on_chunk=None) -> str:
    """Stream plain-text paragraphs from Claude token by token. Calls on_chunk(text_so_far) periodically."""
    s = get_settings()
    key = s.anthropic_api_key
    if not key:
        return _chat(prompt, as_json=False, num_predict=num_predict)

    headers = {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
    }
    model = getattr(s, "claude_model", "claude-haiku-5-5") or "claude-haiku-5-5"
    body = {
        "model": model,
        "max_tokens": num_predict,
        "stream": True,
        "messages": [{"role": "user", "content": prompt}],
        **_thinking_params(model),
    }

    collected = []
    chunk_count = 0
    stop_reason = None
    stream_error = None
    started = time.time()
    try:
        with httpx.stream("POST", "https://api.anthropic.com/v1/messages", headers=headers, json=body, timeout=s.claude_timeout_seconds) as r:
            if r.status_code != 200:
                err_text = r.read().decode("utf-8", errors="replace")
                log.warning("Claude streaming error %s: %s", r.status_code, err_text[:200])
                return _chat(prompt, as_json=False, num_predict=num_predict)
            for line in r.iter_lines():
                if not line or not line.startswith("data: "):
                    continue
                raw_data = line[6:].strip()
                if raw_data == "[DONE]":
                    break
                try:
                    d = json.loads(raw_data)
                except Exception:
                    continue
                kind = d.get("type")
                if kind == "content_block_delta":
                    tok = d.get("delta", {}).get("text", "")
                    if tok:
                        collected.append(tok)
                        chunk_count += 1
                        if on_chunk and (chunk_count % 4 == 0 or "\n" in tok):
                            on_chunk("".join(collected))
                elif kind == "message_delta":
                    stop_reason = (d.get("delta") or {}).get("stop_reason") or stop_reason
                elif kind == "error":  # errors can arrive inside a 200 stream (e.g. overloaded_error)
                    stream_error = (d.get("error") or {}).get("type") or "error"
                    log.warning("Claude stream error event: %s", d.get("error"))
                    break
    except Exception as e:
        log.warning("Streaming Claude error: %s", e)
        stream_error = stream_error or type(e).__name__
    finally:
        run = getattr(_stats, "run", None)
        if run is not None:
            run["calls"] += 1
            run["ollama_seconds"] += time.time() - started
    text = "".join(collected).strip()
    if not text:  # empty stream (error event, refusal, dropped connection): one plain, non-streaming call
        log.warning("Claude stream returned no text (stop_reason=%s, error=%s); retrying without streaming", stop_reason, stream_error)
        try:
            text = _chat(prompt, as_json=False, num_predict=num_predict)
        except OllamaAnswerError as exc:
            log.warning("Non-streaming retry failed too: %s", exc)
            text = ""
    elif stop_reason == "max_tokens":
        log.info("Claude stopped at max_tokens=%d; the trailing half sentence is trimmed by the caller", num_predict)
    return text


def _short(prompt: str, num_predict: int = 90, timeout: int = 90) -> str:
    """A few seconds: a plain-text answer to a small question. Failures return "" (the validation warning stays)."""
    try:
        return _plain(_chat(prompt, as_json=False, num_predict=num_predict, timeout=timeout)).strip(" \"'")
    except RuntimeError as exc:
        log.warning("Short Claude call failed: %s", exc)
        return ""


# ── Google Trends: optional. A deadline, a cache and a cool-down so a rate limit (HTTP 429) never blocks or hammers ──

TRENDS_BUDGET_SECONDS = 12
TRENDS_CACHE_SECONDS = 6 * 3600
_trends_lock = threading.Lock()
_trends_state = {"fails": 0, "blocked_until": 0.0}
_trends_cache: dict[str, tuple[float, list[str]]] = {}


def trends_related(topic: str) -> tuple[list[str], str]:
    """Related and rising queries for a topic. Returns (queries, status) with status ok | cached | cooldown | busy | unavailable.
    After a failure Google is left alone for 5, 10, 20, then 30 minutes; nothing here waits longer than TRENDS_BUDGET_SECONDS."""
    key, now = " ".join(topic.lower().split()), time.time()
    hit = _trends_cache.get(key)
    if hit and now - hit[0] < TRENDS_CACHE_SECONDS:
        return hit[1], "cached"
    if now < _trends_state["blocked_until"]:
        return [], "cooldown"
    if not _trends_lock.acquire(blocking=False):  # a slow request is still running: do not pile another one on
        return [], "busy"

    def fetch() -> list[str]:
        try:
            from . import google_trends_client as gt  # imported late: it pulls in pandas / pytrends
            status, data = gt.related(key, "IN", "past_30_days", 20)
            if status != 200:
                raise RuntimeError(f"Google Trends answered {status}")
            return [r["keyword"] for r in (data.get("rising_keywords") or []) + (data.get("related_keywords") or [])]
        finally:
            _trends_lock.release()

    pool = ThreadPoolExecutor(max_workers=1)
    try:
        found = pool.submit(fetch).result(timeout=TRENDS_BUDGET_SECONDS)
    except (FutureTimeout, Exception) as exc:  # 429s, timeouts, a missing pytrends: Ollama carries on alone
        _trends_state["fails"] += 1
        _trends_state["blocked_until"] = now + min(300 * 2 ** (_trends_state["fails"] - 1), 1800)
        log.warning("Google Trends unavailable for '%s' (%s); skipping it for %d min", key, exc or "timeout", (_trends_state["blocked_until"] - now) // 60)
        return [], "unavailable"
    finally:
        pool.shutdown(wait=False)
    _trends_state["fails"] = 0
    _trends_cache[key] = (now, found)
    return found, "ok"


# ── Google Ads Keyword Planner: related ideas + real monthly search volumes for the article keywords ──

PLANNER_BUDGET_SECONDS = 20
PLANNER_CACHE_SECONDS = 6 * 3600
_planner_state = {"fails": 0, "blocked_until": 0.0}
_planner_cache: dict[str, tuple[float, list[dict]]] = {}


def _planner_call(seeds: list[str], limit: int) -> list[dict]:
    """One Keyword Planner call with a hard deadline, so a slow Google Ads answer never blocks the writer."""
    from . import google_ads_client as ads

    pool = ThreadPoolExecutor(max_workers=1)
    try:
        return pool.submit(ads.keyword_ideas, seeds, limit=limit).result(timeout=PLANNER_BUDGET_SECONDS)
    finally:
        pool.shutdown(wait=False)


def planner_related(topic: str) -> tuple[list[dict], str]:
    """Keyword Planner ideas for a topic as [{keyword, avg_monthly_searches, competition, ...}], most searched first.
    Status: ok | cached | cooldown | not_configured | unavailable. After a failure Google Ads is left alone for 5-30 minutes."""
    from . import google_ads_client as ads

    key, now = " ".join(topic.lower().split()), time.time()
    hit = _planner_cache.get(key)
    if hit and now - hit[0] < PLANNER_CACHE_SECONDS:
        return hit[1], "cached"
    if now < _planner_state["blocked_until"]:
        return [], "cooldown"
    try:
        ideas = _planner_call([key], 40)
    except ads.GoogleAdsNotConfigured as exc:
        log.info("Keyword Planner not configured: %s", exc)
        return [], "not_configured"
    except (FutureTimeout, Exception) as exc:  # Google Ads errors, auth failures, timeouts: Claude carries on alone
        _planner_state["fails"] += 1
        _planner_state["blocked_until"] = now + min(300 * 2 ** (_planner_state["fails"] - 1), 1800)
        log.warning("Keyword Planner unavailable for '%s' (%r); skipping it for %d min", key, exc, (_planner_state["blocked_until"] - now) // 60)
        return [], "unavailable"
    ideas = sorted(ideas, key=lambda i: i.get("avg_monthly_searches") or 0, reverse=True)
    _planner_state["fails"] = 0
    _planner_cache[key] = (now, ideas)
    return ideas, "ok"


def planner_volumes(keywords: list[str]) -> dict[str, int]:
    """Average monthly searches for specific keywords (Keyword Planner returns the seeds among its ideas). Best effort: {} on failure."""
    seeds = list(dict.fromkeys(" ".join(k.lower().split()) for k in keywords if k and k.strip()))[:20]  # API limit: 20 seeds
    if not seeds or time.time() < _planner_state["blocked_until"]:
        return {}
    try:
        ideas = _planner_call(seeds, 1000)
    except Exception as exc:
        log.warning("Keyword Planner volumes failed (%r)", exc)
        return {}
    wanted = set(seeds)
    return {i["keyword"].lower(): i.get("avg_monthly_searches") for i in ideas if i["keyword"].lower() in wanted}


# ── keyword suggestions ──────────────────────────────────────────────────────

_STOP = {"the", "and", "for", "with", "how", "what", "best", "near", "you", "your", "are", "from", "that", "this", "can", "get"}


def _sig(text: str) -> set[str]:
    return {w for w in re.findall(r"\w+", text.lower()) if len(w) > 2 and w not in _STOP}


def suggest_keywords(topic: str, related: list[str], b: Business, avoid: list[str] | None = None, volumes: dict[str, int] | None = None, fixed_primary: str = "") -> dict:
    """(`fixed_primary`: when given, that primary keyword is kept as is and only the secondary keywords are generated.)
    Primary + 5-10 secondary SEO keywords for a topic, from Claude and the topic's Google Keyword Planner ideas
    (`volumes` = average monthly searches per idea, shown to the model so it prefers keywords people actually search)."""
    topic = " ".join(topic.split())
    related = list(dict.fromkeys(" ".join(r.lower().split()) for r in related if r and r.strip()))[:25]
    volumes = volumes or {}
    avoid = [a.lower() for a in (avoid or [])]
    lines = [
        "You are an SEO keyword researcher. A business wants to write one blog article about the topic below.",
        f"Topic: {topic}",
        "Business (use it only to judge the audience):",
        ai.profile_text(b),
    ]
    if related:
        lines += ["", "Google Keyword Planner ideas for this topic, with average monthly searches where known (prefer relevant ones with real search volume, ignore the rest):",
                  *[f"- {r}" + (f" ({volumes[r]:,} searches/month)" if volumes.get(r) is not None else "") for r in related]]
    if avoid:
        lines += ["", "A previous set was rejected. Do NOT reuse these keywords, give a clearly different set: " + ", ".join(avoid)]
    if fixed_primary.strip():
        lines += ["", f'The primary keyword is already chosen and FIXED: "{" ".join(fixed_primary.split())}". Keep "primary" exactly that; all secondary keywords must support it.']
    lines += [
        "",
        "Rules:",
        '- "primary": ONE main SEO keyword of 2-5 words that closely matches the topic and is what people type into Google.',
        '- "secondary": 6 to 10 different related keywords or phrases of 2-6 words that fit the same article: the same topic, its sub-topics, questions and variations'
        " readers search for, plus the relevant Google Keyword Planner ideas above.",
        "- Everything must stay on the topic. No unrelated subjects, no duplicates or near-duplicates, no keyword stuffing, lowercase, no punctuation.",
        '- "intent": the main search intent of the topic, one of: informational, commercial, transactional, local, navigational.',
        'Answer with ONE JSON object and nothing else: {"primary": "...", "secondary": ["...", "..."], "intent": "informational"}',
    ]
    clean = lambda k: " ".join(re.findall(r"[\w'&]+", html.unescape(str(k)).lower()))
    avoid_set = {clean(x) for x in avoid}
    d: dict = {}
    fresh: list[str] = []
    fixed = clean(fixed_primary)
    primary = fixed or clean(topic)
    anchor = _sig(topic)

    def collect(data: dict) -> tuple[str, list[str]]:
        prim = fixed or clean(data.get("primary") or "") or clean(topic)
        keep: list[str] = []
        for k in [clean(x) for x in (data.get("secondary") or []) if isinstance(x, (str, int, float))] + [clean(r) for r in related]:
            if (k and k != prim and k not in keep and len(k.split()) <= 7 and _sig(k) & (anchor | _sig(prim))
                    and not any(k in o or o in k for o in keep if abs(len(k) - len(o)) < 4)):
                keep.append(k)
        return prim, keep

    # Two tries: a second one when the answer was not usable JSON (or the API hiccuped), or when a regeneration
    # repeated the rejected set. If the model still fails, the Keyword Planner ideas alone make the set.
    retry_note = ""
    model_error: Exception | None = None
    for attempt_no in range(2):
        prompt = "\n".join(lines) + retry_note
        raw = ""
        try:
            raw = _chat(prompt, num_predict=600, timeout=120, temperature=0.9 if avoid_set else 0.5)
            parsed = json.loads(re.search(r"\{[\s\S]*\}", raw).group(0))
            if not isinstance(parsed, dict):
                raise ValueError("not a JSON object")
        except (AttributeError, ValueError) as exc:
            log.warning("Keyword answer was not usable JSON (try %d): %s | %r", attempt_no + 1, exc, raw[:300])
            model_error = exc
            retry_note = "\n\nYour last answer was not a valid JSON object. Answer with ONLY the JSON object, nothing before or after it."
            continue
        except RuntimeError as exc:  # Claude API error / timeout / rate limit
            log.warning("Keyword request to the model failed (try %d): %s", attempt_no + 1, exc)
            model_error = exc
            retry_note = ""
            continue
        model_error = None
        d = parsed
        primary, pool = collect(d)
        fresh = [k for k in pool if k not in avoid_set]
        if len(fresh) >= 5 or not avoid_set:
            break
        retry_note = "\n\nYour last answer repeated rejected keywords. Every secondary keyword must be NEW: use different wording, sub-topics, questions, audiences or locations."

    source = "model"
    if not d:  # the model never gave a usable answer: fall back to the Keyword Planner ideas (most searched first)
        if not related:
            raise RuntimeError(f"The model did not return a usable keyword set ({model_error}). Try Regenerate Keywords.")
        log.warning("Keyword set for '%s' built from Keyword Planner ideas only (model failed: %s)", topic, model_error)
        source = "planner_fallback"
        primary, pool = collect({"primary": topic})
        if volumes:
            pool.sort(key=lambda k: volumes.get(k) or 0, reverse=True)
        fresh = [k for k in pool if k not in avoid_set]
    # a fresh set when there is one; otherwise top it up so the user always gets something usable to edit
    pool = fresh + [k for k in (collect(d)[1] if d else pool) if k not in fresh]
    secondary = [k for k in pool if k != primary][:10]
    if len(secondary) < 3:
        raise RuntimeError("Too few relevant keywords were found for this topic. Try Regenerate Keywords or edit the topic.")
    intent = str(d.get("intent") or "").lower().strip()
    return {"primary": primary, "secondary": secondary, "keywords_by": source,
            "intent": intent if intent in {"informational", "commercial", "transactional", "local", "navigational"} else "informational"}

def suggest_titles(topic: str, primary: str, secondary: list[str], b: Business, avoid: list[str] | None = None) -> list[str]:
    """Up to 5 SEO title options (each 30-60 characters, holding the exact primary keyword) for the title step before the article is written."""
    topic = " ".join((topic or "").split()) or primary
    primary = " ".join(primary.split())
    avoid = [a for a in (avoid or []) if a]
    prompt = "\n".join([
        "You are an SEO copywriter. Write 5 different SEO titles for ONE blog article.",
        f"Topic: {topic}", f'Primary keyword: "{primary}"',
        f"Secondary keywords: {', '.join(secondary[:8])}" if secondary else "",
        "Business (use it only to judge the audience):", ai.profile_text(b),
        f"Do not reuse these titles: {'; '.join(avoid)}" if avoid else "",
        f'Rules: each title is 30 to {TITLE_MAX} characters and contains the exact phrase "{primary}"; promise only what the topic covers; no clickbait; no numbers or years unless the topic has them; five clearly different angles (guide, how-to, question, benefits, local or audience).',
        'Answer with ONE JSON object: {"titles": ["...", "...", "...", "...", "..."]}'])
    out: list[str] = []
    for _ in range(2):
        d = _json(prompt, num_predict=400)
        for t in d.get("titles") or []:
            t = _plain(t).strip(" \"'")
            if isinstance(t, str) and 30 <= len(t) <= TITLE_MAX and _has(t, primary) and t not in out and t not in avoid:
                out.append(t)
        if len(out) >= 3:
            break
    return out[:5]


BLOG_TITLE_MAX = 90


def suggest_blog_titles(topic: str, primary: str, seo_title: str, b: Business, avoid: list[str] | None = None) -> list[str]:
    """Up to 5 Blog title (H1) options: the heading readers see on the page. Unlike the SEO title (max 60 characters, for Google) it can be
    longer and more engaging, but it keeps the primary keyword and promises the same thing as the SEO title."""
    topic = " ".join((topic or "").split()) or primary
    primary = " ".join(primary.split())
    avoid = [a for a in (avoid or []) if a]
    prompt = "\n".join([
        "You are an editor. Write 5 different Blog titles (the H1 heading readers see on the blog page) for ONE article.",
        f"Topic: {topic}", f'Primary keyword: "{primary}"',
        f'SEO title (shown in Google; the article delivers what it promises): "{seo_title}"' if seo_title else "",
        "Business (use it only to judge the audience):", ai.profile_text(b)[:1200],
        f"Do not reuse these titles: {'; '.join(avoid + ([seo_title] if seo_title else []))}",
        f'Rules: each title is 35 to {BLOG_TITLE_MAX} characters, contains the exact phrase "{primary}", reads naturally to a person (it can be a little longer and'
        " more descriptive than the SEO title), and promises only what the article covers. No clickbait, no years or numbers unless the topic has them.",
        'Answer with ONE JSON object: {"titles": ["...", "...", "...", "...", "..."]}'])
    out: list[str] = []
    for _ in range(2):
        d = _json(prompt, num_predict=500)
        for t in d.get("titles") or []:
            t = _plain(t).strip(" \"'")
            if isinstance(t, str) and 35 <= len(t) <= BLOG_TITLE_MAX and _has(t, primary) and t not in out and t not in avoid and t != seo_title:
                out.append(t)
        if len(out) >= 3:
            break
    return out[:5]


def blog_title_of(a) -> str:
    """The Blog title (H1) readers see: the article's H1 heading, else its SEO title."""
    m = re.search(r"<h1\b[^>]*>([\s\S]*?)</h1>", getattr(a, "body", None) or "", re.I)
    return (_text(m.group(1)) if m else "") or (getattr(a, "title", None) or getattr(a, "keyword", None) or "")


def _plain(value) -> str:
    """Text only: no tags, markdown, labels or entities."""
    t = html.unescape(str(value or ""))
    t = re.sub(r"<[^>]*>", " ", t)
    t = re.sub(r"^\s*(?:TITLE|META(?: DESCRIPTION)?|KEYWORDS)\s*:\s*", "", t, flags=re.I)
    t = re.sub(r"[*_`]{1,3}", "", t)
    return " ".join(t.split())


def _paragraphs(value) -> list[str]:
    """Paragraphs of a text value; markdown bullets are kept as list items (prefixed with '- ')."""
    out = []
    for block in re.split(r"\n\s*\n", html.unescape(str(value or "")).strip()):
        lines = [re.sub(r"<[^>]*>|[*_`]{1,3}|^#{1,6}\s*", "", ln).strip() for ln in block.split("\n")]
        lines = [ln for ln in lines if ln]
        if not lines:
            continue
        if all(re.match(r"^(?:[-•]|\d+[.)])\s+", ln) for ln in lines):
            out.append("\n".join("- " + re.sub(r"^(?:[-•]|\d+[.)])\s+", "", ln) for ln in lines))
        else:
            out.append(" ".join(lines))
    return out


def _html_paragraphs(value) -> str:
    parts = []
    for p in _paragraphs(value):
        if p.startswith("- "):
            parts.append("<ul>" + "".join(f"<li>{html.escape(li[2:], quote=False)}</li>" for li in p.split("\n")) + "</ul>")
        else:
            parts.append(f"<p>{html.escape(p, quote=False)}</p>")
    return "\n".join(parts)


SCHEMA_TOKEN = "GZSCHEMAPLACEHOLDEREND"  # plain text: survives the '<' escaping (an HTML comment did not)


def sanitize_html(body: str) -> str:
    """Keep formatting tags, preserve schema script and img attributes."""
    from . import content_images as ci
    body, placed = ci.keep_placed(body)  # images placed on the Images & Analysis step: kept, rebuilt from their checked parts
    # leftovers of an older placeholder that the '<' escaping below turned into visible text: removed
    body = re.sub(r"\s*(?:&lt;|<)!--SCHEMA_PLACEHOLDER--(?:&gt;|>)", "", body)
    scripts = re.findall(r'<script type="application/ld\+json">[\s\S]*?</script>', body, re.I)
    body = re.sub(r'<script type="application/ld\+json">[\s\S]*?</script>', SCHEMA_TOKEN, body, flags=re.I)
    body = re.sub(r"<figure\b[\s\S]*?</figure>", "", body, flags=re.I)
    body = re.sub(r"<img\b[^>]*>", "", body, flags=re.I)
    body = re.sub(r"<(script|style|iframe|object|embed)\b[\s\S]*?</\1\s*>", "", body, flags=re.I)
    body = re.sub(r"<!--[\s\S]*?-->", "", body)
    body = re.sub(r"<(?![a-zA-Z/])", "&lt;", body)

    def tag_clean(m):
        slash, tag = m.group(1), m.group(2).lower()
        if tag not in ALLOWED_TAGS:
            return ""
        if tag == "img":
            src = re.search(r'src="([^"]*)"', m.group(0), re.I)
            alt = re.search(r'alt="([^"]*)"', m.group(0), re.I)
            cls = re.search(r'class="([^"]*)"', m.group(0), re.I)
            s = f' src="{src.group(1)}"' if src else ''
            a = f' alt="{alt.group(1)}"' if alt else ''
            c = f' class="{cls.group(1)}"' if cls else ''
            return f"<img{s}{a}{c} />"
        return f"<{slash}{tag}>"

    body = re.sub(r"<(/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>", tag_clean, body)
    if scripts:  # back in their place (the first one); a placeholder is never left in the text
        body = re.sub(r"\s*" + SCHEMA_TOKEN, lambda _m: "\n" + "\n".join(scripts), body, count=1)
    body = body.replace(SCHEMA_TOKEN, "")
    if placed:
        body = ci.restore_placed(body, placed)
    return body.strip()


def _text(body: str) -> str:
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", body)).split())


# ── JSON-LD schema: one <script> with @graph = [BlogPosting, FAQPage] ────────────

_SCHEMA_RE = re.compile(r"\s*<script\b[^>]*type=[\"']application/ld\+json[\"'][^>]*>[\s\S]*?</script>\s*", re.I)


_DANGLING = {"a", "an", "the", "and", "or", "for", "to", "of", "in", "on", "with", "your", "our", "by", "at", "from", "that", "this", "is", "are"}


def fit_meta(text: str, limit: int = META_MAX) -> str:
    """A complete meta description within `limit` characters: never a trailing '…' or a half clause like '…policy for'.
    Prefers ending at the last full sentence; otherwise ends at a word, drops dangling words and closes with a period."""
    t = " ".join(re.sub(r"(?:\s*(?:…|\.\.\.))+\s*$", "", text or "").split())
    if not t or (len(t) <= limit and _SENTENCE_END.search(t)):
        return t
    cut = t[:limit]
    ends = [m.end() for m in re.finditer(r"[.!?](?=\s|$)", cut)]
    if ends and ends[-1] >= 90:  # a full sentence of useful length: end there
        return cut[:ends[-1]].strip()
    return _close_clause(cut if len(t) <= limit else cut.rsplit(" ", 1)[0], limit)


def _close_clause(t: str, limit: int = META_MAX) -> str:
    words = t.rstrip(",;:-–— ").split()
    while len(words) > 3 and words[-1].lower().strip(",;:") in _DANGLING:
        words.pop()
    out = " ".join(words).rstrip(",;:-–— ")
    out = out if _SENTENCE_END.search(out) else out + "."
    return out if len(out) <= limit else out[:limit - 1].rsplit(" ", 1)[0].rstrip(",;:-–— ") + "."


# Keyword-stuffing FAQs written by the old template (make_faq_for_keyword): kept out of the schema
_TEMPLATE_FAQ_Q = re.compile(r"^How do .+ contribute to .+\?$", re.I)
_TEMPLATE_FAQ_A = re.compile(r"^(Prioritizing |Implementing proven |Exploring diverse |Following a structured |Evaluating the costs associated with |A successful approach for )", re.I)


def _is_template_faq(q: str, a: str) -> bool:
    return bool(_TEMPLATE_FAQ_Q.match(q.strip()) or _TEMPLATE_FAQ_A.match(a.strip()))


_LANG_BY_COUNTRY = {"IN": "en-IN", "US": "en-US", "GB": "en-GB", "AE": "en-AE", "OM": "en-OM", "AU": "en-AU", "CA": "en-CA", "SG": "en-SG"}


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:80] or "article"


def slugify(text: str | None, limit: int = 80) -> str:
    """Web-address words from text: lower case letters and digits joined by single hyphens, cut at a whole word. Empty when nothing usable is left."""
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    if len(s) > limit:
        cut = s[:limit]
        s = (cut.rsplit("-", 1)[0] if "-" in cut else cut).strip("-")
    return s


def explicit_slug(a) -> str | None:
    """The words the article's address is to end with: the one set on it, else its primary keyword's. None for an article that is already live under an address an older rule made
    (re-publishing must never move a live page), so nothing is sent for it."""
    if getattr(a, "slug", None):
        return a.slug
    if getattr(a, "wp_post_id", None) or getattr(a, "wp_url", None) or getattr(a, "react_post_id", None):
        return None
    return slugify(a.keyword) or None


def publish_slug(a) -> str:
    """The slug for publishers that always need one (a file name, a webhook field): the explicit one, else the older title-based rule."""
    return explicit_slug(a) or _slug(a.title or a.keyword)


def faqs_of(body: str) -> list[tuple[str, str]]:
    """(question, answer) pairs from the article's FAQ section: each <h3> under the FAQ <h2> and the paragraph(s)/list after it."""
    m = re.search(r"<h2\b[^>]*>\s*(?:Frequently Asked Questions|FAQs?)\b[^<]*</h2>", body or "", re.I)
    if not m:
        return []
    section = body[m.end():]
    end = re.search(r"<h2\b|<script\b|<div\b", section, re.I)
    section = section[:end.start()] if end else section
    out = []
    for q, a in re.findall(r"<h3\b[^>]*>(.*?)</h3>([\s\S]*?)(?=<h3\b|$)", section, re.I):
        q, a = _text(q), _text(a)
        if q and a:
            out.append((q, a))
    return out


def article_schema(*, title: str, description: str, body: str, primary: str, secondary: list[str], b: Business,
                   url: str | None = None, published=None, modified=None, topic: str | None = None,
                   image_url: str | None = None, slug: str | None = None) -> str:
    """The article's JSON-LD: a single @graph with a BlogPosting and (when the article has FAQs) a FAQPage.
    Fallbacks for missing data:
      url        -> the published post URL; else {business website}/blog/{slug of title}; else left out (with @id/mainEntityOfPage)
      headline   -> title; else the primary keyword in title case
      description-> the complete meta description (a stored '…' is removed and the text ends on a full sentence/clause);
                    else the introduction's opening sentence(s)
      keywords   -> JSON array: primary keyword first, then the secondary keywords (deduplicated, lowercase)
      about      -> {"@type": "Thing", "name": topic}; else the primary keyword
      articleSection -> [business primary category]; else [topic]
      inLanguage -> from the business country (IN -> en-IN, US -> en-US, ...); else "en"
      dates      -> datePublished = first generation time, dateModified = last save; else now
      author / publisher -> the business name and website; logo only when the profile has a logo URL
      image      -> the featured image's public URL on the website (after publishing); else the profile's cover photo
                    URL; left out when there is none
      FAQPage    -> @id + url of the article; each Question/Answer is a FAQ visible in the article with its full answer;
                    old keyword-template FAQs are left out; the FAQPage is left out when no FAQ remains (empty is invalid)"""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    iso = lambda d: (d or now).astimezone(timezone.utc).isoformat(timespec="seconds") if hasattr(d or now, "astimezone") else str(d)
    site = (b.website or "").strip().rstrip("/")
    page = (url or "").strip() or (f"{site}/blog/{slug or _slug(title or primary)}" if site.startswith("http") else "")
    headline = (title or primary.title()).strip()
    intro = re.search(r"<p\b[^>]*>(.*?)</p>", body or "", re.S | re.I)
    # complete description: the meta description without any '…' (older articles stored a cut one), else the intro's first sentences
    desc = fit_meta(description or "") or (fit_meta(_text(intro.group(1))) if intro else headline)
    keywords = list(dict.fromkeys(" ".join(k.lower().split()) for k in [primary, *(secondary or [])] if k and k.strip()))
    site_ok = site.startswith("http")
    publisher = {"@type": "Organization", "name": b.name, **({"url": site} if site_ok else {})}
    if (b.logo or "").startswith("http"):
        publisher["logo"] = {"@type": "ImageObject", "url": b.logo}
    main_topic = (topic or "").strip() or primary
    section = (b.primary_category or "").strip() or main_topic
    lang = _LANG_BY_COUNTRY.get((b.country or "").upper(), "en")

    post = {"@type": "BlogPosting"}
    if page:
        post["@id"] = f"{page}#blogposting"
        post["mainEntityOfPage"] = {"@type": "WebPage", "@id": page}
        post["url"] = page
    post.update({
        "headline": headline[:110],
        "description": desc,
        **({"image": image_url} if (image_url or "").startswith("http")
           else {"image": b.cover_photo} if (b.cover_photo or "").startswith("http") else {}),
        "author": {"@type": "Organization", "name": b.name, **({"url": site} if site_ok else {})},
        "publisher": publisher,
        "inLanguage": lang,
        "keywords": keywords,
        "about": {"@type": "Thing", "name": main_topic[:1].upper() + main_topic[1:]},
        "articleSection": [section[:1].upper() + section[1:]],
        "wordCount": len(_text(_SCHEMA_RE.sub(" ", body or "")).split()),
    })
    graph = [post]
    # every schema FAQ is one visible in the article (question + its full answer); keyword-template FAQs are left out
    faqs = [(q, a) for q, a in faqs_of(body) if not _is_template_faq(q, a)]
    if faqs:
        faq_page = {"@type": "FAQPage"}
        if page:
            faq_page["@id"] = f"{page}#faq"
            faq_page["url"] = page
        faq_page["mainEntity"] = [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faqs]
        graph.append(faq_page)
    data = json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False, indent=2).replace("</", "<\\/")
    return f'<script type="application/ld+json">\n{data}\n</script>'


def with_schema(body: str, schema_html: str) -> str:
    """The body with every existing JSON-LD block removed and exactly one new block appended at the bottom.
    Nothing else in the article HTML is changed."""
    return _SCHEMA_RE.sub("\n\n", body or "").rstrip() + "\n\n" + schema_html


def headings_of(body: str) -> list[str]:
    return [_text(h) for h in re.findall(r"<h[1-3][^>]*>(.*?)</h[1-3]>", body, re.S | re.I)]


# ── validation ───────────────────────────────────────────────────────────────

def _norm(t: str) -> str:
    return " " + " ".join(re.findall(r"\w+", t.lower())) + " "


def _has(text: str, k: str) -> bool:
    """The keyword appears as a phrase (case and punctuation ignored)."""
    return _norm(k) in _norm(text)


def unsupported_claims(title: str, meta: str, body: str, keywords: list[str]) -> list[str]:
    text = " ".join([title, meta, _text(_SCHEMA_RE.sub(" ", body or ""))])  # the JSON-LD block is not article text
    allowed = " ".join(keywords).lower()
    found = []
    for label, pattern in CLAIM_PATTERNS.items():
        for m in re.finditer(pattern, text, re.I):
            snip = " ".join(m.group(0).split())
            if snip.lower() not in allowed:
                found.append(f"{label}: '{snip}'")
    return list(dict.fromkeys(found))


# the "Don't Wait to Take Action" section: validate() looks for these words, and write() makes sure its heading has them
ACTION_RE = re.compile(r"don['’]?t wait|don['’]?t delay|take action|timely action|act now|why wait|first step|next step|get started today|start today", re.I)


def validate(title: str, meta: str, body: str, primary: str, secondary: list[str], brand: str | None = None) -> list[str]:
    """Warnings shown to the editor enforcing the complete 10-part SEO blog structure."""
    w = []
    has_schema = bool(_SCHEMA_RE.search(body or ""))
    body = _SCHEMA_RE.sub("\n", body or "")  # check the visible article only, not the JSON-LD schema (its [arrays] aren't placeholders)
    text = _text(body)

    # Title validation
    if not title:
        w.append("The SEO title is empty.")
    elif len(title) > TITLE_MAX:
        w.append(f"The SEO title is {len(title)} characters (aim for {TITLE_MAX} or fewer).")
    if title and not _has(title, primary):
        w.append(f"The title does not contain the primary keyword '{primary}'.")
        
    # Meta description validation
    if not meta:
        w.append("The meta description is empty.")
    else:
        if not META_MIN <= len(meta) <= META_MAX:
            w.append(f"The meta description is {len(meta)} characters (aim for 120-160; 160 is the maximum).")
        if not _has(meta, primary):
            w.append(f"The meta description does not contain the primary keyword '{primary}'.")
            
    # Section 1: H1 Title
    if not re.search(r"<h1\b", body or "", re.I):
        w.append("Structure check: Blog Title (H1) heading is missing from article body.")
        
    # Section 2: Introduction (min 500 characters)
    first_p = re.search(r"<p\b[^>]*>(.*?)</p>", body or "", re.S | re.I)
    intro_text = _text(first_p.group(1)) if first_p else ""
    if not first_p:
        w.append("Structure check: Introduction paragraph is missing.")
    elif len(intro_text) < 120:
        w.append(f"Structure check: the opening paragraph is only {len(intro_text)} characters: give it at least a couple of full sentences.")
    if first_p and not _has(intro_text, primary):
        w.append(f"The introduction does not contain the primary keyword '{primary}'.")
        
    # Section 3 & 4: Subheadings (H2) and 500+ char body paragraphs
    h2_matches = re.findall(r"<h2\b[^>]*>(.*?)</h2>", body or "", re.S | re.I)
    if len(h2_matches) < 4:
        w.append(f"Structure check: Article has {len(h2_matches)} H2 sections (minimum 5 required for full SEO structure).")
        
    # Section 5: WH Question (H2)
    # the WH section is the H2 that is a question (a subheading like "How X Works" is not)
    wh_match = re.search(r"<h2\b[^>]*>\s*(What|Why|How|When|Where)\b[^<]*\?\s*</h2>\s*<p\b[^>]*>(.*?)</p>", body or "", re.S | re.I)
    if not wh_match:
        w.append("Structure check: Missing a WH Question (What/Why/How/When/Where) H2 section.")
    else:
        wh_ans_len = len(_text(wh_match.group(2)))
        if wh_ans_len > 750:
            w.append(f"Structure check: WH Question answer is {wh_ans_len} characters (maximum 750 allowed).")
            
    # Section 6: Action / Don't Wait section
    if not ACTION_RE.search(body or ""):
        w.append("Structure check: Missing the 'Don't Wait' section.")
        
    # Section 7: Why Choose [Business Name]
    if not re.search(r"why choose|what to look for", body or "", re.I):
        w.append("Structure check: Missing 'Why Choose [Business Name]?' section.")
        
    # Section 8: FAQs (MANDATORY: 3-5 Q&As)
    has_faq = bool(re.search(r"frequently asked|faq", body or "", re.I))
    if not has_faq:
        w.append("MANDATORY: FAQ section is missing. All articles must include an FAQ section.")
    else:
        faq_idx = re.search(r"frequently asked|faq", body or "", re.I).start()
        faq_q_count = len(re.findall(r"<h3\b", body[faq_idx:], re.I))
        if faq_q_count != 5:
            w.append(f"FAQ section has {faq_q_count} questions (the SEO workflow asks for 5).")

    # Keyword density (the content brief): about 1-2% for the primary keyword; a little either side is fine, only clear outliers are flagged
    n_words = len(text.split())
    if n_words >= 200 and primary:
        uses = len(re.findall(rf"(?<!\w){re.escape(' '.join(primary.split())).replace(chr(92) + ' ', chr(92) + 's+')}(?!\w)", text, re.I))
        density = uses * len(primary.split()) * 100 / n_words
        if density < 0.8:
            w.append(f"Primary keyword density is {density:.1f}% ({uses} uses in {n_words} words); aim for about 1-2%.")
        elif density > 2.5:
            w.append(f"Primary keyword density is {density:.1f}% ({uses} uses in {n_words} words): likely keyword stuffing, aim for about 1-2%.")
            
    # Section 9: CTA - Call To Action
    if not re.search(r"contact|ready to|get started|call us|reach out", body or "", re.I):
        w.append("Structure check: Missing Call To Action (CTA) section.")
        
    # Section 10: Local Business Schema
    if not has_schema:
        w.append("Structure check: Missing Local Business Schema structured data.")
        
    # Brand name and short chunks
    if brand:
        n_brand = len(re.findall(rf"(?<!\w){re.escape(brand)}(?!\w)", text, re.I))
        if n_brand < 2:
            w.append(f"The brand name '{brand}' appears {n_brand} time{'s' if n_brand != 1 else ''}: mention it naturally a few times.")
    n_long = long_paragraphs(body, limit=190)  # the template's paragraphs are 500+ characters (about 90-130 words); only far longer ones are flagged
    if n_long:
        w.append(f"{n_long} paragraph{'s are' if n_long != 1 else ' is'} very long (over 190 words): split {'them' if n_long != 1 else 'it'} into two paragraphs.")

    # Keywords check (a paragraph without a keyword is normal, not a failure: it is no longer listed here)
    if not _has(text, primary):
        w.append(f"The primary keyword '{primary}' does not appear in the article body.")
    for k in secondary:
        if not _has(text, k):
            w.append(f"Secondary keyword '{k}' does not appear in the article.")
            
    if PLACEHOLDER.search(text):
        w.append("The article still contains placeholder text in [brackets].")
        
    claims = unsupported_claims(title, meta, body or "", [primary, *secondary])
    if claims:
        w.append("May contain unverified claims; review before publishing: " + "; ".join(claims[:6]))
        
    return w


# ── generation ───────────────────────────────────────────────────────────────

def _rewrite(kind: str, current: str, primary: str, rule: str) -> str:
    return _short(f'Rewrite this SEO {kind} so that it contains the exact phrase "{primary}" and {rule}. '
                  f"Keep the meaning. Plain text only, no quotes, no labels. Answer with the {kind} only.\n\n{kind}: {current}")


def _title_for_topic(ask, primary: str, topic: str, tried: str) -> str | None:
    """The plan's title did not hold the primary keyword or did not fit 60 characters. Rather than the same "<Keyword>: A Complete Guide" for every
    article, ask once for a title written for THIS topic; failing that use the chosen topic itself when it fits. None = use the generic one."""
    topic = " ".join((topic or "").split())
    if topic and _norm(topic) != _norm(primary):
        try:
            d = ask(chr(10).join([
                f'Write ONE blog title for the topic: "{topic}".',
                f'Rules: at most {TITLE_MAX} characters, it must contain the exact phrase "{primary}", it must promise only what the topic covers, no clickbait, no numbers or years unless the topic has them.',
                f'The title "{tried}" was not acceptable.' if tried else "",
                'Answer with ONE JSON object: {"title": "..."}']), num_predict=120)
            t = _plain((d or {}).get("title") or "")
            if t and len(t) <= TITLE_MAX and _has(t, primary):
                return t
        except Exception:  # noqa: BLE001 - a title is never worth failing the article for
            log.warning("Could not ask for a topic title", exc_info=True)
        if len(topic) <= TITLE_MAX and _has(topic, primary):
            return topic
        short = _shorten_title(topic, primary)
        if short and len(short) <= TITLE_MAX and _has(short, primary):
            return short
    return None


def _shorten_title(t: str, primary: str) -> str:
    """Last resort: cut at the last separator or word that fits in 60 characters, if the primary keyword survives."""
    cut = t[:TITLE_MAX]
    for sep in (":", " | ", " – ", " — ", " - ", ","):
        if sep in cut and _has(cut[:cut.rindex(sep)], primary):
            return cut[:cut.rindex(sep)].strip()
    cut = cut.rsplit(" ", 1)[0].rstrip(",;:.- ")
    return cut if _has(cut, primary) else t


def fix_seo_fields(draft: dict, primary: str) -> None:
    """Fast Python cleanup: ensures title has primary keyword and <= 60 chars, meta has primary keyword and <= 160 chars."""
    t = draft.get("title") or ""
    if not t:
        draft["title"] = primary.title()[:TITLE_MAX]
    elif len(t) > TITLE_MAX or not _has(t, primary):
        draft["title"] = _shorten_title(t, primary)
        if not _has(draft["title"], primary):
            draft["title"] = f"{primary.title()} - Guide & Tips"[:TITLE_MAX]

    m = draft.get("meta") or ""
    if not m:
        draft["meta"] = f"Complete guide to {primary}. Discover actionable tips, proven strategies, and expert advice for success."
    elif not _has(m, primary):
        draft["meta"] = f"{primary.title()}: {m}"
    if len(draft["meta"]) > META_MAX:
        draft["meta"] = fit_meta(draft["meta"])


def make_faq_for_keyword(kw: str, primary: str) -> tuple[str, str]:
    k = kw.strip()
    k_lower = k.lower()
    
    if k_lower.startswith(('how to', 'what is', 'why', 'when', 'where', 'can you', 'should you')):
        q = k.capitalize()
        if not q.endswith('?'):
            q += '?'
    elif k_lower.endswith(('tips', 'ideas', 'examples', 'guide', 'strategies', 'best practices', 'steps', 'themes', 'options')):
        q = f'What are the most popular {k}?'
    elif k_lower.endswith(('checklist', 'framework', 'template')):
        q = f'Why is a comprehensive {k} essential?'
    elif k_lower.startswith(('best', 'top', 'easy', 'simple')):
        q = f'How do you choose {k}?'
    else:
        q = f'How do {k} contribute to {primary}?'
        
    if 'tips' in k_lower or 'best practices' in k_lower:
        ans = f'Implementing proven {k} ensures better organization, reduces common errors, and helps you achieve consistent results throughout your project.'
    elif 'ideas' in k_lower or 'examples' in k_lower:
        ans = f'Exploring diverse {k} gives you actionable inspiration and allows you to tailor your approach to your exact goals and preferences.'
    elif 'checklist' in k_lower:
        ans = f'Following a structured {k} keeps every detail accounted for, preventing last-minute delays and ensuring nothing important is overlooked.'
    elif 'cost' in k_lower or 'price' in k_lower:
        ans = f'Evaluating the costs associated with {k} allows for realistic budgeting and ensures you maximize value without unexpected expenses.'
    elif k_lower.startswith('how to'):
        ans = f'A successful approach for {k} begins with clear preparation, reliable resources, and consistent execution from start to finish.'
    else:
        ans = f'Prioritizing {k} is essential when working with {primary}. It provides practical clarity and supports long-term success.'
        
    return q, ans


def correct_content(draft: dict, primary: str, secondary: list[str], topic: str) -> None:
    """Fast Python cleanup: ensures primary keyword and ALL secondary keywords are present in the article body."""
    body = draft.get("body") or ""
    first = re.search(r"<p>(.*?)</p>", body, re.S)
    if first and not _has(first.group(1), primary):
        orig_p = first.group(1).strip()
        fixed_p = f"When considering {primary}, " + (orig_p[0].lower() + orig_p[1:] if len(orig_p) > 1 else orig_p)
        body = body.replace(first.group(0), f"<p>{fixed_p}</p>", 1)

    # Check for missing secondary keywords
    full_text = f"{draft.get('title', '')} {draft.get('meta', '')} {_text(body)}"
    missing = [k.strip() for k in (secondary or []) if k and k.strip() and not _has(full_text, k)]
    
    # Keywords are no longer forced in as template FAQs ("How do X contribute to Y?" / "Prioritizing X is essential...");
    # that was keyword stuffing. A missing keyword is reported by validate() so it can be worked in naturally.
    if missing:
        log.info("Secondary keywords not used in the article (left to the editor, not stuffed into FAQs): %s", missing)
    draft["body"] = body


# ── a keyword in every paragraph ─────────────────────────────────────────────

_P_RE = re.compile(r"<p\b([^>]*)>(.*?)</p>", re.S | re.I)


def paragraph_coverage(body: str, primary: str, secondary: list[str]) -> dict:
    """Which paragraphs of the article carry the primary keyword or a secondary one. The JSON-LD block is not part of the article text."""
    keys = [k for k in dict.fromkeys([primary, *(secondary or [])]) if k and k.strip()]
    items = []
    for m in _P_RE.finditer(_SCHEMA_RE.sub("\n", body or "")):
        text = _text(m.group(2))
        if len(text.split()) < 6 or re.fullmatch(r"\s*<strong>[^<]*</strong>\s*", m.group(2)):  # a label ("Key takeaways"), not a paragraph
            continue
        items.append({"n": len(items) + 1, "text": text, "keywords": [k for k in keys if _has(text, k)]})
    missing = [x["n"] for x in items if not x["keywords"]]
    return {"total": len(items), "covered": len(items) - len(missing), "missing": missing, "paragraphs": items}


_NUMBERS = re.compile(r"\d+(?:[.,]\d+)?")


def _rewrite_ok(original: str, new: str, keyword: str) -> bool:
    """A rewrite is taken only when it has the keyword, keeps about the same length and brings no number the paragraph did not have."""
    if not new or not _has(new, keyword):
        return False
    a, b = len(original.split()), len(new.split())
    if not (0.6 * a <= b <= 1.7 * a + 8):
        return False
    return set(_NUMBERS.findall(new)) <= set(_NUMBERS.findall(original))


def add_keywords_to_paragraphs(body: str, primary: str, secondary: list[str], topic: str = "", batch: int = 6) -> tuple[str, dict]:
    """Rewrite the paragraphs that have none of the keywords so each has one, naturally. The keywords are handed out evenly (the one used least so far), a rewrite must keep the
    meaning, the length and the facts (no new numbers), and a paragraph the model could not rewrite properly is left as it was. Returns (body, {changed, left})."""
    keys = [k for k in dict.fromkeys([primary, *(secondary or [])]) if k and k.strip()]
    cov = paragraph_coverage(body, primary, secondary)
    if not keys or not cov["missing"]:
        return body, {"changed": 0, "left": 0, "total": cov["total"]}
    use = Counter(k for x in cov["paragraphs"] for k in x["keywords"])
    todo = []
    for n in cov["missing"]:
        k = min(keys, key=lambda x: (use[x], keys.index(x)))
        use[k] += 1
        todo.append((n, k, cov["paragraphs"][n - 1]["text"]))
    done = _ask_rewrites(todo, topic or primary, batch)
    if not done:
        return body, {"changed": 0, "left": len(todo), "total": cov["total"]}
    # the schema block is left out of the numbering (it holds no <p>), so paragraph numbers match paragraph_coverage
    return _apply_rewrites(body, done), {"changed": len(done), "left": len(todo) - len(done), "total": cov["total"]}


# ── the brand name, keyword emphasis on the website, and short chunks ─────────

_LEGAL = re.compile(r"\b(?:pvt\.?|private|ltd\.?|limited|llp|inc\.?|llc|corp\.?)\b.*$", re.I)
_BRAND_SPLIT = re.compile(r"\s+[–—|:]\s+|\s+-\s+|\s*\|\s*")


def brand_of(b) -> str:
    """The name readers know the business by: "Codigix Infotech" from "Codigix Infotech Pvt. Ltd. – Healthcare Marketing Agency", "CASA Royale" from "CASA Royale - Luxury PG | Co-living Space"."""
    name = " ".join((getattr(b, "name", "") or "").split())
    head = _BRAND_SPLIT.split(name)[0].strip()
    head = _LEGAL.sub("", head).strip(" ,.-") or head or name
    if len(head) > 40 and "," in head:
        head = head.split(",")[0].strip()
    return head[:60]


EMPHASIS_STYLES = {
    "primary": "background:#fde68a;color:inherit;padding:0 .15em;border-radius:3px",
    "secondary": "background:#bae6fd;color:inherit;padding:0 .15em;border-radius:3px",
    "brand": "background:#bbf7d0;color:inherit;padding:0 .15em;border-radius:3px",
}
_EMPH_RE = re.compile(r'<mark\b[^>]*\bdata-gz="[^"]*"[^>]*>(?:<strong>)?([\s\S]*?)(?:</strong>)?</mark>|<strong\b[^>]*\bdata-gz="[^"]*"[^>]*>([\s\S]*?)</strong>', re.I)
_NO_EMPHASIS = {"h1", "h2", "h3", "h4", "h5", "h6", "a", "script", "style", "code", "pre", "mark", "strong", "b", "button", "summary", "title"}
_BLOCKS = {"p", "li", "td", "th", "dd", "dt", "blockquote", "div", "section", "h1", "h2", "h3", "h4", "h5", "h6"}  # each starts a fresh "bold once" count


def strip_emphasis(body: str) -> str:
    """Take the keyword markup out again (only the marks this app made: they carry data-gz), leaving the plain text."""
    return _EMPH_RE.sub(lambda m: m.group(1) if m.group(1) is not None else m.group(2), body or "")


def emphasize(body: str, primary: str | None, secondary: list[str] | None, brand: str | None = None) -> str:
    """Every use of the primary keyword, the secondary keywords and the brand name in the article text becomes bold and highlighted (a coloured <mark> around a <strong>), so it shows
    on the website itself. Headings, links, code and the JSON-LD block are left alone; the markup is rebuilt from scratch each time, so a changed keyword never leaves an old mark."""
    body = strip_emphasis(body)
    phrases: list[tuple[str, str]] = []
    for k, kind in [(primary, "primary"), *[(s, "secondary") for s in (secondary or [])], (brand, "brand")]:
        k = " ".join((k or "").split())
        if len(k) > 1 and k.lower() not in [p[0].lower() for p in phrases]:
            phrases.append((k, kind))
    if not phrases:
        return body
    kinds = {" ".join(k.lower().split()): kind for k, kind in phrases}
    rx = re.compile(r"(?<!\w)(" + "|".join(re.escape(k).replace(r"\ ", r"\s+") for k, _ in sorted(phrases, key=lambda x: -len(x[0]))) + r")(?!\w)", re.I)

    # Bold, but not excessive (the content brief): each keyword and the brand at most ONCE per paragraph / list item; later uses in the
    # same block stay plain. `done` is reset at the start of every block.
    done: set[str] = set()

    def wrap(m: re.Match) -> str:
        key = " ".join(m.group(0).lower().split())
        if key in done:
            return m.group(0)
        done.add(key)
        kind = kinds.get(key, "secondary")
        return f'<strong data-gz="{kind}">{m.group(0)}</strong>'  # bold only: no colour on the website

    out: list[str] = []
    depth: Counter = Counter()
    for tok in re.split(r"(<!--[\s\S]*?-->|<[^>]+>)", body):
        if tok.startswith("<"):
            m = re.match(r"<(/?)([a-zA-Z][a-zA-Z0-9]*)", tok)
            if m and not m.group(1) and m.group(2).lower() in _BLOCKS:
                done.clear()  # a new paragraph / list item / cell: its keywords may be bolded once again
            if m and m.group(2).lower() in _NO_EMPHASIS and not tok.endswith("/>"):
                tag = m.group(2).lower()
                depth[tag] = max(0, depth[tag] + (-1 if m.group(1) else 1))
            out.append(tok)
        elif not tok.strip() or any(depth.values()):
            out.append(tok)
        else:
            out.append(rx.sub(wrap, tok))
    return "".join(out)


def prepare_body(raw: str, primary: str | None, secondary: list[str] | None, brand: str | None) -> str:
    """Article HTML as it is kept: the old keyword marks out (while their attributes are still there), the HTML cleaned, the marks put back for the current keywords and brand."""
    return emphasize(sanitize_html(strip_emphasis(raw or "")), primary, secondary, brand)


_SENTENCE = re.compile(r"(?<=[.!?])[\"'”’)\]]*\s+(?=[A-Z0-9\"“‘(])")
_ABBREVIATION = re.compile(r"\b(?:Dr|Mr|Mrs|Ms|Prof|St|Sr|Jr|vs|No|etc|e\.g|i\.e)\.$")
_PAIRED = ("strong", "em", "b", "i", "mark", "span", "a")


def _balanced(h: str) -> bool:
    return all(len(re.findall(rf"<{t}\b", h, re.I)) == len(re.findall(rf"</{t}>", h, re.I)) for t in _PAIRED)


def chunk_paragraphs(body: str, max_words: int = 60, min_tail: int = 8) -> tuple[str, int]:
    """Break paragraphs that run long into short chunks of whole sentences (about max_words each, never a one-line leftover), so the article reads in small, scannable pieces.
    A paragraph whose sentences cannot be cut cleanly (a tag would be split) is left as it is. Returns (body, how many paragraphs were split)."""
    split = 0

    def one(m: re.Match) -> str:
        nonlocal split
        attrs, inner = m.group(1), m.group(2).strip()
        if len(_text(inner).split()) <= int(max_words * 1.25):
            return m.group(0)
        sentences: list[str] = []
        for s in _SENTENCE.split(inner):
            if sentences and _ABBREVIATION.search(_text(sentences[-1])):
                sentences[-1] += " " + s
            else:
                sentences.append(s)
        if len(sentences) < 2:
            return m.group(0)
        chunks, cur, words = [], [], 0
        for s in sentences:
            n = len(_text(s).split())
            if cur and words + n > max_words:
                chunks.append(" ".join(cur))
                cur, words = [s], n
            else:
                cur.append(s)
                words += n
        if cur:
            chunks.append(" ".join(cur))
        if len(chunks) > 1 and len(_text(chunks[-1]).split()) < min_tail:
            chunks[-2] += " " + chunks.pop()
        if len(chunks) < 2 or not all(_balanced(c) for c in chunks):
            return m.group(0)
        split += 1
        return "\n".join(f"<p{attrs}>{c}</p>" for c in chunks)

    return _P_RE.sub(one, body or ""), split


def long_paragraphs(body: str, limit: int = 75) -> int:
    return sum(1 for m in _P_RE.finditer(_SCHEMA_RE.sub("\n", body or "")) if len(_text(m.group(2)).split()) > limit)


def _ask_rewrites(todo: list[tuple[int, str, str]], topic: str, batch: int = 6) -> dict[int, str]:
    """Ask for each paragraph (n, phrase, text) to be rewritten with its phrase once, naturally. Only faithful rewrites are returned (see _rewrite_ok)."""
    done: dict[int, str] = {}
    for i in range(0, len(todo), batch):
        chunk = todo[i:i + batch]
        prompt = "\n".join([
            f"Rewrite each paragraph below so that it contains its exact phrase once, written naturally for a reader (topic: {topic}).",
            "Rules: keep the paragraph's meaning, facts and tone; keep about the same length; the phrase must appear exactly as given; do not add statistics, prices, claims or numbers;",
            "do not add other keyword phrases; plain text only, no quotes, labels or markdown.",
            "Paragraphs: " + json.dumps([{"n": n, "keyword": k, "paragraph": t} for n, k, t in chunk], ensure_ascii=False),
            'Answer with ONE JSON object and nothing else: {"paragraphs": [{"n": 1, "text": "the rewritten paragraph"}]}',
        ])
        d = _json(prompt, num_predict=int(sum(len(t.split()) for _, _, t in chunk) * 2.2) + 200)
        got = {int(x.get("n")): " ".join(_plain(x.get("text")).split()) for x in (d.get("paragraphs") or []) if isinstance(x, dict) and str(x.get("n", "")).isdigit()}
        for n, k, t in chunk:
            if _rewrite_ok(t, got.get(n, ""), k):
                done[n] = got[n]
    return done


def _apply_rewrites(body: str, done: dict[int, str]) -> str:
    count = 0

    def swap(m: re.Match) -> str:
        nonlocal count
        if len(_text(m.group(2)).split()) < 6:
            return m.group(0)
        count += 1
        new = done.get(count)
        return f"<p{m.group(1)}>{html.escape(new, quote=False)}</p>" if new else m.group(0)

    return _P_RE.sub(swap, body)


def ensure_brand(body: str, brand: str, topic: str = "", want: int = 3) -> tuple[str, int]:
    """The brand name should be in the article a few times (not in every paragraph): when it is not, the paragraphs best placed for it (an early one, a middle one, one near the end)
    are rewritten to name it once. Returns (body, paragraphs rewritten)."""
    visible = _text(_SCHEMA_RE.sub(" ", body or ""))
    have = len(re.findall(rf"(?<!\w){re.escape(brand)}(?!\w)", visible, re.I)) if brand else want
    if have >= want:
        return body, 0
    cov = paragraph_coverage(body, brand, [])
    plain = [x for x in cov["paragraphs"] if not x["keywords"]]
    if not plain:
        return body, 0
    picks = []
    for frac in (0.15, 0.5, 0.8):
        x = min(plain, key=lambda p: abs(p["n"] - frac * cov["total"]))
        if x not in picks:
            picks.append(x)
    done = _ask_rewrites([(x["n"], brand, x["text"]) for x in picks[: want - have]], topic or brand)
    return (_apply_rewrites(body, done) if done else body), len(done)


# Optimized for 4-core CPU: short and standard run in a single fast call
LENGTHS = {
    "short": {"sections": (3, 4), "words": 120, "subheadings": 0, "faqs": 3, "one_call": True},     # ~500-600 words, single fast Ollama call
    "standard": {"sections": (3, 4), "words": 160, "subheadings": 0, "faqs": 3, "one_call": True},  # ~750-900 words, single fast Ollama call
    "long": {"sections": (4, 5), "words": 220, "subheadings": 1, "faqs": 4, "one_call": False},     # ~1,200 words, modular calls
}
SKIP_HEADING = re.compile(r"(?:introduction|frequently asked questions|faqs?|conclusion|final thoughts|summary)\W*", re.I)


# Paragraph plan per article length for write(): (paragraphs, words per paragraph). Totals with the fixed parts
# (WH answer, action paragraph, Why Choose, FAQs, CTA) land near the lengths shown on the page (~850 / ~2,000 / ~2,500 words).
WRITE_PLAN = {  # the gold-standard blog template: approximately 500 words per section in readable chunks; five FAQs
    # each main section: 3 paragraph chunks of ~150-170 words (~500 words total per section)
    "short": {"intro": (3, 130), "sub1": (3, 150), "sub2": (3, 150), "extra": (2, 130), "sections": 2, "faqs": 5},
    "standard": {"intro": (3, 140), "sub1": (3, 160), "sub2": (3, 160), "extra": (3, 150), "sections": 4, "faqs": 5},
    "long": {"intro": (3, 150), "sub1": (3, 170), "sub2": (3, 170), "extra": (3, 160), "sections": 5, "faqs": 5},
}
PARA_MIN_CHARS = 500  # the template's minimum paragraph size
INTRO_CHUNK_WORDS = 60  # the introduction: exactly 3 short, natural paragraphs of about 60 words (3-4 sentences)
SECTION_CHUNK_WORDS = 70  # main sections: small paragraph chunks of about 70 words (3-4 sentences), ~500 words per section in total
_SENTENCE_END = re.compile(r"[.!?…][\"'”’)\]]*$")


def _trim_to_sentence(text: str) -> str:
    """Drop a trailing half sentence (the model hit its token limit mid-sentence), so no paragraph ends like 'address hab'."""
    paras = [p.strip() for p in re.split(r"\n\s*\n", (text or "").strip()) if p.strip()]
    if paras and not _SENTENCE_END.search(paras[-1]):
        last = paras[-1]
        ends = list(re.finditer(r"[.!?…][\"'”’)\]]*(?=\s)", last))
        if ends:
            paras[-1] = last[:ends[-1].end()]
        else:
            paras.pop()
    return "\n\n".join(paras)


def _drop_heading_echo(text: str, headings: list[str]) -> str:
    """Remove a heading/label line the model put above its paragraphs ('Introduction', '## Key Strategies', 'Answer:')."""
    lines = (text or "").strip().split("\n")
    heads = {_norm(h) for h in headings if h}
    while lines:
        first = re.sub(r"^#{1,6}\s*|[*_`]", "", lines[0]).strip()
        bare = first.rstrip(":").strip()
        if not first:
            lines.pop(0)
        elif _norm(bare) in heads or (len(bare) < 70 and not _SENTENCE_END.search(bare) and not bare.endswith(",")) and len(lines) > 1:
            lines.pop(0)
        else:
            break
    return "\n".join(lines).strip()


def _opening(p: str) -> str:
    return " ".join(re.findall(r"\w+", p.lower())[:5])


def _dedupe_openings(text: str, used: set | None = None) -> str:
    """Drop a paragraph that starts with the same 5 words as an earlier one in the article (a restatement, not new
    content). `used` is shared across the article's sections; a section always keeps at least one paragraph."""
    used = used if used is not None else set()
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    out = []
    for i, p in enumerate(paras):
        key = _opening(p)
        if key and key in used and (out or i < len(paras) - 1):
            continue
        used.add(key)
        out.append(p)
    return "\n\n".join(out)


def _item(x) -> str:
    """One list item or short paragraph from the model: plain text, no markdown marks, no leading bullet."""
    x = re.sub(r"^\s*(?:[-*\u2022]|\d+[.)])\s+", "", str(x or "")).replace("**", "").replace("__", "")
    return " ".join(_plain(x).split())


def _list_html(items, ordered: bool = False) -> str:
    rows = [_item(i) for i in (items if isinstance(items, list) else [])]
    rows = [r for r in rows if len(r.split()) >= 3]
    if not rows:
        return ""
    tag = "ol" if ordered else "ul"
    return f"<{tag}>\n" + "\n".join(f"<li>{html.escape(r, quote=False)}</li>" for r in rows) + f"\n</{tag}>"


def _p(text) -> str:
    x = _item(text)
    return f"<p>{html.escape(x, quote=False)}</p>" if len(x.split()) >= 5 else ""


def render_structured(d: dict, takeaways_label: str = "Key takeaways") -> str:
    """A section as small, scannable pieces: a short lead, H3 groups (one or two sentences and a bullet or numbered list each) and a short takeaways list."""
    out = [_p(d.get("lead"))]
    for g in (d.get("groups") if isinstance(d.get("groups"), list) else []):
        if not isinstance(g, dict):
            continue
        heading = _item(g.get("heading")).rstrip(":")
        body = [_p(g.get("text")), _list_html(g.get("points"), bool(g.get("steps")))]
        if heading and any(body):
            out += [f"<h3>{html.escape(heading, quote=False)}</h3>", *body]
    tk = _list_html(d.get("takeaways"))
    if tk:
        out += [f"<p><strong>{html.escape(takeaways_label, quote=False)}</strong></p>", tk]
    return "\n".join(x for x in out if x)


STRUCTURE_RULES = [
    "Write for people who skim: small pieces, never a wall of text.",
    "- Plain text in every field: no markdown, no HTML, no asterisks, no numbering inside the text.",
    "- Every sentence must be complete. Do not invent statistics, prices, study results or guarantees.",
    "- Clear, warm, professional English; vary the wording, never repeat a point.",
]


def _write_structured(prompt: str, n_groups: int, used: set | None = None) -> str:
    """A section as scannable HTML (see render_structured) from one JSON answer; '' when the model gave nothing usable, so the caller can fall back to plain paragraphs."""
    budget = n_groups * 420 + 900  # groups now carry 2-4 sentence chunks (the content brief), not 1-2 sentences
    if used:
        prompt += "\n- These openings are already used elsewhere in the article, do not start the same way: " + "; ".join(f'"{o}…"' for o in sorted(used) if o)
    for attempt in range(2):
        d = _json(prompt, budget)
        h = render_structured(d)
        if h.count("<h3") >= max(1, n_groups - 1) and h.count("<li>") >= 2:
            return h
        log.warning("Structured section too thin (try %d): %r", attempt + 1, h[:160])
    return ""


def _section_list(context: str, h2: str, section_text: str, avoid_h3: list[str]) -> str:
    """The optional H3 + list block that closes a main section (the approved blog format: e.g. "What to Check Before Visiting a Store" with 5 checks).
    Only when the section's subject really has types, checks, steps, options or a comparison; '' otherwise or when the answer is unusable."""
    d = _json("\n".join([
        context,
        f'The section "{h2}" so far: ' + _text(section_text)[:1800],
        "Decide whether this section is clearer for the reader with ONE short sub-section that is a list: types or categories, things to check, steps,"
        " tips or options to compare (most practical sections are). A purely explanatory section gets none.",
        '- "h3": a specific sub-heading (3 to 9 words), different from these: ' + json.dumps(avoid_h3[-12:]),
        '- "lead": one sentence introducing the list.',
        '- "items": 4 to 7 objects {"label": "2 to 4 words", "text": "one complete sentence"}; each item says something the paragraphs did not.',
        '- "ordered": true only for steps that must be done in order.',
        *STRUCTURE_RULES,
        'Answer with JSON only: {"use_list": true, "h3": "...", "lead": "...", "items": [{"label": "...", "text": "..."}], "ordered": false}'
        ' or {"use_list": false}',
    ]), 900)
    if not d.get("use_list"):
        return ""
    h3 = _item(d.get("h3")).rstrip(":")
    items = [(_item(x.get("label")).rstrip(":"), _item(x.get("text"))) for x in (d.get("items") or []) if isinstance(x, dict)]
    items = [(l, t) for l, t in items if l and len(t.split()) >= 4][:7]
    if not h3 or len(items) < 3:
        return ""
    tag = "ol" if d.get("ordered") else "ul"
    return "\n".join([f"<h3>{html.escape(h3, quote=False)}</h3>", _p(d.get("lead")), f"<{tag}>",
                      *[f"<li><strong>{html.escape(l, quote=False)}:</strong> {html.escape(t, quote=False)}</li>" for l, t in items], f"</{tag}>"])


def _write_paragraphs(prompt: str, n_paras: int, words_each: int, headings: list[str], on_chunk=None, used: set | None = None) -> str:
    """N complete plain-text paragraphs from Claude, with a token budget sized for them (plus headroom),
    heading echoes removed, trailing half sentences trimmed and repeated openings dropped. One retry when empty."""
    budget = int(n_paras * words_each * 1.9) + 300
    if used:
        prompt += "\n- These paragraph openings are already used elsewhere in the article, do not start the same way: " + "; ".join(f'"{o}…"' for o in sorted(used) if o)
    text = ""
    for attempt in range(2):
        raw = _stream_text(prompt, num_predict=budget, on_chunk=on_chunk)
        text = _dedupe_openings(_trim_to_sentence(_drop_heading_echo(raw, headings)), used)
        if len(text) >= 120:
            return text
        log.warning("Paragraph request returned too little text (try %d): %r", attempt + 1, (raw or "")[:200])
    return text


class Cancelled(Exception):
    """The article was deleted while it was being written."""


def _context(b: Business, lean: bool = False) -> list[str]:
    s = get_settings()
    lines = [s.ollama_prompt_persona.strip()] if s.ollama_prompt_persona.strip() else []
    business = f"{b.name} ({', '.join(x for x in [b.primary_category, b.city] if x)})" if lean else ai.profile_text(b)
    return lines + [
        "The blog belongs to this business (use only these facts; mention it naturally, not in every section):",
        business,
        "",
        "Content rules (important):",
        "- Write evergreen, explanatory content with practical tips and concrete examples, from general knowledge only.",
        "- Do NOT invent news, events, prices, offers, dates, statistics, percentages, search volumes, quotes, sources, reviews,"
        " credentials or years of experience. If something is time-sensitive, explain it in general terms and suggest checking official sources.",
        "- If you are not certain a fact is correct, leave it out or word it cautiously ('usually', 'often').",
        "- Complete paragraphs only: never an outline, never a list of questions, never placeholder text in [square brackets].",
        "- No keyword stuffing. All values are plain text: no HTML, no markdown.",
        *(["", "Additional editor requirements:", s.ollama_prompt_requirements.strip()] if s.ollama_prompt_requirements.strip() else []),
    ]


def _json(prompt: str, num_predict: int, timeout: int | None = None) -> dict:
    """One JSON answer from Ollama; {} when the answer failed or is not usable JSON (so the part is retried or skipped).
    Only a connection error (Ollama not running) raises."""
    try:
        raw = _chat(prompt, num_predict=num_predict, timeout=timeout)
    except OllamaAnswerError as exc:
        log.warning("Ollama answer failed, retrying or skipping this part: %s", exc)
        return {}
    try:
        d = json.loads(re.search(r"\{[\s\S]*\}", raw).group(0))
    except (AttributeError, ValueError) as exc:
        log.warning("JSON answer not usable (%s): %r", exc, (raw or "")[:300])
        return {}
    return d if isinstance(d, dict) else {}


def _plan(primary: str, secondary: list[str], rising: list[str], b: Business, topic: str, cfg: dict) -> dict:
    """Title, meta description, introduction, section headings with sub-headings and the keyword for each section.
    With cfg["one_call"] the same answer also carries every section's paragraphs, the FAQs and the conclusion."""
    rising_set = {r.lower() for r in rising}
    lo, hi = cfg["sections"]
    section_shape = '{"heading": "a specific H2 heading", "keywords": ["the secondary keywords this section must use"]'
    if cfg["subheadings"]:
        section_shape += f', "subheadings": [up to {cfg["subheadings"]} H3 headings]'
    if cfg["one_call"]:
        section_shape += f', "paragraphs": ["paragraph of 4-5 sentences", "paragraph of 4-5 sentences"]'
    section_shape += "}"
    prompt = "\n".join([
        *_context(b), "",
        ("Write ONE complete blog article." if cfg["one_call"] else "Plan ONE complete, in-depth blog article."),
        f"Topic: {topic or primary}",
        f'Primary keyword: "{primary}"',
        "Secondary keywords:" if secondary else "There are no secondary keywords.",
        *[f'- "{k}"' + (" (searches rising on Google)" if k in rising_set else "") for k in secondary],
        "",
        "Answer with ONE JSON object and nothing else:",
        "{",
        f'  "title": "SEO title, at most {TITLE_MAX} characters, containing the exact primary keyword",',
        '  "meta_description": "one complete sentence of 150-160 characters containing the exact primary keyword",',
        '  "introduction": "an engaging introduction of 4-5 sentences; the first sentence contains the exact primary keyword",',
        f'  "sections": [ {lo} to {hi} objects like {section_shape} ],',
        *([f'  "faqs": [ {cfg["faqs"]} objects like {{"question": "a real question readers ask", "answer": "a complete answer of 2-3 sentences"}} ],',
           f'  "conclusion": "4-5 sentences that sum up the advice and end with a call to action to contact {b.name}",'] if cfg["one_call"] else []),
        '  "tags": [ 5 to 10 SEO tags ]',
        "}",
        "The sections go from the basics to practical, actionable advice. Every secondary keyword is listed in exactly one section's",
        '"keywords"' + (" and used in that section's paragraphs." if cfg["one_call"] else ". Do not make sections called Introduction, FAQ or Conclusion: those are written separately."),
    ])
    for attempt_no in range(2):
        d = _json(prompt, num_predict=1500 if cfg["one_call"] else 800)
        sections = [x for x in d.get("sections") or [] if isinstance(x, dict) and _plain(x.get("heading")) and not SKIP_HEADING.fullmatch(_plain(x.get("heading")))]
        if len(sections) >= lo - 1 and _plain(d.get("title")):
            break
        log.warning("Plan for '%s' unusable (attempt %d); asking again", primary, attempt_no + 1)
    else:
        raise RuntimeError("The model did not return a usable article plan. Try again.")
    plan = {"title": _plain(d.get("title")), "meta": _plain(d.get("meta_description")), "introduction": d.get("introduction") or "",
            "tags": [_plain(x) for x in d.get("tags") or [] if _plain(x)][:10] if isinstance(d.get("tags"), list) else [], "sections": [],
            "faqs": d.get("faqs") if cfg["one_call"] else None, "conclusion": d.get("conclusion") if cfg["one_call"] else None}
    wanted = {k.lower(): k for k in secondary}
    used: set[str] = set()
    for sec in sections[:hi]:
        kws = [wanted[x] for x in (_plain(k).lower() for k in sec.get("keywords") or []) if x in wanted and x not in used]
        used.update(k.lower() for k in kws)
        plan["sections"].append({"heading": _plain(sec["heading"]), "subheadings": [_plain(h) for h in sec.get("subheadings") or [] if _plain(h)][:cfg["subheadings"]],
                                 "keywords": kws, "paragraphs": sec.get("paragraphs") if cfg["one_call"] else None})
    for k in secondary:  # keywords the model did not place go to the sections with the fewest
        if k.lower() not in used:
            min(plan["sections"], key=lambda x: len(x["keywords"]))["keywords"].append(k)
    if len(plan["meta"]) > META_MAX:
        plan["meta"] = fit_meta(plan["meta"])
    return plan


def _paras(value) -> str:
    items = value if isinstance(value, list) else [value]
    return "\n".join(h for h in (_html_paragraphs(x) for x in items if isinstance(x, str)) if h)


def _section(plan: dict, i: int, primary: str, topic: str, b: Business, cfg: dict) -> str:
    """The HTML of one section: its H2, 2-3 detailed paragraphs, and an H3 with paragraphs for each sub-heading."""
    sec = plan["sections"][i]
    outline = "; ".join(x["heading"] for x in plan["sections"])
    prompt = "\n".join([
        *_context(b, lean=True), "",
        f'You are writing ONE section of the blog article "{plan["title"]}" about {topic or primary} (primary keyword: "{primary}").',
        f"All sections of the article, in order: {outline}.",
        f'Write ONLY the section "{sec["heading"]}"; do not repeat what the other sections cover.',
        "Write 2 to 3 detailed paragraphs of 4 to 5 sentences each under the section heading, with practical tips or an example.",
        *([f"Then, for each of these sub-headings, 1 to 2 detailed paragraphs: " + "; ".join(sec["subheadings"]) + "."] if sec["subheadings"] else []),
        *([f"Use each of these exact phrases at least once, unchanged: " + "; ".join(f'"{k}"' for k in sec["keywords"]) + "."] if sec["keywords"] else []),
        f"In total about {cfg['words']} words.",
        'Answer with ONE JSON object and nothing else: {"paragraphs": ["...", "..."], "subsections": [{"heading": "...", "paragraphs": ["..."]}]}',
    ])
    best = ""
    for _ in range(2):
        d = _json(prompt, num_predict=int(cfg["words"] * 2.6) + 150)
        parts = [f"<h2>{html.escape(sec['heading'], quote=False)}</h2>", _paras(d.get("paragraphs"))]
        for sub in d.get("subsections") or []:
            if isinstance(sub, dict) and _plain(sub.get("heading")) and _paras(sub.get("paragraphs")):
                parts += [f"<h3>{html.escape(_plain(sub['heading']), quote=False)}</h3>", _paras(sub.get("paragraphs"))]
        out = "\n".join(x for x in parts if x)
        if len(_text(out).split()) > len(_text(best).split()):
            best = out
        if len(_text(best).split()) >= cfg["words"] // 2:
            break
    return best


def _section_from_plan(sec: dict) -> str:
    """A section whose paragraphs came with the plan (short/standard articles)."""
    val = sec.get("paragraphs") or sec.get("content") or sec.get("body") or sec.get("text")
    body = _paras(val)
    return f"<h2>{html.escape(sec['heading'], quote=False)}</h2>\n{body}" if body else ""


def _faq_html(faqs) -> str:
    faqs = [f for f in faqs or [] if isinstance(f, dict) and _plain(f.get("question")) and _plain(f.get("answer"))]
    if not faqs:
        return ""
    sep = chr(10)
    return "<h2>Frequently Asked Questions</h2>\n" + sep.join(
        f"<h3>{html.escape(_plain(f['question']), quote=False)}</h3>\n{_paras(f['answer'])}" for f in faqs[:6])


def _conclusion_html(value) -> str:
    text = _paras(value)
    return f"<h2>Conclusion</h2>\n{text}" if text else ""


def _faqs_and_conclusion(primary: str, secondary: list[str], topic: str, b: Business, n_faqs: int) -> tuple[str, str]:
    """FAQs and conclusion in ONE call; whichever part is missing is written on its own afterwards."""
    prompt = "\n".join([
        *_context(b, lean=True), "",
        f'For a blog article about "{topic or primary}" (primary keyword: "{primary}"), write:',
        f"1. {n_faqs} frequently asked questions that readers really ask, each with a complete answer of 3 to 4 sentences.",
        f'2. The conclusion: one paragraph of 4 to 5 sentences that sums up the key advice, uses the exact phrase "{primary}" and ends with a clear call to action to contact {b.name}.',
        *([f"Where it fits naturally, use some of these phrases: " + "; ".join(secondary[:6]) + "."] if secondary else []),
        'Answer with ONE JSON object and nothing else: {"faqs": [{"question": "...", "answer": "..."}], "conclusion": "..."}',
    ])
    d = _json(prompt, num_predict=1100)
    faq, concl = _faq_html(d.get("faqs")), _conclusion_html(d.get("conclusion"))
    return faq or _faqs(primary, secondary, topic, b), concl or _conclusion(primary, topic, b)


def _faqs(primary: str, secondary: list[str], topic: str, b: Business) -> str:
    prompt = "\n".join([
        *_context(b), "",
        f'Write 5 frequently asked questions that readers really ask about "{topic or primary}" (primary keyword: "{primary}"), each with a complete answer of 3 to 4 sentences.',
        *([f"Where it fits naturally, use some of these phrases: " + "; ".join(secondary[:6]) + "."] if secondary else []),
        'Answer with ONE JSON object and nothing else: {"faqs": [{"question": "...", "answer": "..."}]}',
    ])
    return _faq_html(_json(prompt, num_predict=900).get("faqs"))


def _conclusion(primary: str, topic: str, b: Business) -> str:
    prompt = "\n".join([
        *_context(b), "",
        f'Write the conclusion of a blog article about "{topic or primary}": one paragraph of 4 to 5 sentences that sums up the key advice, uses the exact phrase "{primary}",'
        f" and ends with a clear call to action to contact {b.name}.",
        'Answer with ONE JSON object and nothing else: {"conclusion": "..."}',
    ])
    return _conclusion_html(_json(prompt, num_predict=400).get("conclusion"))


def _work_in_keywords(body: str, missing: list[str], primary: str, topic: str, b: Business) -> str:
    """Each secondary keyword the article does not use yet gets ONE natural sentence that contains it, added to the end of
    a body paragraph (introduction to the Why Choose section; spread out, never in the FAQs, CTA or schema).
    A sentence without the exact phrase is not used, so a keyword is never forced in as an odd phrase."""
    prompt = "\n".join([
        *_context(b, lean=True), "",
        f'For a blog article about "{topic or primary}", write ONE natural, helpful sentence for each of these phrases.',
        "Each sentence must contain its phrase exactly as written, read naturally in the article, and add a useful point for the reader.",
        "Do not invent statistics, prices or guarantees. Plain text, no quotes around the phrase.",
        "Phrases: " + "; ".join(missing),
        'Answer with ONE JSON object and nothing else: {"sentences": [{"phrase": "...", "sentence": "..."}]}',
    ])
    got = {}
    for item in (_json(prompt, num_predict=120 + 60 * len(missing)).get("sentences") or []):
        if isinstance(item, dict):
            s = " ".join(_plain(item.get("sentence")).split())
            k = next((m for m in missing if _has(s, m) and m not in got), None)
            if k and s:
                got[k] = s if _SENTENCE_END.search(s) else s.rstrip(",;: ") + "."
    if not got:
        return body
    # body paragraphs before "Why Choose": the intro and the sections (not FAQs, CTA or the schema)
    stop = re.search(r"<h2\b[^>]*>\s*Why Choose", body, re.I)
    head = body[:stop.start()] if stop else body
    paras = list(re.finditer(r"<p\b[^>]*>(.*?)</p>", head, re.S | re.I))
    if not paras:
        return body
    targets = paras[1:] or paras  # leave the first paragraph (the introduction's keyword line) as it is
    adds: dict[int, list[str]] = {}
    for i, s in enumerate(got.values()):
        adds.setdefault(int(i * len(targets) / len(got)), []).append(s)
    out, last = [], 0
    for idx, sentences in sorted(adds.items()):
        m = targets[idx]
        end = m.end() - len("</p>")
        out += [head[last:end], " " + " ".join(html.escape(s, quote=False) for s in sentences)]
        last = end
    log.info("Worked %d secondary keyword(s) into the article: %s", len(got), list(got))
    return "".join(out) + head[last:] + body[len(head):]


# ── section helpers: fresh WH question, profile-backed "Why choose", CTA wording, repeated sentences, FAQ relevance ──

_GENERIC_CLAIMS = re.compile(r"proven methodolog|customi[sz]ed service delivery|local market authority|transparent communication|industry[- ]leading|"
                             r"best[- ]in[- ]class|world[- ]class|cutting[- ]edge|unmatched|second to none|years of experience|award[- ]winning|trusted by", re.I)


def _display_case(s: str) -> str:
    """Profile text typed in lower case reads properly in a heading: "vastrbhushan Rental" -> "Vastrbhushan Rental", "pune" -> "Pune".
    Words that already have a capital letter (RK'z, ERP, iPhone) are kept as typed."""
    return " ".join(w[:1].upper() + w[1:] if w.islower() and w[:1].isalpha() else w for w in (s or "").split())


def _place(b) -> str:
    """The business's address for the contact box: address, area and city once each ("... Wagholi Pune, Pune" repeated the city), in display case."""
    out: list[str] = []
    for part in (getattr(b, "address", None), getattr(b, "area", None), getattr(b, "city", None)):
        p = " ".join(str(part or "").split()).strip(" ,")
        if p and not re.search(r"(?<![a-z0-9])" + re.escape(p.lower()) + r"(?![a-z0-9])", ", ".join(out).lower()):
            out.append(p)
    return _display_case(", ".join(out))


# FAQ questions that are templates, not questions a real reader asks about the topic
_GENERIC_FAQ = re.compile(r"see results|results from|professional (guidance|help|advice)|expert (guidance|help)|benefit your business|business growth|"
                          r"best way to get started|why (is|should|do) .*\b(professional|expert|agency|partner)", re.I)


def _business_relevance(b, brand: str, primary: str, topic: str, title: str, brief: dict | None) -> tuple[str, str]:
    """How the business relates to what a reader of THIS article is looking for: "full" (it offers exactly that), "partial" (related: e.g. a clothing
    RENTAL business and an article about buying market clothing; the article stays an honest guide and presents the business's REAL service as an
    alternative, never as a seller of the topic) or "none" (unrelated: neutral criteria, the business is only the publisher).
    A deterministic word-overlap veto decides "none"; the AI decides full/partial; a brief that says "not closely related" caps it at partial."""
    from .seo_workflow.stages import _business_fit
    fit = _business_fit({}, primary, b)
    if not fit["business_relevant"]:
        return "none", fit["business_note"]
    d = _json("\n".join([
        f'Blog article: "{title or topic}" (primary keyword "{primary}").',
        f"Business: {brand}. Its profile (the only facts): " + ai.profile_text(b)[:1500],
        "Question: does this business ITSELF sell or provide exactly what a reader of this article is looking for?",
        '- "full": yes, it offers that exact product or service (e.g. a dress rental shop and an article about renting dresses).',
        '- "partial": related but different (e.g. it rents what the article is about buying, or offers a different service in the same field).',
        '- "none": not related.',
        'Answer with JSON only: {"level": "full|partial|none", "reason": "one short sentence"}']), 200)
    level = str(d.get("level") or "").strip().lower()
    if level == "none":
        return "none", f"Business relevance: none. {_plain(d.get('reason'))} The business is not presented as a provider of this topic."
    if level == "partial" or (brief and brief.get("business_relevant") is False):
        why = _plain(d.get("reason")) or _plain((brief or {}).get("business_note"))
        return "partial", (f"Business relevance: partial. {why} The article is an honest guide to the topic and presents the business's real service"
                           " as an alternative; it never says the business sells or provides the topic itself.")
    return "full", ""


def _fitting_keywords(primary: str, secondary: list[str], title: str, topic: str) -> tuple[list[str], list[str]]:
    """Secondary keywords that fit this article's reader and intent; the rest (e.g. "wholesale clothing market near me" in a buyer's guide) are not
    forced into the text. Returns (fitting, left out). When the check gives no usable answer, every keyword is kept."""
    if not secondary:
        return [], []
    d = _json("\n".join([
        f'Blog article: "{title or topic}" (primary keyword "{primary}").',
        "Which of these secondary keywords can be used naturally in this article, because a reader of it also searches for them? Related places,"
        " markets, price angles and alternatives (e.g. renting instead of buying) fit: a section of the article can be about them."
        " Leave out only phrases with a clearly different intent or audience (for example wholesale/B2B supply, jobs, an unrelated product).",
        "Keywords: " + json.dumps(secondary),
        'Answer with JSON only: {"fit": ["exact keyword", "..."]}']), 400)
    fit = {str(k).strip().lower() for k in (d.get("fit") or []) if str(k).strip()}
    if not fit:
        return list(secondary), []
    return [k for k in secondary if k.lower() in fit], [k for k in secondary if k.lower() not in fit]


def _fresh_wh_question(wh_q: str, so_far_html: str, primary: str, title: str) -> str:
    """The WH question must be about something the main sections have NOT explained: when it overlaps a heading already written, ask for another."""
    from .seo_workflow.stages import _overlap, _QUESTION_FORM
    heads = [_text(h) for h in re.findall(r"<h[23]\b[^>]*>(.*?)</h[23]>", so_far_html or "", re.S | re.I)]
    generic = bool(re.match(r"what should you know about\b", wh_q or "", re.I))  # the fallback used when the plan failed: always replaced
    if not generic and not any(_overlap(wh_q, h) >= 0.75 for h in heads):
        return wh_q
    d = _json("\n".join([
        f'The blog article "{title}" (primary keyword "{primary}") already has these sections: ' + json.dumps(heads),
        "Give ONE question a reader still has that none of those sections answers. It starts with What, Why, How, When or Where, is a real question"
        ' (for example "How much does ... cost?", "What happens if ...?") and ends with "?". Plain words, at most 80 characters.',
        'Answer with JSON only: {"question": "...?"}']), 200)
    q = _plain(d.get("question") or "").rstrip(".!:; ")
    q = q + ("" if q.endswith("?") else "?") if q else ""
    if q and _QUESTION_FORM.match(q) and len(q) <= 100 and not any(_overlap(q, h) >= 0.75 for h in heads):
        return q
    return wh_q


def _profile_facts(b, brand: str) -> list[str]:
    """The verified details a "Why choose" reason may be based on: each line of the business profile (services one by one) and the real contact options."""
    facts: list[str] = []
    for line in ai.profile_text(b).splitlines():
        if ":" not in line:
            continue
        label, value = [x.strip() for x in line.split(":", 1)]
        if not value or label.lower() in {"business name", "write in", "tone of voice", "what the business wants from seo"}:
            continue
        if label.lower() == "services":
            facts += [f"Service: {s.strip()}" for s in value.split(";") if s.strip()][:10]
        elif label.lower() == "location":
            facts.append(f"Location: {_place(b) or value[:300]}")  # address, area and city once each
        else:
            facts.append(f"{label}: {value[:300]}")
    if getattr(b, "phone", None):
        facts.append(f"Phone: customers can call {b.phone}")
    if getattr(b, "website", None):
        facts.append(f"Website: {b.website}")
    if getattr(b, "booking_url", None):
        facts.append("Online booking: customers can book through the booking link")
    return list(dict.fromkeys(facts))[:24]


def _why_reasons(b, brand: str, primary: str, topic: str, loc_str: str, angle: str = "") -> tuple[list[dict], str, str]:
    """Exactly five "Why choose" reasons, each based on a DIFFERENT verified profile detail. The AI names the detail it used; Python checks the detail
    exists, the reason invents no numbers and uses no generic claim ("Proven Methodology"…). Returns (reasons, intro, note for the editor)."""
    facts = _profile_facts(b, brand)
    got: list[dict] = []
    used: set[int] = set()
    if facts:
        d = _json("\n".join([
            f'Write the "Why choose {brand}" reasons for a blog article about "{topic}" (primary keyword "{primary}").',
            "VERIFIED BUSINESS DETAILS (the only things you may say about the business):", *[f"F{i + 1}. {f}" for i, f in enumerate(facts)],
            "- Up to 5 reasons. Each is based on ONE detail above (a different one each time) and says only what that detail supports, phrased for this"
            " article's reader. Never add numbers, years, awards, clients, results or qualities the detail does not state.",
            '- No generic claims such as "Proven Methodology", "Customized Service Delivery", "Transparent Communication" or "industry-leading".',
            *([f"- {angle}"] if angle else []),
            '- "intro": one plain sentence introducing the reasons.',
            'Answer with JSON only: {"intro": "...", "reasons": [{"fact": "F3", "title": "2 to 5 words", "text": "one or two sentences"}]}']), 900)
        for r in d.get("reasons") or []:
            if not isinstance(r, dict):
                continue
            m = re.fullmatch(r"F?(\d+)", str(r.get("fact") or "").strip(), re.I)
            i = int(m.group(1)) - 1 if m else -1
            title, text = _plain(r.get("title")), _plain(r.get("text"))
            fact = facts[i] if 0 <= i < len(facts) else ""
            invented_numbers = [n for n in re.findall(r"\d[\d,.]*", f"{title} {text}") if n not in fact]
            if fact and i not in used and title and text and not _GENERIC_CLAIMS.search(f"{title} {text}") and not invented_numbers:
                got.append({"title": title, "text": text, "fact": fact})
                used.add(i)
        intro = _plain(d.get("intro"))
    else:
        intro = ""
    # top up from the remaining verified details, written plainly (still only what the profile says)
    for i, f in enumerate(facts):
        if len(got) >= 5:
            break
        if i in used:
            continue
        label, value = [x.strip() for x in f.split(":", 1)]
        plain = {"Service": (label.split()[0], f"{brand} offers {value}."),
                 "Location": ("Local and easy to reach", f"{brand} is based at {value}."),
                 "Phone": ("Talk to the team directly", f"You can call {getattr(b, 'phone', '')} to ask your questions."),
                 "Website": ("Details online", f"Services and details are on {value}."),
                 "Online": ("Book online", "You can book through the online booking link.")}.get(label.split()[0])
        if plain:
            got.append({"title": value[:40] if label == "Service" else plain[0], "text": plain[1], "fact": f})
            used.add(i)
    note = ""
    if len(got) < 5:  # a thin profile: the rest are neutral criteria, never invented claims; the editor is told
        for t, x in [("Clear explanations", f"Look for a team that explains {primary} plainly before you commit."),
                     ("Fit for your needs", "Choose a provider that shapes its work around your situation."),
                     ("Easy to reach", f"Make sure you can reach them easily{loc_str} when you have questions.")][: 5 - len(got)]:
            got.append({"title": t, "text": x, "fact": ""})
        note = (f"'Why choose' has only {sum(1 for r in got if r['fact'])} reasons backed by the business profile; the rest are neutral criteria."
                " Add services, what makes the business different and contact options to the profile for five verified reasons.")
    return got[:5], intro or f"Here is why readers choose {brand}:", note


_CTA_BANNED = re.compile(r"next level|proven|specialists?|happy to help|one-stop|world[- ]class|best in|unmatched|don'?t miss|act now|hurry|guarantee|"
                         r"\bready to\b|\bperfect\b|look no further|dream", re.I)


def _cta_text(b, brand: str, primary: str, topic: str, title: str, avoid: str = "") -> str:
    """One or two plain sentences inviting the reader to get in touch, written for this article: no stock promotional phrases, no repeated keyword."""
    d = _json("\n".join([
        f'Write the closing call-to-action text (1 or 2 sentences, at most 45 words) for the blog article "{title}" by {brand}.',
        "Business profile (true facts only):", ai.profile_text(b)[:1200],
        f'- Invite the reader to contact {brand} about what this article covered, in plain friendly words. Do NOT use the phrase "{primary}".',
        '- No stock phrases ("take it to the next level", "ready to", "perfect", "proven", "specialists", "happy to help", "act now"), no numbers, no claims the'
        " profile does not state. Mention one concrete thing the reader can do with the business (from the profile), e.g. visit, call, try on or book.",
        *(["- Do NOT repeat these points, already made just above in the article: " + avoid[:800]] if avoid else []),
        'Answer with JSON only: {"text": "..."}']), 200)
    t = " ".join(_plain(d.get("text") or "").split())
    if t and len(t.split()) <= 50 and not _CTA_BANNED.search(t) and not re.search(r"\d", t) and brand.lower() in t.lower():
        return t
    return f"Have a question about your own situation? Contact {brand} and talk it through with the team."


def dedupe_sentences(body: str) -> tuple[str, int]:
    """Remove sentences that repeat an earlier one (nearly the same words) across the introduction, the main sections, the WH answer and "Don't wait".
    The FAQ answers, "Why choose" and the CTA are left alone (an FAQ answer has to stand on its own). Returns (body, sentences removed)."""
    schema = "\n".join(m.group(0) for m in _SCHEMA_RE.finditer(body or ""))
    vis = _SCHEMA_RE.sub("\n", body or "")
    pieces = re.split(r"(<h2\b[^>]*>[\s\S]*?</h2>)", vis)
    seen: list[set] = []
    removed = 0
    words = lambda s: {w[:6] for w in re.findall(r"[a-z0-9]+", s.lower()) if len(w) > 2}  # noqa: E731

    def one_p(m: re.Match) -> str:
        nonlocal removed
        inner = m.group(2)
        if "<" in inner:  # formatted text (links, bold labels): left as it is
            return m.group(0)
        keep = []
        for s in re.split(r"(?<=[.!?])\s+", html.unescape(inner).strip()):
            ws = words(s)
            if len(ws) >= 6 and any(len(ws & o) / len(ws | o) >= 0.7 for o in seen):
                removed += 1
                continue
            if len(ws) >= 6:
                seen.append(ws)
            keep.append(s)
        return f"<p{m.group(1)}>{html.escape(' '.join(keep), quote=False)}</p>" if keep else ""

    for i in range(0, len(pieces), 2):
        head = _text(pieces[i - 1]) if i else ""
        if i and re.search(r"frequently asked|faq|why choose|what to look for|contact|ready to get started", head, re.I):
            continue
        pieces[i] = _P_RE.sub(one_p, pieces[i])
    out = "".join(pieces)
    return out + ("\n\n" + schema if schema else ""), removed


def _faq_relevance(items: list[tuple[str, str]], title: str) -> list[int]:
    """Indexes of FAQ answers that do not directly answer their own question: an AI check of every pair, plus a Python check that the answer
    shares the question's key words. Used before saving; those answers are written again."""
    stop = {"what", "why", "how", "when", "where", "which", "who", "does", "do", "is", "are", "can", "should", "the", "a", "an", "for", "of", "to", "in", "my", "i", "you", "your", "it"}
    bad = set()
    for i, (q, a) in enumerate(items):
        qw = {w[:5] for w in re.findall(r"[a-z0-9]+", q.lower()) if w not in stop and len(w) > 2}
        aw = {w[:5] for w in re.findall(r"[a-z0-9]+", _text(a).lower())}
        if qw and not (qw & aw):
            bad.add(i)
    pairs = [{"n": i, "question": q, "answer": _text(a)[:600]} for i, (q, a) in enumerate(items)]
    d = _json("\n".join([
        f'Check the FAQ of the blog article "{title}". For EACH pair give a verdict: "direct" is true when the answer\'s first sentence answers THIS'
        " question itself (a definition for a 'what is' question, a time for a 'when/how early' question, a yes/no/it-depends for a yes/no question,"
        " the items for a 'what should I check' question). It is false only when the answer talks about something else or never answers.",
        json.dumps(pairs),
        'Answer with JSON only: {"verdicts": [{"n": 0, "direct": true, "why": "a few words"}]}']), 600)
    for v in d.get("verdicts") or []:  # only an explicit "direct": false counts (an unclear or missing verdict is not a failure)
        if isinstance(v, dict) and isinstance(v.get("n"), int) and 0 <= v["n"] < len(items) and v.get("direct") is False:
            bad.add(v["n"])
    return sorted(bad)


def required_sections(body: str) -> dict:
    """Which of the required parts the article HTML has (the JSON-LD block is ignored): a dict of part -> True/False, plus the FAQ count."""
    vis = _SCHEMA_RE.sub("\n", body or "")
    pieces = re.split(r"(<h2\b[^>]*>[\s\S]*?</h2>)", vis)
    intro = _text(re.sub(r"<h1\b[^>]*>[\s\S]*?</h1>", "", pieces[0]))
    secs = [(_text(pieces[i]), pieces[i + 1] if i + 1 < len(pieces) else "") for i in range(1, len(pieces), 2)]
    has = lambda rx, min_chars=80: any(re.search(rx, h, re.I) and len(_text(c)) >= min_chars for h, c in secs)  # noqa: E731
    faq = next((c for h, c in secs if re.search(r"frequently asked|faq", h, re.I)), "")
    answered = len(re.findall(r"</h3>\s*<p\b[^>]*>\s*\S", faq, re.I))
    special = re.compile(r"^(what|why|how|when|where)\b.*\?$|why choose|what to look for|frequently asked|faq|contact|ready to get started|" + ACTION_RE.pattern, re.I)
    main = [(h, c) for h, c in secs if not special.search(h)]
    return {
        "h1": bool(re.search(r"<h1\b", vis, re.I)), "intro": len(intro) >= 500, "main_sections": len(main) >= 2 and all(len(_text(c)) >= 350 for _, c in main),
        "wh": has(r"^(what|why|how|when|where)\b.*\?$", 60), "dont_wait": has(ACTION_RE.pattern), "why": has(r"why choose|what to look for"),
        "faqs": answered >= 5, "cta": has(r"contact|ready to get started", 40), "faq_count": answered,
        "empty_main": [h for h, c in main if len(_text(c)) < 350],
    }


def complete_article(body: str, *, title: str, primary: str, brand: str, loc_str: str, rules: list[str], all_heads: list[str], used: set,
                     help_h: str, faq_n: int = 5, facts: list[str] | None = None) -> tuple[str, list[str], list[str]]:
    """The final completeness check before the article is saved. Each required part that is missing or empty is written again ON ITS OWN
    (never the whole article): a short introduction gets more chunks, an empty H2 section gets its body, a missing WH answer, "Don't wait"
    section or FAQ answer is written, and the FAQs are topped up to five. Returns (body, what was regenerated, what is still missing)."""
    fixed: list[str] = []
    schema = "\n".join(m.group(0) for m in _SCHEMA_RE.finditer(body or ""))
    vis = _SCHEMA_RE.sub("\n", body or "")
    pieces = re.split(r"(<h2\b[^>]*>[\s\S]*?</h2>)", vis)
    ctx_line = f'You are an expert content writer for {brand}{loc_str}. This is part of the blog article "{title}" (primary keyword: "{primary}").'

    def write(task: str, n: int, words: int) -> str:
        return _write_paragraphs("\n".join([ctx_line, task, *rules]), n, words, all_heads, used=used)

    # introduction: at least 500 characters
    intro = _text(re.sub(r"<h1\b[^>]*>[\s\S]*?</h1>", "", pieces[0]))
    if len(intro) < 500:
        more = write(f"The introduction so far: {intro[:1500] or '(empty)'}\nWrite {2 if intro else 3} more short paragraphs for the INTRODUCTION: why the topic matters"
                     " to the reader and what they will learn. Do not repeat what is already said.", 2 if intro else 3, 60)
        if more:
            pieces[0] = pieces[0].rstrip() + "\n" + _paras(more)
            fixed.append("Introduction (was under 500 characters)")

    action_seen = False
    for i in range(1, len(pieces), 2):
        h = _text(pieces[i])
        content = pieces[i + 1] if i + 1 < len(pieces) else ""
        if ACTION_RE.search(h):
            action_seen = True
        if re.search(r"frequently asked|faq", h, re.I):
            pieces[i + 1] = _complete_faqs(content, title=title, primary=primary, brand=brand, n=faq_n, fixed=fixed, facts=facts,
                                           avoid=[_text(pieces[j]) for j in range(1, len(pieces), 2)])  # FAQs never repeat a section heading (e.g. the WH question)
            continue
        if re.search(r"contact|ready to get started|why choose|what to look for", h, re.I) or len(_text(content)) >= 350:
            continue  # the CTA and "Why choose" are built by their own profile-only code (free text there could invent claims); a section with text is left
        if re.match(r"^(what|why|how|when|where)\b", h, re.I) and h.endswith("?"):
            txt = " ".join(write(f'Answer the question "{h}" in ONE direct paragraph of 3 to 4 sentences (at most 700 characters). The first sentence is the answer.', 1, 110).split())
            if len(txt) > 750:
                cut = txt[:750]
                ends = list(re.finditer(r"[.!?…](?=\s|$)", cut))
                txt = cut[:ends[-1].end()] if ends else cut.rsplit(" ", 1)[0] + "."
            new = f"<p>{html.escape(txt, quote=False)}</p>" if txt else ""
        elif ACTION_RE.search(h):
            txt = write(f'Write the section "{h}": empathetic, informative guidance on why timely action matters for this topic. No fear-based selling.', 2, 60)
            new = _paras(txt) if txt else ""
        else:
            txt = write(f'Write the body of the section "{h}": full informative paragraphs of at least 500 characters with practical explanations and an example; do not repeat other sections of the article.', 2, 100)
            new = _paras(txt) if txt else ""
        if new:
            pieces[i + 1] = "\n" + new + "\n" + content
            fixed.append(f'Section "{h}" (was empty)')

    if not action_seen and help_h:  # the "Don't wait" section is required: add it before "Why choose" (or before the FAQs)
        txt = write(f'Write the section "{help_h}": empathetic, informative guidance on why timely action matters for this topic. No fear-based selling.', 2, 60)
        if txt:
            at = next((i for i in range(1, len(pieces), 2) if re.search(r"why choose|what to look for|frequently asked", _text(pieces[i]), re.I)), len(pieces))
            pieces[at:at] = [f"<h2>{html.escape(help_h, quote=False)}</h2>", "\n" + _paras(txt) + "\n"]
            fixed.append(f'Section "{help_h}" (was missing)')

    out = "".join(pieces)
    still = [k for k, v in required_sections(out).items() if v is False]
    return (out + ("\n\n" + schema if schema else "")), fixed, still


def _complete_faqs(content: str, *, title: str, primary: str, brand: str, n: int, fixed: list[str], facts: list[str] | None = None,
                   avoid: list[str] | None = None) -> str:
    """Every FAQ question gets an answer, and there are n questions."""
    qa = re.findall(r"(<h3\b[^>]*>[\s\S]*?</h3>)\s*(<p\b[^>]*>[\s\S]*?</p>)?", content, re.I)
    items = []
    for hq, p in qa:
        q = _text(hq)
        if _GENERIC_FAQ.search(q):  # a template question, not a reader's: replaced by a real one below
            fixed.append(f'FAQ replaced (template question, not a real reader question): "{q}"')
            continue
        if not p or len(_text(p)) < 20:
            a = " ".join(_trim_to_sentence(_stream_text(f'Give a clear, direct 2-3 sentence answer to the question "{q}" for readers of the article "{title}" about {primary}.'
                                                        " Plain text, complete sentences, no invented numbers.", num_predict=260)).split())
            if a:
                p = f"<p>{html.escape(a, quote=False)}</p>"
                fixed.append(f'FAQ answer: "{q}"')
        items.append((q, p))
    if len(items) < n:
        d = _json("\n".join([f'Write {n - len(items) + 2} more FAQ questions and answers for the blog article "{title}" (primary keyword: "{primary}").',
                             "Questions real readers of this topic type into Google (People-Also-Ask style), different from these questions and from the article's section headings: "
                             + json.dumps([q for q, _ in items] + (avoid or [])),
                             '- Never template questions such as "How long does it take to see results from ...?" or "Why is professional guidance recommended for ...?".',
                             "Each answer starts with the direct answer, 2-3 complete sentences, no invented numbers.", *STRUCTURE_RULES,
                             'Answer with JSON only: {"faqs": [{"question": "...?", "answer": "..."}]}']), 900)
        for f in d.get("faqs") or []:
            if len(items) >= n:
                break
            if isinstance(f, dict) and _plain(f.get("question")) and _plain(f.get("answer")) and not _GENERIC_FAQ.search(_plain(f["question"])):
                items.append((_plain(f["question"]), f"<p>{html.escape(_plain(f['answer']), quote=False)}</p>"))
                fixed.append(f'FAQ added: "{_plain(f["question"])}"')
    # Question-answer relevance check before saving: an answer that does not directly answer ITS question is written again (once)
    items = items[:n]
    for i in _faq_relevance(items, title):
        q = items[i][0]
        a = " ".join(_trim_to_sentence(_stream_text(
            f'Answer this exact question in 2-3 sentences: "{q}". The FIRST sentence must directly answer it (a yes/no question starts with Yes, No or'
            f" It depends). Context: the blog article \"{title}\" about {primary}. Plain text, complete sentences, no invented numbers."
            + (f" Verified details about {brand} you may use if the question is about them: " + "; ".join(facts[:12]) if facts else ""), num_predict=260)).split())
        if a:
            items[i] = (q, f"<p>{html.escape(a, quote=False)}</p>")
            fixed.append(f'FAQ answer rewritten (did not directly answer its question): "{q}"')
    lead = re.split(r"<h3\b", content, maxsplit=1, flags=re.I)[0]
    return lead + "\n".join(f"<h3>{html.escape(q, quote=False)}</h3>\n{p or ''}" for q, p in items[:n]) + "\n"


def _brief_lines(brief: dict | None, plan: bool = False, brand: str = "", bridge: bool = False) -> list[str]:
    """The confirmed content brief, as prompt lines (empty without a brief). `bridge`: the business is partly related (its own rule is in write())."""
    if not brief:
        return []
    out = ["", "CONTENT BRIEF (confirmed by the editor; follow it):"]
    for k, label in (("angle", "Angle"), ("audience", "Target audience"), ("intent", "Search intent")):
        if brief.get(k):
            out.append(f"- {label}: {brief[k]}")
    if brief.get("must_cover"):
        out.append("- Must cover: " + "; ".join(brief["must_cover"][:12]))
    if brief.get("entities"):
        out.append("- Entities to mention where relevant: " + ", ".join(brief["entities"][:12]))
    if brief.get("business_relevant") is False and not bridge:
        out.append("- The business's services are NOT closely related to this topic: mention the business at most once in the introduction (as the publisher of"
                   " the guide), never in the body sections or FAQ answers, and never present it as a provider of this topic.")
    elif brief.get("business_note"):
        out.append(f"- How the business fits: {brief['business_note']}")
    if brief.get("instructions"):
        from .seo_workflow.master_prompt import resolve_client
        out.append(f"- Writer notes: {resolve_client(brief['instructions'], brand)}")
    if plan:
        out.append("- Outline (start with these H2 headings, in this order): " + " | ".join(s["h2"] for s in brief["outline"]))
        if brief.get("wh_question"):
            out.append(f'- WH question: "{brief["wh_question"]}"')
        if brief.get("faqs"):
            out.append("- FAQs: answer exactly these questions, in this order: " + json.dumps(brief["faqs"]))
    return out


def blog_brief(primary: str, brand: str, location: str = "") -> list[str]:
    """THE content rules every article is written under: defined once, in the central master prompt (seo_workflow/master_prompt.py)."""
    from .seo_workflow.master_prompt import content_rules
    return content_rules(primary, brand, location)

def write(primary: str, secondary: list[str], rising: list[str], b: Business, topic: str = "", progress=lambda text, body="", title="", meta="": None, length: str = "standard",
          title_hint: str | None = None, meta_hint: str | None = None, brief: dict | None = None, blog_title: str | None = None) -> dict:
    """(`brief`: the content brief from the SEO workflow (seo_workflow/stages.content_brief), as the user confirmed it. When given, its
    outline, WH question, FAQs, audience and business fit drive the article; without it the article is planned here as before.)"""
    brief = brief if isinstance(brief, dict) and brief.get("outline") else None
    """Generate one complete blog article strictly adhering to the 10-part SEO Writing Structure:
    1. Blog Title (H1)
    2. Introduction (min 500 chars)
    3. Subheading 1 (H2): Paragraph 2 + Paragraph 3 (500+ chars each)
    4. Subheading 2 (H2): Paragraph 4 (500+ chars)
    5. WH Question (H2): Answer up to 750 chars
    6. Don't Wait to Seek Help (H2)
    7. Why Choose [Business Name]? (H2, 5 reasons: only what the profile supports, else evaluation criteria)
    8. FAQs (H2, 5-7 People-Also-Ask style questions and answers) - MANDATORY
    9. CTA - Call To Action with verified business info (phone, website, booking link, location; missing ones left out)
    Every prompt carries blog_brief() (the editor's SEO content brief); paragraphs are chunks of 2-4 sentences; keywords are bolded once per block.
    10. Local Business Schema (<script type="application/ld+json">)
    """
    cfg = LENGTHS.get(length, LENGTHS["standard"])
    wp = WRITE_PLAN.get(length, WRITE_PLAN["standard"])
    brand = _display_case(brand_of(b))  # the short name readers know the business by, in display case ("vastrbhushan Rental" -> "Vastrbhushan Rental")
    city = _display_case(b.city or "")
    area = _display_case(b.area or "") if b.area and len(b.area) <= 40 and (b.city or "").lower() not in (b.area or "").lower() else ""
    # where the business is, for the writing prompts: the area and the city ("Wagholi, Pune") for local focus (the street address is only in the contact box)
    town = ", ".join(x for x in [area, city] if x)
    notes: list[str] = []
    run = {"calls": 0, "ollama_seconds": 0.0}
    steps: list[dict] = []
    started = time.time()
    current: dict = {}
    parts: list[str] = []

    # Clean and distribute ALL secondary keywords across article sections
    clean_secondary = [k.strip() for k in (secondary or []) if k and k.strip()]
    kws = list(clean_secondary)
    intro_kws = kws[:2] if len(kws) >= 2 else kws[:1]
    rem = kws[len(intro_kws):]
    p2_kws = rem[:2] if len(rem) >= 2 else rem[:1]
    rem = rem[len(p2_kws):]
    p3_kws = rem[:2] if len(rem) >= 2 else rem[:1]
    rem = rem[len(p3_kws):]
    p4_kws = rem[:2] if len(rem) >= 2 else rem[:1]
    rem = rem[len(p4_kws):]
    wh_kws = rem[:1]
    rem = rem[len(wh_kws):]
    help_kws = rem[:1]
    rem = rem[len(help_kws):]
    faq_kws = rem  # Any remaining secondary keywords go to FAQs

    def step(name: str) -> None:
        now = time.time()
        if current:
            steps.append({"step": current["name"], "seconds": round(now - current["t"], 1), "calls": run["calls"] - current["calls"]})
        current.update(name=name, t=now, calls=run["calls"])
        if name:
            progress(name, "\n\n".join(x for x in parts if x))

    with _ollama_lock:
        _stats.run = run
        try:
            # ── 0a. Business relevance and keyword fit (every article, with or without research) ──
            step("Checking business relevance and keyword fit...")
            relevance, relevance_note = _business_relevance(b, brand, primary, topic or primary, title_hint or topic or primary, brief)
            business_fits = relevance == "full"
            bridge = relevance == "partial"  # related business: honest guide + its real service as an alternative ("Why Choose" on what it really offers)
            if relevance_note:
                notes.append(relevance_note)
            offers = "; ".join(f.split(":", 1)[1].strip() for f in _profile_facts(b, brand) if f.startswith("Service:"))[:300] or (b.primary_category or "")
            if bridge:
                not_provider = [
                    f'- {brand} is a {(b.primary_category or "local business").lower()} ({offers}). It does NOT sell or provide "{primary}" itself, but its real'
                    f" service is a related option for the same reader (for example renting instead of buying). Write an honest, helpful guide to {primary};"
                    f" where it genuinely helps the reader, present {brand}'s real service as an alternative: in the introduction, in one main section about"
                    f" that alternative, in the \"Don't wait\" section and in about 2 of the 5 FAQ answers. Never say or imply that {brand} sells, stocks or"
                    f" provides {primary}, and never invent its prices, collection, reviews or results."]
            elif not business_fits:
                not_provider = [f'- {brand} does NOT itself provide "{primary}" ({relevance_note}). Keep the article an informational guide: mention {brand} at most once,'
                                " in the introduction as the publisher, never in the body sections or FAQ answers, and never present it as a seller or provider of this topic."]
            else:
                not_provider = []
            fit_kws, unfit_kws = _fitting_keywords(primary, clean_secondary, title_hint or topic or primary, topic or primary)
            if unfit_kws:
                notes.append("Secondary keywords not forced into the text because they do not fit this article's reader: " + ", ".join(unfit_kws))
                kws = list(fit_kws)  # the same distribution as above, over the keywords that fit
                intro_kws = kws[:2] if len(kws) >= 2 else kws[:1]
                rem = kws[len(intro_kws):]
                p2_kws = rem[:2] if len(rem) >= 2 else rem[:1]
                rem = rem[len(p2_kws):]
                p3_kws = rem[:2] if len(rem) >= 2 else rem[:1]
                rem = rem[len(p3_kws):]
                p4_kws = rem[:2] if len(rem) >= 2 else rem[:1]
                rem = rem[len(p4_kws):]
                wh_kws = rem[:1]
                rem = rem[len(wh_kws):]
                help_kws = rem[:1]
                faq_kws = rem[len(help_kws):]

            # ── 0. Plan Complete SEO Blueprint ──
            step("Planning 10-part SEO article structure and metadata...")
            plan_prompt = "\n".join([
                *_context(b, lean=True), "",
                "You are an elite SEO strategist. Plan a comprehensive, high-ranking blog article.",
                f"Topic: {topic or primary}",
                f'Primary keyword: "{primary}"',
                f"Secondary keywords: {json.dumps(fit_kws) if fit_kws else 'None'}",
                f"Business name: {brand} (Location: {town or 'Local'})",
                "",
                *blog_brief(primary, brand, town),
                *not_provider,
                "- Put the primary keyword into a subheading only where it reads naturally (at least two of the main sections is ideal).",
                *_brief_lines(brief, plan=True, brand=brand, bridge=bridge),
                # Regenerating an existing article: its SEO title (and meta description) are fixed; plan to deliver them
                *([f'The SEO title is fixed: "{title_hint}". Plan the article to deliver exactly what this title promises; repeat it unchanged as "title".'] if title_hint else []),
                *([f'The meta description promises the reader: "{meta_hint}". Make sure the article covers it.'] if meta_hint else []),
                *([f'The Blog title (the H1 readers see) is "{blog_title.strip()}": plan the sections to deliver what it promises.'] if blog_title and blog_title.strip() else []),
                "",
                "Answer with ONE JSON object and nothing else:",
                "{",
                f'  "title": "Clear, engaging SEO title under {TITLE_MAX} characters containing exact primary keyword",',
                '  "meta": "One compelling meta description of 120-160 characters (never more than 160) containing exact primary keyword",',
                '  "sections": [',
                *[f'    {{"h2": "Main H2 section {i + 1}", "keyword": "the secondary keyword this section is built around, or empty"}}{"," if i < wp["sections"] - 1 else ""}'
                  for i in range(wp["sections"])],
                '  ],',
                '  "wh_question": "One question a reader would ask that the main sections do NOT already cover, starting with What, Why, How, When, or Where and ending with ?",',
                '  "help_heading": "An action-oriented H2 heading urging timely action",',
                '  "faqs": [',
                *[f'    {{"question": "Frequent question {i + 1}", "answer": "Clear, complete 2-3 sentence answer"}}{"," if i < wp["faqs"] - 1 else ""}' for i in range(wp["faqs"])],
                '  ],',
                '  "tags": ["5 to 8 relevant SEO tags"]',
                "}",
                f"Give exactly {wp['sections']} main sections and exactly {wp['faqs']} FAQs. The main sections take the reader from understanding the topic to choosing"
                " and deciding, each one a clearly different aspect (no overlap): e.g. what it is and the options, where to find it locally, a related place or"
                " market, how to choose, price/value, and an alternative" + (f" (the alternative {brand} really offers)" if bridge else "") + "."
                " Build each H2 around one secondary keyword where one fits (written naturally, in title case); main H2s are statements, not questions"
                f"{f', and use the location ({town}) in one or two of them' if town else ''}.",
                "FAQs: People-Also-Ask style questions built from the primary keyword, the secondary keywords, the search intent and related searches"
                " (cost, how to choose, timelines, what to expect, differences...). No duplicates; never a question written just to fit a keyword."
                " Each answer starts with the direct answer in 2 to 3 sentences that a search snippet or AI answer can quote; use the primary or a secondary keyword where it reads naturally"
                + (f" (good candidates: {json.dumps(faq_kws)})" if faq_kws else "")
                + (f'; mention "{brand}" naturally in most of the answers (about 3 of 5), only where it fits the question and never forced.'
                   + " Verified business details you may use where a question is about them (never contradict or go beyond them): "
                   + "; ".join(_profile_facts(b, brand)[:12])
                   if business_fits else
                   f'; mention "{brand}" in about 2 of the 5 answers, only about its real service ({offers}) as an option the reader can explore'
                   f' (e.g. a question about renting), never as a seller of {primary}.'
                   if bridge else f'; do not mention "{brand}" in any answer.')
                + ' Never template questions such as "How long does it take to see results from ...?" or "Why is professional guidance recommended ...?".',
            ])
            d_plan = _json(plan_prompt, num_predict=2600)
            if not d_plan.get("title"):  # unusable or cut-off JSON: one more try before falling back to defaults
                log.warning("Article plan was not usable JSON; retrying once")
                d_plan = _json(plan_prompt + "\n\nAnswer with ONLY the complete JSON object.", num_predict=3000)
            raw_title = _plain(d_plan.get("title") or "")
            title = raw_title if raw_title and len(raw_title) <= TITLE_MAX else _shorten_title(raw_title, primary) if raw_title else ""
            if not title or len(title) > TITLE_MAX or not _has(title, primary):
                title = _title_for_topic(_json, primary, topic, d_plan.get("title") or "") or f"{primary.title()}: A Complete Guide"
                if len(title) > TITLE_MAX:
                    title = primary.title()[:TITLE_MAX].rsplit(" ", 1)[0]
            if title_hint and title_hint.strip():
                title = title_hint.strip()  # regenerating: the editor's SEO title is kept as the H1
            # The SEO title (Google, max 60) is saved as the article's title; a Blog title picked on the Title step becomes the H1 and the
            # title every section is written for (`title` below). Without one, the H1 is the SEO title, as before.
            seo_title = title
            if blog_title and blog_title.strip():
                title = " ".join(blog_title.split())[:BLOG_TITLE_MAX]
            meta =_plain(d_plan.get("meta") or f"A practical guide to {primary}: what it is, what to check before you decide and the questions readers ask most, explained in plain words.")
            if len(meta) > META_MAX:
                meta = fit_meta(meta)
            tags = [_plain(t) for t in d_plan.get("tags") or [] if _plain(t)][:8]
            
            shown_kw = re.search(re.escape(primary), title or "", re.I)  # the keyword as the title writes it ("Digital Solution", "ERP")
            kw_shown = shown_kw.group(0) if shown_kw else " ".join(w if w.isupper() else w.capitalize() for w in primary.split())
            kw_article = kw_shown if kw_shown.lower().endswith("s") else f"{'an' if kw_shown[:1].lower() in 'aeiou' else 'a'} {kw_shown}"  # "a Digital Solution", "Digital Solutions"
            plan_secs = [{"h2": _plain(s.get("h2")).rstrip("?"), "h3": [], "points": [], "kw": _plain(s.get("keyword"))}
                         for s in (d_plan.get("sections") or []) if isinstance(s, dict) and len(_plain(s.get("h2"))) >= 8][:wp["sections"]]
            sub_1 = plan_secs[0]["h2"] if plan_secs else f"Key Things to Know About {kw_article}"
            sub_2 = plan_secs[1]["h2"] if len(plan_secs) > 1 else "How to Choose the Right Option"
            wh_q = _plain(d_plan.get("wh_question") or "").strip()
            if not re.match(r"^(What|Why|How|When|Where)", wh_q, re.I):
                # a reader's question about the topic; the old "...Benefit Your Business?" fallback made the answer address business owners
                wh_q = f"What Should You Know About {kw_article}?"  # grammatical ("About a Digital Solution?"; the old "Before Starting Digital Solution?" was not)
            if re.search(r"\byour business\b|business growth", wh_q, re.I):
                wh_q = f"What Should You Know About {kw_article}?"  # grammatical ("About a Digital Solution?"; the old "Before Starting Digital Solution?" was not)
            if not wh_q.endswith("?"):
                wh_q = wh_q.rstrip(".!:; ") + "?"
            help_h = _plain(d_plan.get("help_heading") or "Don't Wait to Seek the Right Help")
            if not ACTION_RE.search(help_h):  # the planned heading must read as the "Don't Wait to Take Action" section
                help_h = f"Don't Wait: {help_h}" if len(help_h) <= 60 else "Don't Wait to Seek the Right Help"
            # Real reader questions only: template questions ("How long does it take to see results from ...?") are dropped, and when the plan gave
            # none, the completeness check below writes five topic-specific ones (the old fixed agency-style fallback FAQs are gone).
            plan_faqs = [f for f in (d_plan.get("faqs") or []) if isinstance(f, dict) and _plain(f.get("question"))
                         and not _GENERIC_FAQ.search(_plain(f.get("question")))][:wp["faqs"]]
            # (Leftover secondary keywords are no longer turned into template FAQs; the plan prompt asks for natural
            # reader questions that use them only where they fit.)

            # The confirmed content brief decides the outline, the WH question, the FAQ questions and whether "Don't wait" fits the topic.
            sections = plan_secs if len(plan_secs) >= 2 else [{"h2": sub_1, "h3": [], "points": []}, {"h2": sub_2, "h3": [], "points": []}]
            include_help = True
            if brief:
                from .seo_workflow.stages import _overlap as _ov
                given = [s for s in brief["outline"] if isinstance(s, dict) and s.get("h2")][:wp["sections"]]
                # the brief's sections first, then the plan's other sections up to the length's section count
                sections = (given + [s for s in plan_secs if all(_ov(s["h2"], g["h2"]) < 0.6 for g in given)])[:wp["sections"]] or sections
                sub_1 = sections[0]["h2"]
                sub_2 = sections[1]["h2"] if len(sections) > 1 else sub_2
                if re.match(r"^(What|Why|How|When|Where)\b", brief.get("wh_question") or "", re.I):
                    wh_q = brief["wh_question"].rstrip(".!:; ") + ("" if brief["wh_question"].endswith("?") else "?")
                # ("Don't Wait" is a required section of every article: it is always written)
                planned = {_norm(_plain(f.get("question"))): f.get("answer") for f in plan_faqs if isinstance(f, dict)}
                if brief.get("faqs"):  # the brief's questions; the plan's answer where it answered the same question, otherwise written below
                    plan_faqs = [{"question": q, "answer": planned.get(_norm(q)) or ""} for q in brief["faqs"][:wp["faqs"]]]

            # ── 1. Blog Title (H1) ──
            h1_html = f"<h1>{html.escape(title, quote=False)}</h1>"
            parts.append(h1_html)
            progress(f"Starting article: {title}", "\n\n".join(parts), title=title, meta=meta)

            # ── 2-6. Introduction, two subheadings, WH answer and action paragraph ──
            # Each part is ONE call for N complete paragraphs (sized by the chosen length), so paragraphs never end
            # mid-sentence and are never glued together from separate "expand" calls that restate each other.
            loc_str = f" in {town}" if town else ""
            outline = [*[s["h2"] for s in sections], wh_q, *([help_h] if include_help else []), f"Why Choose {brand}?", "Frequently Asked Questions"]
            all_heads = [title, "Introduction", *outline, "Answer", "Conclusion"]
            groups = {"short": 2, "standard": 3, "long": 4}.get(length, 3)  # H3 groups (each with its own list) per main section
            used_openings: set[str] = set()  # paragraph openings so far, so later sections don't start the same way
            location = town
            brief_rules = ["", *blog_brief(primary, brand, location), *_brief_lines(brief, brand=brand, bridge=bridge), *not_provider, ""]  # the content rules (+ the confirmed brief), also in the JSON (structured) section prompts below
            rules = [
                *brief_rules,
                "",
                "FORMAT OF THIS ANSWER:",
                "- Plain-text paragraphs only, separated by ONE blank line: no headings, labels, markdown, bullets or numbering (lists are added separately).",
                "- Write in short, readable paragraph chunks of the size asked above (never one long block), each developing ONE"
                " point with explanation, an example or a tip; each paragraph makes a NEW point and starts with different words. Write naturally, not formally.",
                "- Bold primary and secondary keywords naturally (bold text only, no background highlights).",
                "- Stay inside this part's scope; the other outline sections cover their own points.",
            ]
            outline_line = "Article outline: Introduction → " + " → ".join(outline)
            every_kw = [primary, *fit_kws]  # (keywords that do not fit this article's reader are not pushed into the text)

            def covered_note() -> list[str]:
                """What the article already says (its headings and the opening sentence of each paragraph so far), so a later section adds new
                information instead of explaining the same thing again."""
                so_far = "\n".join(parts)
                heads = [_text(h) for h in re.findall(r"<h[23]\b[^>]*>(.*?)</h[23]>", so_far, re.S | re.I)]
                firsts = [re.split(r"(?<=[.!?])\s", _text(p))[0] for p in re.findall(r"<p\b[^>]*>(.*?)</p>", so_far, re.S | re.I)]
                text = " | ".join(x for x in [*heads, *firsts] if x)[:3000]
                return [f"ALREADY COVERED earlier in this article (do NOT explain these again; add only new information): {text}"] if text else []

            def section_hints(sec: dict) -> list[str]:
                """The brief's H3 sub-headings and key points for one main section (nothing without a brief)."""
                out = []
                if sec.get("h3"):
                    out.append("- Use these as the group H3 headings (adapt the wording only if needed): " + " | ".join(sec["h3"][:groups]))
                if sec.get("points"):
                    out.append("- Cover these points: " + "; ".join(sec["points"][:6]))
                return out

            def kw_rule(kws: list[str]) -> list[str]:
                return [f'- Use these phrases where they fit this part naturally (about once each): {", ".join(chr(34) + k + chr(34) for k in kws)}.'
                        " Skip a phrase rather than force it into a sentence where it changes the meaning or reads badly; a \"near me\" phrase is"
                        " written naturally (e.g. \"nearby\") or left out."] if kws else []

            def live(label: str):
                return lambda txt: progress(label, "\n\n".join([*parts, _paras(txt)]), title=title, meta=meta)

            # 2. Introduction
            # the introduction: exactly 3 SHORT, natural paragraphs (3-4 sentences, ~60 words each), not long formal blocks
            n, w = 3, INTRO_CHUNK_WORDS
            step(f"Writing Introduction ({n} paragraphs)...")
            intro_prompt = "\n".join([
                f'You are an expert content writer for {brand}{loc_str}. Write the INTRODUCTION of the blog article "{title}".',
                outline_line,
                f"Write exactly {n} short paragraphs of about {w} words (3 to 4 sentences) each, separated by ONE blank line.",
                "- Write naturally, like a friendly expert talking to the reader: plain words, no formal or stiff phrasing, no filler openings.",
                f'- The very first sentence must contain the exact phrase "{primary}".',
                *kw_rule(intro_kws),
                f"- Hook the reader, explain why {primary} matters to them{loc_str}, and preview what the article covers. Do not go into the details of the later sections.",
                *rules,
            ])
            intro_json = _json("\n".join([
                f'You are an expert content writer for {brand}{loc_str}. Write the INTRODUCTION of the blog article "{title}".',
                outline_line,
                *brief_rules,
                f'- "paragraphs": exactly {n} SHORT paragraphs, each 3 to 4 sentences (about {w} words). The very first sentence must contain the exact phrase "{primary}".',
                "  Write naturally, like a friendly expert talking to the reader: plain words, no formal or stiff phrasing, no filler openings.",
                f"  Start with an engaging, relevant opening; explain the topic and why it matters to the reader{loc_str}, and what the article covers, in natural prose. Do not go into the details of later sections.",
                (f'  Mention "{brand}" naturally in one of the chunks' if business_fits else
                 f'  In the last chunk, mention "{brand}" once as a related option it really offers ({offers}), e.g. renting for an occasion instead of buying;'
                 f' never as a seller or provider of {primary}' if bridge else
                 f'  Mention "{brand}" at most once, only as the publisher of this guide (never as a seller or provider of {primary})')
                + (f", and {location} only where it is relevant." if location else "."),
                "  Natural introductory paragraphs only: no list, no \"in this guide you will learn\" summary.",
                *kw_rule(intro_kws),
                *STRUCTURE_RULES,
                'Answer with JSON only: {"paragraphs": ["...", "..."]}',
            ]), n * 260 + 400)
            # (no "What you will learn" bullet list any more: the introduction is natural paragraphs only)
            intro_html = "\n".join(x for x in [_p(x) for x in (intro_json.get("paragraphs") if isinstance(intro_json.get("paragraphs"), list) else [])[:3]] if x)
            if intro_html.count("<p>") >= 2 and primary.lower() in _text(intro_html).lower():
                parts.append(intro_html)
                intro_txt = "done"
            else:
                intro_txt = _write_paragraphs(intro_prompt, n, w, all_heads, used=used_openings, on_chunk=live("Writing Introduction..."))
            if not intro_txt:  # never leave the introduction empty
                intro_txt = (f"{primary.capitalize()} is a topic many people{loc_str} want clear, reliable guidance on. "
                             f"This guide from {brand} explains what it involves, what to expect and how to choose the right next step for you.")
            if intro_txt != "done":
                parts.append(_paras(intro_txt))
            progress("Introduction complete.", "\n\n".join(parts), title=title, meta=meta)

            # Main sections (the approved format): an H2, full paragraphs of at least 500 characters each, then ONE H3 sub-section with a short
            # list (types, checks, steps, options) where a list really helps the reader. The brief's sub-headings and points become what they cover.
            def section_text(h2: str, sec: dict | None, n_p: int, w_p: int, task: str, kws: list[str]) -> str:
                prompt = "\n".join([
                    f'You are an expert content writer for {brand}{loc_str}. Write the section "{h2}" of the blog article "{title}" (primary keyword: "{primary}").',
                    outline_line,
                    f"Write exactly {n_p} short paragraphs of about {w_p} words (3 to 4 sentences) each. {task}",
                    *([f"- Cover these points across the paragraphs: " + "; ".join([*(sec.get("h3") or [])[:4], *(sec.get("points") or [])[:6]])]
                      if sec and (sec.get("h3") or sec.get("points")) else []),
                    *covered_note(),
                    *kw_rule(kws),
                    f'- Use these keywords where they read naturally (never forced): {", ".join(chr(34) + k + chr(34) for k in every_kw)}.',
                    *rules,
                ])
                return _write_paragraphs(prompt, n_p, w_p, all_heads, used=used_openings, on_chunk=live(f"Writing {h2}..."))

            # 3-4. Every main section in turn: its paragraphs, then its optional H3 + list sub-section
            pool = [k for k in fit_kws if k not in intro_kws]  # secondary keywords for sections that did not name their own
            h3_used: list[str] = []
            for si, sec in enumerate(sections):
                h2x = sec["h2"]
                n, w = wp["sub1" if si == 0 else "sub2" if si == 1 else "extra"]
                # same section length (~500 words), written as SMALL chunks: ~70 words (3-4 sentences) each, so 6-7 chunks per section
                n, w = max(n, round(n * w / SECTION_CHUNK_WORDS)), SECTION_CHUNK_WORDS
                step(f"Writing section {si + 1} of {len(sections)}: {h2x} ({n} paragraphs)...")
                parts.append(f"<h2>{html.escape(h2x, quote=False)}</h2>")
                progress(f"Writing: {h2x}", "\n\n".join(parts), title=title, meta=meta)
                own = [k for k in fit_kws if sec.get("kw") and k.lower() == sec["kw"].lower()]
                kws_x = own or pool[si:si + 1]
                # about 500 words per section, written as SEPARATE natural paragraph chunks (never one long block of text)
                chunk_rule = (f" Split the section into {n} separate SHORT paragraph chunks of about {w} words (3 to 4 sentences) each, with ONE blank line between them;"
                              " never one long block of text."
                              f' Each chunk naturally uses the primary keyword "{primary}" or one of the secondary keywords given below'
                              " (spread them across the chunks, about once each; never forced).")
                if si == 0:
                    task = ("Chunk 1: continue elaborating on the topic, providing useful insights and background information. "
                            "Next chunks: expand on the subtopic, adding examples and practical tips (one new point per chunk)." + chunk_rule)
                else:
                    task = ("Introduce the next angle or perspective of the topic; each chunk covers one new point of this angle with practical guidance or an example. "
                            "The earlier sections already covered their own points; cover only this section's angle." + chunk_rule)
                if bridge and re.search(r"\brent|\balternative|instead of", h2x, re.I):
                    task += f" This is the section where {brand}'s real service ({offers}) may be mentioned once, honestly, as an option to explore."
                x_txt = section_text(h2x, sec, n, w, task, kws_x)
                if x_txt:
                    # a section that still came back as one long block is cut into natural chunks of whole sentences (~w words each)
                    parts.append(chunk_paragraphs(_paras(x_txt), max_words=w)[0])
                    if sec.get("h3") or sec.get("points") or length in ("standard", "long"):
                        sub = _section_list(f'Blog article "{title}" (primary keyword "{primary}"){loc_str}. Do not mention any business name in the list.',
                                            h2x, x_txt, [*h3_used, *[s["h2"] for s in sections]])
                        if sub:
                            parts.append(sub)
                            h3_used.append(_text(re.search(r"<h3>(.*?)</h3>", sub).group(1)))
                progress(f"{h2x} complete.", "\n\n".join(parts), title=title, meta=meta)

            # 5. WH Question (answer up to 750 characters, ending on a full sentence): on a point the main sections have NOT explained
            wh_q = _fresh_wh_question(wh_q, "\n".join(parts), primary, title)
            step(f"Writing WH Question: {wh_q}...")
            parts.append(f"<h2>{html.escape(wh_q, quote=False)}</h2>")
            progress(f"Writing: {wh_q}", "\n\n".join(parts), title=title, meta=meta)
            wh_prompt = "\n".join([
                f'Answer the question "{wh_q}" for readers of an article about "{primary}".',
                "Write ONE direct paragraph of 3 to 4 sentences (at most 700 characters). The first sentence IS the answer, so a featured snippet or AI answer can quote it.",
                *covered_note(),
                *kw_rule(wh_kws),
                *rules,
            ])
            wh_text = " ".join(_write_paragraphs(wh_prompt, 1, 110, all_heads, used=used_openings, on_chunk=live("Writing WH Answer...")).split())
            if len(wh_text) > 750:
                cut = wh_text[:750]
                ends = list(re.finditer(r"[.!?…](?=\s|$)", cut))
                wh_text = cut[:ends[-1].end()] if ends else cut.rsplit(" ", 1)[0] + "."
            if wh_text:
                parts.append(f"<p>{html.escape(wh_text, quote=False)}</p>")
            progress("WH Question complete.", "\n\n".join(parts), title=title, meta=meta)

            # 6. Don't Wait to Seek Help / Take Action (H2): only when the brief says it genuinely helps readers of this topic
            if include_help:
                step(f"Writing: {help_h}...")
                parts.append(f"<h2>{html.escape(help_h, quote=False)}</h2>")
                progress(f"Writing: {help_h}", "\n\n".join(parts), title=title, meta=meta)
                help_prompt = "\n".join([
                    f'Write ONE empathetic, informative paragraph of 4 to 6 sentences (at least {PARA_MIN_CHARS} characters) for the section "{help_h}" of an article about "{topic or primary}".'
                    " Encourage the reader to take timely action, with empathetic language.",
                    f"Be specific to THIS topic: the concrete problem a reader of an article about {primary} faces if they put it off, and the first sensible thing to do."
                    " Every sentence says something different; no general 'take action today' lines, no fear-based selling and no exaggerated claims.",
                    *([f"- End by inviting the reader to explore {brand}'s real service ({offers}) as an option and to enquire about availability; never as a seller of {primary}."]
                      if bridge else []),
                    *covered_note(),
                    *kw_rule(help_kws),
                    *rules,
                ])
                help_txt = _write_paragraphs(help_prompt, 1, 110, all_heads, used=used_openings, on_chunk=live("Writing Action Guidance..."))
                if help_txt:
                    parts.append(_paras(help_txt))
                    steps_json = _json("\n".join([
                        f'For the section "{help_h}" of an article about "{topic or primary}", give 3 or 4 short next steps a reader can take now (8 to 16 words each), as an ordered list.',
                        "Each step is concrete and specific to this topic, different from the others, and not a repeat of the paragraph: " + _text(_paras(help_txt))[:600],
                        *STRUCTURE_RULES, 'Answer with JSON only: {"steps": ["...", "..."]}',
                    ]), 350)
                    next_steps = _list_html(steps_json.get("steps"), True)
                    if next_steps:
                        parts.append("<p><strong>Your next steps</strong></p>\n" + next_steps)
                progress("Action Guidance complete.", "\n\n".join(parts), title=title, meta=meta)

            # ── 7. Why Choose [Business Name]? (H2, 3-5 reasons) ──
            # When the brief found the business is NOT related to the topic (e.g. a marketing agency writing about manufacturing ERP), this section
            # becomes neutral evaluation criteria with no business claims, so the article never presents the business as a provider it is not.
            # (business_fits was decided at the start by _business_relevance: the brief, a word-overlap veto and the AI's full/partial/none check)
            # the keyword as the title writes it ("Manufacturing ERP", not "Manufacturing Erp")
            shown = re.search(re.escape(primary), title or "", re.I)
            # "Why Choose Vastrabhushan for Designer Dress Rentals in Pune?": the business, what the article is about and (for a local business) the city
            kw_head = shown.group(0) if shown else kw_shown
            if business_fits:
                why_title = f"Why Choose {brand} for {kw_head}" + (f" in {city}" if city and city.lower() not in kw_head.lower() else "") + "?"
                if len(why_title) > 90:
                    why_title = f"Why Choose {brand} for {kw_head}?"
            elif bridge:
                why_title = f"Why Choose {brand}?"  # about what the business really offers, not the article's topic
            else:
                why_title = f"Why Choose {brand}?" if brand else f"What to Look For When Choosing {kw_head}"  # template 7: Why Choose [company_clientname]?
            step(f"Writing: {why_title}...")
            h2_why = f"<h2>{html.escape(why_title, quote=False)}</h2>"
            parts.append(h2_why)

            # Exactly five reasons, each one tied to a VERIFIED profile detail (checked in Python). No generic claims such as "Proven Methodology".
            if business_fits or bridge:
                reasons, intro_line, why_note = _why_reasons(
                    b, brand, primary, topic or primary, loc_str,
                    angle=(f'{brand} does NOT sell or provide "{primary}". Write every reason about its real service ({offers}) as an option for this'
                           f" article's reader (e.g. renting for an occasion instead of buying), and never say it offers {primary}.") if bridge else "")
                if why_note:
                    notes.append(why_note)
            else:
                why_json = _json("\n".join([
                    f'Write the section "{why_title}" of a blog article titled "{title}" (primary keyword "{primary}").',
                    '- "intro": one sentence that introduces the five criteria, without exaggeration.',
                    '- "reasons": exactly 5 objects {"title": "2 to 5 words", "text": "one or two sentences"}: practical things a reader should check'
                    f" when choosing {primary} (a product: quality, fit, price, returns...; a service: experience, scope, support...), each one different.",
                    "- Do not mention any business or brand name; no invented numbers.",
                    *(["- Do NOT repeat these points, already made in the article: " + _text("\n".join(parts))[-1500:]] if parts else []),
                    *STRUCTURE_RULES,
                    'Answer with JSON only: {"intro": "...", "reasons": [{"title": "...", "text": "..."}]}',
                ]), 900)
                reasons = [r for r in (why_json.get("reasons") or []) if isinstance(r, dict) and _plain(r.get("title")) and _plain(r.get("text"))][:5]
                if len(reasons) < 5:
                    reasons = [{"title": t, "text": x} for t, x in [
                        ("Quality you can check", f"Look closely at the quality of the {primary} before you decide, not only the description."),
                        ("Fit for your needs", "Choose the option that suits your situation and how you will use it, not the most popular one."),
                        ("Clear price and terms", "Compare what is included in the price and the terms for changes, returns or cancellations."),
                        ("Honest reviews", "Read recent reviews from people with similar needs, and look for patterns rather than single comments."),
                        ("Easy to reach", "Make sure the seller or provider is easy to reach when you have a question."),
                    ]]
                intro_line = _plain(why_json.get("intro")) or f"Here is what to check when choosing {primary}:"
            why_html = f"<p>{html.escape(intro_line, quote=False)}</p>\n<ol>\n" + "\n".join(
                f"<li><strong>{html.escape(_plain(r['title']), quote=False)}:</strong> {html.escape(_plain(r['text']), quote=False)}</li>" for r in reasons) + "\n</ol>"
            parts.append(why_html)
            progress(f"Why Choose {brand} complete.", "\n\n".join(parts), title=title, meta=meta)

            # ── 8. FAQs (H2, 3-5 questions and answers) - MANDATORY ──
            step("Writing Mandatory FAQs section (3-5 Q&As)...")
            h2_faq = "<h2>Frequently Asked Questions</h2>"
            parts.append(h2_faq)
            progress("Writing FAQs...", "\n\n".join(parts), title=title, meta=meta)

            faq_blocks = []
            from .seo_workflow.stages import _overlap
            for item in plan_faqs:
                q = item.get("question") if isinstance(item, dict) else str(item)
                a = item.get("answer") if isinstance(item, dict) else ""
                if q and _overlap(_plain(q), wh_q) >= 0.75:
                    continue  # the WH section already answers it; the completeness check adds a different question instead
                if q:
                    if not a or len(a) < 30:
                        ans_prompt = f'Provide a clear, authoritative 2-3 sentence answer to the question: "{q}" for readers researching {primary}.'
                        a = " ".join(_trim_to_sentence(_stream_text(ans_prompt + " Plain text only, complete sentences.", num_predict=220)).split())
                    a = " ".join(_plain(a).split())
                    h3_q = f"<h3>{html.escape(q, quote=False)}</h3>"
                    p_a = f"<p>{html.escape(a, quote=False)}</p>"
                    faq_blocks.append(f"{h3_q}\n{p_a}")
                    progress("Writing FAQs...", "\n\n".join([*parts, "\n".join(faq_blocks)]), title=title, meta=meta)
            parts.append("\n".join(faq_blocks))
            progress("FAQs complete.", "\n\n".join(parts), title=title, meta=meta)

            # ── 9. CTA - Call To Action with Verified Business Details ──
            step(f"Writing CTA for {brand}...")
            h2_cta = f"<h2>Contact {html.escape(brand, quote=False)}{html.escape(loc_str, quote=False)}</h2>"  # plain, not "Ready to Get Started? ... Today"
            contact_items = []
            if b.phone:
                contact_items.append(f"<li><strong>📞 {'Call now' if business_fits or bridge else 'Phone'}:</strong> <a href=\"tel:{html.escape(b.phone, quote=True)}\">{html.escape(b.phone, quote=False)}</a></li>")
            else:
                contact_items.append('<li><strong>📞 Call Now:</strong> +91-XXXXXXXXXX <em>(Add phone number)</em></li>')
            if getattr(b, "booking_url", None):
                contact_items.append(f"<li><strong>📅 Book an appointment:</strong> <a href=\"{html.escape(b.booking_url, quote=True)}\" target=\"_blank\" rel=\"noopener\">Book online</a></li>")
            else:
                contact_items.append('<li><strong>📅 Book Appointment:</strong> <em>[Appointment Link]</em></li>')
            if b.website:
                contact_items.append(f"<li><strong>🌐 Website:</strong> <a href=\"{html.escape(b.website, quote=True)}\" target=\"_blank\" rel=\"noopener\">{html.escape(b.website, quote=False)}</a></li>")
            loc_disp = _place(b)  # address, area and city once each, in display case
            if loc_disp:
                contact_items.append(f"<li><strong>📍 Location:</strong> {html.escape(loc_disp, quote=False)}</li>")
            elif town:
                contact_items.append(f"<li><strong>📍 Location:</strong> {html.escape(town, quote=False)}</li>")
            # real contact details from the profile only (a missing one is left out: placeholders like +91-XXXXXXXXXX must never reach a live blog)
            cta_html = "\n".join([
                h2_cta,
                '<div class="blog-cta-box" style="padding: 20px; border-radius: 12px; background: #f8fafc; border: 1px solid #e2e8f0; margin-top: 20px;">',
                (f'  <p>{html.escape(_cta_text(b, brand, primary, topic or primary, title, avoid=" ".join(r["text"] for r in reasons)), quote=False)}</p>'
                 if business_fits or bridge else  # honest: _cta_text invites to what the business really does (from its profile), never the topic
                 # the business is only partly related (e.g. a rental shop and an article about buying clothes): an honest note about who
                 # published the guide, not a sales push for something the business does not sell
                 f'  <p>This guide was published by <strong>{html.escape(brand, quote=False)}</strong>, a {html.escape((b.primary_category or "local business").lower(), quote=False)}'
                 f'{html.escape(loc_str, quote=False)}. We do not sell {html.escape(primary, quote=False)} ourselves, but you are welcome to get in touch if you have a question.</p>'),
                f'  <ul>\n    {"".join(contact_items)}\n  </ul>' if contact_items else '',
                '</div>'
            ])
            parts.append(cta_html)
            progress("CTA complete.", "\n\n".join(parts), title=title, meta=meta)

            draft = {
                "title": seo_title,  # the SEO title (the H1 in the body is the Blog title when one was picked)
                "meta": meta,
                "tags": tags,
                "body": "\n\n".join(x for x in parts if x)
            }

            # Repeated sentences across the introduction, main sections, WH answer and "Don't wait" are removed first
            draft["body"], n_dupes = dedupe_sentences(draft["body"])
            if n_dupes:
                log.info("Removed %d repeated sentence(s) from '%s'", n_dupes, primary)

            # Completeness check before saving: every required part is there; a missing or empty one is regenerated on its own
            step("Checking every required section is complete...")
            draft["body"], regenerated, still_missing = complete_article(
                draft["body"], title=title, primary=primary, brand=brand, loc_str=loc_str, rules=rules, all_heads=all_heads,
                used=used_openings, help_h=help_h, faq_n=wp["faqs"], facts=_profile_facts(b, brand) if business_fits or bridge else None)
            if regenerated:
                notes.append("Regenerated on its own because it was missing or empty: " + "; ".join(regenerated) + ". Read it before publishing.")
                progress("Missing sections completed.", draft["body"], title=title, meta=meta)
            if still_missing:
                notes.append("Still incomplete after a retry: " + ", ".join(still_missing) + ". Add it in the editor or regenerate the article.")
            completeness = {"regenerated": regenerated, "still_missing": still_missing}

            # (Secondary keywords the sections left out are no longer pushed into a paragraph afterwards: that put them into
            # unrelated content. The SEO checklist lists them, and the editor adds them only where they fit.)

            # Final pure-Python corrections
            step("Running SEO validation...")
            fix_seo_fields(draft, primary)
            correct_content(draft, primary, secondary, topic)
            step("Breaking the article into short chunks...")
            # the template's paragraphs are full chunks of 500+ characters: only a paragraph that runs far past that (about 190+ words) is split
            draft["body"], n_split = chunk_paragraphs(draft["body"], max_words=175)
            # (No automatic "a keyword in every paragraph" rewrite any more: the content brief says never force a keyword in.
            # The editor still has the "Add a keyword to those paragraphs" button for paragraphs they choose to change.)
            # (No paragraphs are rewritten just to reach a brand-mention count any more; the prompts ask for natural mentions and the
            # checklist reports how many there are.)
            draft["body"] = emphasize(draft["body"], primary, clean_secondary, brand)  # bold and highlighted on the website itself

            # ── 10. JSON-LD schema (BlogPosting + FAQPage), built last so it uses the final title, meta and FAQs ──
            step("Adding BlogPosting + FAQPage schema...")
            draft["body"] = with_schema(draft["body"], article_schema(
                title=draft["title"], description=draft["meta"], body=draft["body"], primary=primary,
                secondary=clean_secondary, b=b, topic=topic))
            step("")
        finally:
            _stats.run = None

    draft["warnings"] = validate(draft["title"], draft["meta"], draft["body"], primary, secondary, brand) + notes
    draft["stats"] = {
        "length": length,
        "total_seconds": round(time.time() - started, 1),
        "ollama_calls": run["calls"],
        "ollama_seconds": round(run["ollama_seconds"], 1),
        "words": len(_text(draft["body"]).split()),
        "steps": steps,
        "completeness": completeness,  # what the final check regenerated, and anything still missing
        # does the business offer the topic: True (Why Choose), "partial" (Why Choose on its real, related service) or False (neutral criteria); checked by the SEO report
        "business_relevant": True if business_fits else "partial" if bridge else False,
    }
    log.info("Article '%s' written in %ss, %d Ollama calls, %d words", primary, draft["stats"]["total_seconds"], run["calls"], draft["stats"]["words"])
    return draft


def run_article(db: Session, article_id: int) -> None:
    a = db.get(Article, article_id)
    if not a or a.status == "completed" or (a.status == "generating" and not durable.resuming(f"article:{article_id}")):
        return  # (a "generating" article of a job being started again after a restart is written again)
    a.status, a.error, a.progress = "generating", None, "Waiting for Claude AI"
    db.commit()

    def progress(text: str, body: str = "", title: str = "", meta: str = "") -> None:
        a.progress = text[:255]
        if body:
            a.body = body  # the page shows the article growing line by line
        if title and not a.title:
            a.title = title[:255]
        if meta and not a.meta_description:
            a.meta_description = meta
        try:
            db.commit()
        except StaleDataError:  # deleted from the list: stop writing it
            db.rollback()
            raise Cancelled()

    try:
        from .seo_workflow import runner as wf_runner
        b = db.get(Business, a.business_id)
        wf = dict((a.stats or {}).get("workflow") or {})  # research + the confirmed brief, when the article came through the SEO workflow
        try:
            d = write(a.keyword, a.secondary_keywords or [], a.rising_keywords or [], b, a.topic or "", progress, a.length or "standard",
                      title_hint=a.title or None, brief=wf.get("brief"),  # a title picked on the Title step is kept
                      blog_title=(a.stats or {}).get("blog_title") or None)  # the Blog title (H1) picked on the Title step
        except Cancelled:
            raise
        except Exception as exc:
            wf_runner._record(wf, "write_article", "failed", error=str(exc)[:400])
            a.stats = {**(a.stats or {}), "workflow": wf}
            raise
        wf_runner._record(wf, "write_article", "done", {"words": len(_text(d["body"]).split()), "used_brief": bool(wf.get("brief")),
                                                         "basis": "Written from the confirmed content brief" if wf.get("brief") else "Planned by the writer (no research brief)"})
        a.title, a.meta_description = d["title"][:255] or a.keyword.title(), d["meta"]
        a.slug = a.slug or slugify(a.keyword)
        a.suggested_keywords, a.body, a.headings, a.warnings = d["tags"], d["body"], headings_of(d["body"]), d["warnings"]
        a.model, a.generated_at = getattr(get_settings(), "claude_model", "claude-haiku-5-5"), utcnow()
        a.stats = {**(a.stats or {}), **d["stats"], "workflow": wf}  # keep the workflow (research, brief, stage results) with the article
        db.commit()
        # Article stages: meta title, meta description, expert review, human review, SEO/AEO/GEO/SXO review. Each one's result is kept;
        # a failed stage never fails the article and can be run again on its own from the editor.
        wf_runner.run_article_stages(db, a, b, progress=lambda text: (setattr(a, "progress", text[:255]), db.commit()))
        a.status, a.progress = "completed", None
    except Cancelled:
        log.info("Article %s was deleted while generating; stopped", article_id)
        return
    except Exception as exc:
        log.warning("Article for '%s' failed: %s", a.keyword, exc)
        a.status, a.error, a.progress = "failed", str(exc)[:500], None
    try:
        db.commit()
    except StaleDataError:  # the article was deleted while it was being written
        db.rollback()
        log.info("Article %s was deleted while generating; result discarded", article_id)


def run_batch(db: Session, article_ids: list[int]) -> None:
    """Articles are written one at a time; a failure marks only that article."""
    for i in article_ids:
        run_article(db, i)


def recover_interrupted(db: Session) -> int:
    stuck = [a for a in db.scalars(select(Article).where(Article.status.in_(["pending", "generating"]))) if not durable.resuming(f"article:{a.id}")]
    for a in stuck:
        a.status, a.error = "failed", "Interrupted by a server restart before it finished. Retry it."
    db.commit()
    return len(stuck)


def publish_wordpress(a: Article) -> tuple[str, str]:
    """Create the article as a WordPress draft (REST API + Application Password). Returns (post id, link)."""
    s = get_settings()
    if not (s.wordpress_url and s.wordpress_user and s.wordpress_app_password):
        raise RuntimeError("WordPress is not set up: add WORDPRESS_URL, WORDPRESS_USER and WORDPRESS_APP_PASSWORD to .env")
    r = httpx.post(f"{s.wordpress_url.rstrip('/')}/wp-json/wp/v2/posts", timeout=30, auth=(s.wordpress_user, s.wordpress_app_password),
                   json={"title": a.title or a.keyword, "content": a.body or "", "excerpt": a.meta_description or "", "status": "draft"})
    if r.status_code >= 400:
        raise RuntimeError(f"WordPress refused the draft ({r.status_code}): {r.text[:200]}")
    d = r.json()
    return str(d.get("id", "")), d.get("link", "")
