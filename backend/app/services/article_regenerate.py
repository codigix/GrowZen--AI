"""Regenerate part of an article (or all of it) with the same Claude setup, prompts and keyword rules as the writer
(services/articles.py). Nothing is saved here: the caller gets the current and the new HTML of that part plus the
whole new body, shows both, and the editor applies it only when the user accepts (then saves it the usual way).

Only the chosen part changes. For the introduction, a section or the conclusion, just its paragraphs (<p>) are
rewritten, in place: headings, lists, links in lists, the CTA box with the business's contact details and every
other part of the article stay exactly as they are. FAQs are rewritten as a new set of questions and answers under
the same heading. "Full article" runs the writer again but keeps the current H1 (the SEO title is not touched).
"""
import html
import re
import threading

from ..models import Article, Business
from . import articles as svc

PARTS = ("full", "intro", "section", "conclusion", "faqs", "title", "meta")
FIELD_PARTS = ("title", "meta")  # one editor field each; the body is not touched
TITLE_MIN, META_TARGET_MIN = 50, 150
_P = re.compile(r"<p\b[^>]*>[\s\S]*?</p>", re.I)
_H1 = re.compile(r"<h1\b[^>]*>[\s\S]*?</h1>", re.I)
_FAQ_HEAD = re.compile(r"frequently asked|\bfaqs?\b", re.I)
_CONCL_HEAD = re.compile(r"conclusion|final thoughts|summary|wrapping up|key takeaways|ready to get started|get started|get in touch|contact", re.I)
_INTRO_HEAD = re.compile(r"^\s*introduction\b", re.I)
_MAX_SLOTS = 12

_inflight: set[int] = set()  # articles with a regeneration running (one at a time per article)
_inflight_lock = threading.Lock()


class RegenError(Exception):
    def __init__(self, message: str, code: int = 422):
        super().__init__(message)
        self.code = code


# ── the article's parts ─────────────────────────────────────────────────────────

def _heading(fragment: str, tag: str) -> str:
    m = re.search(rf"<{tag}\b[^>]*>([\s\S]*?)</{tag}>", fragment, re.I)
    return svc._plain(m.group(1)) if m else ""


def _split(body: str) -> tuple[str, list[tuple[int, int]], str]:
    """(main HTML without the JSON-LD block, [(start, end) of each H2 section in main], the JSON-LD block)."""
    schema = "".join(m.group(0).strip() for m in svc._SCHEMA_RE.finditer(body or ""))
    main = svc._SCHEMA_RE.sub("\n", body or "").strip()
    starts = [m.start() for m in re.finditer(r"<h2\b", main, re.I)]
    return main, list(zip(starts, starts[1:] + [len(main)])), schema


def _join(main: str, schema: str) -> str:
    return f"{main.strip()}\n\n{schema}" if schema else main.strip()


def sections(body: str) -> list[dict]:
    """The H2 sections and the H3 sub-sections a user can pick (the FAQ block is regenerated as a whole)."""
    main, spans, _ = _split(body)
    out = []
    for i, (s, e) in enumerate(spans):
        frag = main[s:e]
        head = _heading(frag, "h2")
        if _FAQ_HEAD.search(head):
            continue
        out.append({"id": f"s{i}", "level": 2, "heading": head, "paragraphs": len(_P.findall(frag))})
        h3s = [m.start() for m in re.finditer(r"<h3\b", frag, re.I)]
        for j, (a, z) in enumerate(zip(h3s, h3s[1:] + [len(frag)])):
            sub = frag[a:z]
            out.append({"id": f"s{i}.{j}", "level": 3, "heading": _heading(sub, "h3"), "parent": head, "paragraphs": len(_P.findall(sub))})
    return out


