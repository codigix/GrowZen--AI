from datetime import date, timedelta

from app.services import project_dashboard as pd


def test_buckets_are_the_last_12_weeks_or_6_months_oldest_first():
    w = pd.buckets("week", date(2026, 11, 20))
    assert len(w) == 12 and w[-1] == date(2026, 11, 16) and w[0] == date(2026, 11, 16) - timedelta(weeks=11)
    m = pd.buckets("month", date(2026, 11, 20))
    assert m == [date(2026, 6, 1), date(2026, 7, 1), date(2026, 8, 1), date(2026, 9, 1), date(2026, 10, 1), date(2026, 11, 1)]


def test_series_and_change():
    keys = pd.buckets("week", date(2026, 11, 20))
    s = pd._series([date(2026, 11, 17), date(2026, 11, 18), date(2026, 11, 10), date(2020, 1, 1)], "week", keys)
    assert s[-1] == 2 and s[-2] == 1 and sum(s) == 3  # an old date is outside the window
    assert pd._change([0, 1, 2]) == {"now": 2, "before": 1, "delta": 1, "pct": 100}
    assert pd._change([0, 0, 3])["pct"] is None


def test_the_dashboard_endpoint_for_a_new_project_is_all_zero_and_has_every_part(client):
    bid = client.post("/api/v1/businesses", json={"name": "Dash Co", "website": "https://dash.example/"}).json()["id"]
    for period, n in (("week", 12), ("month", 6)):
        r = client.get(f"/api/v1/businesses/{bid}/dashboard", params={"period": period}).json()
        assert len(r["labels"]) == n and all(len(v) == n for v in r["series"].values()) and len(r["health"]) == n
        assert set(r) >= {"counts", "movement", "timeline", "recent_tasks"} and r["counts"]["fixes_total"] == 0 and r["counts"]["reviews"] == 0


def test_keyword_and_backlink_counts_are_real_counts(client, monkeypatch):
    from app.db import SessionLocal
    from app.models import Business, Keyword, KeywordCandidate
    from app.services import project_dashboard as dash
    bid = client.post("/api/v1/businesses", json={"name": "Count Co", "website": "https://count.example/"}).json()["id"]
    db = SessionLocal()
    try:
        db.add_all([Keyword(business_id=bid, keyword="red saree", tracked=True, rank=4, volume=900), Keyword(business_id=bid, keyword="blue saree", tracked=False),
                    KeywordCandidate(business_id=bid, norm="green saree", keyword="green saree")])
        db.commit()
        monkeypatch.setattr(dash.bl_summary, "own_site_links", lambda d, i: {"domain": "count.example", "backlinks": 12, "referring_domains": 5, "crawler_verified": 9})
        r = dash.build(db, db.get(Business, bid), "week")
    finally:
        db.query(Keyword).filter_by(business_id=bid).delete()
        db.query(KeywordCandidate).filter_by(business_id=bid).delete()
        db.commit()
        db.close()
    c = r["counts"]
    assert (c["keywords_saved"], c["keywords_tracked"], c["keywords_suggested"], c["ranking_top10"]) == (2, 1, 1, 1)
    assert (c["backlinks"], c["referring_domains"], c["backlinks_verified"], c["backlinks_tracked"]) == (12, 5, 9, True)
    assert r["top_keywords"][0]["keyword"] == "red saree" and r["top_keywords"][0]["rank"] == 4 and sum(r["series"]["keywords"]) == 2
