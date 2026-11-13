"""Domain registration facts (age, registrar, expiry, name servers) for any domain, from the registry itself.

1. RDAP through the IANA bootstrap file (the registry's own RDAP server for the TLD). Most generic and many country TLDs have one.
2. If the TLD has no RDAP service (for example .co) or the registry answers 404, plain WHOIS (port 43): the WHOIS server is found by asking
   whois.iana.org, the answer is parsed for creation / expiry / registrar / name servers.
Only real answers are returned; anything that cannot be read stays null and `error` says why. Nothing is guessed.
"""
import re
import socket
import threading
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from .url_safety import _is_blocked_ip  # the same private/loopback/link-local rules as the page fetcher

BOOTSTRAP = "https://data.iana.org/rdap/dns.json"
_DOMAIN = re.compile(r"^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
_HOST = re.compile(r"^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$")
_lock = threading.Lock()
_cache: dict[str, tuple[float, Any]] = {}
TTL_BOOTSTRAP, TTL_WHOIS_SERVER, TTL_RESULT = 86_400, 604_800, 21_600  # 1 day, 7 days, 6 hours


def _get(key: str, ttl: float) -> Any:
    with _lock:
        hit = _cache.get(key)
    return hit[1] if hit and time.time() - hit[0] < ttl else None


def _put(key: str, value: Any) -> Any:
    with _lock:
        _cache[key] = (time.time(), value)
    return value


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    s = value.strip().replace("Z", "+00:00")
    s = re.sub(r"\.\d+(?=[+-]\d\d:?\d\d$|$)", "", s)  # drop fractional seconds
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d-%b-%Y", "%d-%b-%Y %H:%M:%S %Z", "%Y.%m.%d", "%d/%m/%Y"):
        try:
            d = datetime.strptime(s, fmt)
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _shape(domain: str, created: datetime | None, expires: datetime | None, registrar: str | None, ns: list[str], source: str, error: str | None = None) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    return {"domain": domain, "registered_at": created.date().isoformat() if created else None, "expires_at": expires.date().isoformat() if expires else None,
            "age_days": (now - created).days if created else None, "registrar": registrar or None, "nameservers": sorted({n.lower().rstrip(".") for n in ns if n})[:8],
            "source": source, "error": error}


# ---- RDAP
def _rdap_base(tld: str) -> str | None:
    boot = _get("bootstrap", TTL_BOOTSTRAP)
    if boot is None:
        try:
            data = httpx.get(BOOTSTRAP, timeout=8, follow_redirects=True).json()
            boot = _put("bootstrap", {t: s[1][0] for s in data.get("services", []) for t in s[0]})
        except Exception:  # noqa: BLE001 - an unreachable bootstrap just means "no RDAP": WHOIS takes over
            boot = {}
    return boot.get(tld)


def _rdap(domain: str, tld: str) -> dict[str, Any] | None:
    base = _rdap_base(tld)
    if not base:
        return None
    try:
        r = httpx.get(f"{base.rstrip('/')}/domain/{domain}", timeout=8, follow_redirects=True, headers={"Accept": "application/rdap+json"})
    except httpx.HTTPError:
        return None
    if r.status_code != 200:
        return None
    try:
        j = r.json()
    except ValueError:
        return None
    ev = {e.get("eventAction"): _parse_date(e.get("eventDate")) for e in j.get("events", [])}
    registrar = None
    for ent in j.get("entities", []):
        if "registrar" in (ent.get("roles") or []):
            for item in (ent.get("vcardArray") or [None, []])[1]:
                if item and item[0] == "fn":
                    registrar = item[3]
            registrar = registrar or ent.get("handle")
            break
    ns = [n.get("ldhName", "") for n in j.get("nameservers", [])]
    return _shape(domain, ev.get("registration"), ev.get("expiration"), registrar, ns, "rdap")


# ---- WHOIS
def _public_host(host: str) -> bool:
    """A WHOIS server name that resolves only to public addresses (it comes from a remote answer, so it is checked like any other address)."""
    if not _HOST.match(host or ""):
        return False
    try:
        infos = socket.getaddrinfo(host, 43, type=socket.SOCK_STREAM)
    except OSError:
        return False
    import ipaddress
    return bool(infos) and not any(_is_blocked_ip(ipaddress.ip_address(i[4][0])) for i in infos)


def _whois_query(server: str, text: str, timeout: float = 8) -> str:
    if not _public_host(server):
        raise OSError("blocked or unresolvable WHOIS server")
    out = b""
    with socket.create_connection((server, 43), timeout=timeout) as s:
        s.settimeout(timeout)
        s.sendall((text + "\r\n").encode("ascii", "ignore"))
        while len(out) < 120_000:
            try:
                chunk = s.recv(4096)
            except socket.timeout:
                break
            if not chunk:
                break
            out += chunk
    return out.decode("utf-8", "replace")


def _whois_server(tld: str) -> str | None:
    cached = _get(f"whois:{tld}", TTL_WHOIS_SERVER)
    if cached is not None:
        return cached or None
    try:
        text = _whois_query("whois.iana.org", tld)
    except OSError:
        return None
    server = next((l.split(":", 1)[1].strip().lower() for l in text.splitlines() if l.lower().startswith(("whois:", "refer:")) and ":" in l), "")
    return _put(f"whois:{tld}", server if _HOST.match(server) else "") or None


def parse_whois(domain: str, text: str) -> dict[str, Any] | None:
    """Fields from a WHOIS answer, whatever the registry's key names are. None when the answer holds nothing usable (not registered, rate limited)."""
    def first(*keys: str) -> str | None:
        for line in text.splitlines():
            k, _, v = line.partition(":")
            if k.strip().lower() in keys and v.strip():
                return v.strip()
        return None
    created = _parse_date(first("creation date", "created", "registered", "registration time", "domain registration date", "created on", "registered on"))
    expires = _parse_date(first("registry expiry date", "registrar registration expiration date", "expiry date", "expires", "expiration date", "paid-till", "expires on", "renewal date"))
    registrar = first("registrar", "sponsoring registrar", "registrar name")
    ns = [v.strip().split()[0] for line in text.splitlines() for k, _, v in [line.partition(":")] if k.strip().lower() in ("name server", "nserver", "nameserver", "name servers") and v.strip()]
    if not (created or expires or registrar or ns):
        return None
    return _shape(domain, created, expires, registrar, ns, "whois")


def _whois(domain: str, tld: str) -> dict[str, Any] | None:
    server = _whois_server(tld)
    if not server:
        return None
    try:
        text = _whois_query(server, domain)
    except OSError:
        return None
    return parse_whois(domain, text)


def registrable(host: str) -> str:
    """example.co.uk for www.example.co.uk (the two-level public suffixes used by the common country domains; the registries' own list is not bundled)."""
    parts = [p for p in (host or "").lower().strip(".").split(".") if p]
    if len(parts) <= 2:
        return ".".join(parts)
    second_level = {"co", "com", "org", "net", "gov", "edu", "ac", "nic", "res", "ltd", "plc"}
    return ".".join(parts[-3:]) if parts[-2] in second_level and len(parts[-1]) == 2 else ".".join(parts[-2:])


def lookup(host_or_domain: str) -> dict[str, Any]:
    """The registration facts of a domain: registry RDAP first, WHOIS when there is no RDAP. Always returns the same shape; `error` says why a field is empty."""
    domain = registrable(host_or_domain)
    if not _DOMAIN.match(domain):
        return _shape(domain or str(host_or_domain), None, None, None, [], "none", "This is not a registrable domain name.")
    hit = _get(f"result:{domain}", TTL_RESULT)
    if hit is not None:
        return hit
    tld = domain.rsplit(".", 1)[-1]
    out = _rdap(domain, tld) or _whois(domain, tld)
    if out is None:
        out = _shape(domain, None, None, None, [], "none", f"The .{tld} registry did not return registration details for this domain (it may keep them private).")
    return _put(f"result:{domain}", out) if not out["error"] else out