def _span(main: str, spans: list[tuple[int, int]], part: str, section_id: str | None) -> tuple[int, int, str]:
    """(start, end, label) of the part to regenerate inside `main`."""
    heads = [_heading(main[s:e], "h2") for s, e in spans]
    if part == "intro":
        first = spans[0][0] if spans else len(main)
        head = main[:first]
        if _P.search(head):
            h1 = _H1.search(head)
            return (h1.end() if h1 else 0), first, "Introduction"
        for (s, e), h in zip(spans, heads):
            if _INTRO_HEAD.search(h):
                return s, e, h
        raise RegenError("This article has no introduction paragraphs to regenerate.")
    if part == "faqs":
        for (s, e), h in zip(spans, heads):
            if _FAQ_HEAD.search(h):
                return s, e, h
        raise RegenError("This article has no FAQ section to regenerate.")
    if part == "conclusion":
        found = [(s, e, h) for (s, e), h in zip(spans, heads) if _CONCL_HEAD.search(h) and not _FAQ_HEAD.search(h)]
        if not found:
            found = [(s, e, h) for (s, e), h in zip(spans, heads) if not _FAQ_HEAD.search(h)][-1:]
        if not found:
            raise RegenError("This article has no conclusion to regenerate.")
        return found[-1]
    # a picked section: s{i} (an H2 section) or s{i}.{j} (an H3 inside it)
    m = re.fullmatch(r"s(\d+)(?:\.(\d+))?", section_id or "")
    if not m or int(m.group(1)) >= len(spans):
        raise RegenError("Pick the section to regenerate.")
    s, e = spans[int(m.group(1))]
    if _FAQ_HEAD.search(heads[int(m.group(1))]):
        raise RegenError("Use 'Regenerate FAQs' for the FAQ section.")
    if m.group(2) is None:
        return s, e, heads[int(m.group(1))]
    frag = main[s:e]
    h3s = [x.start() for x in re.finditer(r"<h3\b", frag, re.I)]
    j = int(m.group(2))
    if j >= len(h3s):
        raise RegenError("That sub-section is no longer in the article. Pick the section again.")
    a, z = h3s[j], (h3s[j + 1] if j + 1 < len(h3s) else len(frag))
    return s + a, s + z, _heading(frag[a:z], "h3")


# ── writing ─────────────────────────────────────────────────────────────────────

def _brief(f: dict, b: Business, main: str) -> list[str]:
    """What the writer knows about the article: business context, the editor's current SEO title, meta description
    and keywords, and the outline (same rules as the writer)."""
    outline = [_heading(main[s:e], "h2") for s, e in _split(main)[1]]
    return [
        *svc._context(b, lean=True), "",
        f'Article SEO title: "{f["title"] or f["keyword"]}" (topic: {f["topic"]}). The text must fit this title.',
        *([f'Meta description (what the article promises): "{f["meta"]}"'] if f["meta"] else []),
        f'Primary keyword: "{f["keyword"]}".',
        *([f"Secondary keywords: {', '.join(chr(34) + k + chr(34) for k in f['secondary'])}."] if f["secondary"] else []),
        *([f"Article outline: Introduction → {' → '.join(h for h in outline if h)}"] if outline else []),
    ]


_RULES = [
    "Rules:",
    "- Every paragraph is complete, makes its point clearly and starts with different words than the others.",
    "- Keep the same scope, intent and tone as the current text; improve clarity and usefulness with fresh wording.",
    "- Do not invent statistics, percentages, prices, study results, dates or guarantees.",
    "- Plain text only: no HTML, no markdown, no headings, no labels.",
]


