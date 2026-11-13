"""Crawler performance work: batch frontier enqueue, one parse per page, one finder-target read per run.
Every test also pins the behaviour that must NOT change (caps, upgrades, dedupe, lost-link semantics)."""
import httpx
import pytest
from sqlalchemy import event, func, select

from app.backlinks import engine, finder, frontier
from app.backlinks.models import BacklinkFinderTarget, BiTrackedTarget, FrontierUrl
from app.db import engine as sa_engine
from test_backlinks import RENDERED, REACT_SHELL, _fetcher, _page, db  # noqa: F401  (db is the shared fixture)


@pytest.fixture(autouse=True)
def _clean_finder_tables():
    from app.backlinks.models import BacklinkFinderResult
    from app.db import SessionLocal
    def wipe():
        s = SessionLocal()
        s.query(BacklinkFinderResult).delete()
        s.query(BacklinkFinderTarget).delete()
        s.commit()
        s.close()
    wipe()
    yield
    wipe()


class Statements:
    """Counts the SQL statements a block runs (what 'queries per page' means in the benchmark)."""

    def __enter__(self):
        self.sql: list[str] = []
        event.listen(sa_engine, "before_cursor_execute", self._on)
        return self

    def __exit__(self, *exc):
        event.remove(sa_engine, "before_cursor_execute", self._on)

    def _on(self, conn, cursor, statement, *rest):
        self.sql.append(statement)

    def matching(self, text: str) -> int:
        return sum(1 for s in self.sql if text in s)


def _rows(db):
    return {r.url: r for r in db.scalars(select(FrontierUrl))}


# ---- frontier.enqueue_many ----------------------------------------------------------------------

def test_enqueue_many_applies_the_same_rules_as_enqueue(db):
    got = frontier.enqueue_many(db, [
        "https://a.com/x#top", "https://a.com/x",              # same page twice (fragment): one row
        "https://a.com/a/a/a/a/page",                           # repeating path: crawl trap
        "https://a.com/?a=1&b=2&c=3&d=4&e=5",                   # too many query parameters: trap
        "", "ftp://a.com/file",                                  # unusable
        "https://a.com/y", "https://b.com/z",
    ], priority=30, business_id=4)
    db.commit()
    assert sorted(r.url for r in got) == ["https://a.com/x", "https://a.com/y", "https://b.com/z"]
    assert sorted(_rows(db)) == ["https://a.com/x", "https://a.com/y", "https://b.com/z"]
    assert all(r.priority == 30 and r.business_id == 4 and r.status == "pending" and r.queue == "discovery" for r in got)
    assert frontier.enqueue_many(db, ["https://a.com/deep"], depth=frontier.MAX_DEPTH + 1) == []  # too deep
    assert [r.url for r in frontier.enqueue_many(db, ["https://a.com/?a=1&b=2&c=3&d=4&e=5"], source="user")] == ["https://a.com/?a=1&b=2&c=3&d=4&e=5"]  # user URLs skip the trap rule
    assert frontier.enqueue_many(db, []) == []


def test_enqueue_many_keeps_one_row_per_url_and_upgrades_known_ones(db):
    first = frontier.enqueue(db, "https://shared.org/page", business_id=None)
    db.commit()
    again = frontier.enqueue_many(db, ["https://shared.org/page", "https://shared.org/new"], priority=40, business_id=7)
    db.commit()
    by_url = {r.url: r for r in again}
    assert by_url["https://shared.org/page"].id == first.id  # the existing row is returned, not duplicated
    assert first.priority == 40 and first.business_id == 7  # ...and upgraded and adopted, like enqueue()
    assert db.scalar(select(func.count()).select_from(FrontierUrl).where(FrontierUrl.url == "https://shared.org/page")) == 1
    assert by_url["https://shared.org/new"].priority == 40
    verification = frontier.enqueue_many(db, ["https://shared.org/new"], queue="verification")
    assert verification[0].queue == "verification" and verification[0].status == "pending"


def test_enqueue_many_never_goes_over_the_per_domain_cap(db, monkeypatch):
    monkeypatch.setattr(frontier, "MAX_URLS_PER_DOMAIN", 5)
    urls = [f"https://big.org/p{i}" for i in range(8)]
    first = frontier.enqueue_many(db, urls[:3])
    second = frontier.enqueue_many(db, urls[:6] + ["https://other.org/p"])  # 3 known + 3 new asked for, only 2 fit under the cap
    db.commit()
    assert len(first) == 3
    assert sorted(r.url for r in second if "big.org" in r.url) == sorted(urls[:5])  # known rows come back; the new ones stop at the cap
    assert any(r.url == "https://other.org/p" for r in second)  # another domain is unaffected
    assert db.scalar(select(func.count()).select_from(FrontierUrl).where(FrontierUrl.url.like("https://big.org/%"))) == 5
    assert frontier.enqueue_many(db, urls) and db.scalar(select(func.count()).select_from(FrontierUrl).where(FrontierUrl.url.like("https://big.org/%"))) == 5


def test_enqueue_many_uses_a_constant_number_of_statements(db):
    links = [f"https://site{n % 4}.org/page-{n}" for n in range(60)]  # 60 new URLs over 4 domains
    with Statements() as batch:
        frontier.enqueue_many(db, links)
    db.commit()
    db.query(FrontierUrl).delete()
    db.commit()
    with Statements() as single:
        for u in links:
            frontier.enqueue(db, u)
    # the per-URL path costs several statements for every URL; the batch costs a handful for all of them
    assert len(batch.sql) <= 20 < len(single.sql) / 4
    print(f"\nfrontier enqueue of 60 URLs: {len(single.sql)} statements one by one, {len(batch.sql)} as a batch")


