"""Publishing to a customer's website (services/site_publish.py), against a SIMULATED WordPress REST API and a signed webhook endpoint.
These prove our side of the protocol (requests, error handling, status checks). They cannot prove a particular real site's plugins or host
rules allow it: that needs one real connection, which the app's "Check connection" button does with the customer's own credentials."""
import base64
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app.models import Article, SiteIntegration
from app.services import crypto, site_publish

BASE = "https://wp.example.org"


class FakeWordPress:
    """Just enough of WordPress: the REST index, /users/me with application-password auth, and POST /posts."""

    def __init__(self, user="editor", password="abcd efgh ijkl mnop", can_publish=True, can_edit=True, downgrade=False, rest=True, live_status=200, post_status=None):
        self.user, self.password, self.can_publish, self.can_edit, self.downgrade, self.rest, self.live_status, self.post_status = user, password, can_publish, can_edit, downgrade, rest, live_status, post_status
        self.posts: list[dict] = []

    def _authed(self, req: httpx.Request) -> bool:
        h = req.headers.get("authorization", "")
        if not h.startswith("Basic "):
            return False
        return base64.b64decode(h[6:]).decode() == f"{self.user}:{self.password}"

    def __call__(self, req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path == "/wp-json/":
            return httpx.Response(200, json={"name": "Example Clinic", "namespaces": ["wp/v2"]}) if self.rest else httpx.Response(404, text="nope")
        if path == "/wp-json/wp/v2/users/me":
            if not self._authed(req):
                return httpx.Response(401, json={"code": "rest_not_logged_in"})
            return httpx.Response(200, json={"name": "Dr Editor", "capabilities": {"edit_posts": self.can_edit, "publish_posts": self.can_publish}})
        if path == "/wp-json/wp/v2/posts" and req.method == "POST":
            if not self._authed(req):
                return httpx.Response(401, json={"code": "rest_cannot_create"})
            body = json.loads(req.content)
            status = "draft" if self.downgrade else (self.post_status or body["status"])
            self.posts.append(body)
            return httpx.Response(201, json={"id": 77, "status": status, "link": f"{BASE}/2026/10/post-77/"})
        if path.startswith("/2026/10/post-77"):
            return httpx.Response(self.live_status, text="<html>post</html>")
        return httpx.Response(404)


@pytest.fixture()
def wp(monkeypatch):
    """Route every site_client() call in site_publish to the given fake (no network, no DNS)."""
    def install(fake):
        monkeypatch.setattr(site_publish, "site_client", lambda timeout=15: httpx.Client(transport=httpx.MockTransport(fake), follow_redirects=True, timeout=timeout))
        return fake
    return install


def _row(user="editor", password="abcd efgh ijkl mnop", method="wordpress", base=BASE):
    return SiteIntegration(business_id=1, method=method, platform=method, base_url=base, username=user, secret_enc=crypto.seal(password), status="connected")


def _article(title="Teeth whitening in Pune"):
    return Article(business_id=1, keyword="teeth whitening pune", title=title, body="<p>" + "word " * 120 + "</p>", meta_description="A guide.")


# ---- connection check -------------------------------------------------------------------------------------------------------

def test_connection_check_passes_for_an_editor_and_accepts_the_spaced_application_password(wp):
    wp(FakeWordPress())
    steps, info = site_publish.verify_wordpress(BASE + "/", "editor", "abcd  efgh ijkl   mnop")  # pasted with odd spacing
    assert [s["ok"] for s in steps] == [True, True, True, True] and info == {"site_name": "Example Clinic", "user": "Dr Editor", "can_publish": True}


@pytest.mark.parametrize("fake, step, hint", [
    (FakeWordPress(rest=False), "Find the WordPress REST API", "security plugin"),
    (FakeWordPress(password="different"), "Sign in with the application password", "Application Passwords"),
    (FakeWordPress(can_edit=False), "Check permission to write posts", "Editor or Administrator"),
])
def test_connection_check_names_the_step_that_failed_and_says_how_to_fix_it(wp, fake, step, hint):
    wp(fake)
    steps, info = site_publish.verify_wordpress(BASE, "editor", "abcd efgh ijkl mnop")
    assert info is None and steps[-1]["step"] == step and steps[-1]["ok"] is False and hint in steps[-1]["detail"]


def test_connection_check_reports_an_unreachable_site_instead_of_raising(monkeypatch):
    def down(req):
        raise httpx.ConnectError("refused")
    monkeypatch.setattr(site_publish, "site_client", lambda timeout=15: httpx.Client(transport=httpx.MockTransport(down), timeout=timeout))
    steps, info = site_publish.verify_wordpress(BASE, "editor", "x")
    assert info is None and steps == [{"step": "Reach the website", "ok": False, "detail": "Could not connect: refused"}]


def test_a_private_address_is_refused_before_any_request_is_made():
    with pytest.raises(site_publish.PublishError):
        site_publish.normalize_url("http://user:pass@example.org")  # credentials in a URL are rejected
    steps, info = site_publish.verify_wordpress("http://169.254.169.254", "u", "p")
    assert info is None and steps[0]["ok"] is False  # the SSRF guard stops it


# ---- publishing -------------------------------------------------------------------------------------------------------------

def test_publish_sends_the_article_and_checks_the_live_page(wp):
    fake = wp(FakeWordPress())
    out = site_publish.publish(_row(), _article(), "publish", None)
    assert out["status"] == "publish" and out["url"].endswith("/post-77/")
    assert fake.posts[0]["status"] == "publish" and fake.posts[0]["title"] == "Teeth whitening in Pune" and fake.posts[0]["excerpt"] == "A guide."
    assert all(s["ok"] for s in out["steps"]) and out["steps"][-1]["step"] == "Check the live page"


def test_draft_mode_does_not_publish_and_skips_the_live_check(wp):
    fake = wp(FakeWordPress())
    out = site_publish.publish(_row(), _article(), "draft", None)
    assert fake.posts[0]["status"] == "draft" and out["status"] == "draft" and "Check the live page" not in [s["step"] for s in out["steps"]]


def test_scheduling_needs_a_future_time_and_sends_it_in_utc(wp):
    fake = wp(FakeWordPress())
    with pytest.raises(site_publish.PublishError, match="future"):
        site_publish.publish(_row(), _article(), "schedule", datetime.now(timezone.utc) - timedelta(hours=1))
    when = datetime(2030, 1, 5, 9, 30, tzinfo=timezone(timedelta(hours=5, minutes=30)))
    out = site_publish.publish(_row(), _article(), "schedule", when)
    assert fake.posts[0]["status"] == "future" and fake.posts[0]["date_gmt"] == "2030-01-05T04:00:00" and out["status"] == "future"


def test_a_user_who_cannot_publish_is_told_the_post_was_saved_as_a_draft(wp):
    wp(FakeWordPress(downgrade=True))
    out = site_publish.publish(_row(), _article(), "publish", None)
    confirm = next(s for s in out["steps"] if s["step"] == "Confirm the post status")
    assert confirm["ok"] is False and "'draft'" in confirm["detail"] and out["status"] == "draft"  # never reported as published


def test_refused_login_and_server_errors_become_clear_errors(wp):
    wp(FakeWordPress(password="rotated"))
    with pytest.raises(site_publish.PublishError, match="refused the login"):
        site_publish.publish(_row(), _article(), "publish", None)

    def broken(req):
        return httpx.Response(500, text="database error") if req.method == "POST" else httpx.Response(404)
    wp(broken)
    with pytest.raises(site_publish.PublishError, match=r"\(500\)"):
        site_publish.publish(_row(), _article(), "publish", None)


def test_a_published_page_that_does_not_answer_is_flagged_not_hidden(wp):
    wp(FakeWordPress(live_status=404))
    out = site_publish.publish(_row(), _article(), "publish", None)
    live = out["steps"][-1]
    assert live["step"] == "Check the live page" and live["ok"] is False and "404" in live["detail"]


def test_a_missing_login_is_caught_before_calling_wordpress(wp):
    wp(FakeWordPress())
    row = _row()
    row.secret_enc = None
    with pytest.raises(site_publish.PublishError, match="login is missing"):
        site_publish.publish(row, _article(), "draft", None)
    row.method = None
    with pytest.raises(site_publish.PublishError, match="not connected"):
        site_publish.publish(row, _article(), "draft", None)


# ---- signed webhook -----------------------------------------------------------------------------------------------------------

def test_webhook_posts_are_signed_so_the_site_can_verify_them(monkeypatch):
    seen = {}

    def endpoint(req: httpx.Request):
        seen.update(body=req.content, sig=req.headers.get(site_publish.SIGNATURE_HEADER))
        return httpx.Response(200, json={"id": "p9", "url": "https://shop.example.org/blog/x", "status": "draft"})
    monkeypatch.setattr(site_publish, "site_client", lambda timeout=15: httpx.Client(transport=httpx.MockTransport(endpoint), timeout=timeout))
    row = _row(method="webhook", base="https://shop.example.org/hooks/blog", user=None, password="s3cret")
    out = site_publish.publish(row, _article(), "draft", None)
    assert out == {"id": "p9", "url": "https://shop.example.org/blog/x", "status": "draft", "steps": out["steps"]}
    expected = "sha256=" + hmac.new(b"s3cret", seen["body"], hashlib.sha256).hexdigest()
    assert seen["sig"] == expected  # the receiver can recompute this from the shared secret
    payload = json.loads(seen["body"])
    assert payload["event"] == "article.publish" and payload["article"]["slug"] == "teeth-whitening-in-pune" and payload["article"]["html"].startswith("<p>")


def test_webhook_rejections_are_explained(monkeypatch):
    monkeypatch.setattr(site_publish, "site_client", lambda timeout=15: httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(401, text="bad signature")), timeout=timeout))
    steps, info = site_publish.verify_webhook("https://shop.example.org/hooks/blog", "wrong")
    assert info is None and steps[-1]["step"] == "Signature accepted" and "same secret" in steps[-1]["detail"]
    with pytest.raises(site_publish.PublishError, match="refused the post"):
        site_publish.publish(_row(method="webhook", base="https://shop.example.org/hooks/blog", user=None), _article(), "draft", None)
