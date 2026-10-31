"""Reading a website's technology: which CMS or framework builds it, what language and server run it, where it is hosted, and what it loads.

Everything comes from what any visitor can see: the homepage HTML, the response headers and cookies, and two harmless public probes (`/wp-json/` and
Ghost's `/ghost/api/admin/site/`). Each finding carries its evidence, so the answer can be checked, and a platform is only called "high confidence" when
several independent signs agree. The result also says how blog posts can reach that kind of site (`publishing`), because that is what the answer is for.
"""
import re
from collections import defaultdict
from urllib.parse import urlsplit

import httpx

from .net import site_client
from .url_safety import SSRFValidationError, validate_url_shape

# platform key -> (label, group). Group decides how posts can be delivered; see PUBLISHING.
PLATFORMS: dict[str, tuple[str, str]] = {
    "wordpress": ("WordPress", "cms"), "ghost": ("Ghost", "cms"), "shopify": ("Shopify", "cms"), "wix": ("Wix", "closed"), "squarespace": ("Squarespace", "closed"),
    "webflow": ("Webflow", "closed"), "drupal": ("Drupal", "closed"), "joomla": ("Joomla", "closed"), "magento": ("Magento", "closed"), "bigcommerce": ("BigCommerce", "closed"),
    "hubspot": ("HubSpot CMS", "closed"), "framer": ("Framer", "closed"), "duda": ("Duda", "closed"), "weebly": ("Weebly", "closed"), "godaddy": ("GoDaddy Website Builder", "closed"),
    "blogger": ("Blogger", "closed"), "tilda": ("Tilda", "closed"),
    "nextjs": ("Next.js", "code"), "nuxt": ("Nuxt", "code"), "gatsby": ("Gatsby", "code"), "astro": ("Astro", "code"), "remix": ("Remix", "code"), "sveltekit": ("SvelteKit", "code"),
    "docusaurus": ("Docusaurus", "code"), "hugo": ("Hugo", "code"), "jekyll": ("Jekyll", "code"), "eleventy": ("Eleventy", "code"), "hexo": ("Hexo", "code"),
    "react": ("React app", "spa"), "vue": ("Vue app", "spa"), "angular": ("Angular app", "spa"), "svelte": ("Svelte app", "spa"),
    "static": ("Custom / static site", "code"), "unknown": ("Unknown", "closed"),
}
CLOSED_NOTE = ("{label} does not let other tools write blog posts through a public API that we can use, so posts cannot be pushed in automatically yet. "
               "You can still send each article to a signed webhook (for example into Zapier, Make or a small script) which creates the post.")
PUBLISHING = {  # group -> (recommended method, other methods that work, explanation)
    "cms": (None, ["webhook"], ""),
    "code": ("github", ["webhook"], "This site is built from code, so the post is added as a Markdown file in its Git repository; the site's host rebuilds automatically (Vercel, Netlify, GitHub Pages and similar)."),
    "spa": ("webhook", ["github"], "This looks like a client-side app. Posts need a place to live: either a signed webhook into your backend, or a Markdown file in the repository if the blog is built from files."),
    "closed": (None, ["webhook"], CLOSED_NOTE),
}
CMS_METHOD = {"wordpress": "wordpress", "ghost": "ghost", "shopify": "shopify"}
CMS_NOTE = {"wordpress": "WordPress accepts posts through its REST API: all you need is an Application Password.",
            "ghost": "Ghost accepts posts through its Admin API: create a Custom Integration and paste its Admin API key.",
            "shopify": "Shopify accepts blog articles through its Admin API: create a custom app with blog (content) access and paste its access token."}

_GENERATOR = re.compile(r'<meta[^>]+name=["\']generator["\'][^>]+content=["\']([^"\']+)["\']', re.I)
_GENERATOR_REV = re.compile(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']generator["\']', re.I)


class Findings:
    def __init__(self) -> None:
        self.score: dict[str, int] = defaultdict(int)  # platform -> weight
        self.evidence: list[str] = []
        self.versions: dict[str, str] = {}
        self.details: dict[str, list[str]] = defaultdict(list)  # category -> labels

    def platform(self, key: str, weight: int, why: str, version: str | None = None) -> None:
        self.score[key] += weight
        self.evidence.append(why)
        if version and key not in self.versions:
            self.versions[key] = version

    def tag(self, category: str, label: str, why: str | None = None) -> None:
        if label not in self.details[category]:
            self.details[category].append(label)
            if why:
                self.evidence.append(why)


