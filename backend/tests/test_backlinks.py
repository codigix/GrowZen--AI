"""Backlink Intelligence: normalization, robots, extraction, lifecycle, provenance, frontier, fetcher policy, API tenancy and gap.
No network: pages come from httpx.MockTransport, providers are in-memory."""
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import select

from app.backlinks import analytics, engine, frontier, robots
from app.backlinks.extract import extract_page
from app.backlinks.lifecycle import FetchEvidence, LinkEvidence, apply_crawl_observation
from app.backlinks.models import ActionOutcome, BiDomainScore, BiBotConfig, BiPage, BiDomainReview, Backlink, BacklinkEvent, BacklinkProvenance, BiTrackedTarget, CrawlAttempt, FrontierUrl
from app.backlinks.repository import LinkRecord, get_page, upsert_imported_link
from app.backlinks.urls import normalize_url, registrable_domain
from app.db import SessionLocal, utcnow


@pytest.fixture()
def db():
    """A session that leaves every backlink table empty afterwards (cached robots.txt and pages must not leak between tests)."""
    s = SessionLocal()
    _wipe(s)
    yield s
    s.rollback()
    _wipe(s)
    s.close()


def _wipe(s):
    from app.backlinks.models import BacklinkObservation, BiDomain
    from app.backlinks.models import ActionOutcome, BiDomainScore, WatchEvent, WatchPage, WatchReport
    for model in (WatchEvent, WatchPage, WatchReport, ActionOutcome, BiDomainScore, BacklinkEvent, BacklinkObservation, BacklinkProvenance, Backlink, BiPage, FrontierUrl, CrawlAttempt, BiBotConfig, BiDomainReview,
                  BiTrackedTarget, BiDomain):
        s.query(model).delete()
    s.commit()


def _events(db, bl):
    return [e.event_type for e in db.scalars(select(BacklinkEvent).where(BacklinkEvent.backlink_id == bl.id).order_by(BacklinkEvent.id))]


def _link(db, source="https://blog.example.org/post", target="https://client.com/", **kw):
    bl, _ = upsert_imported_link(db, LinkRecord(source, target, kw.pop("anchor", "Client"), kw.pop("rel", []), **kw), "manual_import")
    db.commit()
    return bl


def _found(anchor="Client", rel=(), placement="main"):
    return LinkEvidence(anchor, list(rel), placement, "text")


# ---- URLs -----------------------------------------------------------------------------------------------------------------

def test_url_normalization():
    assert normalize_url("HTTP://Example.COM:80/a/./b/../c?utm_source=x&id=1#frag") == "http://example.com/a/c?id=1"
    assert normalize_url("https://example.com") == "https://example.com/"
    assert normalize_url("https://example.com/dir/") == "https://example.com/dir/"
    assert normalize_url("https://example.com/?a=1&b=2") != normalize_url("https://example.com/?a=1")  # queries are not stripped blindly
    assert normalize_url("https://bücher.de/") == "https://xn--bcher-kva.de/"
    with pytest.raises(ValueError):
        normalize_url("ftp://example.com/")


def test_registrable_domain():
    assert registrable_domain("blog.example.co.uk") == "example.co.uk"
    assert registrable_domain("www.example.com") == "example.com"
    assert registrable_domain("sub.shop.example.in") == "example.in"


# ---- robots (RFC 9309) --------------------------------------------------------------------------------------------------

def test_robots_longest_match_and_wildcards():
    r = robots.parse("User-agent: *\nDisallow: /private/\nAllow: /private/public\nDisallow: /*.pdf$\nCrawl-delay: 5\nSitemap: https://x.com/s.xml")
    assert not r.allowed("https://x.com/private/a")
    assert r.allowed("https://x.com/private/public/page")
    assert not r.allowed("https://x.com/doc.pdf")
    assert r.allowed("https://x.com/doc.pdf.html")
    assert r.allowed("https://x.com/robots.txt")
    assert r.delay() == 5 and r.sitemaps == ["https://x.com/s.xml"]


def test_robots_specific_agent_beats_wildcard_and_status_semantics():
    r = robots.parse("User-agent: *\nDisallow: /\n\nUser-agent: CodigixBacklinkBot\nDisallow: /admin\n")
    assert r.allowed("https://x.com/page") and not r.allowed("https://x.com/admin/x")
    assert robots.from_response(404, None)[0].allowed("https://x.com/a")  # 4xx: no restrictions
    assert not robots.from_response(503, None)[0].allowed("https://x.com/a")  # 5xx: assume disallow
    assert not robots.from_response(None, None)[0].allowed("https://x.com/a")


# ---- extraction -------------------------------------------------------------------------------------------------------------

def test_extraction_anchor_rel_placement_and_instances():
    html = """<html><head><title>T</title><base href="https://blog.example.org/"></head><body>
    <nav><a href="https://client.com/" rel="nofollow noopener">Nav link</a></nav>
    <article><p>Read <a href="https://client.com/?utm_source=a" rel="sponsored">Client</a> and <a href="https://client.com/">again</a>
    <a href="/local"><img src="x.png" alt="Logo"></a><a href="mailto:a@b.c">m</a><a href="#top">t</a></p></article>
    <footer><a href="https://other.com/x">Other</a></footer></body></html>"""
    ex = extract_page(html, "https://blog.example.org/post")
    links = [(l.target_url, l.anchor_text, l.rel_attributes, l.placement, l.instance, l.internal) for l in ex.links]
    assert ("https://client.com/", "Nav link", ["nofollow"], "navigation", 0, False) in links
    assert ("https://client.com/", "Client", ["sponsored"], "main", 1, False) in links  # tracking param stripped -> same target, 2nd instance
    assert ("https://client.com/", "again", [], "main", 2, False) in links
    assert ("https://blog.example.org/local", "Logo", [], "main", 0, True) in links
    assert ("https://other.com/x", "Other", [], "footer", 0, False) in links
    assert len(links) == 5 and ex.title == "T"


# ---- lifecycle --------------------------------------------------------------------------------------------------------------

def test_transient_source_errors_never_mark_lost(db):
    bl = _link(db)
    apply_crawl_observation(db, bl, FetchEvidence(200, link=_found()))
    assert bl.current_status == "LIVE"
    for status in (403, 429, 500, 503, None):
        apply_crawl_observation(db, bl, FetchEvidence(status, link=None))
    apply_crawl_observation(db, bl, FetchEvidence(200, complete=False, link=None))  # truncated body is not evidence
    assert bl.current_status == "LIVE" and bl.absent_count == 0
    assert "LOST_PENDING" not in _events(db, bl)


def test_lost_pending_then_confirmed_then_restored(db):
    bl = _link(db)
    apply_crawl_observation(db, bl, FetchEvidence(200, link=_found()))
    apply_crawl_observation(db, bl, FetchEvidence(200, link=None))
    assert bl.current_status == "LOST_PENDING"
    apply_crawl_observation(db, bl, FetchEvidence(200, link=None))
    assert bl.current_status == "LOST_CONFIRMED"
    apply_crawl_observation(db, bl, FetchEvidence(200, link=_found()))
    assert bl.current_status == "RESTORED"
    db.commit()
    ev = _events(db, bl)
    assert ev[0] == "NEW" and ev[-3:] == ["LOST_PENDING", "LOST_CONFIRMED", "RESTORED"]
    apply_crawl_observation(db, bl, FetchEvidence(200, link=_found()))
    assert bl.current_status == "LIVE"


def test_lost_pending_recovers_without_confirming(db):
    bl = _link(db)
    apply_crawl_observation(db, bl, FetchEvidence(200, link=_found()))
    apply_crawl_observation(db, bl, FetchEvidence(200, link=None))
    apply_crawl_observation(db, bl, FetchEvidence(200, link=_found()))
    assert bl.current_status == "LIVE" and bl.absent_count == 0
    assert "LOST_CONFIRMED" not in _events(db, bl)


def test_page_gone_counts_as_absence(db):
    bl = _link(db)
    apply_crawl_observation(db, bl, FetchEvidence(200, link=_found()))
    apply_crawl_observation(db, bl, FetchEvidence(404, link=None))
    assert bl.current_status == "LOST_PENDING"


def test_anchor_rel_placement_changes_are_events_and_nofollow_stays_live(db):
    bl = _link(db)
    apply_crawl_observation(db, bl, FetchEvidence(200, link=_found("Client", [], "main")))
    apply_crawl_observation(db, bl, FetchEvidence(200, link=_found("Best Client", ["nofollow"], "footer")))
    db.commit()
    assert bl.current_status == "CHANGED" and bl.rel_attributes == ["nofollow"]
    assert {"ANCHOR_CHANGED", "REL_CHANGED", "PLACEMENT_CHANGED"} <= set(_events(db, bl))
    e = db.scalar(select(BacklinkEvent).where(BacklinkEvent.backlink_id == bl.id, BacklinkEvent.event_type == "ANCHOR_CHANGED"))
    assert (e.previous_value, e.new_value) == ("Client", "Best Client") and e.evidence_observation_id
    apply_crawl_observation(db, bl, FetchEvidence(200, link=_found("Best Client", ["nofollow"], "footer")))
    assert bl.current_status == "LIVE"


def test_redirect_recorded_without_rewriting_target(db):
    bl = _link(db)
    original = bl.target_url
    apply_crawl_observation(db, bl, FetchEvidence(200, link=_found(), redirected_to="https://blog.example.org/new-post"))
    db.commit()
    assert bl.target_url == original and bl.current_status == "REDIRECTED_SOURCE"
    assert "REDIRECT_CHANGED" in _events(db, bl)


def test_broken_target_is_still_a_present_link(db):
    bl = _link(db)
    apply_crawl_observation(db, bl, FetchEvidence(200, link=_found(), target_http_status=404))
    assert bl.current_status == "BROKEN_TARGET"


# ---- provenance and dedupe ------------------------------------------------------------------------------------------------

def test_same_link_from_two_providers_is_one_backlink_two_provenance_rows(db):
    a, created_a = upsert_imported_link(db, LinkRecord("https://blog.example.org/post#x", "https://client.com", "Client"), "manual_import")
    b, created_b = upsert_imported_link(db, LinkRecord("https://BLOG.example.org:443/post", "https://client.com/", "Client"), "partner_list")
    db.commit()
    assert created_a and not created_b and a.id == b.id
    assert sorted(p.source for p in db.scalars(select(BacklinkProvenance).where(BacklinkProvenance.backlink_id == a.id))) == ["manual_import", "partner_list"]
    assert _events(db, a) == ["NEW"]
    assert a.verification_status == "IMPORTED"


def test_provider_data_never_overrides_crawler_verified_state(db):
    bl = _link(db)
    apply_crawl_observation(db, bl, FetchEvidence(200, link=_found("Crawled anchor")))
    db.commit()
    upsert_imported_link(db, LinkRecord("https://blog.example.org/post", "https://client.com/", "Imported anchor", is_lost=True), "manual_import")
    db.commit()
    db.refresh(bl)
    assert bl.current_status == "CHANGED" and bl.anchor_text == "Crawled anchor" and bl.verification_status == "CRAWLER_VERIFIED"
    assert bl.provider_status == "LOST"  # the provider's claim is kept separately






# ---- frontier ---------------------------------------------------------------------------------------------------------------

