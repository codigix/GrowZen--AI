"""One list of keywords from every source, merged, tagged and picked."""
from app.models import Keyword, KeywordCandidate
from app.services import keyword_workspace as kw


def test_variants_are_one_keyword():
    assert kw.merge_key("dentist pune") == kw.merge_key("Dentists in Pune") == kw.merge_key("pune dentist")
    assert kw.merge_key("dental implants cost") != kw.merge_key("dental implants")


def _project(client):
    r = client.post("/api/v1/businesses", json={"name": "Asha Dental", "website": "https://asha.example", "city": "Pune", "primary_category": "Dentist"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_sources_merge_tag_score_and_pick(client, monkeypatch):
    bid = _project(client)
    from app.db import SessionLocal
    from app.models import Business
    db = SessionLocal()
    b = db.get(Business, bid)
    monkeypatch.setattr(kw.keyword_metrics, "enabled", lambda: False)
    existing = {}
    kw._add(db, b, [{"keyword": "dentist pune", "kind": "website", "detail": "2 pages"}, {"keyword": "Dentists in Pune", "kind": "competitors", "label": "rival.example", "competitor": "rival.example", "detail": "x"},
                    {"keyword": "teeth whitening", "kind": "competitors", "label": "rival.example", "competitor": "rival.example", "detail": "x"},
                    {"keyword": "root canal cost", "kind": "search_console", "detail": "5 views", "position": 14.2, "impressions": 50, "clicks": 1},
                    {"keyword": "braces", "kind": "ai", "detail": "why"}], existing)
    db.commit()
    assert db.query(KeywordCandidate).filter_by(business_id=bid).count() == 4  # the two spellings are one row
    out = client.get(f"/api/v1/businesses/{bid}/keyword-workspace").json()
    by = {i["keyword"]: i for i in out["items"]}
    both = by["dentist pune"]
    assert {s["kind"] for s in both["sources"]} == {"website", "competitors"} and both["tag"] == "shared" and "dentists in pune" in both["variants"]
    assert by["teeth whitening"]["tag"] == "gap" and by["root canal cost"]["tag"] == "almost" and by["braces"]["tag"] == "idea"
    assert out["competitors"]["count"] == 0 and out["totals"]["open"] == 4
    only = client.get(f"/api/v1/businesses/{bid}/keyword-workspace?source=competitors").json()
    assert {i["keyword"] for i in only["items"]} == {"dentist pune", "teeth whitening"}
    r = client.post(f"/api/v1/businesses/{bid}/keyword-workspace/pick", json={"ids": [by["teeth whitening"]["id"]]}).json()
    assert r["picked"] == 1 and r["totals"]["picked"] == 1
    k = db.query(Keyword).filter_by(business_id=bid, keyword="teeth whitening").one()
    assert k.source["kind"] == "competitors" and k.source["competitors"] == ["rival.example"]
    client.post(f"/api/v1/businesses/{bid}/keyword-workspace/dismiss", json={"ids": [by["braces"]["id"]]})
    assert client.get(f"/api/v1/businesses/{bid}/keyword-workspace?show=dismissed").json()["shown"] == 1


def test_collect_reports_each_source_and_never_stops(client, monkeypatch):
    bid = _project(client)
    monkeypatch.setattr(kw.keyword_metrics, "enabled", lambda: False)
    r = client.post(f"/api/v1/businesses/{bid}/keyword-workspace/collect", json={"sources": ["profile", "website", "competitors"]}).json()
    rep = r["report"]
    assert rep["profile"]["found"] >= 2 and "dentist in pune" in {i["keyword"] for i in r["items"]}  # service with the city
    assert rep["website"]["found"] == 0 and "Website Audit" in rep["website"]["note"]
    assert rep["competitors"]["found"] == 0 and "competitors" in rep["competitors"]["note"].lower()


def test_keywords_saved_on_other_pages_appear_in_the_workspace(client):
    bid = _project(client)
    base = f"/api/v1/businesses/{bid}"
    client.post(f"{base}/keywords", json=[{"keyword": "Dental Implants Pune", "source": {"kind": "ai", "label": "AI suggestions"}}, {"keyword": "braces"}])
    out = client.get(f"{base}/keyword-workspace?show=picked").json()
    by = {i["keyword"]: i for i in out["items"]}
    assert set(by) == {"dental implants pune", "braces"} and by["dental implants pune"]["sources"][0]["kind"] == "ai" and out["totals"]["picked"] == 2
    assert client.post(f"{base}/keyword-workspace/add", json={"ideas": [{"keyword": "dentist near me", "volume": 900}], "label": "Check One Keyword"}).json()["added"] == 1
    s = client.get(f"{base}/keyword-workspace/summary").json()
    assert s["saved"] == 2 and s["workspace"] == 1
    client.delete(f"{base}/keywords/{[k['id'] for k in client.get(f'{base}/keywords').json()['keywords'] if k['keyword'] == 'braces'][0]}")
    assert client.get(f"{base}/keyword-workspace/summary").json()["saved"] == 1  # removed from the list: back to be looked at
