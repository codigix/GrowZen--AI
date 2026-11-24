"""The ONE central master SEO content prompt. Every stage and every part of the article writer builds its prompt from here,
so the rules are defined once.

    content_rules(...)   the standing content rules (role, workflow, style, keywords, SEO/AEO/GEO/SXO, business, metadata)
    inputs_block(...)    the article's inputs: title, keywords, intent, business, profile, audience, location, length,
                         competitor research (or a clear "not available"), the user's own writing instructions
    resolve_client(...)  replaces the [company_clientname] variable with the selected business's name
"""
from __future__ import annotations

import re

CLIENT_VAR = "[company_clientname]"
TITLE_MAX = 60
META_MAX = 160
LENGTH_WORDS = {"short": "about 850 words", "standard": "about 2,000 words", "long": "about 2,500 words"}


def resolve_client(text: str, brand: str) -> str:
    """[company_clientname] (any case, with or without spaces/underscores) -> the business's name."""
    return re.sub(r"\[\s*company[\s_-]*client[\s_-]*name\s*\]", brand or "the business", text or "", flags=re.I)


def content_rules(primary: str, brand: str, location: str = "") -> list[str]:
    return [
        "ROLE: you are an expert SEO content strategist, AEO, GEO and SXO specialist, semantic SEO researcher and human-like blog writer.",
        "",
        "WORKFLOW (think it through before writing): understand the primary keyword and its search intent; the questions readers ask; the relevant entities,"
        " concepts, synonyms and secondary keywords; then a logical outline; then natural writing; then a review for stuffing, repetition, grammar, facts and flow.",
        "Never claim to have researched competitors, search volumes or rankings beyond the research data given to you.",
        "",
        "WRITING STYLE:",
        "- Write naturally, like an experienced human writer: no robotic, repetitive or generic AI wording.",
        "- Simple, professional, conversational English; informative and trustworthy; explain technical ideas simply, with practical examples.",
        "- No unnecessary introductions or repetitive conclusions; logical connections between sections; never repeat a point already made.",
        "- CHUNKS: short, meaningful paragraphs of 2 to 4 sentences, each one complete point that can be read and quoted on its own.",
        "- Use bullets or numbered steps where they make it easier to read.",
        "- Do NOT invent statistics, testimonials, certifications, company achievements, contact details, prices or research findings. No exaggerated marketing claims, no fear-based selling.",
        "- Adapt headings and wording to the topic and its industry; never reuse wording from an unrelated industry.",
        "",
        "KEYWORDS:",
        f'- Primary keyword "{primary}": naturally in the SEO title, the meta description, the introduction, relevant H2/H3 headings and throughout the article.',
        "- Secondary keywords: use them, plus long-tail phrases, related search questions, synonyms and related entities, where they fit the section; never in unrelated content.",
        f'- Keyword density about 1 to 2% for "{primary}" as a target, not a requirement: roughly once per 100 words. Elsewhere use synonyms, pronouns and related'
        " terms instead of repeating it. Never force a keyword into a heading or a sentence where it reads badly.",
        "",
        "SEO / AEO / GEO / SXO:",
        "- SEO: match the search intent; clear heading hierarchy; natural keyword spread.",
        "- AEO: answer questions directly, at the start of the section; concise explanations a search snippet or AI answer can quote.",
        "- GEO: clear definitions, factual explanations, relevant entities and context" + (f"; the location {location} where it is relevant." if location else "."),
        "- SXO: readable chunks, clear hierarchy, useful examples, scannable lists, a helpful path for the reader, a relevant non-intrusive call to action.",
        "",
        "BUSINESS:",
        f'- Keep the article informative, not promotional. Mention "{brand}" only in the introduction (once), the "Why choose" section, the call to action and at most'
        " ONE FAQ answer; never in the main body sections, and never as an example or case of the topic.",
        "- Only claim what the business profile states. If information is missing, leave it out; never make up details.",
        *([f"- The business is in {location}: mention it only where location matters to the reader; never an address or area the profile does not give."] if location else []),
        "",
        f"METADATA: SEO title at most {TITLE_MAX} characters, meta description at most {META_MAX} characters (ideally 120 to {META_MAX}), both containing the exact primary keyword.",
    ]


def inputs_block(inp: dict, *, brand: str, profile: str, location: str, competitors: dict | None) -> list[str]:
    """The article's inputs, the same for every stage. inp: title, primary, secondary, intent, audience, length, instructions."""
    comp = competitors or {}
    if comp.get("available") and comp.get("results"):
        comp_lines = [f"- {r.get('title', '')} ({r.get('url', '')}): " + "; ".join((r.get("headings") or [])[:10]) for r in comp["results"][:5]]
    else:
        comp_lines = ["- Not available: no competitor pages were analysed. Do not claim any competitor findings."]
    return [
        "ARTICLE INPUTS:",
        f"- Blog title: {inp.get('title') or '(not chosen yet)'}",
        f"- Primary keyword: {inp.get('primary')}",
        f"- Secondary keywords: {', '.join(inp.get('secondary') or []) or '(none)'}",
        f"- Search intent: {inp.get('intent') or '(to be determined)'}",
        f"- Business name ({CLIENT_VAR}): {brand}",
        f"- Target audience: {inp.get('audience') or '(to be determined from the topic)'}",
        f"- Location: {location or '(not set)'}",
        f"- Article length: {LENGTH_WORDS.get(inp.get('length') or 'standard', LENGTH_WORDS['standard'])}",
        "- Business profile (the only true facts about the business):", profile or "(empty)",
        "- Competitor research:", *comp_lines,
        *(["- The user's writing instructions (follow them):", resolve_client(inp["instructions"], brand)] if (inp.get("instructions") or "").strip() else []),
    ]
