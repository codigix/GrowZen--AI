"""Position Tracking landscape: the figures are computed from saved rank checks (no network)."""
from datetime import date

from app.services.landscape import CTR, Obs, landscape

D1, D2 = date(2026, 10, 1), date(2026, 10, 20)
ME = "mysite.com"


def _o(kw, day, rank, url=None, own=None, serp=(), features=(), own_features=()):
    return Obs(kw, day, rank, url, own if own is not None else ([url] if url else []), [{"d": d, "p": p} for d, p in serp], list(features), list(own_features))


def test_visibility_traffic_movers_and_competitors():
    obs = [
        _o("a", D1, 5, "https://mysite.com/a", serp=[("rival.com", 1)]), _o("a", D2, 1, "https://mysite.com/a", serp=[("rival.com", 2)], features=["People also ask"], own_features=["People also ask"]),
        _o("b", D1, None, serp=[("rival.com", 1)]), _o("b", D2, 8, "https://mysite.com/b", own=["https://mysite.com/b", "https://mysite.com/b2"], serp=[("rival.com", 1)]),
        _o("c", D1, 2, "https://mysite.com/c"), _o("c", D2, 6, "https://mysite.com/c"),
    ]
    meta = {"a": {"volume": 1000, "tag": "x"}, "b": {"volume": 100, "tag": "x"}, "c": {"volume": 0, "tag": "y"}}
    r = landscape(obs, meta, ME, D1, D2)
    assert r["state"] == "ok" and r["tracked"] == 3 and r["comparable"]
    # visibility: sum of click rates / (keywords x click rate of #1)
    assert r["cards"]["visibility"]["value"] == round((CTR[0] + CTR[7] + CTR[5]) / (3 * CTR[0]) * 100, 2)
    assert r["cards"]["traffic"]["value"] == round(1000 * CTR[0] + 100 * CTR[7], 2)
    assert r["cards"]["avg_position"]["value"] == round((1 + 8 + 6) / 3, 2)
    assert r["movers"] == {"improved": 2, "declined": 1, "unchanged": 0}  # a: 5->1, b: out->8, c: 2->6
    assert r["keywords"]["top3"] == {"count": 1, "new": 0, "lost": 1, "series": [1, 1]} or r["keywords"]["top3"]["count"] == 1
    assert r["positive"]["rows"][0]["keyword"] == "a" and r["negative"]["rows"][0]["keyword"] == "c"
    assert {t["tag"] for t in r["tags"]} == {"x", "y"}
    assert [c["domain"] for c in r["competitors"]][0] in ("rival.com", ME) and any(c["you"] for c in r["competitors"])
    assert r["serp_features"] == [{"feature": "People also ask", "keywords": 1, "yours": 1}]
    assert r["cannibal"]["affected"] == 1 and r["cannibal"]["pages"] == 2 and r["cannibal"]["health"] == 67
    assert {p["url"] for p in r["pages"]["top"]} == {"https://mysite.com/a", "https://mysite.com/b", "https://mysite.com/c"}
    assert any("improved for 2" in s for s in r["summary"])
    # the detail tabs
    me = next(c for c in r["competitors_all"] if c["you"])
    assert me["top3"]["count"] == 1 and me["top10"]["count"] == 3 and me["top3"]["new"] == 1 and me["improved"] == 1 and me["declined"] == 1
    assert r["cannibal"]["rows"][0]["keyword"] == "b" and len(r["cannibal"]["rows"][0]["pages"]) == 2
    assert {p["url"] for p in r["cannibal"]["page_rows"]} == {"https://mysite.com/b", "https://mysite.com/b2"} and r["cannibal"]["page_rows"][0]["affected"] == 1 and r["cannibal"]["pages_total"] == 3 and r["cannibal"]["rate"] == "medium"
    assert {p["url"] for p in r["pages"]["all"]} == {"https://mysite.com/a", "https://mysite.com/b", "https://mysite.com/c"} and r["pages"]["lost"] == []
    assert next(p for p in r["pages"]["all"] if p["url"].endswith("/b"))["new"] is True
    assert r["snippets"][0]["keyword"] == "a" and r["snippets"][0]["yours"] and r["snippets"][0]["potential"] == round(1000 * CTR[0], 1)
    assert next(x for x in r["all_keywords"] if x["keyword"] == "a")["traffic"] == round(1000 * CTR[0], 2)


def test_one_check_has_no_changes_and_empty_period_has_no_data():
    one = landscape([_o("a", D1, 3, "https://mysite.com/a")], {"a": {}}, ME, D1, D2)
    assert one["comparable"] is False and one["cards"]["visibility"]["change"] is None and one["keywords"]["top3"]["new"] is None
    assert one["cards"]["traffic"]["value"] is None  # no keyword has a volume: not estimated
    assert landscape([_o("a", D1, 3)], {"a": {}}, ME, date(2026, 11, 1), date(2026, 11, 30)) == {"state": "no_data"}


