"""URL validation and SSRF protection.

The application accepts arbitrary, user-submitted URLs and (for the local
Lighthouse engine) launches a real browser against them. That makes SSRF the
primary threat model here: a malicious user could submit a URL that points at
localhost, a private network, or a cloud metadata endpoint, hoping the
server-side browser will fetch internal resources on their behalf.

Mitigations implemented in this module:
  * Scheme / shape validation (http/https only, no credentials, sane length).
  * DNS resolution of the hostname, followed by validation of *every*
    resolved address against a blocklist of loopback, private, link-local,
    multicast, reserved, unspecified, and cloud-metadata ranges.
  * A single hostname validation pass is not sufficient protection against
    DNS rebinding (the name could resolve to a safe IP during validation and
    to an internal IP a moment later, during the actual fetch). To close
    that gap we return the validated IP addresses to the caller so they can
    be pinned for the lifetime of the request/audit (see
    ``audit_engines.lighthouse`` which pins resolution via Chrome's
    ``--host-resolver-rules`` flag, and ``audit_engines.pagespeed`` which
    uses a DNS-pinning httpx transport).
  * Redirect destinations must be revalidated with the same rules before
    being followed (see the pinning transport below).
"""
from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

MAX_URL_LENGTH = 2048
ALLOWED_SCHEMES = {"http", "https"}

# Additional ranges worth blocking beyond the stdlib ipaddress classifications.
_EXTRA_BLOCKED_NETWORKS = [
    ipaddress.ip_network("100.64.0.0/10"),  # carrier-grade NAT
    ipaddress.ip_network("169.254.169.254/32"),  # cloud metadata (also link-local)
    ipaddress.ip_network("192.0.0.0/24"),  # IETF protocol assignments
    ipaddress.ip_network("::ffff:0:0/96"),  # IPv4-mapped IPv6 (unwrapped separately too)
]


class SSRFValidationError(ValueError):
    """Raised when a submitted URL fails SSRF / shape validation."""


@dataclass(frozen=True)
class ValidatedURL:
    url: str
    scheme: str
    hostname: str
    port: int
    resolved_ips: tuple[str, ...]


def _is_blocked_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    if (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        or not ip.is_global
    ):
        return True
    return any(ip in net for net in _EXTRA_BLOCKED_NETWORKS if net.version == ip.version)


def validate_url_shape(url: str) -> str:
    """Validate scheme/shape only (fast, no network I/O)."""
    url = (url or "").strip()
    if not url:
        raise SSRFValidationError("URL is required")
    if len(url) > MAX_URL_LENGTH:
        raise SSRFValidationError("URL is too long")

    parts = urlsplit(url)
    if parts.scheme not in ALLOWED_SCHEMES:
        raise SSRFValidationError("Only http:// and https:// URLs are supported")
    if not parts.hostname:
        raise SSRFValidationError("URL must include a hostname")
    if parts.username or parts.password:
        raise SSRFValidationError("URLs with embedded credentials are not allowed")
    return url


def resolve_and_validate(url: str) -> ValidatedURL:
    """Validate shape, resolve DNS, and reject any URL resolving to a
    disallowed address range. Raises SSRFValidationError on failure."""
    url = validate_url_shape(url)
    parts = urlsplit(url)
    hostname = parts.hostname
    assert hostname is not None
    port = parts.port or (443 if parts.scheme == "https" else 80)

    try:
        infos = socket.getaddrinfo(hostname, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise SSRFValidationError(f"Could not resolve hostname: {hostname}") from exc

    if not infos:
        raise SSRFValidationError(f"Could not resolve hostname: {hostname}")

    resolved_ips: list[str] = []
    for family, _, _, _, sockaddr in infos:
        raw_ip = sockaddr[0]
        try:
            ip_obj = ipaddress.ip_address(raw_ip)
        except ValueError:
            continue
        if _is_blocked_ip(ip_obj):
            raise SSRFValidationError(
                f"URL resolves to a disallowed network address ({raw_ip}); "
                "internal/private/loopback/metadata targets are not permitted"
            )
        resolved_ips.append(raw_ip)

    if not resolved_ips:
        raise SSRFValidationError(f"Could not resolve hostname: {hostname}")

    return ValidatedURL(
        url=url,
        scheme=parts.scheme,
        hostname=hostname,
        port=port,
        resolved_ips=tuple(dict.fromkeys(resolved_ips)),
    )


def revalidate_redirect(url: str) -> ValidatedURL:
    """Revalidate a redirect target with the exact same rules as the
    original URL; used by the DNS-pinning transport below."""
    return resolve_and_validate(url)


class SSRFSafeTransport(httpx.HTTPTransport):
    """A synchronous-safe httpx transport that re-validates and pins DNS for
    every request it handles, including redirect hops (httpx re-invokes the
    transport for each hop when ``follow_redirects=True``). This defeats
    simple DNS-rebinding attacks where a hostname resolves safely at
    validation time and to an internal address a moment later.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        validated = resolve_and_validate(str(request.url))
        # Pin the connection to the first validated IP by rewriting the
        # authority while preserving the Host header for virtual hosting.
        request.headers.setdefault("Host", validated.hostname)
        pinned_url = request.url.copy_with(host=validated.resolved_ips[0])
        request.url = pinned_url
        request.extensions["sni_hostname"] = validated.hostname
        return super().handle_request(request)


class AsyncSSRFSafeTransport(httpx.AsyncHTTPTransport):
    """Async counterpart of :class:`SSRFSafeTransport`, for use with
    ``httpx.AsyncClient`` (e.g. sitemap discovery, which this server fetches
    directly rather than delegating to a third party)."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        validated = resolve_and_validate(str(request.url))
        request.headers.setdefault("Host", validated.hostname)
        pinned_url = request.url.copy_with(host=validated.resolved_ips[0])
        request.url = pinned_url
        request.extensions["sni_hostname"] = validated.hostname
        return await super().handle_async_request(request)
