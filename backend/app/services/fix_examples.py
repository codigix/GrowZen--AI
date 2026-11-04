"""For each task: where to make the change (the menu path on the site's own platform) and a filled-in dummy example of the change, written with the client's
own name, city, service and page. Pure functions, no network."""
import re
from typing import Any
from urllib.parse import urlparse

WHERE: dict[str, dict[str, str]] = {  # fix group -> platform -> menu path ("{page}" is the page's name)
    "meta": {
        "wordpress": "WP Admin > Pages > {page} > Edit > scroll below the editor to the Yoast SEO / Rank Math box > SEO title / Meta description > Update",
        "shopify": "Shopify Admin > Online Store > Pages (or Products / Collections) > {page} > Search engine listing > Edit > Page title / Meta description > Save",
        "wix": "Wix Editor > Pages menu > {page} > ... > SEO basics > Title tag / Meta description > Publish",
        "squarespace": "Pages > hover {page} > gear icon > SEO tab > SEO title / SEO description > Save",
        "webflow": "Designer > Pages panel > {page} > gear icon > SEO Settings > Title tag / Meta description > Publish",
        "nextjs": "Code: app/{route}/page.tsx > export `metadata` (or generateMetadata) > commit and deploy",
        "spa": "Code: the route's component > set the title and description with react-helmet-async (or @unhead/vue) > build and deploy",
        "generic": "Open the {page} HTML file or CMS editor > find the <head> section > add or edit the tag > save and publish",
    },
    "head": {
        "wordpress": "WP Admin > Plugins > Add New > install 'WPCode' > Code Snippets > Header & Footer > paste in Header > Save (or Rank Math > Titles & Meta / Schema)",
        "shopify": "Shopify Admin > Online Store > Themes > Edit code > Layout > theme.liquid > paste just before </head> > Save",
        "wix": "Wix Dashboard > Settings > Custom Code > Add Code > paste > place in Head > choose the pages > Apply",
        "squarespace": "Settings > Developer Tools > Code Injection > Header > paste > Save",
        "webflow": "Project Settings > Custom Code > Head Code (site-wide), or Page Settings > Custom Code > Inside <head> tag > Publish",
        "nextjs": "Code: app/layout.tsx (site-wide) or the page's page.tsx > render the <script type=\"application/ld+json\"> / meta tag > deploy",
        "spa": "Code: public/index.html <head> (site-wide) or the route's Helmet block > paste > build and deploy",
        "generic": "Open the template file that renders <head> (for example header.php or index.html) > paste before </head> > save and upload",
    },
    "social": {
        "wordpress": "WP Admin > Pages > {page} > Edit > Yoast SEO / Rank Math box > Social tab > Facebook / X: Title, Description, Image (1200x630) > Update",
        "shopify": "Shopify Admin > Online Store > Preferences > Social sharing image > upload (1200x630) > Save; titles come from each page's Search engine listing",
        "wix": "Wix Editor > Pages menu > {page} > ... > SEO basics > Social share > Title, Description, Image > Publish",
        "squarespace": "Pages > hover {page} > gear icon > Social Image tab > upload > Save (title and description come from the SEO tab)",
        "webflow": "Designer > Pages panel > {page} > gear icon > Open Graph Settings > Title, Description, Image > Publish",
    },
    "content": {
        "wordpress": "WP Admin > Pages > {page} > Edit > click the heading or image in the editor > change it in the block settings (image: Alt text, on the right) > Update",
        "shopify": "Shopify Admin > Online Store > Pages > {page} > edit the content (image: click it > Edit alt text) > Save",
        "wix": "Wix Editor > open {page} > click the text or image > Settings (image: Alt text) > Publish",
        "squarespace": "Pages > {page} > Edit > click the block > edit the text (image: gear > Alt text) > Save",
        "webflow": "Designer > open {page} > select the element > Element Settings (image: Alt text) > Publish",
        "nextjs": "Code: the page's component under app/{route} > edit the JSX (image: alt prop) > deploy",
        "spa": "Code: the route's component > edit the JSX (image: alt prop) > build and deploy",
        "generic": "Open the {page} file or CMS editor > edit the heading, text or image tag > save and publish",
    },
    "files": {
        "wordpress": "WP Admin > Yoast SEO > Tools > File editor (robots.txt), and Yoast SEO > Settings > Site features > XML sitemaps ON (Rank Math: General Settings > Edit robots.txt / Sitemap Settings)",
        "shopify": "Shopify creates /sitemap.xml itself. For robots.txt: Online Store > Themes > Edit code > Add a new template > robots.txt.liquid",
        "wix": "Wix creates the sitemap automatically. Robots: Marketing & SEO > SEO Tools > Robots.txt Editor",
        "squarespace": "The sitemap is automatic at /sitemap.xml. To hide a page: Pages > page settings > SEO > Hide this page from search results",
        "webflow": "Project Settings > SEO > Indexing > Auto-generate sitemap ON, and the Robots.txt box > Publish",
        "nextjs": "Code: create app/sitemap.ts and app/robots.ts (or put robots.txt in /public) > deploy",
        "spa": "Code: put robots.txt and sitemap.xml in the /public folder > build and deploy",
        "generic": "Create the file in the site's root folder (next to index.html) with FTP or the hosting File Manager > open it in the browser to confirm",
    },
    "server": {
        "wordpress": "Hosting panel (cPanel > SSL/TLS) to install the certificate, then WP Admin > Settings > General: set both URLs to https:// (a plugin such as Really Simple SSL adds the redirect)",
        "shopify": "Shopify Admin > Settings > Domains > check SSL is 'Enabled' and 'Redirect to primary domain' is ON",
        "wix": "Wix Dashboard > Settings > Domains > make sure the domain is connected (HTTPS is automatic)",
        "squarespace": "Settings > Domains > SSL > Secure (HTTPS) ON",
        "webflow": "Project Settings > Hosting > Enable SSL > turn on 'Force HTTPS' > Publish",
        "nextjs": "Host settings (Vercel/Netlify: Domains > Force HTTPS) and the `headers()` function in next.config.js for security headers > deploy",
        "spa": "Host or CDN settings: turn on Force HTTPS and add the response headers (Cloudflare > Rules > Transform Rules)",
        "generic": "Server config (nginx, Apache or .htaccess) or the CDN's rules page > add the redirect or header > reload the server",
    },
}


