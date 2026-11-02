"""GitHub / Ghost / Shopify publishing, GrowZen-side scheduling and detect-on-onboarding, against SIMULATED servers (no network).
They prove our requests, error handling and status checks follow each vendor's documented API; whether a given customer's token has the right permissions is
what the connect-time checks report, step by step."""
import base64
import json
from datetime import datetime, timedelta, timezone

import httpx
import jwt
import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Article, ScheduledPost, SiteIntegration
from app.services import crypto, site_adapters as ad, site_onboarding, site_publish as sp, site_stack

ARTICLE_HTML = ('<h2>Why whitening works</h2><p>Teeth <strong>whitening</strong> is <em>safe</em> when a dentist does it. See <a href="https://smile.in/whitening">our guide</a>.</p>'
                '<ul><li>Fast</li><li>Painless<ul><li>No sensitivity</li></ul></li></ul><ol><li>Book</li><li>Smile</li></ol><blockquote>Ask us anything.</blockquote><hr>'
                '<p>Line one<br>Line two <code>inline()</code></p><pre>code block\nsecond line</pre><img src="/a.png" alt="Before and after">')


def _article(title="Teeth whitening in Pune", body=ARTICLE_HTML, **kw):
    return Article(business_id=1, keyword="teeth whitening pune", secondary_keywords=["whitening cost"], title=title, body=body, meta_description="A short guide.", **kw)


def _client(monkeypatch, handler, *modules):
    for m in modules:
        monkeypatch.setattr(m, "site_client", lambda timeout=15: httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True, timeout=timeout))


# ---------------------------------------------------------------- Markdown + front matter

def test_html_becomes_clean_markdown():
    md = ad.html_to_markdown(ARTICLE_HTML)
    assert "## Why whitening works" in md and "Teeth **whitening** is *safe*" in md and "[our guide](https://smile.in/whitening)" in md
    assert "- Fast\n- Painless\n  - No sensitivity" in md and "1. Book\n2. Smile" in md and "> Ask us anything." in md and "\n---\n" in md
    assert "Line one<br />Line two `inline()`" in md and "```\ncode block\nsecond line\n```" in md and "![Before and after](/a.png)" in md
    assert "\n\n\n" not in md and md.endswith("\n")


def test_front_matter_is_valid_yaml_even_with_awkward_text():
    fm = ad.front_matter({"title": 'He said "hi": a: b', "date": "2026-10-30T10:00:00+00:00", "draft": False, "keywords": ["a", "b"], "description": "", "slug": "x"})
    assert fm.startswith("---\n") and fm.endswith("---\n\n")
    assert 'title: "He said \\"hi\\": a: b"' in fm and "draft: false" in fm and 'keywords: ["a", "b"]' in fm and "description" not in fm
    import yaml
    parsed = yaml.safe_load(fm.split("---")[1])
    assert parsed["title"] == 'He said "hi": a: b' and parsed["keywords"] == ["a", "b"] and parsed["draft"] is False


# ---------------------------------------------------------------- GitHub

class FakeGitHub:
    def __init__(self, token="ghp_good", push=True, branch="main", private=True, files=None):
        self.token, self.push, self.branch, self.private, self.files, self.commits = token, push, branch, private, dict(files or {}), []

    def __call__(self, req: httpx.Request):
        if req.headers.get("authorization") != f"Bearer {self.token}":
            return httpx.Response(401, json={"message": "Bad credentials"})
        path = req.url.path
        if path == "/user":
            return httpx.Response(200, json={"login": "acme-dev"})
        if path == "/repos/acme/website":
            return httpx.Response(200, json={"full_name": "acme/website", "private": self.private, "default_branch": self.branch, "permissions": {"push": self.push}})
        if path == f"/repos/acme/website/branches/{self.branch}":
            return httpx.Response(200, json={"name": self.branch})
        if path.startswith("/repos/acme/website/contents/"):
            target = path.split("/contents/", 1)[1]
            if req.method == "GET":
                if target in self.files:
                    return httpx.Response(200, json={"sha": self.files[target]["sha"], "path": target})
                listing = [f for f in self.files if f.startswith(target + "/")]
                return httpx.Response(200, json=[{"path": f} for f in listing]) if listing else httpx.Response(404, json={"message": "Not Found"})
            body = json.loads(req.content)
            if target in self.files and body.get("sha") != self.files[target]["sha"]:
                return httpx.Response(422, json={"message": "sha wasn't supplied"})
            sha = f"sha{len(self.commits) + 1:04d}"
            self.files[target] = {"sha": sha, "content": base64.b64decode(body["content"]).decode(), "message": body["message"], "branch": body["branch"]}
            self.commits.append(target)
            return httpx.Response(201, json={"content": {"html_url": f"https://github.com/acme/website/blob/main/{target}"}, "commit": {"sha": f"c0ffee{sha}"}})
        return httpx.Response(404, json={"message": "Not Found"})


