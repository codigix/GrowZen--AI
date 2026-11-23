"""Google Business Profile: every listing on a connected account with its live status, import, sync."""
from app.db import SessionLocal
from app.models import Business, GoogleConnection
from app.services import crypto, gbp

ACC = "accounts/111"


def location(n, **meta):
    return {"name": f"locations/{n}", "title": f"Clinic {n}", "storefrontAddress": {"addressLines": ["MG Road", "Aundh"], "locality": "Pune", "postalCode": "411007"},
            "categories": {"primaryCategory": {"name": "categories/gcid:dentist", "displayName": "Dentist"}}, "openInfo": {"status": meta.pop("open", "OPEN")},
            "metadata": {"placeId": f"place{n}", "mapsUri": f"https://maps.google.com/?cid={n}", "newReviewUri": f"https://g.page/r/{n}/review", **meta}}


ACTION_LINKS = [{"name": "locations/1/placeActionLinks/a1", "placeActionType": "APPOINTMENT", "uri": "https://saidental.in/old"}]
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
            return {"mediaItems": [{"name": f"accounts/111/locations/1/media/m{i}", "mediaFormat": "PHOTO", "googleUrl": f"https://lh3.google.com/{i}", "thumbnailUrl": f"https://lh3.google.com/t{i}",
                                    "createTime": "2026-10-01T00:00:00Z", "locationAssociation": {"category": "EXTERIOR"}, "insights": {"viewCount": str(i * 10)}} for i in range(7)], "totalMediaItemCount": 7}
        if "fetchMultiDailyMetricsTimeSeries" in url:
            return {}
        if "placeActionTypeMetadata" in url:
            return {"placeActionTypeMetadata": [{"placeActionType": k, "displayName": k.title()} for k in ("APPOINTMENT", "FOOD_ORDERING", "SHOP_ONLINE")]}
        if "placeActionLinks" in url and method == "GET":
            return {"placeActionLinks": ACTION_LINKS}
        raise AssertionError(f"unexpected Google call {url}")
    monkeypatch.setattr(gbp.GbpClient, "_req", req)


def connection():
    db = SessionLocal()
    c = db.query(GoogleConnection).filter_by(email="owner@saidental.in").first() or GoogleConnection(email="owner@saidental.in", display_name="Sai Owner")
    c.refresh_token_enc, c.status = crypto.seal("refresh-token"), "active"
    c.scopes = "openid email https://www.googleapis.com/auth/business.manage"  # the Business Profile permission: part of the access checklist
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


# Replying to a review from the software: it is posted to Google, and a refusal is reported instead of showing as posted.
def test_review_reply_goes_to_google_and_a_refusal_is_reported(client, monkeypatch):
    from app.models import Review
    fake_google(monkeypatch)
    cid = connection()
    bid = client.post(f"/api/v1/connections/{cid}/import", json={"locations": ["locations/1"]}).json()[0]["id"]
    db = SessionLocal()
    rid = db.query(Review).filter(Review.business_id == bid).first().id
    db.close()
    sent = []
    monkeypatch.setattr(gbp.GbpClient, "reply_review", lambda self, account, location, review_id, text: sent.append((account, location, review_id, text)))
    try:
        r = client.post(f"/api/v1/businesses/{bid}/reviews/{rid}/approve", json={"text": "Thank you!"})
        assert r.status_code == 200 and r.json()["task"]["result"]["posted"] is True and sent[0][3] == "Thank you!"

        def refuse(self, account, location, review_id, text):
            raise gbp.GbpError("Reviews API is not enabled")
        monkeypatch.setattr(gbp.GbpClient, "reply_review", refuse)
        r = client.post(f"/api/v1/businesses/{bid}/reviews/{rid}/approve", json={"text": "Second try"})
        assert r.status_code == 502 and "not enabled" in r.json()["detail"]
    finally:
        db = SessionLocal()
        db.query(Business).filter(Business.gbp_location == "locations/1").delete()
        db.commit()
        db.close()


