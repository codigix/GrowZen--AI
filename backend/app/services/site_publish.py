"""Publishing a blog article to the business's own website.

1. detect(): read the site's technology (WordPress, Next.js, Shopify, Ghost, ...) and say how posts can reach it (services/site_stack.py).
2. verify_*(): check the credentials before they are saved, one named step at a time (the page shows them as a checklist).
3. publish(): send the article as a draft, a live post, or a post scheduled for later.

Methods: WordPress (REST API + Application Password), Ghost (Admin API key), Shopify (custom-app token), GitHub (a Markdown file committed to the site's repository,
for Next.js/Gatsby/Astro/Hugo/Jekyll and other code-based sites) and a signed webhook for anything else. GitHub cannot schedule by itself, so GrowZen holds
those posts and publishes them at the chosen time (run_due_scheduled).
"""
import hashlib
import hmac
import json
import re
from html import escape as html_escape
from datetime import datetime, timezone
from urllib.parse import urlsplit

import httpx

from ..models import Article, SiteIntegration
from . import crypto, site_adapters, site_stack
from .net import site_client
from .url_safety import SSRFValidationError, validate_url_shape

SIGNATURE_HEADER = "X-GrowZen-Signature"


class PublishError(RuntimeError):
    pass


def _is_wp_index(r: httpx.Response) -> bool:
    try:
        return r.status_code == 200 and "namespaces" in r.json()
    except ValueError:
        return False


def normalize_url(url: str) -> str:
    url = (url or "").strip()
    if url and "://" not in url:
        url = "https://" + url
    try:
        validate_url_shape(url)
    except SSRFValidationError as exc:
        raise PublishError(str(exc)) from exc
    p = urlsplit(url)
    return f"{p.scheme}://{p.netloc}{p.path}".rstrip("/")


def detect(url: str) -> dict:
    """Read a website's technology (CMS or framework, language, hosting, plugins) and say how posts can reach it. See services/site_stack.py."""
    return site_stack.detect(normalize_url(url))


# WordPress
def _wp_auth(row: SiteIntegration) -> tuple[str, str]:
    if not (row.username and row.secret_enc):
        raise PublishError("WordPress login is missing. Reconnect the website.")
    return row.username, crypto.unseal(row.secret_enc)


def verify_wordpress(base_url: str, username: str, password: str) -> tuple[list[dict], dict | None]:
    """Run the connection checks; returns (steps, info). info is None as soon as a step fails."""
    steps: list[dict] = []
    base = normalize_url(base_url)
    password = re.sub(r"\s+", " ", password.strip())  # WordPress shows application passwords in groups of four

    def step(name: str, ok: bool, detail: str) -> bool:
        steps.append({"step": name, "ok": ok, "detail": detail})
        return ok

    try:
        with site_client(20) as c:
            try:
                r = c.get(f"{base}/wp-json/")
            except httpx.HTTPError as exc:
                step("Reach the website", False, f"Could not connect: {str(exc)[:140]}")
                return steps, None
            step("Reach the website", True, f"{base} answered ({r.status_code})")
            if not _is_wp_index(r):
                step("Find the WordPress REST API", False, "/wp-json/ is not available. A security plugin or host setting may be blocking it, or this is not WordPress.")
                return steps, None
            step("Find the WordPress REST API", True, r.json().get("name") or "WordPress REST API found")
            me = c.get(f"{base}/wp-json/wp/v2/users/me", params={"context": "edit"}, auth=(username, password))
            if me.status_code in (401, 403):
                step("Sign in with the application password", False, "WordPress rejected the username or application password. Create a new one at Users > Profile > Application Passwords.")
                return steps, None
            if me.status_code >= 400:
                step("Sign in with the application password", False, f"WordPress answered {me.status_code}: {me.text[:120]}")
                return steps, None
            u = me.json()
            step("Sign in with the application password", True, f"Signed in as {u.get('name') or username}")
            caps = u.get("capabilities") or {}
            can_publish = bool(caps.get("publish_posts"))
            can_edit = bool(caps.get("edit_posts"))
            if not can_edit:
                step("Check permission to write posts", False, "This user cannot create posts. Use an Editor or Administrator account.")
                return steps, None
            step("Check permission to write posts", True, "Can publish posts" if can_publish else "Can create drafts only (an Admin must publish them)")
            return steps, {"site_name": r.json().get("name"), "user": u.get("name"), "can_publish": can_publish}
    except SSRFValidationError as exc:
        step("Reach the website", False, str(exc))
        return steps, None


