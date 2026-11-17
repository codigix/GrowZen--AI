"""Blog images: the website's own posts analysed (featured / article / gallery, each measured once) and article images
uploaded once per website when publishing, at their places, with their layout kept."""
import base64
import io

from PIL import Image

from app.services import blog_images as bi
from app.services import content_images as ci
from app.services import elementor_layout as el
from app.services import featured_images as fi


def _png(w=40, h=20) -> str:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), "red").save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def test_an_inline_image_is_measured_from_its_own_bytes():
    src = _png()
    m = bi._measure(src)
    assert m["bytes"] == len(base64.b64decode(src.split(",", 1)[1])) and (m["width"], m["height"]) == (40, 20) and m["format"] == "PNG"


def test_api_blog_posts_are_split_into_featured_article_and_gallery_images(monkeypatch):
    from app.services import article_publishing as ap
    from app.services import blog_flow as flow
    from app.services import react_site as rs
    cover, body, g1, g2 = _png(120, 60), _png(30, 30), _png(31, 31), _png(32, 32)
    rows = [{"id": 1, "slug": "a", "title": "A", "image": cover, "body": f"<p>x</p><h2>Steps</h2><figure><img src='{body}' alt='one'></figure><img src='{body}'>"},
            {"id": 2, "slug": "b", "title": "B", "image": cover, "body": f"<p>y</p><div class='blog-image-gallery'><img src='{g1}'><img src='{g2}'></div>"}]

    class Conn:
        blog_url, website_url = "https://s.example/blog", "https://s.example"
    monkeypatch.setattr(flow, "layout_check", lambda *_a, **_k: {"state": "ok", "site": "https://s.example", "listing_url": "https://s.example/blog", "source": "api"})
    monkeypatch.setattr(ap, "react_target", lambda *_a: Conn())
    monkeypatch.setattr(rs, "list_posts", lambda _c: rows)
    out = bi.image_structure(None, object(), None)
    assert out["state"] == "ok" and out["posts_checked"] == 2
    assert out["featured"]["count"] == 2 and out["featured"]["typical"] == "120 × 60" and out["same_featured_on"] == 2
    assert out["content"]["count"] == 1 and out["content"]["posts_with"] == 1  # the same picture twice counts once
    assert out["gallery"]["count"] == 2 and out["gallery"]["posts_with"] == 1
    first = out["posts"][0]["content"][0]
    assert first["placement"] == "Under “Steps”" and first["alt"] == "one"


def test_article_images_are_uploaded_once_per_website_and_put_in_place(tmp_path, monkeypatch):
    monkeypatch.setattr(fi, "UPLOAD_ROOT", tmp_path)
    webp, info = fi.convert(base64.b64decode(_png(50, 40).split(",", 1)[1]), "photo.png")
    name = ci.save(3, 9, webp, info)
    assert ci.path_of(3, 9, name) and ci.path_of(3, 8, name) is None and ci.path_of(3, 9, "../../x.webp") is None
    body = (f'<p>a</p><div class="blog-image-row" data-gz-layout="row-2" style="display:grid;"><figure class="blog-content-image" data-gz-figure="1">'
            f'<img src="http://localhost:8000/x/{name}" data-gz-image="{name}" alt="A &amp; B" loading="lazy"><figcaption>Cap</figcaption></figure></div><p>b</p>')
    sent = []

    def upload(data, filename, alt, caption):
        sent.append((filename, alt, caption))
        return "https://site.example/uploads/p1.webp"
    steps = []
    out = ci.publish_body(body, 3, 9, "My Post", "react:https://site.example", upload, steps)
    assert 'src="https://site.example/uploads/p1.webp"' in out and "localhost" not in out
    assert sent == [("my-post-1.webp", "A & B", "Cap")]
    again = ci.publish_body(body, 3, 9, "My Post", "react:https://site.example", upload, [])
    assert again == out and len(sent) == 1  # published again: not uploaded twice
    ci.publish_body(body, 3, 9, "My Post", "wp:https://other.example", upload, [])
    assert len(sent) == 2  # another website gets its own copy
    assert ci.listing(3, 9)[0]["on_sites"] == ["react:https://site.example", "wp:https://other.example"]


