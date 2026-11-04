"""SFTP deployment of an HTML website (e.g. GoDaddy cPanel), against a REAL local SFTP server (paramiko) serving a
temporary folder laid out like a cPanel account: <home>/public_html/{blog.html, js/data.js, ...}.

Covers: password and key sign-in, host key pinning, a refused password, website folder detection, atomic uploads,
encrypted settings that are never returned, Test connection, test deployment, Publish now (data mode: the article is
added to js/data.js, existing articles kept, blog.html only gets a new data.js version) and scheduled publishing."""
import io
import json
import os
import socket
import threading
from datetime import datetime, timedelta, timezone

import httpx
import paramiko
import pytest

from app.db import SessionLocal
from app.models import Article, Business, ScheduledPost, SiteIntegration
from app.routers import html_site
from app.services import article_schedule as asch, html_deploy as hd, html_publisher as hp, site_publish as sp
from test_html_site import DATA_JS, DATA_LISTING, MAIN_JS  # the sachspune.com-like site used by the HTML tests

USER, PASSWORD = "deploy", "s3cret-Passw0rd!"


@pytest.fixture(autouse=True)
def _backups_in_tmp(tmp_path, monkeypatch):
    monkeypatch.setattr(hp, "BACKUP_ROOT", tmp_path / "backups")  # never the real uploads folder


# ── a minimal SFTP server over a folder ─────────────────────────────────────────

def _server_factory(root: str, client_key: paramiko.PKey):
    class Handle(paramiko.SFTPHandle):
        def stat(self):
            return paramiko.SFTPAttributes.from_stat(os.fstat(self.readfile.fileno()))

    class FS(paramiko.SFTPServerInterface):
        def _real(self, path):
            p = os.path.normpath(os.path.join(root, path.lstrip("/")))
            if not p.startswith(os.path.normpath(root)):
                raise PermissionError(path)
            return p

        def canonicalize(self, path):
            return "/" + os.path.relpath(self._real(path), root).replace("\\", "/").lstrip(".")

        def list_folder(self, path):
            try:
                real = self._real(path)
                return [paramiko.SFTPAttributes.from_stat(os.stat(os.path.join(real, f)), f) for f in os.listdir(real)]
            except OSError as e:
                return paramiko.SFTPServer.convert_errno(e.errno)

        def stat(self, path):
            try:
                return paramiko.SFTPAttributes.from_stat(os.stat(self._real(path)))
            except OSError as e:
                return paramiko.SFTPServer.convert_errno(e.errno)

        lstat = stat

        def open(self, path, flags, attr):
            path = self._real(path)
            try:
                fd = os.open(path, flags | getattr(os, "O_BINARY", 0), 0o666)
            except OSError as e:
                return paramiko.SFTPServer.convert_errno(e.errno)
            mode = ("ab" if flags & os.O_APPEND else "wb") if flags & os.O_WRONLY else ("r+b" if flags & os.O_RDWR else "rb")
            f = os.fdopen(fd, mode)
            h = Handle(flags)
            h.filename, h.readfile, h.writefile = path, f, f
            return h

        def remove(self, path):
            try:
                os.remove(self._real(path))
            except OSError as e:
                return paramiko.SFTPServer.convert_errno(e.errno)
            return paramiko.SFTP_OK

        def rename(self, old, new):
            try:
                os.rename(self._real(old), self._real(new))
            except OSError as e:
                return paramiko.SFTPServer.convert_errno(e.errno)
            return paramiko.SFTP_OK

        def posix_rename(self, old, new):
            try:
                os.replace(self._real(old), self._real(new))
            except OSError as e:
                return paramiko.SFTPServer.convert_errno(e.errno)
            return paramiko.SFTP_OK

        def mkdir(self, path, attr):
            try:
                os.mkdir(self._real(path))
            except OSError as e:
                return paramiko.SFTPServer.convert_errno(e.errno)
            return paramiko.SFTP_OK

    class Auth(paramiko.ServerInterface):
        def check_auth_password(self, username, password):
            return paramiko.AUTH_SUCCESSFUL if (username, password) == (USER, PASSWORD) else paramiko.AUTH_FAILED

        def check_auth_publickey(self, username, key):
            return paramiko.AUTH_SUCCESSFUL if username == USER and key.get_base64() == client_key.get_base64() else paramiko.AUTH_FAILED

        def get_allowed_auths(self, username):
            return "password,publickey"

        def check_channel_request(self, kind, chanid):
            return paramiko.OPEN_SUCCEEDED if kind == "session" else paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

    return FS, Auth


