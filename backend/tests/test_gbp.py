"""Google Business Profile: every listing on a connected account with its live status, import, sync."""
from app.db import SessionLocal
from app.models import Business, GoogleConnection
from app.services import crypto, gbp

ACC = "accounts/111"


def location(n, **meta):
    return {"name": f"locations/{n}", "title": f"Clinic {n}", "storefrontAddress": {"addressLines": ["MG Road", "Aundh"], "locality": "Pune", "postalCode": "411007"},
            "categories": {"primaryCategory": {"name": "categories/gcid:dentist", "displayName": "Dentist"}}, "openInfo": {"status": meta.pop("open", "OPEN")},
            "metadata": {"placeId": f"place{n}", "mapsUri": f"https://maps.google.com/?cid={n}", "newReviewUri": f"https://g.page/r/{n}/review", **meta}}


LOCATIONS = [location(1, hasVoiceOfMerchant=True), location(2), location(3, open="CLOSED_TEMPORARILY", hasPendingEdits=True), location(4, duplicateLocation=True)]
VOM = {"locations/1": {"hasVoiceOfMerchant": True, "hasBusinessAuthority": True},
       "locations/2": {"verify": {"hasPendingVerification": True}},
       "locations/3": {"complyWithGuidelines": {"recommendationReason": "BUSINESS_LOCATION_SUSPENDED"}},
       "locations/4": {"resolveOwnershipConflict": {}}}


def fake_google(monkeypatch, vom_enabled=True):
    def req(self, method, url, **kw):
        if url.endswith("/accounts"):
            return {"accounts": [{"name": ACC, "accountName": "Sai Dental Group", "type": "LOCATION_GROUP", "role": "OWNER"}]}
        if url.endswith(f"{ACC}/locations"):
            return {"locations": LOCATIONS}
        if url.endswith("/VoiceOfMerchantState"):
            if not vom_enabled:
                raise gbp.GbpError("My Business Verifications API is not enabled")
            return VOM[url.split("v1/")[1].replace("/VoiceOfMerchantState", "")]
        if url.endswith("/attributes"):
            return {"attributes": [{"name": "locations/1/attributes/has_wheelchair_accessible_entrance", "valueType": "BOOL", "values": [True]}]}
        if url.endswith("/localPosts"):
            return {"localPosts": [{"name": f"{ACC}/locations/1/localPosts/p1", "topicType": "STANDARD", "state": "LIVE", "summary": "Free check-up week", "createTime": "2026-10-20T09:00:00Z",
                                    "searchUrl": "https://g.co/p1", "callToAction": {"actionType": "BOOK", "url": "https://saidental.in/book"}}]}
        if "searchkeywords" in url:
            return {"searchKeywordsCounts": [{"searchKeyword": "dentist near me", "insightsValue": {"value": "120"}}, {"searchKeyword": "root canal pune", "insightsValue": {"threshold": "15"}}]}
        if "/locations/" in url and url.startswith(gbp.INFO):
            return next(l for l in LOCATIONS if url.endswith(l["name"]))
        if url.endswith("/reviews"):
            return {"reviews": [{"reviewId": "r1", "starRating": "FIVE", "comment": "Great", "createTime": "2026-10-01T10:00:00Z"}]}
        if url.endswith("/media"):
            return {"mediaItems": [{"name": f"m{i}", "mediaFormat": "PHOTO", "googleUrl": f"https://lh3.google.com/{i}", "thumbnailUrl": f"https://lh3.google.com/t{i}",
                                    "createTime": "2026-10-01T00:00:00Z", "locationAssociation": {"category": "EXTERIOR"}, "insights": {"viewCount": str(i * 10)}} for i in range(7)], "totalMediaItemCount": 7}
        if "fetchMultiDailyMetricsTimeSeries" in url:
            return {}
        raise AssertionError(f"unexpected Google call {url}")
    monkeypatch.setattr(gbp.GbpClient, "_req", req)


def connection():
    db = SessionLocal()
    c = db.query(GoogleConnection).filter_by(email="owner@saidental.in").first() or GoogleConnection(email="owner@saidental.in", display_name="Sai Owner")
    c.refresh_token_enc, c.status = crypto.seal("refresh-token"), "active"
    db.add(c)
    db.commit()
    cid = c.id
    db.close()
    return cid


