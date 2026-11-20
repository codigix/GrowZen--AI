"""Pitching a website for a backlink: find the public contact addresses of the site, send the owner's reviewed email, and remember what was sent.

Nothing is guessed or invented: contact addresses are only those the site itself publishes (mailto links and addresses on its contact, about or
write-for-us pages). Sending happens only when the owner presses Send on a message they could edit, never automatically."""
from __future__ import annotations

import html as htmllib
import logging
import re
from datetime import timezone
from urllib.parse import urljoin

import httpx
from sqlalchemy.orm import Session

from ..db import utcnow
from ..models import Business
from ..services import notify
from ..services.url_safety import SSRFSafeTransport, SSRFValidationError
from .models import BiOpportunity
from .playbook import DOMAIN, _row, set_status

log = logging.getLogger("seo.backlinks.pitch")
DAILY_LIMIT = 25
EMAIL = re.compile(r"[a-z0-9._%+-]{1,64}@(?:[a-z0-9-]{1,63}\.)+[a-z]{2,24}", re.I)
PATHS = ("/", "/contact", "/contact-us", "/contact.html", "/about", "/about-us", "/write-for-us", "/guest-post", "/advertise", "/submit")
JUNK = ("example.", "sentry", "wixpress", "domain.com", "email.com", "yourname", "name@", "user@", ".png", ".jpg", ".gif", ".webp", ".svg", ".js", ".css")
ROLE_RANK = {"editor": 0, "editorial": 0, "partnerships": 1, "press": 1, "contact": 1, "info": 2, "hello": 2, "advertise": 2, "admin": 3, "webmaster": 3, "team": 3, "support": 4}


def _clean(addr: str) -> str | None:
    a = (addr or "").strip().strip(".,;:()<>[]'\" ").lower()
    if any(j in a for j in JUNK) or not EMAIL.fullmatch(a):
        return None
    return a


def _aware(dt):
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def find_contacts(domain: str) -> dict:
    """The public contact addresses of a site, best first, each with the page it was found on."""
    domain = domain.lower().strip().removeprefix("www.")
    if not DOMAIN.match(domain):
        raise ValueError("That is not a website address")
    found: dict[str, dict] = {}
    pages_read = 0
    try:
        with httpx.Client(transport=SSRFSafeTransport(retries=0), timeout=10, follow_redirects=True,
                          headers={"User-Agent": "Mozilla/5.0 (compatible; GrowZenContactFinder/1.0)", "Accept": "text/html"}) as c:
            for path in PATHS:
                try:
                    r = c.get(urljoin(f"https://{domain}", path))
                except (httpx.HTTPError, SSRFValidationError):
                    if path == "/":
                        break  # the site itself does not answer
                    continue
                if r.status_code != 200 or "html" not in r.headers.get("content-type", "") or len(r.content) > 1_500_000:
                    continue
                pages_read += 1
                text = htmllib.unescape(r.text)
                for m in re.finditer(r"mailto:([^\"'?>\s]+)", text, re.I):
                    a = _clean(m.group(1))
                    if a:
                        found.setdefault(a, {"email": a, "page": str(r.url), "how": "mailto link"})
                for m in EMAIL.finditer(re.sub(r"<[^>]+>", " ", text)):
                    a = _clean(m.group(0))
                    if a:
                        found.setdefault(a, {"email": a, "page": str(r.url), "how": "written on the page"})
                if len(found) >= 8:
                    break
    except (httpx.HTTPError, SSRFValidationError) as exc:
        log.info("contact search failed for %s: %s", domain, exc.__class__.__name__)

    def rank(x: dict) -> tuple:
        local, host = x["email"].split("@", 1)
        return (0 if host.removeprefix("www.").endswith(domain) else 1, ROLE_RANK.get(local, 5), 0 if x["how"] == "mailto link" else 1)

    items = sorted(found.values(), key=rank)[:8]
    return {"domain": domain, "contacts": items, "pages_read": pages_read,
            "note": "" if items else "No public email address was found on the site. Open its contact page or look for a contact form: many sites only have a form."}