def _gh_row(**cfg):
    return SiteIntegration(business_id=1, method="github", base_url="https://acme.com", secret_enc=crypto.seal("ghp_good"), status="connected",
                           config={"repo": "acme/website", "branch": "main", "directory": "content/blog", "body_format": "markdown", **cfg})


def test_github_connection_checks_pass_with_a_good_token(monkeypatch):
    _client(monkeypatch, FakeGitHub(), ad)
    steps, info = sp.verify_github("ghp_good", "https://github.com/acme/website.git", None, "/content/blog/")
    assert [s["ok"] for s in steps] == [True] * 5 and info == {"site_name": "acme/website", "user": "acme-dev", "branch": "main", "directory": "content/blog", "repo": "acme/website"}
    assert "will be created" in steps[-1]["detail"]  # the folder does not exist yet


@pytest.mark.parametrize("fake, repo, step, hint", [
    (FakeGitHub(token="other"), "acme/website", "Sign in with the access token", "Contents: Read and write"),
    (FakeGitHub(), "acme/missing", "Find the repository", "not found"),
    (FakeGitHub(push=False), "acme/website", "Check permission to write", "Read and write"),
])
def test_github_names_the_failing_step_and_how_to_fix_it(monkeypatch, fake, repo, step, hint):
    _client(monkeypatch, fake, ad)
    steps, info = sp.verify_github("ghp_good", repo, None, "content/blog")
    assert info is None and steps[-1]["step"] == step and not steps[-1]["ok"] and hint in steps[-1]["detail"]


def test_github_rejects_a_malformed_repository_name():
    with pytest.raises(sp.PublishError, match="owner/name"):
        sp.verify_github("t", "not a repo", None, "content/blog")


def test_github_publish_commits_a_markdown_file_with_front_matter(monkeypatch):
    fake = FakeGitHub()
    _client(monkeypatch, fake, ad)
    out = sp.publish(_gh_row(public_url="https://acme.com/blog/{slug}"), _article(), "publish", None)
    path = "content/blog/teeth-whitening-in-pune.md"
    assert fake.commits == [path] and out["status"] == "publish" and out["url"] == "https://acme.com/blog/teeth-whitening-in-pune" and out["id"].startswith("c0ffee"[:6])
    text = fake.files[path]["content"]
    import yaml
    meta = yaml.safe_load(text.split("---")[1])
    assert meta["title"] == "Teeth whitening in Pune" and meta["draft"] is False and meta["slug"] == "teeth-whitening-in-pune" and meta["keywords"] == ["teeth whitening pune", "whitening cost"]
    assert "## Why whitening works" in text and "<h2>" not in text and fake.files[path]["branch"] == "main"
    assert all(s["ok"] for s in out["steps"]) and "rebuilds" in out["steps"][-1]["detail"]


def test_github_draft_marks_draft_true_and_republishing_updates_the_same_file(monkeypatch):
    fake = FakeGitHub()
    _client(monkeypatch, fake, ad)
    d = sp.publish(_gh_row(), _article(), "draft", None)
    assert d["status"] == "draft" and "draft: true" in fake.files["content/blog/teeth-whitening-in-pune.md"]["content"] and "github.com/acme/website/blob" in d["url"]
    sp.publish(_gh_row(), _article(body="<p>Updated body</p>"), "publish", None)  # same title: the file is updated, not rejected
    assert len(fake.files) == 1 and "Updated body" in fake.files["content/blog/teeth-whitening-in-pune.md"]["content"] and "draft: false" in fake.files["content/blog/teeth-whitening-in-pune.md"]["content"]


