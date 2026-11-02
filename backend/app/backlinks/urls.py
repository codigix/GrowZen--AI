"""URL and domain normalization (PRD 9.3).

Scheme and host are lower-cased, IDNA-encoded, default ports and fragments dropped, dot segments resolved.
Query strings are kept (only tracking parameters are removed) so distinct URLs are never merged blindly.
"""
import hashlib
import posixpath
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

TRACKING_PARAMS = frozenset({"utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "msclkid", "mc_cid", "mc_eid"})
# Fallback only (used if tldextract is unavailable): common multi-part public suffixes.
_MULTI_SUFFIX = frozenset({
    "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "co.in", "net.in", "org.in", "gov.in", "ac.in", "firm.in", "gen.in", "ind.in", "res.in",
    "com.au", "net.au", "org.au", "edu.au", "gov.au", "co.nz", "org.nz", "co.za", "com.br", "com.mx", "com.ar", "com.tr", "com.sg", "com.my", "com.hk",
    "com.cn", "net.cn", "org.cn", "co.jp", "or.jp", "ne.jp", "co.kr", "com.pk", "com.bd", "com.ng", "co.ke", "com.eg", "com.sa", "com.ph", "com.vn",
    "co.id", "co.th", "co.il", "com.tw", "com.ua",
})
_IP = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")


def normalize_host(host: str) -> str:
    host = (host or "").strip().strip(".").lower()
    if not host:
        return ""
    try:
        return host.encode("idna").decode("ascii")
    except UnicodeError:
        return host


try:  # the full Public Suffix List, from the snapshot bundled with tldextract: no network access at run time
    import tldextract

    _PSL = tldextract.TLDExtract(suffix_list_urls=(), cache_dir=None)
except Exception:  # pragma: no cover - falls back to the small built-in list below
    _PSL = None


def registrable_domain(host: str) -> str:
    host = normalize_host(host)
    if not host or _IP.match(host) or ":" in host:
        return host
    if _PSL is not None:
        ext = _PSL(host)
        if ext.suffix and ext.domain:
            return f"{ext.domain}.{ext.suffix}"
        return host
    labels = host.split(".")
    if len(labels) <= 2:
        return host
    if ".".join(labels[-2:]) in _MULTI_SUFFIX:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def host_of(url_or_domain: str) -> str:
    s = (url_or_domain or "").strip()
    if "://" not in s:
        s = "http://" + s
    return normalize_host(urlsplit(s).hostname or "")


def normalize_url(url: str) -> str:
    """Canonical fetch identity. Raises ValueError for non-http(s) or host-less input."""
    s = (url or "").strip()
    if "://" not in s:
        s = "http://" + s
    p = urlsplit(s)
    if p.scheme.lower() not in ("http", "https") or not p.hostname:
        raise ValueError(f"Unsupported URL: {url!r}")
    scheme = p.scheme.lower()
    host = normalize_host(p.hostname)
    port = p.port
    netloc = host if port in (None, 80 if scheme == "http" else 443) else f"{host}:{port}"
    path = p.path or "/"
    trailing = path.endswith("/")
    path = posixpath.normpath(path)
    if path == ".":
        path = "/"
    if trailing and not path.endswith("/"):
        path += "/"
    if not path.startswith("/"):
        path = "/" + path
    query = urlencode([(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True) if k.lower() not in TRACKING_PARAMS])
    return urlunsplit((scheme, netloc, path, query, ""))


def url_hash(url: str) -> bytes:
    return hashlib.sha256(url.encode("utf-8")).digest()


def text_hash(text: str | None) -> bytes | None:
    return hashlib.sha256(text.strip().lower().encode("utf-8")).digest() if text else None