def _group(text: str) -> str:
    t = text.lower()
    if any(w in t for w in ("sitemap", "robots", "llms")):
        return "files"
    if any(w in t for w in ("https", "ssl", "security header", "compression", "brotli", "gzip", "cdn", "cache")):
        return "server"
    if any(w in t for w in ("open graph", "og:", "twitter", "social")):
        return "social"
    if any(w in t for w in ("schema", "structured", "json-ld", "viewport", "analytics", "tag manager", "favicon", "hreflang", "html lang", "page language")):
        return "head"
    if any(w in t for w in ("h1", "heading", "thin", "alt text", "images without", "words", "page for each", "location pages", "dedicated page", "faq section")):
        return "content"
    return "meta"


def _platform_key(platform: str | None) -> str:
    p = (platform or "").lower()
    if p in ("wordpress", "shopify", "wix", "squarespace", "webflow", "nextjs"):
        return p
    if p in ("react", "vue", "angular", "svelte", "nuxt", "gatsby", "astro", "remix", "sveltekit"):
        return "spa"
    return "generic"


def _base(website: str | None) -> str:
    w = (website or "").strip()
    if not w:
        return ""
    p = urlparse(w if w.startswith("http") else f"https://{w}")
    return f"{p.scheme}://{p.netloc}"


