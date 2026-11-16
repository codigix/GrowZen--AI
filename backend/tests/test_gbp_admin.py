"""Verification, profile managers and deleting the profile on Google (Google stubbed)."""
from app.db import SessionLocal
from app.models import Business
from app.services import gbp
from test_gbp import connection, fake_google

ADMINS = [{"name": "locations/1/admins/a1", "admin": "boss@x.in", "role": "PRIMARY_OWNER"},
          {"name": "locations/1/admins/a2", "admin": "owner@saidental.in", "role": "OWNER"},
          {"name": "locations/1/admins/a3", "admin": "helper@x.in", "role": "MANAGER", "pendingInvitation": True}]


def test_verification_managers_and_delete(client, monkeypatch):
    fake_google(monkeypatch)
    cid = connection()
    bid = client.post(f"/api/v1/connections/{cid}/import", json={"locations": ["locations/1"]}).json()[0]["id"]
    sent = []
    base = gbp.GbpClient._req

    def req(self, method, url, **kw):
        tail = url.split("/v1/")[-1]
        if tail.endswith(":fetchVerificationOptions"):
            return {"options": [{"verificationMethod": "EMAIL", "emailData": {"domainName": "x.in", "user": "info"}}, {"verificationMethod": "PHONE_CALL", "phoneNumber": "+91 99999 00000"}]}
        if tail.endswith("/verifications") and method == "GET":
            return {"verifications": [{"name": "locations/1/verifications/v1", "method": "EMAIL", "state": "PENDING"}]}
        if tail.endswith(":verify"):
            sent.append((method, tail, kw.get("json")))
            return {"verification": {"name": "locations/1/verifications/v2", "method": kw["json"]["method"], "state": "PENDING"}}
        if tail.endswith(":complete"):
            sent.append((method, tail, kw.get("json")))
            if kw["json"]["pin"] == "000000":
                raise gbp.GbpError("The code is wrong")
            return {"verification": {"name": tail[:-9], "state": "COMPLETED"}}
        if tail.endswith("/admins") and method == "GET":
            return {"admins": ADMINS}
        if tail.endswith("/admins") and method == "POST":
            sent.append((method, tail, kw.get("json")))
            return {"name": "locations/1/admins/a9", "admin": kw["json"]["admin"], "role": kw["json"]["role"], "pendingInvitation": True}
        if method == "DELETE":
            sent.append((method, tail, None))
            return {}
        return base(self, method, url, **kw)
    monkeypatch.setattr(gbp.GbpClient, "_req", req)
    try:
        v = client.get(f"/api/v1/businesses/{bid}/gbp/verification").json()
        assert [o["verificationMethod"] for o in v["options"]] == ["EMAIL", "PHONE_CALL"] and v["history"][0]["state"] == "PENDING"
        assert client.post(f"/api/v1/businesses/{bid}/gbp/verification/start", json={"method": "NOPE"}).status_code == 400
        assert client.post(f"/api/v1/businesses/{bid}/gbp/verification/start", json={"method": "EMAIL"}).status_code == 400
        r = client.post(f"/api/v1/businesses/{bid}/gbp/verification/start", json={"method": "EMAIL", "email": "info@x.in"})
        assert r.status_code == 200 and sent[-1][2] == {"method": "EMAIL", "languageCode": "en", "emailAddress": "info@x.in"}
        bad = client.post(f"/api/v1/businesses/{bid}/gbp/verification/complete", json={"verification_id": "v2", "pin": "000000"})
        assert bad.status_code == 502 and "wrong" in bad.json()["detail"]
        assert client.post(f"/api/v1/businesses/{bid}/gbp/verification/complete", json={"verification_id": "locations/9/verifications/x", "pin": "123456"}).status_code == 400
        ok = client.post(f"/api/v1/businesses/{bid}/gbp/verification/complete", json={"verification_id": "v2", "pin": "123456"})
        assert ok.status_code == 200 and client.get(f"/api/v1/businesses/{bid}").json()["verification"] == "verified"

        m = client.get(f"/api/v1/businesses/{bid}/gbp/managers").json()
        assert {x["email"]: x["removable"] for x in m} == {"boss@x.in": False, "owner@saidental.in": False, "helper@x.in": True}  # primary owner and the connected account are protected
        assert m[2]["pending"] is True
        assert client.post(f"/api/v1/businesses/{bid}/gbp/managers", json={"email": "new@x.in", "role": "ADMIN"}).status_code == 422
        a = client.post(f"/api/v1/businesses/{bid}/gbp/managers", json={"email": "New@X.in", "role": "MANAGER"})
        assert a.status_code == 201 and sent[-1][2] == {"admin": "new@x.in", "role": "MANAGER"}
        assert client.delete(f"/api/v1/businesses/{bid}/gbp/managers", params={"name": "locations/9/admins/z"}).status_code == 400
        assert client.delete(f"/api/v1/businesses/{bid}/gbp/managers", params={"name": "locations/1/admins/a1"}).status_code == 400
        assert client.delete(f"/api/v1/businesses/{bid}/gbp/managers", params={"name": "locations/1/admins/a2"}).status_code == 400
        assert client.delete(f"/api/v1/businesses/{bid}/gbp/managers", params={"name": "locations/1/admins/a3"}).status_code == 204
        assert sent[-1][:2] == ("DELETE", "locations/1/admins/a3")

        sent.clear()
        name = client.get(f"/api/v1/businesses/{bid}").json()["name"]
        assert client.request("DELETE", f"/api/v1/businesses/{bid}/gbp/profile", json={"confirm_name": "wrong"}).status_code == 400 and sent == []
        d = client.request("DELETE", f"/api/v1/businesses/{bid}/gbp/profile", json={"confirm_name": name})
        assert d.status_code == 200 and sent[-1][:2] == ("DELETE", "locations/1")
        after = client.get(f"/api/v1/businesses/{bid}").json()  # the project stays, unlinked
        assert after["gbp_location"] is None and after["connection_id"] is None and after["verification"] == "unknown"
        assert client.get(f"/api/v1/businesses/{bid}/gbp/managers").status_code == 409
    finally:
        db = SessionLocal()
        db.query(Business).filter((Business.gbp_location == "locations/1") | (Business.id == bid)).delete()
        db.commit()
        db.close()
