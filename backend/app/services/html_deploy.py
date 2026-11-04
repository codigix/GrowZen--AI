"""Deployment adapters for HTML websites: how GrowZen reads and writes a site's files.

Every adapter offers the same small interface, so publishing (services/html_publisher.py) never cares where a site
is hosted:

    list_paths()   every file path of the site source, relative to the adapter's root (None = cannot list)
    read(path)     the bytes of one file, or None when it does not exist
    write(files)   create/update several files in ONE step where the host allows it (one commit / one deploy)
    check()        credentials work and writing is allowed; returns a human sentence

Adapters: github (a repository; Netlify/Vercel/Cloudflare Pages/GitHub Pages rebuild on each commit), gitlab (same,
GitLab), netlify (Netlify's deploy API: only new/changed files are uploaded, every other file of the live deploy is
kept), ftp / ftps (classic hosting such as cPanel), sftp (needs the `paramiko` package), and manual (no credentials:
GrowZen prepares the files and the user uploads them).

Credentials never reach the browser: they live in a server-side JSON file (settings.html_deploy_config, default
backend/html_deploy.json, git-ignored), one entry per website host. A value can be written directly or taken from an
environment variable with a `_env` key, e.g. {"password_env": "SACHSPUNE_FTP_PASSWORD"}. See docs/html-site-deployment.md.
"""
import base64
import ftplib
import hashlib
import io
import json
import os
import posixpath
import re
import time
from pathlib import Path
from urllib.parse import quote, urlsplit

import httpx

from ..config import get_settings
from .net import site_client
from .url_safety import SSRFValidationError

ADAPTERS = ("github", "gitlab", "netlify", "ftp", "sftp", "manual")
_BACKEND = Path(__file__).resolve().parents[2]


class DeployError(Exception):
    """A deployment step failed; the message is shown to the user as is (never contains a secret)."""


# ── configuration (server side only) ────────────────────────────────────────────

def _host(url: str | None) -> str:
    h = (urlsplit(url if "//" in (url or "") else f"https://{url or ''}").hostname or "").lower()
    return h[4:] if h.startswith("www.") else h


def _config_path() -> Path:
    p = Path(get_settings().html_deploy_config or "html_deploy.json")
    return p if p.is_absolute() else _BACKEND / p


SECRET_KEYS = ("password", "private_key", "key_passphrase", "token")


def from_stored(stored: dict | None) -> dict | None:
    """A deployment saved through the app (config["html_site"]["deploy"]) with its secrets decrypted, for use on the
    server only. None when nothing is saved."""
    if not stored or not stored.get("adapter"):
        return None
    from . import crypto  # noqa: PLC0415
    out = {k: v for k, v in stored.items() if not k.endswith("_enc")}
    for k in SECRET_KEYS:
        if stored.get(f"{k}_enc"):
            out[k] = crypto.unseal(stored[f"{k}_enc"])
    return out


def load_entry(website_url: str, stored: dict | None = None) -> dict | None:
    """This website's deployment: the one saved in the app (encrypted in the database) wins; otherwise the entry for
    its host in the server-side config file, with `*_env` values resolved. None = not configured."""
    saved = from_stored(stored)
    if saved:
        return saved
    path = _config_path()
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise DeployError(f"The deployment configuration file {path.name} is not valid JSON: {exc}") from exc
    entry = (data or {}).get(_host(website_url))
    if not isinstance(entry, dict):
        return None
    return {(k[:-4] if k.endswith("_env") else k): (os.environ.get(v, "") if k.endswith("_env") and isinstance(v, str) else v) for k, v in entry.items()}


