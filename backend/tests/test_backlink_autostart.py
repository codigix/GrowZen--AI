"""Onboarding starts backlink discovery: the site and saved competitors are tracked, the bot is switched on and runs once straight away."""
from app.backlinks import autostart, bot
from app.config import get_settings
from app.db import SessionLocal
from app.models import Business
from app.routers import discover


def _business(client, website):
    r = client.post("/api/v1/businesses", json={"name": "Autostart Clinic", "website": website})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_onboarding_tracks_the_site_enables_the_bot_and_runs_it(client, monkeypatch):
    monkeypatch.setattr(discover, "_onboard", lambda db, business_id: None)  # the audits are not under test here
    monkeypatch.setattr(get_settings(), "backlink_autostart", True)
    ran: list[int] = []
    monkeypatch.setattr(bot, "run_cycle", lambda db, business_id, *a, **k: ran.append(business_id))
    bid = _business(client, "https://www.autostart-clinic.in/")
    assert client.get(f"/api/v1/businesses/{bid}/backlink-intel/targets").json() == []  # creating a project alone tracks nothing

    r = client.post(f"/api/v1/discover/onboard/{bid}")
    assert r.status_code == 202
    started = r.json()["backlink_bot"]
    assert started["enabled"] is True and started["domains"] == ["autostart-clinic.in"]

    targets = client.get(f"/api/v1/businesses/{bid}/backlink-intel/targets").json()
    assert [t["domain"] for t in targets] == ["autostart-clinic.in"] and targets[0]["is_competitor"] is False
    assert client.get(f"/api/v1/businesses/{bid}/backlink-intel/bot").json()["config"]["enabled"] is True
    assert ran == [bid]  # the first exploration run was started

    # Onboarding the same project again changes nothing and adds no duplicate target.
    client.post(f"/api/v1/discover/onboard/{bid}")
    assert len(client.get(f"/api/v1/businesses/{bid}/backlink-intel/targets").json()) == 1


def test_a_project_without_a_website_says_why_and_starts_nothing(client, monkeypatch):
    monkeypatch.setattr(discover, "_onboard", lambda db, business_id: None)
    monkeypatch.setattr(get_settings(), "backlink_autostart", True)
    ran: list[int] = []
    monkeypatch.setattr(bot, "run_cycle", lambda db, business_id, *a, **k: ran.append(business_id))
    bid = client.post("/api/v1/businesses", json={"name": "No Site Cafe"}).json()["id"]
    out = client.post(f"/api/v1/discover/onboard/{bid}").json()["backlink_bot"]
    assert out["enabled"] is False and "website" in out["reason"].lower()
    assert ran == []


def test_the_first_run_can_be_switched_off(monkeypatch):
    called: list[int] = []
    monkeypatch.setattr(bot, "run_cycle", lambda *a, **k: called.append(1))
    monkeypatch.setattr(get_settings(), "backlink_autostart", False)
    autostart.first_run(SessionLocal(), 1)
    assert called == []
    assert Business  # imported for the shared fixtures' models


def test_clients_imported_from_google_get_backlink_discovery_too(client, monkeypatch):
    import test_gbp
    from app.backlinks.models import BiBotConfig, BiTrackedTarget
    test_gbp.fake_google(monkeypatch)
    test_gbp.LOCATIONS[0]["websiteUri"] = "https://www.clinic-one.in/"
    cid = test_gbp.connection()
    bid = None
    try:
        bid = client.post(f"/api/v1/connections/{cid}/import", json={"locations": ["locations/1"]}).json()[0]["id"]
        db = SessionLocal()
        cfg = db.query(BiBotConfig).filter(BiBotConfig.business_id == bid).first()
        domains = [t.domain for t in db.query(BiTrackedTarget).filter(BiTrackedTarget.business_id == bid)]
        db.close()
        assert cfg is not None and cfg.enabled is True and domains == ["clinic-one.in"]
    finally:
        from app.models import GoogleConnection
        test_gbp.LOCATIONS[0].pop("websiteUri", None)
        db = SessionLocal()
        db.query(Business).filter(Business.gbp_location == "locations/1").delete()
        db.query(GoogleConnection).filter(GoogleConnection.id == cid).delete()  # leave no connection behind for other tests
        db.commit()
        db.close()


def test_monthly_report_downloads_as_csv(client):
    bid = client.post("/api/v1/businesses", json={"name": "Csv Clinic", "website": "https://csv-clinic.in"}).json()["id"]
    r = client.get(f"/api/v1/businesses/{bid}/report.csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert r.content.startswith(chr(0xFEFF).encode("utf-8")) and b"Csv Clinic: monthly report" in r.content and b"Calls" in r.content
