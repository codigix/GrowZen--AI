"""A Google post's picture needs a public web address.

The Business Profile API takes a post's picture only as `sourceUrl`: an address on the open internet that GOOGLE fetches itself. A picture uploaded to the profile's own gallery
(lh3.googleusercontent.com) or a file on this computer is refused, and the post then went out with no picture. So the picture is put at an address Google can reach:

  1. an address the owner gave that is already public (a picture on their own website),
  2. this server, when it is reachable from the internet (PUBLIC_SITE_URL): the picture is served from /public/gbp-post-image/<token>.jpg,
  3. the owner's connected WordPress media library, when this server is not public (a computer at home): the picture is uploaded there once and its address is used.

With none of these there is nothing Google could fetch, and publishing says so instead of posting without the picture."""
from __future__ import annotations

import hashlib
import hmac
import re
from typing import Any
from urllib.parse import urlsplit

from ..config import get_settings
from ..models import Business, Post
from . import post_image

GOOGLE_HOSTS = re.compile(r"(googleusercontent\.com|ggpht\.com|gstatic\.com|google\.com)$", re.I)
LOCAL = ("localhost", "127.0.0.1", "192.168.", "10.", "172.16.", "0.0.0.0")


class HostError(Exception):
    pass


def token_for(post_id: int) -> str:
    mac = hmac.new(get_settings().secret_key.encode(), f"gbp-post-image:{post_id}".encode(), hashlib.sha256).hexdigest()[:16]
    return f"{post_id}-{mac}"


def post_of(token: str) -> int | None:
    try:
        raw, mac = token.split("-", 1)
        pid = int(raw)
    except ValueError:
        return None
    return pid if hmac.compare_digest(token_for(pid), f"{pid}-{mac}") else None


def _public_bases() -> list[str]:
    """Addresses this API may be reachable at from the internet: PUBLIC_BASE_URL (where this API says it is) first, then the site address (the same domain when the API is served under it)."""
    s = get_settings()
    out: list[str] = []
    for base in (s.public_base_url, s.site_url):
        base = (base or "").strip().rstrip("/")
        if base.startswith("https://") and not any(h in base for h in LOCAL) and base not in out:
            out.append(base)
    return out


def _fetchable(url: str) -> bool:
    """Whether an address really answers with a picture, the way Google would fetch it: a server that is only SAID to be public (or a live site that does not have this picture) is not used."""
    import httpx
    try:
        r = httpx.get(url, timeout=15, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 (compatible; Googlebot-Image/1.0)"})
    except httpx.HTTPError:
        return False
    return r.status_code == 200 and (r.headers.get("content-type") or "").startswith("image/") and len(r.content) > 2000


def is_public_address(url: str | None) -> bool:
    """An address Google can fetch that is not Google's own picture hosting (which a post refuses)."""
    p = urlsplit(url or "")
    host = (p.hostname or "").lower()
    return p.scheme in ("http", "https") and bool(host) and not any(host.startswith(x) or host == x for x in LOCAL) and not GOOGLE_HOSTS.search(host)


def picture_bytes(b: Business, p: Post) -> bytes:
    """The post's picture as JPEG: the one picked (downloaded from where it is), else one drawn from the post's own words."""
    if p.image_url:
        from .net import site_client
        try:
            with site_client(25) as c:
                r = c.get(p.image_url)
            if r.status_code == 200 and (r.headers.get("content-type") or "").startswith("image/") and len(r.content) > 2000:
                return r.content
        except Exception:  # noqa: BLE001 - the drawn picture below is used instead
            pass
    return post_image.for_business(b, title=p.title, body=p.body, post_type=p.post_type, coupon=p.coupon_code, starts_on=p.starts_on, ends_on=p.ends_on, start_time=p.start_time)


def source_url(db: Any, b: Business, p: Post) -> str:
    """The public address of the post's picture, for Google to fetch. Raises HostError, with what to do, when there is none."""
    if is_public_address(p.image_url):
        return p.image_url  # already on the open internet (the owner's own website, for example)
    s = get_settings()
    for base in _public_bases():  # this server, when Google can really reach it (checked, not assumed)
        url = f"{base}{s.api_prefix}/public/gbp-post-image/{token_for(p.id)}.jpg"
        if _fetchable(url):
            return url
    from . import article_publishing as ap
    from . import site_publish as sp
    target = ap.site_target(db, b)
    if target is not None and target.method == "wordpress":
        try:
            url = sp.upload_wordpress_media(target, picture_bytes(b, p), f"gbp-post-{p.id}.jpg", "image/jpeg")
        except sp.PublishError as exc:
            raise HostError(f"The picture could not be put on your website's media library: {exc}") from exc
        import time
        for _ in range(4):  # a site's CDN can take a moment to serve a new file: Google must not meet an error page
            if _fetchable(url):
                return url
            time.sleep(2)
        raise HostError(f"The picture was uploaded to your website ({url}) but the address does not serve it to visitors yet or blocks outside access. Open it in a browser; if it shows, publish again.")
    raise HostError("Google fetches a post's picture from a public web address. This server could not be reached from the internet for the picture (set PUBLIC_BASE_URL to this server's public https address) and no WordPress "
                    "website is connected to hold the picture. Publish from the live site, connect your WordPress website in Publishing Setup, or give the post a picture that is already on your website.")