def _cookie_names(set_cookie_headers: list[str]) -> set[str]:
    return {c.split("=", 1)[0].strip().lower() for c in set_cookie_headers if "=" in c}


def fingerprint(html: str, headers: dict[str, str], cookies: set[str], probes: dict[str, bool] | None = None) -> Findings:
    """Pure function: what the page, headers and cookies reveal. `headers` keys are lower-case."""
    f, probes, low = Findings(), probes or {}, (html or "").lower()
    gens = [g.strip() for g in _GENERATOR.findall(html or "") + _GENERATOR_REV.findall(html or "")]
    gen_low = " | ".join(gens).lower()
    server, powered, link = headers.get("server", ""), headers.get("x-powered-by", ""), headers.get("link", "")

    # --- CMS / site builders
    if "api.w.org" in link:
        f.platform("wordpress", 4, "WordPress REST API advertised in the response headers")
    if probes.get("wp_api"):
        f.platform("wordpress", 5, "/wp-json/ answers with the WordPress REST API")
    m = re.search(r"wordpress ([\d.]+)", gen_low)
    if m:
        f.platform("wordpress", 4, f"Generator tag: WordPress {m.group(1)}", m.group(1))
    if "/wp-content/" in low or "/wp-includes/" in low:
        f.platform("wordpress", 3, "Loads files from /wp-content/")
    if probes.get("ghost_api"):
        f.platform("ghost", 6, "Ghost Admin API answers at /ghost/api/admin/site/")
    m = re.search(r"ghost ([\d.]+)", gen_low)
    if m:
        f.platform("ghost", 5, f"Generator tag: Ghost {m.group(1)}", m.group(1))
    if "cdn.shopify.com" in low or "x-shopid" in headers or "x-shopify-stage" in headers:
        f.platform("shopify", 6, "Served by Shopify")
    elif "shopify.theme" in low:
        f.platform("shopify", 4, "Shopify theme script on the page")
    if "wixstatic.com" in low or "x-wix-request-id" in headers:
        f.platform("wix", 6, "Built with Wix")
    if "static1.squarespace.com" in low or "squarespace" in gen_low:
        f.platform("squarespace", 6, "Built with Squarespace")
    if "data-wf-site" in low or "assets.website-files.com" in low or "webflow" in gen_low:
        f.platform("webflow", 6, "Built with Webflow")
    m = re.search(r"drupal ([\d.]+)", gen_low) or re.search(r"drupal ([\d.]+)", headers.get("x-generator", "").lower())
    if m or "drupal-settings-json" in low or "/sites/default/files" in low:
        f.platform("drupal", 6 if m else 4, "Drupal markers (generator tag or /sites/default/files)", m.group(1) if m else None)
    if "joomla" in gen_low or "/media/jui/" in low or "/media/system/js/" in low:
        f.platform("joomla", 6, "Joomla markers (generator tag or /media/system)")
    if "/static/frontend/magento" in low or "mage-cache-storage" in low or "x-magento-cache-debug" in headers:
        f.platform("magento", 6, "Magento markers")
    if "cdn11.bigcommerce.com" in low or "bigcommerce" in gen_low:
        f.platform("bigcommerce", 6, "Built with BigCommerce")
    if "x-hs-hub-id" in headers or "hubspot" in gen_low:  # not hs-scripts.com: that is only the tracking script, found on countless WordPress sites
        f.platform("hubspot", 6, "Hosted on HubSpot CMS")
    if "framer" in gen_low or "framerusercontent.com" in low:
        f.platform("framer", 6, "Built with Framer")
    if "dmcdn.net" in low or "duda" in gen_low:
        f.platform("duda", 6, "Built with Duda")
    if "editmysite.com" in low or "weebly" in gen_low:
        f.platform("weebly", 6, "Built with Weebly")
    if "img1.wsimg.com" in low or "godaddy" in gen_low:
        f.platform("godaddy", 5, "Built with GoDaddy Website Builder")
    if "blogger" in gen_low:
        f.platform("blogger", 6, "Built on Blogger")
    if "tildacdn.com" in low or "tilda" in gen_low:
        f.platform("tilda", 6, "Built with Tilda")

    # --- code frameworks and static site generators
    if "/_next/static" in low or "__next_data__" in low or powered.lower().startswith("next"):
        f.platform("nextjs", 6, "Next.js build files (/_next/static)")
        f.tag("libraries", "React")
    if "/_nuxt/" in low or "__nuxt__" in low or "window.__nuxt" in low:
        f.platform("nuxt", 6, "Nuxt build files (/_nuxt/)")
        f.tag("libraries", "Vue")
    if "___gatsby" in low or "gatsby" in gen_low:
        f.platform("gatsby", 6, "Gatsby markers (___gatsby)")
        f.tag("libraries", "React")
    if "astro" in gen_low or "astro-island" in low or "data-astro-" in low:
        f.platform("astro", 6, "Astro markers")
    if "__remixcontext" in low:
        f.platform("remix", 6, "Remix markers (__remixContext)")
        f.tag("libraries", "React")
    if "/_app/immutable/" in low or "__sveltekit" in low:
        f.platform("sveltekit", 6, "SvelteKit build files (/_app/immutable)")
    if "docusaurus" in gen_low:
        f.platform("docusaurus", 6, "Generator tag: Docusaurus")
    for key, name in (("hugo", "hugo"), ("jekyll", "jekyll"), ("eleventy", "eleventy"), ("hexo", "hexo")):
        m = re.search(rf"{name} v?([\d.]+)", gen_low)
        if m or name in gen_low:
            f.platform(key, 6, f"Generator tag: {name.capitalize()}" + (f" {m.group(1)}" if m else ""), m.group(1) if m else None)
    if "ng-version=" in low:
        f.platform("angular", 6, "Angular markers (ng-version)")
    scripts = " ".join(re.findall(r'<script[^>]+src=["\']([^"\']+)', html or "", re.I)).lower()
    if "data-reactroot" in low or "__react_devtools_global_hook__" in low or re.search(r"/static/js/main\.[a-f0-9]+\.js", scripts) or re.search(r"react(?:-dom)?[.\-/@]", scripts):
        f.platform("react", 3, "React app markers (script names or data-reactroot)")
        f.tag("libraries", "React")
    if re.search(r"\sdata-v-[0-9a-f]{6,}", low) or re.search(r"vue(?:\.runtime)?[.\-/@]", scripts) or "__vue__" in low:
        f.platform("vue", 3, "Vue app markers")
        f.tag("libraries", "Vue")
    if re.search(r"svelte-[a-z0-9]{5,}", low):
        f.platform("svelte", 3, "Svelte markers")

    # --- language / backend
    m = re.search(r"php/?([\d.]+)?", powered, re.I)
    if m:
        f.tag("language", f"PHP {m.group(1)}" if m.group(1) else "PHP", "PHP reported in the X-Powered-By header")
    elif "phpsessid" in cookies:
        f.tag("language", "PHP", "PHP session cookie")
    if "asp.net" in powered.lower() or "x-aspnet-version" in headers or "asp.net_sessionid" in cookies:
        f.tag("language", "ASP.NET", "ASP.NET markers in headers or cookies")
    if "laravel_session" in cookies:
        f.tag("framework", "Laravel", "Laravel session cookie")
        f.tag("language", "PHP")
    if "csrftoken" in cookies and ("sessionid" in cookies or "django" in low):
        f.tag("framework", "Django", "Django cookies (csrftoken)")
        f.tag("language", "Python")
    if 'name="csrf-param" content="authenticity_token"' in low or "x-runtime" in headers and "_session" in " ".join(cookies):
        f.tag("framework", "Ruby on Rails", "Rails markers (authenticity_token / X-Runtime)")
        f.tag("language", "Ruby")
    if "express" in powered.lower():
        f.tag("framework", "Express", "X-Powered-By: Express")
        f.tag("language", "Node.js")
    if "jsessionid" in cookies:
        f.tag("language", "Java", "Java session cookie (JSESSIONID)")

    # --- hosting, CDN and web server
    if "cloudflare" in server.lower() or "cf-ray" in headers:
        f.tag("cdn", "Cloudflare", "Behind Cloudflare")
    if "vercel" in server.lower() or "x-vercel-id" in headers:
        f.tag("hosting", "Vercel", "Hosted on Vercel")
    if "netlify" in server.lower() or "x-nf-request-id" in headers:
        f.tag("hosting", "Netlify", "Hosted on Netlify")
    if "github.com" in server.lower():
        f.tag("hosting", "GitHub Pages", "Served by GitHub Pages")
    if "x-amz-cf-id" in headers or "cloudfront" in headers.get("via", "").lower():
        f.tag("cdn", "Amazon CloudFront", "Served through CloudFront")
    if "fastly" in headers.get("x-served-by", "").lower() or "x-fastly-request-id" in headers:
        f.tag("cdn", "Fastly")
    if "akamai" in server.lower():
        f.tag("cdn", "Akamai")
    if "wp engine" in powered.lower() or "wpe-backend" in headers.get("x-wpe-backend", "").lower() or "x-wpe-" in " ".join(headers):
        f.tag("hosting", "WP Engine", "Hosted on WP Engine")
    if "x-kinsta-cache" in headers:
        f.tag("hosting", "Kinsta", "Hosted on Kinsta")
    if "hostinger" in headers.get("platform", "").lower() or "hpanel" in headers.get("x-hosting-provider", "").lower():
        f.tag("hosting", "Hostinger")
    for pat, name in (("nginx", "nginx"), ("apache", "Apache"), ("litespeed", "LiteSpeed"), ("microsoft-iis", "IIS"), ("openresty", "OpenResty")):
        if pat in server.lower():
            f.tag("server", name)
            break

    # --- WordPress plugins, theme, e-commerce
    wp = "wordpress" in f.score
    if wp or "/wp-content/" in low:
        m = re.search(r"/wp-content/themes/([a-z0-9_\-]+)/", low)
        if m:
            f.tag("theme", m.group(1))
        for pat, name in (("elementor", "Elementor"), ("yoast", "Yoast SEO"), ("rank-math", "Rank Math"), ("rankmath", "Rank Math"), ("et_pb_", "Divi"), ("wpb_", "WPBakery"), ("vc_row", "WPBakery"),
                          ("wp-rocket", "WP Rocket"), ("wpcf7", "Contact Form 7"), ("jetpack", "Jetpack"), ("litespeed", "LiteSpeed Cache")):
            if pat in low:
                f.tag("plugins", name)
        if "/plugins/woocommerce/" in low or "woocommerce" in low:
            f.tag("ecommerce", "WooCommerce", "WooCommerce on the page")
    if "shopify" in f.score:
        f.tag("ecommerce", "Shopify")
    if "magento" in f.score:
        f.tag("ecommerce", "Magento")
    if "bigcommerce" in f.score:
        f.tag("ecommerce", "BigCommerce")

    # --- analytics and marketing tags
    for pat, name in (("googletagmanager.com/gtm.js", "Google Tag Manager"), ("googletagmanager.com/gtag/js", "Google Analytics"), ("google-analytics.com/analytics.js", "Google Analytics"),
                      ("connect.facebook.net", "Meta Pixel"), ("static.hotjar.com", "Hotjar"), ("clarity.ms", "Microsoft Clarity"), ("hs-scripts.com", "HubSpot tracking"),
                      ("cdn.segment.com", "Segment"), ("plausible.io", "Plausible"), ("matomo", "Matomo")):
        if pat in low:
            f.tag("analytics", name)
    # --- front-end libraries
    for pat, name in (("jquery", "jQuery"), ("bootstrap", "Bootstrap"), ("tailwindcss", "Tailwind CSS"), ("alpine", "Alpine.js")):
        if pat in scripts or (pat in ("bootstrap", "tailwindcss") and re.search(rf'<link[^>]+href=["\'][^"\']*{pat}', low)):
            f.tag("libraries", name)
    for g in gens[:3]:
        if g.lower() not in " ".join(f.evidence).lower():
            f.evidence.append(f"Generator tag: {g[:80]}")
    return f


