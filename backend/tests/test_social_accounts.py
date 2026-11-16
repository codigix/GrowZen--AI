"""Meta Business Suite links (Facebook page, Instagram, business id) are saved with the project, normalised, and private to its owner."""


def test_social_accounts_round_trip_through_create_get_and_patch(client):
    r = client.post("/api/v1/businesses", json={"name": "Social Co", "social_accounts": {"facebook": "facebook.com/socialco/?ref=x", "instagram": "@social.co", "meta_business_id": "1234567890"}})
    assert r.status_code == 201
    bid = r.json()["id"]
    want = {"facebook": "https://facebook.com/socialco", "instagram": "social.co", "meta_business_id": "1234567890"}
    assert r.json()["social_accounts"] == want
    assert client.get(f"/api/v1/businesses/{bid}").json()["social_accounts"] == want
    p = client.patch(f"/api/v1/businesses/{bid}", json={"social_accounts": {"instagram": "https://www.instagram.com/new_handle/"}})
    assert p.status_code == 200 and p.json()["social_accounts"] == {"instagram": "new_handle"}
    assert client.patch(f"/api/v1/businesses/{bid}", json={"social_accounts": {}}).json()["social_accounts"] == {}  # unlinking clears them
    assert [b["social_accounts"] for b in client.get("/api/v1/businesses").json() if b["id"] == bid] == [{}]


def test_bad_social_addresses_are_refused(client):
    for bad in ({"facebook": "https://example.com/page"}, {"instagram": "not a handle!"}, {"meta_business_id": "abc"}):
        assert client.post("/api/v1/businesses", json={"name": "Bad Social Co", "social_accounts": bad}).status_code == 422, bad
