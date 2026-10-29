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
ALLOWED_TAGS = {"p", "h2", "h3", "h4", "ul", "ol", "li", "strong", "b", "em", "i", "br", "blockquote"}
PLACEHOLDER = re.compile(r"\[[^\]]{2,}\]|\b(?:lorem ipsum|write about|insert here|to be added|your text here)\b", re.I)


class OllamaAnswerError(RuntimeError):
    """Ollama is running but this answer failed (timeout, or an aborted prediction such as "token repeat limit reached"):
    the caller can retry or skip this part. A connection error is a plain RuntimeError and stops the article."""


def _chat(prompt: str, *, as_json: bool = True, num_predict: int | None = None, timeout: int | None = None, temperature: float | None = None) -> str:
    s = get_settings()
    options = {"num_predict": num_predict or s.ollama_max_tokens, "repeat_penalty": 1.15}  # small models otherwise loop on long answers
    if temperature is not None:
        options["temperature"] = temperature
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
    """Edited bodies are untrusted too: keep simple formatting tags (no attributes), turn anything else into text."""
    body = re.sub(r"<(script|style|iframe|object|embed)\b[\s\S]*?</\1\s*>", "", body, flags=re.I)
    body = re.sub(r"<!--[\s\S]*?-->", "", body)
    body = re.sub(r"<(?![a-zA-Z/])", "&lt;", body)
    body = re.sub(r"<(/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>", lambda m: f"<{m.group(1)}{m.group(2).lower()}>" if m.group(2).lower() in ALLOWED_TAGS else "", body)
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
    """Warnings shown to the editor: keyword use, lengths, structure, details that cannot be verified."""
    w = []
    text = _text(body)
    first_p = re.search(r"<p>(.*?)</p>", body or "", re.S)
    if not title:
        w.append("The SEO title is empty.")
    elif len(title) > TITLE_MAX:
        w.append(f"The SEO title is {len(title)} characters (aim for {TITLE_MAX} or fewer).")
    if title and not _has(title, primary):
        w.append(f"The title does not contain the primary keyword '{primary}'.")
    if not meta:
        w.append("The meta description is empty.")
    else:
        if not META_MIN <= len(meta) <= META_MAX:
            w.append(f"The meta description is {len(meta)} characters (aim for 150-160).")
        if not _has(meta, primary):
            w.append(f"The meta description does not contain the primary keyword '{primary}'.")
    if not first_p or not _has(first_p.group(1), primary):
        w.append(f"The introduction does not contain the primary keyword '{primary}'.")
    if not _has(text, primary):
        w.append(f"The primary keyword '{primary}' does not appear in the article.")
    for k in secondary:
        if not _has(text, k):
            w.append(f"The secondary keyword '{k}' does not appear in the article.")
    if len(re.findall(r"<h2>", body or "")) < 3:
        w.append("The article has fewer than 3 <h2> sections.")
    if not re.search(r"frequently asked|faq", body or "", re.I):
        w.append("The article has no FAQ section.")
    if PLACEHOLDER.search(text):
        w.append("The article still contains placeholder text in [brackets].")
    claims = unsupported_claims(title, meta, body or "", [primary, *secondary])
    if claims:
        w.append("May contain details that were not supplied and cannot be verified; review before publishing: " + "; ".join(claims[:6]))
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
    """Title: contains the primary keyword, 60 characters at most. Meta: contains it, 140-160 characters, a whole sentence."""
    t = draft["title"]
    if t and (not _has(t, primary) or len(t) > TITLE_MAX):
        for limit in (TITLE_MAX - 5, TITLE_MAX - 15):  # asking for less than the limit: models overshoot
            new = _rewrite("title", t, primary, f"is at most {limit} characters long")
            if new and _has(new, primary) and len(new) <= TITLE_MAX:
                draft["title"] = new
                break
        else:
            draft["title"] = _shorten_title(t, primary)
    m = draft["meta"]
    if m and (not _has(m, primary) or not 140 <= len(m) <= META_MAX or m.endswith("…")):
        new = _rewrite("meta description", m, primary, "is one complete sentence of 150 to 155 characters")
        if new and _has(new, primary) and len(new) <= META_MAX:
            draft["meta"] = new
        elif m.endswith("…") and "," in m:  # cut off mid-sentence: end it at the last complete clause
            tidy = m[:-1].rsplit(",", 1)[0].rstrip(" ,;:-") + "."
            if _has(tidy, primary):
                draft["meta"] = tidy
        if not _has(draft["meta"], primary):  # still missing: ask once more, then lead with the keyword
            new = _rewrite("meta description", draft["meta"], primary, f'starts with the exact phrase "{primary}" and is one complete sentence of 150 to 155 characters')
            if new and _has(new, primary) and len(new) <= META_MAX:
                draft["meta"] = new
            else:
                lead = f"{primary[0].upper()}{primary[1:]}: {draft['meta']}"
                draft["meta"] = (lead if len(lead) <= META_MAX else lead[:META_MAX - 1].rsplit(" ", 1)[0].rstrip(",;:- ") + ".")