@pytest.fixture(scope="module")
def keys():
    return paramiko.RSAKey.generate(2048), paramiko.RSAKey.generate(2048)  # (server host key, client key)


@pytest.fixture()
def sftp_server(tmp_path, keys):
    host_key, client_key = keys
    home = tmp_path / "home"
    (home / "public_html" / "js").mkdir(parents=True)
    for rel, text in (("blog.html", DATA_LISTING), ("js/data.js", DATA_JS), ("js/main.js", MAIN_JS), ("index.html", "<html>home</html>")):
        (home / "public_html" / rel).write_bytes(text.encode("utf-8"))  # bytes: no Windows newline conversion
    (home / "mail").mkdir()
    FS, Auth = _server_factory(str(home), client_key)
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sock.listen(8)
    stop = threading.Event()

    def serve():
        while not stop.is_set():
            try:
                conn, _ = sock.accept()
            except OSError:
                return
            t = paramiko.Transport(conn)
            t.add_server_key(host_key)
            t.set_subsystem_handler("sftp", paramiko.SFTPServer, FS)
            try:
                t.start_server(server=Auth())
            except (paramiko.SSHException, EOFError, OSError):
                continue
    threading.Thread(target=serve, daemon=True).start()
    yield {"port": sock.getsockname()[1], "home": home, "host_key": hd.host_key_fingerprint(host_key), "client_key": client_key}
    stop.set()
    sock.close()


def _cfg(srv, **kw):
    return {"adapter": "sftp", "host": "127.0.0.1", "port": srv["port"], "user": USER, "password": PASSWORD, **kw}


# ── the adapter itself ──────────────────────────────────────────────────────────

def test_sftp_sign_in_host_key_folder_detection_and_atomic_uploads(sftp_server):
    srv = sftp_server
    dep = hd.SFTP(_cfg(srv))
    assert "Signed in to 127.0.0.1 as deploy" in dep.check() and dep.host_key == srv["host_key"]
    assert hp.find_root(dep, "blog.html", DATA_LISTING) == "public_html"  # found by itself (cPanel's web folder)
    dep.root = "public_html"
    assert dep.read("js/data.js").decode() == DATA_JS and dep.read("nope.txt") is None
    dep.write({"blog/images/a.webp": b"IMG", "js/data.js": b"NEW"}, "msg")
    assert (srv["home"] / "public_html" / "blog" / "images" / "a.webp").read_bytes() == b"IMG"  # folders created
    assert (srv["home"] / "public_html" / "js" / "data.js").read_bytes() == b"NEW"
    assert not list(srv["home"].rglob("*.growzen-upload"))  # temp names renamed away
    assert (srv["home"] / "public_html" / "index.html").read_bytes().decode("utf-8") == "<html>home</html>"  # untouched


def test_sftp_refuses_a_wrong_password_and_a_changed_host_key(sftp_server):
    srv = sftp_server
    with pytest.raises(hd.DeployError, match="refused the username, password or key"):
        hd.SFTP(_cfg(srv, password="wrong")).check()
    with pytest.raises(hd.DeployError, match="host key changed"):
        hd.SFTP(_cfg(srv, host_key="ssh-rsa SHA256:somethingElse")).check()
    assert "Signed in" in hd.SFTP(_cfg(srv, host_key=srv["host_key"])).check()  # the pinned key matches


def test_sftp_private_key_sign_in(sftp_server):
    srv = sftp_server
    buf = io.StringIO()
    srv["client_key"].write_private_key(buf)
    cfg = _cfg(srv, password=None, private_key=buf.getvalue(), root="public_html")
    assert "Signed in" in hd.SFTP(cfg).check()
    with pytest.raises(hd.DeployError, match="could not be read"):
        hd.load_private_key("not a key")


# ── through the API, as the GoDaddy website would be set up ─────────────────────