def example_snippet(text: str, biz: dict[str, str], url: str) -> tuple[str, str] | None:
    """A filled-in dummy fix for the problem in `text`. Returns (language, code), or None when no example fits."""
    t = text.lower()
    name, city, cat = biz.get("name") or "Your Business", biz.get("city") or "your city", biz.get("category") or "Local business"
    svc = biz.get("service") or cat
    base = _base(biz.get("website")) or "https://www.example.com"
    url = url or base + "/"
    phone = biz.get("phone") or "+91 00000 00000"
    slug = re.sub(r"[^a-z0-9]+", "-", svc.lower()).strip("-")
    if "llms" in t:
        return "text", f"# {name}\n> {cat} in {city}. We offer {svc} and more.\n\n## Main pages\n- [Services]({base}/services): what we do\n- [Contact]({base}/contact): phone, address, hours\n"
    if "sitemap" in t:
        return "text", f"# robots.txt (in the site root)\nUser-agent: *\nAllow: /\n\nSitemap: {base}/sitemap.xml"
    if "robots" in t:
        return "text", "# Remove this line:\n# Disallow: /\n\nUser-agent: *\nAllow: /"
    if "https" in t:
        return "text", "# .htaccess (Apache)\nRewriteEngine On\nRewriteCond %{HTTPS} off\nRewriteRule ^(.*)$ https://%{HTTP_HOST}/$1 [R=301,L]"
    if "security header" in t:
        return "text", "# nginx\nadd_header Strict-Transport-Security \"max-age=31536000; includeSubDomains\" always;\nadd_header X-Content-Type-Options \"nosniff\" always;\nadd_header Referrer-Policy \"strict-origin-when-cross-origin\" always;"
    if "compression" in t or "brotli" in t or "gzip" in t:
        return "text", "# nginx\ngzip on;\ngzip_types text/css application/javascript application/json image/svg+xml;"
    if "javascript" in t or "server-side" in t or "pre-render" in t or "ssr" in t:
        return "js", (f"// Next.js: app/page.tsx sends real HTML from the server\nexport const metadata = {{ title: '{name} | {cat} in {city}' }};\n"
                      f"export default function Home() {{\n  return <main><h1>{cat} in {city}</h1><p>{name} offers {svc}. Call us today.</p></main>;\n}}")
    if "noindex" in t:
        return "html", "<!-- Remove this tag from the page you want in Google -->\n<meta name=\"robots\" content=\"noindex\">\n\n<!-- Use this instead (or nothing at all) -->\n<meta name=\"robots\" content=\"index, follow\">"
    if "viewport" in t:
        return "html", "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
    if "faq" in t:
        return "html", (f"<script type=\"application/ld+json\">\n{{\n  \"@context\": \"https://schema.org\",\n  \"@type\": \"FAQPage\",\n  \"mainEntity\": [{{\n    \"@type\": \"Question\",\n"
                        f"    \"name\": \"How much does {svc} cost in {city}?\",\n    \"acceptedAnswer\": {{ \"@type\": \"Answer\", \"text\": \"Prices start from [add price]. Call {name} for an exact quote.\" }}\n  }}]\n}}\n</script>")
    if "schema" in t and "service" in t:
        return "html", (f"<script type=\"application/ld+json\">\n{{\n  \"@context\": \"https://schema.org\",\n  \"@type\": \"Service\",\n  \"name\": \"{svc}\",\n"
                        f"  \"provider\": {{ \"@type\": \"LocalBusiness\", \"name\": \"{name}\" }},\n  \"areaServed\": \"{city}\"\n}}\n</script>")
    if "schema" in t or "structured" in t or "localbusiness" in t:
        return "html", (f"<script type=\"application/ld+json\">\n{{\n  \"@context\": \"https://schema.org\",\n  \"@type\": \"LocalBusiness\",\n  \"name\": \"{name}\",\n  \"url\": \"{base}/\",\n"
                        f"  \"telephone\": \"{phone}\",\n  \"address\": {{ \"@type\": \"PostalAddress\", \"addressLocality\": \"{city}\", \"addressCountry\": \"IN\" }},\n"
                        f"  \"sameAs\": [\"[your Google Maps listing link]\", \"[your Instagram link]\"]\n}}\n</script>")
    if "open graph" in t or "og:" in t:
        return "html", (f"<meta property=\"og:type\" content=\"website\">\n<meta property=\"og:title\" content=\"{name} | {cat} in {city}\">\n"
                        f"<meta property=\"og:description\" content=\"{name} offers {svc} in {city}. Book today.\">\n<meta property=\"og:image\" content=\"{base}/images/share-1200x630.jpg\">\n<meta property=\"og:url\" content=\"{url}\">")
    if "twitter" in t:
        return "html", "<meta name=\"twitter:card\" content=\"summary_large_image\">"
    if "canonical" in t:
        return "html", f"<link rel=\"canonical\" href=\"{url}\">"
    if "html lang" in t or "page language" in t:
        return "html", "<html lang=\"en\">"
    if "favicon" in t:
        return "html", "<link rel=\"icon\" type=\"image/png\" href=\"/favicon-512.png\">"
    if "analytics" in t or "tag manager" in t:
        return "html", ("<!-- Google tag: replace G-XXXXXXX with your GA4 measurement id -->\n<script async src=\"https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX\"></script>\n"
                        "<script>\n  window.dataLayer = window.dataLayer || [];\n  function gtag(){dataLayer.push(arguments);}\n  gtag('js', new Date()); gtag('config', 'G-XXXXXXX');\n</script>")
    if "alt text" in t or "images without" in t:
        return "html", f"<!-- Before -->\n<img src=\"/images/team.jpg\">\n<!-- After -->\n<img src=\"/images/team.jpg\" alt=\"{name} team at work in {city}\">"
    if "h1" in t or "heading" in t:
        return "html", f"<!-- one H1 per page, then H2 for each section -->\n<h1>{svc} in {city}</h1>\n<h2>Why choose {name}</h2>\n<h2>How it works</h2>"
    if "thin" in t:
        return "text", f"{svc} in {city} (aim for 400+ words)\n- What it is and who it is for\n- How {name} does it, step by step\n- Price range and what affects it\n- 3 questions customers ask (FAQ)\n- Call to action: phone or booking link"
    if "page for each" in t or "location pages" in t or "dedicated page" in t:
        return "text", f"{base}/services/{slug}\n  H1: {svc} in {city}\n  Sections: overview, process, pricing, FAQ, contact form\n  Title: {svc} in {city} | {name}"
    if "description" in t:
        return "html", f"<meta name=\"description\" content=\"{name} offers {svc} in {city}. Friendly experts, clear prices. Call or book online today.\">"
    if "title" in t:
        return "html", f"<title>{svc} in {city} | {name}</title>"
    return None


def fix_help(text: str, platform: str | None, biz: dict[str, str], url: str | None, page: str | None) -> dict[str, Any]:
    """{where: [menu steps], platform, example: {language, code}} for one task."""
    group, key = _group(text), _platform_key(platform)
    steps = (WHERE[group].get(key) or WHERE["head"][key]).replace("{page}", page or "the page").replace("{route}", (page or "page").lower().replace(" ", "-") if page and page != "Home" else "")
    ex = example_snippet(text, biz, url or "")
    return {"where": [s.strip() for s in steps.split(" > ")], "platform": platform or "unknown", **({"example": {"language": ex[0], "code": ex[1]}} if ex else {})}
