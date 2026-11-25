"""One prompt module per workflow stage. Each stage takes the workflow context and returns structured output for the next stage.

Research stages (before writing; the user reviews and edits the brief they produce):
    /brainstorm-content-ideas  /research-search-intent  /research-entities  /analyze-keyword
    /insights-opportunities    /insights-content-gaps   /context-competitors  /write-content-brief
Article stages (after the brief is confirmed; run by runner.py inside the article job):
    /write-seo-article (the existing writer, articles.write, fed with the brief)
    /shorten-meta-title  /shorten-meta-description  /expert  /human  /seo-expert

Context (a JSON dict kept with the article in Article.stats["workflow"]):
    {"input": {title, primary, secondary, topic, intent, audience, length, instructions},
     "data":  {"serp": google_results(), "competitors": competitor_pages(), "metrics": keyword_metrics()},   <- verified research only
     "stages": {stage_id: {"status", "output", "error", "at", "basis"}},
     "brief": {... the content brief, as the user edited it ...}}

Every answer is checked before it is kept: lists are cut to size, only known values are accepted, and numbers such as search volumes are
taken from the research data, never from the model.
"""
from __future__ import annotations

import json
import re

from .. import articles as svc
from . import master_prompt as mp
from . import research

INTENTS = ("informational", "commercial", "transactional", "local", "navigational")
WH_RE = re.compile(r"^(what|why|how|when|where)\b", re.I)


# ── helpers ──────────────────────────────────────────────────────────────────

def _brand(b) -> str:
    return svc.brand_of(b)


def _location(b) -> str:
    return ", ".join(x for x in [getattr(b, "area", None), getattr(b, "city", None)] if x)


def _strs(v, hi: int = 12, maxlen: int = 200) -> list[str]:
    out = []
    for x in v if isinstance(v, list) else []:
        t = svc._plain(x) if isinstance(x, (str, int, float)) else ""
        if t and len(t) <= maxlen and t.lower() not in (o.lower() for o in out):
            out.append(t)
    return out[:hi]


def _head(ctx: dict, b, task: str) -> list[str]:
    """The master prompt (inputs + content rules) followed by this stage's task."""
    inp = ctx.get("input") or {}
    brand = _brand(b)
    return [
        *mp.inputs_block(inp, brand=brand, profile=svc.ai.profile_text(b), location=_location(b), competitors=(ctx.get("data") or {}).get("competitors")),
        "",
        *mp.content_rules(inp.get("primary") or "", brand, _location(b)),
        "",
        f"YOUR TASK NOW: {task}",
    ]


def _ask(lines: list[str], budget: int = 1500) -> dict:
    """One JSON answer; a cut-off or invalid answer is asked for once more (with more room and a request to be concise) before the stage fails."""
    prompt = "\n".join(lines)
    d = svc._json(prompt, num_predict=max(budget, 1500), timeout=150)
    if not d:
        d = svc._json(prompt + "\n\nYour last answer was cut off or was not valid JSON. Answer with ONE complete JSON object; keep every item short.",
                      num_predict=max(budget, 1500) * 2, timeout=180)
    if not d:
        raise RuntimeError("The AI did not return a usable answer for this stage. Retry the stage.")
    return d


_STOP = {"what", "why", "how", "when", "where", "is", "are", "do", "does", "the", "a", "an", "to", "for", "of", "and", "your", "you", "it", "in", "on", "can", "should"}


def _overlap(a: str, b: str) -> float:
    """Share of the meaningful words of the shorter text that the other one also has (0..1)."""
    wa = {w[:6] for w in re.findall(r"[a-z0-9]+", (a or "").lower()) if w not in _STOP}
    wb = {w[:6] for w in re.findall(r"[a-z0-9]+", (b or "").lower()) if w not in _STOP}
    return len(wa & wb) / max(1, min(len(wa), len(wb)))


def _out(ctx: dict, stage: str) -> dict:
    return ((ctx.get("stages") or {}).get(stage) or {}).get("output") or {}


def _verified_lists(ctx: dict) -> tuple[list[str], list[str]]:
    serp = (ctx.get("data") or {}).get("serp") or {}
    return (serp.get("paa") or [], serp.get("related") or []) if serp.get("available") else ([], [])


# ── research stages ──────────────────────────────────────────────────────────