def verify_webhook(url: str, secret: str) -> tuple[list[dict], dict | None]:
    steps: list[dict] = []
    url = normalize_url(url)
    payload = {"event": "ping", "sent_at": datetime.now(timezone.utc).isoformat()}
    try:
        r = _post_signed(url, secret, payload)
    except (httpx.HTTPError, SSRFValidationError) as exc:
        steps.append({"step": "Reach the webhook endpoint", "ok": False, "detail": f"Could not connect: {str(exc)[:140]}"})
        return steps, None
    steps.append({"step": "Reach the webhook endpoint", "ok": True, "detail": f"Answered {r.status_code}"})
    if r.status_code in (401, 403):
        steps.append({"step": "Signature accepted", "ok": False, "detail": "The site rejected the signature. Check that both sides use the same secret."})
        return steps, None
    if r.status_code >= 400:
        steps.append({"step": "Signature accepted", "ok": False, "detail": f"The endpoint answered {r.status_code}: {r.text[:120]}"})
        return steps, None
    steps.append({"step": "Signature accepted", "ok": True, "detail": "The site accepted the signed test message"})
    return steps, {"site_name": urlsplit(url).netloc}


def _post_signed(url: str, secret: str, payload: dict) -> httpx.Response:
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
    sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    with site_client(30) as c:
        return c.post(url, content=body, headers={"Content-Type": "application/json", SIGNATURE_HEADER: f"sha256={sig}"})


# Publishing
def ensure_wp_featured_media(row: SiteIntegration, a: Article) -> tuple[str | None, str | None, list[dict]]:
    """Make sure the article's featured image is in the WordPress media library: reuse wp_media_id when it still exists
    (only its ALT text is refreshed), otherwise upload the file. Returns (media_id, public_url, steps); (None, None, [])
    when the article has no featured image. Raises PublishError when WordPress refuses the upload."""
    from . import featured_images as fi

    p = fi.path_of(a.featured_image_path)
    if row.method != "wordpress" or not p:
        return None, None, []
    steps: list[dict] = []
    base = row.base_url.rstrip("/")
    alt = (a.featured_image_alt or a.title or a.keyword or "").strip()[:255]
    try:
        with site_client(90) as c:
            auth = _wp_auth(row)
            if a.wp_media_id and str(a.wp_media_id).isdigit():
                r = c.get(f"{base}/wp-json/wp/v2/media/{a.wp_media_id}", params={"context": "edit"}, auth=auth)
                if r.status_code == 200:
                    d = r.json()
                    if (d.get("alt_text") or "") != alt:
                        c.post(f"{base}/wp-json/wp/v2/media/{a.wp_media_id}", json={"alt_text": alt}, auth=auth)
                    steps.append({"step": "Featured image", "ok": True, "detail": f"Using media #{a.wp_media_id} already on the site"})
                    return str(a.wp_media_id), d.get("source_url"), steps
            r = c.post(f"{base}/wp-json/wp/v2/media", content=p.read_bytes(), auth=auth,
                       headers={"Content-Type": fi.media_type(a.featured_image_path), "Content-Disposition": f'attachment; filename="{fi.upload_filename(a, a.featured_image_path)}"'})
            if r.status_code in (401, 403):
                steps.append({"step": "Featured image", "ok": False, "detail": "WordPress refused the image upload (the user needs the upload_files permission)."})
                raise PublishError("WordPress refused the featured image upload. The connected user needs permission to upload files.")
            if r.status_code >= 400:
                steps.append({"step": "Featured image", "ok": False, "detail": f"{r.status_code}: {r.text[:140]}"})
                raise PublishError(f"WordPress could not store the featured image ({r.status_code}): {r.text[:200]}")
            d = r.json()
            mid = str(d.get("id", ""))
            c.post(f"{base}/wp-json/wp/v2/media/{mid}", json={"alt_text": alt, "title": a.title or a.keyword}, auth=auth)
            steps.append({"step": "Featured image", "ok": True, "detail": f"Uploaded to the media library as #{mid}"})
            return mid, d.get("source_url"), steps
    except (httpx.HTTPError, SSRFValidationError) as exc:
        steps.append({"step": "Featured image", "ok": False, "detail": str(exc)[:140]})
        raise PublishError(f"Could not upload the featured image to WordPress: {str(exc)[:160]}") from exc


