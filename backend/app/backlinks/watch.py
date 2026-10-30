"""Weekly competitor watch: what changed on your competitors' websites since last week.

Each week the bot revisits a bounded set of pages on every competitor you track (the home page, newly listed pages, and the pages it has not looked at the
longest), compares them with what it remembered, and records three kinds of change: a NEW page, a CHANGED page (title, heading, description or a large rewrite of
the text) and a REMOVED page. The first visit only records what is there and reports no changes. The summary is written from those recorded facts; with an AI key
a model words it, otherwise a plain template does, and the result says which. Only public pages are read, with robots.txt and politeness delays respected."""
import hashlib
import logging
import re
import warnings
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import utcnow
from ..models import Business
from ..services import ai
from ..services.activity import log as activity
from . import engine, renderer, stop
from .models import BiBotConfig, BiTrackedTarget, WatchEvent, WatchPage, WatchReport
from .repository import get_domain
from .urls import normalize_url, registrable_domain, url_hash

log = logging.getLogger("seo.backlinks.watch")
MAX_PAGES = 25  # pages fetched per competitor per visit
MAX_COMPETITORS = 8
MAX_KNOWN_URLS = 2000  # sitemap URLs remembered per competitor, so a page that was already listed is never reported as "new" later
MAX_SITEMAP_FILES = 4
MIN_WORD_CHANGE = 80
MIN_CHANGE_FRACTION = 0.15
REMOVED_AFTER_MISSING_VISITS = 2
INTERVAL = timedelta(days=7)
TIME_BUDGET = timedelta(minutes=8)
_PAGINATION = re.compile(r"(/page/\d+/?$|[?&](?:paged?|p)=\d+|/(?:feed|amp)/?$|\?replytocom=)", re.I)  # archive pages and feeds are not content a competitor published
_DOMAIN_IN_TEXT = re.compile(r"\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b")


def _aw(d: datetime | None) -> datetime | None:
    return d if d is None or d.tzinfo else d.replace(tzinfo=timezone.utc)


def page_state(html: str) -> dict:
    """The parts of a page worth comparing week to week."""
    soup = BeautifulSoup(html or "", "html.parser")
    title = soup.title.get_text(" ", strip=True)[:500] if soup.title else None
    h1_tag = soup.find("h1")
    h1 = " ".join(h1_tag.get_text(" ", strip=True).split())[:500] if h1_tag else None
    desc = soup.find("meta", attrs={"name": lambda v: v and v.lower() == "description"})
    description = " ".join(((desc.get("content") if desc is not None else "") or "").split())
    for t in soup(["script", "style", "noscript", "nav", "header", "footer", "aside", "form"]):
        t.decompose()
    text = " ".join(soup.get_text(" ", strip=True).split())
    return {"title": title, "h1": h1, "snippet": description[:600] or None, "words": len(text.split()),
            "content_hash": hashlib.sha256(text.lower().encode("utf-8", "ignore")).hexdigest()}


def _sitemap_entries(db: Session, fetcher: engine.PageFetcher, domain: str) -> tuple[list[tuple[str, str]], bool]:
    """([(url, lastmod)], readable): the pages the competitor lists in its sitemaps, newest first."""
    home = f"https://{domain}/"
    rules = fetcher.rules_for(db, get_domain(db, home), "https")
    queue = [*rules.sitemaps, f"https://{domain}/sitemap.xml"]
    seen_files, entries, readable = set(), {}, False
    while queue and len(seen_files) < MAX_SITEMAP_FILES:
        sm = queue.pop(0)
        if sm in seen_files:
            continue
        seen_files.add(sm)
        res = fetcher.fetch(db, sm, "sitemap")
        if not res.body or not res.status or not 200 <= res.status < 300:
            continue
        readable = True
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", XMLParsedAsHTMLWarning)
            soup = BeautifulSoup(res.body, "html.parser")
        for node in soup.find_all("sitemap"):
            loc = node.find("loc")
            if loc and loc.get_text(strip=True):
                queue.append(loc.get_text(strip=True))
        for node in soup.find_all("url"):
            loc = node.find("loc")
            if not loc:
                continue
            try:
                u = normalize_url(loc.get_text(strip=True))
                if registrable_domain(urlsplit(u).hostname or "") != domain or _PAGINATION.search(u):
                    continue  # a sitemap may only vouch for its own site; pagination and feeds are not pages
            except ValueError:
                continue
            lm = node.find("lastmod")
            entries[u] = lm.get_text(strip=True) if lm else ""
    ordered = sorted(entries.items(), key=lambda kv: kv[1], reverse=True)[:MAX_KNOWN_URLS]
    return ordered, readable


