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

import httpx
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
ALLOWED_TAGS = {"p", "h1", "h2", "h3", "h4", "ul", "ol", "li", "strong", "b", "em", "i", "br", "blockquote", "img", "figure", "figcaption", "div", "span", "script"}
PLACEHOLDER = re.compile(r"\[[^\]]{2,}\]|\b(?:lorem ipsum|write about|insert here|to be added|your text here)\b", re.I)


class OllamaAnswerError(RuntimeError):
    """Ollama is running but this answer failed (timeout, or an aborted prediction such as "token repeat limit reached"):
    the caller can retry or skip this part. A connection error is a plain RuntimeError and stops the article."""


def _chat(prompt: str, *, as_json: bool = True, num_predict: int | None = None, timeout: int | None = None, temperature: float | None = None) -> str:
    s = get_settings()
    options = {"num_predict": num_predict or s.ollama_max_tokens, "num_ctx": s.ollama_num_ctx, "repeat_penalty": 1.15,  # small models otherwise loop
               "temperature": s.ollama_temperature if temperature is None else temperature}
    # keep_alive: the model stays in memory between the steps of an article (reloading it costs 10-20 s on a CPU)
    body = {"model": s.ollama_model, "stream": False, "keep_alive": "30m", "messages": [{"role": "user", "content": prompt}], "options": options}
    if as_json:
        body["format"] = "json"
    wait = min(timeout, s.ollama_timeout_seconds) if timeout else s.ollama_timeout_seconds
    started = time.time()
    try:
        r = httpx.post(f"{s.ollama_host.rstrip('/')}/api/chat", timeout=wait, json=body)
        r.raise_for_status()
    except httpx.ConnectError:
        raise RuntimeError(f"Ollama is not reachable at {s.ollama_host}. Start it with `ollama serve` and make sure `{s.ollama_model}` is pulled.")
    except httpx.TimeoutException:
        raise OllamaAnswerError(f"Ollama did not answer within {wait}s.")
    except httpx.HTTPStatusError as e:
        raise OllamaAnswerError(f"Ollama error {e.response.status_code}: {e.response.text[:200]}")
    finally:
        run = getattr(_stats, "run", None)
        if run is not None:
            run["calls"] += 1
            run["ollama_seconds"] += time.time() - started
    return (r.json().get("message") or {}).get("content") or ""



def _stream_text(prompt: str, *, num_predict: int = 300, on_chunk=None) -> str:
    """Stream plain-text paragraphs from Ollama token by token. Calls on_chunk(text_so_far) periodically."""
    s = get_settings()
    options = {
        "num_predict": num_predict,
        "num_ctx": s.ollama_num_ctx,
        "temperature": s.ollama_temperature,
        "repeat_penalty": 1.15
    }
    body = {
        "model": s.ollama_model,
        "prompt": prompt,
        "stream": True,
        "keep_alive": "30m",
        "options": options
    }
    collected = []
    chunk_count = 0
    started = time.time()
    try:
        with httpx.stream("POST", f"{s.ollama_host.rstrip('/')}/api/generate", json=body, timeout=s.ollama_timeout_seconds) as r:
            r.raise_for_status()
            for line in r.iter_lines():
                if not line:
                    continue
                d = json.loads(line)
                tok = d.get("response", "")
                if tok:
                    collected.append(tok)
                    chunk_count += 1
                    if on_chunk and (chunk_count % 6 == 0 or "\n" in tok):
                        on_chunk("".join(collected))
    except Exception as e:
        log.warning("Streaming Ollama error: %s", e)
    finally:
        run = getattr(_stats, "run", None)
        if run is not None:
            run["calls"] += 1
            run["ollama_seconds"] += time.time() - started
    return "".join(collected).strip()


