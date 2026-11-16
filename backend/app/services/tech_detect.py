"""Technology detection for a web page: what it is built with, from what the page and its server really send.

A data-driven fingerprint list (in the style of Wappalyzer): each technology has patterns for the response headers, cookies, <meta> tags, script/style/image
addresses and the HTML itself. A technology is reported only when a pattern really matches, with the version when the page states it. Nothing is guessed:
the evidence (which header or file matched) is returned with every result. WordPress plugins and the theme are read from their /wp-content/ paths.
"""
import re
from typing import Any

from bs4 import BeautifulSoup

# category -> label (display order)
CATEGORIES: dict[str, str] = {
    "cms": "CMS & platform", "page_builder": "Page builder", "ecommerce": "E-commerce", "framework": "Frameworks", "js_library": "JavaScript libraries", "ui": "UI & icons",
    "analytics": "Analytics", "tag_manager": "Tag managers", "ads": "Ads & pixels", "marketing": "Marketing, chat & forms", "seo": "SEO tools", "consent": "Cookie consent",
    "security": "Security & spam protection", "payments": "Payments", "cdn": "CDN & hosting", "server": "Web server", "language": "Programming language", "cache": "Caching & speed",
    "fonts": "Fonts", "maps": "Maps & media", "protocol": "Protocol",
}


def T(name: str, cat: str, *, h: dict[str, str] | None = None, meta: dict[str, str] | None = None, src: list[str] | None = None, html: list[str] | None = None,
      cookie: list[str] | None = None, implies: list[str] | None = None) -> dict[str, Any]:
    return {"name": name, "cat": cat, "h": h or {}, "meta": meta or {}, "src": src or [], "html": html or [], "cookie": cookie or [], "implies": implies or []}