def test_frontier_dedupes_prevents_traps_and_is_fair(db):
    a = frontier.enqueue(db, "https://a.com/x#top")
    assert frontier.enqueue(db, "https://a.com/x").id == a.id
    assert frontier.enqueue(db, "https://a.com/a/a/a/a/page") is None  # repeating path = crawl trap
    assert frontier.enqueue(db, "https://a.com/?a=1&b=2&c=3&d=4&e=5") is None
    assert frontier.enqueue(db, "https://a.com/deep", depth=frontier.MAX_DEPTH + 1) is None
    frontier.enqueue(db, "https://a.com/y", priority=90)
    frontier.enqueue(db, "https://b.com/x", priority=10)
    db.commit()
    picked = frontier.take_next(db, 10)
    assert sorted(p.domain_id for p in picked) == sorted({p.domain_id for p in picked}) and len(picked) == 2  # one per domain
    assert picked[0].url == "https://a.com/y"  # best priority first


def test_frontier_retry_backoff_and_dead_letter(db):
    row = frontier.enqueue(db, "https://c.com/")
    now = utcnow()
    frontier.fail(db, row, "timeout", now=now)
    assert row.status == "pending" and row.queue == "retry" and row.next_eligible_at > now
    for _ in range(frontier.MAX_ATTEMPTS):
        frontier.fail(db, row, "timeout", now=now)
    assert row.status == "dead"


def test_stale_in_progress_rows_are_recovered_after_worker_crash(db):
    row = frontier.enqueue(db, "https://d.com/")
    db.commit()
    (claimed,) = frontier.take_next(db, 1)
    assert claimed.status == "in_progress" and frontier.recover_stale(db) == 0
    assert frontier.recover_stale(db, utcnow() + timedelta(hours=1)) == 1 and row.status == "pending"


def test_crawl_priority_uses_documented_weights():
    assert frontier.crawl_priority(relevance=1) == 25
    assert frontier.crawl_priority(**{k: 1 for k in frontier.PRIORITY_WEIGHTS}) == 100
    assert frontier.crawl_priority(relevance=5) == 25  # inputs are clamped to 0..1


# ---- fetcher policy + end-to-end crawl ------------------------------------------------------------------------------------

def _fetcher(handler):
    return engine.PageFetcher(httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True), sleep=lambda s: None, default_delay=0)


PAGE = '<html><title>Post</title><body><article><a href="https://client.com/pricing" rel="nofollow">Pricing</a></article></body></html>'


def test_crawler_respects_robots_and_discovers_backlink_then_detects_loss(db):
    db.add(BiTrackedTarget(business_id=1, domain="client.com"))
    db.commit()
    state = {"html": PAGE, "status": 200}

    def handler(req: httpx.Request):
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nDisallow: /private/")
        if req.url.path.startswith("/private"):
            return httpx.Response(200, text="<html></html>", headers={"content-type": "text/html"})
        return httpx.Response(state["status"], text=state["html"], headers={"content-type": "text/html; charset=utf-8"})

    f = _fetcher(handler)
    out = engine.verify_source_page(db, f, "https://blog.example.org/post")
    db.commit()
    assert out["new_backlinks"] == 1
    bl = db.scalar(select(Backlink))
    assert bl.current_status == "NEW" and bl.verification_status == "CRAWLER_VERIFIED" and bl.rel_attributes == ["nofollow"]
    assert db.scalar(select(BacklinkProvenance.source).where(BacklinkProvenance.backlink_id == bl.id)) == "codigix_crawler"

    blocked = engine.verify_source_page(db, f, "https://blog.example.org/private/x")
    assert blocked["error_code"] == "robots_disallowed"
    assert any(a.purpose == "robots" for a in db.scalars(select(CrawlAttempt)))

    state.update(status=500)
    engine.verify_source_page(db, f, "https://blog.example.org/post")
    assert bl.current_status == "NEW"  # a 500 is not evidence of removal
    state.update(status=200, html="<html><body>link removed</body></html>")
    engine.verify_source_page(db, f, "https://blog.example.org/post")
    assert bl.current_status == "LOST_PENDING"
    engine.verify_source_page(db, f, "https://blog.example.org/post")
    assert bl.current_status == "LOST_CONFIRMED"


def test_429_honours_retry_after_and_fetch_failure_retries_row(db):
    f = _fetcher(lambda req: httpx.Response(200, text="") if req.url.path == "/robots.txt" else httpx.Response(429, headers={"retry-after": "120"}))
    row = frontier.enqueue(db, "https://slow.example.org/p")
    row.status = "in_progress"
    out = engine.crawl_row(db, f, row, set())
    assert out["http_status"] == 429 and row.status == "pending" and row.queue == "retry"
    assert row.next_eligible_at >= utcnow() + timedelta(seconds=100)
    assert f._backoff["slow.example.org"] > 0


def test_non_html_and_oversized_responses_are_not_evidence(db):
    def handler(req):
        if req.url.path == "/robots.txt":
            return httpx.Response(404)
        if req.url.path == "/file.pdf":
            return httpx.Response(200, content=b"%PDF", headers={"content-type": "application/pdf"})
        return httpx.Response(200, content=b"x" * (engine.MAX_BYTES + 10), headers={"content-type": "text/html"})
    f = _fetcher(handler)
    assert f.fetch(db, "https://e.org/file.pdf").error_code == "unsupported_content_type"
    big = f.fetch(db, "https://e.org/big")
    assert big.error_code == "too_large" and not big.complete


def test_ssrf_targets_are_blocked_by_the_real_transport(db):
    f = engine.PageFetcher(sleep=lambda s: None, default_delay=0)
    for url in ("http://127.0.0.1/", "http://169.254.169.254/latest/meta-data", "http://localhost:8000/"):
        res = f.fetch(db, url)
        assert res.error_code in ("ssrf_blocked", "robots_disallowed") and res.status is None, url


def test_same_page_via_many_sources_is_one_page_identity(db):
    ids = {get_page(db, u).id for u in ("https://a.org/p", "HTTPS://A.ORG:443/p#frag", "https://a.org/p?utm_campaign=x")}
    assert len(ids) == 1


# ---- API: tenancy, search, history, gap ---------------------------------------------------------------------------------

def _seed_graph(db, business_id):
    db.add_all([BiTrackedTarget(business_id=business_id, domain="client.com"), BiTrackedTarget(business_id=business_id, domain="rival.com", is_competitor=True)])
    for src, tgt in (("https://shared.org/a", "https://client.com/"), ("https://shared.org/b", "https://rival.com/"), ("https://gap.org/a", "https://rival.com/"),
                     ("https://gap2.org/a", "https://rival.com/"), ("https://gap2.org/b", "https://rival.com/x")):
        upsert_imported_link(db, LinkRecord(src, tgt, "anchor"), "manual_import")
    db.commit()


def test_api_search_detail_history_summary_gap(db, client):
    bid = client.post("/api/v1/businesses", json={"name": "Gap Co"}).json()["id"]
    _seed_graph(db, bid)
    base = f"/api/v1/businesses/{bid}/backlink-intel"
    r = client.get(base, params={"target": "rival.com", "limit": 2})
    body = r.json()
    assert r.status_code == 200 and len(body["data"]) == 2 and body["pagination"]["has_more"]
    nxt = client.get(base, params={"target": "rival.com", "limit": 2, "cursor": body["pagination"]["next_cursor"]}).json()
    assert len(nxt["data"]) == 2 and not nxt["pagination"]["has_more"]
    first = body["data"][0]
    assert first["verification_status"] == "IMPORTED"
    d = client.get(f"{base}/{first['id']}").json()
    assert d["provenance"][0]["source"] == "manual_import"
    assert client.get(f"{base}/{first['id']}/history").json()["events"][0]["type"] == "NEW"
    s = client.get(f"{base}/summary", params={"domain": "rival.com"}).json()
    assert s["backlinks"] == 4 and s["referring_domains"] == 3 and s["crawler_verified"] == 0 and s["not_yet_verified"] == 4
    gap = client.get(f"{base}/gap", params={"client": "client.com"}).json()["gap"]
    assert [g["domain"] for g in gap] == ["gap2.org", "gap.org"]  # same competitor count, so more links first; shared.org already links to the client
    assert client.get(base, params={"status": "bogus"}).status_code == 422
    assert client.get(f"{base}/summary", params={"domain": "untracked.com"}).status_code == 404


def test_api_tenant_isolation(db, client):
    a = client.post("/api/v1/businesses", json={"name": "Tenant A"}).json()["id"]
    b = client.post("/api/v1/businesses", json={"name": "Tenant B"}).json()["id"]
    _seed_graph(db, a)
    other = f"/api/v1/businesses/{b}/backlink-intel"
    assert client.get(other).json()["data"] == []
    some_id = client.get(f"/api/v1/businesses/{a}/backlink-intel").json()["data"][0]["id"]
    assert client.get(f"{other}/{some_id}").status_code == 404
    assert client.get(f"{other}/summary", params={"domain": "client.com"}).status_code == 404
    assert client.post(f"{other}/verify", json={"backlink_ids": [some_id]}).json()["queued"] == 0


def test_api_targets_and_verify(db, client):
    bid = client.post("/api/v1/businesses", json={"name": "Verify Co"}).json()["id"]
    base = f"/api/v1/businesses/{bid}/backlink-intel"
    t = client.post(f"{base}/targets", json={"domain": "https://www.Client.co.uk/path", "name": "Me"})
    assert t.status_code == 201 and t.json()["domain"] == "client.co.uk"
    assert client.post(f"{base}/targets", json={"domain": "client.co.uk"}).json()["id"] == t.json()["id"]
    assert client.post(f"{base}/import", json={"domain": "client.co.uk"}).status_code in (404, 405)  # no third-party import exists any more
    assert client.post(f"{base}/verify", json={}).status_code == 422
    upsert_imported_link(db, LinkRecord("https://src.org/p", "https://client.co.uk/"), "manual_import")
    db.commit()
    assert client.post(f"{base}/verify", json={"all_due": True}).json() == {"queued": 1}
    assert client.get(f"{base}/crawl/status").json()["frontier"]["verification"]["pending"] == 1
    assert client.delete(f"{base}/targets/{t.json()['id']}").status_code == 204


def test_analytics_counts_distinct_links_not_domains(db):
    db.add(BiTrackedTarget(business_id=1, domain="client.com"))
    upsert_imported_link(db, LinkRecord("https://x.org/a", "https://client.com/", "One"), "manual_import")
    upsert_imported_link(db, LinkRecord("https://x.org/b", "https://client.com/", "One"), "manual_import")
    db.commit()
    s = analytics.summary(db, "client.com")
    assert s["backlinks"] == 2 and s["referring_domains"] == 1
    assert analytics.anchor_distribution(db, "client.com") == [{"anchor": "one", "count": 2, "share": 1.0}]