def crawl_competitor(db: Session, fetcher: engine.PageFetcher, business_id: int, domain: str, now: datetime | None = None, render=None, max_pages: int = MAX_PAGES) -> dict:
    """Visit one competitor and record what changed. Returns counts. Commits as it goes."""
    now = now or utcnow()
    home = normalize_url(f"https://{domain}/")
    rows = {r.url_hash: r for r in db.scalars(select(WatchPage).where(WatchPage.business_id == business_id, WatchPage.domain == domain))}
    baseline = not rows
    listed, readable = _sitemap_entries(db, fetcher, domain)
    listed_hashes = {url_hash(u) for u, _ in listed}
    out = {"domain": domain, "baseline": baseline, "fetched": 0, "new": 0, "changed": 0, "removed": 0, "known": 0}
    new_events: dict[str, WatchEvent] = {}  # url -> its new_page event, completed with a title once the page is fetched
    gone: set[bytes] = set()  # rows deleted in this visit

    for u, _ in listed:  # remember every listed URL so a page that was already there is never called "new" later
        h = url_hash(u)
        if h not in rows:
            rows[h] = WatchPage(business_id=business_id, domain=domain, url=u, url_hash=h, words=0, first_seen_at=now, last_seen_at=now)
            db.add(rows[h])
            if not baseline:
                out["new"] += 1
                new_events[u] = WatchEvent(business_id=business_id, domain=domain, kind="new_page", url=u, title=None, detail={}, at=now)
                db.add(new_events[u])
        elif rows[h].removed_at is None:
            rows[h].missing_runs = 0
    hh = url_hash(home)
    if hh not in rows:
        rows[hh] = WatchPage(business_id=business_id, domain=domain, url=home, url_hash=hh, words=0, first_seen_at=now, last_seen_at=now)
        db.add(rows[hh])
    db.flush()

    # What to fetch: the home page, pages that appeared since last visit, pages never fetched, then whatever was looked at longest ago.
    def order(r: WatchPage):
        return (r.url_hash != hh, r.url not in new_events, r.content_hash is not None, _aw(r.last_seen_at) or now)
    targets = sorted((r for r in rows.values() if r.removed_at is None), key=order)[:max_pages]
    for row in targets:
        if stop.stopping():
            break
        res = fetcher.fetch(db, row.url, "watch", render)
        if res.status in (404, 410) and row.url_hash != hh:
            row.removed_at = now
            gone.add(row.url_hash)
            if row.content_hash is not None:  # only a page we had actually read is reported; one we never loaded was never "known"
                db.add(WatchEvent(business_id=business_id, domain=domain, kind="removed", url=row.url, title=row.title, detail={"status": res.status}, at=now))
                out["removed"] += 1
            continue
        if not res.status or not 200 <= res.status < 300 or not res.body or not res.complete:
            continue  # a failed visit says nothing about the page
        out["fetched"] += 1
        st = page_state(res.body)
        ev = new_events.get(row.url)
        if ev is not None and not ev.title:
            ev.title, ev.detail = st["title"] or st["h1"], {"words": st["words"]}
        if row.content_hash is not None:  # a page we already knew: compare
            fields = [f for f in ("title", "h1", "snippet") if (getattr(row, f) or "") != (st[f] or "")]
            delta = st["words"] - row.words
            if row.content_hash != st["content_hash"] and (abs(delta) >= MIN_WORD_CHANGE or abs(delta) >= MIN_CHANGE_FRACTION * max(row.words, 1)) and abs(delta) >= 20:
                fields.append("content")
            if fields:
                detail = {"fields": fields, "words_before": row.words, "words_after": st["words"]}
                for f in ("title", "h1"):
                    if f in fields:
                        detail[f"{f}_before"], detail[f"{f}_after"] = row.title if f == "title" else row.h1, st[f]
                db.add(WatchEvent(business_id=business_id, domain=domain, kind="changed", url=row.url, title=st["title"] or row.title, detail=detail, at=now))
                row.last_changed_at = now
                out["changed"] += 1
        row.title, row.h1, row.snippet, row.words, row.content_hash, row.last_seen_at, row.missing_runs = st["title"], st["h1"], st["snippet"], st["words"], st["content_hash"], now, 0
        db.commit()

    if readable and listed_hashes:  # a page the sitemap stopped listing is only a suspect: it counts as removed when it really answers 404/410
        fetched_urls = {r.url for r in targets}
        for r in list(rows.values()):
            if r.url_hash in listed_hashes or r.url_hash == hh or r.url_hash in gone or r.removed_at is not None:
                continue
            if r.url in fetched_urls:  # visited this time and it loaded: still there, whatever the sitemap says
                r.missing_runs = 0
                continue
            r.missing_runs = (r.missing_runs or 0) + 1
            if r.missing_runs < REMOVED_AFTER_MISSING_VISITS:
                continue
            res = fetcher.fetch(db, r.url, "watch")
            if res.status in (404, 410):
                r.removed_at = now
                gone.add(r.url_hash)
                if r.content_hash is not None:
                    db.add(WatchEvent(business_id=business_id, domain=domain, kind="removed", url=r.url, title=r.title, detail={"status": res.status, "reason": "no longer in the sitemap"}, at=now))
                    out["removed"] += 1
            else:
                r.missing_runs = 0  # unlisted but alive (or we could not tell): not removed
    out["known"] = len([r for r in rows.values() if r.removed_at is None])
    db.commit()
    return out