def send(db: Session, b: Business, domain: str, to: str, subject: str, body: str, name: str | None = None, source: str = "competitor") -> BiOpportunity:
    """Send the reviewed message, then record who it went to and when, and mark the place as contacted."""
    domain = domain.lower().strip().removeprefix("www.")
    to_clean = _clean(to)
    if not to_clean:
        raise ValueError("That is not an email address")
    subject, body = (subject or "").strip(), (body or "").strip()
    if not subject or len(body) < 30:
        raise ValueError("Write a subject and a message first")
    if "[add" in body.lower() or "[add" in subject.lower():
        raise ValueError("The message still has [add ...] parts to fill in")
    from datetime import timedelta
    from sqlalchemy import func, select
    today = db.scalar(select(func.count(BiOpportunity.id)).where(BiOpportunity.business_id == b.id, BiOpportunity.emailed_at >= utcnow() - timedelta(hours=24))) or 0
    if today >= DAILY_LIMIT:
        raise ValueError(f"You have already emailed {today} sites in the last 24 hours. Wait a little: sending too many looks like spam and can get the mail account blocked.")
    row = _row(db, b, domain)
    if row and row.emailed_at and row.contact_email == to_clean and (utcnow() - _aware(row.emailed_at)).total_seconds() < 60:
        raise ValueError("This was just sent to the same address")
    try:
        ok = notify.send_email(to_clean, subject[:200], body, reply_to=(b.contact_email or "").strip() or None)
    except Exception as exc:  # smtplib raises many kinds
        log.warning("pitch email failed: %s", exc.__class__.__name__)
        raise ValueError("The email could not be sent. Check the mail settings (SMTP) and try again.") from exc
    if not ok:
        raise ValueError("Email sending is not set up: add SMTP_HOST, SMTP_USER, SMTP_PASSWORD and SMTP_FROM to the backend settings.")
    row = set_status(db, b, domain, "contacted", None, source, name)
    row.contact_email, row.email_subject, row.emailed_at, row.email_count, row.replied_at = to_clean, subject[:200], utcnow(), (row.email_count or 0) + 1, None
    db.commit()
    return row


def mark_replied(db: Session, b: Business, domain: str, replied: bool = True) -> BiOpportunity:
    row = _row(db, b, domain.lower().strip().removeprefix("www."))
    if not row:
        raise ValueError("This place is not in your plan yet")
    row.replied_at = utcnow() if replied else None
    db.commit()
    return row


def search_ideas(db: Session, b: Business) -> dict:
    """Ready-made Google searches, written from the business's own services and area, that surface sites worth pitching. Nothing is fetched here."""
    from urllib.parse import quote_plus

    from . import hub
    topics = [t for t in [(b.primary_category or "").strip(), *[(s.get("name") or "").strip() for s in (b.services or [])[:3]]] if t][:3]
    place = ((b.target_areas or [None])[0] or b.city or "").split(",")[-1].strip() if (b.target_areas or b.city) else ""
    own = hub.own_domain(db, b.id) or ""
    name = (b.name or "").strip()
    if not topics:
        return {"state": "no_topic", "groups": [], "note": "Add your category or services in Business details to get searches written for your business."}
    t = topics[0]
    where = f" {place}" if place else ""

    def q(text: str, why: str) -> dict:
        return {"q": text, "url": f"https://www.google.com/search?q={quote_plus(text)}", "why": why}

    groups = [
        {"key": "email", "title": "Platforms that post your link when you email them", "ask": "Send the link, a title and two lines about it, and ask them to publish it. Their email is usually on the submission page.",
         "queries": [q(f'{t} "submit your link" "email"', "Sites that take submitted links by email."), q(f'{t} "send us your" "to be featured" email{where}', "Sites that feature what readers send in."),
                     q(f'"submit your business" {t} "email us"{where}', "Listings that accept an emailed submission."), q(f'{t} "press release" "send" "submit" email', "Sites that publish emailed announcements.")]},
        {"key": "guest", "title": "Sites that take guest posts", "ask": "Offer a useful article for their readers, with one link back to you.",
         "queries": [q(f'"{x}" "write for us"', "Pages where a site invites writers.") for x in topics[:2]] + [q(f'{t} "guest post" "submit"{where}', "Sites with a submission page.")]},
        {"key": "lists", "title": "Pages that list businesses like yours", "ask": "Ask to be added to the list, with one line on why you fit.",
         "queries": [q(f'best {t}{" in " + place if place else ""}', "Roundup pages: ask to be added."), q(f'{t} "useful links" OR "resources"{where}', "Resource pages that link out to businesses."), q(f'{place or "local"} business directory {t}', "Local directories that accept listings.")]},
        {"key": "local", "title": "Local sites and groups", "ask": "Introduce yourself, and offer a quote, an event or a partnership.",
         "queries": [q(f'{place} chamber of commerce members' if place else "chamber of commerce members", "Associations list their members with links."), q(f'{place} local blog {t}' if place else f"local blog {t}", "Local bloggers who write about your field."), q(f'{place} news {t}' if place else f"news {t}", "Local news that covers your field.")]},
        {"key": "mentions", "title": "People who mention you without a link", "ask": "Thank them and ask if they would link your name to your site. The best reply rate.",
         "queries": [q(f'"{name}"' + (f" -site:{own}" if own else ""), "Pages that name your business but are not your site."), q(f'intitle:"{name}"' + (f" -site:{own}" if own else ""), "Pages with your name in the title.")] if name else []},
    ]
    return {"state": "ok", "topics": topics, "place": place, "groups": [g for g in groups if g["queries"]]}