def test_domain_capacity_locks_are_per_domain_ordered_and_postgresql_only():
    """The cap holds under concurrent workers because capacity is checked under a per-domain advisory lock, taken in id order (no deadlocks)."""
    from types import SimpleNamespace
    taken = []
    fake = lambda dialect: SimpleNamespace(get_bind=lambda: SimpleNamespace(dialect=SimpleNamespace(name=dialect)),
                                           execute=lambda stmt: taken.append(stmt.compile(compile_kwargs={"literal_binds": True}).string))
    frontier._domain_capacity_locks(fake("sqlite"), [3, 1])
    assert taken == []  # SQLite has a single writer: nothing to lock
    frontier._domain_capacity_locks(fake("postgresql"), iter([9, 2, 5, 2]))
    assert len(taken) == 3 and all("pg_advisory_xact_lock" in t for t in taken)
    assert [int(t.split(",")[1].split(")")[0]) for t in taken] == [2, 5, 9]  # ascending ids, each domain once


# ---- one parse per page ---------------------------------------------------------------------------

def test_a_crawled_page_is_parsed_once(db, monkeypatch):
    real, calls = engine.extract_page, []
    monkeypatch.setattr(engine, "extract_page", lambda *a, **k: (calls.append(1), real(*a, **k))[1])
    db.add(BiTrackedTarget(business_id=1, domain="client.com"))
    db.commit()
    f = _fetcher(lambda req: httpx.Response(404) if req.url.path == "/robots.txt" else _page('<a href="/in">in</a> <a href="https://client.com/x">us</a>'))
    row = frontier.enqueue(db, "https://blog.example.org/post", "seed", 0, None, priority=90)
    row.status = "in_progress"
    out = engine.crawl_row(db, f, row, {"client.com"}, max_hops=1)
    db.commit()
    assert len(calls) == 1  # was 2: once in process_source_page, once again for discovery
    assert out["new_backlinks"] == 1 and out["queued"] >= 1  # the same parse fed backlink matching and the frontier


def test_a_rendered_page_is_parsed_twice_in_total_not_four_times(db, monkeypatch):
    from app.backlinks import renderer
    real, calls = engine.extract_page, []
    monkeypatch.setattr(engine, "extract_page", lambda *a, **k: (calls.append(1), real(*a, **k))[1])
    db.add(BiTrackedTarget(business_id=1, domain="client.com"))
    db.commit()

    def handler(req):
        return httpx.Response(404) if req.url.path == "/robots.txt" else httpx.Response(200, text=REACT_SHELL, headers={"content-type": "text/html"})
    f = engine.PageFetcher(httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True), sleep=lambda s: None, default_delay=0,
                           render_fn=lambda url: RENDERED)
    row = frontier.enqueue(db, "https://app.example.org/partners", "seed", 0, None, priority=90)
    row.status = "in_progress"
    out = engine.crawl_row(db, f, row, {"client.com"}, render=renderer.RenderBudget(3))
    db.commit()
    assert out["rendered"] and out["new_backlinks"] == 1
    assert len(calls) == 2  # the raw page and the rendered one, each parsed once, and no more for matching or discovery


# ---- finder targets: one read per run ---------------------------------------------------------------

def _business(db):
    from app.models import Business
    b = Business(name="Finder Co")
    db.add(b)
    db.commit()
    return b


def test_finder_targets_are_read_once_per_batch_not_per_page(db):
    b = _business(db)
    db.add(BacklinkFinderTarget(business_id=b.id, raw_value="client.com", kind="domain", host="client.com", normalized_value="client.com", active=True))
    db.commit()
    for n in range(4):  # four different domains: a tick claims one URL per domain
        frontier.enqueue(db, f"https://blog{n}.example.org/post", "seed", 0, None, priority=90)
    db.commit()
    f = _fetcher(lambda req: httpx.Response(404) if req.url.path == "/robots.txt" else _page('<a href="https://client.com/page">client</a>'))
    with Statements() as run:
        results = engine.run_batch(db, f, limit=10)
    assert len(results) == 4 and sum(r["new_finder_matches"] for r in results) == 4  # every page still matched
    assert run.matching("FROM bi_finder_targets") == 1  # was one per page


def test_finder_snapshot_is_plain_data_and_matches_like_the_table_row(db):
    b = _business(db)
    for kind, host, value in (("domain", "client.com", "client.com"), ("subdomain", "blog.client.com", "blog.client.com"),
                              ("url", "client.com", "https://client.com/pricing")):
        db.add(BacklinkFinderTarget(business_id=b.id, raw_value=value, kind=kind, host=host, normalized_value=value, active=(kind != "subdomain")))
    db.commit()
    snap = finder.load_targets(db)
    assert [t.kind for t in snap] == ["domain", "url"]  # inactive targets are left out
    db.expire_all()
    db.close()  # the snapshot outlives the session that loaded it: nothing lazy, nothing bound to it
    assert finder.matches(snap[0], "https://shop.client.com/x") and not finder.matches(snap[0], "https://other.com/")
    assert finder.matches(snap[1], "https://client.com/pricing") and not finder.matches(snap[1], "https://client.com/other")
