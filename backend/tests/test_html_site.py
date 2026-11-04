"""HTML Website: four settings, six separate read-only validation results, article storage detection (a script list
with ?post= URLs, or one page per article), deployment adapters, test deployment, publishing in both modes (existing
articles kept, duplicates avoided, nothing else written) and manual export. SIMULATED sites and APIs only."""
import hashlib
import io
import json
import shutil
import subprocess
import zipfile

import httpx
import pytest

from app.db import SessionLocal
from app.models import Article, Business, SiteIntegration
from app.routers import html_site
from app.services import html_deploy as hd, html_publisher as hp

PAGE_LISTING = """<!doctype html><html><head><title>Our Blog | Acme</title></head><body>
<a href="blog/first-post.html">First</a> <a href="/blog/second-post.html">Second</a> <a href="https://other.com/blog/x.html">x</a>
<a href="https://acme-html.com/blog/third-post.html">Third</a> <a href="about.html">About</a></body></html>"""


def _site(handler):
    return lambda timeout=20: httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True, timeout=timeout)


def page_site(req: httpx.Request):
    if req.url.path in ("/", ""):
        return httpx.Response(200, text="<html>home</html>", headers={"content-type": "text/html"})
    if req.url.path == "/blog.html":
        return httpx.Response(200, text=PAGE_LISTING, headers={"content-type": "text/html; charset=utf-8"})
    if req.url.path.startswith("/blog/"):
        return httpx.Response(200, text="<html>post</html>", headers={"content-type": "text/html"})
    return httpx.Response(404, text="nope")


@pytest.fixture()
def biz(client, monkeypatch, tmp_path):
    monkeypatch.setattr(hd, "_config_path", lambda: tmp_path / "html_deploy.json")  # never the real server config in tests
    bid = client.post("/api/v1/businesses", json={"name": "Acme Html", "website": "https://acme-html.com", "primary_category": "IT"}).json()["id"]
    yield bid, f"/api/v1/businesses/{bid}/html-site", tmp_path
    s = SessionLocal()
    s.query(Article).filter(Article.business_id == bid).delete()
    s.query(SiteIntegration).filter(SiteIntegration.business_id == bid).delete()
    s.query(Business).filter(Business.id == bid).delete()
    s.commit()
    s.close()


@pytest.fixture(autouse=True)
def _backups_in_tmp(tmp_path, monkeypatch):
    monkeypatch.setattr(hp, "BACKUP_ROOT", tmp_path / "backups")  # never the real uploads folder


FORM = {"website_name": "Acme", "website_url": "acme-html.com", "listing_file": "/blog.html", "articles_folder": "blog/"}
SIX = ["Website reachable", "Blog listing file found", "Article folder accessible", "Existing articles detected", "Deployment connection configured", "Test deployment successful"]


def _steps(r):
    return {x["step"]: x for x in r["steps"]}


def test_six_separate_results_page_mode_and_manual_export_without_a_deployment(client, biz, monkeypatch):
    bid, base, _ = biz
    monkeypatch.setattr(html_site, "site_client", _site(page_site))
    assert client.get(base).json() == {"status": "not_connected", "publishing": "not_configured"}
    r = client.put(base, json=FORM).json()
    assert list(_steps(r)) == SIX
    c = r["connection"]
    assert r["ok"] and c["status"] == "connected" and c["article_mode"] == "pages" and c["article_count"] == 3  # not other.com
    assert c["article_url_pattern"] == "https://acme-html.com/blog/<article-slug>.html"
    assert c["deployment"]["adapter"] == "manual" and c["publishing"] == "manual"
    s = SessionLocal()
    row = s.query(SiteIntegration).filter_by(business_id=bid).one()
    assert row.method is None and row.status == "not_connected" and set(row.config) == {"html_site"}  # WordPress side untouched
    s.close()