def brainstorm(ctx: dict, b) -> dict:
    d = _ask(_head(ctx, b, "/brainstorm-content-ideas: brainstorm 3 to 5 different content angles for this article (different readers, problems or formats)"
                     " and pick the one that best fits the primary keyword and the business.") + [
        'Answer with JSON only: {"angles": [{"title": "working title", "angle": "one sentence", "audience": "who it is for"}],'
        ' "recommended": 0, "audience": "the target audience of the recommended angle"}'], 900)
    angles = [{"title": svc._plain(a.get("title")), "angle": svc._plain(a.get("angle")), "audience": svc._plain(a.get("audience"))}
              for a in (d.get("angles") or []) if isinstance(a, dict) and svc._plain(a.get("title"))][:5]
    if not angles:
        raise RuntimeError("No content angles came back. Retry the stage.")
    rec = d.get("recommended") if isinstance(d.get("recommended"), int) and 0 <= d.get("recommended") < len(angles) else 0
    return {"angles": angles, "recommended": rec, "audience": svc._plain(d.get("audience")) or angles[rec]["audience"], "basis": "AI suggestion"}


def search_intent(ctx: dict, b) -> dict:
    inp = ctx.get("input") or {}
    data = ctx.setdefault("data", {})
    if "serp" not in data:  # real Google results (and the top pages' headings) are read once, here, and reused by later stages
        data["serp"] = research.google_results(inp.get("primary") or "", getattr(b, "country", None) or "IN")
        data["competitors"] = research.competitor_pages(data["serp"], getattr(b, "website", None))
    serp = data["serp"]
    if serp.get("available"):
        evidence = ["", "REAL GOOGLE RESULTS for the primary keyword (verified data):",
                    *[f"{x['position']}. {x['title']} — {x['snippet']}" for x in serp["organic"][:8]],
                    "People Also Ask: " + "; ".join(serp["paa"]) if serp["paa"] else "People Also Ask: (none shown)",
                    "Related searches: " + "; ".join(serp["related"]) if serp["related"] else "Related searches: (none shown)"]
    else:
        evidence = ["", f"No Google results are available ({serp.get('note')}). Base the intent on the keyword itself and say so."]
    d = _ask(_head(ctx, b, "/research-search-intent: work out the search intent behind the primary keyword: what searchers want, the questions they ask"
                     " and the content format that serves them best.") + evidence + [
        'Answer with JSON only: {"intent": "informational|commercial|transactional|local|navigational", "user_goals": ["..."],'
        ' "questions": ["questions readers ask"], "format": "the best content format (guide, how-to, comparison...)", "summary": "two sentences"}'], 1000)
    intent = str(d.get("intent") or "").lower()
    return {"intent": intent if intent in INTENTS else "informational", "user_goals": _strs(d.get("user_goals"), 8), "questions": _strs(d.get("questions"), 10),
            "format": svc._plain(d.get("format")), "summary": svc._plain(d.get("summary")),
            "paa_verified": serp.get("paa") or [], "related_verified": serp.get("related") or [],
            "basis": "Google results + AI analysis" if serp.get("available") else "AI analysis only (no search data)", "research_note": serp.get("note", "")}


def entities(ctx: dict, b) -> dict:
    d = _ask(_head(ctx, b, "/research-entities: list the entities (organisations, technologies, standards, concepts, roles, places) a complete article"
                     " on this topic should mention, plus synonyms of the primary keyword and closely related terms.") + [
        f"Search intent found earlier: {json.dumps(_out(ctx, 'search_intent').get('summary') or '')}",
        'Answer with JSON only: {"entities": [{"name": "...", "type": "concept|technology|organisation|standard|role|place|other"}], "synonyms": ["..."], "related_terms": ["..."]}'], 900)
    ents = [{"name": svc._plain(e.get("name")), "type": svc._plain(e.get("type")) or "other"} for e in (d.get("entities") or []) if isinstance(e, dict) and svc._plain(e.get("name"))][:15]
    return {"entities": ents, "synonyms": _strs(d.get("synonyms"), 10), "related_terms": _strs(d.get("related_terms"), 12), "basis": "AI suggestion"}


