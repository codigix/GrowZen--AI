"""The HTML Website publishing destination: site settings, deployment (FTP/FTPS/SFTP), tests, and publishing.

Everything is kept in site_integrations.config["html_site"] (see services/html_publisher.py). The WordPress / other
connection fields of that row are never read or changed here, and the React.js connection lives in its own table.
Secrets (FTP/SFTP password) are encrypted (crypto.seal) and never returned to the page.
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_business
from ..models import Article, Business, SiteIntegration
from ..services import crypto, html_deploy as hd, html_publisher as hp, site_publish as sp

router = APIRouter(prefix="/businesses/{business_id}/html-site", tags=["html-site"])


class SiteIn(BaseModel):
    website_name: str | None = Field(default=None, max_length=200)
    website_url: str = Field(min_length=3, max_length=500)
    listing_file: str = Field(default="blog.html", min_length=1, max_length=200)  # the blog listing page, e.g. blog.html
    articles_folder: str = Field(default="blog", min_length=1, max_length=200)  # where article pages / images go, e.g. blog


class DeployIn(BaseModel):
    adapter: Literal["ftp", "sftp"] = "ftp"
    host: str = Field(min_length=1, max_length=255)
    port: int | None = Field(default=None, ge=1, le=65535)
    user: str = Field(min_length=1, max_length=255)
    password: str | None = Field(default=None, max_length=500)  # empty: keep the saved one
    tls: bool = True  # FTP only: explicit FTPS (AUTH TLS)
    root: str | None = Field(default=None, max_length=300)  # website folder, e.g. public_html; empty = detect


def _row(db: Session, b: Business) -> SiteIntegration | None:
    return db.scalar(select(SiteIntegration).where(SiteIntegration.business_id == b.id))


def _ensure_row(db: Session, b: Business) -> SiteIntegration:
    row = _row(db, b)
    if not row:
        row = SiteIntegration(business_id=b.id)  # defaults: WordPress & co. stay "not_connected"
        db.add(row)
        db.commit()
    return row


def _fresh(db: Session, b: Business) -> dict:
    """The settings as stored now (html_publisher writes them in its own session, so drop this session's cached copy)."""
    db.expire_all()
    return hp.settings_of(_row(db, b))


def _save(db: Session, row: SiteIntegration, s: dict) -> None:
    row.config = {**(row.config or {}), hp.KEY: s}  # only the html_site key changes
    db.commit()


def _clean_path(p: str) -> str:
    p = (p or "").strip().replace("\\", "/").strip("/")
    if not p or ".." in p.split("/") or p.startswith(("http:", "https:")):
        raise HTTPException(400, f"'{p}' is not a valid path on the website.")
    return p


def public(s: dict) -> dict:
    """What the page may know. Never a credential."""
    d = s.get("deploy") or {}
    deploy = None
    if d.get("adapter"):
        deploy = {"source": "app", "adapter": d["adapter"], "host": d.get("host"), "port": d.get("port"), "user": d.get("user"), "tls": bool(d.get("tls")),
                  "root": d.get("root"), "has_password": bool(d.get("password_enc")), "host_key": d.get("host_key"), "connection_test": d.get("connection_test")}
    elif s.get("website_url"):
        try:
            desc = hd.describe(hd.load_entry(s["website_url"]))
        except hd.DeployError:
            desc = {"configured": False}
        if desc.get("configured"):
            deploy = {"source": "server", "adapter": desc["adapter"], "label": desc["label"], "target": desc["target"]}
    try:
        ready = hp.deploy_ready(s) if s.get("website_url") else False
    except Exception:  # noqa: BLE001 - a broken server config file only means "not ready"
        ready = False
    test = s.get("deploy_test") or None
    if test and test.get("status") == "ok" and not ready:
        test = {**test, "status": "outdated", "detail": "The deployment settings changed after this test. Run the test deployment again."}
    return {"configured": bool(s.get("website_url")), "status": s.get("status") or "not_connected", "website_name": s.get("website_name"),
            "website_url": s.get("website_url"), "listing_file": s.get("listing_file"), "articles_folder": s.get("articles_folder"),
            "shape": {k: v for k, v in (s.get("shape") or {}).items() if k not in ("slugs", "links")} or None, "site_check": s.get("site_check"),
            "deploy": deploy, "deploy_test": test, "ready": bool(s.get("status") == "connected" and ready),
            "log": (s.get("log") or [])[:15]}


@router.get("")
def get_site(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return public(_fresh(db, b))


@router.put("")
def save_site(body: SiteIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Save the website settings and check the site: read the live listing page and detect how it keeps its articles."""
    try:
        url = sp.normalize_url(body.website_url)
    except sp.PublishError as exc:
        raise HTTPException(400, str(exc))
    listing, folder = _clean_path(body.listing_file), _clean_path(body.articles_folder)
    row = _ensure_row(db, b)
    s = dict(hp.settings_of(row))
    s.update({"website_name": (body.website_name or "").strip() or b.name, "website_url": url, "listing_file": listing, "articles_folder": folder})
    html = hp._live(f"{url}/{listing}")
    if not html:
        s.update({"status": "error", "shape": None, "site_check": {"ok": False, "at": hp._now(), "detail": f"Could not open {url}/{listing}. Check the website address and the blog listing file."}})
    else:
        try:
            shape = hp.detect(url, listing, folder, html, lambda p: hp._live(f"{url}/{p.lstrip('/')}"))
            detail = (f"Articles are kept in {shape['data_file']} ('{shape['array_key']}' list, {shape['count']} article(s)); new articles appear at {shape['url_pattern']}"
                      if shape["mode"] == "data" else f"Each article is its own page ({shape['count']} found); new articles appear at {shape['url_pattern']}")
            s.update({"status": "connected", "shape": shape, "site_check": {"ok": True, "at": hp._now(), "detail": detail}})
        except Exception as exc:  # noqa: BLE001 - shown to the user
            s.update({"status": "error", "shape": None, "site_check": {"ok": False, "at": hp._now(), "detail": f"The blog page could not be read: {str(exc)[:300]}"}})
    _save(db, row, s)
    hp.log_event(b.id, "site check", s["status"] == "connected", s["site_check"]["detail"])
    return public(_fresh(db, b))


@router.put("/deploy")
def save_deploy(body: DeployIn, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Save the deployment settings (password encrypted). A changed setup must pass Test connection and the test deployment again."""
    row = _row(db, b)
    s = dict(hp.settings_of(row))
    if not s.get("website_url"):
        raise HTTPException(409, "Save the website settings first.")
    why = hd.bad_root(body.root)
    if why:
        raise HTTPException(400, why)
    old = s.get("deploy") or {}
    host, user = body.host.strip().removeprefix("ftp://").removeprefix("sftp://").strip("/"), body.user.strip()
    same_account = old.get("adapter") == body.adapter and old.get("host") == host and old.get("user") == user
    d = {"adapter": body.adapter, "host": host, "port": body.port or (22 if body.adapter == "sftp" else 21), "user": user,
         "tls": bool(body.tls) if body.adapter == "ftp" else False}
    if (body.root or "").strip().strip("/"):
        d["root"] = body.root.strip().strip("/")
    if body.password:
        d["password_enc"] = crypto.seal(body.password)
    elif same_account and old.get("password_enc"):
        d["password_enc"] = old["password_enc"]
    else:
        raise HTTPException(400, "Enter the password.")
    if same_account and old.get("host_key") and d["port"] == old.get("port"):
        d["host_key"] = old["host_key"]  # the pinned SSH host key stays for the same server
    s["deploy"] = d
    _save(db, row, s)
    hp.log_event(b.id, "deployment settings", True, f"Saved {('FTPS' if d['tls'] else 'FTP') if d['adapter'] == 'ftp' else 'SFTP'} {user}@{host}:{d['port']}")
    return public(_fresh(db, b))


@router.post("/deploy/test-connection")
def test_connection(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Sign in and find the website folder. Writes nothing on the website."""
    s = hp.settings_of(_row(db, b))
    if not (s.get("website_url") and (s.get("deploy") or {}).get("adapter")):
        raise HTTPException(409, "Save the website and deployment settings first.")
    ok, steps = hp.test_connection(b.id)
    return {"ok": ok, "steps": steps, "site": public(_fresh(db, b))}


@router.post("/deploy/test")
def test_deploy(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Upload a small check file and wait until the live website serves it (runs in the background; poll GET)."""
    s = hp.settings_of(_row(db, b))
    if not s.get("website_url"):
        raise HTTPException(409, "Save the website settings first.")
    if not hp.start_test_deploy(b.id):
        raise HTTPException(409, "A test or publish is already running for this website. Wait a moment.")
    return public(_fresh(db, b))


@router.delete("", status_code=204)
def disconnect(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Remove the HTML Website settings only (WordPress & co. on the same row are kept)."""
    row = _row(db, b)
    if row and (row.config or {}).get(hp.KEY) is not None:
        row.config = {k: v for k, v in (row.config or {}).items() if k != hp.KEY} or None
        db.commit()


def _article(db: Session, b: Business, article_id: int) -> Article:
    a = db.get(Article, article_id)
    if not a or a.business_id != b.id:
        raise HTTPException(404, "Article not found")
    return a


def _post_public(post: dict) -> dict:
    return {k: post.get(k) for k in ("status", "detail", "url", "error", "steps", "published_at", "updated_at")}


@router.get("/articles/{article_id}")
def article_status(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    _article(db, b, article_id)
    s = hp.settings_of(_row(db, b))
    return _post_public(hp.recheck_post(b.id, article_id, s))


@router.post("/articles/{article_id}/publish")
def publish(article_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Publish now (background): upload the article's files, then confirm the live website shows it."""
    a = _article(db, b, article_id)
    if not (a.body or "").strip():
        raise HTTPException(400, "The article has no content yet.")
    s = hp.settings_of(_row(db, b))
    if not public(s)["ready"]:
        raise HTTPException(409, "The HTML website is not connected yet: save the settings, then Test connection and Run test deployment.")
    if not hp.start_publish(b.id, a.id):
        raise HTTPException(409, "A publish or test is already running for this website. Wait a moment.")
    return _post_public(((_fresh(db, b).get("posts") or {}).get(str(a.id))) or {})