@pytest.fixture()
def site(client, monkeypatch, tmp_path, sftp_server):
    monkeypatch.setattr(hd, "_config_path", lambda: tmp_path / "none.json")
    monkeypatch.setattr(html_site, "_safe_host", lambda h: h)  # the test server is on 127.0.0.1 (refused for real hosts)
    srv = sftp_server
    pub = srv["home"] / "public_html"

    def live(req: httpx.Request):  # the "live website" is whatever is in public_html now
        f = pub / (req.url.path.lstrip("/") or "index.html")
        if f.is_file():
            ctype = "application/javascript" if f.suffix == ".js" else "text/plain" if f.suffix == ".txt" else "text/html"
            return httpx.Response(200, content=f.read_bytes(), headers={"content-type": ctype})
        return httpx.Response(404, text="Not Found")
    client_factory = lambda timeout=20: httpx.Client(transport=httpx.MockTransport(live), timeout=timeout)  # noqa: E731
    monkeypatch.setattr(html_site, "site_client", client_factory)
    monkeypatch.setattr(hp, "site_client", client_factory)
    monkeypatch.setattr(hp.time, "sleep", lambda s: None)

    monkeypatch.setattr(hp, "_spawn", lambda fn, *args: fn(*args))  # background jobs run at once
    bid = client.post("/api/v1/businesses", json={"name": "Supreme Aangan CHS", "website": "https://sachspune.com", "primary_category": "Housing society"}).json()["id"]
    base = f"/api/v1/businesses/{bid}/html-site"
    assert client.put(base, json={"website_name": "Supreme Aangan CHS", "website_url": "https://sachspune.com", "listing_file": "blog.html",
                                  "articles_folder": "blog"}).json()["ok"]
    yield bid, base, srv, pub
    s = SessionLocal()
    s.query(ScheduledPost).filter(ScheduledPost.business_id == bid).delete()
    s.query(Article).filter(Article.business_id == bid).delete()
    s.query(SiteIntegration).filter(SiteIntegration.business_id == bid).delete()
    s.query(Business).filter(Business.id == bid).delete()
    s.commit()
    s.close()


def _article(bid, **kw):
    s = SessionLocal()
    a = Article(business_id=bid, keyword="agm 2026", title="AGM 2026: What Members Should Know", meta_description="Key points before the AGM.",
                body="<h1>AGM 2026: What Members Should Know</h1><p>Intro.</p><h2>Agenda</h2><p>Body text.</p>", status="completed", topic="meetings", **kw)
    s.add(a)
    s.commit()
    aid = a.id
    s.close()
    return aid


def test_settings_are_encrypted_never_returned_and_publishing_needs_both_tests(client, site):
    bid, base, srv, pub = site
    r = client.put(f"{base}/deployment", json={"adapter": "sftp", "host": "127.0.0.1", "port": srv["port"], "username": USER, "auth": "password", "password": PASSWORD})
    assert r.status_code == 200, r.text
    c = r.json()
    assert PASSWORD not in json.dumps(c) and c["deployment"]["settings"]["has_password"] and c["publishing"] == "test_needed"
    s = SessionLocal()
    stored = s.query(SiteIntegration).filter_by(business_id=bid).one().config["html_site"]["deploy"]
    s.close()
    assert "password" not in stored and stored["password_enc"] and PASSWORD not in json.dumps(stored)  # encrypted at rest
    aid = _article(bid)
    assert client.post(f"{base}/articles/{aid}/publish").status_code == 409  # not before the tests
    t = client.post(f"{base}/deployment/test-connection").json()
    assert t["ok"] and [x["step"] for x in t["steps"]] == ["Sign in", "Server identity", "Website folder", "Article data file", "Blog folder"]
    d = t["connection"]["deployment"]["settings"]
    assert d["root"] == "public_html" and d["host_key"] == srv["host_key"]  # detected and pinned
    assert not (pub / ".well-known").exists()  # Test connection writes nothing
    client.post(f"{base}/test-deploy")
    c = client.get(base).json()
    assert c["deployment"]["test"]["status"] == "ok" and c["publishing"] == "connected", c["deployment"]
    assert not (pub / ".well-known" / "growzen-deploy-check.txt").exists()  # the temporary check file is removed after the live check
    assert "it was then removed" in c["deployment"]["test"]["detail"] and "'public_html'" in c["deployment"]["test"]["detail"]
    assert [e["action"] for e in c["log"]][:3] == ["test deployment", "test connection", "deployment settings"]
    # an empty password keeps the saved one; changing the server clears the test (must pass again)
    keep = client.put(f"{base}/deployment", json={"adapter": "sftp", "host": "127.0.0.1", "port": srv["port"], "username": USER, "auth": "password"}).json()
    assert keep["deployment"]["settings"]["has_password"] and keep["publishing"] == "test_needed"
    assert client.put(f"{base}/deployment", json={"adapter": "sftp", "host": "other.example", "username": USER, "auth": "password"}).status_code == 422  # new server: password needed