def analyze_keyword(ctx: dict, b) -> dict:
    inp = ctx.get("input") or {}
    kws = [k for k in [inp.get("primary"), *(inp.get("secondary") or [])] if k]
    data = ctx.setdefault("data", {})
    data["metrics"] = research.keyword_metrics(kws)
    vols = {k.lower(): v for k, v in (data["metrics"].get("volumes") or {}).items()}
    d = _ask(_head(ctx, b, "/analyze-keyword: assess the primary keyword and each secondary keyword: how relevant it is to this article and in which section"
                     " it fits. Suggest long-tail variations. Do NOT state search volumes or difficulty scores; they come from Keyword Planner only.") + [
        f"Keyword Planner monthly searches (verified; missing = no data): {json.dumps({k: vols.get(k.lower()) for k in kws})}",
        'Answer with JSON only: {"primary_notes": "how to use the primary keyword", "secondary": [{"keyword": "...", "relevance": "high|medium|low", "use_in": "which section"}],'
        ' "long_tail": ["..."], "drop": ["secondary keywords that do not fit this article"]}'], 1000)
    sec = []
    for x in d.get("secondary") or []:
        if isinstance(x, dict) and svc._plain(x.get("keyword")):
            k = svc._plain(x.get("keyword"))
            rel = str(x.get("relevance") or "").lower()
            sec.append({"keyword": k, "relevance": rel if rel in ("high", "medium", "low") else "medium", "use_in": svc._plain(x.get("use_in")),
                        "monthly_searches": vols.get(k.lower())})  # verified number or None, never the model's
    return {"primary": {"keyword": inp.get("primary"), "monthly_searches": vols.get((inp.get("primary") or "").lower()), "notes": svc._plain(d.get("primary_notes"))},
            "secondary": sec[:15], "long_tail": _strs(d.get("long_tail"), 10), "drop": _strs(d.get("drop"), 10),
            "basis": "Keyword Planner volumes + AI assessment" if data["metrics"].get("available") else "AI assessment only (no Keyword Planner data)",
            "research_note": data["metrics"].get("note", "")}


def opportunities(ctx: dict, b) -> dict:
    d = _ask(_head(ctx, b, "/insights-opportunities: find the content opportunities: what this article can do better or differently to help the reader"
                     " (angles, formats, examples, questions answered poorly elsewhere), and how the business can be genuinely useful here.") + [
        f"Search intent: {json.dumps(_out(ctx, 'search_intent'))[:1500]}",
        f"Chosen angle: {json.dumps(_out(ctx, 'brainstorm'))[:800]}",
        'Answer with JSON only: {"opportunities": ["..."], "differentiators": ["..."]}'], 800)
    return {"opportunities": _strs(d.get("opportunities"), 8, 300), "differentiators": _strs(d.get("differentiators"), 6, 300), "basis": "AI suggestion"}


def content_gaps(ctx: dict, b) -> dict:
    comp = (ctx.get("data") or {}).get("competitors") or {}
    has = bool(comp.get("available"))
    d = _ask(_head(ctx, b, "/insights-content-gaps: list the gaps this article must fill: topics, questions and details readers need" +
                     (" that the competitor pages (their headings are in the inputs) leave out or cover thinly." if has else
                      ". No competitor pages are available: base the gaps on the search intent and questions, and say so.")) + [
        f"Reader questions: {json.dumps(_out(ctx, 'search_intent').get('questions') or [])}",
        'Answer with JSON only: {"gaps": ["..."], "must_cover": ["points the article must cover"]}'], 900)
    return {"gaps": _strs(d.get("gaps"), 10, 300), "must_cover": _strs(d.get("must_cover"), 12, 300),
            "basis": "Competitor pages + AI analysis" if has else "AI suggestion (no competitor pages were analysed)"}


