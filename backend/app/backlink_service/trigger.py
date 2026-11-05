"""Called when a business is onboarded: its website becomes a target and backlink finding starts for it right away.

It does the same as POST /backlinks/crawl, but as a direct call inside the platform (no HTTP). It never raises, so a
problem here can never break onboarding."""
import logging

from . import ahrefs, business_sync, lifecycle
from . import repository as repo

log = logging.getLogger("seo")


def start_for_website(website: str | None) -> dict:
    try:
        db, cfg = lifecycle.state.db, lifecycle.state.settings
        if db is None or cfg is None:
            return {"started": False, "reason": "The backlink service is not running."}
        ahrefs.queue_for_website(db, website)  # the Ahrefs report of the site, saved in the database (never raises)
        targets = business_sync.domain_targets([website])
        if not targets:
            return {"started": False, "reason": "The business has no website to find backlinks for."}
        new = repo.add_targets(db, targets)
        repo.set_crawl_enabled(db, True)  # the crawler process looks at this flag (it also starts on its own by default)
        if new:
            repo.recrawl_all(db)  # sites read earlier are read again, now looking for this business too
        return {"started": True, "target": targets[0], "new": bool(new)}
    except Exception:  # noqa: BLE001 - never blocks onboarding
        log.exception("Could not start backlink finding for %s", website)
        return {"started": False, "reason": "error"}