def test_invalid_values_are_refused_with_a_clear_message(client, biz, monkeypatch):
    _, base, _ = biz
    monkeypatch.setattr(html_site, "site_client", _site(page_site))
    for bad, word in ((dict(FORM, website_url="ftp://acme.com"), "Website URL"), (dict(FORM, website_url="https://acme.com/blog"), "without a page path"),
                      (dict(FORM, listing_file="blog.php"), ".html file"), (dict(FORM, listing_file="../etc/passwd.html"), "no '..'"),
                      (dict(FORM, articles_folder="blog/post.html"), "not a file"), (dict(FORM, articles_folder="bl og"), "letters, numbers")):
        r = client.put(base, json=bad)
        assert r.status_code == 422 and word in r.json()["detail"], (bad, r.text)
    assert client.get(base).json()["status"] == "not_connected"


def test_missing_listing_spa_fallback_private_and_unreachable_sites_fail_clearly(client, biz, monkeypatch):
    _, base, _ = biz
    monkeypatch.setattr(html_site, "site_client", _site(page_site))
    assert "answered 404" in client.put(base, json=dict(FORM, listing_file="news.html")).json()["connection"]["last_error"]
    spa = lambda req: httpx.Response(200, text="<!doctype html><div id=root></div>", headers={"content-type": "text/html"})  # noqa: E731
    monkeypatch.setattr(html_site, "site_client", _site(spa))
    assert "same page as the home page" in client.put(base, json=FORM).json()["connection"]["last_error"]
    monkeypatch.setattr(html_site, "site_client", _site(lambda req: httpx.Response(401, text="Login Redirect")))
    assert "private or password-protected" in client.put(base, json=FORM).json()["connection"]["last_error"]
    monkeypatch.setattr(html_site, "site_client", _site(lambda req: (_ for _ in ()).throw(httpx.ConnectError("refused"))))
    assert "Could not reach the website" in client.put(base, json=FORM).json()["connection"]["last_error"]


def test_links_count_when_requests_are_pinned_to_an_ip(client, biz, monkeypatch):
    _, base, _ = biz
    page = '<!doctype html><html><head><title>Blog</title></head><body><a href="/blog/">Blog</a><a href="/blog/getting-started/">Read</a></body></html>'

    class Pinned(httpx.MockTransport):
        def handle_request(self, request):
            request.url = request.url.copy_with(host="13.215.239.219")  # what url_safety._pin does
            return super().handle_request(request)
    handler = lambda req: httpx.Response(200, text=page if req.url.path == "/blog.html" else "<html>x</html>", headers={"content-type": "text/html"})  # noqa: E731
    monkeypatch.setattr(html_site, "site_client", lambda timeout=20: httpx.Client(transport=Pinned(handler), timeout=timeout))
    c = client.put(base, json=FORM).json()["connection"]
    assert c["article_count"] == 1 and c["article_url_pattern"] == "https://acme-html.com/blog/<article-slug>/"


def test_wordpress_connect_and_disconnect_keep_the_html_settings(client, biz, monkeypatch):
    bid, base, _ = biz
    monkeypatch.setattr(html_site, "site_client", _site(page_site))
    client.put(base, json=FORM)
    s = SessionLocal()
    row = s.query(SiteIntegration).filter_by(business_id=bid).one()
    row.method, row.status, row.config = "github", "connected", {**row.config, "repo": "acme/site"}
    s.commit()
    assert client.get(f"/api/v1/businesses/{bid}/site-integration").json()["config"] == {"repo": "acme/site"}
    client.delete(f"/api/v1/businesses/{bid}/site-integration")
    assert client.get(base).json()["status"] == "connected"
    client.delete(base)
    s.expire_all()
    assert s.query(SiteIntegration).filter_by(business_id=bid).one().config is None
    s.close()


# ── a site like sachspune.com: articles in js/data.js, shown by js/main.js on blog.html?post=<slug> ─────────────

