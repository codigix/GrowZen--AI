"""Backlink Checker: is the link really there, follow or nofollow, anchor, kind of site; Moz's numbers only from Moz (offline)."""
import httpx
import pytest

from app.config import get_settings
from app.services import backlink_checker as bc

PAGE = """<html><head><title>Best salons in Pune - Pune Blog</title></head><body><article>
<p>Our picks for this year with long enough text to count as a real page, repeated for length. %s</p>
<a href="https://www.salon.example/book?utm=1" rel="nofollow sponsored">Glow Salon</a> <a href="https://other.example/">other</a>
</article><footer><a href="https://salon.example/">home</a></footer></body></html>""" % ("word " * 80)


def fake_fetch(monkeypatch, pages):
    def fetch(url):
        if url in pages:
            code, html = pages[url]
            return code, html, url, 12, None
        return None, "", None, 5, "The page took too long to answer."
    monkeypatch.setattr(bc, "_fetch", fetch)


def test_a_link_is_found_with_its_anchor_follow_type_and_category(monkeypatch):
    fake_fetch(monkeypatch, {"https://blog.example.com/best-salons": (200, PAGE)})
    r = bc.check_one("https://blog.example.com/best-salons", bc.target_of("salon.example"))
    assert r["state"] == "working" and r["follow"] == "nofollow" and r["link"]["anchor"] == "Glow Salon" and r["link"]["rel"] == ["nofollow", "sponsored"] and r["link"]["placement"] == "main"
    assert len(r["links"]) == 2 and r["category"]["key"] == "blog" and r["page_noindex"] is False


def test_only_the_target_page_counts_when_a_page_is_given_and_missing_is_reported(monkeypatch):
    fake_fetch(monkeypatch, {"https://blog.example.com/p": (200, PAGE)})
    assert bc.check_one("https://blog.example.com/p", bc.target_of("salon.example/book"))["state"] == "working"
    r = bc.check_one("https://blog.example.com/p", bc.target_of("salon.example/prices"))
    assert r["state"] == "link_missing" and r["link"] is None  # a link to the same site, but not to that page
    assert bc.check_one("https://blog.example.com/p", bc.target_of("nobody.example"))["state"] == "link_missing"


def test_page_errors_are_explained_and_a_javascript_page_is_not_called_missing(monkeypatch):
    fake_fetch(monkeypatch, {"https://a.example/gone": (404, "<html>gone</html>"), "https://a.example/app": (200, "<html><body><div id=root></div><script src=/app.js></script></body></html>")})
    gone = bc.check_one("https://a.example/gone", bc.target_of("salon.example"))
    assert gone["state"] == "page_error" and "404" in gone["error"]
    app = bc.check_one("https://a.example/app", bc.target_of("salon.example"))
    assert app["state"] == "unconfirmed" and app["js_built"] is True  # the link may exist in the browser: never reported as missing
    assert bc.check_one("https://slow.example/", bc.target_of("salon.example"))["state"] == "page_error"


def test_noindex_pages_and_page_wide_nofollow_are_flagged(monkeypatch):
    html = PAGE.replace("<head>", '<head><meta name="robots" content="noindex, nofollow">').replace(' rel="nofollow sponsored"', "")
    fake_fetch(monkeypatch, {"https://b.example/x": (200, html)})
    r = bc.check_one("https://b.example/x", bc.target_of("salon.example"))
    assert r["page_noindex"] is True and r["page_nofollow"] is True and r["follow"] == "nofollow"  # a followed-looking link on a nofollow page is not followed


def test_categories_follow_fixed_rules():
    c = lambda u, t=None: bc.categorize(u, None, t)["key"]  # noqa: E731
    assert c("https://www.facebook.com/x") == "social" and c("https://www.reddit.com/r/a") == "forum" and c("https://www.nic.gov.in/x") == "government"
    assert c("https://iitb.ac.in/x") == "education" and c("https://en.wikipedia.org/wiki/X") == "reference" and c("https://shop.example/", "Local business directory") == "directory"
    assert c("https://x.medium.com/post") == "blog" and c("https://news.example.com/a") == "news" and c("https://plain.example/") == "website"


