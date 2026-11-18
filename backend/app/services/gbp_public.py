"""The Google profile of a project, read from Google only, and an honest analysis of it.

Sources (no paid third-party data service):
  * Google Places API: what anyone sees on the Maps listing (name, category, hours, rating, reviews count, photos, amenities, a few reviews).
  * The project's own saved data when its Google Business Profile is connected: every review (so the rating spread), posts, services.
  * Google Search Console: how the website performs in Google Search (clicks, impressions, position, the queries behind them).

info()    the listing as Maps shows it, in the shape the page uses
search()  Search Console figures for the site, or the reason they cannot be read
analyse() a checklist scored from those facts, and a roadmap built from the checks that fail. A fact that cannot be read is left out of the score, never guessed.
"""
from datetime import date, datetime, timezone
from typing import Any

from . import discovery, maps_public


class GbpError(Exception):
    pass


def configured() -> bool:
    return discovery.places_enabled()


def info(place_id: str, fresh: bool = False) -> dict[str, Any]:
    """The public Maps listing. Places shows at most 10 photos and 5 reviews, no claimed flag, no rating spread, no services list: those stay empty here."""
    try:
        d = maps_public.read(place_id, fresh)
    except discovery.DiscoveryError as exc:
        raise GbpError(str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise GbpError("Google Maps could not be reached. Try again in a minute.") from exc
    bs, rep = d["basics"], d["reputation"]
    return {
        "title": bs.get("name"), "category": bs.get("category"), "additional_categories": bs.get("categories") or [], "description": "", "description_known": False,  # Places gives Google's own summary, not the owner's description
        "phone": bs.get("phone"), "website": bs.get("website"), "book_url": None, "address": bs.get("address"), "address_info": {},
        "rating": rep.get("rating"), "votes": rep.get("count") or 0, "distribution": None, "photos": rep.get("photos"), "photos_partial": True,
        "claimed": None, "price": bs.get("price"), "hours": d.get("hours") or [], "more_hours": d.get("more_hours") or [], "attributes": d.get("features") or [], "attributes_missing": [],
        "services": [], "topics": [], "qa_count": None, "links": [], "logo": None, "image": None, "cid": None, "maps_url": d.get("maps_url"),
        "status": bs.get("status"), "reviews": rep.get("reviews") or [], "source": "Google Places", "read_at": datetime.now(timezone.utc).isoformat(),
    }


def enrich_from_connection(p: dict[str, Any], b: Any, db: Any) -> dict[str, Any]:
    """When the Google Business Profile is connected, its own saved data is richer than the public listing: every review (the real rating spread), the services and the claimed state."""
    if not getattr(b, "gbp_location", None):
        return p
    from sqlalchemy import select

    from ..models import Review
    p = dict(p)
    p["claimed"] = True
    p["description"], p["description_known"] = (b.description or ""), True
    ratings = [r for (r,) in db.execute(select(Review.rating).where(Review.business_id == b.id))]
    if len(ratings) >= 5:
        p["distribution"] = {str(n): sum(1 for x in ratings if x == n) for n in range(1, 6)}
    p["services"] = [{"name": s.get("name"), "price": s.get("price")} for s in (b.services or []) if isinstance(s, dict) and s.get("name")]
    if b.photo_count:
        p["photos"], p["photos_partial"] = b.photo_count, False
    if getattr(b, "booking_url", None):
        p["book_url"] = b.booking_url
    return p


def saved_posts(b: Any, db: Any) -> list[dict[str, Any]] | None:
    """The posts published on the profile, from the app's own records. None when the profile is not connected: Google shows posts to anyone but gives no way to read them."""
    if not getattr(b, "gbp_location", None):
        return None
    from sqlalchemy import select

    from ..models import Post
    rows = db.scalars(select(Post).where(Post.business_id == b.id, Post.status == "published").order_by(Post.published_at.desc()).limit(30)).all()
    return [{"text": (r.body or "")[:600], "date": (r.published_at.date().isoformat() if r.published_at else ""), "url": None, "image": r.image_url, "has_link": bool(r.cta_url)} for r in rows]


# ------------------------------------------------------------------------------------------------------------------------ Search Console
def search(db: Any, b: Any) -> dict[str, Any]:
    """How the project's website performs in Google Search over the last 28 days, read through its Search Console property."""
    from . import gsc, gsc_access, market
    host = gsc.host_of(b.website)
    if not host:
        return {"state": "no_site", "message": "Add the project's website to read how it does in Google Search."}
    try:
        state, message, sc, site = gsc_access.search_console(db, b, host)
    except Exception:  # noqa: BLE001
        return {"state": "error", "message": "Search Console could not be reached right now."}
    if state != "ok":
        return {"state": state, "message": message}
    try:
        rep = gsc.report(sc, site, "28d", market.serp_country(b))
    except Exception as exc:  # noqa: BLE001 - Google's own reason (API not enabled, no permission)
        return {"state": "error", "message": str(exc)[:240] or "Search Console did not answer."}
    return {"state": "ok", "account": message, "property": site, "period": rep["period"], "totals": rep["totals"], "previous": rep["previous"], "keywords": rep["keywords"][:25], "pages": rep["pages"][:10]}


def _plain(text: str | None) -> str:
    """Lower case with every punctuation mark turned into a space, so “Pimpri-Chinchwad” and “pimpri chinchwad” are the same."""
    return " ".join("".join(c if c.isalnum() else " " for c in (text or "").lower()).split())


def _tokens(name: str | None) -> list[str]:
    skip = {"private", "limited", "services", "solutions", "infotech"}
    return [t for t in "".join(c.lower() if c.isalnum() else " " for c in (name or "")).split() if len(t) >= 4 and t not in skip]


# ------------------------------------------------------------------------------------------------------------------------ analysis
def _row(key: str, label: str, status: str, detail: str, weight: int, fix: str | None = None, phase: str = "30") -> dict[str, Any]:
    return {"key": key, "label": label, "status": status, "detail": detail, "weight": weight, "fix": fix, "phase": phase}


def analyse(p: dict[str, Any], b: Any, post_list: list[dict[str, Any]] | None = None, sc: dict[str, Any] | None = None) -> dict[str, Any]:
    """Score the profile and build the roadmap. Whatever could not be read (posts, claimed state, rating spread, Search Console) is left out of the score instead of being guessed."""
    rows: list[dict[str, Any]] = []
    add = rows.append
    if p.get("claimed") is not None:
        add(_row("claimed", "Profile is claimed and verified", "ok" if p["claimed"] else "bad", "Claimed by the owner." if p["claimed"] else "Nobody has claimed this profile, so you cannot edit or answer reviews.", 10,
                 None if p["claimed"] else "Claim the profile on Google and verify it (postcard, phone, email or video).", "7"))
    mine = (getattr(b, "primary_category", None) or "").strip().lower()
    cat = (p.get("category") or "").strip()
    add(_row("category", "Main category", "ok" if cat and (not mine or mine == cat.lower()) else "warn" if cat else "bad",
             (f"Google shows “{cat}”." + (f" Your project says “{b.primary_category}”." if mine and mine != cat.lower() else "")) if cat else "No main category shown.", 10,
             "Make the main category the service that earns you the most, and use the same one everywhere.", "7"))
    if p.get("description_known"):
        dl = len((p.get("description") or "").strip())
        add(_row("description", "Description", "ok" if dl >= 400 else "warn" if dl >= 150 else "bad", f"{dl} of 750 characters used." if dl else "No description.", 8,
                 "Write 400 to 750 characters: who you serve, what you do, where, and what makes you different. No keyword stuffing, no links.", "7"))
    ph = p.get("photos") or 0
    if p.get("photos_partial"):
        add(_row("photos", "Photos", "ok" if ph >= 10 else "warn" if ph >= 5 else "bad", f"Maps shows {ph} photo{'s' if ph != 1 else ''} (it never shows more than 10 here).", 6,
                 "Add real photos of your work, team and place every week.", "30"))
    else:
        add(_row("photos", "Photos", "ok" if ph >= 100 else "warn" if ph >= 25 else "bad", f"{ph} photos on the profile.", 8, "Add real photos of your work, team and place every week. Aim for 100 or more.", "30"))
    votes, rating = p.get("votes") or 0, p.get("rating") or 0
    add(_row("reviews", "Number of reviews", "ok" if votes >= 100 else "warn" if votes >= 25 else "bad", f"{votes} reviews.", 12,
             "Ask every happy customer for a review with your review link: print it on the bill and send it by WhatsApp after each job.", "7"))
    add(_row("rating", "Average rating", "ok" if rating >= 4.5 else "warn" if rating >= 4.0 else "bad", f"{rating} stars." if rating else "No rating yet.", 10,
             "Reply to every review and fix what unhappy customers name.", "30"))
    dist = p.get("distribution") or {}
    total = sum(dist.values()) or 0
    if total:
        low = (dist.get("1", 0) + dist.get("2", 0)) / total
        add(_row("negatives", "Low-star reviews", "ok" if low <= 0.05 else "warn" if low <= 0.12 else "bad", f"{round(low * 100)}% of the {total} reviews are 1 or 2 stars.", 4, "Reply politely to each low review and offer to put it right offline.", "30"))
    add(_row("hours", "Opening hours", "ok" if p.get("hours") else "bad", "Hours are shown." if p.get("hours") else "No opening hours shown.", 6, "Add hours for every day, and special hours for holidays.", "7"))
    add(_row("phone", "Phone number", "ok" if p.get("phone") else "bad", p.get("phone") or "No phone shown.", 4, "Add the number customers can call.", "7"))
    add(_row("website", "Website link", "ok" if p.get("website") else "bad", p.get("website") or "No website shown.", 4, "Add your website, with a UTM tag so you can see the visits in analytics.", "7"))
    if p.get("book_url") or getattr(b, "gbp_location", None):
        add(_row("booking", "Booking or appointment link", "ok" if p.get("book_url") else "warn", p.get("book_url") or "No booking link.", 3, "Add an appointment or enquiry link so customers can act straight from Google.", "30"))
    n_attr = len(p.get("attributes") or [])
    add(_row("attributes", "Attributes", "ok" if n_attr >= 3 else "warn", f"{n_attr} attribute{'s' if n_attr != 1 else ''} shown.", 3, "Turn on every attribute that is true for you (payment, accessibility, amenities).", "30"))
    if getattr(b, "gbp_location", None):
        add(_row("services", "Services listed", "ok" if p.get("services") else "warn", f"{len(p['services'])} services listed." if p.get("services") else "No services listed.", 5,
                 "List each service with a short description (and a price if you can).", "30"))
    nap = []
    if getattr(b, "phone", None) and p.get("phone"):
        a, c = "".join(ch for ch in str(b.phone) if ch.isdigit())[-10:], "".join(ch for ch in str(p["phone"]) if ch.isdigit())[-10:]
        if a and c and a != c:
            nap.append("phone")
    if getattr(b, "name", None) and p.get("title") and "".join(ch for ch in b.name.lower() if ch.isalnum()) != "".join(ch for ch in p["title"].lower() if ch.isalnum()):
        nap.append("name")
    add(_row("nap", "Same name and phone everywhere", "warn" if nap else "ok", ("Your project and Google differ in: " + ", ".join(nap) + ".") if nap else "Name and phone match your project.", 4,
             "Use one exact name and phone on Google, your website and every listing.", "7"))
    if post_list is not None:
        newest = max((x["date"] for x in post_list if x.get("date")), default=None)
        today = datetime.now(timezone.utc).date()
        age = (today - date.fromisoformat(newest)).days if newest else None
        recent = sum(1 for x in post_list if x.get("date") and (today - date.fromisoformat(x["date"])).days <= 30)
        add(_row("posts", "Recent posts", "ok" if age is not None and age <= 14 and recent >= 3 else "warn" if age is not None and age <= 45 else "bad",
                 f"{recent} post{'s' if recent != 1 else ''} in the last 30 days; the newest is {age} days old." if age is not None else "No posts published from this app yet.", 10,
                 "Post one update or offer a week with a real photo and a button. Old posts stop showing after a few weeks.", "7"))
    if sc and sc.get("state") == "ok":
        t, prev, kws = sc["totals"], sc["previous"], sc["keywords"]
        imp = t.get("impressions", 0)
        trend = (t["clicks"] - prev["clicks"]) if prev.get("clicks") is not None else 0
        add(_row("search_visibility", "Website visibility in Google Search", "ok" if imp >= 1000 else "warn" if imp >= 100 else "bad",
                 f"{imp:,} impressions and {t['clicks']:,} clicks in 28 days" + (f", average position {t['position']}" if t.get("position") else "")
                 + (f" ({'+' if trend >= 0 else ''}{trend} clicks vs the 28 days before)." if prev.get("clicks") is not None else "."), 8,
                 "Build a page for each main service and area, with the same name, address and phone as the profile, and link the profile and the pages to each other.", "90"))
        brand = _tokens(getattr(b, "name", None))
        city = _plain(getattr(b, "city", None))
        all_imp = sum(k["impressions"] for k in kws) or 0
        if brand and all_imp:
            share = sum(k["impressions"] for k in kws if any(tok in k["query"].lower() for tok in brand)) / all_imp
            add(_row("brand_search", "People searching your name", "ok" if share >= 0.15 else "warn" if share >= 0.03 else "bad", f"{round(share * 100)}% of the impressions in the top queries are for your name.", 4,
                     "Brand searches grow with reviews, local mentions and a consistent name everywhere.", "90"))
        if city and all_imp:
            share = sum(k["impressions"] for k in kws if city in _plain(k["query"]) or "near me" in _plain(k["query"]) or "nearby" in _plain(k["query"])) / all_imp
            add(_row("local_search", "Local searches", "ok" if share >= 0.2 else "warn" if share >= 0.05 else "bad", f"{round(share * 100)}% of the impressions in the top queries mention {b.city} or “near me”.", 5,
                     f"Add {b.city} and the nearby areas to your service pages, the profile description and your headings.", "90"))
        if imp >= 1000 and t.get("ctr", 0) < 1.5:
            add(_row("search_ctr", "Clicks from Google Search", "warn", f"Only {t['ctr']}% of impressions become clicks.", 3, "Rewrite page titles and descriptions so they match what people search and show what you offer.", "30"))
    earned = sum(r["weight"] * {"ok": 1, "warn": 0.5, "bad": 0}[r["status"]] for r in rows)
    possible = sum(r["weight"] for r in rows)
    score = round(100 * earned / possible) if possible else 0
    order = {"bad": 0, "warn": 1}
    todo = sorted((r for r in rows if r["status"] != "ok" and r["fix"]), key=lambda r: (order[r["status"]], -r["weight"]))
    phases: dict[str, list[dict[str, Any]]] = {"7": [], "30": [], "90": []}
    for r in todo:
        phases[r["phase"]].append({"what": r["fix"], "why": f"{r['label']}: {r['detail']}", "impact": "high" if r["weight"] >= 8 else "medium" if r["weight"] >= 5 else "low"})
    phases["30"] += [
        {"what": f"Collect about {max(10, round(max(votes, 20) * 0.1))} new reviews a month and reply to every one within two days.", "why": "Reviews are the strongest local signal you control.", "impact": "high"},
        {"what": "Post a weekly update or offer and add 5 to 10 new photos a month.", "why": "Fresh activity keeps the profile ahead of similar businesses nearby.", "impact": "medium"},
    ]
    phases["90"] += [
        {"what": "Build one page on your website for each main service and area, and link them from the profile.", "why": "The website is what Google compares the profile against.", "impact": "high"},
        {"what": "Keep name, address and phone identical on 15 to 20 trusted directories (Listings page).", "why": "Consistent listings build trust in your location.", "impact": "medium"},
        {"what": "Track your Maps rank for your top 10 searches each month and compare with competitors (Map Rank Tracker).", "why": "It shows whether the work is moving you up.", "impact": "medium"},
        {"what": "Earn links and mentions from local sites, and add the same details as LocalBusiness data on your site.", "why": "Prominence on the web lifts the profile in Maps.", "impact": "medium"},
    ]
    return {"score": score, "word": "Strong" if score >= 80 else "Fair" if score >= 55 else "Needs work", "checks": rows, "roadmap": [
        {"when": "This week", "days": 7, "items": phases["7"]}, {"when": "Next 30 days", "days": 30, "items": phases["30"]}, {"when": "Next 90 days", "days": 90, "items": phases["90"]}],
        "counts": {s: sum(1 for r in rows if r["status"] == s) for s in ("ok", "warn", "bad")}, "posts_read": post_list is not None, "search_read": bool(sc and sc.get("state") == "ok")}