def test_github_can_keep_the_html_and_refuses_native_scheduling_and_bad_tokens(monkeypatch):
    fake = FakeGitHub()
    _client(monkeypatch, fake, ad)
    sp.publish(_gh_row(body_format="html"), _article(body="<p>Raw html</p>"), "publish", None)
    assert list(fake.files) == ["content/blog/teeth-whitening-in-pune.html"] and "<p>Raw html</p>" in fake.files["content/blog/teeth-whitening-in-pune.html"]["content"]
    with pytest.raises(sp.PublishError, match="GrowZen schedules it"):
        sp.publish(_gh_row(), _article(), "schedule", datetime.now(timezone.utc) + timedelta(days=1))
    _client(monkeypatch, FakeGitHub(token="rotated"), ad)
    with pytest.raises(sp.PublishError, match="refused the token"):
        sp.publish(_gh_row(), _article(), "publish", None)


# ---------------------------------------------------------------- Ghost

GHOST_ID, GHOST_SECRET = "64a1b2c3d4", "abcdef0123456789abcdef0123456789"


class FakeGhost:
    def __init__(self, secret=GHOST_SECRET, stale=False):
        self.secret, self.posts, self.stale = secret, [], stale

    def __call__(self, req: httpx.Request):
        if req.url.path == "/ghost/api/admin/site/":
            return httpx.Response(200, json={"site": {"title": "Clinic Blog", "version": "5.79"}})
        auth = req.headers.get("authorization", "")
        try:
            claims = jwt.decode(auth.removeprefix("Ghost "), bytes.fromhex(self.secret), algorithms=["HS256"], audience="/admin/")
            kid = jwt.get_unverified_header(auth.removeprefix("Ghost "))["kid"]
            assert kid == GHOST_ID and claims["exp"] - claims["iat"] <= 300
        except Exception:
            return httpx.Response(401, json={"errors": [{"message": "Unknown Admin API Key"}]})
        if req.url.path == "/ghost/api/admin/posts/" and req.method == "GET":
            return httpx.Response(200, json={"posts": []})
        if req.url.path == "/ghost/api/admin/posts/" and req.method == "POST":
            post = json.loads(req.content)["posts"][0]
            self.posts.append((dict(req.url.params), post))
            status = "draft" if self.stale else post["status"]
            return httpx.Response(201, json={"posts": [{"id": "p1", "status": status, "url": "https://blog.example.org/teeth-whitening/"}]})
        return httpx.Response(404)


def _ghost_row(secret=f"{GHOST_ID}:{GHOST_SECRET}"):
    return SiteIntegration(business_id=1, method="ghost", base_url="https://blog.example.org", secret_enc=crypto.seal(secret), status="connected")


def test_ghost_connection_uses_a_signed_short_lived_token(monkeypatch):
    _client(monkeypatch, FakeGhost(), ad)
    steps, info = sp.verify_ghost("blog.example.org", f"{GHOST_ID}:{GHOST_SECRET}")
    assert [s["ok"] for s in steps] == [True, True, True] and info["site_name"] == "Clinic Blog" and info["version"] == "5.79"


def test_ghost_failures_are_explained(monkeypatch):
    _client(monkeypatch, FakeGhost(secret="00" * 16), ad)
    steps, info = sp.verify_ghost("blog.example.org", f"{GHOST_ID}:{GHOST_SECRET}")
    assert info is None and steps[-1]["step"] == "Sign in with the Admin API key" and "not the Content API key" in steps[-1]["detail"]
    steps, info = sp.verify_ghost("blog.example.org", "not-a-key")
    assert info is None and steps[0]["step"] == "Read the Admin API key" and "id:secret" in steps[0]["detail"]
    _client(monkeypatch, lambda r: httpx.Response(200, text="<html>not ghost</html>"), ad)
    steps, info = sp.verify_ghost("blog.example.org", f"{GHOST_ID}:{GHOST_SECRET}")
    assert info is None and steps[-1]["step"] == "Find the Ghost Admin API"


