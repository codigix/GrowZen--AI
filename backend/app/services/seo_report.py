"""SEO Quality Checklist for one blog article.

Two parts, kept apart on purpose:
  * measurable checks, worked out in Python from the article itself (character counts, keyword density and placement, paragraph
    lengths, heading hierarchy, FAQ count, required sections, brand mentions, contact details, schema structure, links);
  * a qualitative review by the AI (search intent, natural writing, repetition, factual accuracy, semantic relevance, E-E-A-T,
    readability, promotion relevance, usefulness), plus related queries, entities, People-Also-Ask questions, supporting queries and
    internal-link ideas. Its answer is checked before it is kept: statuses are limited to the known ones, and internal-link URLs are
    kept only when they are pages this business really has (its own published articles and website).

Every status is one of: pass | warning | fail | na. Nothing is marked "pass" without a check behind it; anything not checked is "na".
The report is stored in Article.stats["seo_report"] (an existing JSON column), so no migration is needed.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from urllib.parse import urlparse

from . import articles as svc

log = logging.getLogger("seo.report")

STATUSES = ("pass", "warning", "fail", "na")
DENSITY_TARGET = (1.0, 2.0)   # the brief's target
DENSITY_OK = (0.8, 2.5)       # outside this a warning
DENSITY_STUFFED = 4.0         # above this a failure
RESEARCH_NOTE = ("No live web search or competitor research was done for this report. Related queries, entities and People-Also-Ask "
                 "questions are AI suggestions from the article and its keywords, not search data; search volumes come only from Google "
                 "Keyword Planner where the keyword step showed them. No external sources were looked up.")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def body_hash(body: str) -> str:
    return hashlib.sha1(svc.strip_emphasis(body or "").encode("utf-8")).hexdigest()[:16]


def _c(group: str, cid: str, label: str, status: str, detail: str = "") -> dict:
    return {"group": group, "id": cid, "label": label, "status": status if status in STATUSES else "na", "detail": detail}


def _count(text: str, phrase: str) -> int:
    p = " ".join((phrase or "").split())
    if not p:
        return 0
    return len(re.findall(r"(?<!\w)" + re.escape(p).replace(r"\ ", r"\s+") + r"(?!\w)", text, re.I))


def _sentences(text: str) -> int:
    return len([s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if len(s.split()) >= 2])


def _domain(url: str | None) -> str:
    try:
        return (urlparse(url if "://" in (url or "") else f"https://{url}").hostname or "").lower().removeprefix("www.")
    except ValueError:
        return ""


def _section(body: str, heading_rx: str) -> tuple[str | None, str]:
    """(the H2 text, the HTML after it up to the next H2) for the first H2 matching heading_rx."""
    for m in re.finditer(r"<h2\b[^>]*>(.*?)</h2>", body, re.S | re.I):
        h = svc._text(m.group(1))
        if re.search(heading_rx, h, re.I):
            nxt = re.search(r"<h2\b", body[m.end():], re.I)
            return h, body[m.end(): m.end() + nxt.start()] if nxt else body[m.end():]
    return None, ""


# ── measurable checks ────────────────────────────────────────────────────────

def python_checks(*, title: str, meta: str, slug: str, body: str, primary: str, secondary: list[str], brand: str, b) -> list[dict]:
    out: list[dict] = []
    raw = body or ""
    schema_blocks = re.findall(r"<script\b[^>]*application/ld\+json[^>]*>([\s\S]*?)</script>", raw, re.I)
    visible = svc._SCHEMA_RE.sub("\n", raw)
    text = svc._text(visible)
    words = len(text.split())
    primary = " ".join((primary or "").split())
    secondary = [k for k in dict.fromkeys(" ".join(s.split()) for s in (secondary or [])) if k and k.lower() != primary.lower()]

    # Metadata
    g = "Metadata"
    tl = len(title or "")
    out.append(_c(g, "title_len", "SEO title length", "fail" if not tl or tl > svc.TITLE_MAX else "warning" if tl < 30 else "pass",
                  f"{tl} characters (30 to {svc.TITLE_MAX})"))
    out.append(_c(g, "title_kw", "Primary keyword in the SEO title", "pass" if title and svc._has(title, primary) else "fail"))
    ml = len(meta or "")
    out.append(_c(g, "meta_len", "Meta description length", "fail" if not ml or ml > svc.META_MAX else "warning" if ml < 120 else "pass",
                  f"{ml} characters (120 to {svc.META_MAX}; {svc.META_MAX} is the maximum)"))
    out.append(_c(g, "meta_kw", "Primary keyword in the meta description", "pass" if meta and svc._has(meta, primary) else "fail"))
    s = svc.slugify(slug or primary, 100)
    want = svc.slugify(primary, 100)
    out.append(_c(g, "slug_kw", "Primary keyword in the web address", "pass" if want and want in s else "warning", f"/{s}"))

    # Structure
    g = "Structure"
    levels = [int(x) for x in re.findall(r"<h([1-6])\b", visible, re.I)]
    h1 = levels.count(1)
    out.append(_c(g, "h1", "One H1 heading", "pass" if h1 == 1 else "fail" if h1 == 0 else "warning", f"{h1} H1 heading{'s' if h1 != 1 else ''}"))
    skips = sum(1 for a, c in zip(levels, levels[1:]) if c > a + 1)
    h2 = levels.count(2)
    out.append(_c(g, "hierarchy", "Heading hierarchy (H1 → H2 → H3, no skipped level)",
                  "pass" if not skips and h2 >= 4 else "warning", f"{h2} H2 and {levels.count(3)} H3 headings; {skips} skipped level{'s' if skips != 1 else ''}"))
    heads = [svc._text(h) for h in re.findall(r"<h[23]\b[^>]*>(.*?)</h[23]>", visible, re.S | re.I)]
    out.append(_c(g, "kw_heading", "Primary keyword in an H2/H3 heading", "pass" if any(svc._has(h, primary) for h in heads) else "warning",
                  "Where it reads naturally; never forced."))
    first_h2 = re.search(r"<h2\b", visible, re.I)
    intro = svc._text(visible[: first_h2.start()] if first_h2 else visible)
    h1m = re.search(r"<h1\b[^>]*>(.*?)</h1>", visible, re.S | re.I)
    if h1m:
        intro = intro.replace(svc._text(h1m.group(1)), "", 1).strip()
    out.append(_c(g, "intro_len", "Introduction of at least 500 characters", "pass" if len(intro) >= 500 else "warning" if intro else "fail", f"{len(intro)} characters"))
    out.append(_c(g, "intro_kw", "Primary keyword in the introduction", "pass" if svc._has(intro, primary) else "fail"))
    # SEO title and H1 consistent: the same text, or a Blog title (H1) with the same focus (both hold the primary keyword and share the topic)
    h1_text = svc._text(h1m.group(1)) if h1m else ""
    if not h1_text:
        out.append(_c(g, "h1_title", "SEO title and H1 are consistent", "fail", "No H1 heading."))
    else:
        from .seo_workflow.stages import _overlap
        same = h1_text.strip().lower() == (title or "").strip().lower()
        focus = svc._has(h1_text, primary) and svc._has(title or "", primary)
        out.append(_c(g, "h1_title", "SEO title and H1 are consistent",
                      "pass" if same or (focus and _overlap(h1_text, title or "") >= 0.4) else "warning" if focus else "fail",
                      "The H1 is the SEO title." if same else f"H1: “{h1_text}” · SEO title: “{title}”"))
    main_ok = svc.required_sections(body)["main_sections"]
    out.append(_c(g, "main_h2", "Required main H2 sections with content", "pass" if main_ok else "fail",
                  "At least two main H2 sections with paragraphs." if main_ok else "Fewer than two main H2 sections with content."))

    wh_h, wh_html = _section(visible, r"^(what|why|how|when|where)\b.*\?\s*$")
    if wh_h:
        ans = svc._text((re.search(r"<p\b[^>]*>(.*?)</p>", wh_html, re.S | re.I) or [None, ""])[1] or "")
        out.append(_c(g, "wh", "WH question section", "pass", wh_h))
        out.append(_c(g, "wh_len", "WH answer at most 750 characters", "pass" if 0 < len(ans) <= 750 else "fail", f"{len(ans)} characters"))
    else:
        out.append(_c(g, "wh", "WH question section", "fail", "No H2 that is a What/Why/How/When/Where question."))
        out.append(_c(g, "wh_len", "WH answer at most 750 characters", "na"))
    act_h, act_html = _section(visible, svc.ACTION_RE.pattern)
    out.append(_c(g, "act", "\"Don't wait\" section", "pass" if act_h else "fail", act_h or "Missing."))
    n_steps = len(re.findall(r"<li\b", act_html, re.I))
    out.append(_c(g, "act_steps", "\"Don't wait\" has 3 to 4 actionable steps", "na" if not act_h else "pass" if 3 <= n_steps <= 4 else "fail", f"{n_steps} steps" if act_h else ""))
    why_h, why_html = _section(visible, r"^why choose|^what to look for")  # neutral criteria when the business does not fit the topic
    n_reasons = len(re.findall(r"<li\b", why_html, re.I))
    out.append(_c(g, "why", "\"Why choose\" / evaluation criteria section with exactly 5 reasons", "pass" if why_h and n_reasons == 5 else "fail",
                  f"{why_h}: {n_reasons} reasons" if why_h else "Missing."))
    faq_h, faq_html = _section(visible, r"frequently asked|faq")
    n_faq = len(re.findall(r"<h3\b", faq_html, re.I))
    out.append(_c(g, "faq", "FAQ section with exactly 5 questions",
                  "pass" if faq_h and n_faq == 5 else "fail", f"{n_faq} questions" if faq_h else "No FAQ section."))
    cta = bool(re.search(r"<h2\b[^>]*>[^<]*(contact|get started|ready to|talk to|book|call)", visible, re.I))
    own_contacts = [x for x in (getattr(b, "phone", None), getattr(b, "website", None), getattr(b, "booking_url", None)) if x]
    has_contact = any(c in raw for c in own_contacts)
    out.append(_c(g, "cta", "Call to action with verified contact details",
                  "fail" if not cta else "pass" if has_contact or not own_contacts else "fail",
                  "" if cta and (has_contact or not own_contacts) else "No call to action." if not cta else "The CTA has none of the profile's contact details (phone, website, booking link)."))

    # Keywords
    g = "Keywords"
    uses = _count(text, primary)
    dens = uses * len(primary.split()) * 100 / words if words else 0.0
    st = "fail" if dens > DENSITY_STUFFED or uses == 0 else "pass" if DENSITY_OK[0] <= dens <= DENSITY_OK[1] else "warning"
    out.append(_c(g, "density", "Primary keyword density (target 1–2%)", st, f"{dens:.2f}% ({uses} uses in {words} words)"))
    used = [k for k in secondary if svc._has(text, k)]
    miss = [k for k in secondary if k not in used]
    out.append(_c(g, "secondary", "Secondary keyword coverage",
                  "na" if not secondary else "pass" if not miss else "warning",
                  f"{len(used)} of {len(secondary)} used" + (f"; not used: {', '.join(miss[:8])} (add only where it fits, never forced)" if miss else "")))
    cov = svc.paragraph_coverage(visible, primary, secondary)
    out.append(_c(g, "para_kw", "Paragraphs without a keyword (information only)", "na",
                  f"{len(cov['missing'])} of {cov['total']} paragraphs have no keyword. That is normal and not an SEO failure."))

    # Readability
    g = "Readability"
    paras = [svc._text(m.group(2)) for m in svc._P_RE.finditer(visible)]
    paras = [p for p in paras if len(p.split()) >= 12]  # leave out one-line labels such as "Your next steps"
    # the blog template: body paragraphs are full chunks of at least 500 characters; only very long ones (190+ words, 8+ sentences) are flagged
    long_w = sum(1 for p in paras if len(p.split()) > 190)
    long_s = sum(1 for p in paras if _sentences(p) > 8)
    out.append(_c(g, "chunks", "Paragraphs are readable chunks (500+ characters, not overly long)", "pass" if not (long_w or long_s) else "warning",
                  f"{len(paras)} paragraphs; {long_w} over 190 words, {long_s} over 8 sentences"))
    lists = len(re.findall(r"<(ul|ol)\b", visible, re.I))
    out.append(_c(g, "lists", "Scannable lists", "pass" if lists >= 2 else "warning", f"{lists} lists"))

    # Business and contact details
    g = "Business"
    if brand:
        nb = _count(text, brand)
        out.append(_c(g, "brand", "Business name mentioned", "pass" if nb >= 2 else "warning" if nb == 1 else "fail",
                      f"\"{brand}\" {nb} time{'s' if nb != 1 else ''}"))
    else:
        out.append(_c(g, "brand", "Business name mentioned", "na", "The business has no name set."))
    ph = svc.PLACEHOLDER.search(text) or re.search(r"\bX{4,}\b|\+91-?X", text)
    out.append(_c(g, "placeholders", "No placeholders such as [Business Email] or +91-XXXXXXXXXX", "fail" if ph else "pass",
                  f"Found: {ph.group(0)}" if ph else ""))
    own = re.sub(r"\D", "", getattr(b, "phone", "") or "")[-9:]
    numbers = {re.sub(r"\D", "", n)[-9:] for n in re.findall(r"(?<!\d)(?:\+?\d[\d\s().-]{8,}\d)(?!\d)", text)}
    foreign = sorted(n for n in numbers if len(n) >= 9 and n != own)
    out.append(_c(g, "contacts", "Contact details come from the business profile", "fail" if foreign else "pass",
                  "Phone numbers not in the profile: " + ", ".join(foreign) if foreign else "Only the profile's phone number is used." if own and own in numbers else ""))
    claims = svc.unsupported_claims(title or "", meta or "", visible, [primary, *secondary])
    out.append(_c(g, "claims", "No unsupported numbers or claims", "warning" if claims else "pass", "; ".join(claims[:6])))

    # Schema
    g = "Schema"
    out.extend(_schema_checks(g, schema_blocks, n_faq))

    # Links
    g = "Links"
    site = _domain(getattr(b, "website", None))
    hrefs = [h for h in re.findall(r"<a\b[^>]*href=[\"']([^\"']+)[\"']", visible, re.I) if h.startswith(("http", "/"))]
    internal = [h for h in hrefs if h.startswith("/") or (site and _domain(h) == site)]
    external = [h for h in hrefs if h not in internal]
    out.append(_c(g, "internal", "Internal links to your own pages", "pass" if len(internal) >= 2 else "warning",
                  f"{len(internal)} internal link{'s' if len(internal) != 1 else ''} (the CTA counts). See the suggestions below."))
    out.append(_c(g, "external", "External authoritative references", "pass" if external else "na",
                  f"{len(external)} external link{'s' if len(external) != 1 else ''}" if external else "None. No sources were researched, so none were added; add references you have checked yourself."))
    return out


def _schema_checks(g: str, blocks: list[str], n_faq: int) -> list[dict]:
    if not blocks:
        return [_c(g, "schema", "JSON-LD structured data", "fail", "No JSON-LD block.")]
    items: list[dict] = []
    for raw in blocks:
        try:
            d = json.loads(raw)
        except ValueError as exc:
            return [_c(g, "schema", "JSON-LD structured data", "fail", f"Not valid JSON: {exc}")]
        for x in (d.get("@graph") if isinstance(d, dict) and "@graph" in d else d if isinstance(d, list) else [d]):
            if isinstance(x, dict):
                items.append(x)
    types = {(x.get("@type") if isinstance(x.get("@type"), str) else "") for x in items}
    out = [_c(g, "schema", "JSON-LD structured data", "pass", ", ".join(sorted(t for t in types if t)))]
    bp = next((x for x in items if x.get("@type") in ("BlogPosting", "Article")), None)
    if not bp:
        out.append(_c(g, "blogposting", "BlogPosting schema", "fail", "No BlogPosting item."))
    else:
        need = [k for k in ("headline", "description", "author", "publisher") if not bp.get(k)]  # datePublished is added when it goes live
        long_head = len(str(bp.get("headline") or "")) > 110
        out.append(_c(g, "blogposting", "BlogPosting schema", "warning" if need or long_head else "pass",
                      ("Missing: " + ", ".join(need) + ". " if need else "") + ("The headline is over 110 characters." if long_head else "")))
    fp = next((x for x in items if x.get("@type") == "FAQPage"), None)
    if not fp:
        out.append(_c(g, "faqpage", "FAQPage schema", "fail" if n_faq else "na", "No FAQPage item." if n_faq else "The article has no FAQs."))
    else:
        qs = [q for q in (fp.get("mainEntity") or []) if isinstance(q, dict)]
        ok = [q for q in qs if q.get("@type") == "Question" and q.get("name") and isinstance(q.get("acceptedAnswer"), dict) and q["acceptedAnswer"].get("text")]
        out.append(_c(g, "faqpage", "FAQPage schema matches the FAQs",
                      "pass" if ok and len(ok) == len(qs) == n_faq else "warning",
                      f"{len(ok)} valid questions in the schema, {n_faq} in the article"))
    return out


# ── AI review ────────────────────────────────────────────────────────────────

AI_ITEMS = [  # id -> label shown in the checklist
    ("search_intent", "Matches the search intent"),
    ("natural_writing", "Natural, human writing (no generic AI wording)"),
    ("repetition", "No repetition or filler"),
    ("factual_accuracy", "Factual accuracy"),
    ("semantic_relevance", "Semantic relevance (entities, synonyms, related topics)"),
    ("eeat", "E-E-A-T (experience, expertise, authority, trust)"),
    ("readability", "Readability"),
    ("promotion", "Company promotion is relevant, not pushy"),
    ("usefulness", "Every section is complete and useful"),
]


def _own_pages(db, a, b) -> list[dict]:
    """Pages this business really has: its live articles (their real addresses) and its website. Only these may be linked."""
    from ..models import Article
    pages: list[dict] = []
    if getattr(b, "website", None):
        pages.append({"title": f"{b.name} home page", "url": b.website})
    q = db.query(Article).filter(Article.business_id == b.id, Article.id != a.id, Article.status == "completed")
    for x in q.order_by(Article.id.desc()).limit(60):
        url = x.wp_url if x.wp_status == "publish" else x.react_url if x.react_status == "publish" else None
        if url and x.title:
            pages.append({"title": x.title, "url": url})
    return pages


def ai_review(*, title: str, meta: str, body: str, primary: str, secondary: list[str], brand: str, b, pages: list[dict]) -> dict:
    text = svc._text(svc._SCHEMA_RE.sub("\n", body or ""))[:40000]
    from .seo_workflow.master_prompt import template_block
    prompt = "\n".join([
        *template_block(brand),  # the blog template the article was written to: judge it against this
        "You review ONE blog article for SEO, AEO, GEO, SXO and E-E-A-T. Be strict and honest: do not mark something as pass unless the article earns it.",
        "You have NO web access: never claim to have researched competitors, search volumes or rankings.",
        f'Primary keyword: "{primary}". Secondary keywords: {json.dumps(secondary)}. Business: {brand}.',
        "Business profile (the only facts about the company that are true):", svc.ai.profile_text(b), "",
        f"SEO title: {title}", f"Meta description: {meta}", "Article text:", text, "",
        "Pages this business really has (for internal links; use ONLY these URLs, never invent one):",
        *([f"- {p['title']}: {p['url']}" for p in pages] or ["- (none)"]), "",
        "Answer with ONE JSON object:",
        '{"search_intent_type": "informational|commercial|transactional|local|navigational",',
        ' "related_queries": [5 to 10 related searches], "long_tail": [5 to 10 long-tail keyword phrases],',
        ' "entities": [5 to 12 relevant entities/concepts], "synonyms": [3 to 10 synonyms or variants of the primary keyword],',
        ' "paa": [4 to 8 People-Also-Ask style questions], "supporting_queries": [5 to 10 queries for future supporting articles],',
        ' "internal_links": [{"anchor": "anchor text found or fitting in the article", "url": "one of the URLs above or empty", "page_idea": "what page to link to or create"}],',
        ' "claims_to_verify": [statements in the article a person should check before publishing],',
        ' "review": {' + ", ".join(f'"{k}": {{"status": "pass|warning|fail", "note": "one sentence"}}' for k, _ in AI_ITEMS) + "}}",
        'Rules for "review": factual_accuracy is "warning" when there are claims to verify, "fail" when something is clearly wrong;'
        ' eeat judges real experience, specific expertise and trust signals that are actually in the text; promotion is "fail" when the business is pushed without relevance.',
    ])
    d = svc._json(prompt, num_predict=2600, timeout=150)
    if not d:
        raise RuntimeError("The AI review did not answer usably. Try again.")

    def strs(key: str, hi: int = 12) -> list[str]:
        v = d.get(key) if isinstance(d.get(key), list) else []
        return [svc._plain(x) for x in v if isinstance(x, (str, int, float)) and svc._plain(x)][:hi]

    allowed = {p["url"].rstrip("/") for p in pages}
    links = []
    for x in d.get("internal_links") or []:
        if not isinstance(x, dict) or not svc._plain(x.get("anchor")):
            continue
        url = str(x.get("url") or "").strip()
        links.append({"anchor": svc._plain(x.get("anchor")), "page_idea": svc._plain(x.get("page_idea")),
                      "url": url if url.rstrip("/") in allowed else "",  # unverified URLs are dropped: anchor text only
                      "verified": url.rstrip("/") in allowed})
    review = d.get("review") if isinstance(d.get("review"), dict) else {}
    checks = []
    for k, label in AI_ITEMS:
        r = review.get(k) if isinstance(review.get(k), dict) else {}
        st = str(r.get("status") or "").lower()
        checks.append(_c("AI review", k, label, st if st in ("pass", "warning", "fail") else "na", svc._plain(r.get("note")) or ("Not reviewed." if st not in STATUSES else "")))
    claims = strs("claims_to_verify", hi=10)
    for c in checks:  # a factual "pass" with claims still to check is not a pass
        if c["id"] == "factual_accuracy" and c["status"] == "pass" and claims:
            c["status"], c["detail"] = "warning", (c["detail"] + " " if c["detail"] else "") + f"{len(claims)} statement(s) to verify."
    intent = str(d.get("search_intent_type") or "").lower()
    return {
        "checked_at": _now(), "body_hash": body_hash(body),
        "search_intent": intent if intent in {"informational", "commercial", "transactional", "local", "navigational"} else "",
        "related_queries": strs("related_queries"), "long_tail": strs("long_tail"), "entities": strs("entities"),
        "synonyms": strs("synonyms", hi=10), "paa": strs("paa", hi=8), "supporting_queries": strs("supporting_queries", hi=10),
        "internal_links": links[:10], "claims_to_verify": claims, "checks": checks,
    }


# ── the whole report ─────────────────────────────────────────────────────────

def _is_live(a) -> bool:
    return bool((a.wp_post_id or a.wp_url) and a.wp_status != "deleted") or bool(a.react_post_id and a.react_status != "deleted")


def _slug_clash(db, a) -> str | None:
    """Another blog of this business already uses this article's address (its set slug, or the end of its live post URL). A live post keeps its
    address and is not checked."""
    from sqlalchemy import select
    from ..models import Article
    if _is_live(a):
        return None
    s = (svc.explicit_slug(a) or "").lower()
    if not s:
        return None
    for o in db.scalars(select(Article).where(Article.business_id == a.business_id, Article.id != a.id)):
        used = {(o.slug or "").lower()}
        if _is_live(o):
            used |= {(urlparse(u or "").path.rstrip("/").rsplit("/", 1)[-1] or "").lower() for u in (o.wp_url, o.react_url)}
        if s in used:
            return f"The URL slug /{s}/ is already used by “{o.title or o.keyword}”."
    return None


def build(db, a, b, *, with_ai: bool, previous: dict | None = None) -> dict:
    """The checklist for the article as it is saved now. with_ai=False keeps the last AI review (marked stale when the text changed since)."""
    brand = svc.brand_of(b)
    title, meta, body = a.title or "", a.meta_description or "", a.body or ""
    checks = python_checks(title=title, meta=meta, slug=a.slug or "", body=body, primary=a.keyword, secondary=a.secondary_keywords or [], brand=brand, b=b)
    ai = (previous or {}).get("ai")
    ai_error = ""
    if with_ai:
        try:
            ai = ai_review(title=title, meta=meta, body=body, primary=a.keyword, secondary=a.secondary_keywords or [], brand=brand, b=b, pages=_own_pages(db, a, b))
        except Exception as exc:  # noqa: BLE001 - the measurable checks are still worth showing
            log.warning("AI review failed for article %s: %s", a.id, exc)
            ai_error = str(exc)[:300]
    # URL slug: free (no other blog of this business uses it); a live post keeps its address and is not checked
    try:
        clash = _slug_clash(db, a) if db is not None and getattr(a, "id", None) else None
        checks.insert(5, _c("Metadata", "slug_free", "URL slug is available", "fail" if clash else "pass", clash or f"/{svc.explicit_slug(a) or svc.slugify(a.keyword)}/"))
    except Exception:  # noqa: BLE001 - the availability check must never break the report
        log.warning("Slug check failed for article %s", getattr(a, "id", None), exc_info=True)
    # Business relevance: "Why choose <business>" only when the business really offers the topic (decided when the article was written)
    why_h = next((c["detail"].split(":")[0] for c in checks if c["id"] == "why" and c["detail"]), "")
    relevant = (a.stats or {}).get("business_relevant")
    if relevant is False:
        checks.append(_c("Business", "relevance", "Business relevance is honest", "fail" if why_h.lower().startswith("why choose") else "pass",
                         "The business does not offer this topic, but the article has a “Why Choose” section." if why_h.lower().startswith("why choose")
                         else "The business does not offer this topic: neutral informational heading, the business is not presented as the provider."))
    elif relevant is True:
        checks.append(_c("Business", "relevance", "Business relevance is honest", "pass", "The business offers what the article is about."))
    stale = bool(ai) and ai.get("body_hash") != body_hash(body)
    n = len(ai.get("supporting_queries") or []) if ai else 0
    checks.append(_c("Research", "supporting", "5 to 10 supporting search queries", "na" if not ai else "pass" if 5 <= n <= 10 else "warning",
                     "Run the AI review." if not ai else f"{n} queries"))
    checks.append(_c("Research", "research", "Research transparency", "na", RESEARCH_NOTE))
    if ai:
        checks.extend(ai["checks"])
    else:
        checks.append(_c("AI review", "ai", "Qualitative review (intent, writing, facts, E-E-A-T…)", "na", ai_error or "Not run yet: click Run AI review."))
    summary = {s: sum(1 for c in checks if c["status"] == s) for s in STATUSES}
    blocking = blocking_issues(checks, ai_stale=stale)
    return {"checked_at": _now(), "checks": checks, "summary": summary, "ai": ai, "ai_stale": stale, "ai_error": ai_error, "research_note": RESEARCH_NOTE,
            "blocking": blocking, "ready": not blocking}


# Mandatory requirements: a "fail" here keeps the article from being marked ready to publish. Each has the correction to make.
MANDATORY_FIX = {
    "title_len": "Shorten the SEO title to at most 60 characters (Meta title stage → Run again, or edit the SEO title).",
    "title_kw": "Put the exact primary keyword into the SEO title.",
    "meta_len": "Write a meta description of 120 to 160 characters (Meta description stage → Run again, or edit it).",
    "meta_kw": "Put the exact primary keyword into the meta description.",
    "slug_free": "Change the web address (slug) in the editor to one no other blog uses, e.g. add -guide or -tips.",
    "h1": "Add one H1 heading: the Blog title at the top of the article.",
    "h1_title": "Make the Blog title (H1) about the same thing as the SEO title, with the primary keyword in both.",
    "main_h2": "Regenerate the article (or add at least two main H2 sections with paragraphs).",
    "intro_kw": "Use the primary keyword in the first paragraph of the introduction.",
    "wh": "Add an H2 that is a What/Why/How/When/Where question, with a direct answer.",
    "wh_len": "Shorten the WH answer to at most 750 characters.",
    "act": "Add the \"Don't Wait to Seek Help\" section.",
    "act_steps": "Give the \"Don't Wait\" section 3 to 4 short, actionable next steps.",
    "why": "The \"Why Choose\" section needs exactly 5 reasons taken from the business profile (or 5 neutral criteria when the business does not offer the topic).",
    "faq": "The FAQ section needs exactly 5 relevant questions with direct answers (FAQ → Regenerate).",
    "cta": "End with a call to action that uses the business's real phone, website or booking link from the profile.",
    "placeholders": "Replace the placeholder with the real detail from the business profile, or remove it.",
    "contacts": "Remove phone numbers that are not the business's own (the profile's phone number only).",
    "relevance": "Change the \"Why Choose\" heading to a neutral one (e.g. \"What to Look For When Choosing …\") and do not present the business as the provider.",
    "schema": "Save the article again to rebuild the JSON-LD block.",
    # the AI review: only a clear "fail" blocks (a warning is advice)
    "factual_accuracy": "Correct or remove the statements the review marked as wrong (see \"Claims to verify\").",
    "promotion": "Tone down the promotion: mention the business only where it is relevant to the topic.",
}


def blocking_issues(checks: list[dict], ai_stale: bool = False) -> list[dict]:
    """The mandatory requirements that fail, each with the correction to make (empty = ready to publish)."""
    out = []
    for c in checks:
        if c["status"] == "fail" and c["id"] in MANDATORY_FIX:
            if c["group"] == "AI review" and ai_stale:
                continue  # an AI verdict about an older version of the text does not block
            out.append({"id": c["id"], "label": c["label"], "detail": c["detail"], "fix": MANDATORY_FIX[c["id"]]})
    return out


def save(db, a, report: dict) -> None:
    a.stats = {**(a.stats or {}), "seo_report": report}  # a new dict, so SQLAlchemy sees the JSON change
