"""End-to-end checks that each crawler really works against a small fake web (httpx.MockTransport: no network, SQLite).
Every scenario also asserts that nothing logged an ERROR, i.e. the crawl finished without swallowing an exception."""
import asyncio
import json
import logging

import httpx
import pytest
from sqlalchemy import select

from app.backlink_service import repository as repo
from app.backlink_service.config import Settings
from app.backlink_service.db import Database
from app.backlink_service.models import Seed
from app.backlink_service.worker import Worker


def html(body: str, title: str = "T") -> httpx.Response:
    return httpx.Response(200, text=f"<html><head><title>{title}</title></head><body>{body}</body></html>", headers={"content-type": "text/html"})


def _web(hits: list):
    """seed-a.com is read; other-b.com is only reachable through a link on seed-a.com; codigix.co and shop-two.com are the targets."""
    def handler(req: httpx.Request) -> httpx.Response:
        host, path = req.url.host.removeprefix("www."), req.url.path
        hits.append((host, path))
        if host == "seed-a.com":
            if path == "/robots.txt":
                return httpx.Response(200, text="User-agent: *\nDisallow: /private\n")
            return {
                "/": lambda: html('<a href="/about">about</a> <a href="/blog/1">blog</a> <a href="/private/x">secret</a> <a href="/old">old</a> '
                                  '<a href="/broken">broken</a> <a href="https://other-b.com/">friend</a> <a href="https://pinterest.com/p">pin</a> '
                                  '<a href="/logo.png">img</a> <footer>Built by <a href="https://www.codigix.co/">Codigix</a></footer>'),
                "/about": lambda: html('<a rel="nofollow sponsored" href="https://codigix.co/services/">Services</a>'
                                       '<script>var t = \'<a href=\\"https://shop-two.com/deal\\">Deal</a>\';</script>'),
                "/blog/1": lambda: html('<a href="https://codigix.co/blog">read more</a> <a href="/about">back</a> <a href="/blog/1?utm_source=x">self</a>'),
                "/old": lambda: httpx.Response(301, headers={"location": "/about"}),
                "/broken": lambda: httpx.Response(500),
                "/private/x": lambda: html('<a href="https://codigix.co/hidden">must never be read</a>'),
            }.get(path, lambda: httpx.Response(404))()
        if host == "other-b.com":
            if path == "/robots.txt":
                return httpx.Response(404)
            return {"/": lambda: html('<a href="https://codigix.co/contact">contact us</a> <a href="https://seed-a.com/">seed</a>')}.get(path, lambda: httpx.Response(404))()
        if host == "codigix.co":
            return httpx.Response(404) if path == "/robots.txt" else html('<a href="https://seed-a.com/">our friend</a>')
        return httpx.Response(404)
    return handler


@pytest.fixture()
def no_errors(caplog):
    caplog.set_level(logging.INFO)
    yield
    bad = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert not bad, "crawler logged errors: " + "; ".join(r.getMessage() for r in bad)


def test_async_backlink_service_crawls_a_small_web_end_to_end(tmp_path, no_errors):
    seed_file = tmp_path / "seed.json"
    seed_file.write_text(json.dumps({"seed_urls": ["https://seed-a.com/"]}))
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'bl.db'}", seed_file=seed_file, render_js="off", dns_check=False, per_domain_delay=0.0,
                        verbose=0, workers=1, auto_businesses=False, autostart=True, slot_hours=0, backoff_base=0.0, backoff_max=0.0)
    db = Database(settings)
    db.create_tables()
    hits: list = []
    try:
        repo.load_seed_file(db, seed_file)
        repo.register_target(db, "https://codigix.co/")
        repo.register_target(db, "https://shop-two.com/")  # two targets in one job
        repo.set_crawl_enabled(db, True)

        async def scenario():
            worker = Worker(db, settings, httpx.MockTransport(_web(hits)))
            await worker.fetcher.start()
            try:
                assert await worker.process_one() is True      # seed-a.com
                assert await worker.process_one() is True      # other-b.com, discovered from seed-a.com
                assert await worker.process_one() is False     # nothing else is due
            finally:
                await worker.fetcher.close()
        asyncio.run(scenario())

        _, codigix = repo.search_backlinks(db, "codigix.co")
        _, shop = repo.search_backlinks(db, "shop-two.com")
        found = {(b.source_url, b.target_url, b.link_type, b.found_in) for b in codigix + shop}
        assert ("https://seed-a.com", "https://www.codigix.co/", "dofollow", "html") in {(s.rstrip("/"), t, lt, f) for s, t, lt, f in found}
        assert ("https://seed-a.com/about", "https://codigix.co/services", "nofollow", "html") in found       # rel=nofollow sponsored
        assert ("https://seed-a.com/about", "https://shop-two.com/deal", "dofollow", "script") in found       # link built inside a script, second target
        assert ("https://seed-a.com/blog/1", "https://codigix.co/blog", "dofollow", "html") in found
        assert ("https://other-b.com", "https://codigix.co/contact", "dofollow", "html") in {(s.rstrip("/"), t, lt, f) for s, t, lt, f in found}  # a discovered site
        assert not any("/private" in b.source_url or "hidden" in b.target_url for b in codigix)               # robots.txt respected
        assert not any(b.source_site == "codigix.co" for b in codigix + shop)                                 # the target's own site never counts
        assert ("seed-a.com", "/private/x") not in hits and ("seed-a.com", "/logo.png") not in hits            # never even requested
        assert hits.count(("seed-a.com", "/robots.txt")) == 1                                                  # robots.txt cached, not re-read per page
        assert len({b.link_hash for b in codigix + shop}) == len(codigix + shop)                               # no duplicates

        seeds = {s.site_key: s for s in db.session().__enter__().scalars(select(Seed))}
        assert seeds["seed-a.com"].status == "done" and seeds["seed-a.com"].pages_crawled == 3 and seeds["seed-a.com"].last_error is None
        assert seeds["other-b.com"].status == "done" and seeds["other-b.com"].source == "discovered"
        assert "pinterest.com" not in seeds                                                                    # big platforms are never seeds
    finally:
        db.dispose()