def test_overview_report_sections_and_anchor_types(db, client):
    bid = client.post("/api/v1/businesses", json={"name": "Border Co"}).json()["id"]
    db.add(BiTrackedTarget(business_id=bid, domain="client.com"))
    rows = [("https://a.org/1", "https://client.com/", "client.com", ["nofollow"]), ("https://a.org/2", "https://client.com/pricing", "Buy cheap widgets", []),
            ("https://b.org/1", "https://client.com/", "Client", []), ("https://c.org/1", "https://client.com/", "source", ["ugc"]),
            ("https://d.org/1", "https://client.com/", "Client reviews and a full tariff guide", []), ("https://e.org/1", "https://client.com/", None, [])]
    for src, tgt, anchor, rel in rows:
        upsert_imported_link(db, LinkRecord(src, tgt, anchor, rel, link_type="text"), "manual_import")
    db.commit()
    o = client.get(f"/api/v1/businesses/{bid}/backlink-intel/overview", params={"domain": "client.com"}).json()
    assert o["referring_domains"]["total"] == 5 and o["backlinks"]["total"] == 6 and o["backlinks"]["follow_pct"] == 83.3
    assert o["attributes"] == {"follow": 5, "nofollow": 1, "sponsored": 0, "ugc": 1}
    assert o["anchor_types"] == {"money": 1, "compound": 1, "branded": 1, "organic": 1, "other": 0, "naked": 1, "empty": 1}
    assert o["target_pages"][0]["target_url"] == "https://client.com/" and o["target_pages"][0]["domains"] == 5
    assert o["top_referring_domains"][0] == {**o["top_referring_domains"][0], "domain": "a.org", "backlinks": 2}
    assert len(o["trend"]) == 12 and o["trend"][-1]["total"] == 5 and o["trend"][-1]["new"] == 5




def test_review_workflow_and_disavow_file(db, client):
    bid = client.post("/api/v1/businesses", json={"name": "Review Co"}).json()["id"]
    other = client.post("/api/v1/businesses", json={"name": "Other Co"}).json()["id"]
    _seed_graph(db, bid)
    base = f"/api/v1/businesses/{bid}/backlink-intel"
    assert client.put(f"{base}/reviews", json={"domain": "client.com", "source_domains": ["shared.org"], "status": "disavow"}).json() == {"updated": 1}
    assert client.put(f"{base}/reviews", json={"domain": "client.com", "source_domains": ["x.org"], "status": "bogus"}).status_code == 422
    assert client.get(f"{base}/disavow", params={"domain": "client.com"}).text.endswith("domain:shared.org\n")
    o = client.get(f"{base}/overview", params={"domain": "client.com"}).json()
    assert o["review"]["disavow"]["marked"] == 1 and o["top_referring_domains"][0]["review"] == "disavow"
    assert client.get(f"/api/v1/businesses/{other}/backlink-intel/disavow", params={"domain": "client.com"}).status_code == 404  # not their target
    client.put(f"{base}/reviews", json={"domain": "client.com", "source_domains": ["shared.org"], "status": None})
    assert client.get(f"{base}/disavow", params={"domain": "client.com"}).text.count("domain:") == 0


# ---- autonomous discovery bot ----------------------------------------------------------------------------------------------

def _page(body):
    return httpx.Response(200, text=f"<html><head><title>t</title></head><body><article>{body}</article></body></html>", headers={"content-type": "text/html"})


def _xml(urls, index=False):
    tag = "sitemap" if index else "url"
    return httpx.Response(200, text="<?xml version='1.0'?><urlset>" + "".join(f"<{tag}><loc>{u}</loc></{tag}>" for u in urls) + "</urlset>",
                          headers={"content-type": "application/xml"})


FAKE_WEB = {
    ("client.com", "/"): lambda: _page('<a href="/about">About</a> <a href="https://partner.org/">Our partner</a> <a href="https://facebook.com/client">fb</a>'),
    ("client.com", "/about"): lambda: _page("about us"),
    ("client.com", "/blog"): lambda: _page("blog"),
    ("client.com", "/sitemap.xml"): lambda: _xml(["https://client.com/blog", "https://evil.com/steal"]),
    ("rival.com", "/"): lambda: _page('<a href="https://news.net/">News</a>'),
    ("partner.org", "/"): lambda: _page('Friends: <a href="https://client.com/" rel="nofollow">Client</a> <a href="https://deep.io/">deep</a>'),
    ("partner.org", "/sitemap.xml"): lambda: _xml(["https://partner.org/guide"]),
    ("partner.org", "/guide"): lambda: _page('<a href="https://client.com/pricing">Client pricing</a>'),
    ("news.net", "/"): lambda: _page('<a href="https://rival.com/">Rival</a> <a href="https://private.net/x">x</a>'),
    ("deep.io", "/"): lambda: _page('<a href="https://client.com/">Client (hop 2)</a>'),
}


def _fake_web_fetcher(requested):
    def handler(req):
        requested.append((req.url.host, req.url.path))
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nDisallow: /private\nSitemap: https://partner.org/sitemap.xml") if req.url.host == "partner.org" else httpx.Response(404)
        page = FAKE_WEB.get((req.url.host, req.url.path))
        return page() if page else httpx.Response(404)
    return _fetcher(handler)


def test_bot_explores_outward_and_finds_backlinks_for_you_and_competitors(db, client):
    from app.backlinks import bot
    bid = client.post("/api/v1/businesses", json={"name": "Bot Co"}).json()["id"]
    db.add_all([BiTrackedTarget(business_id=bid, domain="client.com"), BiTrackedTarget(business_id=bid, domain="rival.com", is_competitor=True)])
    db.commit()
    requested = []
    cfg = bot.get_config(db, bid)
    cfg.pages_per_run, cfg.max_hops = 100, 1
    db.commit()
    stats = bot.run_cycle(db, _fake_web_fetcher(requested), bid)
    assert stats["seeded"] == 2 and stats["errors"] == 0
    found = {(db.get(BiPage, b.source_page_id).normalized_url, b.target_url) for b in db.scalars(select(Backlink))}
    assert ("https://partner.org/", "https://client.com/") in found  # one hop from the client's site
    assert ("https://news.net/", "https://rival.com/") in found  # one hop from the competitor's site
    assert ("https://partner.org/guide", "https://client.com/pricing") in found  # via the proven linker's sitemap
    assert not any(h == "deep.io" for h, _ in requested)  # two hops away: beyond max_hops=1
    assert not any(h == "facebook.com" for h, _ in requested) and not any(h == "evil.com" for h, _ in requested)  # skip-list and cross-site sitemap entry
    assert ("client.com", "/blog") in requested  # the tracked site's own sitemap was followed
    assert ("private.net", "/x") not in requested
    assert all(b.verification_status == "CRAWLER_VERIFIED" for b in db.scalars(select(Backlink)))
    s = bot.status(db, bid)
    assert s["running"] is False and s["totals"]["backlinks_found_by_bot"] == 3 and s["last_stats"]["new_backlinks"] == 3


def test_bot_hop_limit_controls_how_far_it_wanders(db, client):
    from app.backlinks import bot
    bid = client.post("/api/v1/businesses", json={"name": "Hop Co"}).json()["id"]
    db.add(BiTrackedTarget(business_id=bid, domain="client.com"))
    cfg = bot.get_config(db, bid)
    cfg.pages_per_run, cfg.max_hops = 100, 2
    db.commit()
    requested = []
    bot.run_cycle(db, _fake_web_fetcher(requested), bid)
    assert ("deep.io", "/") in requested
    assert any(db.get(BiPage, b.source_page_id).normalized_url == "https://deep.io/" for b in db.scalars(select(Backlink)))


def test_bot_respects_page_budget_and_does_not_run_twice_at_once(db, client):
    from app.backlinks import bot
    bid = client.post("/api/v1/businesses", json={"name": "Budget Co"}).json()["id"]
    db.add(BiTrackedTarget(business_id=bid, domain="client.com"))
    cfg = bot.get_config(db, bid)
    cfg.pages_per_run, cfg.max_hops = 5, 2
    db.commit()
    stats = bot.run_cycle(db, _fake_web_fetcher([]), bid)
    assert stats["pages"] == 5
    cfg = bot.get_config(db, bid)
    cfg.running, cfg.run_started_at = True, utcnow()
    db.commit()
    assert bot.run_cycle(db, _fake_web_fetcher([]), bid) == {"skipped": "already running"}
    cfg.run_started_at = utcnow() - timedelta(hours=1)  # a crashed run does not block forever
    db.commit()
    assert "skipped" not in bot.run_cycle(db, _fake_web_fetcher([]), bid)


def test_bot_api_configure_run_and_status(db, client, monkeypatch):
    from app.backlinks import router as bl_router
    bid = client.post("/api/v1/businesses", json={"name": "Api Co"}).json()["id"]
    base = f"/api/v1/businesses/{bid}/backlink-intel"
    assert client.post(f"{base}/bot/run").status_code == 409  # nothing tracked yet
    client.post(f"{base}/targets", json={"domain": "client.com"})
    monkeypatch.setattr(bl_router, "get_fetcher", lambda: _fake_web_fetcher([]))
    assert client.put(f"{base}/bot", json={"pages_per_run": 2}).status_code == 422  # below the minimum
    cfg = client.put(f"{base}/bot", json={"enabled": True, "pages_per_run": 20, "max_hops": 1}).json()["config"]
    assert cfg == {"enabled": True, "pages_per_run": 20, "interval_minutes": 30, "max_hops": 1, "render_js": False}
    assert client.post(f"{base}/bot/run").status_code == 202  # test client runs the background task before returning
    s = client.get(f"{base}/bot").json()
    assert s["running"] is False and s["last_stats"]["pages"] > 0 and s["totals"]["backlinks_found_by_bot"] >= 1
    assert s["recent"] and s["frontier"]


def test_bot_run_due_honours_interval_and_enabled_flag(db, client):
    from app.backlinks import bot
    bid = client.post("/api/v1/businesses", json={"name": "Due Co"}).json()["id"]
    db.add(BiTrackedTarget(business_id=bid, domain="client.com"))
    cfg = bot.get_config(db, bid)
    db.commit()
    f = _fake_web_fetcher([])
    assert bot.run_due(db, f) == 0  # disabled
    cfg.enabled = True
    db.commit()
    assert bot.run_due(db, f) == 1
    assert bot.run_due(db, f) == 0  # ran just now: not due again until the interval passes


def test_final_url_is_the_real_host_not_the_ssrf_pinned_ip(db):
    """The SSRF transport rewrites request.url to the validated IP; links must still resolve against the real site."""
    def handler(req: httpx.Request):
        if req.url.path == "/robots.txt":
            return httpx.Response(404)
        real_host = req.url.host
        req.url = req.url.copy_with(host="203.0.113.7")  # what SSRFSafeTransport does
        req.extensions["sni_hostname"] = real_host
        return httpx.Response(200, text='<a href="/about">About</a>', headers={"content-type": "text/html"})
    res = _fetcher(handler).fetch(db, "https://shop.example.org/")
    assert res.final_url == "https://shop.example.org/" and not res.redirected
    from app.backlinks.extract import extract_page
    assert extract_page(res.body, res.final_url).links[0].target_url == "https://shop.example.org/about"


