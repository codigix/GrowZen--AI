"""Two websites of one owner (codigix.co and codigixinfotech.com) never mix."""
from types import SimpleNamespace

from app.services import citation_sites as sites, site_guard as g


def test_hosts_are_compared_whole():
    assert g.same_host("https://www.codigix.co/", "codigix.co") and not g.same_host("codigix.co", "codigixinfotech.com")
    assert not g.mentions_host("see codigix.com today", "codigix.co") and g.mentions_host("visit https://www.codigix.co/about", "codigix.co")
    assert not g.mentions_host("notcodigix.co", "codigix.co")
    assert g.belongs_to("https://blog.codigix.co/x", "codigix.co") and not g.belongs_to("https://codigix.co.evil.io/", "codigix.co")


def test_a_google_profile_of_the_other_website_is_refused():
    b = SimpleNamespace(website="https://codigixinfotech.com/")
    assert "codigix.co" in g.profile_conflict(b, "https://codigix.co/")
    assert g.profile_conflict(b, "https://www.codigixinfotech.com/") is None and g.profile_conflict(b, None) is None


def test_a_listing_of_the_sister_site_is_not_this_projects(monkeypatch):
    b = SimpleNamespace(name="Codigix Infotech", website="https://codigixinfotech.com", phone="+91 98765 43210", country="IN")
    page = (200, "<title>Codigix</title><body>Codigix digital marketing codigix.co Call 98765 43210</body>")
    r = sites.check_listing(b, "https://www.justdial.com/x", page, others=["codigix.co"])
    assert r["status"] == "missing" and "codigix.co" in r["note"]
    assert sites.check_listing(b, "https://www.justdial.com/x", page)["status"] != "missing"  # without a sister site known, the brand and phone still match
