"""Where exactly a fix is made: which page(s) of the website, which part of the page or site, and how to get there on this site's platform.

Every fix task says it in plain words, so nobody has to guess whether to change the homepage, another page, the whole website, the web server or the Google profile. Nothing here
changes anything: it only describes the place, from the task, the latest homepage X-Ray and the latest site audit.
"""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import parse_qs, unquote, urlsplit

from sqlalchemy.orm import Session

from ..models import Business, GrowthAction

HEAD = "In the <head> of the page: the part of the page's code before the visible content"
BODY = "In the visible content of the page (what a visitor reads)"

# check key -> (what part, where / what exactly)
PLACE: dict[str, tuple[str, str]] = {
    "title": ("head", "The page title: the <title> tag in the <head> (in a website builder: the page's “SEO title” field)."),
    "descriptive_title": ("head", "The page title: the <title> tag in the <head> (in a website builder: the page's “SEO title” field)."),
    "description": ("head", "The meta description: the <meta name=\"description\"> tag in the <head> (in a website builder: the page's “meta description” field)."),
    "description_unique": ("head", "The meta description: the <meta name=\"description\"> tag in the <head>. Every page needs its own."),
    "og": ("head", "The Open Graph tags (og:title, og:description, og:image) in the <head>."),
    "twitter_card": ("head", "The Twitter card tags in the <head>."),
    "canonical": ("head", "The <link rel=\"canonical\"> tag in the <head>."),
    "single_canonical": ("head", "The <link rel=\"canonical\"> tag in the <head>: keep exactly one."),
    "viewport": ("head", "The <meta name=\"viewport\"> tag in the <head>."),
    "lang": ("head", "The lang attribute on the <html> tag."),
    "favicon": ("head", "The favicon <link rel=\"icon\"> tag in the <head>."),
    "indexable": ("head", "The robots meta tag in the <head> (and robots.txt): the page must be allowed to be indexed."),
    "not_noindex": ("head", "The robots meta tag in the <head>: remove noindex."),
    "org_schema": ("head", "A JSON-LD <script type=\"application/ld+json\"> block in the <head>."),
    "entity_consistent": ("head", "The JSON-LD block in the <head>: the business name, address and phone must match everywhere."),
    "faq_schema": ("body+head", "An FAQ section in the page body, plus an FAQPage JSON-LD block in the <head> that matches the questions on the page."),
    "one_h1": ("body", "The visible headings in the page body: exactly one H1 (the main headline of the page)."),
    "outline": ("body", "The visible headings in the page body: nest them in order H1, then H2, then H3, without skipping a level."),
    "words": ("body", "The visible text of the page: add useful, real content."),
    "short_paragraphs": ("body", "The visible text of the page: split long paragraphs."),
    "lists_tables": ("body", "The visible text of the page: add a list or a table where it helps."),
    "numbers": ("body", "The visible text of the page: add real figures (prices, years, counts)."),
    "direct_answer": ("body", "The first paragraph under the H1: a direct, two-sentence answer to what the page is about."),
    "question_headings": ("body", "The H2 headings: write some of them as the questions customers ask."),
    "eeat": ("body", "An About / expert box on the page that shows who wrote it and why they can be trusted."),
    "author": ("body", "A visible author name on the page."),
    "date": ("body", "A visible “last updated” date on the page."),
    "alt": ("body", "The images in the page body: the alt attribute of each <img>."),
    "a11y_img_alt": ("body", "The images in the page body: the alt attribute of each <img>."),
    "internal_links": ("body", "The links in the page body: link to your other relevant pages."),
    "outbound": ("body", "The links in the page body: link to trusted outside sources."),
}
SITE_FILES = {"sitemap": ("/sitemap.xml", "The file sitemap.xml in the root of the website."), "ai_crawlers": ("/robots.txt", "The file robots.txt in the root of the website."),
              "llms_txt": ("/llms.txt", "A new file llms.txt in the root of the website.")}
SERVER = {"https", "no_mixed_content", "cert", "page_weight", "response_time", "redirects", "status_200"}

