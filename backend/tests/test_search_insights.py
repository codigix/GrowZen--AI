from app.services import search_insights as si


def test_path_of():
    assert si.path_of("https://x.com/a/b/?utm=1") == "/a/b"
    assert si.path_of("https://x.com") == "/" and si.path_of("/") == "/"


def test_low_ctr_finds_pages_that_earn_less_than_usual():
    rows = [{"key": "p1", "clicks": 3, "impressions": 1000, "ctr": 0.003, "position": 4.2},    # expected 8%: clearly low
            {"key": "p2", "clicks": 90, "impressions": 1000, "ctr": 0.09, "position": 4.0},   # fine
            {"key": "p3", "clicks": 0, "impressions": 20, "ctr": 0.0, "position": 5.0},       # too few impressions
            {"key": "p4", "clicks": 1, "impressions": 900, "ctr": 0.001, "position": 1.5}]    # top position: not this check
    out = si.low_ctr(rows, "page")
    assert [r["page"] for r in out] == ["p1"] and out[0]["clicks_missing"] > 60 and out[0]["expected_ctr"] == 8.0


