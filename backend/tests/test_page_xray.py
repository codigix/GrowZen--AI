"""Page X-Ray: a page read from fetched data only. No network: the fetch, RDAP and TLS functions are monkeypatched."""
import json

import pytest

from app.routers import page_xray as router
from app.services import page_xray as x
from app.services.url_safety import ValidatedURL

GOOD_PARAS = " ".join(f"Sentence number {i} explains one clear point about renting festive outfits in Pune." for i in range(1, 6))
ANSWER = "We rent festive outfits for weddings in Pune. " * 3 + "You choose, we deliver, and you return it clean."  # about 30 words
LONG_TEXT = " ".join(f"Our shop has served {n} happy customers since {2000 + n} with {n * 3}% repeat bookings." for n in range(1, 40))

JSON_LD = json.dumps({"@context": "https://schema.org", "@graph": [
    {"@type": "LocalBusiness", "name": "Asha Rentals", "sameAs": ["https://facebook.com/asha"], "datePublished": "2026-01-01"},
    {"@type": "FAQPage", "mainEntity": []}]})

GOOD_HTML = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Asha Rentals: festive outfit rental in Pune for weddings</title>
<meta name="description" content="Rent lehengas, sherwanis and festive outfits in Pune with free delivery, fitting help and easy returns for every wedding season.">
<link rel="canonical" href="https://asha.example/rent/"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:title" content="Asha Rentals"><meta property="og:image" content="https://asha.example/og.png"><meta name="author" content="Asha Rao">
<meta name="generator" content="WordPress 6.5"><link rel="icon" href="/fav.ico">
<meta name="twitter:card" content="summary_large_image">
<link rel="alternate" hreflang="en" href="https://asha.example/rent/"><link rel="alternate" hreflang="hi" href="https://asha.example/hi/"><link rel="alternate" hreflang="x-default" href="https://asha.example/rent/">
<script type="application/ld+json">{JSON_LD}</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABCDEFGH12"></script><script>fbq('init','1')</script>
<script src="/wp-content/themes/x/jquery.min.js"></script></head>
<body><a href="#main" class="skip">Skip to content</a><main id="main"><h1>Festive outfit rental in Pune</h1><p>{ANSWER}</p>
<h2>How do I book an outfit?</h2><p>{GOOD_PARAS}</p><h2>What does it cost?</h2><p>{GOOD_PARAS}</p><h3>Why rent?</h3><p>{GOOD_PARAS}</p>
<ul><li>Lehenga</li><li>Sherwani</li><li>Saree</li></ul><time datetime="2026-02-01">1 Feb 2026</time>
<p>{LONG_TEXT}</p><img src="a.jpg" alt="A lehenga"><img src="b.jpg" alt="A sherwani" loading="lazy">
<nav><a href="/about">About</a><a href="/contact">Contact</a><a href="/blog">Blog</a></nav><a href="https://government.example/rules" rel="nofollow">Rules</a>
</main></body></html>"""

BAD_HTML = "<html><head></head><body><h1>One</h1><h1>Two</h1><h4>Skipped</h4><p>Short.</p><img src='x.jpg'></body></html>"

ROBOTS_OK = "User-agent: *\nDisallow: /private\nSitemap: https://asha.example/sitemap.xml\n"
ROBOTS_BLOCK = "User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n"
SSL_OK = {"valid": True, "issuer": "Test CA", "expires_at": "2027-01-01T00:00:00+00:00", "days_left": 200, "error": None}
DOMAIN_OK = {"domain": "asha.example", "registered_at": "2020-01-01T00:00:00Z", "expires_at": "2028-01-01T00:00:00Z", "age_days": 2400, "registrar": "Reg", "nameservers": ["ns1.x"], "source": "rdap", "error": None}


def fetched(html, url="https://asha.example/rent/", status=200, headers=None, redirects=None):
    return x.Fetched(url=url, final_url=url, status=status, headers={"server": "nginx", "content-encoding": "gzip", **(headers or {})}, html=html, size_bytes=len(html), redirects=redirects or [])


def robots(text=ROBOTS_OK, status=200):
    return x.robots_info("https://asha.example", "https://asha.example/rent/", lambda u: {"status": status, "content_type": "text/plain", "text": text})


def checks(report, area):
    return {c["key"]: c for c in report["scores"][area]["checks"]}


def test_a_good_page_passes_the_checks_it_should():
    r = x.analyse(fetched(GOOD_HTML), robots(), {"found": True, "url": "https://asha.example/llms.txt"}, SSL_OK, DOMAIN_OK)
    seo, aeo, geo = checks(r, "seo"), checks(r, "aeo"), checks(r, "geo")
    assert all(seo[k]["passed"] for k in ("https", "status_200", "title", "description", "canonical", "indexable", "viewport", "lang", "alt", "og", "internal_links", "words", "redirects")), \
        {k: c["detail"] for k, c in seo.items() if not c["passed"]}
    assert seo["one_h1"]["passed"]
    assert all(aeo[k]["passed"] for k in ("faq_schema", "question_headings", "direct_answer", "lists_tables", "short_paragraphs", "date", "author", "outline", "descriptive_title")), \
        {k: c["detail"] for k, c in aeo.items() if not c["passed"]}
    assert all(geo[k]["passed"] for k in ("ai_crawlers", "llms_txt", "org_schema", "entity_consistent", "outbound", "eeat", "numbers", "sitemap", "cert", "not_noindex")), \
        {k: c["detail"] for k, c in geo.items() if not c["passed"]}
    assert r["scores"]["seo"]["total"] == 31 and r["scores"]["aeo"]["total"] == 9 and r["scores"]["geo"]["total"] == 10
    assert r["scores"]["seo"]["score"] == 100 and r["scores"]["geo"]["score"] == 100


def test_meta_content_schema_and_tech_are_read_from_the_page():
    r = x.analyse(fetched(GOOD_HTML, headers={"cf-ray": "abc", "strict-transport-security": "max-age=1", "x-powered-by": "PHP/8.2"}), robots(), None, SSL_OK, DOMAIN_OK)
    assert r["meta"]["title"].startswith("Asha Rentals") and r["meta"]["canonical_self"] is True and r["meta"]["lang"] == "en" and r["meta"]["favicon"] == "https://asha.example/fav.ico"
    assert r["meta"]["hreflang"] == [{"lang": "en", "url": "https://asha.example/rent/"}, {"lang": "hi", "url": "https://asha.example/hi/"}, {"lang": "x-default", "url": "https://asha.example/rent/"}] and r["meta"]["generator"] == "WordPress 6.5"
    assert r["social"]["og"]["image"] == "https://asha.example/og.png" and r["social"]["twitter"]["card"] == "summary_large_image"
    assert r["content"]["headings"]["h1"] == 1 and r["content"]["headings"]["h2"] == 2 and r["content"]["h1_texts"] == ["Festive outfit rental in Pune"]
    assert r["content"]["images"] == {"total": 2, "missing_alt": 0, "lazy": 1} and r["content"]["links"]["internal"] == 3 and r["content"]["links"]["external"] == 1 and r["content"]["links"]["nofollow"] == 1
    assert r["schema"]["types"][:2] == ["LocalBusiness", "FAQPage"] and r["schema"]["json_ld"] == [{"type": "LocalBusiness", "valid": True}] and r["schema"]["errors"] == []
    t = r["tech"]
    assert t["server"] == "nginx" and t["powered_by"] == "PHP/8.2" and t["cms"] == "WordPress" and "Cloudflare" in t["cdn"] and "jQuery" in t["js_libraries"]
    assert "Google Analytics 4" in t["analytics"] and "Meta Pixel" in t["ads_pixels"] and t["compression"] == "gzip" and t["security_headers"]["hsts"] is True and t["security_headers"]["csp"] is False
    assert r["robots"]["sitemaps"] == ["https://asha.example/sitemap.xml"] and "found_or_none" not in r["robots"]


def test_nothing_is_invented_for_a_bare_page():
    r = x.analyse(fetched(BAD_HTML, status=404, redirects=[{"url": "a", "status": 301}] * 3), robots(status=404, text=""), None, {**SSL_OK, "valid": None, "days_left": None, "error": "no"}, {**DOMAIN_OK, "registered_at": None, "age_days": None, "error": "RDAP did not answer"})
    m = r["meta"]
    assert m["title"] is None and m["description"] is None and m["canonical"] is None and m["canonical_self"] is None and m["viewport"] is None and m["lang"] is None and m["favicon"] is None and m["charset"] is None
    assert r["content"]["reading_ease"] is None and r["tech"]["cms"] is None and r["tech"]["frameworks"] == [] and r["schema"]["types"] == []
    seo, aeo = checks(r, "seo"), checks(r, "aeo")
    assert not seo["status_200"]["passed"] and not seo["one_h1"]["passed"] and not seo["title"]["passed"] and not seo["redirects"]["passed"] and not seo["alt"]["passed"]
    assert "hreflang" not in seo  # the page has no hreflang: the check does not apply, so it is neither passed nor failed
    assert not aeo["outline"]["passed"] and not aeo["short_paragraphs"]["passed"] and not aeo["faq_schema"]["passed"]
    assert any("Domain age is unavailable" in n for n in r["notes"]) and any("Reading ease" in n for n in r["notes"])
    assert len(r["summary"]) == 6 and r["summary"][0]["fix"] and r["summary"] == sorted(r["summary"], key=lambda s: 0)  # six failed checks, heaviest first
    weights = [next(c["weight"] for a in r["scores"].values() for c in a["checks"] if c["label"] == s["label"]) for s in r["summary"]]
    assert weights == sorted(weights, reverse=True)


def test_schema_blocks_that_are_broken_are_reported():
    html = '<html lang="en"><head><title>T</title><script type="application/ld+json">{"@type": "Organization", </script></head><body></body></html>'
    r = x.analyse(fetched(html), robots(), None, SSL_OK, DOMAIN_OK)
    assert r["schema"]["json_ld"] == [{"type": None, "valid": False}] and "not valid JSON" in r["schema"]["errors"][0]


def test_robots_ai_crawlers_llms_and_sitemaps():
    blocked = robots(ROBOTS_BLOCK)
    by = {b["bot"]: b["allowed"] for b in blocked["ai_crawlers"]}
    assert by["GPTBot"] is False and by["ClaudeBot"] is True and blocked["allows_page"] is True and blocked["found"] is True
    r = x.analyse(fetched(GOOD_HTML), blocked, None, SSL_OK, DOMAIN_OK)
    assert checks(r, "geo")["ai_crawlers"]["passed"] is False and "GPTBot" in checks(r, "geo")["ai_crawlers"]["detail"]
    assert checks(r, "geo")["llms_txt"]["passed"] is False
    none = robots(status=404, text="Not found")  # no robots.txt: nothing is blocked
    assert none["found"] is False and none["allows_page"] is True and all(b["allowed"] for b in none["ai_crawlers"])
    html_404 = robots("<html>nope</html>", status=200)  # a soft 404 page is not a robots.txt
    assert html_404["found"] is False and html_404["allows_page"] is True
    unreadable = x.robots_info("https://asha.example", "https://asha.example/", lambda u: None)
    assert unreadable["allows_page"] is None and all(b["allowed"] is None for b in unreadable["ai_crawlers"])
    r2 = x.analyse(fetched(GOOD_HTML), unreadable, None, SSL_OK, DOMAIN_OK)
    assert checks(r2, "geo")["ai_crawlers"]["passed"] is False and any("robots.txt could not be read" in n for n in r2["notes"])
    disallow_page = x.robots_info("https://asha.example", "https://asha.example/rent/", lambda u: {"status": 200, "content_type": "text/plain", "text": "User-agent: *\nDisallow: /rent\n"})
    assert disallow_page["allows_page"] is False


def test_scoring_is_the_weight_of_passed_checks():
    ctx_checks = [x._check("a", "A", 3, lambda c: (True, ""), ""), x._check("b", "B", 1, lambda c: (False, ""), ""), x._check("c", "C", 6, lambda c: (_ for _ in ()).throw(ValueError("x")), "")]
    s = x._score(ctx_checks, {})
    assert s["score"] == 30 and s["passed"] == 1 and s["total"] == 3  # 3 of 10; a check that raises counts as failed with a reason
    assert "Could not evaluate" in s["checks"][2]["detail"]


def test_normalise_and_ssrf_blocks():
    assert x.normalise_url("Example.com/Path#frag") == "https://example.com/Path"
    for bad in ("file:///etc/passwd", "ftp://example.com", "http://user:pw@example.com", "javascript:alert(1)", ""):
        with pytest.raises(x.XrayError) as e:
            x.normalise_url(bad)
        assert e.value.status == 422
    for blocked in ("http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://localhost:8000/", "http://10.0.0.5/", "http://[::1]/"):
        with pytest.raises(x.XrayError) as e:
            x.assert_public(x.normalise_url(blocked))
        assert e.value.status == 422


@pytest.fixture
def fake_net(monkeypatch):
    """Everything outside the process is replaced; the calls are counted."""
    calls = {"fetch": 0}
    router._cache.clear()
    router._hits.clear()

    def fetch(url):
        calls["fetch"] += 1
        return fetched(GOOD_HTML, url=url)
    monkeypatch.setattr(x, "assert_public", lambda url: None)
    monkeypatch.setattr(x, "fetch_page", fetch)
    monkeypatch.setattr(x, "fetch_small", lambda url, max_bytes=0: {"status": 200, "content_type": "text/plain", "text": ROBOTS_OK if url.endswith("robots.txt") else "# llms\n> Asha Rentals"})
    monkeypatch.setattr(x, "check_ssl", lambda host, port=443: SSL_OK)
    monkeypatch.setattr(x, "rdap_lookup", lambda domain: DOMAIN_OK)
    return calls


def _project(client):
    r = client.post("/api/v1/businesses", json={"name": "Xray Co", "city": "Pune"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_endpoint_returns_the_contract_and_caches(client, fake_net):
    bid = _project(client)
    url = f"/api/v1/businesses/{bid}/page-xray"
    r = client.post(url, json={"url": "asha.example/rent/"})
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("url", "final_url", "fetched_at", "status", "response_ms", "size_kb", "redirects", "https", "meta", "social", "content", "schema", "tech", "domain", "ssl", "robots", "llms_txt", "scores", "summary", "notes"):
        assert k in d, k
    assert d["llms_txt"] == {"found": True, "url": "https://asha.example/llms.txt"} and d["domain"]["age_days"] == 2400 and d["ssl"]["days_left"] == 200
    assert set(d["scores"]) == {"seo", "aeo", "geo"} and {"key", "label", "passed", "weight", "detail", "fix"} <= set(d["scores"]["seo"]["checks"][0])
    assert fake_net["fetch"] == 1
    again = client.post(url, json={"url": "https://asha.example/rent/"})  # the same page: from the 10-minute cache
    assert again.status_code == 200 and again.json()["fetched_at"] == d["fetched_at"] and fake_net["fetch"] == 1


def test_endpoint_errors_and_rate_limit(client, fake_net, monkeypatch):
    bid = _project(client)
    url = f"/api/v1/businesses/{bid}/page-xray"
    monkeypatch.undo()  # real SSRF guard for these calls
    for bad in ("http://127.0.0.1/", "http://169.254.169.254/", "file:///etc/passwd", "http://localhost/"):
        assert client.post(url, json={"url": bad}).status_code == 422, bad
    assert client.post(url, json={"url": "x"}).status_code == 422  # too short for the model
    # non-HTML answer -> 422; a network failure -> 502
    monkeypatch.setattr(x, "assert_public", lambda u: None)
    def not_html(u):
        raise x.XrayError(422, "This is not an HTML page (it is application/pdf).")
    monkeypatch.setattr(x, "fetch_page", not_html)
    r = client.post(url, json={"url": "https://asha.example/file.pdf"})
    assert r.status_code == 422 and "not an HTML page" in r.json()["detail"]
    def down(u):
        raise x.XrayError(502, "could not fetch: timed out")
    monkeypatch.setattr(x, "fetch_page", down)
    r = client.post(url, json={"url": "https://asha.example/down"})
    assert r.status_code == 502 and r.json()["detail"] == "could not fetch: timed out"
    # 30 fresh X-Rays per hour: the 31st is refused
    router._hits.clear()
    monkeypatch.setattr(x, "fetch_page", lambda u: fetched(GOOD_HTML, url=u))
    monkeypatch.setattr(x, "fetch_small", lambda u, max_bytes=0: None)
    monkeypatch.setattr(x, "check_ssl", lambda h, port=443: SSL_OK)
    monkeypatch.setattr(x, "rdap_lookup", lambda d: DOMAIN_OK)
    codes = [client.post(url, json={"url": f"https://asha.example/p{i}"}).status_code for i in range(router.LIMIT + 1)]
    assert codes[: router.LIMIT] == [200] * router.LIMIT and codes[-1] == 429


def test_another_users_project_is_404(client, fake_net):
    from test_security import login, user
    user("px1@x.in", "editor")
    user("px2@x.in", "editor")
    a, _ = login("px1@x.in")
    o, _ = login("px2@x.in")
    bid = a.post("/api/v1/businesses", json={"name": "Mine Co"}).json()["id"]
    assert a.post(f"/api/v1/businesses/{bid}/page-xray", json={"url": "https://asha.example/"}).status_code == 200
    assert o.post(f"/api/v1/businesses/{bid}/page-xray", json={"url": "https://asha.example/"}).status_code == 404


# ----------------------------------------------------------------------------------------------------------------- new SEO and accessibility checks
def page(body, head="", lang=' lang="en"'):
    return f"<!doctype html><html{lang}><head><meta charset='utf-8'><title>A useful page about renting outfits in Pune</title>{head}</head><body>{body}</body></html>"


def test_hreflang_edge_cases():
    def run(links):
        r = x.analyse(fetched(page("<h1>H</h1>", links)), robots(), None, SSL_OK, DOMAIN_OK)
        return checks(r, "seo").get("hreflang")
    me = "https://asha.example/rent/"
    good = f'<link rel="alternate" hreflang="en-IN" href="{me}"><link rel="alternate" hreflang="hi" href="https://asha.example/hi/"><link rel="alternate" hreflang="x-default" href="{me}">'
    assert run(good)["passed"]
    assert run("") is None  # no hreflang: not applicable, left out
    no_default = f'<link rel="alternate" hreflang="en" href="{me}"><link rel="alternate" hreflang="hi" href="https://asha.example/hi/">'
    assert "no x-default" in run(no_default)["detail"] and not run(no_default)["passed"]
    no_self = '<link rel="alternate" hreflang="hi" href="https://asha.example/hi/"><link rel="alternate" hreflang="x-default" href="https://asha.example/hi/">'
    assert "points back to this page" in run(no_self)["detail"]
    dupes = f'<link rel="alternate" hreflang="en" href="{me}"><link rel="alternate" hreflang="EN" href="{me}"><link rel="alternate" hreflang="x-default" href="{me}">'
    assert "duplicate" in run(dupes)["detail"]
    bad_code = f'<link rel="alternate" hreflang="english" href="{me}">'
    assert "invalid language code" in run(bad_code)["detail"] and not run(bad_code)["passed"]
    single_ok = f'<link rel="alternate" hreflang="en" href="{me}">'
    assert run(single_ok)["passed"]  # one entry that points at the page needs no x-default


def test_new_seo_checks_pass_and_fail_on_real_markup():
    bad = page('<h1>Hi</h1><img src="http://cdn.example/a.png" alt="a"><script src="http://cdn.example/x.js"></script>', head='<link rel="canonical" href="/a"><link rel="canonical" href="/b"><meta name="description" content="A useful page about renting outfits in Pune">')
    r = x.analyse(fetched(bad, headers={}), robots(), None, SSL_OK, DOMAIN_OK)
    seo = checks(r, "seo")
    assert not seo["twitter_card"]["passed"] and not seo["single_canonical"]["passed"] and "2 canonical" in seo["single_canonical"]["detail"]
    assert not seo["description_unique"]["passed"]  # the description repeats the title
    assert not seo["no_mixed_content"]["passed"] and "http://cdn.example" in seo["no_mixed_content"]["detail"] and not seo["favicon"]["passed"]
    ok = x.analyse(fetched(GOOD_HTML), robots(), None, SSL_OK, DOMAIN_OK)
    good = checks(ok, "seo")
    assert all(good[k]["passed"] for k in ("twitter_card", "description_unique", "single_canonical", "no_mixed_content", "page_weight", "response_time", "favicon"))
    # on a plain http page mixed content cannot happen: the check is left out
    http = x.analyse(fetched(bad, url="http://asha.example/rent/"), robots(), None, SSL_OK, DOMAIN_OK)
    assert "no_mixed_content" not in checks(http, "seo")
    # speed and weight come from the real fetch
    slow = fetched(GOOD_HTML)
    slow.elapsed_ms = 2400
    slow.truncated = True
    s2 = checks(x.analyse(slow, robots(), None, SSL_OK, DOMAIN_OK), "seo")
    assert not s2["response_time"]["passed"] and "2400" in s2["response_time"]["detail"] and not s2["page_weight"]["passed"] and "2 MB" in s2["page_weight"]["detail"]


def test_accessibility_checks_read_the_dom():
    body = ('<h1>T</h1><h4>Skipped</h4><img src="a.png"><a href="/x"></a><a href="/y"><img src="i.png" alt="Home"></a><button></button><button aria-label="Close">x</button>'
            '<form><input type="text"><input id="e" type="email"><label for="e">Email</label><label>Phone <input type="tel"></label><input type="hidden" name="h"><input type="submit"></form>'
            '<div tabindex="3">x</div><div tabindex="0">y</div>')
    r = x.analyse(fetched(page(body, lang="")), robots(), None, SSL_OK, DOMAIN_OK)
    a = checks(r, "seo")
    assert not a["a11y_lang"]["passed"] and not a["a11y_img_alt"]["passed"] and "1 image of 2" in a["a11y_img_alt"]["detail"].replace("images", "image")
    assert not a["a11y_form_labels"]["passed"] and "1 of 3 fields" in a["a11y_form_labels"]["detail"]  # hidden and submit inputs are not fields; the id-label and wrapping label count
    assert not a["a11y_link_text"]["passed"] and a["a11y_link_text"]["detail"].startswith("1 link")  # the empty link; the link with an image alt has a name
    assert not a["a11y_main"]["passed"] and not a["a11y_skip_nav"]["passed"] and not a["a11y_heading_order"]["passed"]
    assert not a["a11y_button_names"]["passed"] and a["a11y_button_names"]["detail"].startswith("2 buttons")  # the empty <button> and the unnamed submit
    assert not a["a11y_tabindex"]["passed"] and a["a11y_tabindex"]["detail"].startswith("1 element")  # tabindex 3; tabindex 0 is fine
    good = x.analyse(fetched(GOOD_HTML), robots(), None, SSL_OK, DOMAIN_OK)
    g = checks(good, "seo")
    assert all(g[k]["passed"] for k in g if k.startswith("a11y_")), {k: c["detail"] for k, c in g.items() if k.startswith("a11y_") and not c["passed"]}
    assert "No form fields" in g["a11y_form_labels"]["detail"]
    # a skip link alone satisfies the skip/nav check; so does a nav landmark; two mains do not satisfy the main check
    skip_only = checks(x.analyse(fetched(page('<a href="#c">Skip to main content</a><main id="c"><h1>T</h1></main>')), robots(), None, SSL_OK, DOMAIN_OK), "seo")
    assert skip_only["a11y_skip_nav"]["passed"] and skip_only["a11y_main"]["passed"]
    two_mains = checks(x.analyse(fetched(page("<main><h1>A</h1></main><div role='main'></div>")), robots(), None, SSL_OK, DOMAIN_OK), "seo")
    assert not two_mains["a11y_main"]["passed"] and "2 main" in two_mains["a11y_main"]["detail"]
    assert any("Measure full page" in n and "HTML document only" in n for n in good["notes"])


# ----------------------------------------------------------------------------------------------------------------- render mode
JS_SHELL = "<html><head><title>App</title></head><body><div id='root'></div></body></html>"
RENDERED = ("<html lang='en'><head><title>App</title></head><body><main><h1>Asha Rentals</h1>" + "<p>" + " ".join(f"word{i}" for i in range(150)) + "</p>"
            + "".join(f"<a href='/p{i}'>Page {i}</a>" for i in range(6)) + "<img src='a.png' alt='a'><img src='b.png' alt='b'></main></body></html>")


@pytest.fixture
def render_env(monkeypatch, fake_net):
    """The Chrome binary and the process are replaced; the arguments they receive are recorded."""
    seen = {"args": [], "profile_exists_during": None, "rmtree": []}
    monkeypatch.setattr(x, "find_chrome", lambda: "/usr/bin/chrome")
    monkeypatch.setattr(x, "resolve_and_validate", lambda u: ValidatedURL(url=u, scheme="https", hostname="asha.example", port=443, resolved_ips=("93.184.216.34",)))
    monkeypatch.setattr(x, "fetch_page", lambda url: fetched(JS_SHELL, url=url))

    def run_chrome(args, timeout=x.CHROME_TIMEOUT, cap=x.CHROME_MAX_BYTES):
        import os
        seen["args"].append(list(args))
        prof = next(a.split("=", 1)[1] for a in args if a.startswith("--user-data-dir="))
        seen["profile_exists_during"] = os.path.isdir(prof)
        seen["profile"] = prof
        return 0, RENDERED.encode(), False
    monkeypatch.setattr(x, "_run_chrome", run_chrome)
    return seen


def test_render_mode_reads_the_rendered_page_and_compares(render_env):
    r = x.run("https://asha.example/", render=True, own_site="https://www.asha.example")
    rd = r["rendering"]
    assert rd["mode"] == "chrome" and rd["raw_word_count"] < 5 and rd["rendered_word_count"] >= 150 and rd["js_required"] is True
    assert rd["js_added_links"] == 6 and rd["js_added_images"] == 2
    assert r["content"]["word_count"] >= 150 and r["content"]["headings"]["h1"] == 1 and r["content"]["images"]["total"] == 2  # the report is the rendered page
    assert any("Rendered in headless Chrome" in n for n in r["notes"])
    # the plain run keeps the raw numbers and says it was not rendered
    plain = x.run("https://asha.example/")
    assert plain["rendering"]["mode"] == "html" and plain["rendering"]["rendered_word_count"] is None and plain["rendering"]["js_required"] is None and plain["content"]["word_count"] < 5


def test_render_mode_arguments_are_a_list_with_the_safety_flags(render_env):
    import os
    x.run("https://asha.example/", render=True, own_site="asha.example")
    args = render_env["args"][0]
    assert isinstance(args, list) and args[0] == "/usr/bin/chrome" and args[-1] == "https://asha.example/"
    assert "--headless=new" in args and "--dump-dom" in args and "--virtual-time-budget=8000" in args and "--disable-extensions" in args and "--disable-gpu" in args
    rules = next(a for a in args if a.startswith("--host-resolver-rules="))
    assert "MAP asha.example 93.184.216.34" in rules  # the page's host is pinned to the address that was validated
    for blocked in ("localhost", "127.0.0.1", "169.254.169.254", "metadata.google.internal"):
        assert f"MAP {blocked} ~NOTFOUND" in rules
    assert render_env["profile_exists_during"] is True and not os.path.exists(render_env["profile"])  # a fresh temp profile, removed afterwards
    assert not any(a == "--no-sandbox" for a in args) or (hasattr(os, "geteuid") and os.geteuid() == 0)


def test_render_mode_is_only_for_the_projects_own_website(render_env):
    for url in ("https://competitor.example/", "https://asha.example.evil.example/", "https://notasha.example/"):
        with pytest.raises(x.XrayError) as e:
            x.run(url, render=True, own_site="https://asha.example")
        assert e.value.status == 422 and "own website" in e.value.message
    with pytest.raises(x.XrayError):
        x.run("https://asha.example/", render=True, own_site=None)  # a project with no website has no site to render
    assert render_env["args"] == []  # Chrome was never started for any of them
    for ok in ("https://asha.example/", "https://www.asha.example/p", "https://shop.asha.example/"):
        x.run(ok, render=True, own_site="https://www.asha.example")
    assert len(render_env["args"]) == 3
    # a redirect to another website is not rendered either
    import app.services.page_xray as mod
    mod.fetch_page = lambda url: fetched(JS_SHELL, url=url)
    off = fetched(JS_SHELL, url="https://asha.example/")
    off.final_url = "https://other.example/"
    _, info = x.render_page(off, "https://asha.example")
    assert info["mode"] == "html" and "another website" in info["note"] and len(render_env["args"]) == 3


def test_render_mode_falls_back_to_html_when_chrome_is_missing_or_fails(render_env, monkeypatch):
    monkeypatch.setattr(x, "find_chrome", lambda: None)
    r = x.run("https://asha.example/", render=True, own_site="https://asha.example")
    assert r["rendering"]["mode"] == "html" and r["rendering"]["note"] == "Chrome is not available on this server" and "Chrome is not available on this server" in r["notes"]
    assert r["rendering"]["raw_word_count"] == r["content"]["word_count"] and r["rendering"]["js_required"] is None
    monkeypatch.setattr(x, "find_chrome", lambda: "/usr/bin/chrome")
    monkeypatch.setattr(x, "_run_chrome", lambda args, timeout=0, cap=0: (None, b"", True))  # a timeout
    t = x.run("https://asha.example/", render=True, own_site="https://asha.example")
    assert t["rendering"]["mode"] == "html" and "two tries" in t["rendering"]["note"]
    monkeypatch.setattr(x, "_run_chrome", lambda args, timeout=0, cap=0: (1, b"", False))  # a crash
    c = x.run("https://asha.example/", render=True, own_site="https://asha.example")
    assert c["rendering"]["mode"] == "html" and "could not render" in c["rendering"]["note"]

    def cannot_start(*a, **k):
        raise OSError("no such file")
    monkeypatch.setattr(x, "_run_chrome", cannot_start)
    assert x.run("https://asha.example/", render=True, own_site="https://asha.example")["rendering"]["mode"] == "html"


def test_js_required_rule():
    big = "<html><body><p>" + " ".join("w" * 3 for _ in range(300)) + "</p></body></html>"
    same = fetched(big)
    seen = {}

    def fake_dump(chrome, url):
        return big, None
    import app.services.page_xray as mod
    old_find, old_dump = mod.find_chrome, mod.chrome_dump
    mod.find_chrome, mod.chrome_dump = (lambda: "/c"), fake_dump
    try:
        _, info = mod.render_page(same, "https://asha.example")
    finally:
        mod.find_chrome, mod.chrome_dump = old_find, old_dump
    assert info["mode"] == "chrome" and info["js_required"] is False and info["js_added_links"] == 0  # the same text with or without scripts: no JavaScript needed


def test_render_endpoint_limits_cache_and_own_site(client, fake_net, monkeypatch):
    # an own-site project, a normal user
    r = client.post("/api/v1/businesses", json={"name": "Render Co", "city": "Pune", "website": "https://asha.example"})
    assert r.status_code == 201, r.text
    bid = r.json()["id"]
    url = f"/api/v1/businesses/{bid}/page-xray"
    runs = {"n": 0}
    monkeypatch.setattr(x, "find_chrome", lambda: "/usr/bin/chrome")
    monkeypatch.setattr(x, "resolve_and_validate", lambda u: ValidatedURL(url=u, scheme="https", hostname="asha.example", port=443, resolved_ips=("93.184.216.34",)))

    def run_chrome(args, timeout=0, cap=0):
        runs["n"] += 1
        return 0, RENDERED.encode(), False
    monkeypatch.setattr(x, "_run_chrome", run_chrome)
    # a foreign page with render=true: 422, Chrome never starts
    bad = client.post(url, json={"url": "https://competitor.example/", "render": True})
    assert bad.status_code == 422 and "own website" in bad.json()["detail"] and runs["n"] == 0
    # the same foreign page without render is a normal X-Ray
    assert client.post(url, json={"url": "https://competitor.example/"}).status_code == 200
    ok = client.post(url, json={"url": "https://asha.example/", "render": True})
    assert ok.status_code == 200 and ok.json()["rendering"]["mode"] == "chrome" and runs["n"] == 1
    # the cache key includes render: the plain X-Ray of the same page is a separate run, and the rendered one is cached
    plain = client.post(url, json={"url": "https://asha.example/"})
    assert plain.json()["rendering"]["mode"] == "html"
    again = client.post(url, json={"url": "https://asha.example/", "render": True})
    assert again.json()["fetched_at"] == ok.json()["fetched_at"] and runs["n"] == 1
    # 10 fresh renders per hour, separate from the 30 normal ones
    router._cache.clear()
    router._render_hits.clear()
    router._hits.clear()
    codes = [client.post(url, json={"url": f"https://asha.example/p{i}", "render": True}).status_code for i in range(router.RENDER_LIMIT + 1)]
    assert codes[: router.RENDER_LIMIT] == [200] * router.RENDER_LIMIT and codes[-1] == 429
    assert client.post(url, json={"url": "https://asha.example/plain"}).status_code == 200  # the normal allowance is untouched


def test_rdap_lookup_delegates_to_the_domain_info_service(monkeypatch):
    """x.rdap_lookup is a thin wrapper: RDAP via the IANA bootstrap, then WHOIS for TLDs such as .co (services/domain_info.py)."""
    from app.services import domain_info
    seen = []
    answer = {"domain": "codigix.co", "registered_at": "2019-03-01", "expires_at": "2027-03-01", "age_days": 2800, "registrar": "Reg", "nameservers": ["ns1.x"], "source": "whois", "error": None}
    monkeypatch.setattr(domain_info, "lookup", lambda d: seen.append(d) or answer)
    assert x.rdap_lookup("codigix.co") == answer and seen == ["codigix.co"]
    # and the report carries whatever it returns, WHOIS answers included
    monkeypatch.setattr(x, "rdap_lookup", lambda d: answer)
    r = x.analyse(fetched(GOOD_HTML), robots(), None, SSL_OK, answer)
    assert r["domain"]["source"] == "whois" and r["domain"]["age_days"] == 2800 and not any("Domain age is unavailable" in n for n in r["notes"])


def test_chrome_runs_behind_a_global_limit_and_a_waiting_caller_gets_a_clear_answer(monkeypatch):
    import threading

    from app.services import page_xray
    monkeypatch.setattr(page_xray, "CHROME_SLOTS", threading.BoundedSemaphore(1))
    monkeypatch.setattr(page_xray, "CHROME_WAIT_SECONDS", 0.2)
    inside = []

    def slow(chrome, url):
        inside.append(1)
        started.set()
        release.wait(2)
        return "<html></html>", None
    started, release = threading.Event(), threading.Event()
    monkeypatch.setattr(page_xray, "_chrome_dump", slow)
    t = threading.Thread(target=lambda: page_xray.chrome_dump("chrome", "https://a.example/"))
    t.start()
    assert started.wait(2)
    html, why = page_xray.chrome_dump("chrome", "https://b.example/")  # the only slot is taken
    assert html is None and "busy" in why and len(inside) == 1
    release.set()
    t.join(3)
    assert page_xray.chrome_dump("chrome", "https://c.example/")[0] == "<html></html>"  # the slot was handed back