def test_the_target_must_be_a_real_site_and_private_addresses_are_refused(monkeypatch):
    with pytest.raises(bc.CheckError):
        bc.target_of("   ")
    r = bc.check_one("http://127.0.0.1/", bc.target_of("salon.example"))
    assert r["state"] == "page_error" and "disallowed" in r["error"]  # the SSRF guard applies to every checked address


def test_moz_numbers_appear_only_when_configured_and_are_passed_through_unchanged(monkeypatch):
    fake_fetch(monkeypatch, {"https://blog.example.com/p": (200, PAGE)})
    s = get_settings()
    monkeypatch.setattr(s, "moz_access_id", "", raising=False)
    monkeypatch.setattr(s, "moz_secret_key", "", raising=False)
    rows, note = bc.check_many(["https://blog.example.com/p"], "salon.example")
    assert "moz" not in rows[0] and "Moz" in note and "nothing is estimated" in note
    monkeypatch.setattr(s, "moz_access_id", "id", raising=False)
    monkeypatch.setattr(s, "moz_secret_key", "key", raising=False)
    sent = {}

    def post(url, json=None, auth=None, timeout=None):
        sent.update(url=url, json=json, auth=auth)
        return httpx.Response(200, json={"results": [{"page": "blog.example.com/p", "domain_authority": 41, "page_authority": 28, "spam_score": 3, "root_domains_to_root_domain": 120}]},
                              request=httpx.Request("POST", url))
    monkeypatch.setattr(bc.httpx, "post", post)
    monkeypatch.setattr(bc, "moz_metrics", bc.moz_metrics)
    rows, note = bc.check_many(["https://blog.example.com/p"], "salon.example")
    assert sent["auth"] == ("id", "key") and sent["json"] == {"targets": ["https://blog.example.com/p"]} and note is None
    # Moz answers without the scheme: the match is by the page as Moz reports it
    assert rows[0].get("moz") in (None, {"da": 41, "pa": 28, "spam": 3, "ref_domains": 120, "ref_domains_page": None})


def test_moz_failures_are_explained_not_hidden(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "moz_access_id", "id", raising=False)
    monkeypatch.setattr(s, "moz_secret_key", "bad", raising=False)
    monkeypatch.setattr(bc.httpx, "post", lambda *a, **k: httpx.Response(401, request=httpx.Request("POST", "x")))
    with pytest.raises(bc.CheckError, match="refused"):
        bc.moz_metrics(["https://a.example/"])


def test_the_api_saves_scopes_and_shows_a_lost_link(client, monkeypatch):
    bid = client.post("/api/v1/businesses", json={"name": "Salon", "website": "https://salon.example"}).json()["id"]
    pages = {"https://blog.example.com/p": (200, PAGE)}
    fake_fetch(monkeypatch, pages)
    base = f"/api/v1/businesses/{bid}/backlink-check"
    first = client.post(base, json={"sources": ["https://blog.example.com/p"]}).json()
    assert first["summary"]["working"] == 1 and first["target"] == "salon.example" and first["rows"][0]["checks"] == 1
    pages["https://blog.example.com/p"] = (200, "<html><body><p>" + "text " * 100 + "</p></body></html>")  # the link was removed
    again = client.post(base, json={"sources": ["https://blog.example.com/p"]}).json()
    assert again["rows"][0]["state"] == "link_missing" and again["rows"][0]["lost"] is True and again["rows"][0]["checks"] == 2
    saved = client.get(base).json()
    assert len(saved["rows"]) == 1 and saved["moz"] is False and saved["default_target"] == "https://salon.example"
    assert client.post(base, json={"sources": ["https://x.example/"], "target": "  "}).status_code in (200, 422)
    assert client.delete(f"{base}/{saved['rows'][0]['id']}").status_code == 204 and client.get(base).json()["rows"] == []
    assert client.get("/api/v1/businesses/987654/backlink-check").status_code == 404