def _rewrite_paragraphs(f: dict, b: Business, main: str, frag: str, label: str, part: str) -> str:
    """The fragment with each of its <p> rewritten (same number of paragraphs, similar lengths); all else unchanged."""
    ps = list(_P.finditer(frag))[:_MAX_SLOTS]
    if not ps:
        raise RegenError(f'"{label}" has no paragraphs to regenerate (only headings or lists).')
    current = [svc._plain(p.group(0)) for p in ps]
    words = [max(25, len(c.split())) for c in current]
    text = svc._text(frag)
    kws = [k for k in f["secondary"] if svc._has(text, k)]
    prompt = "\n".join([
        *_brief(f, b, main), "",
        f'Rewrite the {"introduction" if part == "intro" else "conclusion" if part == "conclusion" else f"section {chr(34)}{label}{chr(34)}"} of this article.',
        f"Write exactly {len(current)} paragraph{'s' if len(current) > 1 else ''}, one for each current paragraph below, about the same length.",
        *([f'- The very first sentence must contain the exact phrase "{f["keyword"]}".'] if part == "intro" else []),
        *(['- It must deliver what the SEO title promises.'] if part == "intro" and f["title"] else []),
        *([f'- Use the exact phrase "{f["keyword"]}" once and end with a clear call to action to contact {b.name}.'] if part == "conclusion" else []),
        *([f'- Use each of these exact phrases at least once, unchanged: {", ".join(chr(34) + k + chr(34) for k in kws)}.'] if kws else []),
        *_RULES, "",
        "Current paragraphs:",
        *[f"{n + 1}. ({w} words) {c}" for n, (c, w) in enumerate(zip(current, words))],
        "",
        f'Answer with ONE JSON object and nothing else: {{"paragraphs": [{len(current)} strings]}}',
    ])
    new: list[str] = []
    for _attempt in range(2):
        d = svc._json(prompt, num_predict=int(sum(words) * 2.2) + 400)
        new = [svc._plain(x) for x in d.get("paragraphs") or [] if isinstance(x, str) and svc._plain(x)]
        if len(new) >= len(current):
            break
    if not new:
        raise RegenError("Claude AI did not return usable text. Try again.", 502)
    new = new[:len(current)]
    out = frag
    for m, txt in reversed(list(zip(ps, new))):  # from the end, so earlier offsets stay valid; extra old paragraphs are kept
        open_tag = re.match(r"<p\b[^>]*>", m.group(0), re.I).group(0)
        out = out[:m.start()] + f"{open_tag}{html.escape(txt, quote=False)}</p>" + out[m.end():]
    return out


def _rewrite_faqs(f: dict, b: Business, main: str, frag: str) -> str:
    head = re.search(r"<h2\b[^>]*>[\s\S]*?</h2>", frag, re.I).group(0)
    questions = [svc._plain(q) for q in re.findall(r"<h3\b[^>]*>([\s\S]*?)</h3>", frag, re.I)]
    n = min(max(len(questions), 3), 6)
    prompt = "\n".join([
        *_brief(f, b, main), "",
        f"Write a fresh set of {n} frequently asked questions for this article, each with a complete, specific answer of 2-3 sentences.",
        "FAQs: real questions people type into Google about this topic (cost, safety, eligibility, timelines, how to choose, what to expect...),"
        " each different and phrased naturally. Never write questions just to fit a keyword; use a secondary keyword only where it reads naturally.",
        *([f"Current questions (improve on them; do not just copy them): {'; '.join(questions)}"] if questions else []),
        *_RULES, "",
        'Answer with ONE JSON object and nothing else: {"faqs": [{"question": "...", "answer": "..."}]}',
    ])
    faqs: list[tuple[str, str]] = []
    for _attempt in range(2):
        d = svc._json(prompt, num_predict=1100)
        faqs = [(svc._plain(x.get("question")), svc._plain(x.get("answer"))) for x in d.get("faqs") or []
                if isinstance(x, dict) and svc._plain(x.get("question")) and svc._plain(x.get("answer"))]
        if len(faqs) >= min(3, n):
            break
    if not faqs:
        raise RegenError("Claude AI did not return usable FAQs. Try again.", 502)
    blocks = [f"<h3>{html.escape(q if q.endswith('?') else q.rstrip('.') + '?', quote=False)}</h3>\n<p>{html.escape(ans, quote=False)}</p>" for q, ans in faqs[:n]]
    return head + "\n" + "\n".join(blocks) + "\n\n"


