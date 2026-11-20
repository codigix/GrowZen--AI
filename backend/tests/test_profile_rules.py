from app.services import profile_rules as r


def fields(issues):
    return {(i["field"], i["level"]) for i in issues}


def test_description_rules():
    long = "x" * 751
    assert ("description", "error") in fields(r.check({"description": long}))
    assert ("description", "error") in fields(r.check({"description": "Visit https://shop.example for more " + "a" * 260}))
    assert ("description", "error") in fields(r.check({"description": "<b>bold</b> " + "a" * 260}))
    assert ("description", "warn") in fields(r.check({"description": "Flat 50% off on every dress " + "a" * 260}))
    assert not r.check({"description": "We rent designer lehengas and sarees for weddings in Pune. " * 5})


def test_name_rules_warn_but_do_not_block():
    out = r.check({"name": "BEST LEHENGA RENTAL | Open 24 hours | 9112706604"})
    assert {i["level"] for i in out} == {"warn"} and len(out) >= 3
    assert not r.check({"name": "vastrbhushan Rental"})


def test_phones_links_and_limits():
    assert ("phone", "error") in fields(r.check({"phone": "12"}))
    assert ("phone", "warn") in fields(r.check({"phone": "091127 06604"}))
    assert not r.check({"phone": "+91 91127 06604"})
    assert ("additional_phones", "error") in fields(r.check({"additional_phones": ["+91 98765 43210", "+91 98765 43211", "+91 98765 43212"]}))
    assert ("website", "error") in fields(r.check({"website": "vastrbhushan.com"}))
    out = r.check({"website": "https://a.com/", "booking_url": "https://a.com", "action_links": [{"type": "FOOD_ORDERING", "url": "https://www.swiggy.com/x"}]})
    assert ("booking_url", "warn") in fields(out) and ("action_links", "warn") in fields(out)
    assert ("secondary_categories", "error") in fields(r.check({"secondary_categories": [str(i) for i in range(10)]}))


def test_the_save_refuses_what_google_refuses_and_the_check_endpoint_lists_issues(client):
    bid = client.post("/api/v1/businesses", json={"name": "Rules Co", "website": "https://rules.example/"}).json()["id"]
    res = client.patch(f"/api/v1/businesses/{bid}", json={"description": "see www.rules.example " + "a" * 260})
    assert res.status_code == 422 and "Google's rules" in res.json()["detail"]
    ok = client.post(f"/api/v1/businesses/{bid}/gbp/rules-check", json={"name": "RULES CO | best", "phone": "091127 06604"}).json()
    assert {i["field"] for i in ok["issues"]} == {"name", "phone"}
