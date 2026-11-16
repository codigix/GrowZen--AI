from app.services import gbp


def test_google_service_items_become_the_apps_services():
    items = [{"freeFormServiceItem": {"category": "categories/gcid:x", "label": {"displayName": "Healthcare Digital Marketing", "description": "SEO and ads"}}, "price": {"currencyCode": "INR", "units": "5000", "nanos": 500000000}},
             {"structuredServiceItem": {"serviceTypeId": "job_type_id:hair_cut"}}, {"freeFormServiceItem": {"label": {}}}]
    got = gbp.services_from_items(items)
    assert got[0] == {"name": "Healthcare Digital Marketing", "description": "SEO and ads", "price": "5000.5", "currency": "INR"}
    assert got[1]["name"] == "Hair cut" and len(got) == 2
    assert gbp.services_from_items(None) == []


def test_location_fields_carry_the_services():
    assert gbp.location_to_fields({"serviceItems": [{"freeFormServiceItem": {"label": {"displayName": "X"}}}]})["services"] == [{"name": "X", "description": ""}]


def test_missing_google_pin_is_taken_from_the_maps_listing_and_never_overwrites_a_real_one(monkeypatch):
    from app.services import discovery

    class B:
        id, place_id, lat, lng = 1, "ChIJx", None, None
    monkeypatch.setattr(discovery, "place_details", lambda pid, *a, **k: {"location": {"latitude": 18.6, "longitude": 73.8}})
    b = B()
    assert gbp.fill_pin_from_maps(b) is True and (b.lat, b.lng) == (18.6, 73.8)
    b.lat, b.lng = 1.0, 2.0
    assert gbp.fill_pin_from_maps(b) is False and (b.lat, b.lng) == (1.0, 2.0)

    def boom(*a, **k):
        raise RuntimeError("places off")
    monkeypatch.setattr(discovery, "place_details", boom)
    c = B()
    assert gbp.fill_pin_from_maps(c) is False and c.lat is None
