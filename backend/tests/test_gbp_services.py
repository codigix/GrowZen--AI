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