def _blog_url(html: str, base: str) -> str | None:
    """A link on the homepage that looks like the blog index, so published posts can be found."""
    for m in re.finditer(r'<a[^>]+href=["\']([^"\']+)["\']', html or "", re.I):
        href = m.group(1).strip()
        path = urlsplit(href).path.rstrip("/").lower()
        if path in ("/blog", "/blogs", "/news", "/articles", "/insights", "/resources", "/journal") or path.endswith(("/blog", "/blogs/news")):
            return href if "://" in href else base.rstrip("/") + "/" + href.lstrip("/")
    return None


def publishing_for(platform: str, label: str) -> dict:
    """How blog posts can reach this kind of site: the recommended method, the alternatives, and a plain explanation."""
    group = PLATFORMS.get(platform, PLATFORMS["unknown"])[1]
    if group == "cms":
        return {"method": CMS_METHOD[platform], "alternatives": ["webhook"], "direct": True, "note": CMS_NOTE[platform]}
    method, alts, note = PUBLISHING[group]
    return {"method": method, "alternatives": alts, "direct": method not in (None, "webhook"), "note": note.format(label=label)}


def decide(f: Findings) -> tuple[str, str]:
    """(platform key, confidence). A CMS beats a framework: a WordPress site that loads React is still a WordPress site."""
    if not f.score:
        return "static", "low"
    order = lambda k: (PLATFORMS[k][1] != "cms", PLATFORMS[k][1] not in ("closed",), -f.score[k])  # CMS/closed builders first, then by weight
    best = min(f.score, key=order)
    weight = f.score[best]
    if PLATFORMS[best][1] == "spa" and any(PLATFORMS[k][1] == "code" for k in f.score):
        best = next(k for k in sorted(f.score, key=lambda k: -f.score[k]) if PLATFORMS[k][1] == "code")
        weight = f.score[best]
    return best, ("high" if weight >= 6 else "medium" if weight >= 3 else "low")


