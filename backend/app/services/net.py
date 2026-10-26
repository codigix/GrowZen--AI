"""HTTP client for fetching customers' websites.

Many small-business hosts publish an IPv6 address that doesn't answer; httpx tries it first and
waits for the timeout before falling back. Binding to an IPv4 local address skips that (seen
in practice: 15 s -> 0.2 s).
"""
import httpx

UA = "Mozilla/5.0 (compatible; CodigixSEOAuditBot/1.0; +https://codigixinfotech.com)"


def site_client(timeout: float = 15) -> httpx.Client:
    return httpx.Client(transport=httpx.HTTPTransport(local_address="0.0.0.0", retries=1), headers={"User-Agent": UA},
                        follow_redirects=True, timeout=timeout)