def test_logo_and_cover_come_from_the_profile_photos():
    media = [{"type": "PHOTO", "category": "EXTERIOR", "url": "https://lh3/x"}, {"type": "VIDEO", "category": "PROFILE", "url": "https://lh3/v"},
             {"type": "PHOTO", "category": "PROFILE", "url": "https://lh3/logo"}, {"type": "PHOTO", "category": "COVER", "url": "https://lh3/cover"}]
    assert gbp.logo_and_cover(media) == ("https://lh3/logo", "https://lh3/cover")
    assert gbp.logo_and_cover([{"type": "PHOTO", "category": "EXTERIOR", "url": "https://lh3/x"}]) == (None, None)


def test_a_deleted_photo_is_removed_from_google_and_from_the_page(client, monkeypatch):
    fake_google(monkeypatch)
    cid = connection()
    bid = client.post(f"/api/v1/connections/{cid}/import", json={"locations": ["locations/1"]}).json()[0]["id"]
    gone: list[str] = []
    monkeypatch.setattr(gbp.GbpClient, "delete_media", lambda self, name: gone.append(name))
    try:
        media = client.get(f"/api/v1/businesses/{bid}/gbp/live").json()["live"]["media"]
        assert media
        name = media[0]["id"]
        r = client.delete(f"/api/v1/businesses/{bid}/gbp/media", params={"name": name})
        assert r.status_code == 204 and gone == [name]
        after = client.get(f"/api/v1/businesses/{bid}/gbp/live").json()
        assert name not in [m["id"] for m in after["live"]["media"]] and len(after["live"]["media"]) == len(media) - 1
        assert client.delete(f"/api/v1/businesses/{bid}/gbp/media", params={"name": "accounts/999/locations/9/media/x"}).status_code == 400
    finally:
        db = SessionLocal()
        db.query(Business).filter(Business.gbp_location == "locations/1").delete()
        db.commit()
        db.close()


def test_an_imported_client_gets_the_plans_recurring_jobs(client, monkeypatch):
    fake_google(monkeypatch)
    cid = connection()
    bid = client.post(f"/api/v1/connections/{cid}/import", json={"locations": ["locations/1"]}).json()[0]["id"]
    try:
        from app.models import Schedule
        db = SessionLocal()  # read the table itself: listing the schedules would create them on demand and hide a missing import step
        jobs = {r.job: r.every for r in db.query(Schedule).filter(Schedule.business_id == bid)}
        db.close()
        assert jobs["reviews"] == "daily" and jobs["posts"] == "weekly" and jobs["report"] == "monthly"
    finally:
        db = SessionLocal()
        db.query(Business).filter(Business.gbp_location == "locations/1").delete()
        db.commit()
        db.close()


