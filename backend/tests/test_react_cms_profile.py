import json

import httpx

from app.models import Article, ReactSiteConnection
from app.services import react_site as rs

LIST_ERROR = '{"message":"Error fetching blogs","error":{"parent":{"sql":"SELECT `id`, `title`, `content`, `coverImage`, `isPublished`, `seoData` FROM `blogs`"}}}'


def _conn(mapping=None):
    return ReactSiteConnection(business_id=1, api_base_url="https://site.example", publish_endpoint="/api/blogs", auth_endpoint="/api/auth/login", auth_scheme="login", mapping=mapping)


def test_profile_is_read_from_the_columns_the_sites_own_error_prints():
    assert rs.detect_profile(_conn(), None, LIST_ERROR) == "cms"
    assert rs.detect_profile(_conn(), None, "") == "standard"
    assert rs.detect_profile(_conn(), {"content": "x", "isPublished": True}, "") == "cms"
    assert rs.detect_profile(_conn({"profile": "standard"}), None, LIST_ERROR) == "standard"


def test_cms_record_has_the_shape_of_the_sites_own_admin_form():
    a = Article(id=1, business_id=1, keyword="designer dress rental pune", title="T", meta_description="D", body="<p>" + "word " * 400 + "</p>", secondary_keywords=["a", "b"])
    raw = rs.payload(a, "publish", None, None)
    d = rs.to_cms(a, raw, "publish", None)
    assert d["content"] == raw["body"] and d["status"] == "Published" and d["isPublished"] is True and d["readingTime"] == 2
    assert d["seoData"]["focusKeyword"] == "designer dress rental pune" and d["seoData"]["secondaryKeywords"] == "a, b" and d["seoData"]["metaDescription"] == "D"
    assert d["faqs"] == [] and "body" not in d and "seo_title" not in d
    assert rs.to_cms(a, raw, "draft", None)["status"] == "Draft" and rs.to_cms(a, raw, "draft", None)["isPublished"] is False
    json.dumps(d)


def test_publish_sends_the_sites_own_shape_and_refuses_schedule(monkeypatch):
    import contextlib
    from datetime import datetime, timezone

    from app.services import crypto
    sent = {}

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/api/auth/login":
            return httpx.Response(200, json={"token": "a.b.c", "expiresIn": 3600})
        if req.method == "GET" and req.url.path == "/api/blogs":
            return httpx.Response(500, text=LIST_ERROR, headers={"content-type": "application/json"})
        if req.method == "POST" and req.url.path == "/api/blogs":
            sent.update(json.loads(req.content))
            return httpx.Response(201, json={"id": 7})
        return httpx.Response(404, json={})

    @contextlib.contextmanager
    def fake(_timeout=30):
        with httpx.Client(transport=httpx.MockTransport(handler)) as c:
            yield c

    monkeypatch.setattr(rs, "site_client", fake)
    conn = _conn()
    conn.login_username, conn.password_enc, conn.website_url = "u@x.com", crypto.seal("pw"), "https://site.example"
    a = Article(id=1, business_id=1, keyword="silk sarees", title="Silk Sarees", meta_description="D", body="<h2>H</h2><p>text</p>", status="completed")
    out = rs.publish(conn, a, "draft", None)
    assert out["id"] == "7" and sent["status"] == "Draft" and sent["isPublished"] is False and sent["content"].startswith("<h2>") and sent["seoData"]["seoTitle"] == "Silk Sarees"
    try:
        rs.publish(conn, a, "schedule", datetime(2099, 1, 1, tzinfo=timezone.utc))
    except rs.ScheduleHeldByGrowZen as exc:
        assert "no scheduled posts" in str(exc)
    else:
        raise AssertionError("the site cannot schedule: GrowZen must hold it")


def test_a_database_error_on_the_site_is_named_instead_of_blaming_the_image():
    rs._last_list_text["https://s.example/api/blogs"] = "{\"sqlMessage\":\"Unknown column 'bannerImage' in 'field list'\"}"
    msg = rs.site_db_problem("https://s.example", "/api/blogs")
    assert "bannerImage" in msg and "with or without an image" in msg
    assert rs.site_db_problem("https://other.example", "/api/blogs") is None


def test_a_create_answer_without_an_id_is_resolved_by_slug_and_an_existing_post_is_updated(monkeypatch):
    import contextlib

    from app.services import crypto
    posts = {}

    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path == "/api/auth/login":
            return httpx.Response(200, json={"token": "a.b.c", "expiresIn": 3600})
        if req.method == "GET" and path == "/api/blogs":
            return httpx.Response(200, json=[{"id": i, "slug": p["slug"]} for i, p in posts.items() if p.get("isPublished")])
        if req.method == "GET" and path == "/api/blogs/admin/all":
            return httpx.Response(200, json=[{"id": i, "slug": p["slug"]} for i, p in posts.items()])
        if req.method == "POST" and path == "/api/blogs":
            posts[5] = json.loads(req.content)
            return httpx.Response(201, json={"message": "Blog created"})  # no id in the answer
        if req.method == "PUT" and path.startswith("/api/blogs/"):
            posts[int(path.rsplit("/", 1)[1])] = json.loads(req.content)
            return httpx.Response(200, json={"message": "updated"})
        return httpx.Response(404, json={})

    @contextlib.contextmanager
    def fake(_timeout=30):
        with httpx.Client(transport=httpx.MockTransport(handler)) as c:
            yield c

    monkeypatch.setattr(rs, "site_client", fake)
    conn = _conn()
    conn.login_username, conn.password_enc, conn.website_url = "u@x.com", crypto.seal("pw"), "https://site.example"
    a = Article(id=1, business_id=1, keyword="silk sarees", title="Silk Sarees", meta_description="D", body="<p>text</p>", status="completed")
    out = rs.publish(conn, a, "publish", None)
    assert out["id"] == "5"  # found by its slug
    a.react_post_id, a.react_status = None, None  # GrowZen never stored it: publishing again must update post 5, not create a second one
    again = rs.publish(conn, a, "publish", None)
    assert again["id"] == "5" and len(posts) == 1
