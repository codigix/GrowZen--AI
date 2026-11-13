"""Technology detection: real fingerprints, versions and evidence, and nothing invented for a plain page."""
from app.services import tech_detect as td

WP_HTML = """<html><head>
<meta name="generator" content="WordPress 7.0.8" /><meta name="generator" content="Elementor 4.3.6; features: e_font_icon_svg" />
<meta name="generator" content="Site Kit by Google 1.187.0" />
<script src="https://asha.example/wp-includes/js/jquery/jquery.min.js?ver=3.7.1"></script>
<script src="https://www.googletagmanager.com/gtag/js?id=GT-5R7RBTLD"></script>
<script src="https://asha.example/wp-content/plugins/elementor-pro/assets/js/frontend.min.js?ver=3.28.3"></script>
<script src="https://asha.example/wp-content/plugins/fluentform/assets/js/form.js?ver=6.2.17"></script>
<link rel="stylesheet" href="https://asha.example/wp-content/themes/hello-elementor/style.css?ver=3.4.6" />
<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet" />
</head><body class="elementor-page"><div class="elementor-section"></div><!-- Rank Math SEO plugin - 1.0.200 --></body></html>"""
WP_HEADERS = {"Server": "hcdn", "X-Powered-By": "PHP/8.3.36", "x-litespeed-cache": "hit", "Platform": "hostinger", "alt-svc": 'h3=":443"; ma=86400', "Link": '<https://asha.example/wp-json/>; rel="https://api.w.org/"'}


def _by_name(r):
    return {d["name"]: d for d in r["detected"]}


def test_wordpress_site_with_versions_plugins_and_theme():
    r = td.detect(WP_HTML, WP_HEADERS)
    n = _by_name(r)
    assert n["WordPress"]["version"] == "7.0.8" and n["Elementor"]["version"] == "4.3.6" and n["Site Kit by Google"]["version"] == "1.187.0"
    assert n["PHP"]["version"] == "8.3.36" and n["jQuery"]["version"] == "3.7.1" and "Rank Math SEO" in n and "Fluent Forms" in n
    assert {"Hostinger", "LiteSpeed Cache", "HTTP/3", "Google Fonts", "Google tag (gtag.js)", "Elementor Pro"} <= set(n)
    assert n["Hostinger"]["category"] == "cdn" and n["LiteSpeed Cache"]["category"] == "cache" and n["HTTP/3"]["category"] == "protocol"
    assert r["theme"] == {"slug": "hello-elementor", "name": "Hello Elementor", "version": "3.4.6"}
    plugins = {p["slug"]: p["version"] for p in r["plugins"]}
    assert plugins["elementor-pro"] == "3.28.3" and plugins["fluentform"] == "6.2.17"
    assert "MySQL" not in n  # never assumed: only what the page shows
    assert all(d["via"] for d in r["detected"])  # every finding says what showed it
    labels = [g["label"] for g in r["groups"]]
    assert labels.index("CMS & platform") < labels.index("Page builder") < labels.index("Analytics")  # a fixed, readable order


def test_built_single_page_app_and_server_os():
    html = '<html><head><script type="module" src="/assets/index-bnZhi_Cs.js"></script></head><body><div id="root"></div></body></html>'
    r = td.detect(html, {"server": "nginx/1.24.0 (Ubuntu)"})
    n = _by_name(r)
    assert n["React"] and n["Vite"] and n["Nginx"]["version"] == "1.24.0" and "Ubuntu" in n and "WordPress" not in n


def test_other_platforms_from_headers_cookies_and_files():
    r = td.detect("<html><script src='https://cdn.shopify.com/s/files/x.js'></script></html>", {"x-shopid": "1", "server": "cloudflare", "cf-ray": "abc"}, ["_shopify_y"])
    n = _by_name(r)
    assert {"Shopify", "Cloudflare", "Ruby on Rails"} <= set(n)
    assert "Laravel" in _by_name(td.detect("<html></html>", {}, ["laravel_session"]))
    nx = _by_name(td.detect('<script id="__NEXT_DATA__"></script><script src="/_next/static/a.js"></script>', {"x-powered-by": "Next.js"}))
    assert {"Next.js", "React", "Node.js"} <= set(nx)


def test_a_plain_page_reports_nothing_it_cannot_show():
    r = td.detect("<html><head><title>Hi</title></head><body><p>Hello</p></body></html>", {"content-type": "text/html"})
    assert r["detected"] == [] and r["groups"] == [] and r["plugins"] == [] and r["theme"] is None
    assert td.detect("", {})["detected"] == []
