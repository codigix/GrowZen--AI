"""HTML Website: a blog destination next to WordPress and the React.js website, for a site of plain HTML files on any
host. The connection form has four settings only: website name, website URL, blog listing HTML file, blog articles
folder. They are kept in the existing `site_integrations` row (config["html_site"]); no new table.

Validation only READS the live website. It detects how the site keeps its articles (services/html_publisher.detect):
a list in a script file with query URLs (e.g. js/data.js + blog.html?post=<slug>), or one page per article in the
folder. HOW files reach the site is the deployment adapter (services/html_deploy.py), chosen from the server-side
configuration for the website's host; credentials never reach the browser. Publishing counts as connected only after
a real test deployment succeeded (a check file was uploaded and the live website served it).
"""
import re
from datetime import datetime, timezone
from html import unescape
from typing import Literal
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_business
from ..models import Article, Business, SiteIntegration
from ..services import html_deploy as hd, html_publisher as hp, site_publish as sp
from ..services.net import site_client
from ..services.site_adapters import slugify
from ..services.url_safety import SSRFValidationError

router = APIRouter(prefix="/businesses/{business_id}/html-site", tags=["html-site"])
KEY = "html_site"
_PATH = re.compile(r"[A-Za-z0-9_\-./]+")
SITE_KEYS = ("website_name", "website_url", "listing_file", "articles_folder")


class HtmlSiteIn(BaseModel):
    website_name: str = Field(min_length=1, max_length=160)
    website_url: str = Field(min_length=4, max_length=500)
    listing_file: str = Field(min_length=1, max_length=300)    # e.g. blog.html, blog/index.html, blogs/index.html
    articles_folder: str = Field(min_length=1, max_length=300)  # e.g. blog, blog/posts, articles


def _row(db: Session, b: Business) -> SiteIntegration | None:
    return db.scalar(select(SiteIntegration).where(SiteIntegration.business_id == b.id))


def _join(base: str | None, path: str | None) -> str | None:
    return f"{base.rstrip('/')}/{path.lstrip('/')}" if base and path else None


class DeploymentIn(BaseModel):
    """Deployment settings for this website (kept apart from the four connection fields). Secrets are encrypted at rest
    and never sent back; leave password / private_key empty to keep the saved one."""
    adapter: Literal["sftp", "ftp"] = "sftp"
    host: str = Field(min_length=3, max_length=255)
    port: int | None = Field(default=None, ge=1, le=65535)
    username: str = Field(min_length=1, max_length=255)
    auth: Literal["password", "key"] = "password"
    password: str | None = Field(default=None, max_length=500)
    private_key: str | None = Field(default=None, max_length=20000)
    key_passphrase: str | None = Field(default=None, max_length=500)
    root: str | None = Field(default=None, max_length=300)  # the website folder, e.g. public_html; empty = detect
    tls: bool = True  # FTP only: FTPS


def _stored_public(d: dict | None) -> dict | None:
    """The saved deployment settings without any secret."""
    if not d or not d.get("adapter"):
        return None
    return {"adapter": d["adapter"], "host": d.get("host"), "port": d.get("port"), "username": d.get("user"), "auth": d.get("auth") or "password",
            "root": d.get("root") or "", "host_key": d.get("host_key"), "tls": d.get("tls"), "has_password": bool(d.get("password_enc")),
            "has_key": bool(d.get("private_key_enc")), "updated_at": d.get("updated_at"), "connection_test": d.get("connection_test")}


def _deployment(s: dict) -> dict:
    """The adapter and its target (never a credential), the last test deployment, and whether publishing is connected."""
    try:
        info = hd.describe(hd.load_entry(s.get("website_url", ""), s.get("deploy")))
    except hd.DeployError as exc:
        info = {"adapter": None, "label": "Configuration error", "target": None, "configured": False, "error": str(exc)}
    test = s.get("deploy_test") or {}
    ready = hp.deploy_ready(s) if info.get("configured") else False
    publishing = "connected" if ready else ("manual" if not info.get("configured") else "testing" if test.get("status") == "running" else "test_needed")
    return {**info, "source": "app" if (s.get("deploy") or {}).get("adapter") else ("server" if info.get("configured") else None),
            "settings": _stored_public(s.get("deploy")), "test": {k: test.get(k) for k in ("status", "detail", "at")} if test else None, "publishing": publishing}