def test_discovery_bot_verifies_then_detects_a_lost_link_but_not_a_failed_fetch(no_errors):
    from app.backlinks import engine, frontier
    from app.backlinks.models import Backlink, BiTrackedTarget
    from app.db import SessionLocal
    from test_backlinks import _wipe

    db = SessionLocal()
    _wipe(db)
    state = {"body": '<a href="https://client.com/pricing">Pricing</a> <a href="/next">next</a>', "status": 200}

    def handler(req):
        if req.url.path == "/robots.txt":
            return httpx.Response(404)
        if state["status"] != 200:
            return httpx.Response(state["status"])
        return html(state["body"]) if req.url.path == "/" else html("next page")
    fetcher = engine.PageFetcher(httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True), sleep=lambda s: None, default_delay=0)
    try:
        db.add(BiTrackedTarget(business_id=1, domain="client.com"))
        row = frontier.enqueue(db, "https://blog.example.org/", "seed", 0, None, priority=90)
        db.commit()
        results = engine.run_batch(db, fetcher, limit=5)
        assert results and results[0]["new_backlinks"] == 1 and results[0]["http_status"] == 200
        bl = db.scalar(select(Backlink))
        assert bl.target_url == "https://client.com/pricing" and bl.current_status == "NEW" and bl.verification_status == "CRAWLER_VERIFIED"
        assert db.scalar(select(frontier.FrontierUrl).where(frontier.FrontierUrl.url == "https://blog.example.org/next")) is not None  # followed the internal link

        state["status"] = 503                                          # the site is down: not evidence that the link is gone
        engine.verify_source_page(db, fetcher, "https://blog.example.org/")
        db.commit()
        db.refresh(bl)
        assert bl.current_status == "NEW"  # a failed fetch is no evidence the link is gone

        state.update(status=200, body="no links to anyone now")        # the page really lost the link
        seen = []
        for _ in range(3):
            engine.verify_source_page(db, fetcher, "https://blog.example.org/")
            db.commit()
            db.refresh(bl)
            seen.append(bl.current_status)
        assert seen[0] == "LOST_PENDING" and seen[-1] == "LOST_CONFIRMED"  # not lost on the first miss, confirmed after repeats
    finally:
        db.rollback()
        _wipe(db)
        db.close()


def test_site_audit_crawler_walks_a_site_and_scores_it(monkeypatch, no_errors):
    from app.services import crawler

    def handler(req):
        path = req.url.path if req.url.path == "/" else req.url.path.rstrip("/")  # /about and /about/ are the same page
        if path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nAllow: /\nSitemap: https://audit.example.org/sitemap.xml\n")
        if path == "/sitemap.xml":
            return httpx.Response(200, text="<urlset><url><loc>https://audit.example.org/hidden-page</loc></url></urlset>", headers={"content-type": "application/xml"})
        pages = {
            "/": '<html lang="en"><head><title>Audit Co home page with a decent title</title><meta name="description" content="d"><meta name="viewport" content="width=device-width"></head>'
                 '<body><h1>Hi</h1><a href="/about/">about</a><a href="/about">about again</a><a href="/missing">gone</a><img src="/a.png"><a href="/file.pdf">pdf</a></body></html>',
            "/about": '<html><head><title>About</title><meta name="robots" content="noindex"></head><body><h1>A</h1><h1>B</h1></body></html>',
            "/hidden-page": '<html><head><title>Only in the sitemap</title></head><body><h1>x</h1></body></html>',
        }
        if path in pages:
            return httpx.Response(200, text=pages[path], headers={"content-type": "text/html"})
        return httpx.Response(404, text="nope", headers={"content-type": "text/html"})
    monkeypatch.setattr(crawler, "site_client", lambda timeout=15, user_agent=None: httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True, timeout=timeout))
    events = []
    site = crawler.crawl("https://audit.example.org/some/inner/page", max_pages=10, on_progress=events.append)
    urls = {p["url"] for p in site["pages"]}
    assert site["start_url"] == "https://audit.example.org/"                     # always starts at the homepage
    assert site["robots_txt"] and site["sitemap"] and site["sitemap_pages"] == 1
    assert "https://audit.example.org/hidden-page" in urls                        # found through the sitemap only
    assert len([u for u in urls if u.rstrip("/").endswith("/about")]) == 1        # /about and /about/ are one page
    assert not any(u.endswith(".pdf") for u in urls)
    assert any(b["url"].endswith("/missing") for b in site["broken"])
    assert [e["step"] for e in events][:2] == ["robots", "sitemap"] and any(e["step"] == "page" for e in events)
    score, issues = crawler.summarise(site)
    codes = {i["code"] for i in issues}
    assert {"noindex", "h1_count", "missing_meta_description", "thin_content"} <= codes
    assert 0 <= score <= 100 and isinstance(score, int)
    home = next(p for p in site["pages"] if p["url"] == "https://audit.example.org/")
    assert home["inbound"] == 0 and home["internal_out"] >= 2 and "links" not in home
