import hashlib
import json
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from sqlalchemy import case, func, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .db import Database
from .models import Backlink, Control, Seed, Slot, Target, utcnow
from .urls import TargetMatcher, normalize_url, site_key

# Huge platforms are never crawled as seeds: they would swallow the crawl budget and block bots anyway.
SKIP_SEED_SITES = {
    "youtu.be", "pinterest.com", "tiktok.com", "wikipedia.org", "amazon.com", "apple.com", "microsoft.com",
    "github.com", "reddit.com", "whatsapp.com", "t.me", "wa.me", "goo.gl", "bit.ly", "cloudflare.com",
    "wordpress.org", "wordpress.com", "w3.org", "schema.org", "gravatar.com", "googleapis.com",
}


def _insert(db: Database):
    return pg_insert if db.engine.dialect.name == "postgresql" else sqlite_insert


def link_hash(source_url: str, target_key: str) -> str:
    return hashlib.md5(f"{source_url}|{target_key}".encode()).hexdigest()


# ---- seeds ---------------------------------------------------------------

def _seed_row(url: str, source: str, keep_path: bool = False) -> dict | None:
    """keep_path: the crawl of this site starts at the exact page given (a listing page, a page known to link to a
    target) instead of at its home page. Sites the crawler discovers itself always start at the home page."""
    norm = normalize_url(url)
    if norm is None:
        return None
    host = urlsplit(norm).hostname or ""
    key = site_key(host)
    if "." not in key or key in SKIP_SEED_SITES:
        return None
    home = f"{urlsplit(norm).scheme}://{urlsplit(norm).netloc}/"
    now = utcnow()
    return {"url": norm if keep_path else home, "site_key": key, "source": source, "status": "pending",
            "next_crawl_at": now, "created_at": now, "crawl_count": 0, "pages_crawled": 0}


def add_seeds(db: Database, urls: list[str], source: str, max_total: int | None = None) -> int:
    """Insert sites that are not stored yet (one row per website). Returns how many were new."""
    rows, seen = [], set()
    for url in urls:
        row = _seed_row(url, source)
        if row and row["site_key"] not in seen:
            seen.add(row["site_key"])
            rows.append(row)
    if not rows:
        return 0
    with db.session() as s:
        existing = set(s.scalars(select(Seed.site_key).where(Seed.site_key.in_([r["site_key"] for r in rows]))))
        rows = [r for r in rows if r["site_key"] not in existing]
        if max_total is not None:
            room = max(0, max_total - s.scalar(select(func.count(Seed.id))))
            rows = rows[:room]
        if rows:
            s.execute(_insert(db)(Seed).values(rows).on_conflict_do_nothing(index_elements=["site_key"]))
    return len(rows)


def add_user_seeds(db: Database, urls: list[str]) -> dict:
    """Seeds given by a user. The crawl of a site starts at the exact address given. New sites are due at once; a site
    the crawler had only discovered becomes a seed (read deeply); a seed whose start page differs is moved to the new
    address. In each of these cases the site is due again. Returns counts and the URLs that are not valid seeds."""
    rows, rejected = {}, []
    for url in urls:
        raw = url.strip()
        row = _seed_row(raw if "://" in raw else f"https://{raw}", "seed", keep_path=True)  # a bare domain is fine
        if row is None:
            rejected.append(url)
        else:
            rows.setdefault(row["site_key"], row)
    added = promoted = updated = 0
    if rows:
        with db.session() as s:
            existing = {x.site_key: x for x in s.scalars(select(Seed).where(Seed.site_key.in_(list(rows))))}
            for key, seed in existing.items():
                given = urlsplit(rows[key]["url"])
                is_page = given.path not in ("", "/") or bool(given.query)  # a page, not just the home page
                moved = is_page and seed.url != rows[key]["url"]
                was_discovered = seed.source != "seed"
                if not (moved or was_discovered):
                    continue
                if was_discovered:
                    seed.source, promoted = "seed", promoted + 1
                else:
                    updated += 1
                if moved:
                    seed.url = rows[key]["url"]
                if seed.status != "crawling":
                    seed.status, seed.next_crawl_at, seed.last_error = "pending", utcnow(), None
            new = [r for key, r in rows.items() if key not in existing]
            if new:
                s.execute(_insert(db)(Seed).values(new).on_conflict_do_nothing(index_elements=["site_key"]))
            added = len(new)
    return {"added": added, "promoted": promoted, "updated": updated,
            "already_existing": len(rows) - added - promoted - updated, "rejected": rejected}