def draft_submit(b: Business, domain: str, url: str, title: str = "", description: str = "") -> dict:
    """A plain, honest request for a platform to post a link for us. Template only, so it never depends on an AI key; the owner edits it before sending."""
    name = (b.name or "our business").strip()
    title = (title or name).strip()
    desc = (description or (b.description or "")).strip()[:300]
    lines = [f"Hello,", "", f"I am writing on behalf of {name}. We would like to ask whether you could publish a link to our website on {domain}.", "",
             f"Title: {title}", f"Link: {url}"]
    if desc:
        lines += [f"About it: {desc}"]
    lines += ["", "If you need anything else from us (a logo, a longer description or a different format), just reply to this email and we will send it right away.",
              "If this is not something you publish, thank you for reading, and sorry for the trouble.", "", f"Kind regards,", name]
    return {"subject": f"Request to feature {title}"[:200], "body": "\n".join(lines), "source": "template"}


def check_published(db: Session, b: Business, domain: str, page_url: str):
    """Fetch the page where they posted it and look for a link to our site. Saves the page, what was found and when, and marks the place as live when the link is there."""
    from urllib.parse import urlsplit

    from . import hub
    domain = domain.lower().strip().removeprefix("www.")
    host = (urlsplit(page_url).hostname or "").removeprefix("www.")
    if not host or not (host == domain or host.endswith("." + domain)):
        raise ValueError(f"The page must be on {domain}")
    own = hub.own_domain(db, b.id) or (urlsplit(b.website if "://" in (b.website or "") else f"//{b.website or ''}").hostname or "").removeprefix("www.")
    if not own:
        raise ValueError("Add the project's website first")
    row = _row(db, b, domain)
    if not row:
        raise ValueError("This place is not in your plan yet")
    found, rel, anchor, note = False, None, None, ""
    try:
        with httpx.Client(transport=SSRFSafeTransport(retries=0), timeout=15, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 (compatible; GrowZenLinkCheck/1.0)", "Accept": "text/html"}) as c:
            r = c.get(page_url)
        if r.status_code != 200:
            note = f"The page answered {r.status_code}."
        else:
            for m in re.finditer(r"<a\b([^>]*)>(.*?)</a>", r.text, re.I | re.S):
                attrs = m.group(1)
                h = re.search(r"href\s*=\s*[\"']([^\"']+)", attrs, re.I)
                if not h:
                    continue
                h_host = (urlsplit(urljoin(page_url, htmllib.unescape(h.group(1)))).hostname or "").removeprefix("www.")
                if h_host == own or h_host.endswith("." + own):
                    rr = re.search(r"rel\s*=\s*[\"']([^\"']+)", attrs, re.I)
                    found, rel = True, (rr.group(1).lower().strip()[:60] if rr else "dofollow")
                    anchor = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", htmllib.unescape(m.group(2)))).strip()[:120]
                    break
            if not found:
                note = "The page is there, but it has no link to your site yet."
    except (httpx.HTTPError, SSRFValidationError):
        note = "The page could not be opened."
    row.published_url, row.link_checked_at, row.link_found, row.link_rel = page_url[:600], utcnow(), found, rel
    if found:
        row.status, row.status_at = "live", utcnow()
    db.commit()
    return {"found": found, "rel": rel, "anchor": anchor, "note": note, "followed": bool(found and rel and "nofollow" not in rel and "sponsored" not in rel and "ugc" not in rel)}


# ------------------------------------------------------------------------------------------------------------------------ finding platforms by themselves
BIG = ("google.", "facebook.", "instagram.", "twitter.", "x.com", "linkedin.", "youtube.", "wikipedia.", "pinterest.", "reddit.", "quora.", "amazon.", "flipkart.", "justdial.", "yelp.",
       "tripadvisor.", "medium.com", "github.com", "apple.com", "microsoft.com", "bing.com", "yahoo.", "gov.in", ".gov", "indiamart.")
_CACHE: dict[int, tuple[float, dict]] = {}
CACHE_SECONDS = 1800
QUERIES_USED = 6
SITES_READ = 12


def _serper(q: str, country: str) -> list[dict]:
    from ..config import get_settings
    key = get_settings().serper_api_key.strip()
    r = httpx.post("https://google.serper.dev/search", headers={"X-API-KEY": key, "Content-Type": "application/json"}, json={"q": q, "num": 10, "gl": (country or "in").lower()}, timeout=20)
    if r.status_code in (401, 403):
        raise ValueError("The search service refused the key (check SERPER_API_KEY).")
    if r.status_code == 400 and "credit" in r.text.lower():
        raise ValueError("The search service (Serper) has no credits left: top up the Serper account, then search again.")
    if r.status_code == 429:
        raise ValueError("The search service has no searches left for now (quota). Try again later.")
    if r.status_code >= 400:
        raise ValueError(f"The search service answered {r.status_code}.")
    return r.json().get("organic", []) or []


def _registrable(host: str) -> str:
    host = (host or "").lower().removeprefix("www.")
    parts = host.split(".")
    if len(parts) >= 3 and parts[-2] in ("co", "com", "org", "net", "ac", "gov") and len(parts[-1]) == 2:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def discover(db: Session, b: Business, force: bool = False) -> dict:
    """Search Google (through the search API) with the business's own searches, collect the platforms that come up, and read each one's public email addresses.
    Slow by nature (a dozen sites are opened), so the answer is kept for half an hour. Every email shown was published by the site itself."""
    import time
    from concurrent.futures import ThreadPoolExecutor
    from urllib.parse import urlsplit

    from ..config import get_settings
    from ..services import market
    from . import hub
    from .models import BiOpportunity
    if not get_settings().serper_api_key.strip():
        return {"state": "no_search", "platforms": [], "message": "Automatic search needs a search key: add SERPER_API_KEY to the backend settings. Until then use the searches above and add the sites by hand."}
    hit = _CACHE.get(b.id)
    if hit and not force and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]
    ideas = search_ideas(db, b)
    if ideas["state"] != "ok":
        return {"state": "no_topic", "platforms": [], "message": ideas["note"]}
    own = hub.own_domain(db, b.id) or (urlsplit(b.website if "://" in (b.website or "") else f"//{b.website or ''}").hostname or "").removeprefix("www.")
    planned = {r.domain: r for r in db.query(BiOpportunity).filter(BiOpportunity.business_id == b.id).all()}
    country = market.serp_country(b)
    # the email-submission searches first, then guest posts and list pages
    wanted = [(g["title"], x) for key in ("email", "guest", "lists") for g in ideas["groups"] if g["key"] == key for x in g["queries"]][:QUERIES_USED]
    seen: dict[str, dict] = {}
    errors: list[str] = []
    for kind, x in wanted:
        try:
            results = _serper(x["q"], country)
        except (ValueError, httpx.HTTPError) as exc:
            errors.append(str(exc) if isinstance(exc, ValueError) else "The search service could not be reached.")
            break
        for r in results:
            link = r.get("link") or ""
            dom = _registrable(urlsplit(link).hostname or "")
            if not dom or dom == _registrable(own) or any(bad in dom for bad in BIG) or not DOMAIN.match(dom):
                continue
            d = seen.setdefault(dom, {"domain": dom, "title": (r.get("title") or "")[:140], "snippet": (r.get("snippet") or "")[:220], "page": link, "kinds": [], "queries": []})
            if kind not in d["kinds"]:
                d["kinds"].append(kind)
            d["queries"].append(x["q"])
    ranked = sorted(seen.values(), key=lambda d: (-len(d["queries"]), d["domain"]))[:SITES_READ]

    def contacts(d: dict) -> dict:
        try:
            c = find_contacts(d["domain"])
            return {**d, "emails": c["contacts"][:3], "pages_read": c["pages_read"]}
        except Exception:  # one unreachable site must not stop the rest
            return {**d, "emails": [], "pages_read": 0}

    with ThreadPoolExecutor(max_workers=6) as pool:
        platforms = list(pool.map(contacts, ranked))
    for p in platforms:
        row = planned.get(p["domain"])
        p["in_plan"] = row.status if row else None
        p["queries"] = p["queries"][:2]
    platforms.sort(key=lambda p: (0 if p["emails"] else 1, -len(p["kinds"])))
    out = {"state": "error" if errors and not platforms else "ok", "platforms": platforms, "message": errors[0] if errors else "", "searched": len(wanted)}
    if out["state"] == "ok":
        _CACHE[b.id] = (time.time(), out)
    return out


