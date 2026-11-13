"""The exact solution for a fix task: what to change, the ready-to-paste code or text for THIS site, where to put it for ITS web server or platform, and how to confirm it.

Two kinds of building block, used where each is better:
  - deterministic builders for everything that must be exactly right (security headers for nginx / Apache / Netlify / Vercel / Cloudflare, JSON-LD built from the real profile,
    robots.txt lines, a sitemap from the crawled pages, llms.txt, listing details to paste): no AI, no invented facts;
  - AI for wording that needs the business's voice (page titles and descriptions, FAQ answers, a direct-answer paragraph, service names), grounded in the profile with the platform's rules.
A solution is a dict: {title, minutes, summary, audience, stack, steps, blocks:[{label, where, lang, text}], check, needs_ai, ai_used}. It is cached on the task and rebuilt on request.
Nothing here changes anything: the person (or their developer) applies it, then the task's real check decides whether it counts.
"""
import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, CatalogItem, ChatGPTBusiness, GrowthAction
from . import ai

HEADER_VALUES = {
    "hsts": ("Strict-Transport-Security", "max-age=31536000; includeSubDomains"),
    "x_frame_options": ("X-Frame-Options", "SAMEORIGIN"),
    "x_content_type_options": ("X-Content-Type-Options", "nosniff"),
    "referrer_policy": ("Referrer-Policy", "strict-origin-when-cross-origin"),
    "permissions_policy": ("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)"),
}
WEBSITE_KEYS = ("fix.security.", "fix.xray.", "fix.site.", "fix.onpage.", "fix.kw.use.website", "fix.kw.use.alt", "fix.chatgpt.jsonld")


class SolutionError(Exception):
    pass


# ------------------------------------------------------------------------------------------------------------------- the site's stack
def stack_of(report: dict[str, Any] | None, website: str | None = None) -> dict[str, Any]:
    """What serves the site and what it is built with, from the live X-Ray. A technology seen only in a file loaded from ANOTHER website (a copied image path, an embedded widget) is ignored."""
    tech = (report or {}).get("tech") or {}
    host = (urlsplit(website or (report or {}).get("final_url") or "").hostname or "").lower().removeprefix("www.")
    server = (tech.get("server") or "").lower()
    web = next((n for n in ("nginx", "apache", "litespeed", "microsoft-iis", "cloudflare", "vercel", "netlify", "github.com") if n in server), "")
    cdn = " ".join(tech.get("cdn") or []).lower()
    if not web and "cloudflare" in cdn:
        web = "cloudflare"
    own = []
    for d in tech.get("detected") or []:
        via = str(d.get("via") or "")
        m = re.search(r"https?://([^/\s]+)", via)
        if m and host and m.group(1).lower().removeprefix("www.") != host and not m.group(1).lower().endswith("." + host):
            continue  # seen only in a file from another website
        own.append(str(d.get("name") or "").lower())
    frameworks = [f.lower() for f in tech.get("frameworks") or []]
    platform = next((p for p in ("wordpress", "shopify", "wix", "squarespace", "webflow", "magento", "joomla", "drupal", "ghost") if p in own), "")
    if not platform and ("next.js" in own or "next.js" in frameworks):
        platform = "next"
    if not platform and ("react" in own or "react" in frameworks or "vite" in own or "vite" in frameworks or "vue" in frameworks or "angular" in frameworks):
        platform = "spa"
    label = {"spa": "a React/Vite single-page app", "next": "Next.js", "wordpress": "WordPress"}.get(platform, platform.title() if platform else "your website")
    return {"server": web or "unknown", "server_raw": tech.get("server") or "", "platform": platform or "unknown", "label": label, "analytics": [a.lower() for a in tech.get("analytics") or []],
            "note": f"{label} on {tech.get('server') or 'an unknown server'}" if (platform or web) else "The server and platform could not be identified: all common options are shown."}


# ------------------------------------------------------------------------------------------------------------------- security headers
def _csp(stack: dict[str, Any]) -> str:
    ga = any("google" in a for a in stack.get("analytics", []))
    script = "'self'" + (" https://www.googletagmanager.com" if ga else "")
    connect = "'self'" + (" https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com" if ga else "")
    return (f"default-src 'self'; script-src {script}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data: https:; connect-src {connect}; "
            "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests")