def _short(prompt: str, num_predict: int = 90, timeout: int = 90) -> str:
    """A few seconds: a plain-text answer to a small question. Failures return "" (the validation warning stays)."""
    try:
        return _plain(_chat(prompt, as_json=False, num_predict=num_predict, timeout=timeout)).strip(" \"'")
    except RuntimeError as exc:
        log.warning("Short Ollama call failed: %s", exc)
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


# ── keyword suggestions ──────────────────────────────────────────────────────

_STOP = {"the", "and", "for", "with", "how", "what", "best", "near", "you", "your", "are", "from", "that", "this", "can", "get"}


def _sig(text: str) -> set[str]:
    return {w for w in re.findall(r"\w+", text.lower()) if len(w) > 2 and w not in _STOP}


def suggest_keywords(topic: str, related: list[str], b: Business, avoid: list[str] | None = None) -> dict:
    """Primary + 5-10 secondary SEO keywords for a topic, from Ollama and the topic's Google Trends related queries."""
    topic = " ".join(topic.split())
    related = list(dict.fromkeys(" ".join(r.lower().split()) for r in related if r and r.strip()))[:25]
    avoid = [a.lower() for a in (avoid or [])]
    lines = [
        "You are an SEO keyword researcher. A business wants to write one blog article about the topic below.",
        f"Topic: {topic}",
        "Business (use it only to judge the audience):",
        ai.profile_text(b),
    ]
    if related:
        lines += ["", "Google Trends related queries for this topic (use the ones that are relevant, ignore the rest):", *[f"- {r}" for r in related]]
    if avoid:
        lines += ["", "A previous set was rejected. Do NOT reuse these keywords, give a clearly different set: " + ", ".join(avoid)]
    lines += [
        "",
        "Rules:",
        '- "primary": ONE main SEO keyword of 2-5 words that closely matches the topic and is what people type into Google.',
        '- "secondary": 6 to 10 different related keywords or phrases of 2-6 words that fit the same article: the same topic, its sub-topics, questions and variations'
        " readers search for, plus the relevant Google Trends related queries above.",
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

    for attempt_no in range(2 if avoid_set else 1):  # when regenerating, a model that repeats the rejected set gets one stricter second try
        prompt = "\n".join(lines) + ("\n\nYour last answer repeated rejected keywords. Every secondary keyword must be NEW: use different wording, sub-topics, questions, audiences or locations." if attempt_no else "")
        try:
            d = json.loads(re.search(r"\{[\s\S]*\}", _chat(prompt, num_predict=500, timeout=120, temperature=0.9 if avoid_set else 0.5)).group(0))
        except (AttributeError, ValueError):
            if attempt_no:
                break
            raise RuntimeError("The model did not return a usable keyword set. Try Regenerate Keywords.")
        primary, pool = collect(d)
        fresh = [k for k in pool if k not in avoid_set]
        if len(fresh) >= 5:
            break
    # a fresh set when there is one; otherwise top it up so the user always gets something usable to edit
    pool = fresh + [k for k in (collect(d)[1] if d else []) if k not in fresh]
    secondary = [k for k in pool if k != primary][:10]
    if len(secondary) < 3:
        raise RuntimeError("Too few relevant keywords were found for this topic. Try Regenerate Keywords or edit the topic.")
    intent = str(d.get("intent") or "").lower().strip()
    return {"primary": primary, "secondary": secondary, "intent": intent if intent in {"informational", "commercial", "transactional", "local", "navigational"} else "informational"}

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


def headings_of(body: str) -> list[str]:
    return [_text(h) for h in re.findall(r"<h[1-3][^>]*>(.*?)</h[1-3]>", body, re.S | re.I)]


# ── validation ───────────────────────────────────────────────────────────────

def _norm(t: str) -> str:
    return " " + " ".join(re.findall(r"\w+", t.lower())) + " "


def _has(text: str, k: str) -> bool:
    """The keyword appears as a phrase (case and punctuation ignored)."""
    return _norm(k) in _norm(text)


def unsupported_claims(title: str, meta: str, body: str, keywords: list[str]) -> list[str]:
    text = " ".join([title, meta, _text(body)])
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
    wh_match = re.search(r"<h2\b[^>]*>\s*(What|Why|How|When|Where)\b[^<]*</h2>\s*<p\b[^>]*>(.*?)</p>", body or "", re.S | re.I)
    if not wh_match:
        w.append("Structure check: Missing a WH Question (What/Why/How/When/Where) H2 section.")
    else:
        wh_ans_len = len(_text(wh_match.group(2)))
        if wh_ans_len > 750:
            w.append(f"Structure check: WH Question answer is {wh_ans_len} characters (maximum 750 allowed).")
            
    # Section 6: Action / Don't Wait section
    if not re.search(r"don't wait|take action|timely action|act now|why wait", body or "", re.I):
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
    for sep in (":", " - ", " | ", ","):
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
        draft["meta"] = draft["meta"][:META_MAX - 1].rsplit(" ", 1)[0].rstrip(",;:- ") + "."


def correct_content(draft: dict, primary: str, secondary: list[str], topic: str) -> None:
    """Fast Python cleanup: ensures primary keyword is in the introduction paragraph without extra LLM calls."""
    body = draft.get("body") or ""
    first = re.search(r"<p>(.*?)</p>", body, re.S)
    if first and not _has(first.group(1), primary):
        orig_p = first.group(1).strip()
        fixed_p = f"When considering {primary}, " + (orig_p[0].lower() + orig_p[1:] if len(orig_p) > 1 else orig_p)
        body = body.replace(first.group(0), f"<p>{fixed_p}</p>", 1)
    draft["body"] = body


# Optimized for 4-core CPU: short and standard run in a single fast call
LENGTHS = {
    "short": {"sections": (3, 4), "words": 120, "subheadings": 0, "faqs": 3, "one_call": True},     # ~500-600 words, single fast Ollama call
    "standard": {"sections": (3, 4), "words": 160, "subheadings": 0, "faqs": 3, "one_call": True},  # ~750-900 words, single fast Ollama call
    "long": {"sections": (4, 5), "words": 220, "subheadings": 1, "faqs": 4, "one_call": False},     # ~1,200 words, modular calls
}
SKIP_HEADING = re.compile(r"(?:introduction|frequently asked questions|faqs?|conclusion|final thoughts|summary)\W*", re.I)


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
    except (AttributeError, ValueError):
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
        *[f'- "{k}"' + (" (rising on Google Trends)" if k in rising_set else "") for k in secondary],
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
        plan["meta"] = plan["meta"][:META_MAX - 1].rsplit(" ", 1)[0].rstrip(",;:.- ") + "…"
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
    2. Introduction + 1 Image (min 500 chars)
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
    notes: list[str] = []
    run = {"calls": 0, "ollama_seconds": 0.0}
    steps: list[dict] = []
    started = time.time()
    current: dict = {}
    parts: list[str] = []

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
                f"Secondary keywords: {json.dumps(secondary[:6]) if secondary else 'None'}",
                f"Business name: {b.name} (Location: {', '.join(x for x in [b.area, b.city] if x) or 'Local'})",
                "",
                "Answer with ONE JSON object and nothing else:",
                "{",
                f'  "title": "Clear, engaging SEO title under {TITLE_MAX} characters containing exact primary keyword",',
                '  "meta": "One compelling meta description of 150-160 characters containing exact primary keyword",',
                '  "subheading_1": "First in-depth H2 subheading exploring key concepts and practical advice",',
                '  "subheading_2": "Second H2 subheading covering advanced implementation and strategies",',
                '  "wh_question": "One high-value question starting with What, Why, How, When, or Where",',
                '  "help_heading": "An action-oriented H2 heading urging timely action",',
                '  "faqs": [',
                '    {"question": "Frequent question 1", "answer": "Clear 2-3 sentence answer"},',
                '    {"question": "Frequent question 2", "answer": "Clear 2-3 sentence answer"},',
                '    {"question": "Frequent question 3", "answer": "Clear 2-3 sentence answer"}',
                '  ],',
                '  "tags": ["5 to 8 relevant SEO tags"]',
                "}"
            ])
            d_plan = _json(plan_prompt, num_predict=650)
            title = _plain(d_plan.get("title") or f"Complete Guide to {primary.title()} | {b.name}")[:TITLE_MAX]
            if not _has(title, primary):
                title = f"{primary.title()}: Expert Guide & Tips"[:TITLE_MAX]
            meta = _plain(d_plan.get("meta") or f"Learn everything about {primary} with expert guidance from {b.name}. Discover proven strategies, tips, and actionable insights.")
            if len(meta) > META_MAX:
                meta = meta[:META_MAX - 1].rsplit(" ", 1)[0].rstrip(",;:.- ") + "…"
            tags = [_plain(t) for t in d_plan.get("tags") or [] if _plain(t)][:8]
            
            sub_1 = _plain(d_plan.get("subheading_1") or f"Key Strategies for Mastering {primary.title()}")
            sub_2 = _plain(d_plan.get("subheading_2") or f"Advanced Techniques and Practical Implementation")
            wh_q = _plain(d_plan.get("wh_question") or f"How Does {primary.title()} Impact Business Growth?")
            if not re.match(r"^(What|Why|How|When|Where)", wh_q, re.I):
                wh_q = f"How Does {primary.title()} Benefit Your Business?"
            help_h = _plain(d_plan.get("help_heading") or "Don't Wait to Take Action: The Cost of Inaction")
            plan_faqs = d_plan.get("faqs") or [
                {"question": f"What is the best way to get started with {primary}?", "answer": f"The best way to get started with {primary} is by conducting an initial assessment of your current position and defining clear goals. Partnering with a reliable service provider like {b.name} ensures a smooth implementation process."},
                {"question": f"How long does it take to see results from {primary}?", "answer": f"Results from {primary} typically become noticeable within a few weeks to months depending on consistency and strategy. Continuous optimization is key to long-term success."},
                {"question": f"Why is professional guidance recommended for {primary}?", "answer": f"Professional guidance helps avoid common pitfalls, saves valuable time, and provides access to advanced industry tools and proven methodologies."}
            ]

            # ── 1. Blog Title (H1) ──
            h1_html = f"<h1>{html.escape(title, quote=False)}</h1>"
            parts.append(h1_html)
            progress(f"Starting article: {title}", "\n\n".join(parts), title=title, meta=meta)

            # ── 2. Introduction Paragraph (min 500 characters) + 1 Image ──
            step("Writing Introduction (min 500 chars) & Featured Image...")
            loc_str = f" in {b.city}" if b.city else ""
            sec_kws_str = ", ".join(secondary[:3]) if secondary else primary
            intro_prompt = "\n".join([
                f'You are an expert content writer for {b.name}. Write an in-depth, compelling introduction for "{title}".',
                f'Requirements:',
                f'- MUST be at least 500 characters of high-value text (2 detailed paragraphs).',
                f'- The first sentence must naturally include the exact primary keyword "{primary}".',
                f'- Naturally integrate secondary keywords where relevant: {sec_kws_str}.',
                f'- Explain the topic, its importance, and the practical benefits to readers{loc_str}.',
                '- Write in clear, professional English. Do NOT output headings or titles.'
            ])
            def on_intro(txt):
                progress("Writing Introduction...", "\n\n".join([*parts, _paras(txt)]), title=title, meta=meta)
            raw_intro = _stream_text(intro_prompt, num_predict=280, on_chunk=on_intro)
            intro_p = _paras(raw_intro)
            
            # Ensure 500+ character requirement
            if len(_text(intro_p)) < 500:
                supp_prompt = f'Write one additional detailed explanatory paragraph of 4 sentences about {primary} and why timely expertise from {b.name} makes a significant difference.'
                supp_raw = _stream_text(supp_prompt, num_predict=160)
                intro_p = intro_p + "\n" + _paras(supp_raw)
            parts.append(intro_p)

            # Add Image with descriptive ALT text right after introduction
            img_alt = html.escape(f"{title} - {primary} by {b.name}", quote=True)
            img_html = f'<figure><img src="https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80" alt="{img_alt}" class="rounded-xl my-4 w-full object-cover max-h-96" /><figcaption class="text-xs text-slate-500 text-center mt-1">{html.escape(title, quote=False)}</figcaption></figure>'
            parts.append(img_html)
            progress("Introduction & Image complete.", "\n\n".join(parts), title=title, meta=meta)

            # ── 3. First Subheading (H2): Paragraph 2 + Paragraph 3 (500+ chars each) ──
            step(f"Writing Subheading 1: {sub_1} (Paragraphs 2 & 3, 500+ chars each)...")
            h2_1 = f"<h2>{html.escape(sub_1, quote=False)}</h2>"
            parts.append(h2_1)
            progress(f"Writing: {sub_1}", "\n\n".join(parts), title=title, meta=meta)

            # Paragraph 2 (min 500 chars)
            p2_prompt = "\n".join([
                f'Write ONE detailed, comprehensive paragraph of at least 500 characters exploring core insights and foundational principles of "{sub_1}" for an article on {primary}.',
                'Provide actionable tips, practical clarity, and clear industry context. No bullet points, one deep paragraph only.'
            ])
            def on_p2(txt):
                progress(f"Writing Paragraph 2 ({sub_1})...", "\n\n".join([*parts, _paras(txt)]), title=title, meta=meta)
            p2_raw = _stream_text(p2_prompt, num_predict=260, on_chunk=on_p2)
            p2_html = _paras(p2_raw)
            if len(_text(p2_html)) < 500:
                p2_extra = _stream_text(f'Expand on this with 2 more practical examples: {p2_raw[:150]}', num_predict=120)
                p2_html = _paras(p2_raw + " " + p2_extra)
            parts.append(p2_html)

            # Paragraph 3 (min 500 chars)
            p3_prompt = "\n".join([
                f'Write ONE detailed paragraph of at least 500 characters continuing the discussion under "{sub_1}".',
                'Focus on concrete real-world implementation, step-by-step methodologies, and overcoming common challenges.',
                'Ensure depth, clarity, and practical value. One deep paragraph only.'
            ])
            def on_p3(txt):
                progress(f"Writing Paragraph 3 ({sub_1})...", "\n\n".join([*parts, _paras(txt)]), title=title, meta=meta)
            p3_raw = _stream_text(p3_prompt, num_predict=260, on_chunk=on_p3)
            p3_html = _paras(p3_raw)
            if len(_text(p3_html)) < 500:
                p3_extra = _stream_text(f'Add further actionable insight: {p3_raw[:150]}', num_predict=120)
                p3_html = _paras(p3_raw + " " + p3_extra)
            parts.append(p3_html)
            progress("Subheading 1 complete.", "\n\n".join(parts), title=title, meta=meta)

            # ── 4. Second Subheading (H2): Paragraph 4 (500+ chars) ──
            step(f"Writing Subheading 2: {sub_2} (Paragraph 4, 500+ chars)...")
            h2_2 = f"<h2>{html.escape(sub_2, quote=False)}</h2>"
            parts.append(h2_2)
            progress(f"Writing: {sub_2}", "\n\n".join(parts), title=title, meta=meta)

            p4_prompt = "\n".join([
                f'Write ONE comprehensive paragraph of at least 500 characters under "{sub_2}" for {primary}.',
                f'Naturally incorporate relevant secondary keywords: {", ".join(secondary[1:4]) if len(secondary) > 1 else primary}.',
                'Provide thorough analysis, advanced strategies, and long-term optimization recommendations. One deep paragraph only.'
            ])
            def on_p4(txt):
                progress(f"Writing Paragraph 4 ({sub_2})...", "\n\n".join([*parts, _paras(txt)]), title=title, meta=meta)
            p4_raw = _stream_text(p4_prompt, num_predict=280, on_chunk=on_p4)
            p4_html = _paras(p4_raw)
            if len(_text(p4_html)) < 500:
                p4_extra = _stream_text(f'Continue with strategic recommendations: {p4_raw[:150]}', num_predict=120)
                p4_html = _paras(p4_raw + " " + p4_extra)
            parts.append(p4_html)
            progress("Subheading 2 complete.", "\n\n".join(parts), title=title, meta=meta)

            # ── 5. WH Question (H2, answer max 750 chars) ──
            step(f"Writing WH Question: {wh_q}...")
            h2_wh = f"<h2>{html.escape(wh_q, quote=False)}</h2>"
            parts.append(h2_wh)
            progress(f"Writing: {wh_q}", "\n\n".join(parts), title=title, meta=meta)

            wh_prompt = f'Provide a direct, authoritative, and informative answer to the question: "{wh_q}" regarding {primary}. Keep the answer between 400 and 700 characters (concise, high-impact paragraph).'
            def on_wh(txt):
                progress(f"Writing WH Answer...", "\n\n".join([*parts, _paras(txt)]), title=title, meta=meta)
            wh_raw = _stream_text(wh_prompt, num_predict=180, on_chunk=on_wh)
            wh_text = _text(wh_raw)
            if len(wh_text) > 750:
                wh_text = wh_text[:745].rsplit(".", 1)[0] + "."
            parts.append(f"<p>{html.escape(wh_text, quote=False)}</p>")
            progress("WH Question complete.", "\n\n".join(parts), title=title, meta=meta)

            # ── 6. Don't Wait to Seek Help / Take Action (H2) ──
            step(f"Writing: {help_h}...")
            h2_help = f"<h2>{html.escape(help_h, quote=False)}</h2>"
            parts.append(h2_help)
            progress(f"Writing: {help_h}", "\n\n".join(parts), title=title, meta=meta)

            help_prompt = "\n".join([
                f'Write an empathetic, persuasive paragraph of 4-5 sentences under the heading "{help_h}".',
                f'Encourage readers interested in {primary} to take timely action rather than delaying.',
                f'Explain why procrastination leads to lost momentum or missed opportunities, and how taking prompt action ensures peace of mind and measurable progress.'
            ])
            def on_help(txt):
                progress(f"Writing Action Guidance...", "\n\n".join([*parts, _paras(txt)]), title=title, meta=meta)
            raw_help = _stream_text(help_prompt, num_predict=180, on_chunk=on_help)
            parts.append(_paras(raw_help))
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
            for item in plan_faqs[:4]:
                q = item.get("question") if isinstance(item, dict) else str(item)
                a = item.get("answer") if isinstance(item, dict) else ""
                if q:
                    if not a or len(a) < 30:
                        ans_prompt = f'Provide a clear, authoritative 2-3 sentence answer to the question: "{q}" for readers researching {primary}.'
                        a = _stream_text(ans_prompt, num_predict=90)
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

            # ── 10. Local Business Schema ──
            step("Adding Local Business Schema structured data...")
            schema_data = {
                "@context": "https://schema.org",
                "@type": "LocalBusiness",
                "name": b.name,
                "url": b.website or "",
                "telephone": b.phone or "",
                "address": {
                    "@type": "PostalAddress",
                    "streetAddress": b.area or "",
                    "addressLocality": b.city or ""
                }
            }
            schema_script = f'<script type="application/ld+json">\n{json.dumps(schema_data, indent=2)}\n</script>'
            parts.append(schema_script)

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
    a.status, a.error, a.progress = "generating", None, "Waiting for Ollama"
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
        a.status, a.model, a.generated_at, a.progress, a.stats = "completed", get_settings().ollama_model, utcnow(), None, d["stats"]
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
