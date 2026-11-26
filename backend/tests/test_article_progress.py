"""GET /businesses/{id}/articles/{article_id}/progress: what the editor polls while an article is being written. It answers with the status and progress line, and sends the text only when it
changed (or the article is finished), instead of the whole article every second plus the whole article list every two seconds."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.db import SessionLocal, engine
from app.main import app
from app.models import Article, Business
from test_flow_optimized import _forget, _login, _user


@pytest.fixture()
def project(client):
    bid = client.post("/api/v1/businesses", json={"name": "Progress Co", "website": "https://progress.example"}).json()["id"]
    made: list[int] = []
    yield bid, made
    db = SessionLocal()
    for aid in made:
        db.query(Article).filter(Article.id == aid).delete()
    db.query(Business).filter(Business.id == bid).delete()
    db.commit()
    db.close()


def make(bid, made, **kw):
    db = SessionLocal()
    a = Article(business_id=bid, keyword="progress keyword", **kw)
    db.add(a)
    db.commit()
    aid = a.id
    db.close()
    made.append(aid)
    return aid


def progress(client, bid, aid, known=None):
    url = f"/api/v1/businesses/{bid}/articles/{aid}/progress" + (f"?known_len={known}" if known is not None else "")
    r = client.get(url)
    assert r.status_code == 200, r.text
    return r.json()


def test_the_text_is_sent_only_when_it_is_not_the_one_the_editor_has(client, project):
    bid, made = project
    aid = make(bid, made, status="generating", progress="Writing", body="<p>One</p>", title="T")
    first = progress(client, bid, aid)  # nothing known yet
    assert first == {"id": aid, "status": "generating", "progress": "Writing", "error": None, "title": "T", "meta_description": None, "body_len": 10, "body": "<p>One</p>"}
    same = progress(client, bid, aid, known=first["body_len"])
    assert same["body"] is None and same["body_len"] == 10 and same["progress"] == "Writing"  # unchanged: a few bytes, no text
    db = SessionLocal()
    db.get(Article, aid).body = "<p>One</p><p>Two</p>"
    db.commit()
    db.close()
    grown = progress(client, bid, aid, known=10)
    assert grown["body"] == "<p>One</p><p>Two</p>" and grown["body_len"] == 20


def test_a_finished_article_always_comes_back_with_its_text(client, project):
    bid, made = project
    aid = make(bid, made, status="completed", progress="Done", body="<p>All</p>", title="T", meta_description="M")
    got = progress(client, bid, aid, known=11)  # the editor already has a text of exactly this length: the finished article is still sent whole
    assert got["status"] == "completed" and got["body"] == "<p>All</p>" and got["title"] == "T" and got["meta_description"] == "M"
    failed = make(bid, made, status="failed", error="The AI stopped", body=None)
    got = progress(client, bid, failed, known=0)
    assert got["status"] == "failed" and got["error"] == "The AI stopped" and got["body"] == "" and got["body_len"] == 0


def test_an_article_with_no_text_yet(client, project):
    bid, made = project
    aid = make(bid, made, status="pending")
    assert progress(client, bid, aid, known=0)["body"] is None  # empty and known: nothing to send
    assert progress(client, bid, aid)["body"] is None or progress(client, bid, aid)["body"] == ""


def test_only_the_projects_owner_can_ask_and_only_for_its_own_articles(client):
    from app.routers import auth as auth_router
    auth_router._failures.clear()
    _user("prog-a@x.in")
    _user("prog-b@x.in")
    a, b = _login("prog-a@x.in"), _login("prog-b@x.in")
    mine = a.post("/api/v1/businesses", json={"name": "Prog A"}).json()["id"]
    theirs = b.post("/api/v1/businesses", json={"name": "Prog B"}).json()["id"]
    made: list[int] = []
    try:
        aid = make(mine, made, status="generating", body="<p>x</p>")
        assert a.get(f"/api/v1/businesses/{mine}/articles/{aid}/progress").status_code == 200
        assert b.get(f"/api/v1/businesses/{mine}/articles/{aid}/progress").status_code == 404  # another user's project
        assert b.get(f"/api/v1/businesses/{theirs}/articles/{aid}/progress").status_code == 404  # an article of another project
        assert a.get(f"/api/v1/businesses/{mine}/articles/987654/progress").status_code == 404
        assert TestClient(app).get(f"/api/v1/businesses/{mine}/articles/{aid}/progress").status_code == 401
        assert a.get(f"/api/v1/businesses/{mine}/articles/{aid}/progress?known_len=-5").status_code == 422
    finally:
        db = SessionLocal()
        for x in made:
            db.query(Article).filter(Article.id == x).delete()
        db.commit()
        db.close()
        _forget(["prog-a@x.in", "prog-b@x.in"], [mine, theirs])
        auth_router._failures.clear()


def test_the_full_article_endpoint_is_unchanged(client, project):
    bid, made = project
    aid = make(bid, made, status="completed", body="<p>Whole</p>", title="T")
    r = client.get(f"/api/v1/businesses/{bid}/articles/{aid}")
    assert r.status_code == 200 and r.json()["body"] == "<p>Whole</p>" and "stats" in r.json()
    assert "body" not in client.get(f"/api/v1/businesses/{bid}/articles").json()["articles"][0]


def test_statements_and_bytes_for_two_seconds_of_polling_before_and_after(client, project):
    """Before: the editor asked for the whole article twice and the whole list once every two seconds. After: it asks twice, for what changed."""
    bid, made = project
    big = "<p>" + "x" * 40_000 + "</p>"
    for _ in range(6):  # a project with several articles
        make(bid, made, status="completed", body="<p>old</p>", title="Older article", progress="Done")
    aid = make(bid, made, status="generating", progress="Writing the second section", body=big)
    seen: list[str] = []
    listener = lambda conn, cur, stmt, *a: seen.append(stmt)  # noqa: E731

    def measure(requests):
        seen.clear()
        total = 0
        event.listen(engine, "before_cursor_execute", listener)
        try:
            for url in requests:
                r = client.get(url)
                assert r.status_code == 200
                total += len(r.content)
        finally:
            event.remove(engine, "before_cursor_execute", listener)
        return len(seen), total
    base = f"/api/v1/businesses/{bid}/articles"
    old_statements, old_bytes = measure([f"{base}/{aid}", f"{base}/{aid}", base])
    new_statements, new_bytes = measure([f"{base}/{aid}/progress?known_len={len(big)}"] * 2)
    print(f"\nPOLLING, two seconds: statements before={old_statements} after={new_statements} | bytes before={old_bytes} after={new_bytes}")
    assert new_statements < old_statements and new_bytes < old_bytes / 20