def test_phones_and_booking_links_are_written_to_google_and_read_back(client, monkeypatch):
    fake_google(monkeypatch)
    cid = connection()
    bid = client.post(f"/api/v1/connections/{cid}/import", json={"locations": ["locations/1"]}).json()[0]["id"]
    try:
        # Sync reads Google's booking link back onto the project
        assert client.post(f"/api/v1/businesses/{bid}/sync").status_code == 200
        got = client.get(f"/api/v1/businesses/{bid}").json()
        assert got["booking_url"] == "https://saidental.in/old" and got["action_links"] == [{"type": "APPOINTMENT", "url": "https://saidental.in/old"}]
        sent = []
        base = gbp.GbpClient._req

        def req(self, method, url, **kw):
            if method in ("PATCH", "POST", "PUT", "DELETE") and "/revoke" not in url:
                sent.append((method, url.split("/v1/")[-1], kw.get("params"), kw.get("json")))
                return {}
            return base(self, method, url, **kw)
        monkeypatch.setattr(gbp.GbpClient, "_req", req)
        out = client.patch(f"/api/v1/businesses/{bid}", json={"phone": "+91 99999 00000", "additional_phones": ["+91 88888 00000", "020 2555 0100"],
                                                              "booking_url": "https://saidental.in/book", "action_links": [{"type": "FOOD_ORDERING", "url": "https://saidental.in/order"}]}).json()
        assert set(out["pushed_to_google"]) >= {"phoneNumbers", "placeActionLinks"}
        loc = next(x for x in sent if x[1] == "locations/1")
        assert loc[3]["phoneNumbers"] == {"primaryPhone": "+91 99999 00000", "additionalPhones": ["+91 88888 00000", "020 2555 0100"]}
        assert ("PATCH", "locations/1/placeActionLinks/a1", {"updateMask": "uri"}, {"uri": "https://saidental.in/book"}) in sent  # the changed booking link is edited in place
        assert any(x[0] == "POST" and x[3] == {"placeActionType": "FOOD_ORDERING", "uri": "https://saidental.in/order"} for x in sent)  # the new order link is created
        # Removing the booking link removes the button; the other link stays
        sent.clear()
        out = client.patch(f"/api/v1/businesses/{bid}", json={"booking_url": ""}).json()
        assert out["booking_url"] is None and [x["type"] for x in out["action_links"]] == ["FOOD_ORDERING"]
        assert ("DELETE", "locations/1/placeActionLinks/a1", None, None) in sent
        # Saving something else does not touch the Book / Order buttons on Google
        sent.clear()
        assert client.patch(f"/api/v1/businesses/{bid}", json={"description": "Hello", "booking_url": "", "action_links": [{"type": "FOOD_ORDERING", "url": "https://saidental.in/order"}]}).status_code == 200
        assert not any("placeActionLinks" in x[1] for x in sent)
        # Bad input is refused before anything is sent
        sent.clear()
        assert client.patch(f"/api/v1/businesses/{bid}", json={"phone": "abc"}).status_code == 422
        assert client.patch(f"/api/v1/businesses/{bid}", json={"additional_phones": ["1111111", "2222222", "3333333"]}).status_code == 422
        assert client.patch(f"/api/v1/businesses/{bid}", json={"booking_url": "not a link"}).status_code == 422
        assert client.patch(f"/api/v1/businesses/{bid}", json={"phone": "+91 99999 00000", "additional_phones": ["+91 99999 00000"]}).status_code == 422
        assert sent == []
    finally:
        db = SessionLocal()
        db.query(Business).filter(Business.gbp_location == "locations/1").delete()
        db.commit()
        db.close()


def test_a_booking_link_google_refuses_is_still_saved_here_with_the_reason(client, monkeypatch):
    fake_google(monkeypatch)
    cid = connection()
    bid = client.post(f"/api/v1/connections/{cid}/import", json={"locations": ["locations/1"]}).json()[0]["id"]
    try:
        assert client.post(f"/api/v1/businesses/{bid}/sync").status_code == 200
        base = gbp.GbpClient._req

        def req(self, method, url, **kw):
            if "placeActionLinks" in url and method in ("POST", "PATCH", "DELETE"):
                raise gbp.GbpError("Google API 400: Request contains an invalid argument.")
            if method in ("PATCH", "POST", "PUT", "DELETE") and "/revoke" not in url:
                return {}
            return base(self, method, url, **kw)
        monkeypatch.setattr(gbp.GbpClient, "_req", req)
        out = client.patch(f"/api/v1/businesses/{bid}", json={"booking_url": "https://saidental.in/book-here"}).json()
        assert out["booking_url"] == "https://saidental.in/book-here"  # kept: it is the owner's link
        assert "Google did not accept it" in out["action_links_error"]
        got = client.get(f"/api/v1/businesses/{bid}").json()
        assert got["booking_url"] == "https://saidental.in/book-here" and "not_on_google" in "".join(got["gbp_status"]) or "booking_not_on_google" in got["gbp_status"]
    finally:
        db = SessionLocal()
        db.query(Business).filter(Business.gbp_location == "locations/1").delete()
        db.commit()
        db.close()


