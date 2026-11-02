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
from . import ai

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
ALLOWED_TAGS = {"p", "h1", "h2", "h3", "h4", "ul", "ol", "li", "strong", "b", "em", "i", "br", "blockquote", "div", "span", "script"}
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


def suggest_keywords(topic: str, related: list[str], b: Business, avoid: list[str] | None = None, volumes: dict[str, int] | None = None) -> dict:
    """Primary + 5-10 secondary SEO keywords for a topic, from Claude and the topic's Google Keyword Planner ideas
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
    primary = clean(topic)
    anchor = _sig(topic)

    def collect(data: dict) -> tuple[str, list[str]]:
        prim = clean(data.get("primary") or "") or clean(topic)
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


def sanitize_html(body: str) -> str:
    """Keep formatting tags, preserve schema script and img attributes."""
    scripts = re.findall(r'<script type="application/ld\+json">[\s\S]*?</script>', body, re.I)
    body = re.sub(r'<script type="application/ld\+json">[\s\S]*?</script>', "<!--SCHEMA_PLACEHOLDER-->", body, flags=re.I)
    body = re.sub(r"<figure\b[\s\S]*?</figure>", "", body, flags=re.I)
    body = re.sub(r"<img\b[^>]*>", "", body, flags=re.I)
    body = re.sub(r"<(script|style|iframe|object|embed)\b[\s\S]*?</\1\s*>", "", body, flags=re.I)
    body = re.sub(r"<!--(?!SCHEMA_PLACEHOLDER)[\s\S]*?-->", "", body)
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
    if scripts:
        body = body.replace("<!--SCHEMA_PLACEHOLDER-->", "\n" + "\n".join(scripts))
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
                   url: str | None = None, published=None, modified=None, topic: str | None = None) -> str:
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
      image      -> the profile's cover photo URL; left out when there is none
      FAQPage    -> @id + url of the article; each Question/Answer is a FAQ visible in the article with its full answer;
                    old keyword-template FAQs are left out; the FAQPage is left out when no FAQ remains (empty is invalid)"""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    iso = lambda d: (d or now).astimezone(timezone.utc).isoformat(timespec="seconds") if hasattr(d or now, "astimezone") else str(d)
    site = (b.website or "").strip().rstrip("/")
    page = (url or "").strip() or (f"{site}/blog/{_slug(title or primary)}" if site.startswith("http") else "")
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
        **({"image": b.cover_photo} if (b.cover_photo or "").startswith("http") else {}),
        "author": {"@type": "Organization", "name": b.name, **({"url": site} if site_ok else {})},
        "publisher": publisher,
        "datePublished": iso(published),
        "dateModified": iso(modified or published),
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


def validate(title: str, meta: str, body: str, primary: str, secondary: list[str]) -> list[str]:
    """Warnings shown to the editor enforcing the complete 10-part SEO blog structure."""
    w = []
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
            w.append(f"The meta description is {len(meta)} characters (aim for 150-160).")
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
    elif len(intro_text) < 500:
        w.append(f"Structure check: Introduction is {len(intro_text)} characters (minimum 500 characters required).")
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
    if not re.search(r"don'?t wait|don'?t delay|take action|timely action|act now|why wait|first step|next step|get started today|start today", body or "", re.I):
        w.append("Structure check: Missing 'Don\'t Wait to Take Action' section.")
        
    # Section 7: Why Choose [Business Name]
    if not re.search(r"why choose", body or "", re.I):
        w.append("Structure check: Missing 'Why Choose [Business Name]?' section.")
        
    # Section 8: FAQs (MANDATORY: 3-5 Q&As)
    has_faq = bool(re.search(r"frequently asked|faq", body or "", re.I))
    if not has_faq:
        w.append("MANDATORY: FAQ section is missing. All articles must include an FAQ section.")
    else:
        faq_idx = re.search(r"frequently asked|faq", body or "", re.I).start()
        faq_q_count = len(re.findall(r"<h3\b", body[faq_idx:], re.I))
        if faq_q_count < 3:
            w.append(f"MANDATORY: FAQ section has only {faq_q_count} questions (minimum 3 required).")
            
    # Section 9: CTA - Call To Action
    if not re.search(r"contact|ready to|get started|call us|reach out", body or "", re.I):
        w.append("Structure check: Missing Call To Action (CTA) section.")
        
    # Section 10: Local Business Schema
    if not re.search(r'application/ld\+json', body or "", re.I):
        w.append("Structure check: Missing Local Business Schema structured data.")
        
    # Keywords check
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