V = r"(?P<v>\d+(?:\.\d+){0,3})"
FINGERPRINTS: list[dict[str, Any]] = [
    # ---- CMS and platforms
    T("WordPress", "cms", meta={"generator": rf"WordPress\s*{V}?"}, src=[r"/wp-content/", r"/wp-includes/"], html=[r"/wp-json/", r"wp-emoji-release"], h={"link": r"api\.w\.org"}, implies=["PHP"]),
    T("Shopify", "cms", src=[r"cdn\.shopify\.com", r"/shopifycloud/"], html=[r"Shopify\.theme", r"shopify-features"], h={"x-shopid": r".", "x-shopify-stage": r"."}, cookie=[r"^_shopify_"], implies=["Ruby on Rails"]),
    T("Wix", "cms", meta={"generator": r"Wix\.com"}, src=[r"static\.parastorage\.com", r"static\.wixstatic\.com"], h={"x-wix-request-id": r"."}),
    T("Squarespace", "cms", meta={"generator": r"Squarespace"}, src=[r"static1\.squarespace\.com", r"squarespace-cdn\.com"]),
    T("Webflow", "cms", meta={"generator": r"Webflow"}, html=[r"data-wf-(?:page|site)="], src=[r"assets-global\.website-files\.com", r"uploads-ssl\.webflow\.com"]),
    T("Ghost", "cms", meta={"generator": rf"Ghost\s*{V}?"}, src=[r"/ghost/api/"], h={"x-ghost-cache-status": r"."}),
    T("Drupal", "cms", meta={"generator": rf"Drupal\s*{V}?"}, h={"x-drupal-cache": r".", "x-generator": r"Drupal"}, src=[r"/sites/default/files/", r"/core/misc/drupal"], implies=["PHP"]),
    T("Joomla", "cms", meta={"generator": r"Joomla"}, src=[r"/media/system/js/", r"/components/com_"], implies=["PHP"]),
    T("Magento", "ecommerce", src=[r"/static/version\d+/frontend/", r"/skin/frontend/", r"mage/cookies"], cookie=[r"^mage-cache"], implies=["PHP"]),
    T("PrestaShop", "ecommerce", meta={"generator": r"PrestaShop"}, html=[r"prestashop\s*=\s*\{", r"/modules/ps_"], implies=["PHP"]),
    T("OpenCart", "ecommerce", html=[r"catalog/view/(?:theme|javascript)"], cookie=[r"^OCSESSID"], implies=["PHP"]),
    T("BigCommerce", "ecommerce", src=[r"cdn\d*\.bigcommerce\.com"], html=[r"bigcommerce\.com/s-"]),
    T("WooCommerce", "ecommerce", meta={"generator": rf"WooCommerce\s*{V}?"}, src=[r"/wp-content/plugins/woocommerce/"], html=[r"woocommerce-(?:page|no-js)", r"wc-ajax=", r"wp-content/plugins/woocommerce"], implies=["WordPress"]),
    T("Blogger", "cms", meta={"generator": r"Blogger"}, src=[r"blogger\.com/static", r"www\.blogger\.com"]),
    T("Framer", "cms", meta={"generator": r"Framer"}, src=[r"framerusercontent\.com", r"framer\.com/m/"]),
    T("Weebly", "cms", src=[r"editmysite\.com", r"weebly\.com/files"]),
    T("GoDaddy Website Builder", "cms", meta={"generator": r"Starfield Technologies|GoDaddy"}, src=[r"img1\.wsimg\.com"]),
    T("HubSpot CMS", "cms", meta={"generator": r"HubSpot"}, h={"x-hs-hub-id": r"."}, src=[r"hs-sites\.com", r"hubspotusercontent"]),
    T("Duda", "cms", src=[r"irp\.cdn-website\.com", r"static\.cdn-website\.com"]),
    T("Tilda", "cms", src=[r"static\.tildacdn\.com", r"tilda\.ws"]),
    T("TYPO3", "cms", meta={"generator": r"TYPO3"}, src=[r"/typo3conf/", r"/typo3temp/"], implies=["PHP"]),
    T("Craft CMS", "cms", h={"x-powered-by": r"Craft CMS"}, implies=["PHP"]),
    T("Laravel", "framework", cookie=[r"^laravel_session$", r"^XSRF-TOKEN$"], implies=["PHP"]),
    T("Django", "framework", cookie=[r"^csrftoken$"], html=[r"csrfmiddlewaretoken"], implies=["Python"]),
    T("Ruby on Rails", "framework", meta={"csrf-param": r"authenticity_token"}, h={"x-powered-by": r"Phusion Passenger"}, cookie=[r"^_[a-z0-9_]+_session$"], implies=["Ruby"]),
    T("ASP.NET", "framework", h={"x-aspnet-version": r".", "x-powered-by": r"ASP\.NET"}, cookie=[r"^ASP\.NET_SessionId$", r"^\.AspNetCore"], html=[r"__VIEWSTATE"]),
    # ---- page builders and WordPress extras
    T("Elementor", "page_builder", meta={"generator": rf"Elementor\s*{V}?"}, src=[rf"/elementor/assets/[^\"']*\?ver={V}", r"/wp-content/plugins/elementor/"], html=[r"elementor-(?:section|widget|element)", r"data-elementor-type"], implies=["WordPress"]),
    T("Elementor Pro", "page_builder", src=[rf"/elementor-pro/assets/[^\"']*\?ver={V}", r"/wp-content/plugins/elementor-pro/"], implies=["Elementor"]),
    T("Divi", "page_builder", src=[r"/themes/Divi/", r"/et-cache/", r"et_pb_"], html=[r"et_pb_section", r"et-boc"], implies=["WordPress"]),
    T("WPBakery", "page_builder", src=[r"/plugins/js_composer/"], html=[r"vc_row", r"wpb_wrapper"], implies=["WordPress"]),
    T("Beaver Builder", "page_builder", src=[r"/plugins/bb-plugin/"], html=[r"fl-builder"], implies=["WordPress"]),
    T("Bricks", "page_builder", src=[r"/themes/bricks/"], html=[r"brxe-"], implies=["WordPress"]),
    T("Oxygen", "page_builder", src=[r"/plugins/oxygen/"], html=[r"ct-section-inner-wrap"], implies=["WordPress"]),
    T("Gutenberg blocks", "page_builder", html=[r"wp-block-(?:group|columns|paragraph|image)"], src=[r"/wp-includes/css/dist/block-library/"], implies=["WordPress"]),
    T("Yoast SEO", "seo", html=[rf"Yoast SEO(?: Premium)? plugin[^>]*?v?{V}?"], src=[r"/plugins/wordpress-seo/"], implies=["WordPress"]),
    T("Rank Math SEO", "seo", html=[rf"Rank Math(?: PRO)? ?(?:SEO)?[^>]*?v?{V}?", r"rank-math"], src=[r"/plugins/seo-by-rank-math"], implies=["WordPress"]),
    T("All in One SEO", "seo", html=[r"All in One SEO", r"aioseo"], src=[r"/plugins/all-in-one-seo-pack/"], implies=["WordPress"]),
    T("SEOPress", "seo", html=[r"SEOPress"], src=[r"/plugins/wp-seopress/"], implies=["WordPress"]),
    T("Site Kit by Google", "analytics", meta={"generator": rf"Site Kit by Google\s*{V}?"}, src=[r"/plugins/google-site-kit/"], implies=["WordPress"]),
    T("MonsterInsights", "analytics", src=[r"/plugins/google-analytics-for-wordpress/"], html=[r"monsterinsights"], implies=["WordPress"]),
    T("Jetpack", "marketing", src=[r"/plugins/jetpack/", r"stats\.wp\.com", r"c0\.wp\.com"], html=[r"jetpack"], implies=["WordPress"]),
    T("Contact Form 7", "marketing", src=[r"/plugins/contact-form-7/"], html=[r"wpcf7"], implies=["WordPress"]),
    T("WPForms", "marketing", src=[r"/plugins/wpforms"], html=[r"wpforms-"], implies=["WordPress"]),
    T("Fluent Forms", "marketing", src=[r"/plugins/fluentform/"], html=[r"fluent_form|ff-el-"], implies=["WordPress"]),
    T("Gravity Forms", "marketing", src=[r"/plugins/gravityforms/"], html=[r"gform_wrapper"], implies=["WordPress"]),
    T("Ninja Forms", "marketing", src=[r"/plugins/ninja-forms/"], implies=["WordPress"]),
    T("Slider Revolution", "js_library", src=[r"/plugins/revslider/"], html=[r"rev_slider", r"Slider Revolution"], implies=["WordPress"]),
    T("WPML", "cms", src=[r"/plugins/sitepress-multilingual-cms/"], html=[r"wpml"], implies=["WordPress"]),
    T("Polylang", "cms", src=[r"/plugins/polylang"], html=[r"polylang"], implies=["WordPress"]),
    T("Wordfence", "security", src=[r"/plugins/wordfence/"], implies=["WordPress"]),
    # ---- front-end frameworks
    T("React", "framework", html=[r"data-reactroot", r"__REACT_DEVTOOLS_GLOBAL_HOOK__", r"<div id=[\"']root[\"']"], src=[r"react(?:-dom)?(?:\.production)?(?:\.min)?\.js", r"/react@"]),
    T("Next.js", "framework", html=[r"__NEXT_DATA__", r"/_next/static/"], h={"x-powered-by": r"Next\.js", "x-nextjs-cache": r"."}, implies=["React", "Node.js"]),
    T("Nuxt", "framework", html=[r"__NUXT__", r"/_nuxt/", r"id=[\"']__nuxt[\"']"], implies=["Vue.js"]),
    T("Vue.js", "framework", src=[r"vue(?:\.runtime)?(?:\.global)?(?:\.prod)?(?:\.min)?\.js", r"/vue@"], html=[r"data-v-[0-9a-f]{6,8}", r"data-server-rendered=[\"']true"]),
    T("Angular", "framework", html=[rf"ng-version=[\"']{V}", r"<app-root", r"ng-app"], src=[r"angular(?:\.min)?\.js"]),
    T("Svelte", "framework", html=[r"svelte-[a-z0-9]{6,}"], src=[r"/_app/immutable/"]),
    T("Gatsby", "framework", meta={"generator": r"Gatsby"}, html=[r"id=[\"']___gatsby[\"']"], implies=["React"]),
    T("Astro", "framework", meta={"generator": r"Astro"}, html=[r"astro-island", r"data-astro-"]),
    T("Remix", "framework", html=[r"__remixContext"], implies=["React"]),
    T("Vite", "framework", src=[r"/assets/index-[A-Za-z0-9_-]{6,}\.js", r"/@vite/client"]),
    T("Alpine.js", "framework", html=[r"x-data=", r"\[x-cloak\]"], src=[r"alpine(?:js)?(?:\.min)?\.js"]),
    T("htmx", "framework", html=[r"hx-(?:get|post|swap|trigger)="], src=[r"htmx(?:\.min)?\.js"]),
    # ---- JS libraries
    T("jQuery", "js_library", src=[rf"jquery[-.]v?{V}(?:\.min)?\.js", rf"/jquery/jquery[^\"'?\s]*\.js\?ver={V}", rf"jquery(?:\.min)?\.js\?ver={V}", r"/jquery/jquery", r"jquery[-.]?(?:\.min)?\.js"], html=[r"jquery-js"]),
    T("jQuery UI", "js_library", src=[r"jquery[-.]ui", r"/jquery/ui/"]),
    T("jQuery Migrate", "js_library", src=[rf"jquery-migrate(?:\.min)?\.js\?ver={V}", rf"jquery-migrate[-.]{V}", r"jquery-migrate"]),
    T("Swiper", "js_library", src=[rf"swiper[-.]?(?:bundle)?[-.]?v?{V}?", r"/swiper/"]),
    T("Slick", "js_library", src=[r"slick(?:\.min)?\.js", r"/slick/"]),
    T("Owl Carousel", "js_library", src=[r"owl\.carousel"]),
    T("GSAP", "js_library", src=[r"gsap(?:\.min)?\.js", r"TweenMax", r"ScrollTrigger"]),
    T("AOS", "js_library", src=[r"aos(?:\.min)?\.(?:js|css)", r"/aos/"]),
    T("Lodash", "js_library", src=[r"lodash(?:\.min)?\.js"]),
    T("Moment.js", "js_library", src=[r"moment(?:\.min)?\.js", r"/moment/"]),
    T("Axios", "js_library", src=[r"axios(?:\.min)?\.js"]),
    T("Chart.js", "js_library", src=[r"chart(?:\.umd)?(?:\.min)?\.js", r"/chart\.js"]),
    T("Three.js", "js_library", src=[r"three(?:\.module)?(?:\.min)?\.js"]),
    T("Lottie", "js_library", src=[r"lottie(?:-player)?(?:\.min)?\.js", r"dotlottie"]),
    T("Select2", "js_library", src=[r"select2(?:\.min)?\.(?:js|css)"]),
    T("Fancybox", "js_library", src=[r"fancybox"]),
    T("Isotope", "js_library", src=[r"isotope"]),
    T("Masonry", "js_library", src=[r"masonry"]),
    T("Popper", "js_library", src=[r"popper(?:\.min)?\.js", r"@popperjs"]),
    T("Modernizr", "js_library", src=[r"modernizr"]),
    T("core-js", "js_library", src=[r"core-js"]),
    T("Lightbox", "js_library", src=[r"lightbox(?:\.min)?\.js"]),
    # ---- UI frameworks, icons
    T("Bootstrap", "ui", src=[rf"bootstrap[-.]?v?{V}?(?:\.bundle)?(?:\.min)?\.(?:css|js)", r"/bootstrap@"], html=[r"class=[\"'][^\"']*\bcol-(?:xs|sm|md|lg|xl)-\d"]),
    T("Tailwind CSS", "ui", src=[r"cdn\.tailwindcss\.com", r"tailwind[\w.-]*\.css"], html=[r"class=[\"'][^\"']*\b(?:md|lg):(?:flex|grid|w-)"]),
    T("Foundation", "ui", src=[r"foundation(?:\.min)?\.(?:css|js)"]),
    T("Bulma", "ui", src=[r"bulma(?:\.min)?\.css"]),
    T("Font Awesome", "ui", src=[rf"font-?awesome[-./]*v?{V}?", r"fontawesome", r"use\.fontawesome\.com"], html=[r"fa-(?:solid|brands|regular)\b", r"fas fa-"]),
    T("Material Icons", "ui", src=[r"fonts\.googleapis\.com/icon\?family=Material"]),
    T("Animate.css", "ui", src=[r"animate(?:\.min)?\.css"]),
    # ---- analytics and tags
    T("Google Analytics 4", "analytics", html=[r"gtag\(['\"]config['\"],\s*['\"]G-[A-Z0-9]+", r"gtag/js\?id=G-[A-Z0-9]+"], src=[r"googletagmanager\.com/gtag/js\?id=G-"]),
    T("Google Analytics", "analytics", html=[r"UA-\d{4,}-\d+", r"google-analytics\.com/analytics\.js", r"ga\(['\"]create"], src=[r"google-analytics\.com/(?:analytics|ga)\.js"]),
    T("Google tag (gtag.js)", "tag_manager", src=[r"googletagmanager\.com/gtag/js\?id=(?:G|GT|AW|DC)-"], html=[r"gtag\('js'"]),
    T("Google Tag Manager", "tag_manager", src=[r"googletagmanager\.com/gtm\.js"], html=[r"GTM-[A-Z0-9]{4,}", r"googletagmanager\.com/ns\.html"]),
    T("Hotjar", "analytics", src=[r"static\.hotjar\.com", r"hotjar-\d+"], html=[r"hj\(['\"]|_hjSettings"]),
    T("Microsoft Clarity", "analytics", src=[r"clarity\.ms/tag"], html=[r"clarity\(['\"]"]),
    T("Matomo", "analytics", src=[r"matomo\.js", r"piwik\.js"], html=[r"_paq\.push"]),
    T("Plausible", "analytics", src=[r"plausible\.io/js"]),
    T("Mixpanel", "analytics", src=[r"cdn\.mxpnl\.com", r"mixpanel"]),
    T("Segment", "analytics", src=[r"cdn\.segment\.com"]),
    T("Heap", "analytics", src=[r"heap-?analytics|cdn\.heapanalytics\.com"]),
    T("Amplitude", "analytics", src=[r"cdn\.amplitude\.com"]),
    T("FullStory", "analytics", src=[r"fullstory\.com/s/fs\.js", r"edge\.fullstory\.com"]),
    T("Crazy Egg", "analytics", src=[r"script\.crazyegg\.com"]),
    T("Yandex Metrica", "analytics", src=[r"mc\.yandex\.ru/metrika"]),
    T("Cloudflare Web Analytics", "analytics", src=[r"static\.cloudflareinsights\.com"]),
    T("Vercel Analytics", "analytics", src=[r"/_vercel/insights"]),
    T("Umami", "analytics", src=[r"umami"], html=[r"data-website-id"]),
    T("Fathom", "analytics", src=[r"cdn\.usefathom\.com"]),
    T("Google Ads", "ads", html=[r"['\"]AW-\d{6,}", r"googleadservices\.com"], src=[r"googleadservices\.com", r"googletagmanager\.com/gtag/js\?id=AW-"]),
    T("Google AdSense", "ads", src=[r"pagead2\.googlesyndication\.com/pagead/js/adsbygoogle"], html=[r"adsbygoogle"]),
    T("Meta Pixel", "ads", src=[r"connect\.facebook\.net/[^/]+/fbevents\.js"], html=[r"fbq\(['\"]init"]),
    T("LinkedIn Insight Tag", "ads", src=[r"snap\.licdn\.com/li\.lms-analytics"], html=[r"_linkedin_partner_id"]),
    T("TikTok Pixel", "ads", src=[r"analytics\.tiktok\.com"]),
    T("Pinterest Tag", "ads", src=[r"s\.pinimg\.com/ct/core\.js"]),
    T("X (Twitter) Pixel", "ads", src=[r"static\.ads-twitter\.com"]),
    T("Microsoft Advertising UET", "ads", src=[r"bat\.bing\.com/bat\.js"]),
    T("Snap Pixel", "ads", src=[r"sc-static\.net/scevent"]),
    T("Criteo", "ads", src=[r"static\.criteo\.net"]),
    T("Taboola", "ads", src=[r"cdn\.taboola\.com"]),
    # ---- marketing, chat, forms
    T("Mailchimp", "marketing", src=[r"chimpstatic\.com", r"list-manage\.com"]),
    T("Klaviyo", "marketing", src=[r"static\.klaviyo\.com", r"klaviyo"]),
    T("HubSpot", "marketing", src=[r"js\.hs-scripts\.com", r"js\.hsforms\.net", r"hs-analytics\.net"]),
    T("Intercom", "marketing", src=[r"widget\.intercom\.io", r"js\.intercomcdn\.com"]),
    T("Drift", "marketing", src=[r"js\.driftt\.com"]),
    T("Zendesk", "marketing", src=[r"static\.zdassets\.com", r"zendesk"]),
    T("LiveChat", "marketing", src=[r"cdn\.livechatinc\.com"]),
    T("Tawk.to", "marketing", src=[r"embed\.tawk\.to"]),
    T("Crisp", "marketing", src=[r"client\.crisp\.chat"]),
    T("Tidio", "marketing", src=[r"code\.tidio\.co"]),
    T("Freshchat", "marketing", src=[r"wchat\.freshchat\.com"]),
    T("Zoho SalesIQ", "marketing", src=[r"salesiq\.zoho", r"zohopublic"]),
    T("WhatsApp chat", "marketing", html=[r"wa\.me/\d+", r"api\.whatsapp\.com/send", r"whatsapp://send"], src=[r"chaty", r"wa-chat"]),
    T("Calendly", "marketing", src=[r"assets\.calendly\.com"], html=[r"calendly\.com/"]),
    T("Typeform", "marketing", src=[r"embed\.typeform\.com"]),
    T("OneSignal", "marketing", src=[r"cdn\.onesignal\.com"]),
    # ---- consent, security
    T("CookieYes", "consent", src=[r"cdn-cookieyes\.com", r"cookie-law-info"]),
    T("Cookiebot", "consent", src=[r"consent\.cookiebot\.com"]),
    T("OneTrust", "consent", src=[r"cdn\.cookielaw\.org", r"onetrust"]),
    T("Complianz", "consent", src=[r"/plugins/complianz"], html=[r"cmplz"]),
    T("iubenda", "consent", src=[r"cdn\.iubenda\.com"]),
    T("reCAPTCHA", "security", src=[r"google\.com/recaptcha", r"gstatic\.com/recaptcha"], html=[r"g-recaptcha"]),
    T("hCaptcha", "security", src=[r"hcaptcha\.com"]),
    T("Cloudflare Turnstile", "security", src=[r"challenges\.cloudflare\.com/turnstile"]),
    T("Sucuri", "security", h={"x-sucuri-id": r".", "server": r"Sucuri"}),
    # ---- payments
    T("Stripe", "payments", src=[r"js\.stripe\.com"]),
    T("PayPal", "payments", src=[r"paypal\.com/sdk/js", r"paypalobjects\.com"]),
    T("Razorpay", "payments", src=[r"checkout\.razorpay\.com"]),
    T("PayU", "payments", src=[r"payu(?:money)?\.(?:in|com)"]),
    T("Paytm", "payments", src=[r"securegw\.paytm\.in", r"paytm\.in/merchantpgpui"]),
    T("Cashfree", "payments", src=[r"sdk\.cashfree\.com"]),
    # ---- CDN, hosting, servers
    T("Cloudflare", "cdn", h={"cf-ray": r".", "server": r"^cloudflare$", "cf-cache-status": r"."}, cookie=[r"^__cf_bm$"]),
    T("Hostinger", "cdn", h={"platform": r"^hostinger$", "x-hcdn-request-id": r".", "server": r"^hcdn$"}),
    T("Amazon CloudFront", "cdn", h={"x-amz-cf-id": r".", "via": r"CloudFront"}),
    T("Fastly", "cdn", h={"x-served-by": r"cache-", "fastly-debug-digest": r"."}),
    T("Akamai", "cdn", h={"x-akamai-transformed": r".", "server": r"AkamaiGHost"}),
    T("Vercel", "cdn", h={"x-vercel-id": r".", "server": r"^Vercel$"}),
    T("Netlify", "cdn", h={"x-nf-request-id": r".", "server": r"^Netlify$"}),
    T("GitHub Pages", "cdn", h={"x-github-request-id": r"."}),
    T("Firebase Hosting", "cdn", h={"x-firebase-cdn": r".", "server": r"Firebase"}),
    T("Google Cloud", "cdn", h={"server": r"^(?:gws|Google Frontend|ESF)$", "x-cloud-trace-context": r"."}),
    T("Azure", "cdn", h={"x-azure-ref": r".", "x-ms-request-id": r"."}),
    T("WP Engine", "cdn", h={"x-powered-by": r"WP Engine", "x-wpe-loopback-upstream-addr": r"."}),
    T("Kinsta", "cdn", h={"x-kinsta-cache": r"."}),
    T("SiteGround", "cdn", h={"x-sg-cache": r".", "host-header": r"siteground"}),
    T("Nginx", "server", h={"server": rf"nginx(?:/{V})?"}),
    T("Apache", "server", h={"server": rf"Apache(?:/{V})?"}),
    T("LiteSpeed", "server", h={"server": r"LiteSpeed", "x-litespeed-cache": r".", "x-turbo-charged-by": r"LiteSpeed"}),
    T("OpenResty", "server", h={"server": rf"openresty(?:/{V})?"}),
    T("Microsoft IIS", "server", h={"server": rf"Microsoft-IIS(?:/{V})?"}),
    T("Caddy", "server", h={"server": r"^Caddy"}),
    T("Envoy", "server", h={"server": r"^envoy"}),
    T("Gunicorn", "server", h={"server": rf"gunicorn(?:/{V})?"}, implies=["Python"]),
    T("PHP", "language", h={"x-powered-by": rf"PHP(?:/(?P<v>\d+(?:\.\d+){{0,3}}))?"}, cookie=[r"^PHPSESSID$"]),
    T("Python", "language", h={"server": r"Werkzeug|gunicorn|uvicorn|WSGIServer|Python"}),
    T("Ruby", "language", h={"x-powered-by": r"Phusion Passenger|Ruby"}),
    T("Node.js", "language", h={"x-powered-by": r"Express|Next\.js|Node"}),
    # ---- caching and speed
    T("LiteSpeed Cache", "cache", h={"x-litespeed-cache": r"."}, html=[r"LiteSpeed Cache", r"litespeed-wp-plugin"], src=[r"/plugins/litespeed-cache/"]),
    T("WP Rocket", "cache", html=[r"WP Rocket", r"wp-rocket"], src=[r"/plugins/wp-rocket/", r"/wp-content/cache/wpr"]),
    T("W3 Total Cache", "cache", html=[r"W3 Total Cache"], h={"x-powered-by": r"W3 Total Cache"}),
    T("WP Super Cache", "cache", html=[r"WP Super Cache"]),
    T("Autoptimize", "cache", src=[r"/autoptimize/"], html=[r"autoptimize"]),
    T("Varnish", "cache", h={"x-varnish": r".", "via": r"varnish"}),
    T("Nginx FastCGI cache", "cache", h={"x-fastcgi-cache": r"."}),
    # ---- fonts, maps, media
    T("Google Fonts", "fonts", src=[r"fonts\.googleapis\.com", r"fonts\.gstatic\.com"]),
    T("Adobe Fonts", "fonts", src=[r"use\.typekit\.net", r"fonts\.adobe\.com"]),
    T("Google Maps", "maps", src=[r"maps\.googleapis\.com", r"google\.com/maps/embed"], html=[r"google\.com/maps/embed"]),
    T("Mapbox", "maps", src=[r"api\.mapbox\.com", r"mapbox-gl"]),
    T("Leaflet", "maps", src=[r"leaflet(?:\.min)?\.(?:js|css)"]),
    T("YouTube embed", "maps", src=[r"youtube(?:-nocookie)?\.com/embed", r"youtube\.com/iframe_api"], html=[r"youtube(?:-nocookie)?\.com/embed"]),
    T("Vimeo embed", "maps", src=[r"player\.vimeo\.com"]),
]
BY_NAME = {t["name"]: t for t in FINGERPRINTS}
_COMPILED: dict[str, dict[str, Any]] = {}


