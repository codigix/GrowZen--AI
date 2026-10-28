"""URL validation and SSRF protection for Lighthouse audits.

Lighthouse audits take any user-submitted URL and (with the local engine) open it in a real
browser on this server, so a URL pointing at localhost, a private network or a cloud metadata
endpoint must never get through.

- Shape: http/https only, no embedded credentials, at most 2048 characters.
- DNS: the hostname is resolved and *every* address is checked against loopback, private,
  link-local, multicast, reserved, unspecified, carrier-grade NAT and metadata ranges.
- DNS rebinding (safe IP when checked, internal IP a moment later): the validated IPs are
  returned so the caller can pin them. `lighthouse.run_audit` pins Chrome with
  `--host-resolver-rules`; SSRFSafeTransport pins every request, redirect hops included.
"""
import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

MAX_URL_LENGTH = 2048
ALLOWED_SCHEMES = {"http", "https"}

# Ranges to block beyond the stdlib ipaddress classifications.
_EXTRA_BLOCKED_NETWORKS = [
    ipaddress.ip_network("100.64.0.0/10"),  # carrier-grade NAT
    ipaddress.ip_network("169.254.169.254/32"),  # cloud metadata (also link-local)
    ipaddress.ip_network("192.0.0.0/24"),  # IETF protocol assignments
    ipaddress.ip_network("::ffff:0:0/96"),  # IPv4-mapped IPv6 (unwrapped separately too)
]
# RFC 6052 "Well-Known Prefix" used by NAT64/DNS64 networks to represent a public IPv4 address as
# IPv6 (e.g. 64:ff9b::1.2.3.4). It is globally routable, so `ipaddress` marking it non-global would
# otherwise block every audit on a NAT64-only network; the embedded IPv4 is checked instead.
_NAT64_WELL_KNOWN_PREFIX = ipaddress.ip_network("64:ff9b::/96")


def _unwrap(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            return ip.ipv4_mapped
        if ip in _NAT64_WELL_KNOWN_PREFIX:
            return ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)
    return ip


class SSRFValidationError(ValueError):
    """The URL failed SSRF / shape validation."""


@dataclass(frozen=True)
class ValidatedURL:
    url: str
    scheme: str
    hostname: str
    port: int
    resolved_ips: tuple[str, ...]


def _is_blocked_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    ip = _unwrap(ip)
    if ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified or not ip.is_global:
        return True
    return any(ip in net for net in _EXTRA_BLOCKED_NETWORKS if net.version == ip.version)


def validate_url_shape(url: str) -> str:
    """Scheme/shape only (fast, no network)."""
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
    """Validate the shape, resolve DNS and refuse any URL that resolves to a disallowed address."""
    url = validate_url_shape(url)
    parts = urlsplit(url)
    hostname = parts.hostname
    assert hostname is not None
    port = parts.port or (443 if parts.scheme == "https" else 80)
    try:
        infos = socket.getaddrinfo(hostname, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise SSRFValidationError(f"Could not resolve hostname: {hostname}") from exc

    resolved_ips: list[str] = []
    for _family, _, _, _, sockaddr in infos:
        raw_ip = sockaddr[0]
        try:
            ip_obj = ipaddress.ip_address(raw_ip)
        except ValueError:
            continue
        if _is_blocked_ip(ip_obj):
            raise SSRFValidationError(f"URL resolves to a disallowed network address ({raw_ip}); "
                                      "internal/private/loopback/metadata targets are not permitted")
        resolved_ips.append(raw_ip)
    if not resolved_ips:
        raise SSRFValidationError(f"Could not resolve hostname: {hostname}")
    return ValidatedURL(url=url, scheme=parts.scheme, hostname=hostname, port=port, resolved_ips=tuple(dict.fromkeys(resolved_ips)))


def _pin(request: httpx.Request) -> None:
    """Validate the request's URL and pin it to the validated IP, keeping Host and SNI."""
    validated = resolve_and_validate(str(request.url))
    request.headers.setdefault("Host", validated.hostname)
    request.url = request.url.copy_with(host=validated.resolved_ips[0])
    request.extensions["sni_hostname"] = validated.hostname


class SSRFSafeTransport(httpx.HTTPTransport):
    """Re-validates and pins DNS for every request it sends, including each redirect hop
    (httpx calls the transport once per hop when follow_redirects=True)."""

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        _pin(request)
        return super().handle_request(request)