def load_seed_file(db: Database, path) -> int:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return 0
    urls = data.get("seed_urls", []) if isinstance(data, dict) else data
    return add_seeds(db, [u for u in urls if isinstance(u, str)], "seed")


CRAWLER_LOCK_KEY = 7_274_001


def acquire_crawler_lock(db: Database):
    """Only one crawler process may run: the politeness delay per site lives in its memory, so two would hit a site twice
    as hard. PostgreSQL advisory lock, held on a connection that stays open (the lock goes when the process ends).
    Returns the connection, True when there is nothing to lock (SQLite), or None when another crawler holds it."""
    if db.engine.dialect.name != "postgresql":
        return True
    conn = db.engine.connect().execution_options(isolation_level="AUTOCOMMIT")  # never idle in a transaction: that would hold back the database clean-up for as long as the process lives
    if conn.execute(text("select pg_try_advisory_lock(:k)"), {"k": CRAWLER_LOCK_KEY}).scalar():
        return conn
    conn.close()
    return None


def release_crawler_lock(conn) -> None:
    """Unlock explicitly: closing a pooled connection only hands it back to the pool, and the lock would stay held."""
    if conn in (None, True):
        return
    try:
        conn.execute(text("select pg_advisory_unlock(:k)"), {"k": CRAWLER_LOCK_KEY})
        conn.close()
    except Exception:  # noqa: BLE001 - the unlock is unconfirmed: drop the real connection (that frees a session lock) instead of returning it to the pool still holding it
        conn.invalidate()
        conn.close()


def reset_interrupted(db: Database) -> None:
    """Sites that were being crawled when the process died go back to the queue."""
    with db.session() as s:
        s.execute(update(Seed).where(Seed.status == "crawling").values(status="pending"))


# https://host/ has three slashes; a start URL with more is an exact page (works in PostgreSQL and SQLite)
_start_is_a_page = (func.length(Seed.url) - func.length(func.replace(Seed.url, "/", ""))) > 3


def claim_seed(db: Database) -> Seed | None:
    """Take the next site that is due: seeds given as an exact page first (the user pointed at a page that links to a
    target), then other own seeds, then discovered ones, never-read and oldest first.
    FOR UPDATE SKIP LOCKED lets several workers (or processes) claim without handing out the same site."""
    with db.session() as s:
        seed = s.scalars(
            select(Seed)
            .where(Seed.status.in_(("pending", "done", "failed")), Seed.next_crawl_at <= utcnow())
            .order_by(case((_start_is_a_page, 0), else_=1), case((Seed.source == "seed", 0), else_=1),
                      Seed.last_crawled_at.asc().nulls_first(), Seed.next_crawl_at, Seed.id)
            .limit(1).with_for_update(skip_locked=True)
        ).first()
        if seed is None:
            return None
        seed.status = "crawling"
        return seed


def finish_seed(db: Database, seed_id: int, pages: int, error: str | None, recrawl_after: float, retry_after: float,
                started_url: str | None = None) -> None:
    now = utcnow()
    with db.session() as s:
        seed = s.get(Seed, seed_id)
        if seed is None:
            return
        seed.status = "failed" if error and pages == 0 else "done"
        seed.last_error = error
        seed.pages_crawled = pages
        seed.crawl_count += 1
        seed.last_crawled_at = now
        seed.next_crawl_at = now + timedelta(seconds=retry_after if seed.status == "failed" else recrawl_after)
        if started_url is not None and seed.url != started_url:
            # the start page was changed while the site was being read: read it again from the new page
            seed.status, seed.next_crawl_at = "pending", now


def recrawl_all(db: Database) -> None:
    """A new target means every known site has to be read again for it."""
    with db.session() as s:
        s.execute(update(Seed).where(Seed.status.in_(("done", "failed"))).values(next_crawl_at=utcnow(), status="pending"))