def test_publish_now_over_sftp_adds_the_article_keeps_the_rest_and_backs_up(client, site):
    bid, base, srv, pub = site
    client.put(f"{base}/deployment", json={"adapter": "sftp", "host": "127.0.0.1", "port": srv["port"], "username": USER, "auth": "password", "password": PASSWORD})
    client.post(f"{base}/deployment/test-connection")
    client.post(f"{base}/test-deploy")
    aid = _article(bid)
    untouched = {p: p.read_bytes() for p in pub.rglob("*") if p.is_file() and p.name not in ("data.js", "blog.html")}
    assert client.post(f"{base}/articles/{aid}/publish").status_code == 202
    st = client.get(f"{base}/articles/{aid}").json()
    assert st["status"] == "published" and st["url"] == "https://sachspune.com/blog.html?post=agm-2026-what-members-should-know", st
    js = (pub / "js" / "data.js").read_bytes().decode("utf-8")
    assert js.index("agm-2026-what-members-should-know") < js.index("redevelopment-guide-for-members") and js.count("growzenId:") == 1
    assert (pub / "blog.html").read_bytes().decode("utf-8") == DATA_LISTING.replace("data.js?v=3", "data.js?v=4")
    for p, data in untouched.items():
        assert p.read_bytes() == data, p
    steps = {x["step"] for x in st["steps"]}
    assert {"Back up the files that change", "Upload the files", "Live on the website"} <= steps
    backups = list((hp.BACKUP_ROOT / str(bid)).rglob("data.js"))
    assert backups and backups[0].read_bytes().decode("utf-8") == DATA_JS  # the version before the change, kept by GrowZen
    # updating the same article: still one entry, the URL stays
    client.post(f"{base}/articles/{aid}/publish")
    assert (pub / "js" / "data.js").read_bytes().decode("utf-8").count("growzenId:") == 1
    assert client.get(f"{base}/articles/{aid}").json()["url"] == st["url"]
    cal = client.get(f"/api/v1/businesses/{bid}/articles").json()["articles"]
    assert next(x for x in cal if x["id"] == aid)["publishing_status"] == "published"  # on the calendar / list too


def test_a_failed_upload_is_logged_and_retry_publishes(client, site, monkeypatch):
    bid, base, srv, pub = site
    client.put(f"{base}/deployment", json={"adapter": "sftp", "host": "127.0.0.1", "port": srv["port"], "username": USER, "auth": "password", "password": PASSWORD})
    client.post(f"{base}/deployment/test-connection")
    client.post(f"{base}/test-deploy")
    aid = _article(bid)
    real_write = hd.SFTP.write
    monkeypatch.setattr(hd.SFTP, "write", lambda self, files, message: (_ for _ in ()).throw(hd.DeployError("SFTP upload failed: [Errno 28] No space left on device")))
    client.post(f"{base}/articles/{aid}/publish")
    st = client.get(f"{base}/articles/{aid}").json()
    assert st["status"] == "failed" and "No space left" in st["error"] and "agm-2026" not in (pub / "js" / "data.js").read_bytes().decode("utf-8")
    assert client.get(base).json()["log"][0]["ok"] is False
    monkeypatch.setattr(hd.SFTP, "write", real_write)
    client.post(f"{base}/articles/{aid}/publish")  # Retry
    assert client.get(f"{base}/articles/{aid}").json()["status"] == "published"


def test_scheduled_publishing_to_the_html_website(client, site):
    bid, base, srv, pub = site
    client.put(f"{base}/deployment", json={"adapter": "sftp", "host": "127.0.0.1", "port": srv["port"], "username": USER, "auth": "password", "password": PASSWORD})
    client.post(f"{base}/deployment/test-connection")
    client.post(f"{base}/test-deploy")
    aid = _article(bid)
    arts = f"/api/v1/businesses/{bid}/articles"
    assert "html" in [d["id"] for d in client.get(f"{arts}/destinations").json()["destinations"]]
    when = datetime.now(timezone.utc) + timedelta(hours=1)
    local = when.astimezone(timezone(timedelta(hours=5, minutes=30)))
    r = client.put(f"{arts}/{aid}/schedule", json={"date": local.strftime("%Y-%m-%d"), "time": local.strftime("%H:%M"), "destination": "html"})
    assert r.status_code == 200 and r.json()["article"]["publishing_status"] == "scheduled"
    s = SessionLocal()
    assert sp.run_due_scheduled(s, when - timedelta(minutes=5)) == 0 and "agm-2026" not in (pub / "js" / "data.js").read_bytes().decode("utf-8")  # not early
    assert sp.run_due_scheduled(s, when + timedelta(minutes=1)) == 1
    s.close()
    assert "agm-2026-what-members-should-know" in (pub / "js" / "data.js").read_bytes().decode("utf-8")
    x = next(a for a in client.get(arts).json()["articles"] if a["id"] == aid)
    assert x["publishing_status"] == "published" and x["schedule"]["url"] == "https://sachspune.com/blog.html?post=agm-2026-what-members-should-know"
    assert asch  # scheduler module in use


