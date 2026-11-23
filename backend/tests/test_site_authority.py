"""The audited website's DA/PA/spam (Apify stubbed): only the project's own site, and a site asked about today is not paid for twice."""
import pytest

from app.services import apify_metrics as am


@pytest.fixture(autouse=True)
def _clean():
    from app.backlinks.models import BiDomainMetric
    from app.db import SessionLocal
    def wipe():
        db = SessionLocal()
        try:
            db.query(BiDomainMetric).filter(BiDomainMetric.source == "apify").delete()
            db.commit()
        finally:
            db.close()
    wipe()
    yield
    wipe()


def test_fetch_shows_the_own_site_figures_and_a_second_press_is_free(client, monkeypatch):
    asked = []
    monkeypatch.setattr(am, "configured", lambda: True)
    monkeypatch.setattr(am, "lookup", lambda doms: asked.append(list(doms)) or [{"domain": d, "domain_authority": 6, "home_page_authority": 16, "spam_score": 1} for d in doms])
    bid = client.post("/api/v1/businesses", json={"name": "Codigix", "website": "https://www.codigix.co/about"}).json()["id"]
    base = f"/api/v1/businesses/{bid}/site-authority"
    empty = client.get(base).json()
    assert empty["domain"] == "codigix.co" and empty["scores"] is None and empty["configured"] is True
    got = client.post(base).json()
    assert got["scores"]["da"] == 6 and got["scores"]["pa"] == 16 and got["scores"]["spam"] == 1 and got["fresh"] is True
    assert asked == [["codigix.co"]]  # only the audited site, never anything else
    client.post(base)
    assert asked == [["codigix.co"]]  # the second press is answered from the saved figures
    assert client.get(base).json()["scores"]["da"] == 6


def test_no_website_or_no_service_is_explained(client, monkeypatch):
    monkeypatch.setattr(am, "configured", lambda: False)
    bid = client.post("/api/v1/businesses", json={"name": "NoSite"}).json()["id"]
    r = client.post(f"/api/v1/businesses/{bid}/site-authority")
    assert r.status_code == 422
    assert client.get(f"/api/v1/businesses/{bid}/site-authority").json()["domain"] is None