def test_bot_waits_out_politeness_delays_instead_of_stopping(db, client):
    from app.backlinks import bot
    bid = client.post("/api/v1/businesses", json={"name": "Polite Co"}).json()["id"]
    db.add(BiTrackedTarget(business_id=bid, domain="client.com"))
    cfg = bot.get_config(db, bid)
    cfg.pages_per_run, cfg.max_hops = 6, 0
    db.commit()
    slept = []
    f = _fake_web_fetcher([])
    f.default_delay = 0.0
    real_fetch = f.fetch

    def slow_fetch(db_, url, purpose="discovery", render=None):  # each fetch puts the host on cooldown, as the real fetcher does with its delay
        res = real_fetch(db_, url, purpose, render)
        get_page(db_, url)
        from app.backlinks.models import BiDomain
        d = db_.scalar(select(BiDomain).where(BiDomain.host == "client.com"))
        if d:
            d.next_crawl_at = utcnow() + timedelta(seconds=0.5)
        return res
    f.fetch = slow_fetch
    stats = bot.run_cycle(db, f, bid, sleep=lambda s: (slept.append(s), __import__("time").sleep(0.6)))
    assert stats["pages"] >= 3 and slept  # it paused for the cooldown and carried on


def test_sitemap_index_queues_child_sitemaps_and_only_same_site_pages(db):
    index = _xml(["https://site.org/sm-posts.xml", "https://site.org/sm-pages.xml", "https://other.com/sm.xml"], index=True)
    pages = _xml(["https://site.org/a", "https://site.org/b", "https://elsewhere.net/c"])
    def handler(req):
        if req.url.path == "/robots.txt":
            return httpx.Response(404)
        return {"/sitemap.xml": index, "/sm-posts.xml": pages}.get(req.url.path, httpx.Response(404))
    f = _fetcher(handler)
    root = frontier.enqueue(db, "https://site.org/sitemap.xml", "sitemap", 0, None, priority=70)
    out = engine.crawl_sitemap(db, f, root)
    assert out["queued"] == 2 and root.status == "done"  # the other.com child is refused
    child = db.scalar(select(FrontierUrl).where(FrontierUrl.url == "https://site.org/sm-posts.xml"))
    assert child.source == "sitemap"
    engine.crawl_sitemap(db, f, child, monitored=set())
    urls = {r.url: r for r in db.scalars(select(FrontierUrl))}
    assert "https://site.org/a" in urls and "https://elsewhere.net/c" not in urls
    assert urls["https://site.org/a"].source == "sitemap_url"


def test_own_site_pages_rank_below_outward_links_so_the_budget_goes_outward(db):
    def handler(req):
        if req.url.path == "/robots.txt":
            return httpx.Response(404)
        return _page('<a href="/inner">inner</a> <a href="https://partner.org/">partner</a>')
    f = _fetcher(handler)
    seed = frontier.enqueue(db, "https://client.com/", "seed", 0, None, priority=90)
    seed.status = "in_progress"
    engine.crawl_row(db, f, seed, {"client.com"}, max_hops=1)
    rows = {r.url: r for r in db.scalars(select(FrontierUrl))}
    assert rows["https://partner.org/"].priority == engine.OUTWARD_PRIORITY and rows["https://partner.org/"].hop == 1
    assert rows["https://client.com/inner"].priority == engine.OWN_SITE_PRIORITY < rows["https://partner.org/"].priority
    claimed = [r.url for r in frontier.take_next(db, 5)]
    assert claimed == ["https://client.com/sitemap.xml", "https://partner.org/"]  # best first, one per domain; client.com/inner (15) waits its turn


def test_meta_robots_nofollow_stops_the_bot_following_a_page_but_links_are_still_recorded(db):
    html = '<html><head><meta name="robots" content="nofollow"></head><body><a href="https://partner.org/">p</a><a href="/in">in</a></body></html>'
    f = _fetcher(lambda req: httpx.Response(404) if req.url.path == "/robots.txt" else httpx.Response(200, text=html, headers={"content-type": "text/html"}))
    row = frontier.enqueue(db, "https://client.com/", "seed", 0, None, priority=90)
    row.status = "in_progress"
    out = engine.crawl_row(db, f, row, {"client.com"}, max_hops=2)
    queued = {r.url for r in db.scalars(select(FrontierUrl))}
    assert queued == {"https://client.com/", "https://client.com/sitemap.xml"}  # only the seed itself and its sitemap: nothing followed


def test_robots_blocked_pages_are_counted_and_never_fetched(db, client):
    from app.backlinks import bot
    bid = client.post("/api/v1/businesses", json={"name": "Robots Co"}).json()["id"]
    db.add(BiTrackedTarget(business_id=bid, domain="client.com"))
    db.commit()
    requested = []
    def handler(req):
        requested.append(req.url.path)
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nDisallow: /")
        return _page("secret")
    stats = bot.run_cycle(db, _fetcher(handler), bid)
    assert stats["blocked"] == 1 and requested == ["/robots.txt"]


def test_overview_has_only_what_the_crawler_can_know(db, client):
    bid = client.post("/api/v1/businesses", json={"name": "Honest Co"}).json()["id"]
    db.add(BiTrackedTarget(business_id=bid, domain="client.com"))
    upsert_imported_link(db, LinkRecord("https://a.org/p", "https://client.com/", "Client"), "manual_import")
    db.commit()
    o = client.get(f"/api/v1/businesses/{bid}/backlink-intel/overview", params={"domain": "client.com"}).json()
    for gone in ("toxicity", "authority_distribution", "categories", "target_metrics"):
        assert gone not in o
    assert set(o["review"]["to_review"]) == {"pending", "whitelisted"} and o["review"]["to_review"]["pending"] == 1
    assert client.get(f"/api/v1/businesses/{bid}/backlink-intel/providers").status_code in (404, 422)
    assert "dataforseo" not in str(o).lower()


# ---- identity pairing, public suffixes, gzip sitemaps ---------------------------------------------------------------------

def _two_link_page(first, second):
    return f'<html><body><article><a href="https://client.com/">{first}</a> <a href="https://client.com/">{second}</a></article></body></html>'


def test_reordering_links_on_a_page_does_not_swap_their_identities(db):
    state = {"html": _two_link_page("Alpha", "Beta")}
    f = _fetcher(lambda req: httpx.Response(404) if req.url.path == "/robots.txt" else httpx.Response(200, text=state["html"], headers={"content-type": "text/html"}))
    db.add(BiTrackedTarget(business_id=1, domain="client.com"))
    db.commit()
    engine.verify_source_page(db, f, "https://blog.example.org/post")
    db.commit()
    by_anchor = {b.anchor_text: b.id for b in db.scalars(select(Backlink))}
    assert set(by_anchor) == {"Alpha", "Beta"}
    state["html"] = _two_link_page("Beta", "Alpha")  # same two links, swapped on the page
    engine.verify_source_page(db, f, "https://blog.example.org/post")
    db.commit()
    rows = list(db.scalars(select(Backlink)))
    assert {b.anchor_text: b.id for b in rows} == by_anchor  # each id still carries its own anchor
    assert all(b.current_status in ("NEW", "LIVE") for b in rows)
    assert not db.scalars(select(BacklinkEvent).where(BacklinkEvent.event_type == "ANCHOR_CHANGED")).first()


def test_a_replaced_link_reads_as_a_change_and_the_untouched_one_stays_live(db):
    state = {"html": _two_link_page("Alpha", "Beta")}
    f = _fetcher(lambda req: httpx.Response(404) if req.url.path == "/robots.txt" else httpx.Response(200, text=state["html"], headers={"content-type": "text/html"}))
    db.add(BiTrackedTarget(business_id=1, domain="client.com"))
    db.commit()
    engine.verify_source_page(db, f, "https://blog.example.org/post")
    ids = {b.anchor_text: b.id for b in db.scalars(select(Backlink))}
    state["html"] = _two_link_page("Beta", "Gamma")  # Alpha was swapped for Gamma; Beta is untouched
    engine.verify_source_page(db, f, "https://blog.example.org/post")
    db.commit()
    rows = {b.id: b for b in db.scalars(select(Backlink))}
    assert rows[ids["Beta"]].anchor_text == "Beta" and rows[ids["Beta"]].current_status == "LIVE"
    assert rows[ids["Alpha"]].anchor_text == "Gamma" and rows[ids["Alpha"]].current_status == "CHANGED"  # same slot, new anchor: a change, not two lost links
    event = db.scalar(select(BacklinkEvent).where(BacklinkEvent.event_type == "ANCHOR_CHANGED"))
    assert (event.previous_value, event.new_value) == ("Alpha", "Gamma")
    assert len(rows) == 2 and not any(r.current_status.startswith("LOST") for r in rows.values())


def test_registrable_domain_uses_the_public_suffix_list():
    from app.backlinks.urls import registrable_domain
    assert registrable_domain("a.b.example.com.au") == "example.com.au"
    assert registrable_domain("shop.example.co.uk") == "example.co.uk"
    assert registrable_domain("blog.example.org.in") == "example.org.in"  # a suffix the old built-in list did not know
    assert registrable_domain("www.example.com") == "example.com" and registrable_domain("localhost") == "localhost"
    assert registrable_domain("10.1.2.3") == "10.1.2.3"


def test_gzip_sitemaps_are_unpacked_and_bombs_are_capped(db):
    import gzip
    xml = "<urlset>" + "".join(f"<url><loc>https://site.org/p{i}</loc></url>" for i in range(5)) + "</urlset>"
    def handler(req):
        if req.url.path == "/robots.txt":
            return httpx.Response(404)
        if req.url.path == "/sitemap.xml.gz":
            return httpx.Response(200, content=gzip.compress(xml.encode()), headers={"content-type": "application/gzip"})
        return httpx.Response(200, content=gzip.compress(b"<urlset>" + b"<loc>https://site.org/x</loc>" * 400000 + b"</urlset>"), headers={"content-type": "application/gzip"})
    f = _fetcher(handler)
    root = frontier.enqueue(db, "https://site.org/sitemap.xml.gz", "sitemap", 0, None, priority=70)
    assert engine.crawl_sitemap(db, f, root, monitored=set())["queued"] == 5
    bomb = frontier.enqueue(db, "https://site.org/bomb.xml.gz", "sitemap", 0, None, priority=70)
    out = engine.crawl_sitemap(db, f, bomb, monitored=set())
    assert out["queued"] <= engine.MAX_SITEMAP_URLS and bomb.status == "done"


# ---- removal-request drafts -----------------------------------------------------------------------------------------------

def _draft_setup(db, client):
    bid = client.post("/api/v1/businesses", json={"name": "Draft Co"}).json()["id"]
    db.add(BiTrackedTarget(business_id=bid, domain="client.com"))
    upsert_imported_link(db, LinkRecord("https://spammy.shop/a", "https://client.com/", "buy now"), "manual_import")
    upsert_imported_link(db, LinkRecord("https://spammy.shop/b", "https://client.com/pricing", None), "manual_import")
    db.commit()
    return bid, f"/api/v1/businesses/{bid}/backlink-intel/reviews/draft-removal"


def test_removal_draft_falls_back_to_a_template_without_ai_and_names_every_page(db, client):
    bid, url = _draft_setup(db, client)
    d = client.post(url, json={"domain": "client.com", "source_domain": "https://www.spammy.shop/x"}).json()
    assert d["source"] == "template" and d["source_domain"] == "spammy.shop" and len(d["links"]) == 2
    assert "https://spammy.shop/a" in d["body"] and "https://spammy.shop/b" in d["body"] and 'anchor: "buy now"' in d["body"] and "Draft Co" in d["body"]
    assert d["subject"] == "Request to remove links to client.com from spammy.shop"