def test_verification_states():
    assert gbp.verification_state({"hasVoiceOfMerchant": True}, {}) == "verified"
    assert gbp.verification_state({"waitForVoiceOfMerchant": {}}, {}) == "pending"
    assert gbp.verification_state({"verify": {"hasPendingVerification": True}}, {}) == "pending"
    assert gbp.verification_state({"verify": {}}, {}) == "unverified"
    assert gbp.verification_state({"complyWithGuidelines": {"recommendationReason": "BUSINESS_LOCATION_SUSPENDED"}}, {}) == "suspended"
    assert gbp.verification_state({"complyWithGuidelines": {"recommendationReason": "BUSINESS_LOCATION_DISABLED"}}, {}) == "disabled"
    assert gbp.verification_state({"resolveOwnershipConflict": {}}, {}) == "conflict"
    # Without the Verifications API: only what the location metadata says.
    assert gbp.verification_state(None, {"hasVoiceOfMerchant": True}) == "verified" and gbp.verification_state(None, {}) == "unverified"


def test_every_listing_with_its_status(client, monkeypatch):
    fake_google(monkeypatch)
    cid = connection()
    found = client.get(f"/api/v1/connections/{cid}/locations").json()
    by = {l["gbp_location"]: l for l in found}
    assert [by[f"locations/{n}"]["verification"] for n in range(1, 5)] == ["verified", "pending", "suspended", "conflict"]
    s3 = by["locations/3"]["gbp_status"]
    assert s3["open_status"] == "closed_temporarily" and s3["pending_edits"] and s3["verification_source"] == "google"
    s1 = by["locations/1"]["gbp_status"]
    assert s1["account_name"] == "Sai Dental Group" and s1["account_role"] == "OWNER" and s1["maps_url"].endswith("cid=1") and s1["review_url"]
    assert by["locations/4"]["duplicate_listing"] and not any(l["imported"] for l in found)


def test_listing_status_without_verifications_api(client, monkeypatch):
    fake_google(monkeypatch, vom_enabled=False)
    found = client.get(f"/api/v1/connections/{connection()}/locations").json()
    by = {l["gbp_location"]: l for l in found}
    assert by["locations/1"]["verification"] == "verified" and by["locations/2"]["verification"] == "unverified"
    assert by["locations/1"]["gbp_status"]["verification_source"] == "metadata"


def test_import_and_sync_keep_the_status(client, monkeypatch):
    fake_google(monkeypatch)
    cid = connection()
    out = client.post(f"/api/v1/connections/{cid}/import", json={"locations": ["locations/1"]}).json()
    bid = out[0]["id"]
    b = client.get(f"/api/v1/businesses/{bid}").json()
    assert b["verification"] == "verified" and b["gbp_status"]["open_status"] == "open" and b["review_count"] == 1 and b["photo_count"] == 7
    # Everything else Google holds is read live too: photos, posts, attributes and the searches that found it.
    live = b["gbp_status"]["live"]
    assert len(live["media"]) == 7 and live["media"][3]["views"] == 30 and live["media"][0]["category"] == "EXTERIOR"
    assert live["posts"][0]["summary"] == "Free check-up week" and live["posts"][0]["cta"] == "BOOK"
    assert live["attributes"][0]["id"] == "has_wheelchair_accessible_entrance"
    assert live["search_keywords"][0] == {"keyword": "dentist near me", "impressions": 120, "below": None} and live["search_keywords"][1]["below"] == 15
    assert live["errors"] == {} and live["synced_at"]
    # One call gives the page everything, project by project.
    page = client.get(f"/api/v1/businesses/{bid}/gbp/live").json()
    assert page["linked"] and page["connection"]["email"] == "owner@saidental.in" and page["profile"]["primary_category"] == "Dentist"
    assert page["metrics"]["review_count"] == 1 and page["metrics"]["photo_count"] == 7 and page["recent_reviews"][0]["author"] is None or page["recent_reviews"]
    assert page["rating_split"]["5"] == 1 and page["live"]["posts"] and "live" not in page["status"]
    listed = {l["gbp_location"]: l for l in client.get(f"/api/v1/connections/{cid}/locations").json()}
    assert listed["locations/1"]["imported"] and listed["locations/1"]["business_id"] == bid

    # Google suspends it: the next sync picks that up.
    VOM["locations/1"] = {"complyWithGuidelines": {"recommendationReason": "BUSINESS_LOCATION_SUSPENDED"}}
    try:
        r = client.post(f"/api/v1/businesses/{bid}/sync").json()
        assert r["verification"] == "suspended"
        b = client.get(f"/api/v1/businesses/{bid}").json()
        assert b["verification"] == "suspended" and b["gbp_status"]["account_name"] == "Sai Dental Group"
        assert any("suspended" in a["text"].lower() for a in client.get(f"/api/v1/businesses/{bid}/gbp/score").json()["alerts"])
    finally:
        VOM["locations/1"] = {"hasVoiceOfMerchant": True}
        db = SessionLocal()
        db.query(Business).filter(Business.gbp_location == "locations/1").delete()
        db.commit()
        db.close()