def test_the_buttons_google_offers_this_listing_are_listed(client, monkeypatch):
    fake_google(monkeypatch)
    cid = connection()
    bid = client.post(f"/api/v1/connections/{cid}/import", json={"locations": ["locations/1"]}).json()[0]["id"]
    try:
        r = client.get(f"/api/v1/businesses/{bid}/gbp/action-types")
        assert r.status_code == 200 and r.json()["known"] is True
        assert {x["type"] for x in r.json()["offered"]} == {"APPOINTMENT", "FOOD_ORDERING", "SHOP_ONLINE"}
    finally:
        db = SessionLocal()
        db.query(Business).filter(Business.gbp_location == "locations/1").delete()
        db.commit()
        db.close()


def test_performance_gives_each_number_with_its_change_and_a_value_for_every_day(client, monkeypatch):
    from datetime import date, timedelta
    from app.models import InsightDay
    fake_google(monkeypatch)
    cid = connection()
    bid = client.post(f"/api/v1/connections/{cid}/import", json={"locations": ["locations/1"]}).json()[0]["id"]
    db = SessionLocal()
    try:
        end = date.today() - timedelta(days=2)
        for i in range(60):  # the last 28 days: 10 search views and 1 call a day; the 28 before: 5 and 1 a day
            day = end - timedelta(days=i)
            recent = i < 28
            db.merge(InsightDay(business_id=bid, day=day, views_search=10 if recent else 5, views_maps=2, website_clicks=1, calls=1 if i % 2 == 0 else 0, directions=0, bookings=0))
        db.commit()
        out = client.get(f"/api/v1/businesses/{bid}/gbp/performance?days=28").json()
        assert out["has_data"] and out["has_previous"] and out["end"] == end.isoformat() and len(out["days_dates"]) == 28
        by = {m["key"]: m for m in out["metrics"]}
        assert by["views_search"]["total"] == 280 and by["views_search"]["previous"] == 140 and by["views_search"]["change_pct"] == 100.0
        assert len(by["views_search"]["series"]) == 28 and by["views_search"]["best_day"]["value"] == 10
        assert by["views_maps"]["change_pct"] == 0.0 and by["views"]["total"] == 280 + 56 and by["interactions"]["total"] == 28 + 14
        assert by["bookings"]["total"] == 0 and by["bookings"]["change_pct"] is None and by["bookings"]["best_day"] is None  # nothing in either period: no change to state
    finally:
        db.query(InsightDay).filter(InsightDay.business_id == bid).delete()
        db.query(Business).filter(Business.gbp_location == "locations/1").delete()
        db.commit()
        db.close()


def test_google_404_pages_are_not_shown_as_markup_and_say_what_it_means():
    msg = gbp.explain_google_error(404, "", "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/reviews/places/x/reply")
    assert "<" not in msg and "does not have this review" in msg
    assert "<" not in gbp.explain_google_error(404, "", "https://mybusinessplaceactions.googleapis.com/v1/x")


def test_a_review_from_the_public_listing_gets_the_business_profile_id_before_a_reply(client, monkeypatch):
    from app.models import Review
    from app.services import agent
    fake_google(monkeypatch)
    cid = connection()
    bid = client.post(f"/api/v1/connections/{cid}/import", json={"locations": ["locations/1"]}).json()[0]["id"]
    db = SessionLocal()
    try:
        r = Review(business_id=bid, external_id="places/ChIJx/reviews/abc", author="Nitin Kamble", rating=5, body="Good service", reply_status="none")
        db.add(r)
        db.commit()
        sent = []
        base = gbp.GbpClient._req

        def req(self, method, url, **kw):
            if url.endswith("/reviews") and method == "GET":  # the Business Profile does not list it yet
                return {}
            if method == "PUT":
                sent.append(url)
                return {}
            return base(self, method, url, **kw)
        monkeypatch.setattr(gbp.GbpClient, "_req", req)
        b = db.get(Business, bid)
        task = agent._task(db, b, "review", "review_reply", "Reply", "Medium", review_id=r.id, rating=5, text="Thank you")
        db.commit()
        agent.decide(db, task, True, "tester")
        assert task.status == "failed" and task.result["error"].startswith("This review is only on the public Google Maps listing") and sent == []  # Google is never asked with an id it cannot know
        # once the Business Profile lists it, the reply goes under its own id
        monkeypatch.setattr(gbp.GbpClient, "_req", lambda self, method, url, **kw: ({"reviews": [{"reviewId": "BP123", "reviewer": {"displayName": "Nitin Kamble"}, "comment": "Good service"}]} if url.endswith("/reviews") and method == "GET" else (sent.append(url) or {}) if method == "PUT" else base(self, method, url, **kw)))
        task2 = agent._task(db, b, "review", "review_reply", "Reply", "Medium", review_id=r.id, rating=5, text="Thank you")
        db.commit()
        agent.decide(db, task2, True, "tester")
        assert task2.status != "failed" and sent and sent[0].endswith("/reviews/BP123/reply") and db.get(Review, r.id).external_id == "BP123"
    finally:
        db.query(Review).filter(Review.business_id == bid).delete()
        db.query(Business).filter(Business.gbp_location == "locations/1").delete()
        db.commit()
        db.close()


