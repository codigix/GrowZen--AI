def _biz(client):
    return client.post("/api/v1/businesses", json={"name": "Shop Co", "website": "https://shop.example/"}).json()["id"]


def test_products_are_kept_cleaned_and_listed(client):
    bid = _biz(client)
    url = f"/api/v1/businesses/{bid}/gbp/products"
    assert client.get(url).json()["products"] == []
    r = client.put(url, json={"products": [{"name": "  Red   Saree ", "price": "₹499", "url": "https://shop.example/saree"}]})
    assert r.status_code == 200 and r.json()["products"][0]["name"] == "Red Saree"
    assert client.get(url).json()["products"][0]["price"] == "₹499"
    assert client.put(url, json={"products": [{"name": "x", "url": "not a link"}]}).status_code == 422


def test_posting_a_product_needs_a_linked_google_profile(client):
    bid = _biz(client)
    url = f"/api/v1/businesses/{bid}/gbp/products"
    client.put(url, json={"products": [{"name": "Red Saree"}]})
    assert client.post(f"{url}/0/post").status_code == 409
    assert client.post(f"{url}/5/post").status_code == 404