# Optimized for 4-core CPU: short and standard run in a single fast call
LENGTHS = {
    "short": {"sections": (3, 4), "words": 120, "subheadings": 0, "faqs": 3, "one_call": True},     # ~500-600 words, single fast Ollama call
    "standard": {"sections": (3, 4), "words": 160, "subheadings": 0, "faqs": 3, "one_call": True},  # ~750-900 words, single fast Ollama call
    "long": {"sections": (4, 5), "words": 220, "subheadings": 1, "faqs": 4, "one_call": False},     # ~1,200 words, modular calls
}
SKIP_HEADING = re.compile(r"(?:introduction|frequently asked questions|faqs?|conclusion|final thoughts|summary)\W*", re.I)


# Paragraph plan per article length for write(): (paragraphs, words per paragraph). Totals with the fixed parts
# (WH answer, action paragraph, Why Choose, FAQs, CTA) land near the lengths shown on the page (~850 / ~2,000 / ~2,500 words).
WRITE_PLAN = {
    "short": {"intro": (2, 70), "sub1": (2, 65), "sub2": (1, 70), "faqs": 3},
    "standard": {"intro": (2, 110), "sub1": (4, 150), "sub2": (4, 150), "faqs": 4},
    "long": {"intro": (3, 110), "sub1": (5, 170), "sub2": (5, 170), "faqs": 5},
}
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


