import os
from dataclasses import dataclass, field
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
# every .env above this folder (backend/.env, then the shared repo-root .env), like app/config.py reads them
ENV_FILES = [p / ".env" for p in PACKAGE_DIR.parents if (p / ".env").is_file()]

DEFAULT_USER_AGENT = (
    "BacklinkForwardCrawler/1.0 (+respects robots.txt; "
    "set BACKLINK_DB_CONTACT to your contact URL/email)"
)


def _load_env_file() -> None:
    """Fill os.environ from the .env files without overriding real env vars."""
    for path in ENV_FILES:
        for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.split(" #", 1)[0].strip().strip('"').strip("'"))


def normalize_db_url(url: str) -> str:
    """Plain postgresql:// URLs use the psycopg3 driver, like backend/app/config.py does."""
    for old in ("postgresql+psycopg2://", "postgresql://", "postgres://"):
        if url.startswith(old):
            return "postgresql+psycopg://" + url[len(old):]
    return url


def _default_db_url() -> str:
    _load_env_file()
    url = os.environ.get("BACKLINK_DB_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("Set BACKLINK_DB_URL (or DATABASE_URL) to a PostgreSQL URL.")
    return normalize_db_url(url)


def _default_user_agent() -> str:
    if os.environ.get("BACKLINK_DB_USER_AGENT"):
        return os.environ["BACKLINK_DB_USER_AGENT"]
    contact = os.environ.get("BACKLINK_DB_CONTACT")
    return f"BacklinkForwardCrawler/1.0 (+{contact})" if contact else DEFAULT_USER_AGENT


def _int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


@dataclass
class Settings:
    database_url: str = field(default_factory=_default_db_url)
    seed_file: Path = field(default_factory=lambda: Path(os.environ.get("BACKLINK_DB_SEED_FILE", PACKAGE_DIR / "seed.json")))
    user_agent: str = field(default_factory=_default_user_agent)

    # Crawler: how many sites are crawled at the same time (one page at a time per site).
    workers: int = field(default_factory=lambda: _int("BACKLINK_DB_WORKERS", 8))
    # 0 (default): the API only serves routes; the crawler runs as its own process (python -m app.backlink_service.run_worker).
    # 1: the API process also runs the crawler (simple local use).
    worker_enabled: bool = os.environ.get("BACKLINK_DB_WORKER", "0") == "1"
    # 1 (default): the crawler starts crawling as soon as it starts. 0: it waits for POST /backlinks/crawl after every start.
    autostart: bool = os.environ.get("BACKLINK_DB_AUTOSTART", "1") == "1"
    # Time slots: businesses are searched in groups of slot_businesses, each group for slot_hours, then the next group.
    # slot_hours = 0 switches slots off (all businesses all the time).
    slot_businesses: int = field(default_factory=lambda: _int("BACKLINK_DB_SLOT_BUSINESSES", 5))
    slot_hours: float = field(default_factory=lambda: float(os.environ.get("BACKLINK_DB_SLOT_HOURS", "3")))
    idle_sleep: float = 5.0                       # seconds between looks at the database when there is nothing to crawl
    # Every active business's website becomes a target automatically (read from the businesses table, never changed).
    auto_businesses: bool = os.environ.get("BACKLINK_DB_AUTO_BUSINESSES", "1") == "1"
    business_sync_interval: float = field(default_factory=lambda: float(os.environ.get("BACKLINK_DB_BUSINESS_SYNC_SECONDS", "300")))
    # Optional quiet hours: full speed inside this window (server local hours, e.g. "22-6"), only
    # BACKLINK_DB_DAYTIME_WORKERS sites at a time outside it. Empty = full speed all day.
    offpeak_hours: str = os.environ.get("BACKLINK_DB_OFFPEAK", "")
    daytime_workers: int = field(default_factory=lambda: _int("BACKLINK_DB_DAYTIME_WORKERS", 2))
    # Load governor (needs psutil): above these, all workers but one pause between sites.
    max_cpu_percent: float = field(default_factory=lambda: float(os.environ.get("BACKLINK_DB_MAX_CPU", "85")))
    max_memory_percent: float = field(default_factory=lambda: float(os.environ.get("BACKLINK_DB_MAX_MEMORY", "90")))
    recrawl_after: float = field(default_factory=lambda: float(os.environ.get("BACKLINK_DB_RECRAWL_HOURS", "24")) * 3600)
    retry_after: float = 6 * 3600.0               # a site that failed (robots unreachable, errors) is retried later

    # Per-site crawl budget. Own seeds are read deeply, sites discovered by the crawler shallowly.
    seed_pages_per_site: int = field(default_factory=lambda: _int("BACKLINK_DB_SEED_PAGES_PER_SITE", 1000))
    discovered_pages_per_site: int = field(default_factory=lambda: _int("BACKLINK_DB_DISCOVERED_PAGES_PER_SITE", 100))
    max_depth: int = 50
    max_seeds: int = field(default_factory=lambda: _int("BACKLINK_DB_MAX_SEEDS", 100_000))
    discover_seeds: bool = os.environ.get("BACKLINK_DB_DISCOVER_SEEDS", "1") == "1"

    # JavaScript rendering with headless Chromium: "off", "auto" (pages that look script-built), "always"
    render_js: str = os.environ.get("BACKLINK_DB_RENDER_JS", "auto").lower()
    render_timeout: float = 25.0
    render_settle: float = 5.0
    render_concurrency: int = 2

    connect_timeout: float = 5.0
    read_timeout: float = 15.0
    write_timeout: float = 10.0
    pool_timeout: float = 10.0
    robots_retry_delay: float = 30.0
    max_retries: int = 2
    backoff_base: float = 0.5
    backoff_max: float = 8.0
    per_domain_delay: float = 1.0
    max_redirects: int = 5
    max_body_bytes: int = 2_000_000
    max_queue_per_site: int = 20_000   # crawler traps (calendars, filters) must not fill memory
    max_query_variants: int = 5        # pages that differ only by ?query are read this many times per path
    robots_ttl: float = 6 * 3600.0     # robots.txt is read again after this long (the crawler runs for days)
    dns_check: bool = True
    verbose: int = field(default_factory=lambda: _int("BACKLINK_DB_VERBOSE", 1))  # 0 off, 1 pages + backlinks


def parse_offpeak(text: str) -> tuple[int, int] | None:
    """'22-6' -> (22, 6). Anything else (or empty) means no quiet-hours window."""
    try:
        start, end = (int(x) for x in text.strip().split("-"))
    except ValueError:
        return None
    return (start, end) if 0 <= start <= 24 and 0 <= end <= 24 and start != end else None
