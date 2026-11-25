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


# The user's blog template: the FIRST thing in every blog prompt, for every business and every website. [company_clientname] is
# replaced with the business's name. The notes after it only keep it honest (real contact details, no invented testimonials).
BLOG_TEMPLATE = """BLOG TEMPLATE (always follow it):
Workflow: /brainstorm-content-ideas, /research-search-intent, /research-entities, /analyze-keyword, /insights-opportunities, /insights-content-gaps,
/write-seo-article, /write-content-brief, /shorten-meta-title, /shorten-meta-description, /context-competitors, /seo-expert, /expert, /human
[Enter blog-title, search-intent, primary & secondary keywords]

Blog Structure:
1. Title - H1: Write a clear, SEO-optimized title here (under 60 characters, containing exact primary keyword)
2. Introduction: Detailed introduction divided into chunks (approximately 400 to 500 words in chunks).
   Begin with a compelling opening that highlights the blog's topic, relevance, and how it helps the reader. Use location-based keywords where necessary. Mention [company_clientname] in bold.
3. H2
   Section content: approximately 500 words divided into readable paragraph chunks (minimum 2 to 3 chunks):
   - Chunk 1: continue elaborating on the topic. Provide useful insights or background information.
   - Chunk 2: expand on the subtopic, add examples, tips, or data to support the information.
4. H2
   Section content: approximately 500 words divided into readable paragraph chunks:
   - Introduce the next angle or perspective of the topic, comparing options and practical advice. Include relevant keywords.
5. H2 - Why Questions - Write WH Question (What, Why, How, When, Where, etc.)
   WH Answer - (Maximum 750 characters): give a precise and informative answer. Stay concise while ensuring clarity.
6. Don't Wait to Seek Help
   Encourage readers to take timely action for their concern. Use empathetic language. Include scannable next steps.
7. Why Choose [company_clientname]?
   List 5 strong reasons with short explanations – credibility, experience, testimonials, etc.
8. FAQs
   Q1: [Insert Question]
   A1: [Insert Answer]
   Q2: [Insert Question]
   A2: [Insert Answer]
   (Add most relevant 5 FAQs based on the blog topic and SEO keywords. Mention [company_clientname] in bold in most of the FAQs.)
9. CTA – Call To Action
   Strong and clear CTA with contact info, appointment link, or location. Use verified business details from the profile; where phone or booking link is not yet set in profile, provide draft placeholders (e.g. 📞 Call Now: +91-XXXXXXXXXX or [Add Phone Number], 📅 Book Appointment: [Appointment Link]) for the user to add.

Now prepare a blog for the given information, and also prepare a meta-title, meta-description, and slug-url.
Use most relevant secondary keywords and synonyms.
Prepare AEO, GEO, SEO, and SXO optimized content.
Add bullet points or numbering if required.
Primary keyword must be in subheadings as well but not forcefully yet naturally.
Note: The Primary keyword is a focused keyword, so mention this keyword in the meta title, description, and URL.
All content must be in readable chunks (approximately 500 words per section divided into chunks).
Meta title - under 60 characters.
Meta description - under 160 characters.
Keyword Density: about 2%.
Bold the primary keyword and secondary keywords when they appear (bold text only, no background color highlighting).
Add [company_clientname] in bold, in intro part and in most of the FAQs, naturally, not forcefully."""


def template_block(brand: str) -> list[str]:
    return [resolve_client(BLOG_TEMPLATE, brand), ""]


def content_rules(primary: str, brand: str, location: str = "") -> list[str]:
    return [
        *template_block(brand),  # the user's template comes first, in every prompt
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
        "- CHUNKS: content is presented in readable paragraph chunks (each main section approximately 500 words divided into chunks of 3 to 5 sentences each) that develop complete points and can be read and quoted easily.",
        "- Add bullets or numbered steps only where they are genuinely needed; explanations are written as paragraphs.",
        f'- Primary keyword in the H2 subheadings naturally (not forced in every one).',
        "- Do NOT invent statistics, testimonials, certifications, company achievements, contact details, prices or research findings. No exaggerated marketing claims, no fear-based selling.",
        "- Adapt headings and wording to the topic and its industry; never reuse wording from an unrelated industry.",
        "- A caveat such as \"confirm with the store/provider\" or \"check current prices\" appears at most ONCE in the whole article; do not end sections with it.",
        "",
        "KEYWORDS & BOLDING (NO BACKGROUND HIGHLIGHTS):",
        f'- Primary keyword "{primary}": naturally in bold (<strong>), in the SEO title, the meta description, the introduction, relevant H2/H3 headings and throughout the article.',
        "- Secondary keywords: use them in bold (<strong>) where they fit naturally; never in unrelated content.",
        f'- Keyword density about 2% for "{primary}" (roughly once or twice per 100 words), spread evenly. Elsewhere use synonyms and pronouns.',
        "- Bold only: primary and secondary keywords and the business name are bold text only; do NOT use background color highlights.",
        f'- Business name "{brand}": mention in bold (<strong>) naturally in the introduction, in most of the FAQ answers, in Why Choose and the CTA.',
        "",
        "SEO / AEO / GEO / SXO:",
        "- SEO: match the search intent; clear heading hierarchy; natural keyword spread.",
        "- AEO: answer questions directly, at the start of the section; concise explanations a search snippet or AI answer can quote.",
        "- GEO: clear definitions, factual explanations, relevant entities and context" + (f"; the location {location} where it is relevant." if location else "."),
        "- SXO: readable chunks, clear hierarchy, useful examples, scannable lists, a helpful path for the reader, a relevant non-intrusive call to action.",
        "",
        "BUSINESS:",
        f'- Keep the article informative, not promotional. Mention "{brand}" naturally in the introduction, in most of the FAQ answers (where it fits the question),'
        ' the "Why choose" section and the call to action; not in every body paragraph, and never forced.',
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