def test_removal_draft_uses_the_ai_when_it_names_the_pages_and_ignores_it_otherwise(db, client, monkeypatch):
    from app.services import ai
    bid, url = _draft_setup(db, client)
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    good = {"subject": "Please remove two links", "body": "Hello, https://spammy.shop/a and https://spammy.shop/b link to us. Please remove them. Thanks, Draft Co"}
    monkeypatch.setattr(ai, "complete_json", lambda *a, **k: good)
    assert client.post(url, json={"domain": "client.com", "source_domain": "spammy.shop"}).json()["source"] == "ai"
    monkeypatch.setattr(ai, "complete_json", lambda *a, **k: {"subject": "Hi", "body": "A generic note that names no pages."})  # a draft that skips the facts is rejected
    assert client.post(url, json={"domain": "client.com", "source_domain": "spammy.shop"}).json()["source"] == "template"
    monkeypatch.setattr(ai, "complete_json", lambda *a, **k: (_ for _ in ()).throw(ai.AiUnavailable("down")))
    assert client.post(url, json={"domain": "client.com", "source_domain": "spammy.shop"}).json()["source"] == "template"


def test_removal_draft_is_scoped_to_the_business_and_to_live_links(db, client):
    bid, url = _draft_setup(db, client)
    other = client.post("/api/v1/businesses", json={"name": "Other Co"}).json()["id"]
    assert client.post(f"/api/v1/businesses/{other}/backlink-intel/reviews/draft-removal", json={"domain": "client.com", "source_domain": "spammy.shop"}).status_code == 404
    assert client.post(url, json={"domain": "client.com", "source_domain": "nobody.org"}).status_code == 404


# ---- AI features: quality scores, gap prioritiser, explainer, sync, agent tasks, outcomes ------------------------------------

def _biz(client, name="Smile Dental", website="https://smiledental.in", **kw):
    r = client.post("/api/v1/businesses", json={"name": name, "website": website, "primary_category": "Dentist", "city": "Pune", **kw}).json()
    return r["id"]


def _link_with_page(db, src, tgt, anchor, title=None, snippet=None, rel=None, placement=None):
    bl, _ = upsert_imported_link(db, LinkRecord(src, tgt, anchor, rel or [], placement=placement), "manual_import")
    page = db.get(BiPage, bl.source_page_id)
    page.title, page.snippet = title, snippet
    db.commit()
    return bl


@pytest.fixture()
def ai_off(monkeypatch):
    from app.services import ai
    monkeypatch.setattr(ai, "is_configured", lambda: False)


def test_rule_scores_flag_spammy_looking_linkers_and_credit_relevant_ones():
    from app.backlinks import quality
    ctx = "Smile Dental | Dentist | teeth whitening; implants | Pune"
    spam = quality.rule_score("cheap-seo-backlinks-4455.shop", {"links": 3, "pages": 1, "anchors": ["buy cheap premium dofollow backlinks for seo ranking boost now"], "placements": {"main": 3}, "titles": [], "snippets": []}, ctx)
    good = quality.rule_score("punedentalblog.in", {"links": 1, "pages": 1, "anchors": ["Smile Dental"], "placements": {"main": 1}, "titles": ["Teeth whitening options in Pune"], "snippets": ["A dentist explains implants"]}, ctx)
    assert spam["verdict"] == "risky" and spam["risk"] >= 60 and "spam-style wording" in spam["reason"]
    assert good["verdict"] == "good" and good["relevance"] >= 60 and good["risk"] < 35


def test_ai_scores_are_used_when_valid_and_rules_fill_the_gaps(db, client, monkeypatch):
    from app.backlinks import quality
    from app.services import ai
    bid = _biz(client)
    db.add(BiTrackedTarget(business_id=bid, domain="smiledental.in"))
    _link_with_page(db, "https://goodblog.in/p", "https://smiledental.in/", "Smile Dental", "Dental care tips")
    _link_with_page(db, "https://linkfarm.shop/p", "https://smiledental.in/", "buy cheap links casino")
    _link_with_page(db, "https://third.org/p", "https://smiledental.in/", "x")
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "provider_chain", lambda: ["claude"])
    seen = {}
    def fake(system, user, **kw):
        seen["user"] = user
        return {"scores": [{"domain": "goodblog.in", "relevance": 88, "risk": 5, "verdict": "good", "reason": "Dental advice site that links to us in an article"},
                           {"domain": "linkfarm.shop", "relevance": 999, "risk": 5, "verdict": "good", "reason": "invalid: relevance out of range"},  # rejected
                           {"domain": "not-asked.com", "relevance": 50, "risk": 50, "verdict": "ok", "reason": "never requested"}]}
    monkeypatch.setattr(ai, "complete_json", fake)
    rows = quality.score_domains(db, db.get(models_business(), bid), "smiledental.in", ["goodblog.in", "linkfarm.shop", "third.org"])
    by = {r.source_domain: r for r in rows}
    assert by["goodblog.in"].method == "ai" and by["goodblog.in"].relevance == 88 and "Dental care tips" in seen["user"]
    assert by["linkfarm.shop"].method == "rules" and by["linkfarm.shop"].verdict == "risky"  # the bad AI row was refused, the rules judged it
    assert by["third.org"].method == "rules"
    assert db.query(quality.BiDomainScore).count() == 3  # nothing for the domain the AI invented


def models_business():
    from app.models import Business
    return Business


def test_quality_api_scores_unscored_domains_and_overview_shows_them(db, client, ai_off):
    bid = _biz(client)
    base = f"/api/v1/businesses/{bid}/backlink-intel"
    client.post(f"{base}/targets", json={"domain": "smiledental.in"})
    _link_with_page(db, "https://tipsblog.in/a", "https://smiledental.in/", "Smile Dental", "Dental tips in Pune")
    _link_with_page(db, "https://spam123456.shop/a", "https://smiledental.in/", "buy cheap casino links")
    r = client.post(f"{base}/scores/run", json={"domain": "smiledental.in"}).json()
    assert {x["domain"]: x["verdict"] for x in r["scored"]}["spam123456.shop"] == "risky" and r["remaining"] == 0
    o = client.get(f"{base}/overview", params={"domain": "smiledental.in"}).json()
    assert o["quality"] == {"scored": 2, "unscored": 0, "good": o["quality"]["good"], "ok": o["quality"]["ok"], "risky": 1}
    row = {d["domain"]: d for d in o["top_referring_domains"]}["spam123456.shop"]
    assert row["quality"]["method"] == "rules" and row["quality"]["verdict"] == "risky"
    assert client.post(f"{base}/scores/run", json={"domain": "smiledental.in"}).json()["scored"] == []  # already scored: nothing to do twice


def test_gap_prioritiser_ranks_with_ai_and_falls_back_to_rules(db, client, monkeypatch):
    from app.services import ai
    bid = _biz(client)
    base = f"/api/v1/businesses/{bid}/backlink-intel"
    client.post(f"{base}/targets", json={"domain": "smiledental.in"})
    client.post(f"{base}/targets", json={"domain": "rivaldental.com", "is_competitor": True})
    client.post(f"{base}/targets", json={"domain": "otherclinic.com", "is_competitor": True})
    for src in ("https://punehealth.in/dentists", "https://linkfarm999.shop/x"):
        for tgt in ("https://rivaldental.com/", "https://otherclinic.com/"):
            _link_with_page(db, src, tgt, "dentist", "Pune dentists directory" if "health" in src else "cheap casino links")
    monkeypatch.setattr(ai, "is_configured", lambda: False)
    rules = client.post(f"{base}/gap/prioritize", json={"client": "smiledental.in"}).json()
    assert rules["source"] == "rules" and rules["prospects"][0]["domain"] == "punehealth.in" and rules["prospects"][-1]["win_chance"] == "low"
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete_json", lambda *a, **k: {"prospects": [
        {"domain": "punehealth.in", "win_chance": "high", "angle": "Offer a dentist-written guide for their directory readers", "reason": "Links to both competitors"},
        {"domain": "made-up.org", "win_chance": "high", "angle": "x", "reason": "y"}]})  # an invented domain is ignored
    ai_out = client.post(f"{base}/gap/prioritize", json={"client": "smiledental.in"}).json()
    assert ai_out["source"] == "ai" and ai_out["prospects"][0]["angle"].startswith("Offer a dentist-written guide")
    assert [p["domain"] for p in ai_out["prospects"]] == ["punehealth.in", "linkfarm999.shop"]  # the AI's pick first, what it skipped after
    assert client.post(f"/api/v1/businesses/{_biz(client, 'No Rivals', 'https://norivals.in')}/backlink-intel/gap/prioritize", json={"client": "norivals.in"}).status_code in (404, 409)


def test_explainer_uses_only_the_facts_and_falls_back_without_ai(db, client, monkeypatch):
    from app.services import ai
    bid = _biz(client)
    base = f"/api/v1/businesses/{bid}/backlink-intel"
    client.post(f"{base}/targets", json={"domain": "smiledental.in"})
    bl = _link_with_page(db, "https://lostsite.org/p", "https://smiledental.in/", "Smile Dental")
    apply_crawl_observation(db, bl, FetchEvidence(200, link=_found("Smile Dental")))
    apply_crawl_observation(db, bl, FetchEvidence(200, link=None))
    apply_crawl_observation(db, bl, FetchEvidence(200, link=None))
    db.commit()
    monkeypatch.setattr(ai, "is_configured", lambda: False)
    plain = client.post(f"{base}/explain", json={"domain": "smiledental.in"}).json()
    assert plain["source"] == "rules" and plain["facts"]["lost_confirmed"] == 1 and "lostsite.org" in plain["summary"] and plain["actions"]
    seen = {}
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete_json", lambda system, user, **k: (seen.update(user=user), {"summary": "You lost one link from lostsite.org.", "actions": ["Ask them to restore it."]})[1])
    out = client.post(f"{base}/explain", json={"domain": "smiledental.in"}).json()
    assert out["source"] == "ai" and out["summary"].startswith("You lost one link") and "lostsite.org" in seen["user"]
    monkeypatch.setattr(ai, "complete_json", lambda *a, **k: {"summary": "", "actions": []})  # an empty answer is not accepted
    assert client.post(f"{base}/explain", json={"domain": "smiledental.in"}).json()["source"] == "rules"


def test_sync_adds_the_site_and_saved_competitors_without_touching_manual_targets(db, client):
    from app.models import Competitor
    bid = _biz(client, "Sync Dental", "https://www.syncdental.in/home")
    db.add_all([Competitor(business_id=bid, name="Rival A", website="https://rivala.com"), Competitor(business_id=bid, name="Rival B", website="rivalb.co.uk/clinic"),
                Competitor(business_id=bid, name="Self", website="https://syncdental.in/other"), Competitor(business_id=bid, name="No site", website=None)])
    db.commit()
    base = f"/api/v1/businesses/{bid}/backlink-intel"
    client.post(f"{base}/targets", json={"domain": "manual-rival.com", "is_competitor": True})
    first = client.post(f"{base}/targets/sync").json()
    assert {a["domain"]: a["is_competitor"] for a in first["added"]} == {"syncdental.in": False, "rivala.com": True, "rivalb.co.uk": True}
    assert first["total"] == 4
    assert client.post(f"{base}/targets/sync").json()["added"] == []  # idempotent
    assert {t["domain"] for t in client.get(f"{base}/targets").json()} == {"syncdental.in", "rivala.com", "rivalb.co.uk", "manual-rival.com"}


