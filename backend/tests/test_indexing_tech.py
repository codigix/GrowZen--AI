from types import SimpleNamespace
from urllib.robotparser import RobotFileParser

from app.services import indexing

BODY = "<html><head><title>Rent</title>{head}</head><body><h1>Lehenga on rent in Pune</h1><p>" + "Designer lehenga rental for weddings and festive occasions. " * 12 + "</p></body></html>"


def fake_client(monkeypatch, status=200, headers=None, text=BODY.format(head=""), final=None, boom=None):
    class C:
        def get(self, url):
            if boom:
                raise boom
            return SimpleNamespace(status_code=status, headers={"content-type": "text/html", **(headers or {})}, text=text, url=final or url)

        def close(self):
            pass

    monkeypatch.setattr("app.services.net.site_client", lambda timeout=10: C())


URL = "https://shop.example/rent"


def verdict(monkeypatch, robots=None, **kw):
    fake_client(monkeypatch, **kw)
    return indexing.check_page(URL, robots)


def test_a_normal_page_can_be_indexed(monkeypatch):
    r = verdict(monkeypatch)
    assert r["verdict"] == "indexable" and r["reasons"] == [] and r["status"] == 200 and r["words"] >= 40


def test_a_noindex_tag_or_header_blocks_it(monkeypatch):
    assert verdict(monkeypatch, text=BODY.format(head='<meta name="robots" content="noindex, follow">'))["verdict"] == "blocked"
    r = verdict(monkeypatch, headers={"x-robots-tag": "noindex"})
    assert r["verdict"] == "blocked" and "X-Robots-Tag" in r["reasons"][0]["text"]


def test_an_error_or_an_unreachable_page_is_blocked(monkeypatch):
    assert verdict(monkeypatch, status=404)["verdict"] == "blocked"
    r = verdict(monkeypatch, boom=RuntimeError("timed out"))
    assert r["verdict"] == "blocked" and "could not be loaded" in r["reasons"][0]["text"]


def test_robots_txt_can_block_googlebot(monkeypatch):
    rp = RobotFileParser()
    rp.parse(["User-agent: *", "Disallow: /rent"])
    r = verdict(monkeypatch, robots=rp)
    assert r["verdict"] == "blocked" and "robots.txt" in r["reasons"][0]["text"]


def test_a_canonical_to_another_page_or_a_redirect_is_risky(monkeypatch):
    r = verdict(monkeypatch, text=BODY.format(head='<link rel="canonical" href="https://shop.example/">'))
    assert r["verdict"] == "risky" and r["canonical"] == "https://shop.example/" and "canonical" in r["reasons"][0]["text"]
    assert verdict(monkeypatch, text=BODY.format(head='<link rel="canonical" href="https://www.shop.example/rent/">'))["verdict"] == "indexable"  # www and a slash are the same page
    r = verdict(monkeypatch, final="https://shop.example/other")
    assert r["verdict"] == "risky" and "redirects" in r["reasons"][0]["text"]


def test_a_page_with_no_readable_text_is_risky(monkeypatch):
    r = verdict(monkeypatch, text="<html><head><title>Shop</title></head><body><div id='root'></div><script src='app.js'></script></body></html>")
    assert r["verdict"] == "risky" and r["words"] < 40 and "JavaScript" in r["reasons"][0]["text"]


def test_the_check_is_stored_and_counted_through_the_api(client, monkeypatch):
    from app.db import SessionLocal
    from app.models import IndexPage
    bid = client.post("/api/v1/businesses", json={"name": "Index Co", "website": "https://shop.example/"}).json()["id"]
    db = SessionLocal()
    try:
        db.add_all([IndexPage(business_id=bid, url="https://shop.example/rent"), IndexPage(business_id=bid, url="https://shop.example/gone")])
        db.commit()
    finally:
        db.close()
    monkeypatch.setattr(indexing, "_robots_for", lambda url: None)
    monkeypatch.setattr(indexing, "check_page", lambda url, robots=None: {"verdict": "blocked" if url.endswith("gone") else "indexable", "reasons": [{"level": "blocked", "text": "HTTP 404"}] if url.endswith("gone") else [], "status": 200, "words": 80, "canonical": None})
    out = client.post(f"/api/v1/businesses/{bid}/indexing/check", json={}).json()
    assert out == {"checked": 2, "indexable": 1, "risky": 0, "blocked": 1}
    o = client.get(f"/api/v1/businesses/{bid}/indexing").json()
    assert o["counts"]["tech_ok"] == 1 and o["counts"]["tech_blocked"] == 1 and o["counts"]["tech_unchecked"] == 0
    by = {p["path"]: p for p in o["pages"]}
    assert by["/gone"]["tech"]["verdict"] == "blocked" and by["/rent"]["tech"]["verdict"] == "indexable"
    assert [p["path"] for p in client.get(f"/api/v1/businesses/{bid}/indexing", params={"status": "tech_problem"}).json()["pages"]] == ["/gone"]
    assert client.post(f"/api/v1/businesses/{bid}/indexing/check", json={}).json()["checked"] == 0  # checked just now: nothing to redo
