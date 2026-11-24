"""The GMB audit: nine parameters scored by rules; what Google does not share is "not read", never guessed or counted as a failure."""
from types import SimpleNamespace

from app.services import gbp_audit


def make(**kw):
    base = dict(name="Pune Dental Clinic", city="Pune", area="Kothrud", primary_category="Dentist", secondary_categories=[], phone="+91 98220 11111", address="12 MG Road, Kothrud, Pune",
                website="", description=None, services=[], products=[], rating=None, review_count=None, photo_count=None, cover_photo=None, logo=None, gbp_location=None, place_id=None)
    return SimpleNamespace(**{**base, **kw})


def test_a_name_with_keywords_and_a_city_is_flagged_with_a_clean_suggestion():
    b = make(name="Best Dentist in Pune | Cheap Dental Clinic")
    sec = gbp_audit.name(b, {"title": b.name})
    assert sec["status"] == "bad"
    assert any(c["status"] == "bad" and "marketing" in c["label"].lower() for c in sec["checks"])
    fix = next(f for f in sec["fixes"] if f["impact"] == "high")
    assert "Use:" in fix["example"] and "cheap" not in fix["example"].lower() and "best" not in fix["example"].lower()


def test_a_clean_name_passes():
    sec = gbp_audit.name(make(name="Smile Care Clinic"), {"title": "Smile Care Clinic"})
    assert sec["score"] == 100 and not sec["fixes"]


def test_description_and_services_are_not_read_for_a_profile_that_is_not_connected():
    b = make()
    d, s = gbp_audit.description(b, None), gbp_audit.services(b)
    assert d["readable"] is False and d["score"] is None and s["readable"] is False and s["score"] is None


def test_description_rules_for_a_connected_profile():
    b = make(gbp_location="locations/1", description="Call us at +91 98220 11111 for the best dentist, visit www.x.com", services=[{"name": "Root canal"}])
    sec = gbp_audit.description(b, None)
    by = {c["label"]: c["status"] for c in sec["checks"]}
    assert by["No links or phone numbers"] == "bad" and by["No promotional claims"] == "warn" and sec["status"] == "bad"
    assert any("[Add:" in (f["example"] or "") for f in sec["fixes"])  # a draft built only from the saved facts


def test_nap_checks_only_the_google_profile_and_never_the_website():
    b = make(website="")
    sec = gbp_audit.nap(b, {"title": b.name, "phone": "+91 98220 99999", "address": b.address, "website": None})
    by = {c["label"]: c["status"] for c in sec["checks"]}
    assert by["Phone: Google matches your project"] == "bad" and by["Website link on the profile"] == "bad"
    assert not any("website" in c["label"].lower() and "profile" not in c["label"].lower() for c in sec["checks"])
    assert not any(f.get("go") == "site" for f in sec["fixes"])


def test_geogrid_ignores_sample_scans_and_says_so():
    sec = gbp_audit.geogrid(make(), [SimpleNamespace(data_source="sample", keyword="dentist", grid_size=3, points=[], top3=0, found=0, avg_rank=None, competitors=[])])
    assert sec["readable"] is False and "sample" in sec["summary"].lower()


def test_geogrid_names_the_weak_side():
    pts = [{"x": x, "y": y, "rank": 2 if x == 0 else None} for x in range(3) for y in range(3)]
    s = SimpleNamespace(data_source="google", keyword="dentist pune", grid_size=3, points=pts, top3=3, found=3, avg_rank=2.0, competitors=[])
    sec = gbp_audit.geogrid(make(), [s])
    assert sec["readable"] and any("east" in f["what"] for f in sec["fixes"])


def test_the_audit_endpoint_returns_nine_parameters_and_leaves_unread_ones_out_of_the_score(client):
    r = client.post("/api/v1/businesses", json={"name": "Audit Dental", "primary_category": "Dentist", "city": "Pune", "website": ""})
    bid = r.json()["id"]
    out = client.get(f"/api/v1/businesses/{bid}/gbp-audit")
    assert out.status_code == 200
    d = out.json()
    assert [x["key"] for x in d["parameters"]] == ["categories", "name", "nap", "description", "services", "reviews", "photos", "visibility", "geogrid"]
    unread = {x["key"] for x in d["parameters"] if not x["readable"]}
    assert {"description", "services", "geogrid"} <= unread
    assert {x["label"] for x in d["not_read"]} >= {"Business description", "Products & services"}
    assert d["connected"] is False and (d["score"] is None or 0 <= d["score"] <= 100)


def test_every_fix_says_where_it_is_made_and_the_name_fix_carries_a_value(client):
    r = client.post("/api/v1/businesses", json={"name": "Best Dentist Pune Clinic", "primary_category": "Dentist", "city": "Pune", "website": ""})
    d = client.get(f"/api/v1/businesses/{r.json()['id']}/gbp-audit").json()
    fixes = [f for x in d["parameters"] for f in x["fixes"]]
    assert fixes and all(f["where"] and f["to"].startswith("/") for f in fixes)
    scan = next(f for f in fixes if "rank scan" in f["what"])
    assert scan["to"] == "/rank-tracking/geo"
    p = gbp_audit.name(make(name="Best Dentist in Pune"), {"title": "Best Dentist in Pune"})
    assert p["fixes"][0]["apply"]["name"] and "best" not in p["fixes"][0]["apply"]["name"].lower()