def test_a_saved_public_review_takes_the_business_profile_id_and_one_google_no_longer_lists_is_marked_gone(client, monkeypatch):
    from datetime import date
    from app.models import Review
    fake_google(monkeypatch)
    cid = connection()
    bid = client.post(f"/api/v1/connections/{cid}/import", json={"locations": ["locations/1"]}).json()[0]["id"]
    db = SessionLocal()
    try:
        db.add_all([Review(business_id=bid, external_id="places/p/reviews/a", author="Great", rating=5, body="Great", review_date=date(2026, 10, 1), reply_status="none"),
                    Review(business_id=bid, external_id="places/p/reviews/b", author="Vanished", rating=5, body="Was here", review_date=date(2026, 10, 2), reply_status="none")])
        db.commit()
        # the fake Google lists one review ("Great") for locations/1
        monkeypatch.setattr(gbp.GbpClient, "reviews", lambda self, account, location: [{"reviewId": "BP1", "reviewer": {"displayName": "Great"}, "starRating": "FIVE", "comment": "Great", "createTime": "2026-10-01T10:00:00Z"}])
        assert client.post(f"/api/v1/businesses/{bid}/sync").status_code == 200
        db.expire_all()
        rows = {r.author: r for r in db.query(Review).filter(Review.business_id == bid) if r.author}  # (the import's own fake review has no author)
        assert len(rows) == 2 and rows["Great"].external_id == "BP1" and rows["Great"].gone_at is None  # the public copy became the Business Profile's review: not a duplicate
        assert rows["Vanished"].gone_at is not None
        out = client.get(f"/api/v1/businesses/{bid}/reviews").json()
        named = [r for r in out["reviews"] if r["author"]]
        assert out["summary"]["count"] == 1 and out["summary"]["avg_rating"] == 5.0 and out["summary"]["not_on_google"] >= 1
        assert [r["gone_at"] is not None for r in named] == [False, True]  # the live one first, the gone one last and flagged
    finally:
        db.query(Review).filter(Review.business_id == bid).delete()
        db.query(Business).filter(Business.gbp_location == "locations/1").delete()
        db.commit()
        db.close()


def test_a_reply_is_read_back_from_the_business_profile_after_it_is_sent():
    class C:
        def __init__(self, reviews):
            self.r = reviews

        def reviews(self, account, location):
            if self.r is None:
                raise gbp.GbpError("down")
            return self.r
    with_reply = [{"reviewId": "R1", "reviewReply": {"comment": "Thank you"}}]
    assert gbp.reply_confirmed(C(with_reply), "a", "l", "R1") is True
    assert gbp.reply_confirmed(C([{"reviewId": "R1"}]), "a", "l", "R1") is False  # sent, but Google does not show it on the review
    assert gbp.reply_confirmed(C(with_reply), "a", "l", "R2") is False
    assert gbp.reply_confirmed(C(None), "a", "l", "R1") is None  # could not read Google just now: not a failure of the reply