def _header_blocks(stack: dict[str, Any], pairs: list[tuple[str, str]]) -> list[dict[str, str]]:
    web = stack["server"]
    nginx = "\n".join(f'add_header {n} "{v}" always;' for n, v in pairs)
    apache = "<IfModule mod_headers.c>\n" + "\n".join(f'    Header always set {n} "{v}"' for n, v in pairs) + "\n</IfModule>"
    netlify = "/*\n" + "\n".join(f"  {n}: {v}" for n, v in pairs)
    vercel = json.dumps({"headers": [{"source": "/(.*)", "headers": [{"key": n, "value": v} for n, v in pairs]}]}, indent=2)
    cloudflare = "\n".join(f"Set static   {n}   =   {v}" for n, v in pairs)
    options = {
        "nginx": {"label": "nginx: inside the server { } block that serves HTTPS", "where": "/etc/nginx/sites-enabled/<your-site>  (then: sudo nginx -t && sudo systemctl reload nginx)", "lang": "nginx", "text": nginx},
        "apache": {"label": "Apache / LiteSpeed: .htaccess in the site's web root", "where": ".htaccess (needs mod_headers)", "lang": "apache", "text": apache},
        "netlify": {"label": "Netlify: a file named _headers in the published folder", "where": "public/_headers", "lang": "text", "text": netlify},
        "vercel": {"label": "Vercel: vercel.json", "where": "vercel.json in the project root, then redeploy", "lang": "json", "text": vercel},
        "cloudflare": {"label": "Cloudflare: Rules → Transform Rules → Modify Response Header", "where": "Cloudflare dashboard → your domain → Rules", "lang": "text", "text": cloudflare},
    }
    order = {"nginx": ["nginx"], "apache": ["apache"], "litespeed": ["apache"], "vercel": ["vercel"], "netlify": ["netlify"], "cloudflare": ["cloudflare", "nginx"]}.get(web)
    keys = order or ["nginx", "apache", "cloudflare", "netlify", "vercel"]
    return [options[k] for k in keys]


def headers_solution(key: str, stack: dict[str, Any]) -> dict[str, Any]:
    short = key.rsplit(".", 1)[-1]
    if short == "csp":
        pairs = [("Content-Security-Policy", _csp(stack))]
        extra = ["Deploy it as Content-Security-Policy-Report-Only first (same value, header name changed) for a day, open the site and check the browser console for blocked resources, add any legitimate ones to the policy, then switch to the enforcing header above.",
                 "Never add 'unsafe-eval' or a wildcard script source to make a warning disappear: that removes the protection."]
        minutes = 25
    else:
        pairs = [HEADER_VALUES[short]]
        extra = ["HSTS tells browsers to use HTTPS only for a year: make sure the whole site (and its subdomains) works on HTTPS before adding it."] if short == "hsts" else []
        minutes = 10
    blocks = _header_blocks(stack, pairs)
    steps = [f"Open the place shown below for your server ({stack['note']}).", "Paste the lines exactly as shown. If your nginx location blocks set their own add_header, repeat the lines there (add_header is not inherited when a block sets its own)." if stack["server"] == "nginx" else "Paste the lines exactly as shown and save.",
             "Reload / redeploy, then press “Check now”: the live site is read again."] + extra
    return {"title": f"Add the {pairs[0][0]} header", "minutes": minutes, "summary": f"One header line that only strengthens security: {pairs[0][0]}.", "audience": "developer", "steps": steps, "blocks": blocks,
            "check": f"The live homepage sends {pairs[0][0]}."}


# ------------------------------------------------------------------------------------------------------------------- schema, llms.txt, robots, sitemap
def _services(b: Business, items: list[CatalogItem]) -> list[str]:
    names = [str((s or {}).get("name")).strip() for s in (b.services or []) if isinstance(s, dict) and (s or {}).get("name")]
    return names or [i.title for i in items]


def jsonld_solution(db: Session, b: Business, stack: dict[str, Any]) -> dict[str, Any]:
    from . import chatgpt_business as cg
    row = db.scalar(select(ChatGPTBusiness).where(ChatGPTBusiness.business_id == b.id))
    items = list(db.scalars(select(CatalogItem).where(CatalogItem.business_id == b.id)))
    data, warnings = cg.jsonld(b, row, items)
    text = '<script type="application/ld+json">\n' + json.dumps(data, indent=2, ensure_ascii=False) + "\n</script>"
    where = {"spa": "index.html of the app, inside <head> (it is then in the page even before JavaScript runs)", "next": "the root layout's <head> (or a <Script type=\"application/ld+json\"> in app/layout.tsx)", "wordpress": "an SEO plugin's schema field, or a “Header” code snippet (WPCode)"}.get(
        stack["platform"], "the <head> of the homepage (and the contact page)")
    return {"title": "Add LocalBusiness / Organization structured data", "minutes": 10, "summary": "Structured data built from your real profile: name, address, phone, hours and profile links. Nothing in it is invented.", "audience": "developer",
            "steps": [f"Paste the block into {where}.", "Check every value is correct (name, phone, address, hours): it is read from your project.", "Test it with Google's Rich Results Test, then press “Check now”."] + [f"Missing in the project, so left out: {w}" for w in warnings[:4]],
            "blocks": [{"label": "JSON-LD", "where": where, "lang": "html", "text": text}], "check": "The live homepage has Organization / LocalBusiness structured data with sameAs."}