def describe(entry: dict | None) -> dict:
    """What the page may know about the deployment: the adapter and its target, never a credential."""
    if not entry or entry.get("adapter") == "manual":
        return {"adapter": "manual", "label": "Manual export (no deployment configured)", "target": None, "configured": False}
    a = entry.get("adapter")
    target = {"github": entry.get("repo"), "gitlab": entry.get("project"), "netlify": entry.get("site") or "this site",
              "ftp": entry.get("host"), "sftp": entry.get("host")}.get(a)
    label = {"github": "GitHub repository", "gitlab": "GitLab repository", "netlify": "Netlify deploy API",
             "ftp": "FTPS" if entry.get("tls") else "FTP", "sftp": "SFTP"}.get(a, a or "?")
    extra = entry.get("branch") or (entry["root"] if entry.get("root") and a in ("ftp", "sftp") else None)
    return {"adapter": a, "label": label, "target": f"{target}{f' ({extra})' if extra else ''}" if target else None, "configured": a in ADAPTERS}


def for_site(website_url: str, stored: dict | None = None) -> "Deployer":
    entry = load_entry(website_url, stored)
    if not entry:
        return Manual({})
    cls = {"github": GitHub, "gitlab": GitLab, "netlify": Netlify, "ftp": FTP, "sftp": SFTP, "manual": Manual}.get(entry.get("adapter"))
    if not cls:
        raise DeployError(f"Unknown deployment adapter '{entry.get('adapter')}' for {_host(website_url)}. Use one of: {', '.join(ADAPTERS)}.")
    return cls(entry, website_url)


def bad_root(root: str | None) -> str | None:
    """Why a website-folder value is not a folder (e.g. 'blog.html'), or None when it is fine. The website folder is
    the server folder that holds the listing file, such as public_html; it is never the listing file itself."""
    last = (root or "").rstrip("/").rsplit("/", 1)[-1]
    if last and re.search(r"\.(?:html?|php|js|css|json|txt|xml|jpe?g|png|gif|webp|svg|pdf|zip)$", last, re.I):
        return (f"The website folder '{root}' is a file name, not a folder. Enter the server folder that contains your blog listing file "
                "(for cPanel usually public_html), or leave it empty to detect it.")
    return None


def errors() -> tuple[type, ...]:
    return (DeployError, httpx.HTTPError, SSRFValidationError, OSError, ftplib.Error)


# ── adapters ────────────────────────────────────────────────────────────────────

class Deployer:
    name = "base"
    rebuilds = False  # True: the host rebuilds the site after a write (git-based); the change appears a little later
    can_read = True

    def __init__(self, cfg: dict, website_url: str | None = None):
        self.cfg, self.website_url = cfg, website_url
        why = bad_root(cfg.get("root"))
        if why:  # e.g. 'blog.html' typed as the folder: never used as a directory (that sent "CWD /blog.html")
            raise DeployError(why)
        self.root = (cfg.get("root") or "").strip("/")  # the folder of the source served as "/"; "" = detect / login folder

    def _p(self, path: str) -> str:
        return posixpath.join(self.root, path.lstrip("/")) if self.root else path.lstrip("/")

    def list_paths(self) -> list[str] | None:
        return None

    def read(self, path: str) -> bytes | None:
        raise NotImplementedError

    def write(self, files: dict[str, bytes], message: str) -> str:
        raise NotImplementedError

    def check(self) -> str:
        raise NotImplementedError

    def delete(self, paths: list[str]) -> bool:
        """Remove files GrowZen itself uploaded (only the deployment check file). False when the host cannot."""
        return False

    def _need(self, *keys):
        missing = [k for k in keys if not self.cfg.get(k)]
        if missing:
            raise DeployError(f"The {self.name} deployment is missing: {', '.join(missing)} (in the server's deployment configuration).")


def _ok(r: httpx.Response, what: str) -> httpx.Response:
    if r.status_code in (401, 403):
        raise DeployError(f"{what}: the host refused the credentials ({r.status_code}). Check the token and its permissions.")
    if r.status_code >= 400:
        raise DeployError(f"{what}: {r.status_code} {r.text[:160]}")
    return r


