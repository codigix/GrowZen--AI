"""Mapping status, cannibalization and duplicate page targeting, and mapping keywords in bulk."""
from app.db import SessionLocal
from app.models import Audit, Business, Keyword
from app.services import keyword_mapping


def _project(client):
    r = client.post("/api/v1/businesses", json={"name": "Asha Dental", "website": "https://asha.example", "city": "Pune", "primary_category": "Dentist"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _site(db, bid):
    pg = lambda path, title, h1: {"url": "https://asha.example" + path, "status": 200, "title": title, "h1": h1, "meta_description": ""}  # noqa: E731
    db.add(Audit(business_id=bid, kind="onpage", status="done", data_source="live", score=70, result={"pages": [
        pg("/", "Asha Dental | Pune", "Dentist in Pune"), pg("/implants", "Dental implants in Pune", "Dental implants"), pg("/implant-cost", "Dental implants Pune cost", "Implant prices"),
        pg("/whitening", "Teeth whitening", "Teeth whitening")]}))
    db.commit()


def _kw(db, bid, **kw):
    k = Keyword(business_id=bid, tracked=True, **kw)
    db.add(k)
    db.commit()
    return k


def test_status_is_worked_out_and_a_status_set_by_hand_wins(client):
    bid = _project(client)
    db = SessionLocal()
    _site(db, bid)
    a = _kw(db, bid, keyword="teeth whitening", volume=700)
    b = _kw(db, bid, keyword="invisible braces", volume=300)  # no page carries it
    p = keyword_mapping.plan(db, db.get(Business, bid))
    st = {r["keyword"]: r["status"] for r in p["statuses"]}
    assert st == {"teeth whitening": "mapped", "invisible braces": "new_page"} and p["status_counts"]["mapped"] == 1 and p["status_counts"]["new_page"] == 1
    url = f"/api/v1/businesses/{bid}/keyword-mapping/assign"
    out = client.post(url, json={"ids": [a.id], "status": "optimization"}).json()
    assert {r["keyword"]: r["status"] for r in out["statuses"]}["teeth whitening"] == "optimization"
    out = client.post(url, json={"ids": [a.id], "status": "mapped"}).json()  # back to worked out
    assert {r["keyword"]: r["status"] for r in out["statuses"]}["teeth whitening"] == "mapped"
    assert client.post(url, json={"ids": [a.id], "status": "bogus"}).status_code == 400
    assert client.post(url, json={"ids": [a.id], "target_url": "javascript:alert(1)"}).status_code == 400


def test_two_pages_that_carry_a_keyword_equally_are_a_cannibalization_risk(client):
    bid = _project(client)
    db = SessionLocal()
    _site(db, bid)
    _kw(db, bid, keyword="dental implants pune", volume=900)
    _kw(db, bid, keyword="teeth whitening", volume=700)
    p = keyword_mapping.plan(db, db.get(Business, bid))
    risk = {r["keyword"]: r for r in p["cannibalization"]}
    assert set(risk) == {"dental implants pune"} and risk["dental implants pune"]["kind"] == "pages_compete" and set(risk["dental implants pune"]["pages"]) == {"/implants", "/implant-cost"}


def test_duplicate_targeting_same_words_and_two_main_keywords_on_one_page(client):
    bid = _project(client)
    db = SessionLocal()
    _site(db, bid)
    _kw(db, bid, keyword="teeth whitening", volume=700, role="primary", target_url="https://asha.example/whitening")
    _kw(db, bid, keyword="whitening teeth", volume=100, role="primary", target_url="https://asha.example/whitening")
    p = keyword_mapping.plan(db, db.get(Business, bid))
    kinds = {d["kind"] for d in p["duplicates"]}
    assert kinds == {"same_words", "two_primaries"}
    two = next(d for d in p["duplicates"] if d["kind"] == "two_primaries")
    assert two["pages"] == ["/whitening"] and len(two["keywords"]) == 2


def test_bulk_assign_puts_keywords_on_a_page_and_keeps_one_main_keyword_per_page(client):
    bid = _project(client)
    db = SessionLocal()
    _site(db, bid)
    old = _kw(db, bid, keyword="teeth whitening", volume=700, role="primary", target_url="https://asha.example/whitening")
    n1 = _kw(db, bid, keyword="whitening cost", volume=200)
    n2 = _kw(db, bid, keyword="whitening near me", volume=100)
    url = f"/api/v1/businesses/{bid}/keyword-mapping/assign"
    r = client.post(url, json={"ids": [n1.id, n2.id], "target_url": "https://asha.example/whitening", "role": "primary"})
    assert r.status_code == 200 and r.json()["updated"] == 2
    db2 = SessionLocal()
    roles = {k.keyword: (k.role, k.target_url) for k in db2.query(Keyword).filter_by(business_id=bid)}
    assert roles["whitening cost"] == ("primary", "https://asha.example/whitening") and roles["whitening near me"][0] == "secondary"  # one main keyword
    assert roles["teeth whitening"][0] == "secondary"  # the old main keyword was demoted
    other = client.post(url, json={"ids": [999999], "role": "primary"}).json()
    assert other["updated"] == 0  # a keyword of another project is never touched