def robots_solution(report: dict[str, Any] | None, b: Business) -> dict[str, Any]:
    bots = (((report or {}).get("robots") or {}).get("ai_crawlers")) or []
    blocked = [x["bot"] for x in bots if x.get("allowed") is False]
    allow = "\n\n".join(f"User-agent: {n}\nAllow: /" for n in (blocked or ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "PerplexityBot"]))
    return {"title": "Allow the AI crawlers in robots.txt", "minutes": 10, "summary": f"Blocked now: {', '.join(blocked) or 'robots.txt could not be read'}. Allowing them lets ChatGPT, Claude and Perplexity read and cite your public pages.", "audience": "developer",
            "steps": ["Open robots.txt at the site root.", "Delete any “Disallow: /” rule that applies to the bots above (a rule under “User-agent: *” blocks all of them).", "Add the lines below, keeping your private areas (admin, checkout, account) disallowed.", "Save, then press “Check now”."],
            "blocks": [{"label": "Add to robots.txt", "where": "https://your-site/robots.txt", "lang": "text", "text": allow}], "check": "GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot and PerplexityBot are not blocked."}


def llms_solution(db: Session, b: Business, crawl: dict[str, Any], stack: dict[str, Any]) -> dict[str, Any]:
    items = list(db.scalars(select(CatalogItem).where(CatalogItem.business_id == b.id)))
    base = (b.website or "").rstrip("/")
    pages = [p for p in (crawl.get("pages") or []) if p.get("status") == 200 and not p.get("noindex")][:15]
    first = re.split(r"(?<=[.!?])\s", " ".join((b.description or "").split()))[0] if (b.description or "").strip() else ""
    blurb = _cut(first, 200) or ((b.primary_category or "Local business") + (" in " + b.city if b.city else ""))
    lines = [f"# {b.name}", "", f"> {blurb}", ""]
    facts = [x for x in (f"Address: {b.address}" if b.address else "", f"Phone: {b.phone}" if b.phone else "", f"Website: {b.website}" if b.website else "") if x]
    if facts:
        lines += ["## Contact"] + [f"- {f}" for f in facts] + [""]
    svc = _services(b, items)
    if svc:
        lines += ["## Services"] + [f"- {s}" for s in svc[:15]] + [""]
    if pages:
        lines += ["## Key pages"] + [f"- [{(p.get('title') or p['url']).strip()[:70]}]({p['url']})" for p in pages] + [""]
    text = "\n".join(lines).rstrip() + "\n"
    place = "public/llms.txt" if stack["platform"] in ("spa", "next") else "the web root, so it opens at https://your-site/llms.txt"
    return {"title": "Publish an llms.txt file", "minutes": 10, "summary": "A short plain-text summary of the business for AI assistants, built from your profile and crawled pages. List only what you publish anyway.", "audience": "developer",
            "steps": [f"Create a file named llms.txt in {place}.", "Paste the text below and read it once: remove anything you do not want an AI to repeat.", "Deploy, open /llms.txt in a browser, then press “Check now”."],
            "blocks": [{"label": "llms.txt", "where": f"{base or 'https://your-site'}/llms.txt", "lang": "markdown", "text": text}], "check": "/llms.txt exists on the live site."}


def sitemap_solution(crawl: dict[str, Any], b: Business, report: dict[str, Any] | None) -> dict[str, Any]:
    pages = [p for p in (crawl.get("pages") or []) if p.get("status") == 200 and not p.get("noindex") and p.get("url")]
    if not pages:
        raise SolutionError("The website has not been crawled yet: run Start plan or a Site Audit first, then the sitemap can be built from its real pages.")
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "\n".join(f"  <url><loc>{p['url'].split('#')[0]}</loc></url>" for p in pages) + "\n</urlset>\n"
    host = f"{urlsplit(b.website or '').scheme or 'https'}://{urlsplit(b.website or '').netloc or 'your-site'}"
    return {"title": "Create and submit an XML sitemap", "minutes": 15, "summary": f"A sitemap of the {len(pages)} public pages found by the crawl (pages marked noindex and error pages are left out).", "audience": "developer",
            "steps": ["Save the XML below as sitemap.xml in the site's web root (or generate it with your CMS or SEO plugin: it stays up to date by itself).", f"Add the line  Sitemap: {host}/sitemap.xml  to robots.txt.", "Open Google Search Console → Sitemaps and submit it.", "Press “Check now”."],
            "blocks": [{"label": "sitemap.xml", "where": f"{host}/sitemap.xml", "lang": "xml", "text": xml}, {"label": "Add to robots.txt", "where": f"{host}/robots.txt", "lang": "text", "text": f"Sitemap: {host}/sitemap.xml"}],
            "check": "The next site crawl finds the sitemap and it lists the pages."}


# ------------------------------------------------------------------------------------------------------------------- AI-written parts
def _ai_json(system: str, user: str, tokens: int = 900) -> dict[str, Any]:
    if not ai.is_configured():
        raise SolutionError("AI is not set up on this server, so the wording cannot be written. Add an AI key in the server settings.")
    try:
        out = ai.complete_json(system, user, max_tokens=tokens)
    except Exception as exc:  # noqa: BLE001
        raise SolutionError(f"The AI service did not answer ({type(exc).__name__}). Try again in a moment.") from exc
    if not isinstance(out, dict) or not out:
        raise SolutionError("The AI answer could not be read. Try again.")
    return out


