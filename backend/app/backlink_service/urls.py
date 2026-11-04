import asyncio
import ipaddress
import socket
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

TRACKING_PARAMS = {
    "fbclid", "gclid", "gclsrc", "dclid", "msclkid", "yclid", "igshid",
    "mc_cid", "mc_eid", "_ga", "ref_src", "spm",
}
SKIP_EXTENSIONS = (
    ".pdf", ".zip", ".gz", ".tar", ".rar", ".7z", ".exe", ".dmg", ".iso",
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico", ".bmp", ".avif",
    ".mp3", ".mp4", ".avi", ".mov", ".mkv", ".webm", ".wav", ".flac",
    ".css", ".js", ".json", ".xml", ".woff", ".woff2", ".ttf", ".eot",
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".apk",
)
MAX_URL_LENGTH = 2048
_DEFAULT_PORTS = {"http": 80, "https": 443}
_BLOCKED_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home", ".corp")


def normalize_url(url: str, base: str | None = None) -> str | None:
    """Return a canonical http(s) URL (no fragment, tracking params, userinfo), or None."""
    if not url:
        return None
    url = url.strip()
    if base:
        url = urljoin(base, url)
    if len(url) > MAX_URL_LENGTH:
        return None
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return None
    scheme = parts.scheme.lower()
    if scheme not in _DEFAULT_PORTS or not parts.hostname:
        return None
    host = parts.hostname.lower().rstrip(".")
    try:
        host = host.encode("idna").decode("ascii")
    except UnicodeError:
        return None
    if not host:
        return None
    netloc = f"[{host}]" if ":" in host else host
    if port and port != _DEFAULT_PORTS[scheme]:
        netloc += f":{port}"
    path = parts.path or "/"
    if len(path) > 1:
        path = path.rstrip("/") or "/"
    query = urlencode(sorted(
        (k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if k.lower() not in TRACKING_PARAMS and not k.lower().startswith("utm_")
    ))
    return urlunsplit((scheme, netloc, path, query, ""))


def has_skipped_extension(url: str) -> bool:
    return urlsplit(url).path.lower().endswith(SKIP_EXTENSIONS)


def is_blocked_host(host: str) -> bool:
    """Static check: localhost, internal names and non-public literal IPs."""
    host = host.strip("[]").lower().rstrip(".")
    if not host or host == "localhost" or host.endswith(_BLOCKED_SUFFIXES):
        return True
    try:
        return not ipaddress.ip_address(host).is_global
    except ValueError:
        return "." not in host  # single-label names are internal


async def resolves_to_public(host: str) -> bool:
    """DNS check so a public-looking hostname cannot point at an internal address."""
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except OSError:
        return False
    return bool(infos) and all(ipaddress.ip_address(i[4][0]).is_global for i in infos)


def _site_key(url: str) -> str:
    parts = urlsplit(url)
    host = (parts.hostname or "").removeprefix("www.")
    return f"{host}{parts.path}" + (f"?{parts.query}" if parts.query else "")


def page_key(url: str) -> str:
    """www-insensitive identity of a normalized URL (host without www + path + query)."""
    return _site_key(url)


def bare_host(url: str) -> str:
    return (urlsplit(url).hostname or "").removeprefix("www.")


class TargetMatcher:
    """Matches links against a target domain (incl. subdomains) or an exact page."""

    def __init__(self, target: str, mode: str = "auto"):
        raw = target.strip()
        norm = normalize_url(raw if "://" in raw else f"https://{raw}")
        if norm is None:
            raise ValueError(f"Invalid target: {target!r}")
        parts = urlsplit(norm)
        self.raw = raw
        self.domain = (parts.hostname or "").removeprefix("www.")
        if "." not in self.domain:
            raise ValueError(f"Invalid target: {target!r}")
        has_path = parts.path not in ("", "/") or bool(parts.query)
        self.mode = ("exact" if has_path else "domain") if mode == "auto" else mode
        self.exact_key = _site_key(norm)
        self.start_url = f"{parts.scheme}://{parts.netloc}/"  # where the scan of the target's own site begins

    def is_target_site(self, url: str) -> bool:
        host = (urlsplit(url).hostname or "").removeprefix("www.")
        return host == self.domain or host.endswith("." + self.domain)

    def matches(self, url: str) -> bool:
        if self.mode == "domain":
            return self.is_target_site(url)
        return _site_key(url) == self.exact_key


_SECOND_LEVEL = {"co", "com", "org", "net", "gov", "edu", "ac", "or", "ne", "go"}
# Hosting platforms: every subdomain is a different website (alice.blogspot.com and bob.blogspot.com are not one site).
_PRIVATE_SUFFIXES = (
    "blogspot.com", "blogspot.in", "wordpress.com", "wixsite.com", "github.io", "netlify.app", "vercel.app", "herokuapp.com",
    "web.app", "firebaseapp.com", "pages.dev", "weebly.com", "tumblr.com", "myshopify.com", "webflow.io", "square.site",
    "azurewebsites.net", "onrender.com", "substack.com",
)


def site_key(host: str) -> str:
    """Registrable-domain approximation: blog.example.com / www.example.com -> example.com,
    shop.example.co.uk -> example.co.uk. Used to treat all subdomains of a website as one site."""
    host = host.strip("[]").lower().rstrip(".")
    for suffix in _PRIVATE_SUFFIXES:
        if host.endswith("." + suffix):
            return f"{host[:-len(suffix) - 1].split('.')[-1]}.{suffix}"
    labels = host.split(".")
    if len(labels) <= 2 or host.replace(".", "").isdigit() or ":" in host:
        return host
    keep = 3 if len(labels[-1]) == 2 and labels[-2] in _SECOND_LEVEL else 2
    return ".".join(labels[-keep:])