def existing_wp_post(row: SiteIntegration, a: Article) -> str | None:
    """The WordPress post this article already has on this site (publishing again updates it instead of creating a copy)."""
    if row.method != "wordpress" or not a.wp_post_id or a.wp_status == "deleted" or (a.publish_method or "wordpress") != "wordpress":
        return None
    return a.wp_post_id if str(a.wp_post_id).isdigit() else None


def publish(row: SiteIntegration, a: Article, mode: str, when: datetime | None, exclude_layout_ids: set[str] | None = None) -> dict:
    """mode: draft | publish | schedule. Returns {id, url, status, steps}.
    exclude_layout_ids: post ids GrowZen published itself (never used as the design reference)."""
    if row.method == "wordpress":
        steps = [{"step": "Prepare the article", "ok": True, "detail": f"{len((a.body or '').split())} words, title: {a.title or a.keyword}"}]
        if mode == "schedule" and (not when or when <= datetime.now(timezone.utc)):
            raise PublishError("Pick a date and time in the future to schedule the post.")
        out = _publish_wordpress(row, a, mode, when, steps, exclude_layout_ids)
        out["steps"] = steps
        return out
    steps = [{"step": "Prepare the article", "ok": True, "detail": f"{len((a.body or '').split())} words, title: {a.title or a.keyword}"}]
    if mode == "schedule" and (not when or when <= datetime.now(timezone.utc)):
        raise PublishError("Pick a date and time in the future to schedule the post.")
    if mode == "schedule" and row.method in LOCAL_SCHEDULE:
        raise PublishError("This website has no way to publish later by itself: GrowZen schedules it and publishes at the chosen time.")
    if row.method == "wordpress":
        out = _publish_wordpress(row, a, mode, when, steps)
    elif row.method == "webhook":
        out = _publish_webhook(row, a, mode, when, steps)
    elif row.method in ("github", "ghost", "shopify"):
        out = _adapted(getattr(site_adapters, f"publish_{row.method}"), row, a, mode, when, steps)
    else:
        raise PublishError("This website is not connected yet.")
    out["steps"] = steps
    return out