SYSTEM = (f"You write website content for a local business.\n{ai.RULES}\nUse only facts in the business profile. Never invent prices, awards, years, statistics, names, reviews or addresses. Plain English, natural keyword use, no hype. "
          "The keyword list may contain mistakes (for example an old category): use a keyword ONLY if it truly describes what this business sells according to the profile, otherwise ignore it and write from the profile.")


def _cut(t: Any, n: int) -> str:
    s = " ".join(str(t or "").split())
    return s if len(s) <= n else s[: n - 1].rsplit(" ", 1)[0].rstrip(",.;:- ") + "…"


def _keywords(db: Session, b: Business, a: GrowthAction) -> list[str]:
    from . import growth_content as gc
    given = [k for k in ((a.verify or {}).get("keywords") or []) if isinstance(k, str)]
    return given[:3] or gc._main_keywords(b, gc.tracked(db, b), 3)


def head_solution(db: Session, b: Business, a: GrowthAction, stack: dict[str, Any], crawl: dict[str, Any], paths: list[str] | None = None) -> dict[str, Any]:
    """Page titles, descriptions and the head tags for the homepage (and, for 'duplicate' tasks, a unique pair for every page named)."""
    kws = _keywords(db, b, a)
    pages = [p for p in (crawl.get("pages") or []) if p.get("status") == 200]
    wanted = paths or ["/"]
    by_path = {(re.sub(r"^https?://[^/]+", "", p.get("url", "")) or "/"): p for p in pages}
    rows = [{"path": w, "current_title": (by_path.get(w) or {}).get("title"), "h1": (by_path.get(w) or {}).get("h1") if isinstance((by_path.get(w) or {}).get("h1"), str) else ""} for w in wanted[:12]]
    out = _ai_json(SYSTEM, f"Business profile:\n{ai.profile_text(b)}\n\nKeywords to use naturally: {', '.join(kws)}\n\nFor each page write a UNIQUE SEO title (30 to 60 characters, main keyword first, brand last), a meta description "
                   f"(110 to 155 characters, ends with a reason to click) and, for the homepage only, one H1. Pages: {json.dumps(rows)}\nReturn JSON " + '{"pages": [{"path": "", "title": "", "description": "", "h1": ""}]}')
    base = (b.website or "").rstrip("/")
    blocks, table = [], []
    for p in (out.get("pages") or [])[:12]:
        path = str(p.get("path") or "/")
        title, desc = _cut(p.get("title"), 60), _cut(p.get("description"), 160)
        if not title:
            continue
        table.append(f"{path}  →  {title}")
        head = f"<title>{title}</title>\n<meta name=\"description\" content=\"{desc}\">\n<link rel=\"canonical\" href=\"{base}{path if path != '/' else '/'}\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<meta property=\"og:title\" content=\"{title}\">\n<meta property=\"og:description\" content=\"{desc}\">\n<meta property=\"og:url\" content=\"{base}{path if path != '/' else '/'}\">\n<meta property=\"og:type\" content=\"website\">"
        if p.get("h1") and path == "/":
            head += f"\n<!-- on the page: <h1>{_cut(p['h1'], 90)}</h1> -->"
        blocks.append({"label": f"Head tags for {path}", "where": "inside <head> of that page", "lang": "html", "text": head})
    if not blocks:
        raise SolutionError("The AI did not return usable titles. Try again.")
    where = {"spa": "index.html for the homepage; for other pages use react-helmet-async (or your router's head API) so each route sets its own tags", "next": "the page's `metadata` export (app router) or <Head> (pages router)", "wordpress": "Yoast SEO / Rank Math: edit each page and fill the SEO title and meta description"}.get(
        stack["platform"], "each page's SEO settings or <head>")
    return {"title": "Unique page titles and descriptions", "minutes": 5 * len(blocks) + 5, "summary": f"{len(blocks)} page{'s' if len(blocks) != 1 else ''} get a unique title and description written from your profile and keywords.", "audience": "developer", "ai_used": True,
            "steps": [f"Apply each block in {where}.", "Read each title and description once and correct any fact.", "Press “Check now”: the live page is read again."], "blocks": blocks, "check": "The live page titles and descriptions match."}