def write(primary: str, secondary: list[str], rising: list[str], b: Business, topic: str = "", progress=lambda text, body="", title="", meta="": None, length: str = "standard") -> dict:
    """Generate one complete blog article strictly adhering to the 10-part SEO Writing Structure:
    1. Blog Title (H1)
    2. Introduction (min 500 chars)
    3. Subheading 1 (H2): Paragraph 2 + Paragraph 3 (500+ chars each)
    4. Subheading 2 (H2): Paragraph 4 (500+ chars)
    5. WH Question (H2): Answer up to 750 chars
    6. Don't Wait to Seek Help (H2)
    7. Why Choose [Business Name]? (H2, 3-5 reasons)
    8. FAQs (H2, 3-5 questions and answers) - MANDATORY
    9. CTA - Call To Action with verified business info
    10. Local Business Schema (<script type="application/ld+json">)
    """
    cfg = LENGTHS.get(length, LENGTHS["standard"])
    wp = WRITE_PLAN.get(length, WRITE_PLAN["standard"])
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
            # ── 0. Plan Complete SEO Blueprint ──
            step("Planning 10-part SEO article structure and metadata...")
            plan_prompt = "\n".join([
                *_context(b, lean=True), "",
                "You are an elite SEO strategist. Plan a comprehensive, high-ranking blog article.",
                f"Topic: {topic or primary}",
                f'Primary keyword: "{primary}"',
                f"Secondary keywords: {json.dumps(clean_secondary) if clean_secondary else 'None'}",
                f"Business name: {b.name} (Location: {', '.join(x for x in [b.area, b.city] if x) or 'Local'})",
                "",
                "Answer with ONE JSON object and nothing else:",
                "{",
                f'  "title": "Clear, engaging SEO title under {TITLE_MAX} characters containing exact primary keyword",',
                '  "meta": "One compelling meta description of 150-160 characters containing exact primary keyword",',
                '  "subheading_1": "First in-depth H2 subheading exploring key concepts and practical advice",',
                '  "subheading_2": "Second H2 subheading covering advanced implementation and strategies",',
                '  "wh_question": "One question a reader of this article would ask, starting with What, Why, How, When, or Where and ending with ?",',
                '  "help_heading": "An action-oriented H2 heading urging timely action",',
                '  "faqs": [',
                *[f'    {{"question": "Frequent question {i + 1}", "answer": "Clear, complete 2-3 sentence answer"}}{"," if i < wp["faqs"] - 1 else ""}' for i in range(wp["faqs"])],
                '  ],',
                '  "tags": ["5 to 8 relevant SEO tags"]',
                "}",
                f"Give exactly {wp['faqs']} FAQs. The two subheadings must cover clearly different aspects of the topic (no overlap).",
                "FAQs: real questions people type into Google about this topic (cost, safety, eligibility, timelines, how to choose, what to expect...),"
                " each different, phrased naturally, with a complete, specific 2-3 sentence answer. Never write questions just to fit a keyword"
                " (no 'How does X contribute to Y?'); use a secondary keyword only where it reads naturally"
                + (f" (good candidates: {json.dumps(faq_kws)})" if faq_kws else "") + ".",
                "The article must cover the topic thoroughly and naturally incorporate the secondary keywords across the subheadings and FAQs."
            ])
            d_plan = _json(plan_prompt, num_predict=1400)
            if not d_plan.get("title"):  # unusable or cut-off JSON: one more try before falling back to defaults
                log.warning("Article plan was not usable JSON; retrying once")
                d_plan = _json(plan_prompt + "\n\nAnswer with ONLY the complete JSON object.", num_predict=1800)
            raw_title = _plain(d_plan.get("title") or "")
            title = raw_title if raw_title and len(raw_title) <= TITLE_MAX else _shorten_title(raw_title, primary) if raw_title else ""
            if not title or len(title) > TITLE_MAX or not _has(title, primary):
                title = f"{primary.title()}: A Complete Guide"
                if len(title) > TITLE_MAX:
                    title = primary.title()[:TITLE_MAX].rsplit(" ", 1)[0]
            meta = _plain(d_plan.get("meta") or f"Learn everything about {primary} with expert guidance from {b.name}. Discover proven strategies, tips, and actionable insights.")
            if len(meta) > META_MAX:
                meta = fit_meta(meta)
            tags = [_plain(t) for t in d_plan.get("tags") or [] if _plain(t)][:8]
            
            sub_1 = _plain(d_plan.get("subheading_1") or f"Key Strategies for Mastering {primary.title()}")
            sub_2 = _plain(d_plan.get("subheading_2") or f"Advanced Techniques and Practical Implementation")
            wh_q = _plain(d_plan.get("wh_question") or "").strip()
            if not re.match(r"^(What|Why|How|When|Where)", wh_q, re.I):
                # a reader's question about the topic; the old "...Benefit Your Business?" fallback made the answer address business owners
                wh_q = f"What Should You Know Before Starting {primary.title()}?"
            if re.search(r"\byour business\b|business growth", wh_q, re.I):
                wh_q = f"What Should You Know Before Starting {primary.title()}?"
            if not wh_q.endswith("?"):
                wh_q = wh_q.rstrip(".!:; ") + "?"
            help_h = _plain(d_plan.get("help_heading") or "Don't Wait to Take Action: The Cost of Inaction")
            plan_faqs = [f for f in (d_plan.get("faqs") or []) if isinstance(f, dict) and _plain(f.get("question"))][:wp["faqs"]] or [
                {"question": f"What is the best way to get started with {primary}?", "answer": f"The best way to get started with {primary} is by conducting an initial assessment of your current position and defining clear goals. Partnering with a reliable service provider like {b.name} ensures a smooth implementation process."},
                {"question": f"How long does it take to see results from {primary}?", "answer": f"Results from {primary} typically become noticeable within a few weeks to months depending on consistency and strategy. Continuous optimization is key to long-term success."},
                {"question": f"Why is professional guidance recommended for {primary}?", "answer": f"Professional guidance helps avoid common pitfalls, saves valuable time, and provides access to advanced industry tools and proven methodologies."}
            ]
            # (Leftover secondary keywords are no longer turned into template FAQs; the plan prompt asks for natural
            # reader questions that use them only where they fit.)

            # ── 1. Blog Title (H1) ──
            h1_html = f"<h1>{html.escape(title, quote=False)}</h1>"
            parts.append(h1_html)
            progress(f"Starting article: {title}", "\n\n".join(parts), title=title, meta=meta)

            # ── 2-6. Introduction, two subheadings, WH answer and action paragraph ──
            # Each part is ONE call for N complete paragraphs (sized by the chosen length), so paragraphs never end
            # mid-sentence and are never glued together from separate "expand" calls that restate each other.
            loc_str = f" in {b.city}" if b.city else ""
            outline = [sub_1, sub_2, wh_q, help_h, f"Why Choose {b.name}?", "Frequently Asked Questions"]
            all_heads = [title, "Introduction", *outline, "Answer", "Conclusion"]
            used_openings: set[str] = set()  # paragraph openings so far, so later sections don't start the same way
            rules = [
                "Rules:",
                "- Output plain-text paragraphs only, separated by ONE blank line. No headings, titles, labels, markdown, bullet points or numbering.",
                "- Every sentence and every paragraph must be complete.",
                "- Each paragraph makes a NEW point and starts with different words; never repeat or restate an earlier paragraph.",
                "- Stay inside this part's scope; the other outline sections cover their own points, do not repeat them.",
                "- Do not invent statistics, percentages, prices, study results or guarantees.",
                "- Clear, warm, professional English for the reader; vary sentence length.",
            ]
            outline_line = "Article outline: Introduction → " + " → ".join(outline)

            def kw_rule(kws: list[str]) -> list[str]:
                return [f'- Use each of these exact phrases once, naturally: {", ".join(chr(34) + k + chr(34) for k in kws)}.'] if kws else []

            def live(label: str):
                return lambda txt: progress(label, "\n\n".join([*parts, _paras(txt)]), title=title, meta=meta)

            # 2. Introduction
            n, w = wp["intro"]
            step(f"Writing Introduction ({n} paragraphs)...")
            intro_prompt = "\n".join([
                f'You are an expert content writer for {b.name}{loc_str}. Write the INTRODUCTION of the blog article "{title}".',
                outline_line,
                f"Write exactly {n} paragraphs of about {w} words each.",
                f'- The very first sentence must contain the exact phrase "{primary}".',
                *kw_rule(intro_kws),
                f"- Hook the reader, explain why {primary} matters to them{loc_str}, and preview what the article covers. Do not go into the details of the later sections.",
                *rules,
            ])
            intro_txt = _write_paragraphs(intro_prompt, n, w, all_heads, used=used_openings, on_chunk=live("Writing Introduction..."))
            if not intro_txt:  # never leave the introduction empty
                intro_txt = (f"{primary.capitalize()} is a topic many people{loc_str} want clear, reliable guidance on. "
                             f"This guide from {b.name} explains what it involves, what to expect and how to choose the right next step for you.")
            parts.append(_paras(intro_txt))
            progress("Introduction complete.", "\n\n".join(parts), title=title, meta=meta)

            # 3. Subheading 1
            n, w = wp["sub1"]
            step(f"Writing Subheading 1: {sub_1} ({n} paragraphs)...")
            parts.append(f"<h2>{html.escape(sub_1, quote=False)}</h2>")
            progress(f"Writing: {sub_1}", "\n\n".join(parts), title=title, meta=meta)
            sub1_prompt = "\n".join([
                f'You are an expert content writer for {b.name}{loc_str}. Write the section "{sub_1}" of the blog article "{title}" (primary keyword: "{primary}").',
                outline_line,
                f"Write exactly {n} paragraphs of about {w} words each, covering the core concepts and practical advice of this section,"
                " moving from foundations to concrete, actionable guidance and common challenges.",
                *kw_rule(p2_kws + p3_kws),
                *rules,
            ])
            sub1_txt = _write_paragraphs(sub1_prompt, n, w, all_heads, used=used_openings, on_chunk=live(f"Writing {sub_1}..."))
            if sub1_txt:
                parts.append(_paras(sub1_txt))
            progress("Subheading 1 complete.", "\n\n".join(parts), title=title, meta=meta)

            # 4. Subheading 2
            n, w = wp["sub2"]
            step(f"Writing Subheading 2: {sub_2} ({n} paragraphs)...")
            parts.append(f"<h2>{html.escape(sub_2, quote=False)}</h2>")
            progress(f"Writing: {sub_2}", "\n\n".join(parts), title=title, meta=meta)
            sub2_prompt = "\n".join([
                f'You are an expert content writer for {b.name}{loc_str}. Write the section "{sub_2}" of the blog article "{title}" (primary keyword: "{primary}").',
                outline_line,
                f'The previous section "{sub_1}" already covered the basics; this section goes further: implementation, advanced options and long-term results.',
                f"Write exactly {n} paragraphs of about {w} words each.",
                *kw_rule(p4_kws),
                *rules,
            ])
            sub2_txt = _write_paragraphs(sub2_prompt, n, w, all_heads, used=used_openings, on_chunk=live(f"Writing {sub_2}..."))
            if sub2_txt:
                parts.append(_paras(sub2_txt))
            progress("Subheading 2 complete.", "\n\n".join(parts), title=title, meta=meta)

            # 5. WH Question (answer up to 750 characters, ending on a full sentence)
            step(f"Writing WH Question: {wh_q}...")
            parts.append(f"<h2>{html.escape(wh_q, quote=False)}</h2>")
            progress(f"Writing: {wh_q}", "\n\n".join(parts), title=title, meta=meta)
            wh_prompt = "\n".join([
                f'Answer the question "{wh_q}" for readers of an article about "{primary}".',
                "Write ONE direct, authoritative paragraph of 4-5 sentences (400-700 characters). Start with the answer itself.",
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

            # 6. Don't Wait to Seek Help / Take Action (H2)
            step(f"Writing: {help_h}...")
            parts.append(f"<h2>{html.escape(help_h, quote=False)}</h2>")
            progress(f"Writing: {help_h}", "\n\n".join(parts), title=title, meta=meta)
            help_prompt = "\n".join([
                f'Write ONE empathetic, persuasive paragraph of 4-5 sentences for the section "{help_h}" of an article about "{primary}".',
                "Encourage readers to act now rather than delay: what they risk by waiting, and the peace of mind and progress that prompt action brings.",
                *kw_rule(help_kws),
                *rules,
            ])
            help_txt = _write_paragraphs(help_prompt, 1, 110, all_heads, used=used_openings, on_chunk=live("Writing Action Guidance..."))
            if help_txt:
                parts.append(_paras(help_txt))
            progress("Action Guidance complete.", "\n\n".join(parts), title=title, meta=meta)

            # ── 7. Why Choose [Business Name]? (H2, 3-5 reasons) ──
            step(f"Writing: Why Choose {b.name}?... ")
            h2_why = f"<h2>Why Choose {html.escape(b.name, quote=False)}?</h2>"
            parts.append(h2_why)
            
            reasons = [
                f"<li><strong>Local Market Authority:</strong> Serving clients in {b.city or 'your region'}{f' ({b.area})' if b.area else ''} with targeted, reliable solutions designed for lasting success.</li>",
                f"<li><strong>Customized Service Delivery:</strong> Tailored strategies aligned specifically with your requirements rather than generic one-size-fits-all packages.</li>",
                f"<li><strong>Transparent Communication:</strong> Direct access to experienced professionals with regular progress updates and clear expectations.</li>",
                f"<li><strong>Proven Methodology:</strong> Systematic execution focused on delivering measurable, sustainable value for your brand.</li>"
            ]
            why_html = f"<p>When selecting a trusted partner for {primary}, {html.escape(b.name, quote=False)} stands apart through dedicated expertise and customer-first execution:</p>\n<ul>\n" + "\n".join(reasons) + "\n</ul>"
            parts.append(why_html)
            progress(f"Why Choose {b.name} complete.", "\n\n".join(parts), title=title, meta=meta)

            # ── 8. FAQs (H2, 3-5 questions and answers) - MANDATORY ──
            step("Writing Mandatory FAQs section (3-5 Q&As)...")
            h2_faq = "<h2>Frequently Asked Questions</h2>"
            parts.append(h2_faq)
            progress("Writing FAQs...", "\n\n".join(parts), title=title, meta=meta)

            faq_blocks = []
            for item in plan_faqs:
                q = item.get("question") if isinstance(item, dict) else str(item)
                a = item.get("answer") if isinstance(item, dict) else ""
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
            step(f"Writing CTA for {b.name}...")
            h2_cta = f"<h2>Ready to Get Started? Contact {html.escape(b.name, quote=False)} Today</h2>"
            contact_items = []
            if b.phone:
                contact_items.append(f"<li><strong>Phone:</strong> <a href=\"tel:{html.escape(b.phone, quote=True)}\">{html.escape(b.phone, quote=False)}</a></li>")
            if b.website:
                contact_items.append(f"<li><strong>Website:</strong> <a href=\"{html.escape(b.website, quote=True)}\" target=\"_blank\" rel=\"noopener\">{html.escape(b.website, quote=False)}</a></li>")
            loc_disp = ", ".join(x for x in [b.area, b.city] if x)
            if loc_disp:
                contact_items.append(f"<li><strong>Location:</strong> {html.escape(loc_disp, quote=False)}</li>")
            
            cta_html = "\n".join([
                h2_cta,
                '<div class="blog-cta-box" style="padding: 20px; border-radius: 12px; background: #f8fafc; border: 1px solid #e2e8f0; margin-top: 20px;">',
                f'  <p>Taking your {html.escape(primary, quote=False)} strategy to the next level requires proven expertise and dedicated execution. Partner with the specialists at <strong>{html.escape(b.name, quote=False)}</strong> to receive customized recommendations designed around your specific objectives.</p>',
                f'  <ul>\n    {"".join(contact_items)}\n  </ul>' if contact_items else '',
                '</div>'
            ])
            parts.append(cta_html)
            progress("CTA complete.", "\n\n".join(parts), title=title, meta=meta)

            draft = {
                "title": title,
                "meta": meta,
                "tags": tags,
                "body": "\n\n".join(x for x in parts if x)
            }

            # Final pure-Python corrections
            step("Running SEO validation...")
            fix_seo_fields(draft, primary)
            correct_content(draft, primary, secondary, topic)

            # ── 10. JSON-LD schema (BlogPosting + FAQPage), built last so it uses the final title, meta and FAQs ──
            step("Adding BlogPosting + FAQPage schema...")
            draft["body"] = with_schema(draft["body"], article_schema(
                title=draft["title"], description=draft["meta"], body=draft["body"], primary=primary,
                secondary=clean_secondary, b=b, topic=topic))
            step("")
        finally:
            _stats.run = None

    draft["warnings"] = validate(draft["title"], draft["meta"], draft["body"], primary, secondary) + notes
    draft["stats"] = {
        "length": length,
        "total_seconds": round(time.time() - started, 1),
        "ollama_calls": run["calls"],
        "ollama_seconds": round(run["ollama_seconds"], 1),
        "words": len(_text(draft["body"]).split()),
        "steps": steps
    }
    log.info("Article '%s' written in %ss, %d Ollama calls, %d words", primary, draft["stats"]["total_seconds"], run["calls"], draft["stats"]["words"])
    return draft


def run_article(db: Session, article_id: int) -> None:
    a = db.get(Article, article_id)
    if not a or a.status in ("completed", "generating"):
        return
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
        d = write(a.keyword, a.secondary_keywords or [], a.rising_keywords or [], db.get(Business, a.business_id), a.topic or "", progress, a.length or "standard")
        a.title, a.meta_description = d["title"][:255] or a.keyword.title(), d["meta"]
        a.suggested_keywords, a.body, a.headings, a.warnings = d["tags"], d["body"], headings_of(d["body"]), d["warnings"]
        a.status, a.model, a.generated_at, a.progress, a.stats = "completed", getattr(get_settings(), "claude_model", "claude-haiku-5-5"), utcnow(), None, d["stats"]
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
    stuck = list(db.scalars(select(Article).where(Article.status.in_(["pending", "generating"]))))
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
