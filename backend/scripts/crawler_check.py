"""Read-only check of every GET endpoint of the backlink crawler. Run from backend/:  python scripts/crawler_check.py [domain]
Never prints the key. POST endpoints (seed, bootstrap, pause, resume) are not called."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import get_settings  # noqa: E402
from app.services import crawler_client as c  # noqa: E402


def main() -> None:
    s = get_settings()
    if not s.crawler_enabled:
        sys.exit("Not set up: put the real CRAWLER_API_KEY (and CRAWLER_URL) in backend/.env.")
    domain = sys.argv[1] if len(sys.argv) > 1 else "codigixinfotech.com"
    print(f"{s.crawler_url}  auth header: {s.crawler_auth_header}  domain: {domain}")
    paths = {
        "backlinks": lambda: c.backlinks(domain, limit=5), "referring-domains": lambda: c.referring_domains(domain),
        "anchors": lambda: c.anchors(domain), "history": lambda: c.history(domain, 5),
        "discovery/status": c.discovery_status, "discovery/statistics": c.discovery_statistics, "crawler/global-status": c.global_status,
        "crawler/discovered-urls": lambda: c._call("GET", "/crawler/discovered-urls", params={"limit": 3}),
        "crawler/discovered-domains": lambda: c._call("GET", "/crawler/discovered-domains", params={"limit": 3}),
        "crawler/outgoing-links": lambda: c._call("GET", "/crawler/outgoing-links", params={"limit": 3}),
    }
    for name, fn in paths.items():
        try:
            d = fn()
            shape = f"list[{len(d)}]" if isinstance(d, list) else "{" + ", ".join(list(d)[:6]) + "}"
            print(f"OK    {name:28} {shape}")
        except c.CrawlerError as e:
            print(f"FAIL  {name:28} {e}")


if __name__ == "__main__":
    main()