def content_solution(db: Session, b: Business, a: GrowthAction, kind: str, stack: dict[str, Any]) -> dict[str, Any]:
    kws = _keywords(db, b, a)
    prompts = {
        "direct_answer": ('a direct answer paragraph of 40 to 60 words placed right under the homepage H1, answering what the business does, where and for whom, with one proof point from the profile', "<p>…</p>"),
        "faq_schema": ('5 real customer questions with short answers (2 to 3 sentences each) taken ONLY from facts in the profile (services, area, hours, booking, policies); if a fact is not in the profile, do not ask about it', "faq"),
        "question_headings": ('3 section headings written as customer questions with a 2-sentence answer under each', "<h2>…?</h2><p>…</p>"),
        "eeat": ('a short “About the owner / team” paragraph of 50 to 70 words using only facts from the profile, plus the line “Reviewed by <name>” with a placeholder for a real person', "<p>…</p>"),
    }
    spec, shape = prompts.get(kind) or prompts["direct_answer"]
    out = _ai_json(SYSTEM, f"Business profile:\n{ai.profile_text(b)}\n\nKeywords to use naturally: {', '.join(kws)}\n\nWrite {spec}. Return JSON " + ('{"faqs": [{"q": "", "a": ""}]}' if shape == "faq" else '{"html": ""}'))
    blocks: list[dict[str, str]] = []
    if shape == "faq":
        real = [f for f in (b.faqs or []) if isinstance(f, dict) and f.get("q") and f.get("a")]
        faqs = [{"q": _cut(f.get("q"), 160), "a": _cut(f.get("a"), 500)} for f in (real or out.get("faqs") or []) if f.get("q") and f.get("a")][:6]
        if not faqs:
            raise SolutionError("No usable questions were written. Try again.")
        html = "\n".join(f"<h3>{f['q']}</h3>\n<p>{f['a']}</p>" for f in faqs)
        ld = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": f["q"], "acceptedAnswer": {"@type": "Answer", "text": f["a"]}} for f in faqs]}
        blocks = [{"label": "FAQ section (visible on the page)", "where": "on the homepage or a FAQ page", "lang": "html", "text": html},
                  {"label": "FAQPage structured data (must match the visible text)", "where": "same page, inside <head> or just after the FAQ", "lang": "html", "text": '<script type="application/ld+json">\n' + json.dumps(ld, indent=2, ensure_ascii=False) + "\n</script>"}]
        steps = ["Use the real questions already in your project when there are any; otherwise read each written answer and correct any fact.", "Put the visible FAQ on the page and the structured data with it (the two must say the same).", "Press “Check now”."]
        title = "Add an FAQ section with FAQPage schema"
    else:
        html = str(out.get("html") or "").strip()
        if not html:
            raise SolutionError("The AI answer was empty. Try again.")
        html = re.sub(r"<(?!/?(p|h2|h3|strong|em|ul|li|br)\b)[^>]*>", "", html)  # only simple text tags survive
        blocks = [{"label": "Paste into the page", "where": {"direct_answer": "right under the main heading (H1)", "question_headings": "in the body, one section per question", "eeat": "the About section"}.get(kind, "the page"), "lang": "html", "text": html}]
        steps = ["Read the text once and correct any fact: it is written only from your profile.", "Paste it where shown and publish.", "Press “Check now”."]
        title = {"direct_answer": "Lead the page with a short direct answer", "question_headings": "Turn section headings into customer questions", "eeat": "Show who is behind the business"}.get(kind, "Improve the page content")
    return {"title": title, "minutes": 15, "summary": "Written from your profile and keywords; no invented facts.", "audience": "developer", "ai_used": True, "steps": steps, "blocks": blocks, "check": "The live page shows it."}


def spa_solution(stack: dict[str, Any]) -> dict[str, Any]:
    blocks = [{"label": "Pre-render the pages at build time (React Router apps built with Vite)", "where": "terminal, in the project folder (follow the library's README for your router version)", "lang": "bash",
               "text": "npm install vite-react-ssg\n# package.json: change the build script from  \"vite build\"  to  \"vite-react-ssg build\"\n# declare the routes as a route array (/, /products, /gallery ...), then run:\nnpm run build"},
              {"label": "Or move to server-side rendering (bigger change, best long term)", "where": "decision for your developer", "lang": "text", "text": "Next.js / Remix / Astro render the page on the server so every crawler gets the full text."}]
    return {"title": "Make the page text available without JavaScript", "minutes": 120, "summary": "Your pages are drawn in the browser, so crawlers that do not run JavaScript (many search and AI bots) see an empty page. Pre-rendering puts the real text in the HTML.", "audience": "developer",
            "steps": ["Give the block below to whoever builds the website: pre-rendering is a build-step change, not a content change.", "After deploying, open View Source on the homepage: the headings and text must be visible there.", "Press “Check now”: a fresh site crawl reads it."], "blocks": blocks,
            "check": "A new site crawl no longer reports the pages as empty without JavaScript."}


A11Y = {
    "a11y_form_labels": ("Give every form field a label", '<label for="email">Email</label>\n<input id="email" name="email" type="email" autocomplete="email">'),
    "a11y_link_text": ("Replace “click here” links with descriptive text", '<a href="/lehenga-rental">See our lehenga rental collection</a>   <!-- not: <a href="/lehenga-rental">click here</a> -->'),
    "a11y_main": ("Wrap the main content in <main>", "<header>…</header>\n<main>\n  …the page's own content…\n</main>\n<footer>…</footer>"),
    "a11y_heading_order": ("Keep headings in order (no skipped levels)", "<h1>Page title</h1>\n<h2>Section</h2>\n<h3>Part of the section</h3>   <!-- never jump from h1 to h4 -->"),
    "a11y_button_names": ("Give every button a name", '<button type="button" aria-label="Open menu"><svg aria-hidden="true">…</svg></button>'),
}


