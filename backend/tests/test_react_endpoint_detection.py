"""The connection test finds the website's real blog and image-upload addresses by itself, without storing anything on it."""
import contextlib

import httpx

from app.models import ReactSiteConnection
from app.services import crypto
from app.services import react_site as rs

POSTS = [{"id": 1, "title": "A", "body": "<p>x</p>"}]


def _site(routes: dict, bundle: str = ""):
    """A fake website: routes {("METHOD", path): (status, json_or_text)}; everything else 404. Records every POST."""
    posts = []

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path in ("/api/auth/login",):
            return httpx.Response(200, json={"token": "a.b.c", "expiresIn": 3600})
        if req.method == "POST":
            posts.append((req.url.path, req.content))
        if req.url.path == "/" and req.method == "GET":
            return httpx.Response(200, text='<html><script src="/assets/app.js"></script></html>', headers={"content-type": "text/html"})
        if req.url.path == "/assets/app.js":
            return httpx.Response(200, text=bundle, headers={"content-type": "application/javascript"})
        hit = routes.get((req.method, req.url.path))
        if hit is None:
            return httpx.Response(404, json={"message": "Not found"})
        status, body = hit
        return httpx.Response(status, json=body) if not isinstance(body, str) else httpx.Response(status, text=body)

    @contextlib.contextmanager
    def fake(_timeout=30):
        with httpx.Client(transport=httpx.MockTransport(handler)) as c:
            yield c
    return fake, posts


def _conn(image="/api/uploads", publish="/api/blogs"):
    c = ReactSiteConnection(business_id=1, api_base_url="https://site.example", website_url="https://site.example", publish_endpoint=publish,
                            image_endpoint=image, auth_endpoint="/api/auth/login", auth_scheme="login", mapping={"upload_field": "image"})
    c.login_username, c.password_enc = "u@x.com", crypto.seal("pw")
    return c


def test_codigix_like_site_wrong_plural_address_is_corrected(monkeypatch):
    fake, posts = _site({("GET", "/api/blogs"): (200, POSTS),
                         ("POST", "/api/upload"): (400, {"error": "No image uploaded"}),
                         ("POST", "/api/uploads"): (500, {"message": "Table 'codigix_admin.uploads' doesn't exist"})})
    monkeypatch.setattr(rs, "site_client", fake)
    conn = _conn("/api/uploads")
    steps, ok = rs.test(conn)
    assert ok and conn.image_endpoint == "/api/upload" and conn.publish_endpoint == "/api/blogs"
    assert all(b"filename=" not in body for _p, body in posts)  # no file was ever sent while detecting


def test_upload_address_and_field_name_are_read_from_the_websites_own_code(monkeypatch):
    bundle = 'const f=new FormData();f.append("file",e);fetch(`${API}/media/upload`,{method:"POST",body:f})'
    fake, _ = _site({("GET", "/api/posts"): (200, {"data": POSTS}),
                     ("POST", "/api/media/upload"): (400, {"message": "File is required"})}, bundle)
    monkeypatch.setattr(rs, "site_client", fake)
    conn = _conn("/api/uploads", "/api/blogs")
    steps, ok = rs.test(conn)
    assert ok and conn.publish_endpoint == "/api/posts" and conn.image_endpoint == "/api/media/upload" and conn.mapping["upload_field"] == "file"
    assert any("website's own code" in s["detail"] for s in steps)


def test_a_site_without_uploads_keeps_working_and_a_record_route_is_dropped(monkeypatch):
    fake, _ = _site({("GET", "/api/blogs"): (200, POSTS),
                     ("POST", "/api/uploads"): (500, {"sqlMessage": "Unknown column 'growzen_probe' in 'field list'"})})
    monkeypatch.setattr(rs, "site_client", fake)
    conn = _conn("/api/uploads")
    steps, ok = rs.test(conn)
    assert ok and conn.image_endpoint is None  # proven to be a "create a record" route: no longer called on publish
    up = next(s for s in steps if s["step"] == "Find the image upload address")
    assert up["ok"] and "inside the post" in up["detail"]


def test_a_correct_configuration_is_left_as_it_is(monkeypatch):
    fake, _ = _site({("GET", "/api/blogs"): (200, POSTS), ("POST", "/api/uploads"): (400, {"error": "No file uploaded"})})
    monkeypatch.setattr(rs, "site_client", fake)
    conn = _conn("/api/uploads")
    steps, ok = rs.test(conn)
    assert ok and conn.image_endpoint == "/api/uploads" and conn.publish_endpoint == "/api/blogs"
    assert "Updated" not in next(s for s in steps if s["step"] == "Find the image upload address")["detail"]