# ------------------------------------------------------------------------------------------------------------------------ writing and sending inside the system
KINDS = {
    "submit_link": "ask the platform to publish a link to our page, with the title and a short description they can copy",
    "guest_post": "propose a guest article for their readers (offer two or three topic ideas) with one link back to us",
    "listing": "ask to be added to their list or directory of businesses",
    "mention": "thank them for mentioning us and ask if they would link our name to our site",
}
GEN_SYSTEM = """You write one short, courteous outreach email from a small business to a website owner. The purpose is given.
- 80 to 130 words. Plain text. Greet them, one clear request, thank them, sign with the business name.
- Use only the facts given. Do not invent contact names, praise for specific articles you have not been shown, statistics, awards or promises.
- Never offer payment or a link swap. Never say you visited the site beyond what is given.
- Put the link given on its own line. Do not use [add ...] placeholders: if a fact is missing, leave it out.
- Return JSON: {"subject": "...", "body": "..."}"""


def generate(b: Business, domain: str, kind: str, url: str = "", title: str = "", description: str = "", about: str = "") -> dict:
    """The email for one platform and purpose, ready to review. The link is always in the body; the owner edits and sends it."""
    from ..services import ai
    url = (url or b.website or "").strip()
    name = (b.name or "our business").strip()
    base = draft_submit(b, domain, url, title, description)
    if kind == "guest_post":
        base = {"subject": f"Guest article idea for {domain}", "source": "template", "body": f"Hello,\n\nI am writing on behalf of {name}. We would like to write a useful article for the readers of {domain}"
                f"{' (' + about[:120] + ')' if about else ''}. Could we send you two or three topic ideas to choose from?\n\nIf the article is accepted, we would include one link to {url} where it helps the reader.\n\nThank you for your time.\n\nKind regards,\n{name}"}
    elif kind == "listing":
        base = {"subject": f"Please add {name} to your list", "source": "template", "body": f"Hello,\n\nI am writing on behalf of {name}. We think we would fit the businesses you list on {domain}. Could you add us?\n\nOur page: {url}\n"
                f"{'About us: ' + description.strip() + chr(10) if description.strip() else ''}\nIf you need anything else from us, just reply and we will send it.\n\nThank you.\n\nKind regards,\n{name}"}
    elif kind == "mention":
        base = {"subject": f"Thank you for mentioning {name}", "source": "template", "body": f"Hello,\n\nThank you for mentioning {name} on {domain}. If you are happy to, could you link our name to our website so readers can find us easily?\n\n{url}\n\nThank you again.\n\nKind regards,\n{name}"}
    if not ai.is_configured():
        return base
    facts = f"Business: {name}\nOur website: {url}\nPlatform: {domain}" + (f"\nWhat the platform says about itself: {about[:200]}" if about else "") + (f"\nTitle to show: {title}" if title else "") + (f"\nAbout the link: {description[:300]}" if description else "") + f"\nPurpose: {KINDS.get(kind, KINDS['submit_link'])}"
    try:
        out = ai.complete_json(GEN_SYSTEM, facts, temperature=0.5, max_tokens=500)
        subject, body = str(out.get("subject", "")).strip(), str(out.get("body", "")).strip()
        if subject and len(body) > 60 and url in body and "[add" not in body.lower() and "[add" not in subject.lower():
            return {"subject": subject[:200], "body": body, "source": "ai"}
    except (ai.AiUnavailable, ValueError):
        pass
    return base


def send_many(db: Session, b: Business, items: list[dict]) -> list[dict]:
    """Send several reviewed emails in turn. Each answer says sent or why not; one failure never stops the others."""
    import time
    out = []
    for i, x in enumerate(items):
        try:
            send(db, b, x["domain"], x["to"], x["subject"], x["body"], x.get("name"), x.get("source", "manual"))
            out.append({"domain": x["domain"], "to": x["to"], "ok": True})
        except ValueError as exc:
            out.append({"domain": x["domain"], "to": x["to"], "ok": False, "error": str(exc)})
        if i < len(items) - 1:
            time.sleep(1.5)  # not a burst: it looks like spam to the receiving mail servers
    return out