def current_slot(db: Database, length: float, now: datetime | None = None) -> tuple[int, datetime, bool]:
    """(slot index, when it started, whether a new slot just began). The first call starts slot 0 now. After a long
    stop (two slots or more) the next group starts now instead of jumping over groups."""
    now = now or utcnow()
    with db.session() as s:
        row = s.get(Slot, 1)
        if row is None:
            s.add(Slot(id=1, slot_index=0, started_at=now))
            return 0, now, True
        started = row.started_at if row.started_at.tzinfo else row.started_at.replace(tzinfo=timezone.utc)
        elapsed = (now - started).total_seconds()
        if elapsed < length:
            return row.slot_index, started, False
        row.slot_index += 1
        row.started_at = now if elapsed >= 2 * length else started + timedelta(seconds=length)
        return row.slot_index, row.started_at, True


def start_pass(db: Database, slot_started_at: datetime) -> int:
    """A new slot is one more pass over all seeds: every site not read since the slot began is due again."""
    with db.session() as s:
        res = s.execute(update(Seed).where(
            Seed.status.in_(("done", "failed")),
            or_(Seed.last_crawled_at.is_(None), Seed.last_crawled_at < slot_started_at),
        ).values(status="pending", next_crawl_at=utcnow()))
        return res.rowcount


def seed_counts(db: Database) -> dict[str, int]:
    with db.session() as s:
        return dict(s.execute(select(Seed.status, func.count(Seed.id)).group_by(Seed.status)).all())


# ---- control signal between the API and the crawler process ----------------

def set_crawl_enabled(db: Database, enabled: bool) -> None:
    with db.session() as s:
        row = s.get(Control, 1)
        if row is None:
            s.add(Control(id=1, crawl_enabled=enabled))
        else:
            row.crawl_enabled, row.updated_at = enabled, utcnow()


def crawl_enabled(db: Database) -> bool:
    with db.session() as s:
        row = s.get(Control, 1)
        return bool(row and row.crawl_enabled)


# ---- targets -------------------------------------------------------------

def register_target(db: Database, raw: str) -> tuple[Target, bool]:
    """Store the target (canonical form). Raises ValueError for an invalid one. Returns (target, created)."""
    matcher = TargetMatcher(raw)
    canonical = matcher.start_url if matcher.mode == "domain" else normalize_url(
        raw if "://" in raw else f"https://{raw}")
    with db.session() as s:
        target = s.scalars(select(Target).where(Target.target == canonical)).first()
        if target:
            return target, False
        target = Target(target=canonical, match_mode=matcher.mode, domain=matcher.domain)
        s.add(target)
        s.flush()
    return target, True


def add_targets(db: Database, urls: list[str]) -> int:
    """Register many targets (invalid ones are skipped). Returns how many were new."""
    created = 0
    for url in urls:
        try:
            created += register_target(db, url)[1]
        except ValueError:
            continue
    return created


def list_targets(db: Database) -> list[Target]:
    with db.session() as s:
        return list(s.scalars(select(Target).order_by(Target.id)))


# ---- backlinks -----------------------------------------------------------

def save_backlinks(db: Database, rows: list[dict]) -> None:
    """Insert new links; a link that is already stored only gets a fresh last_seen_at."""
    if not rows:
        return
    now = utcnow()
    by_hash = {}  # one row per link: a page often links to the same target several times (menu, footer, body)
    for r in rows:
        by_hash.setdefault(link_hash(r["source_url"], r["target_key"]), r)
    values = [{**r, "link_hash": h, "discovered_at": now, "last_seen_at": now} for h, r in by_hash.items()]
    with db.session() as s:
        stmt = _insert(db)(Backlink).values(values)
        s.execute(stmt.on_conflict_do_update(index_elements=["link_hash"], set_={"last_seen_at": stmt.excluded.last_seen_at}))


def _like_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def search_backlinks(db: Database, query: str) -> tuple[str, list[Backlink]]:
    """All stored backlinks for a domain (incl. its subdomains) or for one exact page. Raises ValueError."""
    matcher = TargetMatcher(query)
    stmt = select(Backlink).where(Backlink.target_site == site_key(matcher.domain))
    if matcher.mode == "domain":
        stmt = stmt.where(or_(Backlink.target_host == matcher.domain,
                              Backlink.target_host.like("%." + _like_escape(matcher.domain), escape="\\")))
    else:
        stmt = stmt.where(Backlink.target_key == matcher.exact_key)
    with db.session() as s:
        return matcher.mode, list(s.scalars(stmt.order_by(Backlink.discovered_at.desc(), Backlink.id.desc())))