def test_ghost_publish_draft_publish_and_native_scheduling(monkeypatch):
    fake = FakeGhost()
    _client(monkeypatch, fake, ad)
    assert sp.publish(_ghost_row(), _article(), "draft", None)["status"] == "draft"
    live = sp.publish(_ghost_row(), _article(), "publish", None)
    assert live["status"] == "publish" and live["url"].endswith("/teeth-whitening/")
    when = datetime(2030, 3, 4, 9, 30, tzinfo=timezone(timedelta(hours=5, minutes=30)))
    sched = sp.publish(_ghost_row(), _article(), "schedule", when)
    params, post = fake.posts[-1]
    assert sched["status"] == "future" and post["status"] == "scheduled" and post["published_at"] == "2030-03-04T04:00:00.000Z" and params == {"source": "html"}
    assert post["html"].startswith("<h2>") and post["custom_excerpt"] == "A short guide." and {"name": "teeth whitening pune"} in post["tags"]
    _client(monkeypatch, FakeGhost(stale=True), ad)
    out = sp.publish(_ghost_row(), _article(), "publish", None)
    assert next(s for s in out["steps"] if s["step"] == "Confirm the post status")["ok"] is False and out["status"] == "draft"  # never reported as live


# ---------------------------------------------------------------- Shopify

class FakeShopify:
    def __init__(self, token="shpat_good", blogs=None, scopes=True):
        self.token, self.scopes, self.articles = token, scopes, []
        self.blogs = blogs if blogs is not None else [{"id": 11, "title": "Journal", "handle": "journal"}, {"id": 12, "title": "News", "handle": "news"}]

    def __call__(self, req: httpx.Request):
        if req.headers.get("x-shopify-access-token") != self.token:
            return httpx.Response(401, json={"errors": "[API] Invalid API key or access token"})
        p = req.url.path
        if p.endswith("/shop.json"):
            return httpx.Response(200, json={"shop": {"name": "Smile Store", "domain": "shop.smile.in"}})
        if p.endswith("/blogs.json"):
            return httpx.Response(200 if self.scopes else 403, json={"blogs": self.blogs})
        if p.endswith("/articles.json") and req.method == "POST":
            self.articles.append((p, json.loads(req.content)["article"]))
            return httpx.Response(201, json={"article": {"id": 99, "handle": "teeth-whitening-in-pune"}})
        return httpx.Response(404)


def _shop_row(**cfg):
    return SiteIntegration(business_id=1, method="shopify", base_url="https://smile.myshopify.com", secret_enc=crypto.seal("shpat_good"), status="connected",
                           config={"blog_id": "12", "blog_handle": "news", "public_domain": "shop.smile.in", **cfg})


def test_shopify_connection_finds_the_store_and_picks_the_blog(monkeypatch):
    _client(monkeypatch, FakeShopify(), ad)
    steps, info = sp.verify_shopify("https://Smile.myshopify.com/admin", "shpat_good")
    assert [s["ok"] for s in steps] == [True, True, True] and info["blog_id"] == "12" and info["blog_handle"] == "news"  # "news" is preferred over the first blog
    _, info = sp.verify_shopify("smile", "shpat_good", blog_id="11")
    assert info["blog_id"] == "11" and info["public_domain"] == "shop.smile.in"


def test_shopify_failures_are_explained(monkeypatch):
    _client(monkeypatch, FakeShopify(token="other"), ad)
    steps, info = sp.verify_shopify("smile.myshopify.com", "shpat_good")
    assert info is None and steps[-1]["step"] == "Sign in with the access token" and "write_content" in steps[-1]["detail"]
    _client(monkeypatch, FakeShopify(scopes=False), ad)
    assert "read_content" in sp.verify_shopify("smile.myshopify.com", "shpat_good")[0][-1]["detail"]
    _client(monkeypatch, FakeShopify(blogs=[]), ad)
    assert "no blog yet" in sp.verify_shopify("smile.myshopify.com", "shpat_good")[0][-1]["detail"]
    steps, info = sp.verify_shopify("https://smile.com", "t")
    assert info is None and ".myshopify.com" in steps[0]["detail"]  # a custom domain is not the Admin API address


