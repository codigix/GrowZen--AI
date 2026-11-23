def test_the_sources_list_names_every_source_and_the_pages_that_use_it(client):
    d = client.get("/api/v1/system/data-sources").json()["sources"]
    keys = {x["key"] for x in d}
    assert {"gbp", "gsc", "ga4", "places", "ai", "calc", "manual"} <= keys
    for x in d:
        assert x["name"] and x["kind"] and x["provides"] and x["pages"] and all(p["path"].startswith("/") for p in x["pages"])
        assert isinstance(x["on"], bool)
