"""Backlink report from our own crawler: the routes, the fallback of the search and the error handling. The crawler is replaced by fakes (no network)."""
import pytest

from app.services import crawler_client as cc

BACKLINKS = {"domain": "a.com", "status": "ok", "total_backlinks": 4, "verified_backlinks": 3, "total_referring_domains": 2,
             "backlinks": [{"source_url": "https://x.com/", "destination_url": "https://a.com/", "anchor_text": "A", "link_status": "verified"}]}


@pytest.fixture()
def fake(monkeypatch):
    monkeypatch.setattr(cc, "backlinks", lambda d, **kw: BACKLINKS | {"domain": d})
    monkeypatch.setattr(cc, "referring_domains", lambda d: {"referring_domains": [{"domain": "x.com", "backlinks": 3}]})
    monkeypatch.setattr(cc, "anchors", lambda d: {"anchors": [{"anchor_text": "A", "count": 3}]})
    monkeypatch.setattr(cc, "history", lambda d, n=200: {"events": [{"event": "new"}]})
    monkeypatch.setattr(cc, "global_status", lambda: {"paused": False, "workers": [{"name": "crawler", "healthy": True, "secret": "x"}], "discovered_domains": 5})
    monkeypatch.setattr(cc, "discovery_status", lambda: {"sources": [{"name": "tranco", "enabled": 1, "items_imported": 9, "cursor": "hidden"}]})


def test_normalize_domain():
    assert cc.normalize_domain("https://www.Codigix.co/blog?x=1") == "codigix.co"
    for bad in ("", "not a domain", "localhost", "http://"):
        with pytest.raises(ValueError):
            cc.normalize_domain(bad)


def test_report_combines_the_crawler_answers(client, fake):
    r = client.get("/api/v1/backlink-intel/crawler/report", params={"domain": "https://www.A.com/page"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["domain"] == "a.com" and d["total_backlinks"] == 4 and d["total_referring_domains"] == 2
    assert d["referring_domains"][0]["domain"] == "x.com" and d["anchors"][0]["count"] == 3 and d["history"] == [{"event": "new"}]


def test_report_rejects_a_non_domain(client, fake):
    assert client.get("/api/v1/backlink-intel/crawler/report", params={"domain": "not a domain"}).status_code == 422


def test_status_exposes_only_summary_fields(client, fake):
    d = client.get("/api/v1/backlink-intel/crawler/status").json()
    assert d["discovered_domains"] == 5 and "secret" not in d["workers"][0] and "cursor" not in d["sources"][0]


def test_crawler_down_is_a_clear_503_not_made_up_data(client, monkeypatch):
    def boom(*a, **k):
        raise cc.CrawlerError("The backlink crawler could not be reached: ConnectError")
    monkeypatch.setattr(cc, "backlinks", boom)
    r = client.get("/api/v1/backlink-intel/crawler/report", params={"domain": "a.com"})
    assert r.status_code == 503 and "could not be reached" in r.json()["detail"]


def test_not_set_up_says_so(client, monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "crawler_api_key", "")
    r = client.get("/api/v1/backlink-intel/crawler/status")
    assert r.status_code == 503 and "not set up" in r.json()["detail"]


def test_search_falls_back_to_the_crawler(client, fake, monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "crawler_url", "https://c.example")
    monkeypatch.setattr(get_settings(), "crawler_api_key", "k")
    r = client.get("/api/v1/backlink-intel/lookup", params={"q": "zzzunknownzzz.com"})
    assert r.status_code == 200, r.text
    f = r.json()["crawler_fallback"]
    assert f["state"] == "done" and f["domain"] == "zzzunknownzzz.com" and f["total_backlinks"] == 4
