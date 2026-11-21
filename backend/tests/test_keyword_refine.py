from types import SimpleNamespace

from app.models import Business, Competitor, KeywordCandidate
from app.services import keyword_fit, keyword_workspace as kw


def _biz(client, name, **extra):
    return client.post("/api/v1/businesses", json={"name": name, "website": f"https://{name.lower().replace(' ', '')}.example/", "city": "Pune", "services": [{"name": "Lehenga rental"}], **extra}).json()["id"]


def _row(k, kinds=("google_ideas",), **kw_):
    return KeywordCandidate(norm=k, keyword=k, sources=[{"kind": x} for x in kinds], competitors=[], **kw_)


def test_the_fit_check_hides_what_does_not_fit_and_never_touches_what_the_business_already_says(client, monkeypatch):
    from app.db import SessionLocal
    from app.services import ai
    bid = _biz(client, "Fit Co")
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    seen = {}

    def fake(system, user, **k):
        seen["user"] = user
        return {"results": [{"i": 0, "fit": "yes", "why": "Rents lehengas in Pune.", "for": "brides"}, {"i": 1, "fit": "no", "why": "Another company's brand."}, {"i": 2, "fit": "maybe", "why": "Unclear."}]}

    monkeypatch.setattr(ai, "complete_json", fake)
    rows = [_row("lehenga on rent pune"), _row("rent the runway lehenga"), _row("party wear rental"), _row("my own page phrase", kinds=("website",)), _row("ranked phrase", own_rank=4.0), _row("picked one", picked=True)]
    db = SessionLocal()
    try:
        out = keyword_fit.judge(db, db.get(Business, bid), rows)
    finally:
        db.close()
    assert out == {"checked": 3, "fit": 2, "hidden": 1}
    assert rows[0].fit["fit"] == "yes" and rows[0].fit["for"] == "brides" and not rows[0].dismissed
    assert rows[1].dismissed is True and rows[1].fit["auto"] is True and not rows[2].dismissed
    assert all(r.fit is None for r in rows[3:])  # the website's, a ranked and a picked keyword are facts about the business: never judged
    assert "rent the runway lehenga" in seen["user"] and "my own page phrase" not in seen["user"]


def test_without_an_ai_nothing_is_hidden(client, monkeypatch):
    from app.db import SessionLocal
    from app.services import ai
    bid = _biz(client, "No Ai Co")
    monkeypatch.setattr(ai, "is_configured", lambda: False)
    rows = [_row("anything goes")]
    db = SessionLocal()
    try:
        assert keyword_fit.judge(db, db.get(Business, bid), rows) == {"checked": 0, "fit": 0, "hidden": 0}
    finally:
        db.close()
    assert rows[0].fit is None and rows[0].dismissed is not True


def test_area_searches_keep_only_what_google_itself_suggests_for_the_area(client, monkeypatch):
    from app.db import SessionLocal
    from app.services import keywords
    bid = _biz(client, "Area Co", target_areas=["Wagholi, Maharashtra"], area="Kharadi")
    monkeypatch.setattr("app.services.business_understanding.search_terms", lambda b: ["lehenga on rent"])
    asked = []

    def fake(q, gl="in"):
        asked.append(q)
        if "Wagholi" in q:
            return [("lehenga on rent wagholi", 600), ("lehenga on rent wagholi pune", 500), ("wagholi", 100), ("lehenga on rent bangalore", 400)]
        return [("lehenga on rent in mumbai", 300)]

    monkeypatch.setattr(keywords, "autocomplete", fake)
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        assert kw._areas(b) == ["Wagholi", "Kharadi", "Pune"]
        found, note = kw.from_area(db, b)
    finally:
        db.close()
    assert [f["keyword"] for f in found] == ["lehenga on rent wagholi", "lehenga on rent wagholi pune"]  # one word ("wagholi") and another city are not kept
    assert found[0]["kind"] == "area" and "Google suggests it for Wagholi" in found[0]["detail"] and note is None and len(asked) == 3


def test_the_business_summary_and_competitor_listings_feed_the_list(client):
    from app.db import SessionLocal
    bid = _biz(client, "Feed Co")
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        assert kw.from_brief(db, b)[0] == [] and "Build the business summary" in kw.from_brief(db, b)[1]
        b.business_brief = {"customer_search_terms": ["lehenga on rent"], "offerings": ["Bridal lehenga rental"], "audience": ["Brides"], "keyword_themes": [{"theme": "Weddings", "keywords": ["wedding dress rental"]}]}
        db.add(Competitor(business_id=bid, name="Style Story", website=None, selected=True, listing={"understanding": {"keywords": ["party dress rental"], "services": ["Blazer rental"]}}))
        db.add(Competitor(business_id=bid, name="Left Out", website=None, selected=False, listing={"understanding": {"keywords": ["ignored phrase"], "services": []}}))
        db.commit()
        got = {f["keyword"]: f for f in kw.from_brief(db, b)[0]}
        assert set(got) == {"lehenga on rent", "Bridal lehenga rental", "wedding dress rental"} and "Brides" in got["wedding dress rental"]["detail"]
        rows = {f["keyword"]: f for f in kw._listing_rows(db, b)}
        assert set(rows) == {"party dress rental", "Blazer rental"} and rows["party dress rental"]["competitor"] == "Style Story"  # a competitor left out is not used
    finally:
        db.query(Competitor).filter_by(business_id=bid).delete()
        db.commit()
        db.close()