def correct_content(draft: dict, primary: str, secondary: list[str], topic: str) -> None:
    """One targeted pass with short Ollama calls: introduction keyword, missing secondary keywords, unsupported claims."""
    body = draft["body"]
    keywords = [primary, *secondary]
    first = re.search(r"<p>(.*?)</p>", body, re.S)
    if first and not _has(first.group(1), primary):
        new = _short(f'Rewrite this introduction so that its first sentence contains the exact phrase "{primary}". Keep 3 to 4 sentences and the same meaning; '
                     f"do not add facts, prices or statistics. Plain text only. Answer with the introduction only.\n\n{_text(first.group(1))}", num_predict=200, timeout=120)
        if new and _has(new, primary) and len(new.split()) >= 20:
            body = body.replace(first.group(0), f"<p>{html.escape(new, quote=False)}</p>", 1)
    missing = [k for k in secondary if not _has(_text(body), k)]
    for group in [missing[i:i + 2] for i in range(0, len(missing), 2)][:5]:  # two phrases per paragraph: small models manage that
        for attempt_no in range(2):  # the second try asks more strictly
            new = _short(f'Write one useful paragraph of 3 to 4 sentences for a blog article about "{topic or primary}" that naturally uses '
                         + ("both of these exact phrases, copying them letter for letter: " if attempt_no else "each of these exact phrases once, unchanged: ")
                         + "; ".join(f'"{k}"' for k in group) + ". Do not invent facts, prices, dates or statistics. Plain text only. Answer with the paragraph only.",
                         num_predict=200, timeout=120)
            if new and len(new.split()) >= 25 and any(_has(new, k) for k in group):
                extra = f"<p>{html.escape(new, quote=False)}</p>\n\n"
                faq = "<h2>Frequently Asked Questions</h2>"
                body = body.replace(faq, extra + faq, 1) if faq in body else body + "\n\n" + extra.strip()
                if all(_has(new, k) for k in group):
                    break
    for para in re.findall(r"<p>[\s\S]*?</p>", body)[:40]:
        claims = unsupported_claims("", "", para, keywords)
        if not claims:
            continue
        new = _short("Rewrite this paragraph without any prices, amounts, percentages, statistics, specific dates or news-style claims "
                     f"({'; '.join(claims[:3])}). Keep it useful, in general terms, with the same keywords. Plain text only. Answer with the paragraph only.\n\n{_text(para)}",
                     num_predict=220, timeout=120)
        if new and not unsupported_claims("", "", new, keywords) and len(new.split()) >= 15:
            body = body.replace(para, f"<p>{html.escape(new, quote=False)}</p>", 1)
    draft["body"] = body