def _full(b: Business, f: dict, a: Article, main: str) -> str:
    """The whole article written again by the writer, planned around the editor's current SEO title (its H1) and meta
    description, with the editor's current keywords."""
    draft = svc.write(f["keyword"], f["secondary"], a.rising_keywords or [], b, topic=a.topic or "", length=a.length or "standard",
                      title_hint=f["title"] or None, meta_hint=f["meta"] or None)
    new = svc._SCHEMA_RE.sub("\n", draft["body"]).strip()
    if f["title"]:
        h1 = f"<h1>{html.escape(f['title'], quote=False)}</h1>"
        new = _H1.sub(lambda _m: h1, new, count=1) if _H1.search(new) else f"{h1}\n\n{new}"
    else:
        old_h1 = _H1.search(main)
        if old_h1:
            new = _H1.sub(lambda _m: old_h1.group(0), new, count=1)
    return new


def _field_brief(b: Business, f: dict, body: str) -> list[str]:
    opening = " ".join(svc._plain(p) for p in _P.findall(svc._SCHEMA_RE.sub(" ", body or "")))[:700]
    return [
        *svc._context(b, lean=True), "",
        f"Blog article topic: {f['topic']}",
        f'Primary keyword: "{f["keyword"]}"',
        *([f"Secondary keywords: {', '.join(chr(34) + k + chr(34) for k in f['secondary'])}"] if f["secondary"] else []),
        *([f"What the article says (opening): {opening}"] if opening else []),
    ]


def _clean_line(t: str) -> str:
    return " ".join(svc._plain(t).strip().strip("\"'“”‘’").split())


def _new_title(b: Business, f: dict, body: str) -> str:
    """A new SEO title of 50-60 characters with the exact primary keyword (the writer's title rules)."""
    prompt = "\n".join([
        *_field_brief(b, f, body),
        *([f'Current SEO title: "{f["title"]}"'] if f["title"] else []), "",
        f"Write ONE new SEO title for this article: {TITLE_MIN}-{svc.TITLE_MAX} characters, containing the exact phrase \"{f['keyword']}\""
        " (preferably near the start), specific and compelling, no clickbait, no quotes, no trailing period."
        + (" It must be clearly different from the current title." if f["title"] else ""),
        "Answer with ONLY the title, nothing else.",
    ])
    best, ask = "", prompt
    for _attempt in range(4):
        t = _clean_line(svc._short(ask, num_predict=60)).rstrip(".")
        if len(t) > svc.TITLE_MAX:
            t = svc._shorten_title(t, f["keyword"])
        if not t or len(t) > svc.TITLE_MAX or not svc._has(t, f["keyword"]) or t == f["title"]:
            continue
        if len(t) >= TITLE_MIN:
            return t
        best = max(best, t, key=len)  # usable but short: kept if nothing better comes
        ask = prompt + f'\n\nYour previous answer had only {len(t)} characters: "{t}". Write it again with {TITLE_MIN}-{svc.TITLE_MAX} characters.'
    if best:
        return best
    raise RegenError("Claude AI did not return a usable SEO title (50-60 characters with the primary keyword). Try again.", 502)