def _publish_wordpress(row: SiteIntegration, a: Article, mode: str, when: datetime | None, steps: list[dict],
                       exclude_layout_ids: set[str] | None = None) -> dict:
    from . import articles as article_svc, elementor_layout as el

    wp_status = {"draft": "draft", "publish": "publish", "schedule": "future"}[mode]
    body = el.clean_body(a.body or "")  # no duplicate H1, no inline styles or empty tags
    payload = {"title": a.title or a.keyword, "content": body, "excerpt": a.meta_description or "", "status": wp_status}
    if a.wp_media_id and str(a.wp_media_id).isdigit():  # the featured image shown on the blog cards and the post page
        payload["featured_media"] = int(a.wp_media_id)
    if mode == "schedule":
        payload["date_gmt"] = when.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    base = row.base_url.rstrip("/")
    existing = existing_wp_post(row, a)
    try:
        with site_client(45) as c:
            # The site's own blog design: rebuild the article inside the layout of an Elementor-built blog post
            try:
                ref = el.find_reference(c, base, _wp_auth(row), preferred_id=(row.config or {}).get("layout_post_id"),
                                        exclude_ids=(exclude_layout_ids or set()) | ({existing} if existing else set()))
            except httpx.HTTPError:
                ref = None
            if ref:
                faqs = [(q, f"<p>{html_escape(ans)}</p>") for q, ans in article_svc.faqs_of(body) if not article_svc._is_template_faq(q, ans)]
                data, rep = el.build(ref["data"], article_key=f"growzen-{a.id}", body=body, faqs=faqs)
                payload["template"] = ref["template"]
                payload["meta"] = {"_elementor_edit_mode": "builder", "_elementor_template_type": "wp-post", "_elementor_data": json.dumps(data, ensure_ascii=False)}
                if ref["categories"]:
                    payload["categories"] = ref["categories"]
                steps.append({"step": "Apply the blog layout", "ok": True,
                              "detail": f"Site design from \"{ref['title'][:60]}\" (post #{ref['id']}): {rep['sections']} sections, {rep['faqs']} FAQs in the accordion"})
            else:
                steps.append({"step": "Apply the blog layout", "ok": True, "detail": "No Elementor-built blog post to copy the design from; sent as clean HTML (theme layout)"})
            r = None
            if existing:  # already on the site: update that post, never create a duplicate
                r = c.post(f"{base}/wp-json/wp/v2/posts/{existing}", json=payload, auth=_wp_auth(row))
                if r.status_code in (404, 410):  # removed on the website in the meantime: create it again
                    steps.append({"step": "Find the existing post", "ok": True, "detail": f"Post #{existing} no longer exists on the site; creating a new one"})
                    existing, r = None, None
            if r is None:
                r = c.post(f"{base}/wp-json/wp/v2/posts", json=payload, auth=_wp_auth(row))
            if r.status_code in (401, 403):
                steps.append({"step": "Send to WordPress", "ok": False, "detail": "WordPress refused the login. Reconnect the website."})
                raise PublishError("WordPress refused the login. Reconnect the website.")
            if r.status_code >= 400:
                steps.append({"step": "Send to WordPress", "ok": False, "detail": f"{r.status_code}: {r.text[:140]}"})
                raise PublishError(f"WordPress refused the post ({r.status_code}): {r.text[:200]}")
            d = r.json()
            steps.append({"step": "Send to WordPress", "ok": True, "detail": f"Post #{d.get('id')} {'updated' if existing else 'created'} as {d.get('status')}"})
            # WordPress downgrades a post to draft or pending when the user lacks the publish permission.
            if d.get("status") != wp_status:
                steps.append({"step": "Confirm the post status", "ok": False, "detail": f"WordPress saved it as '{d.get('status')}'. The user may not have permission to publish."})
            else:
                steps.append({"step": "Confirm the post status", "ok": True, "detail": {"draft": "Saved as a draft", "publish": "Published", "future": "Scheduled by WordPress"}[wp_status]})
            if ref and existing:
                # Elementor keeps rendered output and a CSS file per post that are only refreshed by its own editor;
                # after a REST update they must be cleared, or the site keeps showing the old version
                # (same as Elementor > Tools > Regenerate Files & Data; files are rebuilt on the next page view).
                try:
                    cr = c.delete(f"{base}/wp-json/elementor/v1/cache", auth=_wp_auth(row))
                    steps.append({"step": "Refresh the site's Elementor cache", "ok": cr.status_code < 400,
                                  "detail": "Cleared, so the update shows immediately" if cr.status_code < 400 else f"Could not clear it ({cr.status_code}); use Elementor > Tools > Regenerate Files & Data"})
                except httpx.HTTPError:
                    steps.append({"step": "Refresh the site's Elementor cache", "ok": False, "detail": "Could not clear it; use Elementor > Tools > Regenerate Files & Data"})
            if wp_status == "publish":
                try:
                    live = c.get(d["link"])
                    steps.append({"step": "Check the live page", "ok": live.status_code == 200, "detail": f"{d['link']} answered {live.status_code}"})
                except httpx.HTTPError:
                    steps.append({"step": "Check the live page", "ok": False, "detail": "The page did not answer yet (a cache may delay it)"})
            return {"id": str(d.get("id", "")), "url": d.get("link", ""), "status": d.get("status")}
    except (httpx.HTTPError, SSRFValidationError) as exc:
        steps.append({"step": "Send to WordPress", "ok": False, "detail": str(exc)[:140]})
        raise PublishError(f"Could not reach WordPress: {str(exc)[:160]}") from exc