class GitHub(Deployer):
    """A GitHub repository. All files of one publish go in ONE commit (Git Data API); the host rebuilds from it."""
    name, rebuilds = "github", True
    API = "https://api.github.com"

    def __init__(self, cfg, website_url=None):
        super().__init__(cfg, website_url)
        self._need("repo", "token")
        self.repo = cfg["repo"].strip().removeprefix("https://github.com/").rstrip("/").removesuffix(".git")
        self.branch = cfg.get("branch")
        self._tree: list[dict] | None = None

    def _h(self):
        return {"Authorization": f"Bearer {self.cfg['token']}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}

    def _br(self, c) -> str:
        if not self.branch:
            self.branch = _ok(c.get(f"{self.API}/repos/{self.repo}", headers=self._h()), "Read the repository").json().get("default_branch") or "main"
        return self.branch

    def check(self) -> str:
        with site_client(30) as c:
            info = _ok(c.get(f"{self.API}/repos/{self.repo}", headers=self._h()), "Read the repository").json()
            if not (info.get("permissions") or {}).get("push"):
                raise DeployError(f"The token can read {self.repo} but not write to it. Give it Contents: Read and write.")
            self.branch = self.branch or info.get("default_branch") or "main"
            _ok(c.get(f"{self.API}/repos/{self.repo}/branches/{quote(self.branch, safe='')}", headers=self._h()), f"Find branch '{self.branch}'")
        return f"Can commit to {self.repo} on '{self.branch}'"

    def _all(self, c) -> list[dict]:
        if self._tree is None:
            d = _ok(c.get(f"{self.API}/repos/{self.repo}/git/trees/{quote(self._br(c), safe='')}", headers=self._h(), params={"recursive": "1"}), "List the files").json()
            self._tree = [x for x in d.get("tree") or [] if x.get("type") == "blob"]
        return self._tree

    def list_paths(self):
        with site_client(40) as c:
            pre = f"{self.root}/" if self.root else ""
            return [x["path"][len(pre):] for x in self._all(c) if x["path"].startswith(pre)]

    def read(self, path):
        with site_client(40) as c:
            want = self._p(path)
            hit = next((x for x in self._all(c) if x["path"] == want), None)
            if not hit:
                return None
            d = _ok(c.get(f"{self.API}/repos/{self.repo}/git/blobs/{hit['sha']}", headers=self._h()), f"Read {want}").json()
            return base64.b64decode(d.get("content") or "")

    def write(self, files, message):
        with site_client(90) as c:
            br = self._br(c)
            head = _ok(c.get(f"{self.API}/repos/{self.repo}/git/ref/heads/{quote(br, safe='')}", headers=self._h()), "Read the branch").json()["object"]["sha"]
            base_tree = _ok(c.get(f"{self.API}/repos/{self.repo}/git/commits/{head}", headers=self._h()), "Read the last commit").json()["tree"]["sha"]
            tree = []
            for path, data in files.items():
                blob = _ok(c.post(f"{self.API}/repos/{self.repo}/git/blobs", headers=self._h(), json={"content": base64.b64encode(data).decode(), "encoding": "base64"}), f"Upload {path}").json()
                tree.append({"path": self._p(path), "mode": "100644", "type": "blob", "sha": blob["sha"]})
            new_tree = _ok(c.post(f"{self.API}/repos/{self.repo}/git/trees", headers=self._h(), json={"base_tree": base_tree, "tree": tree}), "Build the commit").json()["sha"]
            commit = _ok(c.post(f"{self.API}/repos/{self.repo}/git/commits", headers=self._h(), json={"message": message, "tree": new_tree, "parents": [head]}), "Create the commit").json()["sha"]
            _ok(c.patch(f"{self.API}/repos/{self.repo}/git/refs/heads/{quote(br, safe='')}", headers=self._h(), json={"sha": commit}), "Move the branch")
            self._tree = None
            return f"Committed {len(files)} file(s) to {self.repo} on '{br}' ({commit[:7]}). The host rebuilds the site from it."


class GitLab(Deployer):
    """A GitLab repository (gitlab.com or self-hosted). One commit per publish (Commits API with actions)."""
    name, rebuilds = "gitlab", True

    def __init__(self, cfg, website_url=None):
        super().__init__(cfg, website_url)
        self._need("project", "token")
        self.api = (cfg.get("base_url") or "https://gitlab.com").rstrip("/") + "/api/v4"
        self.pid = quote(str(cfg["project"]).strip("/"), safe="")
        self.branch = cfg.get("branch")
        self._paths: list[str] | None = None

    def _h(self):
        return {"PRIVATE-TOKEN": self.cfg["token"]}

    def _br(self, c):
        if not self.branch:
            self.branch = _ok(c.get(f"{self.api}/projects/{self.pid}", headers=self._h()), "Read the project").json().get("default_branch") or "main"
        return self.branch

    def check(self):
        with site_client(30) as c:
            info = _ok(c.get(f"{self.api}/projects/{self.pid}", headers=self._h()), "Read the project").json()
            perms = info.get("permissions") or {}
            level = max((perms.get("project_access") or {}).get("access_level", 0), (perms.get("group_access") or {}).get("access_level", 0))
            if level and level < 30:
                raise DeployError("The token can read the project but not push to it (Developer access or higher is needed).")
            self.branch = self.branch or info.get("default_branch") or "main"
        return f"Can commit to {self.cfg['project']} on '{self.branch}'"

    def _all(self, c):
        if self._paths is None:
            out, page = [], "1"
            while page:
                r = _ok(c.get(f"{self.api}/projects/{self.pid}/repository/tree", headers=self._h(),
                              params={"recursive": "true", "per_page": 100, "page": page, "ref": self._br(c)}), "List the files")
                out += [x["path"] for x in r.json() if x.get("type") == "blob"]
                page = r.headers.get("x-next-page") or ""
            self._paths = out
        return self._paths

    def list_paths(self):
        with site_client(60) as c:
            pre = f"{self.root}/" if self.root else ""
            return [p[len(pre):] for p in self._all(c) if p.startswith(pre)]

    def read(self, path):
        with site_client(40) as c:
            r = c.get(f"{self.api}/projects/{self.pid}/repository/files/{quote(self._p(path), safe='')}/raw", headers=self._h(), params={"ref": self._br(c)})
            return None if r.status_code == 404 else _ok(r, f"Read {path}").content

    def write(self, files, message):
        with site_client(90) as c:
            existing = set(self._all(c))
            actions = [{"action": "update" if self._p(p) in existing else "create", "file_path": self._p(p), "content": base64.b64encode(d).decode(), "encoding": "base64"}
                       for p, d in files.items()]
            r = _ok(c.post(f"{self.api}/projects/{self.pid}/repository/commits", headers=self._h(),
                           json={"branch": self._br(c), "commit_message": message, "actions": actions}), "Create the commit").json()
            self._paths = None
            return f"Committed {len(files)} file(s) to {self.cfg['project']} on '{self.branch}' ({r.get('short_id') or ''}). The host rebuilds the site from it."


class Netlify(Deployer):
    """Netlify's deploy API: a new deploy that keeps every file of the live one and uploads only the new/changed files."""
    name = "netlify"
    API = "https://api.netlify.com/api/v1"

    def __init__(self, cfg, website_url=None):
        super().__init__(cfg, website_url)
        self._need("token")
        self.site = cfg.get("site") or _host(website_url)  # a site id or its domain (Netlify accepts both)
        self._files: dict[str, str] | None = None

    def _h(self, raw=False):
        return {"Authorization": f"Bearer {self.cfg['token']}", **({"Accept": "application/vnd.bitballoon.v1.raw"} if raw else {})}

    def check(self):
        with site_client(30) as c:
            info = _ok(c.get(f"{self.API}/sites/{quote(self.site, safe='')}", headers=self._h()), "Find the Netlify site").json()
            self.site = info.get("id") or self.site
        return f"Can deploy to Netlify site {info.get('name') or self.site}"

    def _all(self, c) -> dict[str, str]:
        if self._files is None:
            d = _ok(c.get(f"{self.API}/sites/{quote(self.site, safe='')}/files", headers=self._h()), "List the deployed files").json()
            self._files = {x["path"]: x["sha"] for x in d if x.get("path") and x.get("sha")}
        return self._files

    def list_paths(self):
        with site_client(60) as c:
            return [p.lstrip("/") for p in self._all(c)]

    def read(self, path):
        with site_client(40) as c:
            key = "/" + path.lstrip("/")
            if key not in self._all(c):
                return None
            return _ok(c.get(f"{self.API}/sites/{quote(self.site, safe='')}/files{quote(key)}", headers=self._h(raw=True)), f"Read {path}").content

    def write(self, files, message):
        with site_client(120) as c:
            manifest = dict(self._all(c))  # everything already live stays
            for p, d in files.items():
                manifest["/" + p.lstrip("/")] = hashlib.sha1(d).hexdigest()
            dep = _ok(c.post(f"{self.API}/sites/{quote(self.site, safe='')}/deploys", headers=self._h(), json={"files": manifest, "title": message[:120]}), "Start the deploy").json()
            need = set(dep.get("required") or [])
            for p, d in files.items():
                if hashlib.sha1(d).hexdigest() in need:
                    _ok(c.put(f"{self.API}/deploys/{dep['id']}/files{quote('/' + p.lstrip('/'))}", headers={**self._h(), "Content-Type": "application/octet-stream"}, content=d), f"Upload {p}")
            for _ in range(40):
                st = _ok(c.get(f"{self.API}/deploys/{dep['id']}", headers=self._h()), "Read the deploy").json()
                if st.get("state") == "ready":
                    break
                if st.get("state") == "error":
                    raise DeployError(f"Netlify reported the deploy failed: {st.get('error_message') or 'no reason given'}")
                time.sleep(3)
            self._files = None
            return f"Netlify deploy {dep['id'][:8]} published {len(files)} new/changed file(s); all other files were kept."


class FTP(Deployer):
    """FTP or FTPS (tls: true), e.g. cPanel hosting. Files are uploaded one by one into the site folder (root)."""
    name = "ftp"

    def __init__(self, cfg, website_url=None):
        super().__init__(cfg, website_url)
        self._need("host", "user", "password")

    def _conn(self):
        f = ftplib.FTP_TLS(timeout=40) if self.cfg.get("tls") else ftplib.FTP(timeout=40)
        f.connect(self.cfg["host"], int(self.cfg.get("port") or 21))
        f.login(self.cfg["user"], self.cfg["password"])
        if self.cfg.get("tls"):
            f.prot_p()
        return f

    def _full(self, path: str) -> str:
        return ("/" if self.root else "") + self._p(path)

    def check(self):
        try:
            with self._conn() as f:
                if self.root:
                    try:
                        f.cwd("/" + self.root)
                    except ftplib.error_perm as exc:
                        raise DeployError(f"Signed in, but the website folder '/{self.root}' does not exist for this FTP account ({exc}). "
                                          "Leave the Website folder empty to detect it, or enter the folder that contains your blog listing file.") from exc
                return f"Signed in to {self.cfg['host']} as {self.cfg['user']}" + (f", folder /{self.root}" if self.root else "")
        except ftplib.all_errors as exc:
            raise DeployError(f"FTP: {exc}") from exc

    def list_dir(self, path: str = ".") -> list[str]:
        """Names in a folder of the account (without . and ..); [] when it cannot be listed."""
        try:
            with self._conn() as f:
                return sorted({n.rstrip("/").rsplit("/", 1)[-1] for n in f.nlst(path)} - {".", "..", ""})
        except ftplib.all_errors:
            return []

    def delete(self, paths):
        try:
            with self._conn() as f:
                for p in paths:
                    try:
                        f.delete(self._full(p))
                    except ftplib.error_perm:
                        pass
            return True
        except ftplib.all_errors:
            return False

    def read(self, path):
        buf = io.BytesIO()
        try:
            with self._conn() as f:
                f.retrbinary(f"RETR {self._full(path)}", buf.write)
            return buf.getvalue()
        except ftplib.error_perm:
            return None
        except ftplib.all_errors as exc:
            raise DeployError(f"FTP: {exc}") from exc

    def write(self, files, message):
        try:
            with self._conn() as f:
                for p, d in files.items():
                    full = self._full(p)
                    cur = "/" if full.startswith("/") else ""
                    for part in [x for x in posixpath.dirname(full).split("/") if x]:  # create missing folders
                        cur = posixpath.join(cur, part) if cur else part
                        try:
                            f.mkd(cur)
                        except ftplib.error_perm:
                            pass
                    f.storbinary(f"STOR {full}", io.BytesIO(d))
            return f"Uploaded {len(files)} file(s) to {self.cfg['host']} by {'FTPS' if self.cfg.get('tls') else 'FTP'}."
        except ftplib.all_errors as exc:
            raise DeployError(f"FTP: {exc}") from exc


def host_key_fingerprint(key) -> str:
    """The SSH host key as "<type> SHA256:<base64>", the form `ssh-keygen -lf` prints."""
    return f"{key.get_name()} SHA256:{base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip('=')}"


def load_private_key(text: str, passphrase: str | None = None):
    """An SSH private key from its text (OpenSSH or PEM; Ed25519, ECDSA or RSA)."""
    import paramiko  # noqa: PLC0415
    last = None
    for cls in (paramiko.Ed25519Key, paramiko.ECDSAKey, paramiko.RSAKey):
        try:
            return cls.from_private_key(io.StringIO(text.strip() + "\n"), password=passphrase or None)
        except paramiko.PasswordRequiredException as exc:
            raise DeployError("The private key is protected with a passphrase: enter it as well.") from exc
        except (paramiko.SSHException, ValueError) as exc:
            last = exc
    raise DeployError(f"The private key could not be read ({type(last).__name__ if last else 'unknown format'}). Paste the whole key, including its BEGIN/END lines.")


class SFTP(Deployer):
    """SFTP over SSH (e.g. GoDaddy cPanel hosting). Paths are relative to the login (home) folder unless `root` starts
    with "/". The server's host key is pinned (`host_key`): a changed key is refused, so files never go to an impostor.
    Each file is uploaded to a temporary name and then renamed, so a visitor never sees a half-written file."""
    name = "sftp"

    def __init__(self, cfg, website_url=None):
        super().__init__(cfg, website_url)
        self._need("host", "user")
        if not (cfg.get("password") or cfg.get("private_key") or cfg.get("key_file")):
            raise DeployError("The SFTP deployment needs a password or a private key.")
        self.root = (cfg.get("root") or "").rstrip("/")  # may be absolute ("/home/user/public_html") or relative to home
        self.host_key = None  # the fingerprint seen on the last connection

    def _open(self):
        try:
            import paramiko  # noqa: PLC0415
        except ImportError as exc:
            raise DeployError("SFTP needs the 'paramiko' package on the server (pip install paramiko).") from exc
        import socket  # noqa: PLC0415
        host, port = self.cfg["host"], int(self.cfg.get("port") or 22)
        try:
            sock = socket.create_connection((host, port), timeout=25)
        except OSError as exc:
            raise DeployError(f"SFTP: could not reach {host}:{port} ({exc.__class__.__name__}). Check the host name and port (cPanel SSH is often 22).") from exc
        t = paramiko.Transport(sock)
        try:
            t.start_client(timeout=25)
            self.host_key = host_key_fingerprint(t.get_remote_server_key())
            pinned = self.cfg.get("host_key")
            if pinned and pinned != self.host_key:
                raise DeployError(f"The server's SSH host key changed (expected {pinned}, got {self.host_key}). Nothing was sent. "
                                  "If your host really changed it, run Test connection again after confirming the new key with them.")
            if self.cfg.get("private_key") or self.cfg.get("key_file"):
                key = load_private_key(self.cfg["private_key"], self.cfg.get("key_passphrase")) if self.cfg.get("private_key") \
                    else paramiko.RSAKey.from_private_key_file(self.cfg["key_file"], password=self.cfg.get("key_passphrase") or None)
                t.auth_publickey(self.cfg["user"], key)
            else:
                t.auth_password(self.cfg["user"], self.cfg["password"])
            if not t.is_authenticated():
                raise DeployError("SFTP: sign-in was not accepted.")
            return t, paramiko.SFTPClient.from_transport(t)
        except paramiko.AuthenticationException as exc:
            t.close()
            raise DeployError("SFTP: the server refused the username, password or key. Check them in cPanel (SSH Access / FTP Accounts).") from exc
        except paramiko.SSHException as exc:
            t.close()
            raise DeployError(f"SFTP: {exc}") from exc
        except DeployError:
            t.close()
            raise

    def _full(self, path):
        return self._p(path)

    def check(self):
        t, s = self._open()
        try:
            try:
                s.listdir(self.root or ".")
            except OSError as exc:
                raise DeployError(f"SFTP: the folder '{self.root or '~'}' cannot be opened ({exc}).") from exc
            return f"Signed in to {self.cfg['host']} as {self.cfg['user']} by SFTP" + (f", folder {self.root}" if self.root else "")
        finally:
            s.close(), t.close()

    def list_dir(self, path: str = ".") -> list[str]:
        t, s = self._open()
        try:
            return s.listdir(path)
        except OSError:
            return []
        finally:
            s.close(), t.close()

    def delete(self, paths):
        t, s = self._open()
        try:
            for p in paths:
                try:
                    s.remove(self._full(p))
                except OSError:
                    pass
            return True
        finally:
            s.close(), t.close()

    def read(self, path):
        t, s = self._open()
        try:
            with s.open(self._full(path), "rb") as fh:
                return fh.read()
        except OSError:
            return None
        finally:
            s.close(), t.close()

    def write(self, files, message):
        t, s = self._open()
        try:
            for p, d in files.items():
                full = self._full(p)
                acc = "/" if full.startswith("/") else ""
                for part in [x for x in posixpath.dirname(full).split("/") if x]:  # create missing folders
                    acc = posixpath.join(acc, part) if acc else part
                    try:
                        s.stat(acc)
                    except OSError:
                        s.mkdir(acc)
                tmp = f"{full}.growzen-upload"
                s.putfo(io.BytesIO(d), tmp)
                try:
                    s.posix_rename(tmp, full)  # atomic replace on OpenSSH servers
                except OSError:
                    try:
                        s.remove(full)
                    except OSError:
                        pass
                    s.rename(tmp, full)
            return f"Uploaded {len(files)} file(s) to {self.cfg['host']} by SFTP."
        except OSError as exc:
            raise DeployError(f"SFTP upload failed: {exc}") from exc
        finally:
            s.close(), t.close()


class Manual(Deployer):
    """No credentials: GrowZen prepares the files (a ZIP to download) and the user uploads them."""
    name, can_read = "manual", False

    def check(self):
        return "No deployment is configured: GrowZen prepares the files for you to upload."

    def read(self, path):
        return None

    def write(self, files, message):
        raise DeployError("Manual export: download the files and upload them to your website yourself.")