def test_shopify_publish_draft_live_and_scheduled(monkeypatch):
    fake = FakeShopify()
    _client(monkeypatch, fake, ad)
    assert sp.publish(_shop_row(), _article(), "draft", None)["status"] == "draft" and fake.articles[-1][1]["published"] is False
    live = sp.publish(_shop_row(), _article(), "publish", None)
    assert live["status"] == "publish" and live["url"] == "https://shop.smile.in/blogs/news/teeth-whitening-in-pune" and fake.articles[-1][0].endswith("/blogs/12/articles.json")
    when = datetime(2030, 3, 4, 9, 30, tzinfo=timezone.utc)
    sched = sp.publish(_shop_row(), _article(), "schedule", when)
    art = fake.articles[-1][1]
    assert sched["status"] == "future" and art["published"] is True and art["published_at"].startswith("2030-03-04T09:30:00") and art["body_html"].startswith("<h2>") and "teeth whitening pune" in art["tags"]


# ---------------------------------------------------------------- API: connect, publish, schedule, scheduler

def _biz(client, site="https://acme.com"):
    return client.post("/api/v1/businesses", json={"name": "Acme Dental", "website": site, "primary_category": "Dentist"}).json()["id"]


def _article_row(db, bid, **kw):
    a = Article(business_id=bid, keyword="teeth whitening pune", title="Teeth whitening in Pune", body=ARTICLE_HTML, meta_description="A short guide.", status="completed", **kw)
    db.add(a)
    db.commit()
    return a


@pytest.fixture()
def db():
    s = SessionLocal()
    for m in (ScheduledPost, SiteIntegration, Article):
        s.query(m).delete()
    s.commit()
    yield s
    s.rollback()
    for m in (ScheduledPost, SiteIntegration, Article):
        s.query(m).delete()
    s.commit()
    s.close()


def test_connecting_github_saves_settings_hides_the_token_and_recheck_works(client, db, monkeypatch):
    _client(monkeypatch, FakeGitHub(), ad)
    bid = _biz(client)
    base = f"/api/v1/businesses/{bid}/site-integration"
    bad = client.post(f"{base}/connect", json={"method": "github", "url": "https://acme.com", "secret": "wrong", "config": {"repo": "acme/website"}}).json()
    assert bad["ok"] is False and bad["integration"]["status"] == "not_connected" and "rejected" in bad["steps"][-1]["detail"]
    assert client.post(f"{base}/connect", json={"method": "github", "url": "https://acme.com", "secret": "x"}).status_code == 400  # repo missing
    r = client.post(f"{base}/connect", json={"method": "github", "url": "acme.com", "secret": "ghp_good", "config": {"repo": "acme/website", "directory": "src/content/blog", "public_url": "https://acme.com/blog/{slug}"}}).json()
    assert r["ok"] and r["integration"]["status"] == "connected" and r["integration"]["method"] == "github"
    assert r["integration"]["config"] == {"repo": "acme/website", "branch": "main", "directory": "src/content/blog", "body_format": "markdown", "public_url": "https://acme.com/blog/{slug}"}
    assert "ghp_good" not in json.dumps(client.get(base).json())  # no secret ever leaves the server
    assert client.post(f"{base}/check").json()["ok"] is True
    client.delete(base)
    assert client.get(base).json()["status"] == "not_connected" and client.get(base).json()["config"] is None


def test_connecting_ghost_and_shopify_through_the_api(client, db, monkeypatch):
    bid = _biz(client)
    base = f"/api/v1/businesses/{bid}/site-integration"
    _client(monkeypatch, FakeGhost(), ad)
    g = client.post(f"{base}/connect", json={"method": "ghost", "url": "https://blog.example.org", "secret": f"{GHOST_ID}:{GHOST_SECRET}"}).json()
    assert g["ok"] and g["integration"]["method"] == "ghost" and g["integration"]["config"] == {"version": "5.79"}
    _client(monkeypatch, FakeShopify(), ad)
    s = client.post(f"{base}/connect", json={"method": "shopify", "url": "smile", "secret": "shpat_good"}).json()
    assert s["ok"] and s["integration"]["base_url"] == "https://smile.myshopify.com" and s["integration"]["config"]["blog_id"] == "12"