DATA_LISTING = """<!doctype html><html><head><title>Blog – Supreme Aangan CHS</title><link rel="stylesheet" href="css/style.css"></head><body>
<header>Supreme Aangan</header><div id="blog-list"><div id="bchips"></div><div id="bgrid"></div></div><div id="blog-post" class="hidden"><div id="post"></div></div>
<script src="js/data.js?v=3"></script><script src="js/main.js?v=3"></script><script src="https://img1.wsimg.com/traffic-assets/js/tccl.min.js"></script></body></html>"""
DATA_JS = """/* EDIT THIS FILE to update the website content */
window.SITE = {
  name: "Supreme Aangan Co-operative Housing Society Ltd.",
  notices: [
    { id: 1, title: "AGM notice", date: "01 Nov 2026", text: "Meeting at 6 pm" }
  ],
  /* BLOG POSTS – newest first. */
  blog: [
    {
      slug: "redevelopment-guide-for-members",
      title: "Redevelopment Explained: A Simple Guide for Every Member",
      date: "02 Nov 2026",
      author: "Redevelopment Committee",
      cat: "Guide",
      read: "6 min read",
      cover: "linear-gradient(135deg,#0b3b7a,#2f66c9 55%,#8fb3de)",
      icon: "🏗️",
      excerpt: "What redevelopment really means.",
      body: `
<p>Over the last year, many members asked: <i>What happens?</i> It costs ${'{'}nothing{'}'} — see `code`.</p>
`
    }
  ],
  members: [ { flat: "J-103", name: "Demo" } ]
};
""".replace("${'{'}nothing{'}'}", "nothing").replace("`code`", "the plan")
MAIN_JS = """if(page==='blog'){ const card = p=>`<a class="bcard" href="blog.html?post=${encodeURIComponent(p.slug)}"><h3>${esc(p.title)}</h3></a>`; }"""


def data_site(req: httpx.Request):
    p = req.url.path
    if p in ("/", ""):
        return httpx.Response(200, text="<html>home</html>", headers={"content-type": "text/html"})
    if p == "/blog.html":
        return httpx.Response(200, text=DATA_LISTING, headers={"content-type": "text/html"})
    if p == "/js/data.js":
        return httpx.Response(200, text=DATA_JS, headers={"content-type": "application/javascript"})
    if p == "/js/main.js":
        return httpx.Response(200, text=MAIN_JS, headers={"content-type": "application/javascript"})
    return httpx.Response(404, text="nope")


SACHS = {"website_name": "Supreme Aangan CHS", "website_url": "https://acme-html.com", "listing_file": "blog.html", "articles_folder": "blog"}


def test_query_parameter_sites_are_detected_from_the_scripts(client, biz, monkeypatch):
    _, base, _ = biz
    monkeypatch.setattr(html_site, "site_client", _site(data_site))
    r = client.put(base, json=SACHS).json()
    st, c = _steps(r), r["connection"]
    assert list(st) == SIX and r["ok"]
    assert c["article_mode"] == "data" and c["article_store"] == "js/data.js" and c["article_count"] == 1
    assert c["article_url_pattern"] == "https://acme-html.com/blog.html?post=<article-slug>"  # not /blog/<slug>.html
    assert "blog.html?post=redevelopment-guide-for-members" in st["Existing articles detected"]["detail"] and not st["Existing articles detected"].get("warning")
    assert "keeps its articles in js/data.js" in st["Article folder accessible"]["detail"]