def _rx(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.I)


def _compiled(t: dict[str, Any]) -> dict[str, Any]:
    c = _COMPILED.get(t["name"])
    if c is None:
        c = {"h": {k: _rx(v) for k, v in t["h"].items()}, "meta": {k: _rx(v) for k, v in t["meta"].items()}, "src": [_rx(p) for p in t["src"]], "html": [_rx(p) for p in t["html"]], "cookie": [_rx(p) for p in t["cookie"]]}
        _COMPILED[t["name"]] = c
    return c


def _version(m: re.Match[str] | None) -> str | None:
    if m is None:
        return None
    try:
        return m.group("v") or None
    except (IndexError, re.error):  # a pattern without a version group
        return None


PLUGIN_NAMES = {"fluentform": "Fluent Forms", "google-site-kit": "Site Kit by Google", "seo-by-rank-math": "Rank Math SEO", "wordpress-seo": "Yoast SEO", "contact-form-7": "Contact Form 7",
                "elementor-pro": "Elementor Pro", "woocommerce": "WooCommerce", "wpforms-lite": "WPForms", "js_composer": "WPBakery", "litespeed-cache": "LiteSpeed Cache", "revslider": "Slider Revolution",
                "google-analytics-for-wordpress": "MonsterInsights", "header-footer-elementor": "Header Footer Elementor", "all-in-one-seo-pack": "All in One SEO", "wp-rocket": "WP Rocket"}