def test_bot_run_syncs_targets_scores_linkers_and_files_a_removal_task_once(db, client, ai_off):
    from app.backlinks import bot
    from app.models import AgentTask, Competitor
    bid = _biz(client, "Bot Dental", "https://botdental.in")
    db.add(Competitor(business_id=bid, name="Rival", website="https://rivalbot.com"))
    db.commit()
    web = {"botdental.in": '<a href="https://spamfarm4455.shop/">partner</a>', "rivalbot.com": "<p>rival</p>",
           "spamfarm4455.shop": '<article>Buy cheap casino links <a href="https://botdental.in/" rel="nofollow">buy cheap seo backlinks casino</a></article>'}
    def handler(req):
        if req.url.path == "/robots.txt":
            return httpx.Response(404)
        body = web.get(req.url.host)
        return httpx.Response(200, text=f"<html><head><title>{req.url.host}</title></head><body>{body}</body></html>", headers={"content-type": "text/html"}) if body else httpx.Response(404)
    cfg = bot.get_config(db, bid)
    cfg.pages_per_run, cfg.max_hops = 30, 1
    db.commit()
    stats = bot.run_cycle(db, _fetcher(handler), bid)
    assert stats["new_backlinks"] == 1 and stats["handoff"]["scored"] == 1 and stats["handoff"]["tasks"] == 1
    assert {t.domain for t in db.scalars(select(BiTrackedTarget))} == {"botdental.in", "rivalbot.com"}  # synced from the business and Competitor Research
    task = db.scalar(select(AgentTask).where(AgentTask.business_id == bid))
    assert task.kind == "outreach_email" and task.status == "pending" and task.requires_approval and task.title.startswith("Ask spamfarm4455.shop to remove 1 link")
    assert "spamfarm4455.shop" in task.detail["draft"]["body"] and task.detail["draft"]["source"] == "template" and task.detail["source"] == "backlink_bot"
    from app.models import ActivityLog
    assert {a.action for a in db.scalars(select(ActivityLog).where(ActivityLog.business_id == bid))} >= {"backlinks_found", "backlink_tasks_created"}
    cfg = bot.get_config(db, bid)
    cfg.last_run_at = None
    db.commit()
    bot.run_cycle(db, _fetcher(handler), bid)
    assert db.query(AgentTask).filter(AgentTask.business_id == bid).count() == 1  # a second run does not file the same request again


def test_outcomes_take_a_baseline_once_and_judge_the_change_later(db, client):
    from app.backlinks import outcomes
    from app.models import Keyword
    bid = _biz(client)
    db.add_all([Keyword(business_id=bid, keyword="dentist pune", rank=9), Keyword(business_id=bid, keyword="implants pune", rank=14)])
    db.add(BiTrackedTarget(business_id=bid, domain="smiledental.in"))
    db.commit()
    now = utcnow()
    assert outcomes.start(db, bid, "website_fix", "task:1", "Fix title tags", now) == 2
    assert outcomes.start(db, bid, "website_fix", "task:1", "Fix title tags", now) == 0  # recorded once
    db.commit()
    assert outcomes.measure_due(db, now + timedelta(days=13)) == 0
    for k in db.scalars(select(Keyword).where(Keyword.business_id == bid)):
        k.rank -= 3  # better positions
    upsert_imported_link(db, LinkRecord("https://a.org/p", "https://smiledental.in/", "x"), "manual_import")
    upsert_imported_link(db, LinkRecord("https://b.org/p", "https://smiledental.in/", "y"), "manual_import")
    db.commit()
    assert outcomes.measure_due(db, now + timedelta(days=15)) == 1
    first = db.scalar(select(outcomes.ActionOutcome).where(outcomes.ActionOutcome.check_days == 14))
    assert first.verdict == "improved" and first.measured["change"]["avg_rank"] == -3.0 and first.measured["change"]["backlinks"] == 2.0
    assert db.scalar(select(outcomes.ActionOutcome).where(outcomes.ActionOutcome.check_days == 30)).measured_at is None  # not due yet
    assert outcomes.verdict_for({"avg_rank": 5.0, "backlinks": 4}, {"avg_rank": 8.0, "backlinks": 2})[0] == "worse"
    assert outcomes.verdict_for({"avg_rank": 5.0}, {"avg_rank": 5.2})[0] == "flat" and outcomes.verdict_for({}, {})[0] == "unknown"
    api = client.get(f"/api/v1/businesses/{bid}/outcomes").json()
    assert api["summary"]["measured"] == 1 and api["summary"]["by_action"]["website_fix"]["improved"] == 1 and len(api["items"]) == 2


def test_approving_an_agent_task_starts_outcome_tracking(db, client, ai_off):
    from app.models import AgentTask
    from app.services import agent
    bid = _biz(client)
    t = AgentTask(business_id=bid, agent="audit", kind="website_fix", title="Add a meta description", detail={}, requires_approval=True)
    db.add(t)
    db.commit()
    agent.decide(db, t, True, "tester")
    kinds = {(o.action_kind, o.check_days) for o in db.scalars(select(outcomes_model()))}
    assert kinds == {("website_fix", 14), ("website_fix", 30)}


def outcomes_model():
    from app.backlinks.models import ActionOutcome
    return ActionOutcome


def test_removal_request_status_starts_an_outcome_and_the_monthly_report_includes_the_bots_links(db, client, ai_off):
    bid = _biz(client)
    base = f"/api/v1/businesses/{bid}/backlink-intel"
    client.post(f"{base}/targets", json={"domain": "smiledental.in"})
    bl = _link_with_page(db, "https://good.org/a", "https://smiledental.in/", "Smile Dental")
    apply_crawl_observation(db, bl, FetchEvidence(200, link=_found("Smile Dental")))
    db.commit()
    assert client.put(f"{base}/reviews", json={"domain": "smiledental.in", "source_domains": ["spam.shop"], "status": "to_contact"}).json() == {"updated": 1}
    assert any(o.ref == "domain:spam.shop" for o in db.scalars(select(outcomes_model())))
    from app.services import reports
    s = reports.monthly_summary(db, db.get(models_business(), bid))
    assert s["backlinks"]["backlinks"] == 1 and s["backlinks"]["domain"] == "smiledental.in" and s["backlinks"]["new_this_month"] == 1
    assert b"%PDF" in reports.pdf(s)


def test_removal_emails_never_claim_who_placed_the_links(db, client):
    from app.backlinks import outreach
    d = outreach.template("Acme", "farm.shop", "acme.com", [{"source_url": "https://farm.shop/a", "target_url": "https://acme.com/", "anchor_text": "x"}])
    low = d["body"].lower()
    assert "did not" not in low and "unauthor" not in low and "without our" not in low and "pointing to our site" in low
    assert "do not say who placed" in outreach.SYSTEM.lower() or "do not say who placed the links" in outreach.SYSTEM.lower().replace("not say", "not say")


def test_only_clearly_spammy_linkers_get_a_removal_task_not_a_clients_footer_credit(db, client, ai_off):
    from app.backlinks import tasks
    from app.backlinks.models import BiDomainScore
    from app.models import AgentTask, Business
    bid = _biz(client, "Credit Co", "https://creditco.in")
    db.add(BiTrackedTarget(business_id=bid, domain="creditco.in"))
    _link_with_page(db, "https://happyclient.com/", "https://creditco.in/", "Credit Co")
    _link_with_page(db, "https://realspam.shop/", "https://creditco.in/", "buy cheap casino")
    now = utcnow()
    db.add_all([BiDomainScore(business_id=bid, source_domain="happyclient.com", relevance=45, risk=55, verdict="risky", reason="sitewide footer credit", method="ai", scored_at=now),
                BiDomainScore(business_id=bid, source_domain="realspam.shop", relevance=5, risk=96, verdict="risky", reason="link farm", method="ai", scored_at=now)])
    db.commit()
    out = tasks.after_run(db, db.get(Business, bid), {"pages": 1})
    titles = [t.title for t in db.scalars(select(AgentTask).where(AgentTask.business_id == bid))]
    assert out["tasks"] == 1 and titles == ["Ask realspam.shop to remove 1 link"]


# ---- assistant actions: it proposes, the user confirms, only listed actions run -----------------------------------------------

def test_the_assistant_proposes_actions_only_for_clear_requests():
    from app.services.assistant_actions import propose
    assert propose("please run the discovery bot")["id"] == "run_bot"
    assert propose("Can you find new backlinks for me?")["id"] == "run_bot"
    assert propose("add competitor https://www.RivalDental.co.uk/clinic")["params"] == {"domain": "rivaldental.co.uk"}
    assert propose("sync my competitors")["id"] == "sync_targets"
    assert propose("which of my backlinks are spammy?")["id"] == "score_linkers"
    assert propose("explain why my links changed")["id"] == "explain_links"
    for question in ("how many backlinks do I have", "what is a backlink", "show my rankings", "add a competitor", "tell me about the bot", "hello"):
        assert propose(question) is None, question  # a question, or too vague to act on


def test_chat_attaches_a_proposal_but_runs_nothing_until_confirmed(db, client, ai_off):
    bid = _biz(client, "Act Dental", "https://actdental.in")
    r = client.post(f"/api/v1/businesses/{bid}/assistant", json={"message": "run the discovery bot"}).json()
    assert r["action"]["id"] == "run_bot" and "Nothing happens until you confirm" in r["answer"]
    assert db.query(BiTrackedTarget).count() == 0 and db.query(FrontierUrl).count() == 0  # proposing changed nothing
    plain = client.post(f"/api/v1/businesses/{bid}/assistant", json={"message": "how many backlinks do I have"}).json()
    assert "action" not in plain


def test_confirmed_actions_run_and_unknown_ones_are_refused(db, client, ai_off, monkeypatch):
    from app.backlinks import router as bl_router
    from app.models import Competitor
    bid = _biz(client, "Act Dental", "https://actdental.in")
    base = f"/api/v1/businesses/{bid}/assistant/actions"
    assert client.post(base, json={"action": "drop_database"}).status_code == 422
    assert client.post(base, json={"action": "sync_targets"}).json()["message"].startswith("Added 1: actdental.in")
    r = client.post(base, json={"action": "add_competitor", "params": {"domain": "https://www.rivaldental.co.uk/x"}}).json()
    assert r["ok"] and "rivaldental.co.uk" in r["message"]
    assert db.query(Competitor).filter(Competitor.business_id == bid, Competitor.website == "https://rivaldental.co.uk").count() == 1  # also in Competitor Research
    assert {t.domain: t.is_competitor for t in db.query(BiTrackedTarget).filter(BiTrackedTarget.business_id == bid)} == {"actdental.in": False, "rivaldental.co.uk": True}
    client.post(base, json={"action": "add_competitor", "params": {"domain": "rivaldental.co.uk"}})
    assert db.query(Competitor).filter(Competitor.business_id == bid).count() == 1  # confirming twice does not duplicate
    monkeypatch.setattr(bl_router, "get_fetcher", lambda: _fake_web_fetcher([]))
    started = client.post(base, json={"action": "run_bot"}).json()
    assert started["ok"] and started["link"]["to"].endswith("tab=bot")
    assert db.query(CrawlAttempt).count() > 0  # the test client runs the background task before returning: the bot really ran
    assert client.post(base, json={"action": "score_linkers"}).json()["ok"] is True
    assert client.post(base, json={"action": "explain_links"}).json()["ok"] is True