OPEN = {
    "spa": "Open the website's source code (the React/Vite project). The <head> is in index.html at the project root; the page text is in that page's component. Rebuild and deploy afterwards.",
    "next": "Open the website's Next.js project. The <head> / metadata is in app/layout.tsx or the page's metadata export; the page text is in the page's component. Rebuild and deploy afterwards.",
    "wordpress": "WordPress admin: Pages, then Edit the page. Titles and descriptions are in the SEO plugin box under the editor (Yoast or Rank Math). Code for the <head> goes in a header-scripts plugin or the theme's header.php.",
    "shopify": "Shopify admin: Online Store, Pages, open the page, then “Search engine listing”. Code for the <head> goes in Online Store, Themes, Edit code, theme.liquid.",
    "wix": "Wix editor: Pages menu, the page's three dots, SEO basics. Code for the <head> goes in Settings, Custom code.",
    "squarespace": "Squarespace: Pages, the page's gear icon, SEO. Code for the <head> goes in Settings, Advanced, Code injection.",
    "webflow": "Webflow Designer: Pages panel, the page's settings, SEO settings and Custom code.",
}
UNKNOWN_OPEN = "Ask whoever manages the website (your web developer, agency or host) to open this exact page and make this change."
SERVER_OPEN = {
    "nginx": "On the web server: edit the nginx configuration for this site (the server block under /etc/nginx/sites-enabled/), then run nginx -t and reload nginx.",
    "apache": "On the web server: edit the Apache virtual host or the .htaccess file for this site, then reload Apache.",
    "cloudflare": "In Cloudflare: Rules, Transform Rules, Modify Response Header (or the page rules for this setting).",
    "vercel": "In the project's vercel.json (headers section), then redeploy.",
    "netlify": "In the project's _headers file or netlify.toml, then redeploy.",
}


def _origin(url: str) -> str:
    u = urlsplit(url if "//" in url else f"https://{url}")
    return f"{u.scheme or 'https'}://{u.netloc}"


def _norm(url: str | None) -> str:
    u = (url or "").strip()
    return u if u.startswith(("http://", "https://")) else (f"https://{u}" if u else "")


def _label(url: str, home: str) -> str:
    p = urlsplit(url).path or "/"
    return "Homepage" if p == "/" else p


def _page(url: str, home: str) -> dict[str, str]:
    p = urlsplit(url).path or "/"
    return {"url": url, "path": p, "label": _label(url, home)}


def _action_url(a: GrowthAction, home: str) -> str:
    v = a.verify or {}
    if isinstance(v.get("url"), str) and v["url"].startswith("http"):
        return v["url"]
    link = a.link or ""
    q = parse_qs(urlsplit(link).query)
    if q.get("url"):
        return unquote(q["url"][0])
    return home


def _audit_pages(db: Session, b: Business, kind: str, code: str, home: str) -> list[str]:
    from . import audits
    run = audits.latest(db, b, with_result=False).get(kind)
    out: list[str] = []
    if run is None or run.status != "done":
        return out
    origin = _origin(home)
    for i in run.issues or []:
        if str(i.get("code") or "") != code:
            continue
        for u in i.get("pages") or []:
            if isinstance(u, str):
                out.append(_norm(u))
        title = str(i.get("title") or "")
        m = re.match(r"^(/[^\s:]*)", title)
        if m:
            out.append(origin + m.group(1))
    return list(dict.fromkeys(u for u in out if u))[:12]


def _why_pages(a: GrowthAction, home: str) -> list[str]:
    m = re.search(r"Pages?:\s*([^.]*)", a.why or "")
    if not m:
        return []
    origin = _origin(home)
    return list(dict.fromkeys(origin + p.strip() for p in re.findall(r"(/[a-z0-9\-_/%.]*)", m.group(1))))[:12]