def test_saving_the_article_keeps_placed_images_and_nothing_else():
    from app.services import articles as svc
    n1, n2 = "17-2c3574520330.webp", "17-edeb1cd96574.webp"
    src = "http://localhost:8000/businesses/17/articles/17/content-images/"
    fig = lambda n, cap="": (f'<figure class="blog-content-image" data-gz-figure="1" style="margin:0;"><img src="{src}{n}" data-gz-image="{n}" alt="Team &amp; laptop" '
                            f'loading="lazy" width="740" height="431" onerror="alert(1)" style="max-width:100%;height:auto;width:100%;">{cap}</figure>')
    body = (f"<h2>Intro</h2><p>a</p>\n{fig(n1, '<figcaption>Our <b>team</b></figcaption>')}\n<p>b</p>"
            f'<div class="blog-image-row" data-gz-layout="row-2" style="display:grid;">{fig(n1)}{fig(n2)}</div>'
            f'<img src="https://evil.example/x.png" data-gz-image="{n1}"><figure><img src="https://other.example/y.png"></figure><p>c</p>')
    out = svc.sanitize_html(body)
    assert out.count("data-gz-image=") == 3 and "data-gz-layout=\"row-2\"" in out and "display:grid" in out
    assert "<figcaption>Our team</figcaption>" in out and 'alt="Team &amp; laptop"' in out and 'width="740" height="431"' in out
    assert "onerror" not in out and "evil.example" not in out and "other.example" not in out
    assert "<p>a</p>" in out and "<p>c</p>" in out and "GZPLACEDIMAGE" not in out
    assert svc.sanitize_html(out) == out  # saving again changes nothing


def test_saving_keeps_the_schema_and_never_leaves_placeholder_text():
    from app.services import articles as svc
    schema = '<script type="application/ld+json">{"@type":"BlogPosting"}</script>'
    old = "<p>a</p>\n&lt;!--SCHEMA_PLACEHOLDER--> &lt;!--SCHEMA_PLACEHOLDER-->\n" + schema
    out = svc.sanitize_html(old)
    assert "SCHEMA_PLACEHOLDER" not in out and "GZSCHEMA" not in out and out.count("application/ld+json") == 1 and "<p>a</p>" in out
    assert svc.sanitize_html(out) == out


def test_a_refused_post_with_images_inside_is_remembered_and_never_cut(tmp_path, monkeypatch):
    import contextlib
    import json

    import httpx

    from app.models import Article, ReactSiteConnection
    from app.services import crypto
    from app.services import react_site as rs
    monkeypatch.setattr(fi, "UPLOAD_ROOT", tmp_path)
    webp, info = fi.convert(base64.b64decode(_png(400, 300).split(",", 1)[1]), "p.png")
    name = ci.save(1, 1, webp, info)
    sent = []

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/api/auth/login":
            return httpx.Response(200, json={"token": "a.b.c", "expiresIn": 3600})
        if req.method == "GET":
            return httpx.Response(200, json=[])
        if req.url.path == "/api/uploads":
            return httpx.Response(200, json={"url": "/api/uploads/x.webp"})
        if req.method == "POST" and req.url.path == "/api/blogs":
            sent.append(len(json.loads(req.content)["body"]))
            return httpx.Response(500, json={"message": "Data too long for column 'body' at row 1"})
        return httpx.Response(404, text="not found")

    @contextlib.contextmanager
    def fake(_timeout=30):
        with httpx.Client(transport=httpx.MockTransport(handler)) as c:
            yield c
    monkeypatch.setattr(rs, "site_client", fake)
    conn = ReactSiteConnection(business_id=1, api_base_url="https://site.example", website_url="https://site.example", publish_endpoint="/api/blogs",
                               image_endpoint="/api/uploads", auth_endpoint="/api/auth/login", auth_scheme="login", mapping={"profile": "standard"})
    conn.login_username, conn.password_enc = "u@x.com", crypto.seal("pw")
    a = Article(id=1, business_id=1, keyword="k", title="T", body=f'<p>x</p><figure data-gz-figure="1"><img src="http://h/api/v1/businesses/1/articles/1/content-images/{name}" data-gz-image="{name}" alt="a"></figure>', status="completed")
    try:
        rs.publish(conn, a, "publish", None)
    except rs.ReactSiteError:
        pass
    else:
        raise AssertionError("the website refused the post")
    assert conn.mapping["uploads_load"] is False  # /api/uploads/x.webp does not load: the picture went inside the text
    assert len(set(sent)) == 1  # the article with its picture is never cut to fit
    assert conn.mapping["body_refused_bytes"] >= sent[0]


def test_cleaning_keeps_the_layout_of_placed_images_only():
    body = '<p class="x" style="color:red">t</p><div class="blog-image-row" data-gz-layout="row-2" style="display:grid;"><img data-gz-image="1-aaaaaaaaaaaa.webp" style="width:100%;" src="u"></div>'
    out = el.clean_body(body)
    assert '<p>t</p>' in out and 'data-gz-layout="row-2" style="display:grid;"' in out and 'class="blog-image-row"' in out and 'style="width:100%;"' in out
