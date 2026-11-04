"""Website research done when a project is onboarded (and refreshed every month): the full technology stack, the metadata on every crawled
page, the site-wide checks, and the list of improvements that follow from them.

Everything is read from what any visitor (or Google) can see. The improvements come from three places, and each carries its `source`:
  * `stack`    - rules for the detected platform (what a WordPress, Shopify, Next.js... site usually lacks and how to fix it there),
  * `metadata` - gaps found on the crawled pages and site-wide (titles, descriptions, Open Graph, canonical, schema, robots, sitemap...),
  * `business` - what the client's own profile asks for (a page per service and per target area, schema for its FAQs and category...),
  * `ai`       - optional extra ideas from the AI, grounded in the findings above (only when an AI key is configured).
Nothing here is invented: a finding is only reported when the page or header really shows it, and suggested titles and descriptions are built
only from the client's profile and the page's own heading.
"""
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Audit, Business, SiteIntegration, SiteProfile
from . import ai, audits, site_onboarding
from .activity import log
from .net import site_client

logger = logging.getLogger("seo.research")

SECURITY_HEADERS = {
    "strict-transport-security": "HSTS (forces HTTPS)",
    "x-content-type-options": "X-Content-Type-Options",
    "referrer-policy": "Referrer-Policy",
    "content-security-policy": "Content-Security-Policy",
}
IMPACT_ORDER = {"High": 0, "Medium": 1, "Low": 2}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _rec(key: str, area: str, title: str, why: str, how: str, impact: str = "Medium", effort: str = "medium", source: str = "metadata", **extra: Any) -> dict[str, Any]:
    return {"key": f"rec:{key}", "area": area, "title": title, "why": why, "how": how, "impact": impact, "effort": effort, "source": source, **extra}