def _wp_slug_name(slug: str) -> str:
    if slug in PLUGIN_NAMES:
        return PLUGIN_NAMES[slug]
    return " ".join(w.capitalize() for w in re.split(r"[-_]+", slug) if w)


def detect(html: str, headers: dict[str, str], cookies: list[str] | None = None, resources: list[str] | None = None) -> dict[str, Any]:
    """Technologies found on a page. `headers` are the response headers (any case), `cookies` the cookie names, `resources` extra file addresses (for example the
    requests Lighthouse saw). Returns {detected:[{name,category,label,version,via}], groups:[{key,label,items}], plugins, theme, notes}."""
    h = {str(k).lower(): str(v) for k, v in (headers or {}).items()}
    soup = BeautifulSoup(html or "", "html.parser")
    metas = {(m.get("name") or m.get("property") or m.get("http-equiv") or "").lower(): (m.get("content") or "") for m in soup.find_all("meta")}
    generators = [(m.get("content") or "") for m in soup.find_all("meta", attrs={"name": re.compile(r"^generator$", re.I)})]
    urls: list[str] = []
    for tag, attr in (("script", "src"), ("link", "href"), ("img", "src"), ("iframe", "src"), ("source", "src"), ("a", "href")):
        urls += [str(x.get(attr)) for x in soup.find_all(tag) if x.get(attr)]
    urls += list(resources or [])
    inline = " ".join((s.string or "") for s in soup.find_all("script") if not s.get("src"))[:400_000]
    body = (html or "")[:1_500_000]
    found: dict[str, dict[str, Any]] = {}

    def add(name: str, version: str | None, via: str) -> None:
        cur = found.get(name)
        if cur is None:
            found[name] = {"name": name, "category": BY_NAME[name]["cat"], "version": version, "via": via}
        elif version and not cur["version"]:
            cur["version"] = version

    for t in FINGERPRINTS:
        c = _compiled(t)
        for hn, rx in c["h"].items():
            if hn in h and (m := rx.search(h[hn])):
                add(t["name"], _version(m), f"header {hn}")
        for mn, rx in c["meta"].items():
            vals = generators if mn == "generator" else [metas.get(mn, "")]
            for val in vals:
                if val and (m := rx.search(val)):
                    add(t["name"], _version(m), f"meta {mn}")
        for rx in c["src"]:
            for u in urls:
                if (m := rx.search(u)):
                    add(t["name"], _version(m), "file " + u[:80])
                    break
        for rx in c["html"]:
            if (m := rx.search(body)) or (inline and (m := rx.search(inline))):
                add(t["name"], _version(m), "page code")
                break
        for rx in c["cookie"]:
            if any(rx.search(ck) for ck in (cookies or [])):
                add(t["name"], None, "cookie")
                break
    # what a found technology implies (WordPress runs on PHP and a database), unless the page showed it directly
    for name in list(found):
        for implied in BY_NAME[name]["implies"]:
            if implied in BY_NAME and implied not in found:
                found[implied] = {"name": implied, "category": BY_NAME[implied]["cat"], "version": None, "via": f"implied by {name}"}
    # HTTP/3 from Alt-Svc
    if re.search(r"\bh3(?:-\d+)?=", h.get("alt-svc", "")):
        found["HTTP/3"] = {"name": "HTTP/3", "category": "protocol", "version": None, "via": "header alt-svc"}
    # a server like "nginx/1.24.0 (Ubuntu)" also names the operating system
    os_m = re.search(r"\((Ubuntu|Debian|CentOS|Red Hat|Fedora|Win\d*|Unix|Alpine)[^)]*\)", h.get("server", ""), re.I)
    if os_m:
        found[os_m.group(1)] = {"name": os_m.group(1), "category": "server", "version": None, "via": "header server"}
    # a generic "framework" the page itself calls out: Vite needs a module script AND a root element to count (a hashed /assets/index-*.js alone is also used by other builders)
    if "Vite" in found and "React" not in found and "Vue.js" not in found:
        found["Vite"]["via"] += " (a built single-page app: render the page to see the framework)"

    # WordPress plugins and theme from their file paths
    plugins: dict[str, str | None] = {}
    for u in urls:
        m = re.search(r"/wp-content/plugins/([a-z0-9._-]+)/[^\"'\s]*?(?:\?ver=([\w.]+))?(?:[\"'\s]|$)", u, re.I)
        if m:
            slug = m.group(1).lower()
            plugins[slug] = plugins.get(slug) or m.group(2)
    theme_m = next((re.search(r"/wp-content/themes/([a-z0-9._-]+)/[^\"'\s]*?(?:\?ver=([\w.]+))?(?:[\"'\s]|$)", u, re.I) for u in urls if "/wp-content/themes/" in u), None)
    generator_versions = {re.sub(r"\s+[\d.]+.*$", "", g).strip().lower(): (re.search(r"([\d]+(?:\.\d+)+)", g) or [None, None])[1] for g in generators}
    plugin_list = [{"slug": s, "name": _wp_slug_name(s), "version": v or generator_versions.get(_wp_slug_name(s).lower())} for s, v in sorted(plugins.items())]
    theme = {"slug": theme_m.group(1).lower(), "name": _wp_slug_name(theme_m.group(1)), "version": theme_m.group(2)} if theme_m else None
    if theme and "WordPress" not in found:
        found["WordPress"] = {"name": "WordPress", "category": "cms", "version": None, "via": "theme files"}

    detected = [{**f, "label": CATEGORIES.get(f["category"], f["category"])} for f in found.values()]
    order = list(CATEGORIES)
    detected.sort(key=lambda f: (order.index(f["category"]) if f["category"] in order else 99, f["name"].lower()))
    groups = []
    for key, label in CATEGORIES.items():
        items = [{"name": f["name"], "version": f["version"], "via": f["via"]} for f in detected if f["category"] == key]
        if items:
            groups.append({"key": key, "label": label, "items": items})
    return {"detected": detected, "groups": groups, "plugins": plugin_list, "theme": theme}
