"""Technology detection (services/site_stack.py): fingerprints of real-world page shapes, no network."""
import httpx
import pytest

from app.services import site_stack as st


def run(html="", headers=None, cookies=(), **probes):
    f = st.fingerprint(html, {k.lower(): v for k, v in (headers or {}).items()}, set(cookies), probes)
    platform, confidence = st.decide(f)
    return platform, confidence, f


WORDPRESS = """<html><head><meta name="generator" content="WordPress 6.4.3" /><link rel="stylesheet" href="/wp-content/themes/astra/style.css">
<link rel="stylesheet" href="/wp-content/plugins/elementor/assets/css/frontend.css"><!-- This site is optimized with the Yoast SEO plugin v22 -->
<script src="/wp-includes/js/jquery/jquery.min.js"></script><script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>
<script src="/wp-content/plugins/woocommerce/assets/js/frontend/cart.min.js"></script></head><body class="elementor-page"></body></html>"""


def test_wordpress_with_its_plugins_theme_server_and_hosting_is_read_properly():
    platform, conf, f = run(WORDPRESS, {"Server": "nginx", "X-Powered-By": "PHP/8.2.12", "cf-ray": "abc", "Link": '<https://x.com/wp-json/>; rel="https://api.w.org/"'}, wp_api=True)
    assert (platform, conf) == ("wordpress", "high") and f.versions["wordpress"] == "6.4.3"
    d = f.details
    assert d["theme"] == ["astra"] and {"Elementor", "Yoast SEO"} <= set(d["plugins"]) and d["ecommerce"] == ["WooCommerce"]
    assert d["language"] == ["PHP 8.2.12"] and d["cdn"] == ["Cloudflare"] and d["server"] == ["nginx"] and "Google Analytics" in d["analytics"] and "jQuery" in d["libraries"]


@pytest.mark.parametrize("html, headers, cookies, expected", [
    ('<div id="__next"></div><script src="/_next/static/chunks/main.js"></script><script id="__NEXT_DATA__"></script>', {"x-vercel-id": "iad1::x", "server": "Vercel"}, (), "nextjs"),
    ('<script src="https://cdn.shopify.com/s/files/1/x.js"></script>', {"x-shopid": "1"}, (), "shopify"),
    ('<img src="https://static.wixstatic.com/media/a.jpg">', {"x-wix-request-id": "1"}, (), "wix"),
    ('<link href="https://static1.squarespace.com/static/x.css">', {}, (), "squarespace"),
    ('<html data-wf-site="123"><link href="https://assets.website-files.com/a.css">', {}, (), "webflow"),
    ('<meta name="generator" content="Ghost 5.79">', {}, (), "ghost"),
    ('<div id="___gatsby"></div>', {}, (), "gatsby"),
    ('<meta name="generator" content="Hugo 0.121.2">', {"server": "Netlify", "x-nf-request-id": "1"}, (), "hugo"),
    ('<meta name="generator" content="Jekyll v4.3.2">', {"server": "GitHub.com"}, (), "jekyll"),
    ('<meta name="generator" content="Astro v4.1.0"><astro-island></astro-island>', {}, (), "astro"),
    ('<script>window.__NUXT__={}</script><script src="/_nuxt/entry.js"></script>', {}, (), "nuxt"),
    ('<meta name="generator" content="Drupal 10 (https://www.drupal.org)">', {}, (), "drupal"),
    ('<meta name="generator" content="Joomla! - Open Source Content Management">', {}, (), "joomla"),
    ('<app-root ng-version="17.0.0"></app-root>', {}, (), "angular"),
    ('<div id="root"></div><script src="/static/js/main.3f2a1b9c.js"></script>', {}, (), "react"),
    ('<meta name="generator" content="Framer d1b2">', {}, (), "framer"),
    ('<script src="https://cdn11.bigcommerce.com/s-1/x.js"></script>', {}, (), "bigcommerce"),
    ('<meta name="generator" content="Docusaurus v3.0">', {}, (), "docusaurus"),
])
def test_each_platform_is_recognised_from_its_own_signs(html, headers, cookies, expected):
    platform, conf, _ = run(html, headers, cookies)
    assert platform == expected


def test_false_positives_that_used_to_happen_do_not():
    # the word "react" in ordinary text is not React
    assert run("<html><body><p>How patients react to whitening, and why we react quickly.</p></body></html>")[0] == "static"
    # the HubSpot tracking script on a WordPress site does not turn it into HubSpot CMS
    platform, _, f = run('<link href="/wp-content/themes/x/a.css"><script src="https://js.hs-scripts.com/1.js"></script>')
    assert platform == "wordpress" and "HubSpot tracking" in f.details["analytics"]
    # linking to a Blogspot blog does not make a site Blogger
    assert run('<a href="https://friend.blogspot.com/">my friend</a><p>hi</p>')[0] == "static"
    # a CMS beats a framework: WordPress that also loads React stays WordPress
    assert run(WORDPRESS + '<script src="/wp-content/plugins/x/react.min.js"></script>')[0] == "wordpress"
    # no signs at all is a hand-built site, said with low confidence
    p, c, _ = run("<html><body><h1>Our clinic</h1></body></html>")
    assert (p, c) == ("static", "low")