def test_the_audit_lists_each_problem_with_where_to_fix_it_and_what_you_gain(client):
    r = client.post("/api/v1/businesses", json={"name": "Best Dentist Pune Clinic", "primary_category": "Dentist", "city": "Pune", "website": ""})
    d = client.get(f"/api/v1/businesses/{r.json()['id']}/gbp-audit").json()
    assert d["problems"], "a profile with a stuffed name and no reviews has problems"
    assert all(q["severity"] in ("bad", "warn") and q["title"] and q["detail"] and q["gain"] and q["to"] for q in d["problems"])
    assert d["problems"][0]["severity"] == "bad"  # the most serious first
    assert any(q["key"] == "name" and "marketing" in q["title"].lower() for q in d["problems"])


def test_each_problem_comes_with_its_own_fix_and_good_checks_are_just_listed():
    b = make(gbp_location="locations/1", description="Call us at +91 98220 11111 for the best dentist", services=[{"name": "Root canal"}])
    sec = gbp_audit.description(b, None)
    by = {q["title"]: q for q in sec["issues"]}
    assert "No links or phone numbers" in by and "No promotional claims" in by
    assert any("Remove claims" in f["what"] for f in by["No promotional claims"]["fixes"])  # the promo fix sits under the promo problem
    assert "Written (400 to 750 characters)" in by and by["Written (400 to 750 characters)"]["fixes"]
    assert sec["passed"] and not any(t in sec["passed"] for t in by)


def test_the_city_check_ignores_hyphens_and_a_stuffed_name_fix_sits_under_its_problem():
    b = make(gbp_location="locations/1", city="Pimpri-Chinchwad", area="", description="We are a clinic in Pimpri Chinchwad. " * 14, services=[])
    by = {c["label"]: c["status"] for c in gbp_audit.description(b, None)["checks"]}
    assert by["Location named"] == "ok"
    sec = gbp_audit.name(make(name="Best Dentist in Pune"), {"title": "Best Dentist in Pune"})
    q = next(q for q in sec["issues"] if "marketing" in q["title"].lower())
    assert q["fixes"] and "Use:" in q["fixes"][0]["example"]


def test_each_parameter_lists_what_is_currently_on_the_profile():
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    rows = [SimpleNamespace(review_at=now - timedelta(days=d), review_date=None, reply_text="Thanks" if d % 2 else None, reply_status="posted", replied_at=now - timedelta(days=d - 1) if d % 2 else None, rating=5) for d in (3, 10, 40)]
    comps = [SimpleNamespace(rating=4.5, reviews=66)]
    b = make(gbp_location="locations/1", rating=4.7, review_count=31, photo_count=40, cover_photo="x", logo="y", description="We help clinics grow in Pune. " * 15,
             services=[{"name": "SEO", "description": "d" * 50}], secondary_categories=["Web Designer"])
    found = lambda sec: {f["label"]: f["value"] for f in sec["found"]}
    r = found(gbp_audit.reviews(b, None, rows, comps))
    assert r["Star rating"] == "4.7 stars" and r["Reviews in the last 90 days"] == 3 and r["Reviews with a reply"] == "1 of 3" and "66" in r["Competitors"]
    assert "We help clinics" in found(gbp_audit.description(b, None))["Description"]
    assert found(gbp_audit.services(b))["Services listed"].startswith("1: SEO")
    assert found(gbp_audit.photos(b, None))["Logo"] == "Set" and found(gbp_audit.categories(b, None, []))["Secondary categories"] == "Web Designer"


def test_category_and_services_that_use_the_same_word_in_another_form_match():
    b = make(gbp_location="locations/1", primary_category="Clothes market", services=[{"name": "rental cloths"}, {"name": "cloths on rent in wagholi"}])
    by = {c["label"]: c["status"] for c in gbp_audit.categories(b, None, [])["checks"]}
    assert by["Primary category matches your main services"] == "ok"
    far = make(gbp_location="locations/1", primary_category="Dentist", services=[{"name": "web design"}])
    q = next(q for q in gbp_audit.categories(far, None, [])["issues"] if q["title"].startswith("Primary category matches"))
    assert "Dentist" in q["detail"] and "web design" in q["detail"]


def test_improvement_ideas_are_shown_even_when_the_checks_pass_and_do_not_change_the_score():
    b = make(gbp_location="locations/1", primary_category="Clothes market", secondary_categories=["Clothing store"], area="Wagholi", city="Pune",
             services=[{"name": "rental cloths", "description": "x" * 50}, {"name": "cloths on rent in wagholi", "description": "y" * 50}], description="We rent clothes in Wagholi. " * 12)
    assert gbp_audit.description(b, None)["tips"]  # room left and no call to action
    assert gbp_audit.photos(make(gbp_location="locations/1", photo_count=150, logo="x", cover_photo="y"), None)["tips"]
    sec = gbp_audit.name(make(name="Smile Care Clinic"), {"title": "Smile Care Clinic"})
    assert sec["tips"] == [] and sec["score"] == 100


def test_a_category_that_leaves_out_what_most_services_are_about_is_a_problem_but_normal_services_are_not():
    b = make(gbp_location="locations/1", primary_category="Clothes market", secondary_categories=[], area="Wagholi", city="Pune",
             services=[{"name": "rental cloths"}, {"name": "cloths on rent in wagholi"}])
    sec = gbp_audit.categories(b, None, [])
    q = next(q for q in sec["issues"] if q["title"] == "Category says what most of your services are about")
    assert "Clothes market" in q["detail"] and "rent" in q["detail"] and q["fixes"][0]["impact"] == "high"
    sec_issue = next(q for q in sec["issues"] if q["title"].startswith("Secondary categories"))
    assert sec_issue["severity"] == "bad"  # none at all is a real gap
    dentist = make(gbp_location="locations/1", primary_category="Dentist", secondary_categories=["Dental clinic"], services=[{"name": "Root canal"}, {"name": "Teeth whitening"}])
    assert not any(q["title"].startswith("Category says") for q in gbp_audit.categories(dentist, None, [])["issues"])