def competitors(ctx: dict, b) -> dict:
    comp = (ctx.get("data") or {}).get("competitors") or {}
    if not comp.get("available"):  # no AI call: nothing may be claimed about competitors without real pages
        return {"available": False, "note": comp.get("note") or "No competitor pages were analysed.", "pages": [], "basis": "Not available"}
    pages = [{"url": r["url"], "title": r["title"], "words": r.get("words"), "headings": len(r.get("headings") or [])} for r in comp["results"]]
    d = _ask(_head(ctx, b, "/context-competitors: summarise ONLY what the competitor pages in the inputs show (their headings): the topics they all cover,"
                     " how they are structured, and where this article can be more useful. Do not invent anything beyond those headings.") + [
        'Answer with JSON only: {"common_topics": ["..."], "structure": "one or two sentences", "summary": ["..."]}'], 800)
    words = sorted(p["words"] for p in pages if p.get("words"))
    return {"available": True, "pages": pages, "typical_words": words[len(words) // 2] if words else None,
            "common_topics": _strs(d.get("common_topics"), 10, 200), "structure": svc._plain(d.get("structure")), "summary": _strs(d.get("summary"), 6, 300),
            "basis": "Top Google result pages (verified) + AI summary", "note": comp.get("note", "")}


def content_brief(ctx: dict, b) -> dict:
    inp = ctx.get("input") or {}
    primary = inp.get("primary") or ""
    paa, _rel = _verified_lists(ctx)
    research_summary = {k: _out(ctx, k) for k in ("brainstorm", "search_intent", "entities", "analyze_keyword", "opportunities", "content_gaps", "competitors")}
    d = _ask(_head(ctx, b, "/write-content-brief: write the content brief the article will be written from, using all the research below.") + [
        "RESEARCH (stages so far):", json.dumps(research_summary)[:9000], "",
        "Rules: 2 to 4 main H2 sections in a logical order (not Introduction, FAQ, Why choose or Conclusion: those are fixed parts), each with 1 to 4 H3 sub-headings"
        " and the key points to cover. Headings fit the topic and its industry and are grammatically correct. No two sections may cover the same ground."
        " One WH question (What/Why/How/When/Where ... ?) on a point NOT already covered by an H2. Exactly 5 FAQs, People-Also-Ask style"
        + (f" (real ones from Google: {json.dumps(paa)})" if paa else "") + ". include_help_section is true only when a \"Don't wait to seek help / act now\" section"
        " genuinely helps readers of this topic. business_relevant is false when the business's services are not closely related to the topic.",
        'Answer with JSON only: {"angle": "...", "audience": "...", "intent": "informational|commercial|transactional|local|navigational",'
        ' "outline": [{"h2": "...", "h3": ["..."], "points": ["..."]}], "wh_question": "...?", "include_help_section": true, "faqs": ["5 questions"],'
        ' "entities": ["entities to mention"], "must_cover": ["..."], "secondary_keywords": ["the secondary keywords to use"],'
        ' "business_relevant": true, "business_note": "how the business fits this topic", "word_target": 2000, "instructions": "extra notes for the writer"}'], 2200)
    outline = []
    for s in d.get("outline") or []:
        if isinstance(s, dict) and svc._plain(s.get("h2")) and not svc.SKIP_HEADING.fullmatch(svc._plain(s.get("h2"))):
            outline.append({"h2": svc._plain(s.get("h2")), "h3": _strs(s.get("h3"), 4, 120), "points": _strs(s.get("points"), 6, 250)})
    if len(outline) < 2:
        raise RuntimeError("The brief came back without at least two main sections. Retry the stage.")
    wh = svc._plain(d.get("wh_question"))
    if not WH_RE.match(wh):
        wh = next((q for q in [*paa, *(_out(ctx, "search_intent").get("questions") or [])] if WH_RE.match(q or "")), f"What should you know about {primary}?")
    wh = wh.rstrip(".!:; ") + ("" if wh.endswith("?") else "?")
    if any(_overlap(wh, s["h2"]) >= 0.75 for s in outline):  # the WH section must not repeat a main section (that doubled the same explanation)
        alt = [q for q in [*paa, *(_out(ctx, "search_intent").get("questions") or [])]
               if WH_RE.match(q or "") and all(_overlap(q, s["h2"]) < 0.75 for s in outline)]
        if alt:
            wh = alt[0].rstrip(".!:; ") + ("" if alt[0].endswith("?") else "?")
    faqs = [q.rstrip(".") + ("" if q.endswith("?") else "?") for q in _strs(d.get("faqs"), 7, 200)]
    for q in [*paa, *(_out(ctx, "search_intent").get("questions") or [])]:  # always exactly 5, topped up from real/earlier questions
        if len(faqs) >= 5:
            break
        if q and q.lower() not in (f.lower() for f in faqs) and q.lower() != wh.lower():
            faqs.append(q if q.endswith("?") else q + "?")
    intent = str(d.get("intent") or _out(ctx, "search_intent").get("intent") or "").lower()
    try:
        words = int(d.get("word_target") or 0)
    except (TypeError, ValueError):
        words = 0
    return {
        "title": inp.get("title") or "", "primary": primary, "angle": svc._plain(d.get("angle")), "audience": svc._plain(d.get("audience")) or _out(ctx, "brainstorm").get("audience", ""),
        "intent": intent if intent in INTENTS else "informational", "outline": outline[:4], "wh_question": wh,
        "include_help_section": d.get("include_help_section") is not False, "faqs": faqs[:5],
        "entities": _strs(d.get("entities"), 12), "must_cover": _strs(d.get("must_cover"), 12, 250),
        "secondary_keywords": _strs(d.get("secondary_keywords"), 12) or list(inp.get("secondary") or []),
        **_business_fit(d, primary, b),
        "word_target": words if 300 <= words <= 5000 else None, "instructions": svc._plain(d.get("instructions")),
        "basis": "Built from the research stages above",
    }


_GENERIC = {"guide", "best", "near", "what", "how", "why", "with", "your", "for", "and", "the", "tips", "services", "service", "solution", "solutions",
            "online", "small", "top", "management", "tool", "tools", "platform", "company", "companies", "business", "india", "software", "system", "systems", "practical", "complete"}


def _stem(w: str) -> str:
    return w[:6]


def _business_fit(d: dict, primary: str, b) -> dict:
    """Is the business genuinely related to the topic? The AI's view, with a deterministic veto: when no meaningful word of the primary keyword
    appears in the business's categories, services or description, the business is treated as NOT related (the AI alone was not reliable here)."""
    ai_says = d.get("business_relevant") is not False
    words = {_stem(w) for w in re.findall(r"[a-z0-9]+", (primary or "").lower()) if len(w) > 2 and w not in _GENERIC}
    services = " ".join(str(getattr(s, "get", lambda k: s)("name") if isinstance(s, dict) else s) for s in (getattr(b, "services", None) or []))
    profile = " ".join(str(x or "") for x in [getattr(b, "primary_category", ""), " ".join(getattr(b, "categories", None) or []) if isinstance(getattr(b, "categories", None), list) else "",
                                               getattr(b, "description", ""), services, svc.ai.profile_text(b)])
    have = {_stem(w) for w in re.findall(r"[a-z0-9]+", profile.lower()) if len(w) > 2}
    overlap = bool(words & have) if words else True
    relevant = ai_says and overlap
    note = svc._plain(d.get("business_note"))
    if ai_says and not overlap:
        note = (f"Not related: none of the topic's words ({', '.join(sorted(words))}) appear in the business's categories or services, so the business"
                " is not presented as a provider of this topic.")
    return {"business_relevant": relevant, "business_note": note}


# ── article stages ───────────────────────────────────────────────────────────

def shorten_meta_title(art: dict, b) -> dict:
    t, primary = art["title"], art["primary"]
    if t and len(t) <= svc.TITLE_MAX and svc._has(t, primary):
        return {"changed": False, "before": t, "after": t, "note": f"Already {len(t)} characters with the primary keyword: no change needed."}
    d = _ask([f'/shorten-meta-title: rewrite this SEO title to at most {svc.TITLE_MAX} characters. It must contain the exact phrase "{primary}" and keep the meaning.',
              f"Title: {t}", 'Answer with JSON only: {"options": ["...", "...", "..."]}'], 300)
    ok = [x for x in _strs(d.get("options"), 5, 100) if len(x) <= svc.TITLE_MAX and svc._has(x, primary)]
    new = ok[0] if ok else svc._shorten_title(t, primary)[: svc.TITLE_MAX]
    return {"changed": new != t, "before": t, "after": new, "note": f"{len(t)} → {len(new)} characters" + ("" if ok else " (cut in Python: the AI gave no valid option)")}


def shorten_meta_description(art: dict, b) -> dict:
    m, primary = art["meta"], art["primary"]
    if m and 120 <= len(m) <= svc.META_MAX and svc._has(m, primary):
        return {"changed": False, "before": m, "after": m, "note": f"Already {len(m)} characters with the primary keyword: no change needed."}
    d = _ask([f'/shorten-meta-description: rewrite this meta description to 120-{svc.META_MAX} characters (never more than {svc.META_MAX}).'
              f' It must contain the exact phrase "{primary}", be one or two complete sentences and invite the click without exaggeration.',
              f"Meta description: {m}", f"Article title: {art['title']}", 'Answer with JSON only: {"options": ["...", "...", "..."]}'], 400)
    ok = [x for x in _strs(d.get("options"), 5, 200) if 120 <= len(x) <= svc.META_MAX and svc._has(x, primary)]
    new = ok[0] if ok else svc.fit_meta(m) if len(m) > svc.META_MAX else m
    return {"changed": new != m, "before": m, "after": new, "note": f"{len(m)} → {len(new)} characters" + ("" if ok else " (no valid AI option; kept within the limit in Python)")}


_EDIT_SHAPE = ('"edits": [{"find": "an exact sentence or phrase copied from the article text (15 to 300 characters)", "replace": "the improved plain text",'
               ' "reason": "why"}]')


def expert(art: dict, b) -> dict:
    d = _ask([
        *mp.template_block(_brand(b)),  # the blog template the article was written to
        "/expert: you are a subject-matter expert in the article's industry. Review the article for topic accuracy, completeness, unsupported claims and"
        " industry-specific correctness. Only flag real problems. Fix a problem with a small, exact text edit, or soften an unsupported claim.",
        "Business profile (true facts):", svc.ai.profile_text(b),
        f'Primary keyword: "{art["primary"]}"', "ARTICLE TEXT:", svc._text(svc._SCHEMA_RE.sub(" ", art["body"]))[:40000],
        'Answer with JSON only: {"verdict": "pass|warning|fail", "summary": "two sentences", "issues": [{"issue": "...", "severity": "low|medium|high"}],'
        ' "unsupported_claims": ["..."], "missing_topics": ["..."], ' + _EDIT_SHAPE + '} (at most 8 edits; none when nothing needs fixing)'], 2200)
    return _review_out(d, art)


def human(art: dict, b) -> dict:
    d = _ask([
        *mp.template_block(_brand(b)),  # the blog template the article was written to
        "/human: you are an experienced human editor. Review the article for natural language, repetition, readability, transitions and unnecessary"
        " promotional wording. Keep facts, keywords and meaning. Fix problems with small, exact text edits (a sentence at a time).",
        *_density_instruction(art),
        "ARTICLE TEXT:", svc._text(svc._SCHEMA_RE.sub(" ", art["body"]))[:40000],
        "HEADINGS: " + json.dumps(svc.headings_of(svc._SCHEMA_RE.sub(" ", art["body"]))),
        'Also list "heading_fixes" ONLY for headings above that are grammatically wrong or awkward (e.g. a missing article: "Before Starting Digital Solution?"):'
        " keep the meaning, the keyword and the heading type (a question stays a question).",
        'Answer with JSON only: {"verdict": "pass|warning|fail", "summary": "two sentences", "issues": [{"issue": "...", "severity": "low|medium|high"}], '
        '"heading_fixes": [{"from": "the exact heading", "to": "the corrected heading"}], '
        + _EDIT_SHAPE + '} (at most 10 edits; none when the writing is already natural)'], 2600)
    out = _review_out(d, art)
    out["heading_fixes"] = [{"from": svc._plain(x.get("from")), "to": svc._plain(x.get("to"))} for x in (d.get("heading_fixes") or [])
                            if isinstance(x, dict) and svc._plain(x.get("from")) and svc._plain(x.get("to"))][:8]
    return out


# a WH question puts the verb right after the WH word ("What is", "How do", "Why should", "How much", "Which kind of") — "What you should…" is not a question
_QUESTION_FORM = re.compile(r"^(what|why|how|when|where)(\s+(much|many|long|often|kind|type|types|sort))?(\s+of)?\s+"
                            r"(is|are|was|were|do|does|did|should|can|could|will|would|has|have|had|makes?|happens?|to|matters?|counts?)\b", re.I)


def apply_heading_fixes(body: str, fixes: list[dict], primary: str) -> tuple[str, list[dict]]:
    """Grammar fixes for H2/H3 headings, kept safe: the heading must exist exactly; the fix keeps the primary keyword if it had it, a WH question stays a
    WH question ending in '?', the "Don't wait" and "Why choose" headings keep their wording, and it is plain text of a sensible length."""
    import html as _h
    results = []
    for f in fixes:
        old, new = f["from"], f["to"]
        why = ""
        if not (3 <= len(new) <= 120) or "<" in new or ">" in new or new == old:
            why = "not a usable fix"
        elif svc._has(old, primary) and not svc._has(new, primary):
            why = "would remove the primary keyword"
        elif WH_RE.match(old) and old.endswith("?") and not (WH_RE.match(new) and new.endswith("?") and _QUESTION_FORM.match(new)):
            why = "the WH question must stay a real WH question (e.g. \"What should you…?\", not \"What you should…?\")"
        elif svc.ACTION_RE.search(old) and not svc.ACTION_RE.search(new):
            why = "the \"Don't wait\" heading must keep its wording"
        elif re.search(r"why choose|what to look for", old, re.I) and not re.search(r"why choose|what to look for", new, re.I):
            why = "the \"Why choose\" heading must keep its wording"
        else:
            rx = re.compile(r"(<h([23])\b[^>]*>)([\s\S]*?)(</h\2>)", re.I)
            hits = [m for m in rx.finditer(body) if svc._text(m.group(3)) == old]
            if len(hits) != 1:
                why = "heading not found exactly once"
            else:
                m = hits[0]
                body = body[: m.start()] + m.group(1) + _h.escape(new, quote=False) + m.group(4) + body[m.end():]
        results.append({**f, "applied": not why, "skipped_because": why})
    return body, results


def keyword_density(body: str, primary: str) -> tuple[float, int, int]:
    """(density %, uses, words) of the primary keyword in the visible article text."""
    text = svc._text(svc._SCHEMA_RE.sub(" ", body or ""))
    words = len(text.split())
    uses = len(re.findall(r"(?<!\w)" + re.escape(" ".join(primary.split())).replace(r"\ ", r"\s+") + r"(?!\w)", text, re.I)) if primary else 0
    return (uses * len(primary.split()) * 100 / words if words else 0.0), uses, words


def _density_instruction(art: dict) -> list[str]:
    dens, uses, words = keyword_density(art["body"], art["primary"])
    if dens > 2.5:  # too dense: replace some uses with natural wording (the edits keep it in the title, headings and first sentence untouched)
        keep = max(1, round(words * 0.02 / max(1, len(art["primary"].split()))))
        return [f'KEYWORD DENSITY: "{art["primary"]}" is used {uses} times in {words} words ({dens:.1f}%), above the 1-2% target. Include edits that replace'
                f" about {uses - keep} of its uses in body sentences with natural synonyms or pronouns (keep it in the first sentence of the article)."]
    return [f'Keep the exact phrase "{art["primary"]}" wherever it appears (its density is {dens:.1f}%, within the target); do not force it into new places.']


def thin_keyword(body: str, primary: str) -> tuple[str, dict]:
    """When the primary keyword is still above 2% after the human review (which has only a few edits), rewrite just enough body sentences that
    use it, spread through the article, so they use a natural synonym or pronoun instead. The title, headings and the article's first sentence
    are never touched (apply_edits works on body text only). Returns (body, summary)."""
    dens, uses, words = keyword_density(body, primary)
    if dens <= 2.5:
        return body, {"before": round(dens, 2), "after": round(dens, 2), "rewritten": 0}
    need = uses - max(1, round(words * 0.02 / max(1, len(primary.split()))))
    text = svc._text(svc._SCHEMA_RE.sub(" ", body))
    sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if re.search(re.escape(primary), s, re.I) and len(s.split()) >= 6]
    sents = [s for s in sents[1:] if not s.endswith("?")]  # not the first sentence of the article, not FAQ questions
    if not sents or need <= 0:
        return body, {"before": round(dens, 2), "after": round(dens, 2), "rewritten": 0}
    step = max(1, len(sents) // max(1, need))
    picked = sents[::step][: need + 2]
    d = _ask([f'Rewrite each sentence below so it no longer contains the exact phrase "{primary}": use a natural synonym, a shorter reference or a pronoun.'
              " Keep the meaning, the facts and the rest of the wording; the sentence must still read well on its own.",
              "Sentences: " + json.dumps(picked),
              'Answer with JSON only: {"edits": [{"find": "the exact original sentence", "replace": "the rewritten sentence"}]}'], 2400)
    edits = [{"find": svc._plain(e.get("find")), "replace": svc._plain(e.get("replace"))} for e in (d.get("edits") or []) if isinstance(e, dict)]
    new, results = apply_edits(body, edits, primary, max_kw_removals=need)
    return new, {"before": round(dens, 2), "after": round(keyword_density(new, primary)[0], 2), "rewritten": sum(1 for r in results if r["applied"])}


def _review_out(d: dict, art: dict) -> dict:
    v = str(d.get("verdict") or "").lower()
    issues = [{"issue": svc._plain(x.get("issue")), "severity": str(x.get("severity") or "low").lower()} for x in (d.get("issues") or [])
              if isinstance(x, dict) and svc._plain(x.get("issue"))][:12]
    edits = [{"find": str(x.get("find") or "").strip(), "replace": str(x.get("replace") or "").strip(), "reason": svc._plain(x.get("reason"))}
             for x in (d.get("edits") or []) if isinstance(x, dict)][:10]
    return {"verdict": v if v in ("pass", "warning", "fail") else "warning", "summary": svc._plain(d.get("summary")), "issues": issues,
            "unsupported_claims": _strs(d.get("unsupported_claims"), 10, 300), "missing_topics": _strs(d.get("missing_topics"), 8, 200), "edits": edits}


def apply_edits(body: str, edits: list[dict], primary: str, max_kw_removals: int = 0) -> tuple[str, list[dict]]:
    """Apply small exact text edits safely: the text to find must appear exactly once, inside one piece of text (never across HTML tags),
    the replacement is plain text, and an edit may not remove the primary keyword, except up to max_kw_removals times when the keyword is too dense.
    Returns (body, results)."""
    results = []
    removals = 0
    for e in edits:
        f, r = e.get("find", ""), e.get("replace", "")
        why = ""
        drops_kw = svc._has(f, primary) and not svc._has(r, primary)
        if not (15 <= len(f) <= 400) or not r or "<" in r or ">" in r:
            why = "not a usable edit"
        elif drops_kw and removals >= max_kw_removals:
            why = "would remove the primary keyword"
        elif not (0.4 <= len(r) / max(1, len(f)) <= 2.0):
            why = "changes too much at once"
        else:
            parts = re.split(r"(<[^>]+>)", body)
            editable = _body_text_parts(parts)  # body text only: never headings (the structure), links, code or the schema
            hits = [i for i in editable if html_unescape(parts[i]).count(f) == 1]
            total = sum(html_unescape(p).count(f) for p in parts if not p.startswith("<"))
            if total != 1 or len(hits) != 1:
                why = "text not found exactly once in the body text (headings are never edited)"
            else:
                i = hits[0]
                import html
                parts[i] = html.escape(html_unescape(parts[i]).replace(f, r), quote=False)  # stays valid HTML text
                body = "".join(parts)
                if drops_kw:
                    removals += 1
        results.append({**e, "applied": not why, "skipped_because": why})
    return body, results


_LOCKED = {"h1", "h2", "h3", "h4", "h5", "h6", "a", "script", "style", "code", "pre", "title"}


def _body_text_parts(parts: list[str]) -> list[int]:
    """Indexes of the text pieces that are not inside a heading, link, code or script."""
    depth, out = 0, []
    for i, p in enumerate(parts):
        if p.startswith("<"):
            m = re.match(r"<(/?)([a-zA-Z][a-zA-Z0-9]*)", p)
            if m and m.group(2).lower() in _LOCKED and not p.endswith("/>"):
                depth = max(0, depth + (-1 if m.group(1) else 1))
        elif p.strip() and depth == 0:
            out.append(i)
    return out


def html_unescape(s: str) -> str:
    import html
    return html.unescape(s)


# ── registry ─────────────────────────────────────────────────────────────────

STAGES = [  # (id, slash command, label, phase)
    ("brainstorm", "/brainstorm-content-ideas", "Brainstorm content ideas", "research"),
    ("search_intent", "/research-search-intent", "Search intent research", "research"),
    ("entities", "/research-entities", "Entity research", "research"),
    ("analyze_keyword", "/analyze-keyword", "Keyword analysis", "research"),
    ("opportunities", "/insights-opportunities", "Opportunities", "research"),
    ("content_gaps", "/insights-content-gaps", "Content gap analysis", "research"),
    ("competitors", "/context-competitors", "Competitor context", "research"),
    ("content_brief", "/write-content-brief", "Content brief", "research"),
    ("write_article", "/write-seo-article", "SEO article writing", "article"),
    ("meta_title", "/shorten-meta-title", "Meta title", "article"),
    ("meta_description", "/shorten-meta-description", "Meta description", "article"),
    ("expert", "/expert", "Expert review", "article"),
    ("human", "/human", "Human writing review", "article"),
    ("seo_expert", "/seo-expert", "SEO / AEO / GEO / SXO review", "article"),
]
RESEARCH_FUNCS = {"brainstorm": brainstorm, "search_intent": search_intent, "entities": entities, "analyze_keyword": analyze_keyword,
                  "opportunities": opportunities, "content_gaps": content_gaps, "competitors": competitors, "content_brief": content_brief}
RESEARCH_ORDER = [s[0] for s in STAGES if s[3] == "research"]
