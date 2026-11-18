"""DataForSEO figures on saved backlink checks: filled for rows that have none, kept with the row, and a lookup that found nothing is not remembered."""
import pytest

from app.services import backlink_checker as bc


@pytest.fixture()
def bid(client):
    return client.post("/api/v1/businesses", json={"name": "Scores Co", "website": "https://scores.example"}).json()["id"]


def _row(bid, url, state="working", scores=None):
    from app.db import SessionLocal
    from app.models import BacklinkCheck
    db = SessionLocal()
    try:
        db.add(BacklinkCheck(business_id=bid, source_url=url, target="scores.example", state=state, data={"source_url": url, "state": state, **({"scores": scores} if scores else {})}, checks=1))
        db.commit()
    finally:
        db.close()


def test_missing_figures_are_filled_for_every_row_including_pages_that_did_not_open(client, bid, monkeypatch):
    _row(bid, "https://blog-a.example/post-1")
    _row(bid, "https://blog-a.example/post-2", state="page_error")
    _row(bid, "https://blog-b.example/x", scores={"da": 12, "pa": 5, "spam": 3, "source": "DataForSEO"})
    monkeypatch.setattr(bc, "dfs_configured", lambda: True)
    seen = {}

    def fake(domains, pages):
        seen["domains"], seen["pages"] = domains, pages
        out = {d: {"rank": 40, "spam": 7} for d in domains}
        out.update({p: {"rank": 22, "spam": None} for p in pages})
        return out

    monkeypatch.setattr(bc, "dfs_scores", fake)
    before = client.get(f"/api/v1/businesses/{bid}/backlink-check").json()
    assert before["missing_scores"] == 2
    r = client.post(f"/api/v1/businesses/{bid}/backlink-check/scores").json()
    assert r["filled"] == 2 and r["tried"] == 2 and r["left"] == 0
    assert "blog-a.example" in seen["domains"] and "https://blog-a.example/post-2" in seen["pages"]  # the page that would not open is included
    after = client.get(f"/api/v1/businesses/{bid}/backlink-check").json()
    assert after["missing_scores"] == 0
    by = {x["source_url"]: x for x in after["rows"]}
    assert by["https://blog-a.example/post-1"]["scores"] == {"da": 40, "pa": 22, "spam": 7, "source": "DataForSEO"}
    assert by["https://blog-b.example/x"]["scores"]["da"] == 12  # a row that already had figures is left alone


def test_a_lookup_that_found_nothing_is_not_cached(monkeypatch):
    monkeypatch.setattr(bc, "dfs_configured", lambda: True)
    bc._DFS.clear()
    calls = []

    def call(endpoint, targets):
        calls.append(endpoint)
        return {}  # DataForSEO had no item for the target

    monkeypatch.setattr(bc, "_dfs_call", call)
    assert bc.dfs_scores(["nothing.example"], [])["nothing.example"] == {"rank": None, "spam": None}
    bc.dfs_scores(["nothing.example"], [])
    assert calls.count("bulk_ranks") == 2  # asked again, not remembered as empty
    monkeypatch.setattr(bc, "_dfs_call", lambda e, t: {"nothing.example": {"rank": 300, "spam_score": 9}})
    assert bc.dfs_scores(["nothing.example"], [])["nothing.example"]["rank"] == 30
    bc._DFS.clear()


def test_each_check_adds_a_point_to_the_links_history(client, bid, monkeypatch):
    url = "https://blog-h.example/post"
    states = iter(["working", "link_missing", "working"])

    def fake_check(sources, target):
        st = next(states)
        return [{"source_url": url, "final_url": url, "state": st, "follow": "dofollow" if st == "working" else None, "links": [{"href": "https://scores.example/"}] if st == "working" else [],
                 "http_status": 200, "checked_at": "2026-11-18T10:00:00+00:00"}], None

    monkeypatch.setattr(bc, "check_many", fake_check)
    for _ in range(3):
        r = client.post(f"/api/v1/businesses/{bid}/backlink-check", json={"sources": [url]})
        assert r.status_code == 200
    row = client.get(f"/api/v1/businesses/{bid}/backlink-check").json()["rows"][0]
    assert [h["state"] for h in row["history"]] == ["working", "link_missing", "working"]
    assert row["history"][0]["links"] == 1 and row["history"][1]["links"] == 0 and row["checks"] == 3
    assert "crawler" in row  # what the crawler knows (empty when it has not seen this page)