def target_for(db: Session, b: Business, a: GrowthAction, report: dict[str, Any] | None = None, stack: dict[str, Any] | None = None) -> dict[str, Any]:
    from . import growth_metrics, growth_solutions
    if report is None:
        try:
            report = growth_metrics._latest_xray(db, b)[0]
        except Exception:  # noqa: BLE001
            report = None
    stack = stack or growth_solutions.stack_of(report, b.website)
    home = _norm((report or {}).get("final_url") or (report or {}).get("url") or b.website)
    key = a.key.split("@")[0]
    short = key.rsplit(".", 1)[-1]
    platform = stack.get("platform") or "unknown"
    site_open = OPEN.get(platform, UNKNOWN_OPEN)

    def result(scope: str, scope_label: str, headline: str, pages: list[dict[str, str]], place: str, how_to_open: str, not_here: str) -> dict[str, Any]:
        return {"scope": scope, "scope_label": scope_label, "headline": headline, "pages": pages, "place": place, "how_to_open": how_to_open, "not_here": not_here, "site": home or None, "platform": stack.get("label")}

    # Not the website at all
    if key.startswith("fix.gbp.") or key.startswith("fix.kw.use.profile") or key.startswith("fix.kw.use.posts"):
        return result("profile", "Google Business Profile", "Make this change on the Google Business Profile, not on the website", [], "Your Google Business Profile (the listing people see on Google Search and Maps).",
                      "Use the button “Open where it is done” above: it opens the right screen in this software.", "Do not change the website for this task.")
    if key.startswith("fix.listing."):
        return result("external", "A listing website", "Make this change on the listing website named in the task, not on your own website", [], "Your listing on that directory (name, address and phone exactly as on Google).",
                      "Open the directory, claim or create the listing, then press Check on the Listing Management page.", "Do not change your own website for this task.")
    if key.startswith("fix.chatgpt.") and key != "fix.chatgpt.jsonld":
        return result("app", "ChatGPT business profile", "Make this change in the ChatGPT Business profile", [], "Your business profile in ChatGPT's Business Hub (prepared in this software).",
                      "Use the button “Open where it is done” above.", "Do not change the website for this task.")
    if key.startswith(("fix.kw.", "fix.comp.", "fix.blog.", "fix.rank.", "fix.bl.", "fix.content.")) and not key.startswith(("fix.kw.use.website", "fix.kw.use.alt")):
        return result("app", "In this software", "Do this inside this software, not on the website", [], "The page named under “Open where it is done” above.",
                      "Use the button “Open where it is done” above.", "Nothing needs to change on the website for this task.")

    # The web server (whole website)
    if key.startswith("fix.security.") or short in SERVER:
        srv = stack.get("server") or "unknown"
        return result("server", "Whole website (web server)", "Change the web server's configuration: it applies to every page, so no single page is edited", [{"url": home, "path": "/", "label": "Whole website"}] if home else [],
                      "The web server's response settings (headers, HTTPS or caching), not the content of any page.", SERVER_OPEN.get(srv, "Ask your host or whoever manages the server to make this change in the server or hosting configuration."),
                      "Do not edit individual pages for this task: the live check reads the server's response.")

    # Files in the site root
    if short in SITE_FILES or key.startswith("fix.site.sitemap") or key == "fix.site.robots":
        path, what = SITE_FILES.get(short, ("/sitemap.xml" if "sitemap" in key else "/robots.txt", "The file in the root of the website."))
        url = (_origin(home) if home else "") + path
        return result("file", f"One file: {path}", f"Create or edit the file {path} in the root of the website", [{"url": url, "path": path, "label": path}] if home else [], what,
                      "Upload the file to the website's root folder (the same place as index.html), or add it with your SEO plugin or builder. It must open at the address shown.", "Do not put it inside a page or a sub-folder: it must be at the root.")

    # Pages: the homepage, or the pages the audit named
    if key.startswith(("fix.onpage.", "fix.technical.")):
        kind = "onpage" if key.startswith("fix.onpage.") else "technical"
        urls = _audit_pages(db, b, kind, short, home)
    elif key.startswith("fix.site."):
        urls = _why_pages(a, home)
    elif key.startswith("fix.xray."):
        urls = [_action_url(a, home)] if home else []
    else:
        urls = [_action_url(a, home)] if home else []
    urls = [u for u in urls if u] or ([home] if home else [])
    pages = [_page(u, home) for u in urls]
    part, place = PLACE.get(short, ("body", "On the page named here."))
    if key.startswith("fix.onpage.javascript_only"):
        place = "The way these pages are built: they must send their text in the page itself (server-side rendering or pre-rendering), not only through JavaScript."
    if key.startswith(("fix.onpage.duplicate_titles", "fix.onpage.title_length", "fix.onpage.missing_title", "fix.site.meta.title")):
        place = PLACE["title"][1]
    elif key.startswith(("fix.onpage.missing_meta_description", "fix.site.meta.desc")):
        place = PLACE["description"][1]
    elif key.startswith(("fix.onpage.h1_count", "fix.site.meta.h1")):
        place = PLACE["one_h1"][1]
    elif key.startswith("fix.onpage.missing_alt"):
        place = PLACE["alt"][1]
    elif key.startswith("fix.onpage.no_localbusiness_schema") or key == "fix.chatgpt.jsonld":
        place = PLACE["org_schema"][1]
        if not pages and home:
            pages = [_page(home, home)]
    multi = len(pages) > 1
    scope = "pages" if multi else "page"
    scope_label = f"{len(pages)} pages" if multi else ("Only this page" if pages else "The page named in the task")
    where = "<head>" if part.startswith("head") else "body"
    headline = (f"Change these {len(pages)} pages of the website: the same fix on each" if multi else
                (f"Change this page of the website: {pages[0]['label']}" if pages else "Change the page named in the task"))
    return result(scope, scope_label, headline, pages, place, site_open + (" The code goes inside the <head>." if where == "<head>" and platform in ("spa", "next") else ""),
                  "Do not change other pages for this task, and not the Google profile: the live check reads " + ("these pages." if multi else "this page."))