def generic_solution(a: GrowthAction, detail: str | None = None) -> dict[str, Any]:
    return {"title": a.title, "minutes": a.est_minutes or 15, "summary": a.why or "", "audience": "owner", "steps": list(a.how or []) + ([f"What the check found: {detail}"] if detail else []), "blocks": [], "check": (a.evidence or {}).get("details") or "The task's live check passes."}


def a11y_solution(key: str, detail: str | None) -> dict[str, Any]:
    title, code = A11Y[key.rsplit(".", 1)[-1]]
    return {"title": title, "minutes": 20, "summary": f"Found on the live page: {detail or 'see the Page X-Ray report'}", "audience": "developer", "steps": ["Find the elements the Page X-Ray report names and change them as in the example.", "Reload and press “Check now”."],
            "blocks": [{"label": "Example", "where": "the page's HTML / component", "lang": "html", "text": code}], "check": "The accessibility check passes."}


# ------------------------------------------------------------------------------------------------------------------- in-app work: profile, listings
def services_solution(db: Session, b: Business, a: GrowthAction) -> dict[str, Any]:
    kws = _keywords(db, b, a)
    out = _ai_json(SYSTEM, f"Business profile:\n{ai.profile_text(b)}\n\nKeywords: {', '.join(kws)}\n\nList 5 to 8 services this business really offers (from the profile only), each with a one-sentence description under 200 characters. Do not invent prices. "
                   'Return JSON {"services": [{"name": "", "description": ""}]}')
    svc = [{"name": _cut(s.get("name"), 80), "description": _cut(s.get("description"), 200)} for s in out.get("services") or [] if isinstance(s, dict) and s.get("name")][:8]
    if not svc:
        raise SolutionError("No usable services were written. Try again.")
    text = "\n".join(f"{s['name']}: {s['description']}" for s in svc)
    return {"title": "Add these services to the Google profile", "minutes": 8, "summary": "Services written only from your profile. Add the ones you really offer; delete the rest.", "audience": "owner", "ai_used": True,
            "steps": ["Open the Services step of the profile editor (button above).", "Add each service you really offer with its description (copy from the block).", "Add a price only if you show prices: never guess one.", "Save and sync, then press “Check now”."],
            "blocks": [{"label": "Services", "where": "Google profile → Services", "lang": "text", "text": text}], "check": "The profile has at least 5 services."}


def reviews_solution(db: Session, b: Business, a: GrowthAction) -> dict[str, Any]:
    """Ask real customers for reviews (the project's own review page, no gating, no incentives) and answer every review that waits."""
    from ..config import get_settings
    from ..models import Review
    from ..routers import review_link as rl
    share = f"{get_settings().frontend_url.rstrip('/')}/r/{rl.token_for(b.id)}"
    waiting = db.query(Review).filter(Review.business_id == b.id, Review.reply_status != "posted").count()
    name = b.name
    msgs = [f"Hi! Thank you for choosing {name}. We would love your honest feedback: a short Google review helps us improve and helps other customers decide. It takes a minute: {share}",
            f"Hello, this is {name}. We would love to hear how your experience was, good or bad. You can write it here: {share}  Thank you!",
            f"Thanks for visiting {name} today. If you have a minute, please tell us how we did: {share}"]
    steps = [f"Send one of the messages below to every customer you just served, the same day, by WhatsApp or SMS (ask everyone, not only the happy ones).",
             "Never offer a discount, gift or payment for a review, and never pick who to ask by how happy they seem: both break Google's rules and can remove your reviews.",
             f"{waiting} review{'s' if waiting != 1 else ''} still {'wait' if waiting != 1 else 'waits'} for a reply: open Reviews and post a reply to each (drafts are prepared there)." if waiting else "Every review already has a reply: keep it that way within 24 hours.",
             "Check again in a few days with “Check now”: new reviews and replies are counted from Google."]
    return {"title": "Get more reviews and answer every one", "minutes": 10, "summary": "Your own review page opens Google's review box for the customer. Ask every customer; reply to every review.", "audience": "owner",
            "steps": steps, "blocks": [{"label": f"Message {i + 1} (send to a customer after the visit)", "where": "WhatsApp / SMS", "lang": "text", "text": m} for i, m in enumerate(msgs)] + [{"label": "Your review link", "where": "QR code, receipt, signage", "lang": "text", "text": share}],
            "check": "New reviews arrive and the unanswered count falls (read from Google)."}


def photos_solution(b: Business, a: GrowthAction) -> dict[str, Any]:
    shots = ["Storefront from the street (day, whole sign visible)", "Entrance and the inside, wide shot", "Your best work or products, 5 different ones, well lit", "The team at work (with permission)", "A before-and-after if it applies", "Opening-hours sign and the street address number"]
    return {"title": "Add the photos Google shows first", "minutes": 20, "summary": "Real photos, taken now, in daylight. Google favours profiles with recent, varied photos; stock images and logos with text overlays do not count.", "audience": "owner",
            "steps": ["Take the photos below with a phone (landscape, steady, no filters).", "Upload them in Photos: set one as the cover and one as the logo.", "Add 2 or 3 new photos every week from now on: freshness matters.", "Press “Check now” after the upload syncs."],
            "blocks": [{"label": "Shot list", "where": "Photos", "lang": "text", "text": "\n".join(f"{i + 1}. {x}" for i, x in enumerate(shots))}], "check": "The profile has at least 10 photos."}