def public(row: SiteIntegration | None) -> dict:
    s = hp.settings_of(row)
    if not s:
        return {"status": "not_connected", "publishing": "not_configured"}
    dep = _deployment(s)
    shape = s.get("shape") or {}
    return {**{k: s.get(k) for k in (*SITE_KEYS, "status", "checks", "checked_at", "connected_at", "last_error", "article_count", "listing_title")},
            "listing_url": _join(s.get("website_url"), s.get("listing_file")),
            "article_mode": shape.get("mode"), "article_store": shape.get("data_file"), "article_url_pattern": shape.get("url_pattern"),
            "deployment": dep, "publishing": dep["publishing"] if s.get("status") == "connected" else "not_configured", "log": (s.get("log") or [])[:30]}


def _clean(body: HtmlSiteIn) -> dict:
    try:
        url = sp.normalize_url(body.website_url)
    except sp.PublishError as exc:
        raise HTTPException(422, f"Website URL: {exc}")
    if urlsplit(url).path not in ("", "/"):
        raise HTTPException(422, "Website URL: enter the site's address only (e.g. https://example.com), without a page path.")
    listing = body.listing_file.strip().lstrip("/")
    folder = body.articles_folder.strip().strip("/")
    for label, v in (("Blog listing HTML file", listing), ("Blog articles folder", folder)):
        if not v or not _PATH.fullmatch(v) or ".." in v.split("/") or "//" in v:
            raise HTTPException(422, f"{label}: use a path inside the website, with letters, numbers, - _ . and / only (no '..').")
    if not re.search(r"\.html?$", listing, re.I):
        raise HTTPException(422, "Blog listing HTML file: it must be an .html file, e.g. blog.html or blog/index.html.")
    if re.search(r"\.[a-z0-9]{2,5}$", folder, re.I):
        raise HTTPException(422, "Blog articles folder: enter a folder, e.g. blog or blog/posts (not a file).")
    return {"website_name": body.website_name.strip(), "website_url": url, "listing_file": listing, "articles_folder": folder}