# ---------------------------------------------------------------- the weekly summary

SYSTEM = ai.RULES + """
You summarise what changed on a small business's competitors' websites this week, for the business owner. Use ONLY the facts given
(new pages, changed titles/headings, removed pages, with domains and counts). Do not invent what competitors are planning or why; where you infer something, say "may".
Return JSON: {"headline": "one line, at most 110 characters", "summary": "3-5 plain sentences", "what_it_means": "1-2 sentences for this business",
"actions": ["up to 3 concrete, honest next steps for this business"]}"""


def _facts(events: list[WatchEvent]) -> dict:
    by: dict[str, dict] = {}
    for e in events:
        d = by.setdefault(e.domain, {"new_pages": [], "changed": [], "removed": []})
        if e.kind == "new_page":
            d["new_pages"].append({"title": e.title, "url": e.url})
        elif e.kind == "changed":
            d["changed"].append({"title": e.title, "url": e.url, "fields": e.detail.get("fields"), "title_before": e.detail.get("title_before"), "title_after": e.detail.get("title_after"),
                                 "h1_after": e.detail.get("h1_after"), "words_before": e.detail.get("words_before"), "words_after": e.detail.get("words_after")})
        else:
            d["removed"].append({"title": e.title, "url": e.url})
    return {dom: {"new_pages": v["new_pages"][:6], "new_pages_total": len(v["new_pages"]), "changed": v["changed"][:6], "changed_total": len(v["changed"]),
                  "removed": v["removed"][:4], "removed_total": len(v["removed"])} for dom, v in by.items()}


def _rules_summary(b: Business, facts: dict, checked: int) -> dict:
    parts, hl = [], []
    for dom, f in facts.items():
        bits = []
        if f["new_pages_total"]:
            titles = [x["title"] for x in f["new_pages"] if x["title"]][:3]
            bits.append(f"{f['new_pages_total']} new page(s)" + (f" (e.g. {'; '.join(titles)})" if titles else ""))
        if f["changed_total"]:
            bits.append(f"{f['changed_total']} page(s) changed")
        if f["removed_total"]:
            bits.append(f"{f['removed_total']} removed")
        parts.append(f"{dom}: " + ", ".join(bits) + ".")
        hl.append(dom)
    total = sum(f["new_pages_total"] + f["changed_total"] + f["removed_total"] for f in facts.values())
    actions = []
    if any(f["new_pages_total"] for f in facts.values()):
        actions.append("Open the new competitor pages and check whether they cover a topic or service you do not.")
    if any(f["changed_total"] for f in facts.values()):
        actions.append("Look at what changed on those pages (titles and headings show how they are positioning themselves).")
    return {"headline": f"{total} change(s) across {len(facts)} competitor site(s) this week", "summary": " ".join(parts), "what_it_means":
            f"These are changes our crawler saw across {checked} pages; they do not show why they were made.", "actions": actions[:3] or ["Nothing needs doing."], "highlights": hl}