def listing_solution(db: Session, b: Business, a: GrowthAction) -> dict[str, Any]:
    key = a.key.split(".")[2] if a.key.count(".") >= 3 else ""
    claim = {"bing": ("Bing Places", "https://www.bingplaces.com/"), "apple": ("Apple Business Connect", "https://businessconnect.apple.com/"), "facebook": ("Facebook Page", "https://www.facebook.com/pages/create"),
             "instagram": ("Instagram business profile", "https://www.instagram.com/accounts/emailsignup/")}.get(key, (key.title(), ""))
    nap = "\n".join(x for x in (f"Name: {b.name}", f"Address: {b.address}" if b.address else "", f"Phone: {b.phone}" if b.phone else "", f"Website: {b.website}" if b.website else "", f"Category: {b.primary_category}" if b.primary_category else "") if x)
    desc = (b.description or "").strip()
    blocks = [{"label": "Business details (identical everywhere)", "where": f"{claim[0]} form", "lang": "text", "text": nap}]
    if desc:
        blocks.append({"label": "Description", "where": f"{claim[0]} description field", "lang": "text", "text": desc})
    return {"title": f"Add the business to {claim[0]}", "minutes": 15, "summary": "The same name, address and phone as on Google: consistency is the signal.", "audience": "owner",
            "steps": [f"Open {claim[0]}{' (' + claim[1] + ')' if claim[1] else ''} and search for the business first: claim it if it exists, never create a duplicate.", "Paste the details exactly as shown.", "Verify by phone or postcard if asked.",
                      "Save the listing's link on the Listing Management page and press Check, then “Check now” here."], "blocks": blocks, "check": "Listing Management finds the listing and its details match."}


# ------------------------------------------------------------------------------------------------------------------- the entry point
def _context(db: Session, b: Business) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    from . import growth_content as gc
    from . import growth_metrics as gm
    try:
        report = gm._latest_xray(db, b)[0]
    except Exception:  # noqa: BLE001
        report = None
    return report, gc._crawl(db, b)


def _check_detail(report: dict[str, Any] | None, key: str) -> str | None:
    short = key.rsplit(".", 1)[-1]
    for area in ("seo", "aeo", "geo"):
        for c in ((report or {}).get("scores", {}).get(area) or {}).get("checks", []):
            if c.get("key") == short:
                return c.get("detail")
    return None


def build(db: Session, b: Business, a: GrowthAction) -> dict[str, Any]:
    """The exact solution for one task. Raises SolutionError (with a plain message) when a part needs something that is missing (AI, a crawl)."""
    report, crawl = _context(db, b)
    stack = stack_of(report, b.website)
    key = a.key.split("@")[0]  # fix.xray.title@about is the same fix on another page
    short = key.rsplit(".", 1)[-1]
    detail = _check_detail(report, key)
    if key.startswith("fix.security.") and short in (*HEADER_VALUES, "csp"):
        sol = headers_solution(key, stack)
    elif key in ("fix.xray.org_schema", "fix.chatgpt.jsonld"):
        sol = jsonld_solution(db, b, stack)
    elif key == "fix.xray.faq_schema":
        sol = content_solution(db, b, a, "faq_schema", stack)
    elif key == "fix.xray.ai_crawlers":
        sol = robots_solution(report, b)
    elif key == "fix.xray.llms_txt":
        sol = llms_solution(db, b, crawl, stack)
    elif key in ("fix.site.sitemap.missing", "fix.site.sitemap.incomplete", "fix.xray.sitemap"):
        sol = sitemap_solution(crawl, b, report)
    elif key == "fix.onpage.javascript_only":
        sol = spa_solution(stack)
    elif key in ("fix.xray.direct_answer", "fix.xray.question_headings", "fix.xray.eeat", "fix.xray.author", "fix.xray.date"):
        sol = content_solution(db, b, a, "eeat" if key.endswith(("eeat", "author", "date")) else short, stack)
    elif key.startswith("fix.xray.a11y_") and short in A11Y:
        sol = a11y_solution(key, detail)
    elif key.startswith(("fix.xray.title", "fix.xray.description", "fix.xray.one_h1", "fix.xray.descriptive_title", "fix.xray.og", "fix.xray.canonical", "fix.xray.viewport", "fix.kw.use.website", "fix.onpage.duplicate_titles")) or \
            key.startswith(("fix.site.meta.title", "fix.site.meta.desc", "fix.site.meta.h1", "fix.site.meta.canonical", "fix.site.meta.og")):
        from . import growth_content as gc
        paths = [p.rstrip(".,") for p in re.findall(r"(?:^|[\s:,])(/[a-z0-9\-_/]*)", a.why or "")] if key.startswith("fix.site.") else ["/"]
        sol = head_solution(db, b, a, stack, crawl, list(dict.fromkeys(paths))[:8] or ["/"])
    elif key == "fix.gbp.services" or key.startswith("fix.kw.use.services"):
        sol = services_solution(db, b, a)
    elif key in ("fix.gbp.reviews", "fix.gbp.rating", "fix.gbp.reply_rate"):
        sol = reviews_solution(db, b, a)
    elif key in ("fix.gbp.photos", "fix.gbp.logo", "fix.gbp.cover"):
        sol = photos_solution(b, a)
    elif key.startswith("fix.listing.") and key.endswith(".add"):
        sol = listing_solution(db, b, a)
    else:
        sol = generic_solution(a, detail)
    sol.setdefault("audience", "owner")
    sol.setdefault("ai_used", False)
    sol.update(stack=stack, built_at=datetime.now(timezone.utc).isoformat(), landing=a.link, key=key)
    return sol


