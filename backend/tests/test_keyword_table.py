from app.services import keyword_table as kt


def test_path_of():
    assert kt.path_of("https://x.com/a/b/") == "/a/b" and kt.path_of("https://x.com") == "/" and kt.path_of(None) == "/"


def test_table_rows_carry_the_live_fields_with_or_without_the_slow_figures(client):
    bid = client.post("/api/v1/businesses", json={"name": "Tbl Co", "website": "https://tbl.example/"}).json()["id"]
    client.post(f"/api/v1/businesses/{bid}/keywords", json=[{"keyword": "gown rental", "priority": "High"}, {"keyword": "saree rental"}])
    kid = client.get(f"/api/v1/businesses/{bid}/keywords").json()["keywords"][0]["id"]
    client.patch(f"/api/v1/businesses/{bid}/keywords/{kid}", json={"keyword": "x", "target_url": "https://tbl.example/gowns"})
    r = client.get(f"/api/v1/businesses/{bid}/keywords/table").json()
    assert {"rows", "refreshing", "fetched_at", "ga_state", "every_minutes"} <= set(r) and len(r["rows"]) == 2
    mapped = next(x for x in r["rows"] if x["target_url"])
    assert mapped["mapped"] is True and mapped["target_path"] == "/gowns" and mapped["index_for"] == "/gowns"
    assert mapped["index"]["state"] == "unknown"  # the page is not in the page list yet: said so, not guessed
    other = next(x for x in r["rows"] if not x["target_url"])
    assert other["mapped"] is False and other["suggested"] is None and other["ai"] == {"tracked": False, "mentioned": None}


def test_one_primary_keyword_per_page(client):
    bid = client.post("/api/v1/businesses", json={"name": "Role Co", "website": "https://role.example/"}).json()["id"]
    client.post(f"/api/v1/businesses/{bid}/keywords", json=[{"keyword": "gown rental"}, {"keyword": "party gown"}, {"keyword": "saree rental"}])
    ids = {k["keyword"]: k["id"] for k in client.get(f"/api/v1/businesses/{bid}/keywords").json()["keywords"]}
    patch = lambda kw, **body: client.patch(f"/api/v1/businesses/{bid}/keywords/{ids[kw]}", json={"keyword": kw, **body}).json()  # noqa: E731
    patch("gown rental", target_url="https://role.example/gowns", role="primary")
    patch("saree rental", target_url="https://role.example/sarees", role="primary")
    patch("party gown", target_url="https://role.example/gowns", role="primary")  # takes the primary place on /gowns
    now = {k["keyword"]: k["role"] for k in client.get(f"/api/v1/businesses/{bid}/keywords").json()["keywords"]}
    assert now == {"party gown": "primary", "gown rental": "secondary", "saree rental": "primary"}
    rows = {r["keyword"]: r for r in client.get(f"/api/v1/businesses/{bid}/keywords/table").json()["rows"]}
    assert rows["party gown"]["role"] == "primary" and rows["gown rental"]["role"] == "secondary" and rows["saree rental"]["branded"] is False