def test_endpoint_states(client):
    r = client.post("/api/v1/businesses", json={"name": "Landscape Co", "website": "https://landscapeco.in"})
    bid = r.json()["id"]
    assert client.get(f"/api/v1/businesses/{bid}/seo/position-landscape").json()["state"] == "no_keywords"
    client.post(f"/api/v1/businesses/{bid}/keywords", json=[{"keyword": "dentist near me"}])
    assert client.get(f"/api/v1/businesses/{bid}/seo/position-landscape").json()["state"] == "no_data"
    nosite = client.post("/api/v1/businesses", json={"name": "No Site"}).json()["id"]
    assert client.get(f"/api/v1/businesses/{nosite}/seo/position-landscape").json()["state"] == "no_website"


def test_organic_research_changes_and_serp_features():
    from app.services.landscape import organic_research
    obs = [
        _o("a", D1, 5, "https://mysite.com/a", features=["People also ask"]), _o("a", D2, 2, "https://mysite.com/a", features=["People also ask", "Videos"], own_features=["Videos"]),
        _o("b", D1, None), _o("b", D2, 7, "https://mysite.com/b"),
        _o("c", D1, 3, "https://mysite.com/c"), _o("c", D2, None),
        _o("d", D1, 4, "https://mysite.com/d"), _o("d", D2, 9, "https://mysite.com/d"),
        _o("e", D1, 6, "https://mysite.com/e"), _o("e", D2, 6, "https://mysite.com/e"),
    ]
    r = organic_research(obs, {"a": {"volume": 100}}, ME, D1, D2)
    assert r["counts"] == {"new": 1, "lost": 1, "improved": 1, "declined": 1}  # e did not change
    assert r["changes"]["new"][0]["keyword"] == "b" and r["changes"]["lost"][0]["keyword"] == "c"
    f = r["features"]
    assert f["changes"]["new"] == [{"keyword": "a", "feature": "Videos"}] and f["changes"]["lost"] == []
    assert {x["feature"]: x["keywords"] for x in f["linking"]}["Videos"] == 1
    assert {x["feature"]: x["keywords"] for x in f["not_linking"]}["People also ask"] == 1
    assert f["trend"]["People also ask"] == [1, 1] and f["trend"]["Videos"] == [0, 1]


def test_google_redirect_results_keep_their_real_domain():
    from app.services.organic import _shown, result_host
    goto = "https://www.google.com/goto?url=CAESabc"
    assert result_host({"link": "https://www.circadian-ca.com/x", "displayedLink": "ignored"}) == "circadian-ca.com"
    assert result_host({"link": goto, "displayedLink": "https://www.itorixinfotech.com › Digital Marketing"}) == "itorixinfotech.com"
    assert _shown({"link": goto, "displayedLink": "https://mysite.com › blog › post-name"}) == ("mysite.com", "https://mysite.com/blog/post-name")
    assert _shown({"link": goto, "displayedLink": "https://mysite.com › Digital Marketing"})[1] == "https://mysite.com"  # a page title is not a path
    assert _shown({"link": goto, "displayedLink": ""}) == ("", "")
    assert result_host({"link": "https://www.google.com/maps/place/x", "displayedLink": "x"}) == "google.com"  # a real Google page is not a redirect


def test_tracked_set_summary_when_the_site_does_not_rank():
    from app.services.landscape import organic_research
    obs = [_o("a", D1, None, serp=[("rival.com", 1), ("other.com", 2)]), _o("b", D1, None, serp=[("rival.com", 1)])]
    r = organic_research(obs, {"a": {"intent": "local"}, "b": {}}, ME, D1, D2)
    assert r["tracked_summary"]["keywords"] == 2 and r["tracked_summary"]["ranking"] == 0 and r["tracked_summary"]["avg_position"] is None
    assert [c["domain"] for c in r["competitors"][:2]] == ["rival.com", "other.com"] and r["own_pages"]["total"] == 0 and r["own_hosts"] == []
    assert r["features_reported"] is False and {i["intent"]: i["keywords"] for i in r["intents"]} == {"local": 1, "unknown": 1}
    assert [x["leader"] for x in r["tracked_rows"]] == ["rival.com", "rival.com"]


def test_directories_and_social_sites_are_not_competitors():
    obs = [_o("a", D1, 3, "https://mysite.com/a", serp=[("instagram.com", 1), ("rival.com", 2), ("justdial.com", 4)]),
           _o("a", D2, 3, "https://mysite.com/a", serp=[("instagram.com", 1), ("rival.com", 2), ("justdial.com", 4)])]
    r = landscape(obs, {"a": {}}, ME, D1, D2)
    assert {c["domain"] for c in r["competitors_all"]} == {"rival.com", ME}
    assert {c["domain"] for c in r["platforms"]} == {"instagram.com", "justdial.com"} and r["platform_total"] == 2
    kept = landscape(obs, {"a": {}}, ME, D1, D2, keep={"justdial.com"})  # a directory the user chose to track counts as a competitor
    assert "justdial.com" in {c["domain"] for c in kept["competitors_all"]}
