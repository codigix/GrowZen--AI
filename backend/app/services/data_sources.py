"""Where every value shown in the software comes from, and which pages show it.

One list for the whole product (Settings > Data sources). A new source or a new page that uses one is added HERE, so the list stays the single answer to "where did this number
come from?". `status()` adds what the server knows without calling anyone: whether the source is switched on (keys and settings present) and, for per-project Google sources, how many
projects are linked. Nothing secret is ever returned: only whether a key exists.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import Settings
from ..models import Business

# page = (label, path). Paths are the sidebar addresses.
P = {
    "overview": ("Dashboard (all projects)", "/gmb-profile/overview"), "project": ("Project overview", "/gmb-profile/project"), "profile": ("Business profile", "/gmb-profile/profile"),
    "perf": ("Performance", "/gmb-profile/performance"), "gtraffic": ("Website traffic (profile)", "/gmb-profile/traffic"), "reviews": ("Reviews & replies", "/reviews"),
    "posts": ("Google posts", "/google-posts"), "photos": ("Photos", "/media-management"), "reports": ("Monthly reports and client link", "/gmb-profile/reports"),
    "competitors": ("Maps competitors", "/gmb-profile/competitors"), "localseo": ("Local SEO", "/gmb-profile/local-seo"), "citations": ("Listing management (citations)", "/off-page-seo/citations"),
    "mapgrid": ("Map rank tracker", "/rank-tracking/geo"), "indexing": ("Page indexing", "/page-indexing"), "domain": ("Domain overview", "/domain-overview"),
    "traffic": ("Traffic analytics", "/traffic"), "insights": ("Search insights", "/search-insights"), "organic": ("Organic rankings", "/organic-rankings"), "toppages": ("Top pages", "/top-pages"),
    "kwtracked": ("Keyword management", "/keyword-management/tracked"), "kwfind": ("Find keywords", "/keyword-management/ai"), "kwtrends": ("Trends", "/ai-content-generation/trends"),
    "blog": ("AI content: blog", "/ai-content-generation/blog"), "audit": ("Website audit", "/website-audit"), "xray": ("Page X-Ray", "/page-xray"), "backlinks": ("Backlinks", "/backlinks/links"),
    "blcheck": ("Backlink checker", "/backlink-checker"), "geo": ("AI visibility (GEO / AEO)", "/geo-optimization"), "automation": ("AI tasks and approvals", "/automation"),
    "growth": ("Growth plan", "/growth"), "onboarding": ("Onboarding and new projects", "/onboarding"), "tasks": ("Tasks and activities", "/gmb-profile/tasks"), "sync": ("Sync and history", "/gmb-profile/sync"),
    "settings": ("Settings", "/gmb-profile/settings"), "client": ("Client live report (public link)", "/gmb-profile/reports"),
}


def _pages(*keys: str) -> list[dict[str, str]]:
    return [{"label": P[k][0], "path": P[k][1]} for k in keys]


def _linked_projects(db: Session) -> int:
    return int(db.scalar(select(func.count()).select_from(Business).where(Business.gbp_location.is_not(None), Business.connection_id.is_not(None))) or 0)


def registry(s: Settings, db: Session) -> list[dict[str, Any]]:
    linked = _linked_projects(db)
    ai_on = bool(s.deepseek_api_key or s.openai_api_key or s.gemini_api_key or s.llamacpp_base_url)
    engines = [n for n, k in (("ChatGPT", s.openai_api_key), ("Gemini", s.gemini_api_key), ("Perplexity", s.perplexity_api_key), ("Claude", s.anthropic_api_key), ("DeepSeek", s.deepseek_api_key)) if k]

    def src(key: str, name: str, kind: str, provides: str, pages: list[dict[str, str]], on: bool, how: str, note: str = "") -> dict[str, Any]:
        return {"key": key, "name": name, "kind": kind, "provides": provides, "pages": pages, "on": bool(on), "how": how, "note": note}

    return [
        src("gbp", "Google Business Profile API", "Google", "The profile as Google holds it: name, categories, address, phone, hours, services, attributes, booking links, reviews and replies, posts, photos, calls, directions, website clicks and views.",
            _pages("overview", "project", "profile", "perf", "reviews", "posts", "photos", "reports", "tasks", "sync", "client"), s.google_oauth_enabled, "Each project connects its own Google account (Google accounts window).",
            f"{linked} project{'s' if linked != 1 else ''} linked" if s.google_oauth_enabled else "Google sign-in is not set up on the server"),
        src("gsc", "Google Search Console API", "Google", "Clicks, impressions, click-through rate, average position, queries, pages, countries and devices from Google Search; page indexing status and per-page inspection.",
            _pages("domain", "indexing", "insights", "organic", "toppages", "kwtracked", "gtraffic"), s.google_oauth_enabled, "Linked per project through its Google account (the account must own the site in Search Console)."),
        src("ga4", "Google Analytics 4 Data API", "Google", "Website visitors, sessions, channels, pages, audiences, key events, and the visits that arrive from each Google post button.",
            _pages("traffic", "gtraffic", "posts", "reports"), s.google_oauth_enabled, "Linked per project through its Google account."),
        src("places", "Google Places API (New)", "Google", "Public Google Maps data: finding a business, ratings, review counts, competitors around a point and the local rank grid.",
            _pages("mapgrid", "competitors", "localseo", "onboarding", "reviews"), bool(s.google_places_api_key or s.google_api_key), "GOOGLE_PLACES_API_KEY (or GOOGLE_API_KEY) on the server."),
        src("ads", "Google Ads Keyword Planner API", "Google", "Search volume, competition and cost-per-click ranges for keywords.", _pages("kwfind", "kwtracked", "growth"), s.google_ads_enabled,
            "Google Ads developer token, client and customer id on the server."),
        src("trends", "Google Trends", "Google", "How interest in a topic moves over time, and rising related searches.", _pages("kwtrends", "kwfind"), s.google_trends_enabled, "Read from the public Trends service; no key."),
        src("pagespeed", "PageSpeed Insights / Lighthouse", "Google", "Speed, accessibility, best-practice and SEO scores of a page, and what to fix.", _pages("audit", "xray"), bool(s.pagespeed_api_key) or s.lighthouse_local_enabled,
            "PAGESPEED_API_KEY, or Lighthouse run on the server itself."),
        src("crawl", "Our website crawler", "Our own tools", "What is on the site's own pages: titles, descriptions, headings, links, schema, speed and errors, read by fetching the pages.", _pages("audit", "xray", "citations", "onboarding"), True,
            "Built in: it only fetches the project's own public pages."),
        src("backlinks", "Our backlink discovery bot", "Our own tools", "Links found pointing to the site, referring domains, anchors, and links gained or lost.", _pages("backlinks", "blcheck", "domain", "reports"),
            s.crawler_enabled, "CRAWLER_URL and CRAWLER_API_KEY on the server."),
        src("openpr", "Open PageRank", "Open data", "A 0 to 10 rank of a linking domain, shown in the backlink checker.", _pages("blcheck"), bool(s.openpagerank_api_key), "OPENPAGERANK_API_KEY on the server (free)."),
        src("serper", "Serper.dev (Google results)", "Open data", "Google search results used to find listing sites and platforms that take links.", _pages("citations", "blcheck"), bool(s.serper_api_key), "SERPER_API_KEY on the server."),
        src("osm", "OpenStreetMap (Photon, Nominatim)", "Open data", "Business-name and address suggestions while onboarding.", _pages("onboarding"), s.osm_lookup_enabled, "No key; can be switched off."),
        src("indexnow", "IndexNow", "Open data", "Tells search engines a page was added or changed (Bing and others).", _pages("indexing"), True, "A key file on the project's website."),
        src("ai", "AI writing models", "AI", "Drafts: posts, review replies, profile text, articles, summaries and suggestions. Nothing is published without approval.", _pages("posts", "reviews", "blog", "automation", "reports", "kwfind", "growth"),
            ai_on, f"AI_PROVIDER = {s.ai_provider} (DeepSeek, OpenAI, Gemini or a local model)."),
        src("engines", "AI answer engines", "AI", "Whether ChatGPT, Gemini, Perplexity, Claude and others name the business when asked, and which pages they cite.", _pages("geo"), bool(engines),
            "An API key per engine on the server.", f"On: {', '.join(engines)}" if engines else "No engine key set"),
        src("mail", "Email (SMTP and IMAP)", "System", "Sends reports and alerts; reads the onboarding mailbox.", _pages("reports", "onboarding"), bool(s.smtp_host and s.smtp_from) or s.imap_enabled, "SMTP_* and INTAKE_IMAP_* on the server."),
        src("calc", "Calculated by the software", "Software", "Scores, trends, month-by-month changes, health and strength checks worked out from the data above. Never an outside figure.", _pages("overview", "project", "reports", "growth", "audit", "localseo"), True, "Built in."),
        src("manual", "Entered by you", "Software", "What a person typed or approved: services, descriptions, listing links, replies, posts and settings.", _pages("profile", "posts", "reviews", "citations", "settings"), True, "Built in."),
        src("sample", "Sample data", "Software", "Made-up numbers shown only where a real source is not connected, and always labelled as sample.", _pages("mapgrid"), bool(s.allow_sample_data), "ALLOW_SAMPLE_DATA on the server."),
    ]
