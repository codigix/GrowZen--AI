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


def server_is_public() -> bool:
    s = get_settings()
    return s.site_url.startswith("https://") and not any(h in s.site_url for h in LOCAL)


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
    if server_is_public():
        return f"{s.site_url}{s.api_prefix}/public/gbp-post-image/{token_for(p.id)}.jpg"
    from . import article_publishing as ap
    from . import site_publish as sp
    target = ap.site_target(db, b)
    if target is not None and target.method == "wordpress":
        try:
            return sp.upload_wordpress_media(target, picture_bytes(b, p), f"gbp-post-{p.id}.jpg", "image/jpeg")
        except sp.PublishError as exc:
            raise HostError(f"The picture could not be put on your website's media library: {exc}") from exc
    raise HostError("Google fetches a post's picture from a public web address, and this server is not reachable from the internet (PUBLIC_SITE_URL is not a public https address) and no WordPress "
                    "website is connected to hold the picture. Publish from the live site, connect your WordPress website in Publishing Setup, or give the post a picture that is already on your website.")