# ── the "blog.html as website folder" case (FTP error 550 "Can't change directory to /blog.html") ──────────────

def test_a_file_name_is_refused_as_the_website_folder(client, site):
    bid, base, srv, pub = site
    r = client.put(f"{base}/deployment", json={"adapter": "sftp", "host": "127.0.0.1", "port": srv["port"], "username": USER, "auth": "password",
                                               "password": PASSWORD, "root": "blog.html"})
    assert r.status_code == 422 and "is a file name, not a folder" in r.json()["detail"]
    with pytest.raises(hd.DeployError, match="is a file name, not a folder"):
        hd.FTP({"host": "h", "user": "u", "password": "p", "root": "blog.html"})  # never used as a directory
    assert hd.bad_root("public_html") is None and hd.bad_root("") is None and hd.bad_root("/home/u/public_html") is None


def test_a_saved_file_name_is_set_aside_and_the_real_folder_detected_without_touching_credentials(client, site):
    bid, base, srv, pub = site
    client.put(f"{base}/deployment", json={"adapter": "sftp", "host": "127.0.0.1", "port": srv["port"], "username": USER, "auth": "password", "password": PASSWORD})
    s = SessionLocal()
    row = s.query(SiteIntegration).filter_by(business_id=bid).one()
    cfg = json.loads(json.dumps(row.config))
    cfg["html_site"]["deploy"]["root"] = "blog.html"  # what was saved for sachspune.com
    row.config = cfg
    s.commit()
    secret_before = cfg["html_site"]["deploy"]["password_enc"]
    t = client.post(f"{base}/deployment/test-connection").json()
    st = {x["step"]: x for x in t["steps"]}
    assert t["ok"], t["steps"]
    assert st["Website folder setting"]["warning"] and "'blog.html' is a file name" in st["Website folder setting"]["detail"]
    assert "'public_html' contains blog.html" in st["Website folder"]["detail"] and st["Article data file"]["ok"]
    s.expire_all()
    d = s.query(SiteIntegration).filter_by(business_id=bid).one().config["html_site"]["deploy"]
    s.close()
    assert d["root"] == "public_html" and d["password_enc"] == secret_before and d["host"] == "127.0.0.1" and d["user"] == USER  # credentials untouched


def test_an_ftp_account_that_opens_in_an_empty_folder_gets_a_clear_message(client, site, monkeypatch):
    bid, base, srv, pub = site
    client.put(f"{base}/deployment", json={"adapter": "sftp", "host": "127.0.0.1", "port": srv["port"], "username": USER, "auth": "password", "password": PASSWORD})

    class EmptyAccount(hd.Deployer):  # like a cPanel FTP account created with its own new directory
        name = "ftp"

        def check(self):
            return "Signed in to sachspune.com as bevisibe@sachspune.com"

        def read(self, path):
            return None

        def list_dir(self, path="."):
            return [".ftpquota"]
    monkeypatch.setattr(hp, "deployer", lambda s: EmptyAccount({}, s["website_url"]))
    t = client.post(f"{base}/deployment/test-connection").json()
    assert not t["ok"] and "opens in an empty folder (it contains only: .ftpquota)" in t["steps"][-1]["detail"] and "Directory 'public_html'" in t["steps"][-1]["detail"]


def test_featured_image_goes_into_the_existing_blog_folder(client, site, monkeypatch, tmp_path):
    bid, base, srv, pub = site
    client.put(f"{base}/deployment", json={"adapter": "sftp", "host": "127.0.0.1", "port": srv["port"], "username": USER, "auth": "password", "password": PASSWORD})
    client.post(f"{base}/deployment/test-connection")
    client.post(f"{base}/test-deploy")
    img = tmp_path / "cover.webp"
    img.write_bytes(b"RIFF....WEBPVP8 fake")
    monkeypatch.setattr(hp.fi, "path_of", lambda rel: img if rel else None)
    aid = _article(bid, featured_image_path="1/cover.webp", featured_image_alt="AGM hall")
    client.post(f"{base}/articles/{aid}/publish")
    st = client.get(f"{base}/articles/{aid}").json()
    assert st["status"] == "published" and st["url"] == "https://sachspune.com/blog.html?post=agm-2026-what-members-should-know", st
    assert (pub / "blog" / "agm-2026-what-members-should-know.webp").read_bytes() == img.read_bytes()  # /blog/<slug>.webp
    js = (pub / "js" / "data.js").read_bytes().decode("utf-8")
    assert "url('/blog/agm-2026-what-members-should-know.webp') center/cover no-repeat" in js and "redevelopment-guide-for-members" in js