# Email only (no Google sign-in): public listings on Google Maps and their public status.
def _place(pid, name, website, status="OPERATIONAL"):
    return {"id": pid, "displayName": {"text": name}, "formattedAddress": "MG Road, Aundh, Pune, Maharashtra 411007, India", "websiteUri": website,
            "rating": 4.6, "userRatingCount": 128, "primaryTypeDisplayName": {"text": "Dentist"}, "location": {"latitude": 18.56, "longitude": 73.81},
            "googleMapsUri": f"https://maps.google.com/?cid={pid}", "businessStatus": status, "photos": [{}, {}, {}]}


def test_find_by_email_lists_branches_with_public_status(client, monkeypatch):
    from app.config import get_settings
    from app.services import discovery
    monkeypatch.setattr(get_settings(), "google_places_api_key", "test-key")
    monkeypatch.setattr(discovery, "read_website", lambda domain: {"name": "Smile Studio", "city": "Pune", "website": f"https://{domain}"})
    places = {"Smile Studio Pune": [_place("p1", "Smile Studio", "https://smilestudio.in/")],
              "Smile Studio": [_place("p1", "Smile Studio", "https://smilestudio.in/"), _place("p2", "Smile Studio Baner", "https://smilestudio.in/baner", "CLOSED_TEMPORARILY"),
                               _place("p3", "Happy Teeth", "https://happyteeth.in/")]}
    monkeypatch.setattr(discovery, "_places_post", lambda q, limit=5, country=None: places.get(q, []))
    monkeypatch.setattr(discovery, "place_details", lambda pid, session_token="": _place(pid, "Smile Studio", "https://smilestudio.in/"))
    monkeypatch.setattr("app.routers.discover._onboard", lambda db, business_id: None)

    found = client.post("/api/v1/discover", json={"email": "hello@smilestudio.in"}).json()
    maps = [c for c in found["candidates"] if c["source"] == "google_maps"]
    assert [c["place_id"] for c in maps] == ["p1", "p2"]  # both branches, not the unrelated "Happy Teeth"
    assert all(c["confidence"] == "high" for c in maps) and maps[1]["open_status"] == "closed_temporarily"
    assert maps[0]["review_url"].endswith("placeid=p1") and maps[0]["business_id"] is None

    b = client.post("/api/v1/discover/import", json={"email": "hello@smilestudio.in", "candidate": maps[0]}).json()
    assert b["gbp_status"]["source"] == "maps" and b["gbp_status"]["open_status"] == "open" and b["gbp_status"]["live_on_maps"]
    again = client.post("/api/v1/discover", json={"email": "hello@smilestudio.in"}).json()
    assert next(c for c in again["candidates"] if c.get("place_id") == "p1")["business_id"] == b["id"]

    # Refresh the public status later: Google now shows it as temporarily closed.
    monkeypatch.setattr(discovery, "place_details", lambda pid, session_token="": _place(pid, "Smile Studio", "https://smilestudio.in/", "CLOSED_TEMPORARILY") | {"userRatingCount": 131})
    r = client.post(f"/api/v1/businesses/{b['id']}/maps-refresh").json()
    assert r["open_status"] == "closed_temporarily" and r["review_count"] == 131
    after = client.get(f"/api/v1/businesses/{b['id']}").json()
    assert after["review_count"] == 131 and after["gbp_status"]["open_status"] == "closed_temporarily"
    assert any("temporarily closed" in a["text"] for a in client.get(f"/api/v1/businesses/{b['id']}/gbp/score").json()["alerts"])
    no_place = client.post("/api/v1/businesses", json={"name": "No Listing Yet"}).json()["id"]
    assert client.post(f"/api/v1/businesses/{no_place}/maps-refresh").status_code == 400