def save(db: Session, b: Business, a: GrowthAction) -> dict[str, Any]:
    sol = build(db, b, a)
    a.evidence = {**(a.evidence or {}), "solution": sol}
    db.add(a)
    db.flush()
    return sol


def is_website_side(a: GrowthAction) -> bool:
    return a.key.startswith(WEBSITE_KEYS) or a.key.startswith(("fix.site.meta", "fix.onpage"))


def handoff(db: Session, b: Business) -> dict[str, Any]:
    """One brief for the person who edits the website: every open website-side task with its exact code, in the order of importance, and how each will be checked."""
    order = {"critical": 0, "serious": 1, "warning": 2, "info": 3}
    rows = [a for a in db.scalars(select(GrowthAction).where(GrowthAction.business_id == b.id, GrowthAction.period == "fix", GrowthAction.status.in_(("todo", "unverified", "failed")))) if is_website_side(a)]
    rows.sort(key=lambda a: (order.get((a.evidence or {}).get("severity"), 9), a.id))
    parts, minutes, done, skipped = [f"# Website fixes for {b.name}", f"Site: {b.website}", ""], 0, 0, []
    seen: dict[str, int] = {}  # the same change can answer several tasks (one head-tag block fixes the title, description and canonical tasks): list it once
    for a in rows:
        try:
            sol = (a.evidence or {}).get("solution") or build(db, b, a)
        except SolutionError as exc:
            skipped.append(f"{a.title}: {exc}")
            continue
        sig = hashlib.sha1((sol["title"] + "|".join(blk["text"] for blk in sol.get("blocks") or [])).encode("utf-8")).hexdigest()
        if sig in seen:
            seen[sig] += 1
            continue
        seen[sig] = 1
        done += 1
        minutes += int(sol.get("minutes") or 0)
        parts += [f"## {done}. {sol['title']}  ({(a.evidence or {}).get('severity', '')}, about {sol.get('minutes')} min)", sol.get("summary") or "", ""]
        parts += [f"{i}. {s}" for i, s in enumerate(sol.get("steps") or [], 1)] + [""]
        for blk in sol.get("blocks") or []:
            parts += [f"**{blk['label']}**" + (f"  — {blk['where']}" if blk.get("where") else ""), f"```{blk.get('lang') or ''}", blk["text"], "```", ""]
        parts += [f"_Done when:_ {sol.get('check')}", ""]
    if skipped:
        parts += ["## Not included", ""] + [f"- {s}" for s in skipped]
    return {"markdown": "\n".join(parts), "count": done, "minutes": minutes, "skipped": skipped}


def prefill(db: Session, b: Business, ai_limit: int = 4) -> dict[str, int]:
    """Build the solution of every open fix task that has none (Start plan): the ones that need no AI always (they are instant and exact), the AI-written ones up to `ai_limit`."""
    done = used = failed = 0
    rows = db.scalars(select(GrowthAction).where(GrowthAction.business_id == b.id, GrowthAction.period == "fix", GrowthAction.status.in_(("todo", "unverified", "failed"))).order_by(GrowthAction.due_on, GrowthAction.id))
    for a in rows:
        if (a.evidence or {}).get("solution"):
            continue
        needs_ai = a.key in ("fix.xray.faq_schema", "fix.xray.direct_answer", "fix.xray.question_headings", "fix.xray.eeat", "fix.xray.author", "fix.xray.date", "fix.gbp.services") or a.key.startswith(
            ("fix.xray.title", "fix.xray.description", "fix.xray.one_h1", "fix.xray.descriptive_title", "fix.xray.og", "fix.kw.use.website", "fix.kw.use.services", "fix.site.meta.title", "fix.site.meta.desc", "fix.site.meta.h1", "fix.onpage.duplicate_titles"))
        if needs_ai and used >= ai_limit:
            continue
        try:
            save(db, b, a)
            done += 1
            used += int(needs_ai)
        except SolutionError:
            failed += 1
            if needs_ai and not ai.is_configured():
                ai_limit = 0  # no AI key: stop trying the AI-written ones
    return {"built": done, "ai": used, "failed": failed}
