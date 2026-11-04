"""Find the subdomains of a site: certificate transparency logs (every HTTPS certificate issued for the domain), the hosts the
site's own crawl links to, and Google's ranking results. Each one is then checked: does it resolve, and what does it answer."""
import socket
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

import httpx

from .net import site_client


def _valid(h: str, root: str) -> bool:
    return bool(h) and "*" not in h and " " not in h and (h == root or h.endswith("." + root))


def from_certificates(root: str) -> list[str]:
    """crt.sh lists every certificate issued for the domain; its names are the subdomains that have had HTTPS."""
    try:
        r = httpx.get("https://crt.sh/", params={"q": f"%.{root}", "output": "json"}, timeout=25, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        names: set[str] = set()
        for row in r.json():
            for n in str(row.get("name_value", "")).splitlines():
                n = n.strip().lower().removeprefix("www.")
                if _valid(n, root):
                    names.add(n)
        return sorted(names)
    except Exception:
        return []


def _probe(host: str) -> dict:
    out = {"subdomain": host, "resolves": False, "status": None, "final_url": None, "title": None}
    try:
        socket.getaddrinfo(host, 443)
        out["resolves"] = True
    except OSError:
        return out
    try:
        with site_client(8) as c:
            r = c.get(f"https://{host}/")
        out.update(status=r.status_code, final_url=str(r.url))
        t = r.text.lower()
        if "<title>" in t:
            out["title"] = r.text[t.index("<title>") + 7:t.index("</title>")].strip()[:90]
    except Exception:
        pass
    return out


def discover(root: str, crawl_links: list[str], ranking_hosts: list[str], search_console_hosts: list[str]) -> dict:
    sources: dict[str, set[str]] = {}

    def add(h: str, src: str) -> None:
        h = (h or "").lower().removeprefix("www.")
        if _valid(h, root):
            sources.setdefault(h, set()).add(src)
    add(root, "main domain")
    for h in from_certificates(root):
        add(h, "certificates")
    for u in crawl_links:
        add(urlparse(u).netloc, "site links")
    for h in ranking_hosts:
        add(h, "Google results")
    for h in search_console_hosts:
        add(h, "Search Console")
    hosts = sorted(sources)[:60]
    with ThreadPoolExecutor(max_workers=10) as ex:
        probed = list(ex.map(_probe, hosts))
    for p in probed:
        p["sources"] = sorted(sources[p["subdomain"]])
        p["main"] = p["subdomain"] == root
    probed.sort(key=lambda p: (not p["main"], not p["resolves"], p["subdomain"]))
    return {"root": root, "total": len(probed), "live": sum(1 for p in probed if p["resolves"]), "rows": probed}