def test_a_part_google_refuses_does_not_stop_the_rest(client, monkeypatch):
    fake_google(monkeypatch)
    original = gbp.GbpClient._req

    def req(self, method, url, **kw):
        if url.endswith("/localPosts"):
            raise gbp.GbpError("Google has not approved access for posts")
        return original(self, method, url, **kw)
    monkeypatch.setattr(gbp.GbpClient, "_req", req)
    cid = connection()
    try:
        bid = client.post(f"/api/v1/connections/{cid}/import", json={"locations": ["locations/1"]}).json()[0]["id"]
        live = client.get(f"/api/v1/businesses/{bid}").json()["gbp_status"]["live"]
        assert live["posts"] == [] and "approved" in live["errors"]["posts"]
        assert len(live["media"]) == 7 and live["search_keywords"]
    finally:
        db = SessionLocal()
        db.query(Business).filter(Business.gbp_location == "locations/1").delete()
        db.commit()
        db.close()


# Writes: whatever is changed in the software is sent to Google, and a refusal from Google saves nothing.
def test_changes_are_written_to_google(client, monkeypatch):
    fake_google(monkeypatch)
    cid = connection()
    bid = client.post(f"/api/v1/connections/{cid}/import", json={"locations": ["locations/1"]}).json()[0]["id"]
    sent = []
    base = gbp.GbpClient._req

    def req(self, method, url, **kw):
        if method in ("PATCH", "POST", "PUT", "DELETE") and "/revoke" not in url:
            sent.append((method, url.split("/v1/")[-1].split("/v4/")[-1], kw.get("params"), kw.get("json")))
            return {"name": "accounts/111/locations/1/media/m1", "googleUrl": "https://lh3/x"}
        return base(self, method, url, **kw)
    monkeypatch.setattr(gbp.GbpClient, "_req", req)
    try:
        out = client.patch(f"/api/v1/businesses/{bid}", json={"phone": "+91 99999 00000", "description": "New text", "services": [{"name": "Crown", "price": "1500"}]}).json()
        assert set(out["pushed_to_google"]) >= {"phoneNumbers", "profile", "serviceItems"}
        m, url, params, body = sent[-1]
        assert m == "PATCH" and url == "locations/1" and "profile.description" in params["updateMask"] and body["phoneNumbers"]["primaryPhone"] == "+91 99999 00000"
        assert client.put(f"/api/v1/businesses/{bid}/gbp/categories", json={"primary": {"name": "categories/gcid:dentist", "displayName": "Dentist"}}).status_code == 200
        assert sent[-1][3]["categories"]["primaryCategory"]["name"] == "categories/gcid:dentist"
        assert client.put(f"/api/v1/businesses/{bid}/gbp/address", json={"address_lines": ["12 MG Road"], "locality": "Pune", "region_code": "IN"}).status_code == 200
        assert client.put(f"/api/v1/businesses/{bid}/gbp/attributes", json={"values": {"has_wheelchair_accessible_entrance": True}}).status_code == 200
        assert sent[-1][2]["attributeMask"] == "attributes/has_wheelchair_accessible_entrance"
        r = client.post(f"/api/v1/businesses/{bid}/gbp/media", json={"category": "EXTERIOR", "url": "https://example.com/a.jpg"})
        assert r.status_code == 201 and sent[-1][3]["locationAssociation"]["category"] == "EXTERIOR"
        assert client.post(f"/api/v1/businesses/{bid}/gbp/media", json={"category": "NOPE"}).status_code == 400
        assert client.delete(f"/api/v1/businesses/{bid}/gbp/media", params={"name": "accounts/999/locations/9/media/x"}).status_code == 400
        # Google refuses: the app keeps its old value.
        def refuse(self, method, url, **kw):
            if method == "PATCH":
                raise gbp.GbpError("nope")
            return base(self, method, url, **kw)
        monkeypatch.setattr(gbp.GbpClient, "_req", refuse)
        r = client.patch(f"/api/v1/businesses/{bid}", json={"description": "Refused text"})
        assert r.status_code == 502 and client.get(f"/api/v1/businesses/{bid}").json()["description"] == "New text"
    finally:
        db = SessionLocal()
        db.query(Business).filter(Business.gbp_location == "locations/1").delete()
        db.commit()
        db.close()
