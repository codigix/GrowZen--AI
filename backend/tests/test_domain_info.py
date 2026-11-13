"""Domain registration facts: RDAP through the IANA bootstrap, WHOIS when a TLD has no RDAP (for example .co), and safety of the WHOIS connection."""
import pytest

from app.services import domain_info as di

WHOIS_CO = """Domain Name: CODIGIX.CO
Updated Date: 2026-10-08T10:07:51.0Z
Creation Date: 2024-07-20T07:20:08.0Z
Registry Expiry Date: 2027-07-20T23:59:59.0Z
Registrar: GoDaddy.com, LLC
Name Server: NOVA.DNS-PARKING.COM
Name Server: COSMOS.DNS-PARKING.COM
"""


@pytest.fixture(autouse=True)
def _fresh_cache():
    di._cache.clear()
    yield
    di._cache.clear()


def test_registrable_domain():
    assert di.registrable("www.kitchen-canvas.in") == "kitchen-canvas.in"
    assert di.registrable("blog.shop.example.com") == "example.com"
    assert di.registrable("www.example.co.uk") == "example.co.uk"
    assert di.registrable("codigix.co") == "codigix.co"


def test_whois_answers_are_parsed_and_an_empty_answer_is_not_invented():
    r = di.parse_whois("codigix.co", WHOIS_CO)
    assert r["registered_at"] == "2024-07-20" and r["expires_at"] == "2027-07-20" and r["registrar"] == "GoDaddy.com, LLC" and r["source"] == "whois"
    assert r["nameservers"] == ["cosmos.dns-parking.com", "nova.dns-parking.com"] and r["age_days"] > 365
    assert di.parse_whois("x.co", "No match for domain X.CO\n") is None
    assert di.parse_whois("x.co", "Creation Date: not a date\n") is None  # no usable field at all


def test_rdap_first_then_whois_when_the_tld_has_no_rdap(monkeypatch):
    calls = []
    monkeypatch.setattr(di, "_rdap_base", lambda tld: None if tld == "co" else "https://rdap.example/")
    monkeypatch.setattr(di, "_whois_server", lambda tld: "whois.registry.co")
    monkeypatch.setattr(di, "_whois_query", lambda server, text, timeout=8: calls.append((server, text)) or WHOIS_CO)
    r = di.lookup("www.codigix.co")
    assert r["source"] == "whois" and r["registered_at"] == "2024-07-20" and r["error"] is None and calls == [("whois.registry.co", "codigix.co")]
    di.lookup("codigix.co")  # cached: no second WHOIS query
    assert len(calls) == 1
    # A TLD with RDAP uses it and never asks WHOIS
    di._cache.clear()
    calls.clear()
    monkeypatch.setattr(di, "_rdap", lambda domain, tld: di._shape(domain, di._parse_date("2020-01-02"), None, "Reg", ["ns1.x.net"], "rdap"))
    r = di.lookup("example.com")
    assert r["source"] == "rdap" and r["registered_at"] == "2020-01-02" and calls == []


def test_nothing_is_guessed_when_no_registry_answers(monkeypatch):
    monkeypatch.setattr(di, "_rdap", lambda *a: None)
    monkeypatch.setattr(di, "_whois", lambda *a: None)
    r = di.lookup("private-domain.xyz")
    assert r["registered_at"] is None and r["age_days"] is None and r["source"] == "none" and ".xyz registry" in r["error"]
    assert di.lookup("localhost")["error"] and di.lookup("bad domain")["error"] and di.lookup("a..b.com")["error"]


def test_whois_connections_only_go_to_public_hosts(monkeypatch):
    with pytest.raises(OSError):
        di._whois_query("127.0.0.1", "example.com")
    with pytest.raises(OSError):
        di._whois_query("localhost", "example.com")
    with pytest.raises(OSError):
        di._whois_query("evil host", "example.com")
    # a server name that merely looks fine but is not a hostname is dropped from the IANA answer
    monkeypatch.setattr(di, "_whois_query", lambda server, text, timeout=8: "refer: 169.254.169.254; rm -rf\n")
    assert di._whois_server("zz") is None