def delete_wordpress(row: SiteIntegration, post_id: str) -> dict:
    """Permanently delete ONE WordPress post by its id: DELETE /wp-json/wp/v2/posts/{id}?force=true (skips the Trash).
    Success only when WordPress answers {"deleted": true, "previous": {"id": <the same id>}}. A post that no longer
    exists (404 rest_post_invalid_id) counts as already deleted. Anything else raises PublishError with WordPress's message.
    Returns {steps, already_gone}."""
    steps: list[dict] = []
    pid = str(post_id or "").strip()
    if not pid.isdigit():
        raise PublishError("This article has no WordPress post id, so there is nothing to delete on the website.")
    if row.method != "wordpress":
        raise PublishError("Deleting from the website is available for WordPress sites only.")
    base = row.base_url.rstrip("/")

    def wp_message(r: httpx.Response) -> str:
        try:
            d = r.json()
            return f"{d.get('message') or r.text[:160]} ({d.get('code') or r.status_code})"
        except ValueError:
            return f"{r.status_code}: {r.text[:160]}"

    try:
        with site_client(30) as c:
            r = c.delete(f"{base}/wp-json/wp/v2/posts/{pid}", params={"force": "true"}, auth=_wp_auth(row))
    except (httpx.HTTPError, SSRFValidationError) as exc:
        steps.append({"step": "Delete the post on WordPress", "ok": False, "detail": str(exc)[:140]})
        raise PublishError(f"Could not reach WordPress: {str(exc)[:160]}") from exc

    if r.status_code == 404:
        try:
            code = r.json().get("code")
        except ValueError:
            code = None
        if code == "rest_post_invalid_id":
            steps.append({"step": "Delete the post on WordPress", "ok": True, "detail": f"Post #{pid} was already removed from the website"})
            return {"steps": steps, "already_gone": True}
    if r.status_code in (401, 403):
        raise PublishError(f"WordPress refused to delete post #{pid}: {wp_message(r)}. The connected user needs permission to delete posts; reconnect if the password changed.")
    if r.status_code >= 400:
        raise PublishError(f"WordPress could not delete post #{pid}: {wp_message(r)}")
    try:
        d = r.json()
    except ValueError:
        raise PublishError(f"WordPress answered {r.status_code} but not with JSON, so the delete could not be confirmed.") from None
    prev_id = str((d.get("previous") or {}).get("id", ""))
    if d.get("deleted") is not True or prev_id != pid:
        raise PublishError(f"WordPress did not confirm deleting post #{pid} (answer: deleted={d.get('deleted')}, id={prev_id or '?'}). The post was left as it is.")
    steps.append({"step": "Delete the post on WordPress", "ok": True, "detail": f"Post #{pid} permanently deleted"})
    return {"steps": steps, "already_gone": False}


def _publish_webhook(row: SiteIntegration, a: Article, mode: str, when: datetime | None, steps: list[dict]) -> dict:
    secret = crypto.unseal(row.secret_enc) if row.secret_enc else ""
    payload = {
        "event": "article.publish", "mode": mode, "publish_at": when.astimezone(timezone.utc).isoformat() if when else None,
        "article": {"id": a.id, "title": a.title or a.keyword, "slug": re.sub(r"[^a-z0-9]+", "-", (a.title or a.keyword).lower()).strip("-"),
                    "keyword": a.keyword, "secondary_keywords": a.secondary_keywords or [], "meta_description": a.meta_description or "", "html": a.body or ""},
    }
    try:
        r = _post_signed(row.base_url, secret, payload)
    except (httpx.HTTPError, SSRFValidationError) as exc:
        steps.append({"step": "Send to the website", "ok": False, "detail": str(exc)[:140]})
        raise PublishError(f"Could not reach the website: {str(exc)[:160]}") from exc
    if r.status_code >= 400:
        steps.append({"step": "Send to the website", "ok": False, "detail": f"{r.status_code}: {r.text[:140]}"})
        raise PublishError(f"The website refused the post ({r.status_code}): {r.text[:200]}")
    steps.append({"step": "Send to the website", "ok": True, "detail": f"Accepted ({r.status_code})"})
    try:
        d = r.json()
    except ValueError:
        d = {}
    return {"id": str(d.get("id", "")), "url": d.get("url", ""), "status": d.get("status") or {"draft": "draft", "publish": "publish", "schedule": "future"}[mode]}