def test_publishing_through_the_api_uses_the_connected_method(client, db, monkeypatch):
    fake = FakeGhost()
    _client(monkeypatch, fake, ad)
    bid = _biz(client)
    base = f"/api/v1/businesses/{bid}/site-integration"
    client.post(f"{base}/connect", json={"method": "ghost", "url": "https://blog.example.org", "secret": f"{GHOST_ID}:{GHOST_SECRET}"})
    a = _article_row(db, bid)
    r = client.post(f"/api/v1/businesses/{bid}/articles/{a.id}/publish", json={"mode": "publish"}).json()
    assert r["status"] == "publish" and r["article"]["wp_url"].endswith("/teeth-whitening/") and fake.posts


def test_github_posts_are_scheduled_by_growzen_and_published_at_the_time(client, db, monkeypatch):
    fake = FakeGitHub()
    _client(monkeypatch, fake, ad)
    bid = _biz(client)
    base = f"/api/v1/businesses/{bid}/site-integration"
    client.post(f"{base}/connect", json={"method": "github", "url": "https://acme.com", "secret": "ghp_good", "config": {"repo": "acme/website"}})
    a = _article_row(db, bid)
    when = datetime.now(timezone.utc) + timedelta(hours=3)
    r = client.post(f"/api/v1/businesses/{bid}/articles/{a.id}/publish", json={"mode": "schedule", "scheduled_at": when.isoformat()}).json()
    assert r["status"] == "scheduled" and r["scheduled_post_id"] and not fake.commits and "GrowZen will publish" in r["steps"][-1]["detail"]
    assert client.post(f"/api/v1/businesses/{bid}/articles/{a.id}/publish", json={"mode": "schedule", "scheduled_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()}).status_code == 422
    assert sp.run_due_scheduled(db) == 0 and not fake.commits  # not yet due
    assert sp.run_due_scheduled(db, when + timedelta(minutes=1)) == 1 and len(fake.commits) == 1
    listed = client.get(f"{base}/scheduled").json()
    assert listed[0]["status"] == "published" and listed[0]["title"] == "Teeth whitening in Pune" and "github.com" in listed[0]["url"]
    assert listed[0]["due_at"].endswith("+00:00") or listed[0]["due_at"].endswith("Z")  # a zone is always stated, so a browser shows the right local time
    db.refresh(a)
    assert a.wp_url and "github.com" in a.wp_url
    assert sp.run_due_scheduled(db, when + timedelta(hours=1)) == 0  # never published twice


def test_a_failed_scheduled_post_is_retried_then_given_up_and_cancel_and_reschedule_work(client, db, monkeypatch):
    _client(monkeypatch, FakeGitHub(), ad)
    bid = _biz(client)
    base = f"/api/v1/businesses/{bid}/site-integration"
    client.post(f"{base}/connect", json={"method": "github", "url": "https://acme.com", "secret": "ghp_good", "config": {"repo": "acme/website"}})
    a = _article_row(db, bid)
    t1, t2 = datetime.now(timezone.utc) + timedelta(hours=1), datetime.now(timezone.utc) + timedelta(hours=2)
    first = client.post(f"/api/v1/businesses/{bid}/articles/{a.id}/publish", json={"mode": "schedule", "scheduled_at": t1.isoformat()}).json()["scheduled_post_id"]
    second = client.post(f"/api/v1/businesses/{bid}/articles/{a.id}/publish", json={"mode": "schedule", "scheduled_at": t2.isoformat()}).json()["scheduled_post_id"]
    statuses = {p["id"]: p["status"] for p in client.get(f"{base}/scheduled").json()}
    assert statuses[first] == "cancelled" and statuses[second] == "pending"  # scheduling again replaces the earlier time
    _client(monkeypatch, FakeGitHub(token="rotated"), ad)  # the token stopped working
    now = t2 + timedelta(minutes=1)
    for attempt in range(3):
        sp.run_due_scheduled(db, now + timedelta(minutes=11 * attempt))
    row = db.get(ScheduledPost, second)
    assert row.status == "failed" and row.attempts == 3 and "refused the token" in row.error
    other = client.post(f"/api/v1/businesses/{bid}/articles/{a.id}/publish", json={"mode": "schedule", "scheduled_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()}).json()["scheduled_post_id"]
    assert client.delete(f"{base}/scheduled/{other}").status_code == 204 and db.get(ScheduledPost, other).status == "cancelled"
    assert client.delete(f"{base}/scheduled/{other + 999}").status_code == 404


# ---------------------------------------------------------------- onboarding: the technology is read when the project is created

def test_creating_a_project_reads_its_website_in_the_background_and_a_changed_address_reads_it_again(client, db, monkeypatch):
    seen = []

    def site(req: httpx.Request):
        seen.append(req.url.host)
        if req.url.path == "/wp-json/":
            return httpx.Response(200, json={"namespaces": ["wp/v2"]}) if req.url.host == "wp.example.org" else httpx.Response(404)
        return httpx.Response(200, text='<meta name="generator" content="WordPress 6.5"><link href="/wp-content/themes/hello/a.css">' if req.url.host == "wp.example.org" else '<script src="/_next/static/a.js"></script>')
    monkeypatch.setattr(site_stack, "site_client", lambda timeout=15: httpx.Client(transport=httpx.MockTransport(site), follow_redirects=True, timeout=timeout))
    monkeypatch.setattr(site_onboarding, "autodetect_enabled", lambda: True)
    bid = _biz(client, "https://wp.example.org")  # the test client runs the background task before returning
    row = db.scalar(select(SiteIntegration).where(SiteIntegration.business_id == bid))
    assert row.platform == "wordpress" and row.method == "wordpress" and row.detected["version"] == "6.5" and row.status == "not_connected"
    client.patch(f"/api/v1/businesses/{bid}", json={"phone": "123"})  # unrelated change: no new request to the site
    n = len(seen)
    client.patch(f"/api/v1/businesses/{bid}", json={"phone": "456"})
    assert len(seen) == n
    client.patch(f"/api/v1/businesses/{bid}", json={"website": "https://app.example.org"})
    db.expire_all()
    row = db.scalar(select(SiteIntegration).where(SiteIntegration.business_id == bid))
    assert row.platform == "nextjs" and row.method == "github" and row.detected["publishing"]["direct"] is True


def test_detection_never_breaks_creation_and_never_overwrites_a_working_connection(client, db, monkeypatch):
    monkeypatch.setattr(site_onboarding, "autodetect_enabled", lambda: True)
    def down(req):
        raise httpx.ConnectError("refused")
    monkeypatch.setattr(site_stack, "site_client", lambda timeout=15: httpx.Client(transport=httpx.MockTransport(down), timeout=timeout))
    bid = _biz(client, "https://down.example.org")  # the site is unreachable: the project is still created
    row = db.scalar(select(SiteIntegration).where(SiteIntegration.business_id == bid))
    assert row.detected["reachable"] is False and row.platform == "unknown"
    row.method, row.status = "wordpress", "connected"  # a user connected it by hand
    db.commit()
    monkeypatch.setattr(site_stack, "site_client", lambda timeout=15: httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, text='<script src="/_next/static/a.js"></script>')), timeout=timeout))
    r = client.post(f"/api/v1/businesses/{bid}/site-integration/detect", json={}).json()
    assert r["platform"] == "nextjs" and r["method"] == "wordpress" and r["status"] == "connected"  # the working connection's method is untouched


def test_the_scheduler_tick_publishes_a_due_post_without_anyone_clicking(client, db, monkeypatch):
    from app.services import scheduler
    fake = FakeGitHub()
    _client(monkeypatch, fake, ad)
    bid = _biz(client)
    client.post(f"/api/v1/businesses/{bid}/site-integration/connect", json={"method": "github", "url": "https://acme.com", "secret": "ghp_good", "config": {"repo": "acme/website"}})
    a = _article_row(db, bid)
    db.add(ScheduledPost(business_id=bid, article_id=a.id, method="github", due_at=datetime.now(timezone.utc) - timedelta(minutes=1)))
    db.commit()
    out = scheduler.tick()
    assert out["posts"] == 1 and len(fake.commits) == 1
    assert db.scalar(select(ScheduledPost).where(ScheduledPost.article_id == a.id)).status == "published"