def test_data_entry_matches_the_site_format_keeps_existing_articles_and_is_valid_js():
    info = {"title": "AGM 2026: What Members Should Know", "description": "Key points before the AGM.", "body": "<p>Use `backticks` and ${notavar} safely.</p>",
            "now": __import__("datetime").datetime(2026, 11, 4), "minutes": 3, "category": "Meetings", "author": "Supreme Aangan CHS", "id": 42, "keywords": ["agm"]}
    js, slug, note = hp.write_data(DATA_JS, "blog", "slug", info, "agm-2026-what-members-should-know", None, 42)
    assert slug == "agm-2026-what-members-should-know" and "top of the 'blog' list" in note
    assert DATA_JS.split("blog: [")[1].split("members:")[0].strip()[1:] in js  # the existing article, byte for byte
    assert js.index("agm-2026") < js.index("redevelopment-guide-for-members")  # newest first
    assert 'date: "04 Nov 2026"' in js and 'read: "3 min read"' in js and 'cat: "Meetings"' in js and 'cover: linear-gradient' not in js
    assert "\\`backticks\\`" in js and "\\${notavar}" in js and "growzenId: 42" in js
    # publishing again replaces GrowZen's own entry; a slug that belongs to another article is never reused
    again, slug2, note2 = hp.write_data(js, "blog", "slug", {**info, "title": "AGM 2026 (updated)"}, slug, None, 42)
    assert again.count("growzenId: 42") == 1 and "AGM 2026 (updated)" in again and "Updated GrowZen's earlier entry" in note2
    clash, slug3, _ = hp.write_data(DATA_JS, "blog", "slug", info, "redevelopment-guide-for-members", None, 7)
    assert slug3 == "redevelopment-guide-for-members-2" and clash.count('slug: "redevelopment-guide-for-members"') == 1
    if shutil.which("node"):  # the result really is JavaScript the site can load
        out = subprocess.run(["node", "-e", "global.window={};eval(require('fs').readFileSync(0,'utf8'));const b=window.SITE.blog;"
                              "console.log(JSON.stringify([b.length,b[0].slug,b[0].body.includes('`backticks`'),b[1].slug,window.SITE.members.length]))"],
                             input=again, capture_output=True, text=True, encoding="utf-8", timeout=20)
        assert json.loads(out.stdout) == [2, "agm-2026-what-members-should-know", True, "redevelopment-guide-for-members", 1], out.stderr


def test_bump_version_changes_only_the_data_script_version():
    out = hp.bump_version(DATA_LISTING, "js/data.js")
    assert 'src="js/data.js?v=4"' in out and 'src="js/main.js?v=3"' in out and out.replace("data.js?v=4", "data.js?v=3") == DATA_LISTING


# ── publishing through an adapter (both modes) ──────────────────────────────────

HEADER = '<header class="site-header"><a href="/">Acme</a><nav><a href="/blog.html">Blog</a></nav></header>'
FOOTER = '<footer class="site-footer">© Acme</footer>'
ARTICLE_PAGE = f"""<!doctype html><html><head><title>First Post | Acme</title><link rel="stylesheet" href="../../assets/site.css">
<meta name="description" content="old"><link rel="canonical" href="https://acme-html.com/blog/first-post/"></head><body>{HEADER}<main><article class="post">
<span class="tag">Design</span><h1 class="post-title">First Post</h1><p class="meta">By Acme Team · March 3, 2026 · 4 min read</p>
<img class="cover" src="../images/first.webp" alt="first"><div class="post-body"><p>Old text one.</p><p>Old text two.</p></div>
<a class="back" href="../">Back to blog</a></article></main>{FOOTER}</body></html>"""
LISTING_SRC = f"""<!doctype html><html><head><title>Blog | Acme</title></head><body>{HEADER}<main><h1>Blog</h1><div class="grid">
<article class="card"><span class="tag">Design</span><h2><a href="/blog/first-post/">First Post</a></h2><p class="meta">March 3, 2026 · 4 min read</p>
<p class="excerpt">An excerpt of the first post that is long enough to count.</p><a href="/blog/first-post/">Read more</a></article>
</div></main>{FOOTER}</body></html>"""


class MemorySite(hd.Deployer):
    name, rebuilds = "memory", True

    def __init__(self, files):
        super().__init__({}, "https://acme-html.com")
        self.files, self.writes = dict(files), []

    def _k(self, p):
        return f"{self.root}/{p}" if self.root else p

    def list_paths(self):
        pre = f"{self.root}/" if self.root else ""
        return [k[len(pre):] for k in self.files if k.startswith(pre)]

    def read(self, path):
        return self.files.get(self._k(path))

    def write(self, files, message):
        self.writes.append(sorted(files))
        for p, d in files.items():
            self.files[self._k(p)] = d
        return f"memory: {len(files)} file(s)"

    def check(self):
        return "memory ok"