def _valid(out: dict, facts: dict, known_domains: set[str]) -> dict | None:
    try:
        headline, summary, means = str(out["headline"]).strip(), str(out["summary"]).strip(), str(out["what_it_means"]).strip()
        actions = [str(a).strip() for a in out["actions"] if str(a).strip()]
    except (KeyError, TypeError):
        return None
    if not (headline and summary and means and actions):
        return None
    mentioned = {m for m in _DOMAIN_IN_TEXT.findall(" ".join([headline, summary, means, *actions]).lower())}
    if any(registrable_domain(m) not in known_domains for m in mentioned):  # the model named a site we never gave it
        return None
    return {"headline": headline[:140], "summary": summary[:1200], "what_it_means": means[:500], "actions": actions[:3], "highlights": list(facts)}


def build_report(db: Session, b: Business, since: datetime, now: datetime, checked: int, baseline: bool, competitors: list[str]) -> WatchReport:
    events = list(db.scalars(select(WatchEvent).where(WatchEvent.business_id == b.id, WatchEvent.at >= since).order_by(WatchEvent.at.desc())))
    facts = _facts(events)
    source = "rules"
    if baseline:
        summary = {"headline": f"Now watching {len(competitors)} competitor site(s)", "summary": f"We recorded {checked} pages across {', '.join(competitors)}. From next week we will tell you what is new, what changed and what was removed.",
                   "what_it_means": "Nothing to compare yet: this first visit only sets the starting point.", "actions": ["Check back next week for the first comparison."], "highlights": competitors}
    elif not events:
        summary = {"headline": "No changes found this week", "summary": f"We looked at {checked} pages on {', '.join(competitors)} and found no new, changed or removed pages.",
                   "what_it_means": "Your competitors' sites were quiet.", "actions": ["Nothing needs doing."], "highlights": []}
    else:
        summary = _rules_summary(b, facts, checked)
        if ai.is_configured():
            try:
                from . import quality
                out = ai.complete_json(SYSTEM, f"Business: {quality.business_context(b)}\nCompetitors watched: {competitors}\nPages checked: {checked}\nChanges this week: {facts}", max_tokens=900)
                ok = _valid(out, facts, {*competitors, registrable_domain(urlsplit(b.website or '').hostname or '')})
                if ok:
                    summary, source = ok, "ai"
            except (ai.AiUnavailable, ValueError) as exc:
                log.warning("AI watch summary failed, using the template: %s", exc)
    monday = (now.date() - timedelta(days=now.date().weekday()))
    rep = db.scalar(select(WatchReport).where(WatchReport.business_id == b.id, WatchReport.week_start == monday)) or WatchReport(business_id=b.id, week_start=monday)
    rep.summary, rep.source, rep.events, rep.baseline, rep.created_at = summary, source, len(events), baseline, now
    db.add(rep)
    db.commit()
    return rep


# ---------------------------------------------------------------- running it

def _config(db: Session, business_id: int) -> BiBotConfig:
    from .bot import get_config
    return get_config(db, business_id)


def competitor_domains(db: Session, business_id: int) -> list[str]:
    return [t.domain for t in db.scalars(select(BiTrackedTarget).where(BiTrackedTarget.business_id == business_id, BiTrackedTarget.is_competitor.is_(True),
                                                                      BiTrackedTarget.monitoring_enabled.is_(True)).order_by(BiTrackedTarget.id))][:MAX_COMPETITORS]


def is_running(cfg: BiBotConfig) -> bool:
    started = _aw(cfg.watch_started_at)
    return bool(cfg.watch_running and started and utcnow() - started < TIME_BUDGET + timedelta(minutes=5))


