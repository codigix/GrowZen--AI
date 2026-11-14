from app.services import competitor_keywords as ck


def _crawl(*pages):
    return {"pages": [{"status": 200, **p} for p in pages]}


def test_phrases_come_from_titles_and_headings_without_brand_or_junk():
    brand = ck._brand_words("Dwarkadas Shamkumar Textiles Pvt Ltd", hosts=("dsmills.com",))
    c = _crawl({"url": "https://dsmills.com/", "title": "Dwarkadas Shamkumar Textiles Pvt Ltd | Silk Sarees Online", "h1": "Handcrafted silk sarees", "meta_description": "price per unit regular"},
               {"url": "https://dsmills.com/w", "title": "Silk Sarees for Wedding - DS Mills", "h1": "Silk sarees for wedding"})
    got = ck._drop_inside(ck._site_phrases(c, brand))
    assert "silk sarees" in got and "silk sarees for wedding" in got
    assert not any("shamkumar" in k or "pvt" in k or "per unit" in k for k in got)
    assert {p["path"] for p in got["silk sarees"]["pages"]} == {"/", "/w"}


def test_researched_keeps_only_searched_phrases_and_records_sources(monkeypatch):
    from app.db import SessionLocal
    from app.models import Business
    monkeypatch.setattr(ck.keyword_metrics, "lookup", lambda kws, cc=None: ({"silk sarees": {"volume": 9000, "cpc": 1.0, "difficulty": 40}}, None))
    db = SessionLocal()
    b = Business(name="Mine", city="Pune", website="https://mine.example")
    db.add(b); db.commit()
    try:
        ours = _crawl({"url": "https://mine.example/", "title": "Silk Sarees in Pune", "h1": "Silk sarees"})
        theirs = _crawl({"url": "https://rival.example/", "title": "Silk Sarees | Rival", "h1": "Silk sarees", "meta_description": "wedding silk sarees"})
        r = ck.researched(db, b.id, ours, theirs, our_name="Mine", their_name="Rival", our_host="mine.example", their_host="rival.example")
        assert r["verified"] and [i["keyword"] for i in r["items"]] == ["silk sarees"]
        it = r["items"][0]
        assert it["side"] == "both" and it["volume"] == 9000 and {s["side"] for s in it["sources"]} == {"client", "competitor"}
    finally:
        db.delete(b); db.commit(); db.close()