def _aware(dt: datetime) -> datetime:
    """SQLite returns datetimes without a timezone; treat them as UTC."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _pct(part: int, whole: int) -> int | None:
    return round(part / whole * 100) if whole else None


def _clip(text: str, limit: int) -> str:
    """Cut at a word boundary so a title or description is never chopped mid-word."""
    text = " ".join((text or "").split())
    if len(text) <= limit:
        return text
    return text[: limit + 1].rsplit(" ", 1)[0].rstrip(" ,;:-|") if " " in text[: limit + 1] else text[:limit]


# --- site-wide checks ---------------------------------------------------------------------------------------------------------------------------

def site_checks(url: str, crawl: dict[str, Any] | None) -> dict[str, Any]:
    """robots.txt, sitemap, llms.txt, HTTPS and the security and speed headers of the homepage. A check that could not be made says so (None), never a guess."""
    base = audits.crawler.homepage(url).rstrip("/")
    out: dict[str, Any] = {"https": base.startswith("https"), "robots_txt": (crawl or {}).get("robots_txt"), "sitemap": (crawl or {}).get("sitemap"),
                           "robots_blocks_all": (crawl or {}).get("robots_blocks_all"), "llms_txt": None, "security_headers": {}, "compression": None, "reachable": False}
    try:
        with site_client(15) as c:
            r = c.get(base + "/")
            h = {k.lower(): v for k, v in r.headers.items()}
            out["reachable"] = True
            out["security_headers"] = {name: (name in h) for name in SECURITY_HEADERS}
            out["compression"] = h.get("content-encoding") or None
            out["cache_control"] = h.get("cache-control")
            try:
                ll = c.get(base + "/llms.txt")
                out["llms_txt"] = ll.status_code == 200 and "html" not in ll.headers.get("content-type", "") and len(ll.text.strip()) > 20
            except httpx.HTTPError:
                pass
    except Exception as exc:  # noqa: BLE001 - a site that refuses the check must not fail the research
        out["error"] = str(exc)[:160]
    return out


# --- metadata audit -----------------------------------------------------------------------------------------------------------------------------

def metadata_audit(pages: list[dict[str, Any]]) -> dict[str, Any]:
    """Per-page metadata and how much of the site has each piece. Percentages are 0-100, higher is better."""
    rows = []
    titles = [p.get("title") for p in pages if p.get("title")]
    descs = [p.get("meta_description") for p in pages if p.get("meta_description")]
    dup_titles = {t for t in titles if titles.count(t) > 1}
    dup_descs = {d for d in descs if descs.count(d) > 1}
    for p in pages:
        if (p.get("status") or 0) >= 400:
            continue
        flags = []
        tl, dl = p.get("title_length", 0), p.get("meta_description_length", 0)
        if not tl:
            flags.append("missing_title")
        elif tl < 25 or tl > 60:
            flags.append("title_length")
        if p.get("title") in dup_titles:
            flags.append("duplicate_title")
        if not dl:
            flags.append("missing_description")
        elif dl < 70 or dl > 160:
            flags.append("description_length")
        if p.get("meta_description") in dup_descs:
            flags.append("duplicate_description")
        if not p.get("canonical"):
            flags.append("missing_canonical")
        if not (p.get("og_title") and p.get("og_description") and p.get("og_image")):
            flags.append("incomplete_open_graph")
        if not p.get("twitter_card"):
            flags.append("missing_twitter_card")
        if not p.get("schema_types"):
            flags.append("missing_schema")
        if not p.get("lang"):
            flags.append("missing_lang")
        if p.get("h1_count") != 1:
            flags.append("h1_count")
        rows.append({k: p.get(k) for k in ("url", "title", "title_length", "meta_description", "meta_description_length", "canonical", "og_title", "og_description", "og_image",
                                           "og_type", "twitter_card", "schema_types", "lang", "h1", "h1_count", "word_count", "noindex", "favicon")} | {"flags": flags})
    n = len(rows)
    has = lambda f: sum(1 for r in rows if f(r))  # noqa: E731
    coverage = {
        "title": _pct(has(lambda r: 25 <= (r["title_length"] or 0) <= 60 and "duplicate_title" not in r["flags"]), n),
        "description": _pct(has(lambda r: 70 <= (r["meta_description_length"] or 0) <= 160 and "duplicate_description" not in r["flags"]), n),
        "canonical": _pct(has(lambda r: bool(r["canonical"])), n),
        "open_graph": _pct(has(lambda r: "incomplete_open_graph" not in r["flags"]), n),
        "twitter_card": _pct(has(lambda r: bool(r["twitter_card"])), n),
        "schema": _pct(has(lambda r: bool(r["schema_types"])), n),
        "language": _pct(has(lambda r: bool(r["lang"])), n),
        "single_h1": _pct(has(lambda r: r["h1_count"] == 1), n),
    }
    known = [v for v in coverage.values() if v is not None]
    return {"pages": rows, "pages_checked": n, "coverage": coverage, "score": round(sum(known) / len(known)) if known else None,
            "schema_types": sorted({t for r in rows for t in (r["schema_types"] or [])}), "has_favicon": any(r["favicon"] for r in rows) if rows else None}


# --- suggested metadata (rule-based; AI only improves the wording) ---------------------------------------------------------------------------------

def _services(b: Business, n: int = 3) -> list[str]:
    return [s["name"] for s in (b.services or []) if s.get("name")][:n]


def _page_label(p: dict[str, Any]) -> str:
    h1 = (p.get("h1") or "").strip()
    if h1:
        return h1
    slug = (urlparse(p["url"]).path.strip("/").split("/")[-1] or "").replace("-", " ").replace("_", " ")
    return slug.title()


def suggest_for_page(p: dict[str, Any], b: Business, is_home: bool) -> dict[str, str]:
    """A title (<=60) and description (<=160) from the client's profile and the page's own heading only."""
    place = b.city or b.area or ""
    cat = b.primary_category or ""
    if is_home:
        head = f"{cat} in {place}" if cat and place else cat or place
        title = _clip(f"{b.name} | {head}" if head else b.name, 60)
        svc = ", ".join(_services(b))
        desc = f"{b.name} is a {cat.lower() + ' ' if cat else ''}{'in ' + place if place else 'business'}." + (f" Services: {svc}." if svc else "") + " Get in touch today."
    else:
        label = _page_label(p)
        title = _clip(f"{label} | {b.name}" + (f" - {place}" if place else ""), 60) if label else _clip(b.name, 60)
        desc = f"{label} from {b.name}" + (f" in {place}" if place else "") + "." + (f" {b.name} also offers {', '.join(_services(b))}." if _services(b) else "") + " Contact us to learn more."
    return {"title": title, "description": _clip(desc, 160)}


def suggest_metadata(meta: dict[str, Any], b: Business, limit: int = 12) -> list[dict[str, Any]]:
    """Proposed metadata for the pages whose own metadata has a problem (worst pages first)."""
    bad = [r for r in meta.get("pages", []) if set(r["flags"]) & {"missing_title", "title_length", "duplicate_title", "missing_description", "description_length", "duplicate_description"}]
    bad.sort(key=lambda r: -len(r["flags"]))
    out = []
    for r in bad[:limit]:
        is_home = urlparse(r["url"]).path in ("", "/")
        s = suggest_for_page(r, b, is_home)
        out.append({"url": r["url"], "flags": r["flags"], "current_title": r["title"], "current_description": r["meta_description"], **s,
                    "og_title": s["title"], "og_description": s["description"], "wording": "template"})
    if out and ai.is_configured():
        try:
            reply = ai.complete_json(
                f"You write SEO page titles and meta descriptions.\n{ai.RULES}\n- Titles: 50-60 characters, main keyword near the start, brand last. Descriptions: 140-158 characters, one clear benefit and a call to action.",
                f"Business profile:\n{ai.profile_text(b)}\n\nPages (url, current heading): {[{'url': o['url'], 'heading': next((r['h1'] for r in meta['pages'] if r['url'] == o['url']), '')} for o in out]}\n"
                'Return JSON {"pages":[{"url": string, "title": string, "description": string}]}. Use only the facts above.')
            by_url = {x.get("url"): x for x in reply.get("pages", []) if isinstance(x, dict)}
            for o in out:
                x = by_url.get(o["url"])
                if x and 25 <= len(str(x.get("title", ""))) <= 65 and 70 <= len(str(x.get("description", ""))) <= 165:
                    o.update(title=x["title"], description=x["description"], og_title=x["title"], og_description=x["description"], wording="ai")
        except Exception as exc:  # noqa: BLE001 - the template wording is already there
            logger.info("AI metadata wording skipped: %s", exc)
    return out


# --- the improvements ---------------------------------------------------------------------------------------------------------------------------

def _tokens(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]{3,}", (text or "").lower())} - {"and", "the", "for", "with", "services", "service"}


def _has_page_for(topic: str, pages: list[dict[str, Any]]) -> bool:
    want = _tokens(topic)
    if not want:
        return True
    for p in pages:
        have = _tokens(f"{urlparse(p['url']).path} {p.get('title') or ''} {p.get('h1') or ''}")
        if len(want & have) >= max(1, round(len(want) * 0.6)):
            return True
    return False


STACK_RULES: dict[str, list[dict[str, Any]]] = {
    "wordpress": [
        dict(key="wp-seo-plugin", when=lambda d: not ({"Yoast SEO", "Rank Math"} & set(d.get("plugins", []))), area="technical", impact="High", effort="quick",
             title="Install and configure an SEO plugin (Rank Math or Yoast SEO)",
             why="No SEO plugin was found on this WordPress site, so titles, descriptions, sitemaps, canonicals and schema are probably left to the theme.",
             how="Install Rank Math or Yoast, run its setup wizard, choose the business type, then use its templates to set the title and description patterns and enable the XML sitemap."),
        dict(key="wp-cache", when=lambda d: not ({"WP Rocket", "LiteSpeed Cache"} & set(d.get("plugins", []))), area="technical", impact="Medium", effort="quick",
             title="Add page caching and file minification",
             why="No caching plugin was detected, which usually means slow first loads and weaker Core Web Vitals.",
             how="Use WP Rocket, LiteSpeed Cache (on LiteSpeed hosting) or W3 Total Cache; enable page cache, CSS/JS minify, image lazy-load and a CDN."),
        dict(key="wp-builder-weight", when=lambda d: bool({"Elementor", "Divi", "WPBakery"} & set(d.get("plugins", []))), area="technical", impact="Medium", effort="medium",
             title="Trim page-builder bloat",
             why="Page builders add large CSS/JS to every page; this is the commonest cause of poor LCP and TBT on WordPress.",
             how="Remove unused widgets and fonts, turn on the builder's 'optimised markup / asset loading' options, and load heavy scripts only on pages that use them."),
    ],
    "shopify": [
        dict(key="shopify-templates", when=lambda d: True, area="metadata", impact="High", effort="medium",
             title="Write collection and product meta templates",
             why="Shopify stores usually ship with default titles and no descriptions for collections and products.",
             how="Edit each collection's 'Search engine listing', and add product title/description patterns in the theme (meta_description fallbacks). Add Product schema via the theme or an app."),
        dict(key="shopify-apps", when=lambda d: True, area="technical", impact="Low", effort="medium",
             title="Audit installed apps for speed",
             why="Every Shopify app can inject scripts site-wide; unused apps often stay behind after uninstalling.",
             how="List the apps, remove the unused ones, and delete their leftover snippets from theme.liquid."),
    ],
    "wix": [dict(key="builder-seo-panel", when=lambda d: True, area="metadata", impact="Medium", effort="medium", title="Fill in each page's SEO settings in Wix",
                 why="Wix sites keep titles, descriptions and social tags in each page's SEO panel; defaults are generic.", how="Page menu > SEO basics: set the title, description, URL slug and social share image for every page; add structured data under Advanced SEO.")],
    "squarespace": [dict(key="builder-seo-panel", when=lambda d: True, area="metadata", impact="Medium", effort="medium", title="Fill in each page's SEO settings in Squarespace",
                         why="Squarespace keeps titles, descriptions and social images in each page's settings.", how="Page settings > SEO: set the title and description, and add the social image; use Code Injection for LocalBusiness schema.")],
    "webflow": [dict(key="builder-seo-panel", when=lambda d: True, area="metadata", impact="Medium", effort="medium", title="Set SEO and Open Graph fields on every Webflow page and CMS template",
                     why="Webflow pages have separate SEO and Open Graph settings, and CMS collection pages need dynamic fields mapped.", how="Page settings > SEO and Open Graph; for CMS templates bind title/description to fields. Add JSON-LD in the page custom code.")],
    "nextjs": [dict(key="next-metadata", when=lambda d: True, area="metadata", impact="High", effort="medium", title="Define metadata with Next.js generateMetadata and a sitemap route",
                    why="Next.js sites need titles, descriptions, canonicals and Open Graph set in code, and a sitemap/robots file generated by the app.",
                    how="Export `metadata` / `generateMetadata` from each route (include alternates.canonical and openGraph), add app/sitemap.ts and app/robots.ts, and emit JSON-LD in a <script type=\"application/ld+json\"> in the page component.")],
    "nuxt": [dict(key="nuxt-seo", when=lambda d: True, area="metadata", impact="High", effort="medium", title="Use useSeoMeta and the Nuxt SEO module",
                  why="Nuxt needs per-page meta set in code; the Nuxt SEO module generates the sitemap, robots and schema.", how="Call useSeoMeta() in each page, add @nuxtjs/seo (sitemap, robots, schema-org), and confirm SSR/prerender is on.")],
    "gatsby": [dict(key="gatsby-seo", when=lambda d: True, area="metadata", impact="Medium", effort="medium", title="Use the Gatsby Head API and gatsby-plugin-sitemap",
                    why="Gatsby generates static pages, but titles, descriptions and the sitemap come from your code and plugins.", how="Export a Head function per page with title, description, canonical and OG tags; add gatsby-plugin-sitemap.")],
    "astro": [dict(key="astro-seo", when=lambda d: True, area="metadata", impact="Medium", effort="medium", title="Add a shared SEO component and @astrojs/sitemap",
                   why="Astro ships no SEO defaults; every layout must render the meta tags.", how="Create one <SEO> component for the <head> (title, description, canonical, OG, Twitter) and add the @astrojs/sitemap integration.")],
    "react": [dict(key="spa-ssr", when=lambda d: True, area="technical", impact="High", effort="large", title="Serve crawlable HTML (server-side render or pre-render)",
                   why="This is a client-side React app: search engines and AI crawlers may receive an empty page and miss the content, links and metadata.",
                   how="Move to Next.js/Remix, or pre-render the public routes (e.g. react-snap / Prerender service); use react-helmet-async until then so each route sets its own title and description.")],
    "vue": [dict(key="spa-ssr", when=lambda d: True, area="technical", impact="High", effort="large", title="Serve crawlable HTML (server-side render or pre-render)",
                 why="This is a client-side Vue app: crawlers may see an empty page.", how="Move to Nuxt, or pre-render the public routes; use @unhead/vue so each route sets its own title and description.")],
    "angular": [dict(key="spa-ssr", when=lambda d: True, area="technical", impact="High", effort="large", title="Enable Angular SSR / pre-rendering",
                     why="This is a client-side Angular app: crawlers may see an empty page.", how="Add @angular/ssr, enable prerendering for public routes, and use the Title and Meta services per route.")],
    "static": [dict(key="static-basics", when=lambda d: True, area="technical", impact="Medium", effort="medium", title="Add a sitemap and structured data by hand",
                    why="A hand-built site has no plugin to generate a sitemap or schema.", how="Create /sitemap.xml, reference it in robots.txt, and add LocalBusiness JSON-LD to the home and contact pages.")],
}


def build_recommendations(stack: dict[str, Any], checks: dict[str, Any], meta: dict[str, Any], b: Business, pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    recs: list[dict[str, Any]] = []
    platform, details = stack.get("platform") or "unknown", stack.get("details") or {}
    label = stack.get("label") or platform

    # 1. stack-specific
    for rule in STACK_RULES.get(platform, []):
        if rule["when"](details):
            recs.append(_rec(rule["key"], rule["area"], rule["title"], rule["why"], rule["how"], rule["impact"], rule["effort"], "stack", platform=label))
    if stack.get("reachable") and not details.get("analytics"):
        recs.append(_rec("analytics", "technical", "Install Google Analytics 4 and connect Search Console", "No analytics or tag manager was found on the site, so traffic and conversions cannot be measured.",
                         "Create a GA4 property, add it through Google Tag Manager, mark calls/forms/bookings as conversions, and verify the domain in Search Console.", "High", "quick", "stack"))
    if stack.get("reachable") and not (details.get("cdn") or details.get("hosting")):
        recs.append(_rec("cdn", "technical", "Put the site behind a CDN", "No CDN or modern host was detected; visitors far from the server load pages more slowly.", "Enable Cloudflare (free plan) or the host's CDN, with Brotli and HTTP/3.", "Low", "quick", "stack"))

    # 2. site-wide metadata and technical checks
    if checks.get("reachable"):
        if not checks.get("https"):
            recs.append(_rec("https", "technical", "Move the whole site to HTTPS", "The site is served over plain HTTP, which browsers flag as 'Not secure' and Google treats as a weak signal.", "Install an SSL certificate, 301-redirect http:// to https://, and update canonicals and the sitemap.", "High", "quick"))
        if checks.get("robots_txt") is False:
            recs.append(_rec("robots", "technical", "Publish a robots.txt that points to the sitemap", "No robots.txt was found.", "Create /robots.txt with `User-agent: *` and a `Sitemap:` line.", "Medium", "quick"))
        if checks.get("sitemap") is False:
            recs.append(_rec("sitemap", "technical", "Publish an XML sitemap and submit it in Search Console", "No XML sitemap was found, so new and deep pages are discovered slowly.", "Generate /sitemap.xml (your SEO plugin or framework can), add it to robots.txt and submit it in Search Console.", "High", "quick"))
        missing = [lab for k, lab in SECURITY_HEADERS.items() if checks.get("security_headers", {}).get(k) is False]
        if len(missing) >= 3:
            recs.append(_rec("security-headers", "technical", "Add the standard security headers", f"Missing: {', '.join(missing)}.", "Set them at the host or CDN (Cloudflare Transform Rules, nginx add_header, or a security plugin).", "Low", "quick"))
        if checks.get("compression") is None:
            recs.append(_rec("compression", "technical", "Turn on Brotli/Gzip compression", "The homepage was served without compression.", "Enable compression on the server or CDN.", "Medium", "quick"))
        if checks.get("llms_txt") is False:
            recs.append(_rec("llms-txt", "content", "Add an llms.txt file for AI assistants", "AI search tools look for a short, plain summary of the business and its key pages.",
                             "Publish /llms.txt with the business name, what it does, where it works and links to the main service pages.", "Low", "quick"))

    # 3. page metadata
    n, cov = meta.get("pages_checked", 0), meta.get("coverage", {})
    flagged = lambda f: [r["url"] for r in meta.get("pages", []) if f in r["flags"]]  # noqa: E731
    if n:
        for flag, key, area, title, why, how, impact in (
            ("missing_title", "meta-titles", "metadata", "Write a unique title for every page", "Pages without a title are shown as the URL in Google.", "50-60 characters, main keyword near the start, brand last. See the suggested titles.", "High"),
            ("duplicate_title", "dup-titles", "metadata", "Make duplicate titles unique", "Pages sharing a title compete with each other.", "Give each page a title that names what is different about it.", "Medium"),
            ("title_length", "title-length", "metadata", "Fix titles that are too short or too long", "Titles outside 25-60 characters are cut off or waste space.", "Rewrite to 50-60 characters.", "Medium"),
            ("missing_description", "meta-descriptions", "metadata", "Write a meta description for every page", "Without one, Google picks random text for the snippet.", "140-158 characters, one benefit and a call to action. See the suggested descriptions.", "High"),
            ("duplicate_description", "dup-descriptions", "metadata", "Make duplicate meta descriptions unique", "Identical snippets make pages look the same in results.", "Write one per page.", "Low"),
            ("description_length", "description-length", "metadata", "Fix meta descriptions that are too short or too long", "Descriptions outside 70-160 characters are cut off or too thin to earn the click.", "Rewrite to about 150 characters.", "Low"),
            ("missing_canonical", "canonical", "metadata", "Add a canonical tag to every page", "Without canonicals, URL variants (with/without www, parameters) can split ranking signals.", "Add <link rel=\"canonical\" href=\"the clean URL\"> on every page; SEO plugins and frameworks do this automatically.", "Medium"),
            ("incomplete_open_graph", "open-graph", "metadata", "Add Open Graph tags (title, description, image)", "Links shared on WhatsApp, Facebook and LinkedIn show a bare or wrong preview without them.", "Add og:title, og:description, og:image (1200x630), og:type and og:url to every page.", "Medium"),
            ("missing_twitter_card", "twitter-card", "metadata", "Add the Twitter/X card tag", "Shared links on X are shown without a large preview.", "Add <meta name=\"twitter:card\" content=\"summary_large_image\">.", "Low"),
            ("missing_lang", "html-lang", "metadata", "Set the page language (<html lang>)", "Helps search engines and screen readers pick the right language.", "Add lang=\"en\" (or the right code) to the <html> tag.", "Low"),
            ("h1_count", "h1", "metadata", "Use exactly one H1 per page", "Pages with no H1, or several, send a muddled topic signal.", "One H1 describing the page, then H2s for sections.", "Medium"),
        ):
            urls = flagged(flag)
            if urls:
                recs.append(_rec(key, area, title, why, how, impact, "quick" if len(urls) <= 3 else "medium", "metadata", pages=urls[:20], count=len(urls)))
        if not meta.get("has_favicon"):
            recs.append(_rec("favicon", "metadata", "Add a favicon", "No favicon link was found; the brand icon is missing from browser tabs and mobile search results.", "Add a 512x512 PNG and link it with <link rel=\"icon\">.", "Low", "quick"))
        types = " ".join(meta.get("schema_types", []))
        local_ok = bool(re.search(r"LocalBusiness|Organization|Store|Restaurant|Dentist|MedicalBusiness|ProfessionalService|HomeAndConstructionBusiness", types))
        if not local_ok:
            recs.append(_rec("schema-local", "seo", "Add LocalBusiness (or Organization) schema with sameAs links", "No business schema was found, so Google and AI assistants must guess the name, address, hours and profiles.",
                             "Add JSON-LD with name, address, phone, hours, geo, logo and sameAs (Google Business Profile, social profiles) to the home and contact pages. Use the Schema Studio.", "High", "quick", "metadata"))
        if b.faqs and "FAQPage" not in types:
            recs.append(_rec("schema-faq", "seo", f"Publish the client's {len(b.faqs)} FAQs on the site with FAQPage schema", "The profile already has questions and answers; marking them up makes them eligible for rich results and AI answers.",
                             "Add an FAQ section to the relevant page and the FAQPage JSON-LD (Schema Studio generates it from the profile).", "Medium", "quick", "business"))
        if b.services and not ({"Service", "Product", "Offer"} & set(meta.get("schema_types", []))):
            recs.append(_rec("schema-service", "seo", "Add Service schema to the service pages", "No Service/Product markup was found.", "Add a Service JSON-LD block (name, description, areaServed, provider) to each service page.", "Medium", "medium", "business"))

    # 4. what the client's own profile asks for
    if n:
        missing_services = [s for s in _services(b, 8) if not _has_page_for(s, pages)]
        if missing_services:
            recs.append(_rec("service-pages", "content", f"Create a dedicated page for each service ({len(missing_services)} missing)", "Google ranks pages, not businesses: a service without its own page rarely ranks for that search.",
                             "One page per service: H1 with the service, who it is for, process, pricing range if available, FAQs, and a clear call to action. Missing: " + ", ".join(missing_services), "High", "large", "business", topics=missing_services))
        areas = [a for a in (b.target_areas or []) if a][:8]
        missing_areas = [a for a in areas if not _has_page_for(a.split(",")[0], pages)]
        if missing_areas:
            recs.append(_rec("area-pages", "content", f"Create location pages for the target areas ({len(missing_areas)} missing)", "Local searches ('service in area') need a page that names the area and proves the business serves it.",
                             "A useful page per area (not a copy with the name swapped): how the service works there, landmarks, nearby customers' questions. Missing: " + ", ".join(missing_areas), "Medium", "large", "business", topics=missing_areas))
        if b.target_scope == "international" and not any(p.get("hreflang") for p in pages):
            recs.append(_rec("hreflang", "technical", "Add hreflang tags for the target countries", "The business targets other countries but no hreflang annotations were found.", "Add rel=\"alternate\" hreflang links for each language/country version, including x-default.", "Medium", "medium", "business"))
        if not b.gbp_location:
            recs.append(_rec("gbp-link", "seo", "Link the Google Business Profile and embed the map on the site", "The profile is not connected to a Google listing yet; the site and the listing should confirm each other.", "Connect the listing under Google Integrations, add the Maps embed and the profile link (sameAs) to the contact page.", "Medium", "quick", "business"))
    return recs


def ai_recommendations(b: Business, stack: dict[str, Any], meta: dict[str, Any], existing: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Extra ideas from the AI, built only on the findings above. Returns [] when AI is not set up or answers badly."""
    if not ai.is_configured():
        return []
    try:
        out = ai.complete_json(
            f"You are a senior technical SEO. Suggest improvements for one client website.\n{ai.RULES}\n- Do not repeat anything already in the list. Each idea must be actionable this month and specific to this platform and business.",
            f"Business profile:\n{ai.profile_text(b)}\n\nPlatform: {stack.get('label')} {stack.get('version') or ''}\nStack: {', '.join(stack.get('stack', []))}\nMetadata coverage (%): {meta.get('coverage')}\n"
            f"Already recommended: {[r['title'] for r in existing]}\n"
            'Return JSON {"ideas":[{"title": string, "why": string, "how": string, "impact": "High"|"Medium"|"Low", "area": "technical"|"metadata"|"content"|"seo"}]} with at most 5 ideas.')
        recs = []
        for i in out.get("ideas", [])[:5]:
            if isinstance(i, dict) and i.get("title") and i.get("how"):
                slug = re.sub(r"[^a-z0-9]+", "-", str(i["title"]).lower()).strip("-")[:60]
                recs.append(_rec(f"ai-{slug}", i.get("area") if i.get("area") in ("technical", "metadata", "content", "seo") else "seo", str(i["title"])[:200],
                                 str(i.get("why", ""))[:500], str(i["how"])[:800], i.get("impact") if i.get("impact") in IMPACT_ORDER else "Medium", "medium", "ai"))
        return recs
    except Exception as exc:  # noqa: BLE001
        logger.info("AI recommendations skipped: %s", exc)
        return []


