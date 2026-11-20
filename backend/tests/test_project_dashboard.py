from datetime import date

from app.services import project_dashboard as pd


def test_series_put_each_date_in_its_week_and_ignore_dates_outside():
    keys = pd._keys_between(date(2026, 9, 7), date(2026, 11, 20), "week")
    assert len(keys) == 11 and keys[0] == date(2026, 9, 7) and keys[-1] == date(2026, 11, 16)
    s = pd._series([date(2026, 11, 17), date(2026, 11, 18), date(2026, 11, 10), date(2020, 1, 1)], "week", keys)
    assert s[-1] == 2 and s[-2] == 1 and sum(s) == 3  # an old date is outside the window
    assert pd._series([date(2026, 11, 17)], "week", keys, [7])[-1] == 7  # a weighted row (e.g. 7 calls in a day)


def test_the_dashboard_endpoint_for_a_new_project_is_all_zero_and_has_every_part(client):
    bid = client.post("/api/v1/businesses", json={"name": "Dash Co", "website": "https://dash.example/"}).json()["id"]
    for rng, compare in (("all", False), ("30d", True)):
        r = client.get(f"/api/v1/businesses/{bid}/dashboard", params={"range": rng}).json()
        n = len(r["labels"])
        assert n >= 1 and all(len(v) == n for v in r["series"].values()) and len(r["health"]) == n and r["range"]["key"] == rng
        assert set(r) >= {"counts", "movement", "timeline", "recent_tasks"} and r["counts"]["fixes_total"] == 0 and r["counts"]["reviews"] == 0
        assert r["movement"]["calls"]["compare"] is compare


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
        r = dash.build(db, db.get(Business, bid), "all")
    finally:
        db.query(Keyword).filter_by(business_id=bid).delete()
        db.query(KeywordCandidate).filter_by(business_id=bid).delete()
        db.commit()
        db.close()
    c = r["counts"]
    assert (c["keywords_saved"], c["keywords_tracked"], c["keywords_suggested"], c["ranking_top10"]) == (2, 1, 1, 1)
    assert (c["backlinks"], c["referring_domains"], c["backlinks_verified"], c["backlinks_tracked"]) == (12, 5, 9, True)
    assert r["top_keywords"][0]["keyword"] == "red saree" and r["top_keywords"][0]["rank"] == 4 and sum(r["series"]["keywords"]) == 2


def test_everything_by_default_and_a_range_narrows_it():
    today = date(2026, 11, 20)
    k, s, e, group, keys = pd.plan("all", None, None, None, date(2025, 1, 15), today)
    assert (k, s, e, group) == ("all", date(2025, 1, 15), today, "month") and keys[0] == date(2025, 1, 1) and keys[-1] == date(2026, 11, 1)
    k, s, e, group, keys = pd.plan("30d", None, None, None, date(2025, 1, 15), today)
    assert (s, e, group, len(keys)) == (date(2026, 10, 22), today, "week", 5)
    k, s, e, group, keys = pd.plan("custom", date(2026, 9, 1), date(2026, 9, 30), "month", None, today)
    assert (k, s, e, group, keys) == ("custom", date(2026, 9, 1), date(2026, 9, 30), "month", [date(2026, 9, 1)])
    assert pd.plan("custom", date(2026, 9, 30), date(2026, 9, 1), None, None, today)[1:3] == (date(2026, 9, 1), date(2026, 9, 30))  # dates the wrong way round are swapped
    assert pd.plan("bogus", None, None, None, None, today)[0] == "all"


def test_attention_lists_what_is_wrong_most_important_first(client):
    bid = client.post("/api/v1/businesses", json={"name": "Attn Co", "website": "https://attn.example/"}).json()["id"]
    r = client.get(f"/api/v1/businesses/{bid}/dashboard").json()
    items = r["attention"]
    assert items and items[0]["level"] == "high" and "not connected" in items[0]["title"]
    order = [{"high": 0, "medium": 1, "low": 2}[x["level"]] for x in items]
    assert order == sorted(order) and len(items) <= 8
    assert all(x["to"].startswith("/") and x["why"] for x in items)
