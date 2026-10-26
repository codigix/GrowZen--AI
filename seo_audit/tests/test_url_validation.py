from __future__ import annotations

import pytest

from app.security.url_validation import (
    SSRFValidationError,
    resolve_and_validate,
    validate_url_shape,
)


def test_rejects_non_http_scheme():
    with pytest.raises(SSRFValidationError):
        validate_url_shape("ftp://example.com")


def test_rejects_javascript_scheme():
    with pytest.raises(SSRFValidationError):
        validate_url_shape("javascript:alert(1)")


def test_rejects_missing_hostname():
    with pytest.raises(SSRFValidationError):
        validate_url_shape("https://")


def test_rejects_embedded_credentials():
    with pytest.raises(SSRFValidationError):
        validate_url_shape("https://user:pass@example.com")


def test_rejects_overlong_url():
    with pytest.raises(SSRFValidationError):
        validate_url_shape("https://example.com/" + "a" * 3000)


def test_accepts_well_formed_https_url():
    assert validate_url_shape("https://example.com/path?q=1") == "https://example.com/path?q=1"


def test_strips_whitespace():
    assert validate_url_shape("  https://example.com  ") == "https://example.com"


@pytest.mark.parametrize(
    "host",
    [
        "localhost",
        "127.0.0.1",
        "0.0.0.0",
        "169.254.169.254",  # cloud metadata
        "10.0.0.5",
        "172.16.0.5",
        "192.168.1.1",
        "[::1]",
    ],
)
def test_blocks_internal_and_private_hosts(host):
    with pytest.raises(SSRFValidationError):
        resolve_and_validate(f"http://{host}/")


def test_blocks_unresolvable_hostname():
    with pytest.raises(SSRFValidationError):
        resolve_and_validate("http://this-domain-should-not-exist-at-all.invalid/")


def test_allows_public_hostname_resolution():
    # example.com is reserved by IANA for documentation/testing and always
    # resolves to a public IP; this exercises the real DNS resolution path.
    # Skipped automatically if this environment has no outbound DNS access.
    import socket

    try:
        socket.getaddrinfo("example.com", 443)
    except socket.gaierror:
        pytest.skip("No outbound DNS resolution available in this environment")

    validated = resolve_and_validate("https://example.com/")
    assert validated.hostname == "example.com"
    assert len(validated.resolved_ips) >= 1