def test_actions_without_a_site_to_start_from_explain_instead_of_failing(db, client, ai_off):
    bid = client.post("/api/v1/businesses", json={"name": "No Site Co"}).json()["id"]
    r = client.post(f"/api/v1/businesses/{bid}/assistant/actions", json={"action": "run_bot"}).json()
    assert r["ok"] is False and "website" in r["message"] and r["link"]["to"].endswith("tab=targets")
    assert client.post(f"/api/v1/businesses/{bid}/assistant/actions", json={"action": "score_linkers"}).json()["ok"] is False


# ---- JavaScript pages ---------------------------------------------------------------------------------------------------------

REACT_SHELL = '<html><head><title>App</title><script src="/static/app.js"></script><script src="/static/vendor.js"></script></head><body><div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript></body></html>'
RENDERED = '<html><head><title>App</title></head><body><div id="root"><article>Our partners: <a href="https://client.com/">Client Co</a> and <a href="/about">About</a></article></div></body></html>'
PLAIN = '<html><body><h1>Blog</h1>' + "<p>" + "real server rendered text " * 80 + '</p><a href="/a">a</a><a href="/b">b</a><a href="/c">c</a><a href="/d">d</a><a href="/e">e</a><a href="/f">f</a></body></html>'


def test_it_recognises_pages_that_need_a_browser_and_leaves_normal_pages_alone():
    from app.backlinks import renderer
    assert renderer.looks_js_rendered(REACT_SHELL)
    assert renderer.looks_js_rendered('<html><body><div id="__next"></div><script src="a.js"></script></body></html>')
    assert renderer.looks_js_rendered("<html><body><noscript>Please enable JavaScript to continue</noscript></body></html>")
    assert not renderer.looks_js_rendered(PLAIN)
    assert not renderer.looks_js_rendered('<html><body><div id="root"><nav>' + "".join(f'<a href="/p{i}">p{i}</a>' for i in range(12)) + "</nav></div></body></html>")  # SSR output in a mount node


def test_the_chrome_command_pins_the_validated_ip_and_blocks_every_other_host():
    from app.backlinks import renderer
    cmd = renderer.build_command("/usr/bin/chrome", "https://shop.example.org/p", "shop.example.org", "93.184.216.34", "/tmp/prof")
    rules = next(c for c in cmd if c.startswith("--host-resolver-rules="))
    assert rules == "--host-resolver-rules=MAP shop.example.org 93.184.216.34 , MAP * ~NOTFOUND"  # first match wins: pin the page's host, nothing else resolves
    assert "--dump-dom" in cmd and "--headless=new" in cmd and cmd[-1] == "https://shop.example.org/p" and "--no-sandbox" not in cmd
    assert "--no-sandbox" in renderer.build_command("c", "https://a.org/", "a.org", "1.2.3.4", "/p", sandbox=False)
    assert not any("ignore-certificate" in c for c in cmd)  # certificates are still checked against the real hostname


def test_render_refuses_unsafe_urls_and_missing_chrome_and_cleans_up(monkeypatch):
    from app.backlinks import renderer
    from app.services.url_safety import SSRFValidationError
    called = []
    def runner(cmd, timeout):
        called.append(cmd)
        return b"<html><body>ok</body></html>"
    def blocked(url):
        raise SSRFValidationError("URL resolves to a disallowed network address")
    with pytest.raises(renderer.RenderError, match="Refused"):
        renderer.render("http://169.254.169.254/", runner=runner, find=lambda: "chrome", resolve=blocked)
    assert not called  # Chrome was never started
    with pytest.raises(renderer.RenderError, match="not installed"):
        renderer.render("https://a.org/", runner=runner, find=lambda: None)
    from types import SimpleNamespace
    ok = lambda url: SimpleNamespace(hostname="a.org", resolved_ips=("93.184.216.34",))
    assert "ok" in renderer.render("https://a.org/", runner=runner, find=lambda: "chrome", resolve=ok)
    profile = next(c for c in called[0] if c.startswith("--user-data-dir=")).split("=", 1)[1]
    assert not __import__("os").path.exists(profile)  # the throw-away profile is deleted
    with pytest.raises(renderer.RenderError, match="no page"):
        renderer.render("https://a.org/", runner=lambda c, t: b"", find=lambda: "chrome", resolve=ok)


def _js_site(requested):
    def handler(req):
        requested.append(req.url.path)
        if req.url.path == "/robots.txt":
            return httpx.Response(404)
        return httpx.Response(200, text=REACT_SHELL if req.url.host == "app.example.org" else PLAIN, headers={"content-type": "text/html"})
    return handler


def test_a_javascript_page_is_rendered_and_its_backlink_is_found(db):
    from app.backlinks import renderer
    db.add(BiTrackedTarget(business_id=1, domain="client.com"))
    db.commit()
    rendered = []
    f = engine.PageFetcher(httpx.Client(transport=httpx.MockTransport(_js_site([])), follow_redirects=True), sleep=lambda s: None, default_delay=0,
                           render_fn=lambda url: (rendered.append(url), RENDERED)[1])
    plain = engine.verify_source_page(db, f, "https://app.example.org/partners")  # without a budget the browser is never used
    assert plain["new_backlinks"] == 0 and not rendered
    out = engine.verify_source_page(db, f, "https://app.example.org/partners", render=renderer.RenderBudget(5))
    db.commit()
    assert out["new_backlinks"] == 1 and rendered == ["https://app.example.org/partners"]
    bl = db.scalar(select(Backlink))
    assert bl.target_url == "https://client.com/" and bl.anchor_text == "Client Co" and bl.verification_status == "CRAWLER_VERIFIED"


def test_rendering_is_budgeted_skipped_for_normal_pages_and_never_makes_things_worse(db):
    from app.backlinks import renderer
    rendered = []
    def fake(url):
        rendered.append(url)
        if "broken" in url:
            raise renderer.RenderError("Chrome exited with code 1")
        return RENDERED
    f = engine.PageFetcher(httpx.Client(transport=httpx.MockTransport(_js_site([])), follow_redirects=True), sleep=lambda s: None, default_delay=0, render_fn=fake)
    budget = renderer.RenderBudget(2)
    f.fetch(db, "https://blog.example.org/post", "discovery", budget)  # already server-rendered: no browser, no budget used
    assert not rendered and budget.used == 0
    a = f.fetch(db, "https://app.example.org/one", "discovery", budget)
    b = f.fetch(db, "https://app.example.org/broken", "discovery", budget)
    c = f.fetch(db, "https://app.example.org/three", "discovery", budget)  # over budget
    assert a.rendered and not b.rendered and "exited" in b.render_error and b.body == REACT_SHELL and not c.rendered
    assert rendered == ["https://app.example.org/one", "https://app.example.org/broken"] and budget.used == 2


def test_the_bot_renders_only_when_asked_and_reports_it(db, client, monkeypatch):
    from app.backlinks import bot, renderer
    bid = _biz(client, "Js Co", "https://jsapp.org")
    base = f"/api/v1/businesses/{bid}/backlink-intel"
    s = client.get(f"{base}/bot").json()
    assert s["config"]["render_js"] is False and isinstance(s["render_available"], bool)
    monkeypatch.setattr(renderer, "available", lambda: True)
    assert client.put(f"{base}/bot", json={"render_js": True, "pages_per_run": 20, "max_hops": 0}).json()["config"]["render_js"] is True

    def handler(req):
        if req.url.path == "/robots.txt":
            return httpx.Response(404)
        return httpx.Response(200, text=REACT_SHELL, headers={"content-type": "text/html"})  # every page is an unrendered app shell
    f = engine.PageFetcher(httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True), sleep=lambda s: None, default_delay=0,
                           render_fn=lambda url: RENDERED.replace("https://client.com/", "https://jsapp.org/partners"))
    stats = bot.run_cycle(db, f, bid)
    assert stats["rendered"] >= 1 and stats["rendered"] <= bot.RENDERS_PER_RUN  # capped per run
    cfg = bot.get_config(db, bid)
    cfg.render_js, cfg.last_run_at = False, None
    db.commit()
    assert bot.run_cycle(db, f, bid)["rendered"] == 0  # switched off: no browser


# ---- weekly competitor watch ----------------------------------------------------------------------------------------------------

LOREM = "genuine paragraph about dental care and our clinic services " * 12


class RivalSite:
    """A competitor site we can change between visits."""

    def __init__(self):
        self.pages = {"/": ("Rival Dental | Pune", "Welcome", LOREM), "/services": ("Services | Rival Dental", "Our services", LOREM), "/blog/a": ("Whitening guide", "Whitening", LOREM)}
        self.listed = ["/", "/services", "/blog/a"]
        self.hits = []
        self.down = False

    def __call__(self, req):
        self.hits.append(req.url.path)
        p = req.url.path
        if p == "/robots.txt":
            return httpx.Response(404)
        if self.down:
            return httpx.Response(503)
        if p == "/sitemap.xml":
            return _xml([f"https://rival.com{u}" for u in self.listed])
        if p in self.pages:
            title, h1, body = self.pages[p]
            return httpx.Response(200, text=f"<html><head><title>{title}</title><meta name='description' content='{title} description'></head><body><h1>{h1}</h1><p>{body}</p></body></html>",
                                  headers={"content-type": "text/html"})
        return httpx.Response(404)


def _watch_setup(db, client):
    from app.backlinks import watch
    bid = _biz(client, "Smile Dental", "https://smiledental.in")
    db.add(BiTrackedTarget(business_id=bid, domain="smiledental.in"))
    db.add(BiTrackedTarget(business_id=bid, domain="rival.com", is_competitor=True))
    db.commit()
    site = RivalSite()
    return bid, site, _fetcher(site), watch, db.get(models_business(), bid)


def test_first_visit_records_a_baseline_and_reports_no_changes(db, client, ai_off):
    from app.backlinks.models import WatchEvent, WatchPage, WatchReport
    bid, site, f, watch, b = _watch_setup(db, client)
    out = watch.run_watch(db, f, b, utcnow())
    assert out["visits"][0]["baseline"] and out["visits"][0]["fetched"] == 3 and out["events"] == 0
    assert db.query(WatchPage).count() == 3 and db.query(WatchEvent).count() == 0
    rep = db.scalar(select(WatchReport))
    assert rep.baseline and rep.source == "rules" and "Now watching 1 competitor" in rep.summary["headline"]