def test_nextjs_implies_react_and_the_hosting_and_language_are_reported_separately():
    _, _, f = run('<script src="/_next/static/a.js"></script>', {"x-vercel-id": "1", "server": "Vercel", "x-powered-by": "Next.js"})
    assert "React" in f.details["libraries"] and f.details["hosting"] == ["Vercel"]
    _, _, f = run("", {"x-powered-by": "ASP.NET", "server": "Microsoft-IIS/10.0"}, ["asp.net_sessionid"])
    assert f.details["language"] == ["ASP.NET"] and f.details["server"] == ["IIS"]
    _, _, f = run("", {}, ["laravel_session", "xsrf-token"])
    assert f.details["framework"] == ["Laravel"] and "PHP" in f.details["language"]


def test_publishing_advice_follows_the_kind_of_site():
    wp = st.publishing_for("wordpress", "WordPress")
    assert wp["method"] == "wordpress" and wp["direct"] and "Application Password" in wp["note"]
    assert st.publishing_for("ghost", "Ghost")["method"] == "ghost" and st.publishing_for("shopify", "Shopify")["method"] == "shopify"
    nx = st.publishing_for("nextjs", "Next.js")
    assert nx["method"] == "github" and nx["alternatives"] == ["webhook"] and "Markdown" in nx["note"]
    spa = st.publishing_for("react", "React app")
    assert spa["method"] == "webhook" and spa["alternatives"] == ["github"]
    wix = st.publishing_for("wix", "Wix")
    assert wix["method"] is None and wix["direct"] is False and "Wix" in wix["note"] and "webhook" in wix["note"]  # honest: no direct publishing, here is the way around it


def test_the_blog_link_on_the_homepage_is_found_so_posts_can_be_opened():
    assert st._blog_url('<a href="/about">a</a><a href="/blog/">Blog</a>', "https://x.com") == "https://x.com/blog/"
    assert st._blog_url('<a href="https://x.com/news">News</a>', "https://x.com") == "https://x.com/news"
    assert st._blog_url('<a href="/about">a</a>', "https://x.com") is None


def _site(handler, monkeypatch):
    monkeypatch.setattr(st, "site_client", lambda timeout=15: httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True, timeout=timeout))


def test_detect_reads_the_site_probes_the_apis_and_reports_the_stack(monkeypatch):
    def handler(req):
        if req.url.path == "/wp-json/":
            return httpx.Response(200, json={"name": "Clinic", "namespaces": ["wp/v2"]})
        if req.url.path == "/ghost/api/admin/site/":
            return httpx.Response(404)
        return httpx.Response(200, text=WORDPRESS + '<a href="/blog/">Blog</a>', headers={"server": "nginx", "x-powered-by": "PHP/8.1.2", "set-cookie": "PHPSESSID=abc; path=/"})
    _site(handler, monkeypatch)
    d = st.detect("https://clinic.example.org/")
    assert d["platform"] == "wordpress" and d["confidence"] == "high" and d["method"] == "wordpress" and d["version"] == "6.4.3" and d["wp_api"] and not d["ghost_api"]
    assert d["stack"][0] == "WordPress 6.4.3" and "Elementor" in d["stack"] and "PHP 8.1.2" in d["stack"] and d["blog_url"] == "https://clinic.example.org/blog/"
    assert d["publishing"]["method"] == "wordpress" and d["reachable"] is True


def test_detect_recognises_ghost_by_its_public_admin_endpoint(monkeypatch):
    def handler(req):
        if req.url.path == "/ghost/api/admin/site/":
            return httpx.Response(200, json={"site": {"title": "Blog", "version": "5.79"}})
        return httpx.Response(200, text="<html><body>hi</body></html>")
    _site(handler, monkeypatch)
    d = st.detect("https://blog.example.org")
    assert d["platform"] == "ghost" and d["method"] == "ghost" and d["ghost_api"]


def test_a_blocked_or_unreachable_site_is_reported_honestly(monkeypatch):
    _site(lambda req: httpx.Response(403, text="Attention Required", headers={"server": "cloudflare", "cf-ray": "1"}), monkeypatch)
    d = st.detect("https://guarded.example.org")
    assert d["blocked"] is True and d["platform"] == "unknown" and d["confidence"] == "none" and "Cloudflare" in d["stack"] and "refused our check" in d["evidence"][0]
    def down(req):
        raise httpx.ConnectError("refused")
    _site(down, monkeypatch)
    d = st.detect("https://gone.example.org")
    assert d["reachable"] is False and "Could not open" in d["error"] and d["platform"] == "unknown"
    with pytest.raises(ValueError):
        st.detect("http://user:pw@example.org")
