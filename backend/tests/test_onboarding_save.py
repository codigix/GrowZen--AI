"""The onboarding run saves the filled-in form with one PATCH; it must answer, never crash."""


FORM = {
    "name": "Codigix Infotech Pvt. Ltd. - IT Solutions", "phone": "+91 90000 00000", "website": "https://codigixinfotech.com", "address": "Pimpri Colony, Pimpri-Chinchwad", "area": "Pimpri Colony",
    "city": "Pimpri-Chinchwad", "country": "IN", "primary_category": "Software company", "description": "IT solutions", "contact_name": "Admin", "contact_email": "a@codigixinfotech.com",
    "booking_url": "https://codigixinfotech.com/contact", "plan": "Growth", "services": [{"name": "SEO"}, {"name": "Web design"}], "attributes": ["wheelchair accessible"], "lat": 18.6279, "lng": 73.8009,
    "target_scope": "local", "target_countries": [], "target_areas": ["Pimpri Colony, Pimpri-Chinchwad"],
}


def test_onboarding_form_patch(client):
    bid = client.post("/api/v1/businesses", json={"name": "Codigix"}).json()["id"]
    r = client.patch(f"/api/v1/businesses/{bid}", json=FORM)
    assert r.status_code == 200, r.text
    assert r.json()["services"] == [{"name": "SEO"}, {"name": "Web design"}] and r.json()["target_areas"] == ["Pimpri Colony, Pimpri-Chinchwad"]