def detect(url: str) -> dict:
    """Open the site and read its technology. Never raises for an unreachable site: the result says so."""
    try:
        validate_url_shape(url)
    except SSRFValidationError as exc:
        raise ValueError(str(exc)) from exc
    base = url.rstrip("/")
    probes = {"wp_api": False, "ghost_api": False}
    try:
        with site_client(15) as c:
            r = c.get(base)
            html = r.text[:400_000]
            headers = {k.lower(): v for k, v in r.headers.items()}
            cookies = _cookie_names(r.headers.get_list("set-cookie"))
            blocked = r.status_code in (401, 403, 429, 503) and len(html) < 5000
            for name, path, test in (("wp_api", "/wp-json/", lambda p: p.status_code == 200 and "namespaces" in p.text[:5000]),
                                     ("ghost_api", "/ghost/api/admin/site/", lambda p: p.status_code == 200 and '"site"' in p.text[:2000])):
                try:  # the site URL, not r.url: the SSRF guard rewrites that to the pinned IP
                    probes[name] = test(c.get(f"{base}{path}"))
                except httpx.HTTPError:
                    pass
    except (httpx.HTTPError, SSRFValidationError) as exc:
        return {"platform": "unknown", "label": "Unknown", "method": None, "confidence": "none", "evidence": [], "reachable": False, "stack": [], "details": {},
                "error": f"Could not open {base}: {str(exc)[:160]}", "server": None, "wp_api": False, "url": base, "publishing": publishing_for("unknown", "This site")}
    f = fingerprint(html, headers, cookies, probes)
    platform, confidence = decide(f)
    if blocked and not f.score:  # a refused request with nothing to read is "don't know", not "hand-built"
        platform, confidence = "unknown", "none"
    label, _ = PLATFORMS[platform]
    version = f.versions.get(platform)
    shown = f"{label} {version}" if version else label
    flat: list[str] = [shown if platform not in ("static", "unknown") else "No CMS or framework recognised"]
    for cat in ("framework", "language", "libraries", "theme", "plugins", "ecommerce", "hosting", "cdn", "server", "analytics"):
        for item in f.details.get(cat, []):
            flat.append(item if cat != "theme" else f"Theme: {item}")
    evidence = list(dict.fromkeys(f.evidence))
    if not f.score:
        evidence.append("No CMS or framework signature found, so it looks like a hand-built site")
    if blocked:
        evidence.insert(0, f"The site refused our check ({r.status_code}); what follows comes from its headers only")
    pub = publishing_for(platform, label)
    return {"platform": platform, "label": label, "version": version, "method": pub["method"], "confidence": confidence,
            "evidence": evidence, "stack": list(dict.fromkeys(flat)), "details": {k: v for k, v in f.details.items() if v}, "server": headers.get("server"), "reachable": True,
            "blocked": blocked, "wp_api": probes["wp_api"], "ghost_api": probes["ghost_api"], "url": base, "blog_url": _blog_url(html, base), "publishing": pub}
