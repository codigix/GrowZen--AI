from types import SimpleNamespace

import pytest

from app.config import get_settings
from app.services import gbp, post_image_host as ph


def test_a_googles_own_picture_address_is_not_a_public_source_but_the_owners_website_is():
    assert ph.is_public_address("https://codigix.co/wp-content/uploads/a.jpg") is True
    assert ph.is_public_address("https://lh3.googleusercontent.com/gpu-csl/abc") is False  # a picture uploaded to the profile is refused as a post's source
    assert ph.is_public_address("http://localhost:8000/x.jpg") is False and ph.is_public_address("") is False and ph.is_public_address("data:image/png;base64,AAA") is False


def test_the_token_is_signed_and_cannot_be_guessed_for_another_post():
    t = ph.token_for(7)
    assert ph.post_of(t) == 7 and ph.post_of("7-" + "0" * 16) is None and ph.post_of("8-" + t.split("-", 1)[1]) is None and ph.post_of("nonsense") is None


def test_the_source_is_the_owners_public_picture_else_this_server_else_the_wordpress_library(monkeypatch):
    from app.services import article_publishing as ap, site_publish as sp
    b = SimpleNamespace(id=1, name="Co", area=None, city="Pune")
    own = SimpleNamespace(id=5, image_url="https://own.example/pic.jpg")
    assert ph.source_url(None, b, own) == "https://own.example/pic.jpg"
    p = SimpleNamespace(id=5, image_url="https://lh3.googleusercontent.com/x", title="T", body="B", post_type="Update", coupon_code=None, starts_on=None, ends_on=None, start_time=None)
    s = get_settings()
    monkeypatch.setattr(s, "public_base_url", "https://api.example")
    monkeypatch.setattr(ph, "_fetchable", lambda u: True)
    url = ph.source_url(None, b, p)
    assert url == f"https://api.example{s.api_prefix}/public/gbp-post-image/{ph.token_for(5)}.jpg"  # this server answers from the internet: Google fetches it from here
    monkeypatch.setattr(ph, "_fetchable", lambda u: u.startswith("https://site.example"))  # a live site that is only SAID to be this server but has no such picture is not used; the website's own copy is
    monkeypatch.setattr(ap, "site_target", lambda db, b: SimpleNamespace(method="wordpress", base_url="https://site.example"))
    monkeypatch.setattr(ph, "picture_bytes", lambda b, p: b"jpegbytes")
    monkeypatch.setattr(sp, "upload_wordpress_media", lambda row, data, name, mime: f"https://site.example/wp-content/uploads/{name}")
    assert ph.source_url(None, b, p) == "https://site.example/wp-content/uploads/gbp-post-5.jpg"  # a computer at home: the picture goes to the website's media library
    monkeypatch.setattr(ap, "site_target", lambda db, b: None)
    with pytest.raises(ph.HostError, match="public web address"):
        ph.source_url(None, b, p)


def test_the_picture_is_served_to_google_by_its_signed_address(client, monkeypatch):
    from app.db import SessionLocal
    from app.models import Post
    bid = client.post("/api/v1/businesses", json={"name": "Pic Co", "website": "https://pic.example/", "city": "Pune"}).json()["id"]
    db = SessionLocal()
    try:
        post = Post(business_id=bid, post_type="Update", title="Big news", body="We opened a new branch in Pune this week. Come and see it.", status="draft")
        db.add(post)
        db.commit()
        pid = post.id
    finally:
        db.close()
    r = client.get(f"/api/v1/public/gbp-post-image/{ph.token_for(pid)}.jpg")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg" and r.content[:2] == b"\xff\xd8" and len(r.content) > 5000
    assert client.get(f"/api/v1/public/gbp-post-image/{pid}-deadbeefdeadbeef.jpg").status_code == 404


def test_a_post_with_a_picture_is_not_sent_without_it_when_google_refuses_the_picture(monkeypatch):
    c = gbp.GbpClient.__new__(gbp.GbpClient)
    calls = []

    def req(method, url, json=None, **k):
        calls.append(json)
        if "media" in (json or {}):
            raise gbp.GbpError("Request contains an invalid argument.")
        return {"name": "localPosts/1"}
    monkeypatch.setattr(c, "_req", req, raising=False)
    post = {"body": "Hello", "post_type": "Update", "image_url": "https://x.example/p.jpg"}
    with pytest.raises(gbp.GbpError, match="post was not published"):
        c.create_post("accounts/1", "locations/2", post, require_photo=True)
    made = c.create_post("accounts/1", "locations/2", post)  # the old way (no picture required) still sends it without
    assert made["dropped"] == ["the photo"]