def _check(s: dict, test: dict | None = None, deploy: dict | None = None) -> tuple[list[dict], bool, dict]:
    """Six separate validation results (read-only). Returns (steps, site connected, extra facts)."""
    steps: list[dict] = []

    def step(name, ok, detail, warn=False):
        steps.append({"step": name, "ok": ok, "detail": detail, **({"warning": True} if warn else {})})
        return ok

    extra: dict = {}
    site = s["website_url"].rstrip("/")
    listing_url = _join(site, s["listing_file"])
    try:
        with site_client(20) as c:
            def fetch(path: str) -> str | None:
                r = c.get(f"{site}/{path.lstrip('/')}")
                return r.text if r.status_code < 400 else None

            home = c.get(site)
            if not step("Website reachable", home.status_code < 400, f"{site} answered {home.status_code}"
                        + (" (the site is private or password-protected: make it public)" if home.status_code == 401 else "")):
                return steps, False, extra
            r = c.get(listing_url)
            ctype = r.headers.get("content-type", "")
            if r.status_code >= 400:
                step("Blog listing file found", False, f"{listing_url} answered {r.status_code}. Check the file name and its folder.")
                return steps, False, extra
            if "html" not in ctype.lower() and not re.search(r"<html|<body|<!doctype html", r.text[:2000], re.I):
                step("Blog listing file found", False, f"{listing_url} is not an HTML page ({ctype or 'unknown type'}).")
                return steps, False, extra
            if s["listing_file"].lower() not in ("index.html", "index.htm") and r.text.strip() == home.text.strip():
                step("Blog listing file found", False, f"{listing_url} shows the same page as the home page, so {s['listing_file']} does not seem to exist "
                     "(an app that answers every address with its home page). Check the file name.")
                return steps, False, extra
            title = re.search(r"<title[^>]*>([\s\S]*?)</title>", r.text, re.I)
            extra["listing_title"] = " ".join(unescape(title.group(1)).split())[:120] if title else None
            step("Blog listing file found", True, f"{listing_url} is an HTML page" + (f" (“{extra['listing_title']}”)" if extra["listing_title"] else ""))
            shape = hp.detect(site, s["listing_file"], s["articles_folder"], r.text, fetch)
            extra["shape"], extra["article_count"] = shape, shape["count"]
            if shape["mode"] == "data":
                step("Article folder accessible", True, f"Not needed: this site keeps its articles in {shape['data_file']} (the '{shape['array_key']}' list) and shows "
                     f"them on {shape['page']}. GrowZen adds new articles to that list; /{s['articles_folder']}/ is used only for article images.")
                step("Existing articles detected", True, f"{shape['count']} article(s) in {shape['data_file']}"
                     + (f", e.g. {site}/{shape['page']}?{shape['param']}={shape['slugs'][0]}" if shape.get("slugs") else "")
                     + (" (article addresses: " + shape["url_pattern"] + ")" if shape.get("url_known") else " (address pattern not found in the scripts; assuming ?post=)"),
                     warn=not shape.get("url_known"))
            else:
                probe = _join(site, shape["links"][0]) if shape.get("links") else _join(site, s["articles_folder"] + "/")
                fr = c.get(probe)
                step("Article folder accessible", True, f"{probe} answered {fr.status_code}" if fr.status_code < 400
                     else f"/{s['articles_folder']}/ has no page yet ({fr.status_code}); it is created with the first article.", warn=fr.status_code >= 400)
                if shape["count"]:
                    step("Existing articles detected", True, f"{shape['count']} article page(s) in /{s['articles_folder']}/, e.g. {shape['links'][0]} "
                         f"({'folder-style addresses' if shape['style'] == 'folder' else '.html files'})")
                else:
                    step("Existing articles detected", True, f"No article links on the listing page and no article list in its scripts. New articles will be pages "
                         f"in /{s['articles_folder']}/. If the articles live elsewhere, correct the folder.", warn=True)
    except (httpx.HTTPError, SSRFValidationError) as exc:
        step("Website reachable", False, f"Could not reach the website: {str(exc)[:140]}")
        return steps, False, extra
    try:
        entry = hd.load_entry(s["website_url"], deploy)
        if not entry or entry.get("adapter") == "manual":
            step("Deployment connection configured", True, "No deployment is set up for this website yet. Open Deployment settings to add SFTP "
                 "(e.g. GoDaddy cPanel).", warn=True)
            step("Test deployment successful", True, "Not available until a deployment is set up. Publishing is not connected.", warn=True)
            return steps, True, extra
        dep = hd.for_site(s["website_url"], deploy)
        step("Deployment connection configured", True, f"{hd.describe(entry)['label']}: {dep.check()}")
    except hd.errors() as exc:
        step("Deployment connection configured", False, str(exc)[:300])
        step("Test deployment successful", False, "Fix the deployment connection first. Publishing is not connected.")
        return steps, True, extra
    t = test or {}
    if t.get("status") == "ok" and t.get("fingerprint") == hp.fingerprint({**s, "deploy": deploy}):
        step("Test deployment successful", True, t.get("detail") or "Passed")
    elif t.get("status") == "running":
        step("Test deployment successful", True, "Running…", warn=True)
    elif t.get("status") == "failed":
        step("Test deployment successful", False, (t.get("detail") or "Failed") + " Publishing is not connected.")
    else:
        step("Test deployment successful", True, "Not run yet: click Run test deployment. Publishing is not connected until it succeeds.", warn=True)
    return steps, True, extra


def _save(db: Session, b: Business, s: dict, steps: list[dict], ok: bool, extra: dict) -> SiteIntegration:
    row = _row(db, b)
    if not row:
        row = SiteIntegration(business_id=b.id)  # method stays empty: WordPress & co. are not affected
        db.add(row)
    now = datetime.now(timezone.utc)
    prev = hp.settings_of(row)
    same_site = all(prev.get(k) == s.get(k) for k in SITE_KEYS)
    entry = {**prev, **s, **extra, "status": "connected" if ok else "failed", "checks": steps, "checked_at": now.isoformat(),
             "connected_at": prev.get("connected_at") if prev.get("status") == "connected" and ok else (now.isoformat() if ok else None),
             "last_error": None if ok else next((x["detail"] for x in steps if not x["ok"]), None)}
    for old in ("article_style",):  # from the first version of this connection
        entry.pop(old, None)
    if not same_site:  # another website or folder: earlier test results and publish records do not apply any more
        entry.pop("deploy_test", None)
        entry.pop("posts", None)
    row.config = {**(row.config or {}), KEY: entry}
    db.commit()
    return row


def _article(db: Session, b: Business, article_id: int) -> Article:
    a = db.get(Article, article_id)
    if not a or a.business_id != b.id:
        raise HTTPException(404, "Article not found")
    return a