# Measured on the target machine (llama3.2 on a 4-core CPU): about 4-5 words per second, so length decides the time.
LENGTHS = {
    "short": {"sections": (3, 4), "words": 150, "subheadings": 0, "faqs": 4, "one_call": True},     # ~800 words, mostly one Ollama call
    "standard": {"sections": (4, 5), "words": 220, "subheadings": 1, "faqs": 5, "one_call": False},  # ~1,500 words
    "long": {"sections": (5, 7), "words": 300, "subheadings": 2, "faqs": 5, "one_call": False},      # ~2,000+ words
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
        d = _json(prompt, num_predict=1900 if cfg["one_call"] else 900)
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
    """A section whose paragraphs came with the plan (short articles)."""
    body = _paras(sec.get("paragraphs"))
    return f"<h2>{html.escape(sec['heading'], quote=False)}</h2>\n{body}" if body else ""


def _faq_html(faqs) -> str:
    faqs = [f for f in faqs or [] if isinstance(f, dict) and _plain(f.get("question")) and len(_plain(f.get("answer")).split()) >= 10]
    if len(faqs) < 3:
        return ""
    return "<h2>Frequently Asked Questions</h2>\n" + "\n".join(
        f"<h3>{html.escape(_plain(f['question']), quote=False)}</h3>\n{_paras(f['answer'])}" for f in faqs[:6])


def _conclusion_html(value) -> str:
    text = _paras(value)
    return f"<h2>Conclusion</h2>\n{text}" if len(_text(text).split()) >= 25 else ""


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


def write(primary: str, secondary: list[str], rising: list[str], b: Business, topic: str = "", progress=lambda text: None, length: str = "standard") -> dict:
    """One complete article in the chosen length, written in as few Ollama calls as it reliably can, then corrected and validated.
    `progress(text)` reports each step; the result carries "stats": time and Ollama calls per step."""
    cfg = LENGTHS.get(length, LENGTHS["standard"])
    notes: list[str] = []
    run = {"calls": 0, "ollama_seconds": 0.0}
    steps: list[dict] = []
    started = time.time()
    current: dict = {}

    def step(name: str) -> None:
        now = time.time()
        if current:
            steps.append({"step": current["name"], "seconds": round(now - current["t"], 1), "calls": run["calls"] - current["calls"]})
        current.update(name=name, t=now, calls=run["calls"])
        if name:
            progress(name)

    with _ollama_lock:
        _stats.run = run
        try:
            step("Planning the article" if not cfg["one_call"] else "Writing the article")
            plan = _plan(primary, secondary, rising, b, topic, cfg)
            parts = [_paras(plan["introduction"])]
            n = len(plan["sections"])
            for i, sec in enumerate(plan["sections"]):
                html_ = _section_from_plan(sec) if cfg["one_call"] else ""
                if len(_text(html_).split()) < (35 if cfg["one_call"] else 60):  # not written with the plan (or too thin): write it on its own
                    step(f"Writing section {i + 1} of {n}: {sec['heading']}")
                    html_ = _section(plan, i, primary, topic, b, cfg)
                if len(_text(html_).split()) < 60:
                    notes.append(f"The section '{sec['heading']}' came out short; expand it before publishing.")
                parts.append(html_)
            faq, concl = (_faq_html(plan["faqs"]), _conclusion_html(plan["conclusion"])) if cfg["one_call"] else ("", "")
            if not faq or not concl:
                step("Writing the FAQs and conclusion")
                f2, c2 = _faqs_and_conclusion(primary, secondary, topic, b, cfg["faqs"])
                faq, concl = faq or f2, concl or c2
            draft = {"title": plan["title"], "meta": plan["meta"], "tags": plan["tags"], "body": "\n\n".join(x for x in [*parts, faq, concl] if x)}
            if not draft["body"]:
                raise RuntimeError("The model did not return any article text.")
            step("Checking the title, meta description and keywords")
            fix_seo_fields(draft, primary)
            correct_content(draft, primary, secondary, topic)
            step("")
        finally:
            _stats.run = None
    draft["warnings"] = validate(draft["title"], draft["meta"], draft["body"], primary, secondary) + notes
    draft["stats"] = {"length": length, "total_seconds": round(time.time() - started, 1), "ollama_calls": run["calls"],
                      "ollama_seconds": round(run["ollama_seconds"], 1), "words": len(_text(draft["body"]).split()), "steps": steps}
    log.info("Article '%s' (%s): %ss, %d Ollama calls, %d words; steps: %s", primary, length, draft["stats"]["total_seconds"], run["calls"],
             draft["stats"]["words"], "; ".join(f"{x['step']} {x['seconds']}s/{x['calls']} calls" for x in steps))
    return draft


def run_article(db: Session, article_id: int) -> None:
    a = db.get(Article, article_id)
    if not a or a.status in ("completed", "generating"):
        return
    a.status, a.error, a.progress = "generating", None, "Waiting for Ollama"
    db.commit()

    def progress(text: str) -> None:
        a.progress = text[:255]
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