def _new_meta(b: Business, f: dict, body: str) -> str:
    """A new meta description of 150-160 characters with the exact primary keyword, matching the current title."""
    prompt = "\n".join([
        *_field_brief(b, f, body),
        *([f'SEO title: "{f["title"]}"'] if f["title"] else []),
        *([f'Current meta description: "{f["meta"]}"'] if f["meta"] else []), "",
        f"Write ONE new meta description for this article: one or two complete sentences, {META_TARGET_MIN}-{svc.META_MAX} characters,"
        f" containing the exact phrase \"{f['keyword']}\", matching the SEO title, telling the reader what they will learn, with a soft call to action."
        " No quotes, no invented facts or numbers." + (" It must be clearly different from the current one." if f["meta"] else ""),
        "Answer with ONLY the meta description, nothing else.",
    ])
    best, ask = "", prompt
    for _attempt in range(4):
        t = _clean_line(svc._short(ask, num_predict=120))
        if len(t) > svc.META_MAX:
            t = svc.fit_meta(t)
        if not t or len(t) > svc.META_MAX or not svc._has(t, f["keyword"]) or t == f["meta"]:
            continue
        if len(t) >= META_TARGET_MIN:
            return t
        if len(t) >= svc.META_MIN:
            best = max(best, t, key=len)
        # too short: say by how much, so the next answer lands in 150-160
        ask = prompt + f'\n\nYour previous answer had only {len(t)} characters: "{t}". Write it again with {META_TARGET_MIN}-{svc.META_MAX} characters (add about {META_TARGET_MIN + 5 - len(t)} characters of useful detail).'
    if best:
        return best
    raise RegenError("Claude AI did not return a usable meta description (150-160 characters with the primary keyword). Try again.", 502)


def regenerate(a: Article, b: Business, part: str, body: str | None = None, section_id: str | None = None, fields: dict | None = None) -> dict:
    """Current and new HTML of the part, and the whole new body; for "title" / "meta" the current and new value of
    that one field. Saves nothing."""
    if part not in PARTS:
        raise RegenError("Unknown part to regenerate.")
    if a.status != "completed":
        raise RegenError("Only a completed article can be regenerated.", 409)
    body = body if body is not None else (a.body or "")
    # the editor's current values (unsaved edits included), else the saved ones: every option follows the SEO title,
    # meta description and keywords that are on screen now (e.g. a title just regenerated)
    fields = fields or {}
    f = {"keyword": (fields.get("keyword") or a.keyword or "").strip(), "title": (fields.get("title") if fields.get("title") is not None else a.title or "").strip(),
         "meta": (fields.get("meta_description") if fields.get("meta_description") is not None else a.meta_description or "").strip(),
         "secondary": [k for k in (fields.get("secondary_keywords") if fields.get("secondary_keywords") is not None else a.secondary_keywords or []) if k],
         "topic": a.topic or a.keyword}
    if not f["keyword"]:
        raise RegenError("Enter the primary keyword first.")
    if part not in FIELD_PARTS and not svc._text(svc._SCHEMA_RE.sub(" ", body)):
        raise RegenError("The article body is empty.")
    with _inflight_lock:
        if a.id in _inflight:
            raise RegenError("This article is already being regenerated. Wait for it to finish.", 409)
        _inflight.add(a.id)
    try:
        if svc._ollama_lock.locked():
            raise RegenError("Claude AI is busy writing another article right now. Try again when it finishes.", 409)
        if part == "title":
            return {"part": part, "label": "SEO title", "field": "title", "current": f["title"], "value": _new_title(b, f, body)}
        if part == "meta":
            return {"part": part, "label": "Meta description", "field": "meta_description", "current": f["meta"], "value": _new_meta(b, f, body)}
        main, spans, schema = _split(body)
        if part == "full":
            new_main = _full(b, f, a, main)
            return {"part": part, "label": "Full article", "current_html": main, "new_html": new_main, "body": _join(new_main, schema)}
        s, e, label = _span(main, spans, part, section_id)
        frag = main[s:e]
        new_frag = _rewrite_faqs(f, b, main, frag) if part == "faqs" else _rewrite_paragraphs(f, b, main, frag, label, part)
        new_main = main[:s] + new_frag + main[e:]
        return {"part": part, "label": label, "current_html": frag.strip(), "new_html": new_frag.strip(), "body": _join(new_main, schema)}
    except RuntimeError as exc:  # Claude not configured / not reachable
        if isinstance(exc, RegenError):
            raise
        raise RegenError(str(exc), 502) from exc
    finally:
        with _inflight_lock:
            _inflight.discard(a.id)