def test_a_quiet_week_says_so_and_a_busy_week_lists_exactly_what_changed(db, client, ai_off):
    from app.backlinks.models import WatchEvent, WatchReport
    bid, site, f, watch, b = _watch_setup(db, client)
    t0 = utcnow()
    watch.run_watch(db, f, b, t0)
    quiet = watch.run_watch(db, f, b, t0 + timedelta(days=7))
    assert quiet["events"] == 0 and db.scalar(select(WatchReport).order_by(WatchReport.id.desc())).summary["headline"] == "No changes found this week"
    # the competitor ships a new post, retitles a page, rewrites another heavily and drops one
    site.pages["/blog/b"] = ("Braces for adults", "Braces", LOREM)
    site.listed.append("/blog/b")
    site.pages["/services"] = ("Invisalign and implants | Rival Dental", "Our services", LOREM)
    site.pages["/blog/a"] = ("Whitening guide", "Whitening", LOREM + " brand new long section about pricing and offers " * 40)
    busy = watch.run_watch(db, f, b, t0 + timedelta(days=14))
    assert busy["events"] == 3
    kinds = {(e.kind, e.url.rsplit("rival.com", 1)[1]): e for e in db.scalars(select(WatchEvent))}
    assert set(kinds) == {("new_page", "/blog/b"), ("changed", "/services"), ("changed", "/blog/a")}
    assert kinds[("new_page", "/blog/b")].title == "Braces for adults"  # the new page's title was read, not left blank
    assert kinds[("changed", "/services")].detail["fields"] == ["title", "snippet"] and kinds[("changed", "/services")].detail["title_after"].startswith("Invisalign")
    assert kinds[("changed", "/blog/a")].detail["fields"] == ["content"] and kinds[("changed", "/blog/a")].detail["words_after"] > kinds[("changed", "/blog/a")].detail["words_before"]
    rep = db.scalar(select(WatchReport).order_by(WatchReport.id.desc()))
    assert rep.source == "rules" and rep.events == 3 and "rival.com" in rep.summary["summary"] and "1 new page" in rep.summary["summary"]


def test_noise_and_failures_are_not_reported_as_changes(db, client, ai_off):
    from app.backlinks.models import WatchEvent
    bid, site, f, watch, b = _watch_setup(db, client)
    t0 = utcnow()
    watch.run_watch(db, f, b, t0)
    site.pages["/"] = ("Rival Dental | Pune", "Welcome", LOREM + " one tiny edit")  # a few words: not a rewrite
    watch.run_watch(db, f, b, t0 + timedelta(days=7))
    site.down = True  # the site errors out: nothing was learned, nothing is reported (and nothing is deleted)
    watch.run_watch(db, f, b, t0 + timedelta(days=14))
    assert db.query(WatchEvent).count() == 0
    from app.backlinks.models import WatchPage
    assert db.query(WatchPage).count() == 3


def test_a_page_is_reported_removed_only_when_it_really_answers_404(db, client, ai_off):
    from app.backlinks.models import WatchEvent, WatchPage
    bid, site, f, watch, b = _watch_setup(db, client)
    t0 = utcnow()
    watch.run_watch(db, f, b, t0)
    del site.pages["/blog/a"]  # gone: a 404 on a page we know
    watch.run_watch(db, f, b, t0 + timedelta(days=7))
    assert [(e.kind, e.detail.get("status")) for e in db.scalars(select(WatchEvent))] == [("removed", 404)]
    site.listed.remove("/services")  # dropped from the sitemap but the page still loads: never "removed"
    for week in (14, 21, 28):
        watch.run_watch(db, f, b, t0 + timedelta(days=week))
    assert db.query(WatchEvent).filter(WatchEvent.kind == "removed").count() == 1
    assert {r.url.rsplit("rival.com", 1)[1] for r in db.scalars(select(WatchPage)) if r.removed_at is None} == {"/", "/services"}
    assert db.query(WatchEvent).filter(WatchEvent.kind == "new_page").count() == 0  # /blog/a is still listed by the stale sitemap but is not "new" again


def test_a_page_beyond_the_fetch_cap_that_is_unlisted_and_gone_is_confirmed_before_it_is_reported(db, client, ai_off):
    from app.backlinks.models import WatchEvent
    bid, site, f, watch, b = _watch_setup(db, client)
    for i in range(40):
        site.pages[f"/old/{i}"] = (f"Old {i}", f"Old {i}", LOREM)
        site.listed.append(f"/old/{i}")
    t0 = utcnow()
    watch.run_watch(db, f, b, t0)
    victim = "/old/0"  # one of the pages the first visit actually read
    del site.pages[victim]
    site.listed.remove(victim)
    for week in (7, 14, 21, 28, 35):
        watch.run_watch(db, f, b, t0 + timedelta(days=week))
    removed = [e for e in db.scalars(select(WatchEvent)) if e.kind == "removed"]
    assert [e.url.rsplit("rival.com", 1)[1] for e in removed] == [victim] and removed[0].detail["status"] == 404


def test_a_page_already_listed_is_never_called_new_even_if_it_was_beyond_the_fetch_cap(db, client, ai_off):
    from app.backlinks.models import WatchEvent
    bid, site, f, watch, b = _watch_setup(db, client)
    for i in range(40):
        site.pages[f"/old/{i}"] = (f"Old {i}", f"Old {i}", LOREM)
        site.listed.append(f"/old/{i}")
    t0 = utcnow()
    first = watch.run_watch(db, f, b, t0)
    assert first["visits"][0]["fetched"] == watch.MAX_PAGES and first["visits"][0]["known"] == 43  # every listed URL is remembered, only 25 were fetched
    watch.run_watch(db, f, b, t0 + timedelta(days=7))  # the rest is fetched later: that is not "new"
    assert db.query(WatchEvent).filter(WatchEvent.kind == "new_page").count() == 0


def test_ai_summary_is_used_only_when_it_sticks_to_the_facts(db, client, monkeypatch):
    from app.services import ai
    bid, site, f, watch, b = _watch_setup(db, client)
    t0 = utcnow()
    monkeypatch.setattr(ai, "is_configured", lambda: False)
    watch.run_watch(db, f, b, t0)
    site.pages["/blog/b"] = ("Braces for adults", "Braces", LOREM)
    site.listed.append("/blog/b")
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    seen = {}
    good = {"headline": "Rival Dental published a post on adult braces", "summary": "rival.com added one new page about braces for adults.", "what_it_means": "They may be targeting adult orthodontics.",
            "actions": ["Check whether you cover adult braces."]}
    monkeypatch.setattr(ai, "complete_json", lambda system, user, **k: (seen.update(user=user), good)[1])
    out = watch.run_watch(db, f, b, t0 + timedelta(days=7))
    assert out["source"] == "ai" and "Braces for adults" in seen["user"] and out["report"].startswith("Rival Dental published")
    site.pages["/blog/c"] = ("Crowns", "Crowns", LOREM)
    site.listed.append("/blog/c")
    bad = dict(good, summary="rival.com added a page, and competitor-x.com copied it.")  # names a site the model was never given
    monkeypatch.setattr(ai, "complete_json", lambda *a, **k: bad)
    assert watch.run_watch(db, f, b, t0 + timedelta(days=14))["source"] == "rules"
    monkeypatch.setattr(ai, "complete_json", lambda *a, **k: (_ for _ in ()).throw(ai.AiUnavailable("down")))
    site.pages["/blog/d"] = ("Veneers", "Veneers", LOREM)
    site.listed.append("/blog/d")
    assert watch.run_watch(db, f, b, t0 + timedelta(days=21))["source"] == "rules"


def test_watch_api_run_status_toggle_and_the_weekly_schedule(db, client, ai_off, monkeypatch):
    from app.backlinks import router as bl_router
    from app.backlinks import watch
    bid, site, f, _, b = _watch_setup(db, client)
    base = f"/api/v1/businesses/{bid}/competitor-watch"
    monkeypatch.setattr(bl_router, "get_fetcher", lambda: f)
    assert client.get(base).json()["latest"] is None and client.get(base).json()["competitors"] == [{"domain": "rival.com", "pages_watched": 0}]
    assert client.post(f"{base}/run").status_code == 202  # the test client runs the background job before returning
    s = client.get(base).json()
    assert s["latest"]["baseline"] is True and s["competitors"] == [{"domain": "rival.com", "pages_watched": 3}] and s["last_run_at"] and s["next_run_at"] and s["running"] is False
    assert watch.run_due(db, f) == 0  # visited just now: not due for a week
    assert client.put(base, json={"enabled": False}).json()["enabled"] is False
    assert watch.run_due(db, f, utcnow() + timedelta(days=8)) == 0  # switched off
    client.put(base, json={"enabled": True})
    assert watch.run_due(db, f, utcnow() + timedelta(days=8)) == 1
    other = client.post("/api/v1/businesses", json={"name": "Lonely Co"}).json()["id"]
    assert client.post(f"/api/v1/businesses/{other}/competitor-watch/run").status_code == 409  # no competitors tracked
    assert client.get(f"/api/v1/businesses/{other}/competitor-watch").json()["competitors"] == []


# ---- shutdown: long background jobs must not hold the server open ------------------------------------------------------------------

@pytest.fixture()
def stop_flag():
    from app.backlinks import stop
    stop.STOP.clear()
    yield stop.STOP
    stop.STOP.clear()


def test_a_bot_run_leaves_between_pages_when_the_server_is_stopping_and_the_next_run_resumes(db, client, stop_flag):
    from app.backlinks import bot
    bid = _biz(client, "Stop Co", "https://stopco.in")
    cfg = bot.get_config(db, bid)
    cfg.pages_per_run, cfg.max_hops = 50, 0
    db.commit()
    seen, armed = [], [True]

    def handler(req):
        seen.append(req.url.path)
        if req.url.path == "/robots.txt":
            return httpx.Response(404)
        if armed[0] and len(seen) >= 3:
            stop_flag.set()  # the server begins shutting down mid-crawl
        return _page("".join(f'<a href="/p{i}">p{i}</a>' for i in range(20)))
    stats = bot.run_cycle(db, _fetcher(handler), bid)
    assert 1 <= stats["pages"] <= 3 and not bot.get_config(db, bid).running  # left promptly, and released its "running" flag
    stop_flag.clear()  # (the server restarted)
    armed[0] = False
    cfg = bot.get_config(db, bid)
    cfg.last_run_at = None
    db.commit()
    resumed = bot.run_cycle(db, _fetcher(handler), bid)
    assert resumed["pages"] > stats["pages"]  # picked the queue back up


def test_an_interrupted_competitor_watch_keeps_its_progress_and_runs_again_instead_of_pretending_it_finished(db, client, ai_off, stop_flag):
    from app.backlinks.models import WatchReport
    bid, site, f, watch, b = _watch_setup(db, client)
    stop_flag.set()
    out = watch.run_watch(db, f, b, utcnow())
    assert out["skipped"] == "server stopping" and db.query(WatchReport).count() == 0
    cfg = watch.bot_config(db, bid) if hasattr(watch, "bot_config") else __import__("app.backlinks.bot", fromlist=["get_config"]).get_config(db, bid)
    assert cfg.watch_last_run_at is None and not cfg.watch_running  # not marked as done, not stuck "running"
    stop_flag.clear()
    assert watch.run_due(db, f) == 1  # the next tick runs it for real


def test_pagination_and_feed_urls_are_not_competitor_pages(db, client, ai_off):
    from app.backlinks.models import WatchPage
    bid, site, f, watch, b = _watch_setup(db, client)
    for path in ("/category/skin/page/2/", "/blog/?paged=3", "/feed/"):
        site.pages[path.split("?")[0]] = ("Archive", "Archive", LOREM)
    site.listed += ["/category/skin/page/2/", "/blog/?paged=3", "/feed/"]
    watch.run_watch(db, f, b, utcnow())
    assert {r.url.rsplit("rival.com", 1)[1] for r in db.scalars(select(WatchPage))} == {"/", "/services", "/blog/a"}