# ---- the other methods (services/site_adapters.py), with their errors mapped to PublishError
METHODS = ("wordpress", "webhook", "github", "ghost", "shopify")
LOCAL_SCHEDULE = frozenset({"github"})  # methods with no native "publish later": GrowZen publishes them at the chosen time


def _adapted(fn, *args):
    try:
        return fn(*args)
    except site_adapters.AdapterError as exc:
        raise PublishError(str(exc)) from exc


def verify_github(token: str, repo: str, branch: str | None, directory: str) -> tuple[list[dict], dict | None]:
    return _adapted(site_adapters.verify_github, token, repo, branch, directory)


def verify_ghost(url: str, key: str) -> tuple[list[dict], dict | None]:
    return _adapted(site_adapters.verify_ghost, normalize_url(url), key)


def verify_shopify(url: str, token: str, blog_id: str | None = None) -> tuple[list[dict], dict | None]:
    return _adapted(site_adapters.verify_shopify, url, token, blog_id)


def verify_saved(row: SiteIntegration) -> tuple[list[dict], dict | None]:
    """Re-run the checks with a connection's saved credentials."""
    secret = crypto.unseal(row.secret_enc)
    cfg = row.config or {}
    if row.method == "wordpress":
        return verify_wordpress(row.base_url, row.username or "", secret)
    if row.method == "github":
        return verify_github(secret, cfg.get("repo", ""), cfg.get("branch"), cfg.get("directory", "content/blog"))
    if row.method == "ghost":
        return verify_ghost(row.base_url, secret)
    if row.method == "shopify":
        return verify_shopify(row.base_url, secret, cfg.get("blog_id"))
    return verify_webhook(row.base_url, secret)


def run_due_scheduled(db, now: datetime | None = None, limit: int = 20) -> int:
    """Publish the posts GrowZen is holding whose time has come. A failure is retried (three tries, ten minutes apart) before it is marked failed."""
    from datetime import timedelta

    from sqlalchemy import select

    from ..models import ScheduledPost
    from .activity import log
    now = now or datetime.now(timezone.utc)
    done = 0
    for sp_row in list(db.scalars(select(ScheduledPost).where(ScheduledPost.status == "pending", ScheduledPost.due_at <= now).order_by(ScheduledPost.due_at).limit(limit))):
        a = db.get(Article, sp_row.article_id)
        row = db.scalar(select(SiteIntegration).where(SiteIntegration.business_id == sp_row.business_id))
        try:
            if a is None or row is None or row.status != "connected" or row.method != sp_row.method:
                raise PublishError("The website is no longer connected, or the article was deleted.")
            out = publish(row, a, "publish", None)
            sp_row.status, sp_row.result, sp_row.error, sp_row.finished_at = "published", {k: out.get(k) for k in ("id", "url", "status")}, None, now
            a.wp_post_id, a.wp_url = out["id"] or None, out["url"] or None
            a.wp_status, a.publish_method, a.wp_deleted_at = out.get("status") or "publish", row.method, None
            log(db, "scheduler", "post_published", sp_row.business_id, article_id=sp_row.article_id, url=out.get("url"))
            done += 1
        except PublishError as exc:
            sp_row.attempts += 1
            sp_row.error = str(exc)[:500]
            if sp_row.attempts >= 3 or "no longer connected" in str(exc):
                sp_row.status, sp_row.finished_at = "failed", now
                log(db, "scheduler", "post_publish_failed", sp_row.business_id, article_id=sp_row.article_id, error=str(exc)[:200])
            else:
                sp_row.due_at = now + timedelta(minutes=10)
        db.commit()
    return done