def _env(client, biz, monkeypatch, files, live):
    bid, base, tmp = biz
    (tmp / "html_deploy.json").write_text(json.dumps({"acme-html.com": {"adapter": "ftp", "host": "ftp.acme-html.com", "user": "u", "password": "secret-pass-123"}}))
    mem = MemorySite(files)
    monkeypatch.setattr(hd, "for_site", lambda url, stored=None: mem)
    monkeypatch.setattr(html_site.hd, "for_site", lambda url, stored=None: mem)
    monkeypatch.setattr(html_site, "site_client", _site(live))
    monkeypatch.setattr(hp, "site_client", _site(live))
    monkeypatch.setattr(hp, "_wait_live", lambda url, needle, seconds: any(needle in d.decode("utf-8", "replace") for d in mem.files.values()))

    monkeypatch.setattr(hp, "_spawn", lambda fn, *args: fn(*args))  # background jobs run at once
    s = SessionLocal()
    a = Article(business_id=bid, keyword="my new article", title="My New Article", meta_description="What this new article is about, in one sentence.",
                body="<h1>My New Article</h1><p>Intro.</p><h2>Part</h2><p>Body text.</p>", status="completed", topic="growth tips")
    s.add(a)
    s.commit()
    aid = a.id
    s.close()
    return base, mem, aid


def _page_env(client, biz, monkeypatch):
    files = {"dist/blog.html": LISTING_SRC.encode(), "dist/blog/first-post/index.html": ARTICLE_PAGE.encode(),
             "dist/blog/my-new-article/index.html": b"<html>someone else's page</html>", "dist/assets/site.css": b"body{}",
             "src/blog.html": b"<html><title>draft copy</title></html>", "README.md": b"x"}
    live = lambda req: httpx.Response(200, text=LISTING_SRC if req.url.path == "/blog.html" else ARTICLE_PAGE if req.url.path.startswith("/blog/") else "<html>home</html>",  # noqa: E731
                                      headers={"content-type": "text/html"})
    return _env(client, biz, monkeypatch, files, live)


def test_publishing_is_not_connected_until_a_real_test_deployment_succeeds(client, biz, monkeypatch):
    base, mem, aid = _page_env(client, biz, monkeypatch)
    c = client.put(base, json=FORM).json()["connection"]
    assert c["deployment"]["adapter"] == "ftp" and c["deployment"]["target"] == "ftp.acme-html.com" and c["publishing"] == "test_needed"
    assert "secret-pass-123" not in json.dumps(client.get(base).json())  # credentials never leave the server
    assert client.post(f"{base}/articles/{aid}/publish").status_code == 409
    client.post(f"{base}/test-deploy")
    c = client.get(base).json()
    assert c["deployment"]["test"]["status"] == "ok" and c["publishing"] == "connected"
    assert mem.files["dist/.well-known/growzen-deploy-check.txt"].startswith(b"GrowZen deployment check")  # into the served root
    assert _steps(client.post(f"{base}/check").json())["Test deployment successful"]["ok"]