def run_watch(db: Session, fetcher: engine.PageFetcher, b: Business, now: datetime | None = None, clock=None) -> dict:
    """One visit to every competitor, then the weekly summary. Safe to call from a scheduler or a request thread."""
    now = now or utcnow()
    cfg = _config(db, b.id)
    if is_running(cfg):
        return {"skipped": "already running"}
    competitors = competitor_domains(db, b.id)
    if not competitors:
        return {"skipped": "no competitors tracked"}
    since = _aw(cfg.watch_last_run_at) or (now - INTERVAL)
    cfg.watch_running, cfg.watch_started_at = True, now
    db.commit()
    deadline = now + TIME_BUDGET
    visits, baseline_all = [], True
    budget = renderer.RenderBudget(10) if cfg.render_js and renderer.available() else None
    try:
        for dom in competitors:
            if (clock() if clock else utcnow()) > deadline or stop.stopping():
                break
            try:
                v = crawl_competitor(db, fetcher, b.id, dom, now, render=budget)
            except Exception:  # one competitor failing must not hide the others
                db.rollback()
                log.exception("Competitor watch failed for %s", dom)
                continue
            visits.append(v)
            baseline_all = baseline_all and v["baseline"]
        if stop.stopping():  # shutting down: keep what was saved, skip the summary, and let the next tick run the visit again
            return {"skipped": "server stopping", "visits": visits}
        checked = sum(v["fetched"] for v in visits)
        rep = build_report(db, b, since, now, checked, bool(visits) and baseline_all, [v["domain"] for v in visits] or competitors)
        if rep.events:
            activity(db, "competitor watch", "competitor_watch", b.id, events=rep.events, competitors=[v["domain"] for v in visits])
        return {"visits": visits, "report": rep.summary["headline"], "source": rep.source, "events": rep.events}
    finally:
        cfg = _config(db, b.id)
        cfg.watch_running = False
        if not stop.stopping():
            cfg.watch_last_run_at = now
        db.commit()


def run_due(db: Session, fetcher: engine.PageFetcher, now: datetime | None = None) -> int:
    """Scheduler entry point: run the watch for every business whose last visit was a week or more ago."""
    now = now or utcnow()
    ran = 0
    for cfg in list(db.scalars(select(BiBotConfig))):
        if cfg.watch_enabled is False or is_running(cfg):
            continue
        last = _aw(cfg.watch_last_run_at)
        if last is not None and now - last < INTERVAL:
            continue
        b = db.get(Business, cfg.business_id)
        if b is None or not competitor_domains(db, b.id):
            continue
        run_watch(db, fetcher, b, now)
        ran += 1
    return ran


def status(db: Session, b: Business, event_limit: int = 40) -> dict:
    cfg = _config(db, b.id)
    pages = {}
    for dom in competitor_domains(db, b.id):
        pages[dom] = db.query(WatchPage).filter(WatchPage.business_id == b.id, WatchPage.domain == dom, WatchPage.content_hash.is_not(None), WatchPage.removed_at.is_(None)).count()
    reports = list(db.scalars(select(WatchReport).where(WatchReport.business_id == b.id).order_by(WatchReport.week_start.desc()).limit(8)))
    events = list(db.scalars(select(WatchEvent).where(WatchEvent.business_id == b.id).order_by(WatchEvent.at.desc()).limit(event_limit)))
    rep = lambda r: {"week_start": r.week_start, "created_at": r.created_at, "source": r.source, "events": r.events, "baseline": r.baseline, **r.summary}
    return {"enabled": cfg.watch_enabled is not False, "running": is_running(cfg), "last_run_at": cfg.watch_last_run_at,
            "next_run_at": (_aw(cfg.watch_last_run_at) + INTERVAL) if cfg.watch_last_run_at else None,
            "competitors": [{"domain": d, "pages_watched": n} for d, n in pages.items()],
            "latest": rep(reports[0]) if reports else None, "history": [rep(r) for r in reports[1:]],
            "events": [{"domain": e.domain, "kind": e.kind, "url": e.url, "title": e.title, "detail": e.detail, "at": e.at} for e in events]}
