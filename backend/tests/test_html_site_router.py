"""HTML Website destination endpoints: settings, deployment (password hidden), and isolation from WordPress settings."""
import pytest

from app.db import SessionLocal
from app.models import SiteIntegration
from app.services import html_publisher as hp


@pytest.fixture()
def db():
    s = SessionLocal()
    yield s
    s.close()

LISTING = '<html><head><title>Blog</title><script src="js/data.js"></script></head><body></body></html>'
DATA_JS = "const SITE = { blog: [ { slug: 'first', title: 'First', date: 'Jan 1, 2026', body: '<p>x</p>' } ] };\n" \
          "function link(p){ return `blog.html?post=${p.slug}`; }"


def _biz(client):
    return client.post("/api/v1/businesses", json={"name": "Acme Society", "website": "https://acme.com", "primary_category": "Housing"}).json()["id"]


def _fake_live(monkeypatch, pages):
    monkeypatch.setattr(hp, "_live", lambda url: pages.get(url))


def test_save_site_detects_the_blog_and_keeps_wordpress_fields(client, db, monkeypatch):
    bid = _biz(client)
    base = f"/api/v1/businesses/{bid}/html-site"
    assert client.get(base).json()["status"] == "not_connected"
    _fake_live(monkeypatch, {"https://acme.com/blog.html": LISTING, "https://acme.com/js/data.js": DATA_JS})
    r = client.put(base, json={"website_url": "acme.com", "listing_file": "blog.html", "articles_folder": "blog"}).json()
    assert r["status"] == "connected" and r["shape"]["mode"] == "data" and r["shape"]["array_key"] == "blog"
    assert r["ready"] is False  # no deployment tested yet
    row = db.query(SiteIntegration).filter_by(business_id=bid).one()
    assert row.status == "not_connected" and row.method is None  # WordPress side untouched
    assert client.get(f"/api/v1/businesses/{bid}/site-integration").json()["status"] == "not_connected"


def test_missing_blog_page_is_reported(client, monkeypatch):
    bid = _biz(client)
    _fake_live(monkeypatch, {})
    r = client.put(f"/api/v1/businesses/{bid}/html-site", json={"website_url": "https://acme.com"}).json()
    assert r["status"] == "error" and "blog.html" in r["site_check"]["detail"]


def test_deploy_settings_hide_and_keep_the_password(client, db, monkeypatch):
    bid = _biz(client)
    base = f"/api/v1/businesses/{bid}/html-site"
    assert client.put(f"{base}/deploy", json={"host": "ftp.acme.com", "user": "u@acme.com", "password": "pw"}).status_code == 409  # site first
    _fake_live(monkeypatch, {"https://acme.com/blog.html": LISTING, "https://acme.com/js/data.js": DATA_JS})
    client.put(base, json={"website_url": "https://acme.com"})
    assert client.put(f"{base}/deploy", json={"host": "ftp.acme.com", "user": "u@acme.com"}).status_code == 400  # password needed
    r = client.put(f"{base}/deploy", json={"host": "ftp.acme.com", "port": 21, "user": "u@acme.com", "password": "s3cret", "tls": True}).json()
    assert r["deploy"] == {**r["deploy"], "adapter": "ftp", "host": "ftp.acme.com", "port": 21, "user": "u@acme.com", "tls": True, "has_password": True}
    assert "s3cret" not in str(r)
    enc = hp.settings_of(db.query(SiteIntegration).filter_by(business_id=bid).one())["deploy"]["password_enc"]
    r2 = client.put(f"{base}/deploy", json={"host": "ftp.acme.com", "port": 21, "user": "u@acme.com", "tls": True}).json()  # empty password keeps it
    db.expire_all()
    assert r2["deploy"]["has_password"] and hp.settings_of(db.query(SiteIntegration).filter_by(business_id=bid).one())["deploy"]["password_enc"] == enc
    assert client.put(f"{base}/deploy", json={"host": "ftp.acme.com", "user": "u@acme.com", "password": "x", "root": "blog.html"}).status_code == 400
    assert client.delete(base).status_code == 204
    assert client.get(base).json()["configured"] is False


def test_publish_needs_a_finished_setup(client, monkeypatch):
    bid = _biz(client)
    assert client.post(f"/api/v1/businesses/{bid}/html-site/articles/999999/publish").status_code == 404