def test_page_mode_publish_reuses_the_design_avoids_duplicates_and_touches_nothing_else(client, biz, monkeypatch):
    base, mem, aid = _page_env(client, biz, monkeypatch)
    client.put(base, json=FORM)
    client.post(f"{base}/test-deploy")
    untouched = {k: v for k, v in mem.files.items() if k != "dist/blog.html"}
    client.post(f"{base}/articles/{aid}/publish")
    st = client.get(f"{base}/articles/{aid}").json()
    assert st["status"] == "published", st
    assert st["url"] == "https://acme-html.com/blog/my-new-article-2/" and mem.files["dist/blog/my-new-article/index.html"] == b"<html>someone else's page</html>"
    page = mem.files["dist/blog/my-new-article-2/index.html"].decode()
    assert HEADER in page and FOOTER in page and 'href="/assets/site.css"' in page and "<title>My New Article | Acme</title>" in page
    assert 'class="post-title">My New Article</h1>' in page and "Old text" not in page and "Body text." in page and page.count("<h1") == 1
    listing = mem.files["dist/blog.html"].decode()
    assert listing.count('class="card"') == 2 and listing.index("My New Article") < listing.index("First Post")
    for k, v in untouched.items():
        assert mem.files[k] == v, k
    client.post(f"{base}/articles/{aid}/publish")  # again: the same page and card, no duplicate
    assert mem.files["dist/blog.html"].decode().count('class="card"') == 2 and mem.writes[-1] == ["blog.html", "blog/my-new-article-2/index.html"]


def test_data_mode_publish_adds_one_entry_keeps_the_rest_and_refreshes_the_cache(client, biz, monkeypatch):
    files = {"public_html/blog.html": DATA_LISTING.encode(), "public_html/js/data.js": DATA_JS.encode(), "public_html/js/main.js": MAIN_JS.encode(),
             "public_html/css/style.css": b"body{}", "public_html/index.html": b"<html>home</html>"}
    base, mem, aid = _env(client, biz, monkeypatch, files, data_site)
    mem.root = ""
    monkeypatch.setattr(mem, "list_paths", lambda: None)  # like FTP: the web folder (public_html) is found by trying
    client.put(base, json=SACHS)
    client.post(f"{base}/test-deploy")
    assert client.get(base).json()["publishing"] == "connected" and "public_html/.well-known/growzen-deploy-check.txt" in mem.files
    before = dict(mem.files)
    client.post(f"{base}/articles/{aid}/publish")
    st = client.get(f"{base}/articles/{aid}").json()
    assert st["status"] == "published" and st["mode"] == "data" and st["url"] == "https://acme-html.com/blog.html?post=my-new-article", st
    js = mem.files["public_html/js/data.js"].decode()
    assert js.count("growzenId:") == 1 and 'slug: "my-new-article"' in js and "redevelopment-guide-for-members" in js and 'notices: [' in js
    assert mem.files["public_html/blog.html"].decode() == DATA_LISTING.replace("data.js?v=3", "data.js?v=4")  # only the version changed
    changed = {k for k in mem.files if mem.files[k] != before.get(k)}
    assert changed == {"public_html/js/data.js", "public_html/blog.html"}  # no image (the article has none), nothing else
    client.post(f"{base}/articles/{aid}/publish")  # republish: still one entry
    assert mem.files["public_html/js/data.js"].decode().count("growzenId:") == 1


def test_a_failed_upload_is_reported_and_nothing_stays_publishing(client, biz, monkeypatch):
    base, mem, aid = _page_env(client, biz, monkeypatch)
    client.put(base, json=FORM)
    client.post(f"{base}/test-deploy")
    monkeypatch.setattr(mem, "write", lambda files, message: (_ for _ in ()).throw(hd.DeployError("FTP: 530 Login incorrect")))
    client.post(f"{base}/articles/{aid}/publish")
    st = client.get(f"{base}/articles/{aid}").json()
    assert st["status"] == "failed" and "530" in st["error"]


def test_manual_export_zip_contains_only_the_changed_files(client, biz, monkeypatch):
    bid, base, tmp = biz
    monkeypatch.setattr(html_site, "site_client", _site(data_site))
    monkeypatch.setattr(hp, "site_client", _site(data_site))
    client.put(base, json=SACHS)
    s = SessionLocal()
    a = Article(business_id=bid, keyword="agm", title="AGM Notes", meta_description="d", body="<p>x</p>", status="completed")
    s.add(a)
    s.commit()
    r = client.get(f"{base}/articles/{a.id}/export")
    s.close()
    assert r.status_code == 200 and sorted(zipfile.ZipFile(io.BytesIO(r.content)).namelist()) == ["GROWZEN-README.txt", "blog.html", "js/data.js"]
    assert client.get(f"{base}/articles/{a.id}").json()["status"] == "exported"