# --- running the research -----------------------------------------------------------------------------------------------------------------------

def get(db: Session, b: Business) -> SiteProfile | None:
    return db.scalar(select(SiteProfile).where(SiteProfile.business_id == b.id))


def _onpage_pages(db: Session, b: Business, refresh: bool) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """The crawled pages of the latest on-page audit; a fresh crawl when there is none, it is over a day old, or it predates the metadata fields."""
    latest = audits.latest(db, b).get("onpage")
    pages = (latest.result or {}).get("pages") if latest else None
    stale = (not latest or not pages or "og_title" not in pages[0] or refresh or (latest.finished_at and _aware(latest.finished_at) < _now() - timedelta(days=1)))
    if stale:
        latest = audits.run(db, b, "onpage")
        pages = (latest.result or {}).get("pages") if latest.status == "done" else None
    return pages or [], (latest.result if latest and latest.status == "done" else {}) or {}


def run(db: Session, b: Business, refresh: bool = False) -> SiteProfile:
    """Research the client's website and save what was found. Never raises: a failure is saved on the profile."""
    prof = get(db, b) or SiteProfile(business_id=b.id)
    prof.status, prof.error = "running", None
    db.add(prof)
    db.commit()
    try:
        if not b.website:
            prof.stack, prof.site_checks, prof.metadata_audit, prof.suggested_metadata = {}, {}, {}, []
            prof.recommendations = [_rec("website", "technical", "Get a website live", "The client has no website on file; most SEO work depends on one.", "Build one from the profile (Website Builder) or add the address under the client's details.", "High", "large", "business")]
            prof.summary = "No website on file yet."
        else:
            stack = site_onboarding.detect_and_store(db, b) or (db.scalar(select(SiteIntegration.detected).where(SiteIntegration.business_id == b.id)) or {})
            if not stack:
                stack = {"platform": "unknown", "label": "Unknown", "reachable": False, "stack": [], "details": {}}
            pages, crawl = _onpage_pages(db, b, refresh)
            checks = site_checks(b.website, crawl)
            meta = metadata_audit(pages)
            recs = build_recommendations(stack, checks, meta, b, pages)
            recs += ai_recommendations(b, stack, meta, recs)
            recs.sort(key=lambda r: IMPACT_ORDER.get(r["impact"], 1))
            prof.stack, prof.site_checks, prof.metadata_audit = stack, checks, meta
            prof.suggested_metadata = suggest_metadata(meta, b)
            prof.recommendations = recs
            high = sum(1 for r in recs if r["impact"] == "High")
            prof.summary = (f"{stack.get('label', 'Unknown')}{' ' + stack['version'] if stack.get('version') else ''} site; {meta.get('pages_checked', 0)} pages checked, metadata score "
                            f"{meta.get('score') if meta.get('score') is not None else 'n/a'}/100; {len(recs)} improvements found ({high} high impact).")
        prof.status, prof.scanned_at = "done", _now()
        log(db, "research", "site_research_done", b.id, recommendations=len(prof.recommendations))
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        prof = get(db, b) or prof
        prof.status, prof.error = "failed", str(exc)[:1000]
        logger.exception("Site research failed for business %s", b.id)
    db.add(prof)
    db.commit()
    return prof