@router.get("")
def get_html_site(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return public(_row(db, b))


@router.put("")
def connect_html_site(body: HtmlSiteIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Connect HTML Website: validate the four settings and run the read-only checks; save (also when a check fails,
    so the form keeps what was typed; the status then says what to fix)."""
    s = _clean(body)
    prev = hp.settings_of(_row(db, b))
    same = all(prev.get(k) == s.get(k) for k in SITE_KEYS)
    steps, ok, extra = _check(s, prev.get("deploy_test") if same else None, prev.get("deploy"))
    return {"ok": ok, "steps": steps, "connection": public(_save(db, b, s, steps, ok, extra))}


@router.post("/check")
def recheck_html_site(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    s = hp.settings_of(_row(db, b))
    if not s:
        raise HTTPException(409, "Connect the HTML website first.")
    cfg = {k: s[k] for k in SITE_KEYS}
    steps, ok, extra = _check(cfg, s.get("deploy_test"), s.get("deploy"))
    return {"ok": ok, "steps": steps, "connection": public(_save(db, b, cfg, steps, ok, extra))}


def _safe_host(host: str) -> str:
    """A public host name for the deployment server (never an internal address)."""
    h = host.strip().removeprefix("sftp://").removeprefix("ftp://").removeprefix("ftps://").split("/")[0].split(":")[0]
    if not re.fullmatch(r"[A-Za-z0-9.\-]{3,253}", h):
        raise HTTPException(422, "Host: enter a host name such as ftp.example.com or the server's address.")
    try:
        from ..services.url_safety import resolve_and_validate
        resolve_and_validate(f"https://{h}/")
    except SSRFValidationError as exc:
        raise HTTPException(422, f"Host: {exc}")
    return h


@router.put("/deployment")
def save_deployment(body: DeploymentIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Save how GrowZen uploads to this website (SFTP, or FTPS). Secrets are encrypted at rest and never returned;
    an empty password/private key keeps the saved one. Saving clears earlier test results (they must pass again)."""
    from ..services import crypto
    row = _row(db, b)
    s = hp.settings_of(row)
    if not s:
        raise HTTPException(409, "Connect the HTML website first (the four settings), then add its deployment.")
    old = s.get("deploy") or {}
    host = _safe_host(body.host)
    same_server = old.get("host") == host and old.get("adapter") == body.adapter and old.get("user") == body.username.strip()
    root = (body.root or "").strip().strip("/") if body.adapter == "ftp" else (body.root or "").strip().rstrip("/")
    if root and (not re.fullmatch(r"/?[A-Za-z0-9_\-./~]+", root) or ".." in root.split("/")):
        raise HTTPException(422, "Website folder: a folder such as public_html (no '..').")
    if hd.bad_root(root):  # 'blog.html' is the Blog Listing HTML File, never the website folder
        raise HTTPException(422, f"Website folder: {hd.bad_root(root)}")
    d = {"adapter": body.adapter, "host": host, "port": body.port or (22 if body.adapter == "sftp" else 21), "user": body.username.strip(),
         "auth": body.auth if body.adapter == "sftp" else "password", "root": root or None, "tls": body.tls if body.adapter == "ftp" else None,
         "host_key": old.get("host_key") if same_server else None, "updated_at": datetime.now(timezone.utc).isoformat()}
    if d["auth"] == "password":
        if body.password:
            d["password_enc"] = crypto.seal(body.password)
        elif same_server and old.get("password_enc"):
            d["password_enc"] = old["password_enc"]
        else:
            raise HTTPException(422, "Enter the password.")
    else:
        if body.private_key and body.private_key.strip():
            try:
                hd.load_private_key(body.private_key, body.key_passphrase)  # refuse an unreadable key now, not at publish time
            except hd.DeployError as exc:
                raise HTTPException(422, str(exc))
            d["private_key_enc"] = crypto.seal(body.private_key.strip())
            if body.key_passphrase:
                d["key_passphrase_enc"] = crypto.seal(body.key_passphrase)
        elif same_server and old.get("private_key_enc"):
            d["private_key_enc"] = old["private_key_enc"]
            if old.get("key_passphrase_enc"):
                d["key_passphrase_enc"] = old["key_passphrase_enc"]
        else:
            raise HTTPException(422, "Paste the private key.")
    d = {k: v for k, v in d.items() if v is not None}
    s = {**s, "deploy": d}
    s.pop("deploy_test", None)  # a new setup must pass its own test deployment
    row.config = {**(row.config or {}), KEY: s}
    db.commit()
    hp.log_event(b.id, "deployment settings", True, f"{'SFTP' if body.adapter == 'sftp' else 'FTPS' if body.tls else 'FTP'} settings saved for {host} ({d['user']})")
    db.expire_all()
    return public(_row(db, b))


@router.post("/deployment/test-connection")
def test_deployment_connection(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Test connection: sign in, pin the server's host key, find the website folder. Nothing is written to the website."""
    s = hp.settings_of(_row(db, b))
    if not (s.get("deploy") or {}).get("adapter"):
        raise HTTPException(409, "Save the deployment settings first.")
    ok, steps = hp.test_connection(b.id)
    db.expire_all()
    return {"ok": ok, "steps": steps, "connection": public(_row(db, b))}


@router.delete("/deployment", status_code=204)
def remove_deployment(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Forget the deployment settings (and their test result). The website is not changed."""
    row = _row(db, b)
    s = hp.settings_of(row)
    if s.get("deploy"):
        s = {k: v for k, v in s.items() if k not in ("deploy", "deploy_test")}
        row.config = {**(row.config or {}), KEY: s}
        db.commit()
        hp.log_event(b.id, "deployment settings", True, "Deployment settings removed")


@router.post("/test-deploy", status_code=202)
def test_deploy(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Upload one small check file (.well-known/growzen-deploy-check.txt) with the configured adapter and wait until the
    live website serves it. Only then is publishing connected. Runs in the background; poll GET for the result."""
    s = hp.settings_of(_row(db, b))
    if not s or s.get("status") != "connected":
        raise HTTPException(409, "Connect the HTML website first (the website checks must pass).")
    if not _deployment(s).get("configured"):
        raise HTTPException(409, "No deployment is configured for this website on the server, so there is nothing to test. Use Download files instead.")
    if not hp.start_test_deploy(b.id):
        raise HTTPException(409, "A deployment for this website is already running. Wait for it to finish.")
    db.expire_all()
    return public(_row(db, b))


@router.get("/articles/{article_id}")
def article_status(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """This article on the HTML website: draft | publishing | uploading | deploying | published | failed | exported."""
    _article(db, b, article_id)
    s = hp.settings_of(_row(db, b))
    post = hp.recheck_post(b.id, article_id, s) if s else {}
    return {"status": post.get("status") or "draft", **{k: post.get(k) for k in ("detail", "url", "steps", "updated_at", "published_at", "error", "mode")},
            "publishing": public(_row(db, b)).get("publishing")}


@router.post("/articles/{article_id}/publish", status_code=202)
def publish_article(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Publish (or update) the article on the HTML website with the configured deployment. Runs in the background."""
    a = _article(db, b, article_id)
    if a.status != "completed":
        raise HTTPException(409, "Only a completed article can be published.")
    s = hp.settings_of(_row(db, b))
    if not s or s.get("status") != "connected":
        raise HTTPException(409, "Connect the HTML website first.")
    if not hp.deploy_ready(s):
        raise HTTPException(409, "Publishing is not connected yet: run a successful test deployment first, or use Download files.")
    if not hp.start_publish(b.id, a.id):
        raise HTTPException(409, "This website is busy with another deployment. Try again in a minute.")
    return {"status": "publishing"}


@router.get("/articles/{article_id}/export")
def export_article(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Manual export: a ZIP with exactly the files a publish would write, in the site's folders."""
    a = _article(db, b, article_id)
    if a.status != "completed":
        raise HTTPException(409, "Only a completed article can be exported.")
    s = hp.settings_of(_row(db, b))
    if not s or s.get("status") != "connected":
        raise HTTPException(409, "Connect the HTML website first.")
    try:
        dep = hp.deployer(s)
        prep = hp.prepare(s, dep, a, b, [])
    except (hp.PublishError, *hd.errors()) as exc:
        raise HTTPException(502, str(exc))
    if dep.name == "manual":
        hp._set_post(b.id, a.id, status="exported", detail="Files downloaded for manual upload", url=prep["url"], slug=prep["slug"],
                     url_path=prep.get("url_path"), mode=prep["mode"])
    return Response(hp.export_zip(prep, s), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{slugify(a.title or a.keyword)}-html.zip"'})


@router.delete("", status_code=204)
def disconnect_html_site(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Forget the HTML website settings (the WordPress / other connection in the same row is not touched)."""
    row = _row(db, b)
    if row and (row.config or {}).get(KEY):
        row.config = {k: v for k, v in row.config.items() if k != KEY} or None
        db.commit()