# ── adapters against simulated APIs ─────────────────────────────────────────────

def test_github_adapter_writes_all_files_in_one_commit(monkeypatch):
    calls = []

    def api(req: httpx.Request):
        calls.append((req.method, req.url.path))
        p = req.url.path
        if p == "/repos/acme/site":
            return httpx.Response(200, json={"default_branch": "main", "permissions": {"push": True}})
        if p.endswith("/git/ref/heads/main"):
            return httpx.Response(200, json={"object": {"sha": "c0"}})
        if p.endswith("/git/commits/c0"):
            return httpx.Response(200, json={"tree": {"sha": "t0"}})
        if p.endswith("/git/blobs"):
            return httpx.Response(201, json={"sha": hashlib.sha1(req.content).hexdigest()})
        if p.endswith("/git/trees"):
            assert {x["path"] for x in json.loads(req.content)["tree"]} == {"dist/a.html", "dist/b.html"}
            return httpx.Response(201, json={"sha": "t1"})
        if p.endswith("/git/commits"):
            return httpx.Response(201, json={"sha": "c1abcdef"})
        if p.endswith("/git/refs/heads/main"):
            return httpx.Response(200, json={})
        return httpx.Response(404)
    monkeypatch.setattr(hd, "site_client", _site(api))
    assert "c1abcde" in hd.GitHub({"repo": "acme/site", "token": "t", "root": "dist"}).write({"a.html": b"A", "b.html": b"B"}, "msg")
    assert sum(1 for m, p in calls if p.endswith("/git/commits") and m == "POST") == 1


def test_netlify_adapter_keeps_every_other_live_file(monkeypatch):
    live, seen = {"/index.html": "aaa", "/blog.html": "bbb", "/assets/site.css": "ccc"}, {}

    def api(req: httpx.Request):
        p = req.url.path
        if p == "/api/v1/sites/drop.netlify.app/files":
            return httpx.Response(200, json=[{"path": k, "sha": v} for k, v in live.items()])
        if p == "/api/v1/sites/drop.netlify.app/deploys":
            seen["manifest"] = json.loads(req.content)["files"]
            return httpx.Response(200, json={"id": "dep1", "required": [hashlib.sha1(b"NEW").hexdigest()]})
        if p.startswith("/api/v1/deploys/dep1/files"):
            seen.setdefault("uploaded", []).append(p)
            return httpx.Response(200, json={})
        return httpx.Response(200, json={"state": "ready"}) if p == "/api/v1/deploys/dep1" else httpx.Response(404)
    monkeypatch.setattr(hd, "site_client", _site(api))
    hd.Netlify({"token": "t"}, "https://drop.netlify.app").write({"blog/new/index.html": b"NEW", "blog.html": b"bbb-changed"}, "msg")
    m = seen["manifest"]
    assert m["/index.html"] == "aaa" and m["/assets/site.css"] == "ccc" and seen["uploaded"] == ["/api/v1/deploys/dep1/files/blog/new/index.html"]


def test_config_entries_env_secrets_and_unknown_adapters(monkeypatch, tmp_path):
    cfg = tmp_path / "d.json"
    cfg.write_text(json.dumps({"a.com": {"adapter": "ftp", "host": "ftp.a.com", "user": "u", "password_env": "GZ_TEST_PW"}, "b.com": {"adapter": "rsync"}}))
    monkeypatch.setattr(hd, "_config_path", lambda: cfg)
    monkeypatch.setenv("GZ_TEST_PW", "from-env")
    assert hd.load_entry("https://www.a.com")["password"] == "from-env"
    assert hd.describe(hd.load_entry("https://a.com")) == {"adapter": "ftp", "label": "FTP", "target": "ftp.a.com", "configured": True}
    with pytest.raises(hd.DeployError):
        hd.for_site("https://b.com")
    assert hd.for_site("https://c.com").name == "manual"
