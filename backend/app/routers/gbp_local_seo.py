"""Local SEO for the Google Business Profile: one score and one to-do list built from what the system already knows about this business.

GET /businesses/{id}/gbp/local-seo
  profile   how complete the Google profile is (the profile score)
  reviews   rating and review count against a healthy local target
  citations name, address and phone matching on the listing sites
  website   the site's own audit scores (speed and on-page)
  rankings  where the tracked local searches stand in Google Maps and Google Search
Each part has its own 0-100 score (or null when there is nothing to measure yet); the overall score uses the parts that have data.
The page's buttons use the existing endpoints: seed-keywords and check-ranks (routers/seo.py), citations (routers/citations_manage.py).
"""
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..competitors.intel import default_keywords
from ..db import get_db
from ..deps import get_business
from ..models import Business, Keyword
from ..services import audits
from ..services.profile_score import score_profile
from . import citations_manage, seo

router = APIRouter(prefix="/businesses/{business_id}/gbp/local-seo", tags=["gbp-local-seo"])

WEIGHTS = {"profile": 30, "reviews": 20, "citations": 15, "website": 15, "rankings": 20}
METHOD = [
    {"part": "profile", "weight": 30, "based_on": "How complete the Google profile is: category, hours, photos, description, services, reviews and replies (our profile checklist)."},
    {"part": "reviews", "weight": 20, "based_on": "Review count against a target of 25 (up to 70 points) plus the star rating (up to 30). Both numbers are read from Google."},
    {"part": "citations", "weight": 15, "based_on": "Share of the listing sites where the name and phone match. Sites we could not find in Google search count as not listed until you add and check their link."},
    {"part": "website", "weight": 15, "based_on": "The average of the latest PageSpeed score and the on-page crawl score of the website."},
    {"part": "rankings", "weight": 20, "based_on": "Share of tracked searches where you are in Google Maps or on Google Search (Google Search Console and the Google Places API)."},
]
REVIEW_TARGET = 25  # reviews a local business should have before the count stops being its main weakness


def _reviews_score(rating: float | None, count: int) -> int:
    base = min(70, round(count / REVIEW_TARGET * 70))
    quality = 30 if (rating or 0) >= 4.5 else 20 if (rating or 0) >= 4.0 else 10 if rating else 0
    return min(100, base + quality)


def _level(score: int | None) -> str:
    return "none" if score is None else "good" if score >= 75 else "warning" if score >= 45 else "critical"


def build(b: Business, db: Session) -> dict[str, Any]:
    parts: dict[str, dict[str, Any]] = {}
    actions: list[dict[str, Any]] = []

    # 1. The Google profile
    prof = score_profile(b, audits.profile_stats(db, b))
    parts["profile"] = {"score": prof.score, "detail": f"{len(prof.top_fixes)} thing{'s' if len(prof.top_fixes) != 1 else ''} to improve" if prof.top_fixes else "Nothing important missing", "to": "/gmb-profile/overview"}
    for fx in [f for f in (prof.top_fixes or []) if "review" not in str(f.get("label") or f.get("title") or "").lower() and "reply" not in str(f.get("label") or f.get("title") or "").lower()][:2]:  # reviews have their own action below
        actions.append({"key": f"profile-{fx.get('key', fx.get('label'))}", "area": "profile", "level": "warning", "title": fx.get("label") or fx.get("title"), "fix": fx.get("fix"), "to": "/gmb-profile/overview"})

    # 2. Reviews
    count = int(b.review_count or 0)
    rs = _reviews_score(b.rating, count)
    parts["reviews"] = {"score": rs, "detail": f"{count} review{'s' if count != 1 else ''}" + (f", {b.rating}★" if b.rating else ""), "to": "/gmb-profile/reviews"}
    if count < REVIEW_TARGET:
        actions.append({"key": "reviews", "area": "reviews", "level": "critical" if count < 5 else "warning", "title": f"Get {REVIEW_TARGET - count} more Google reviews",
                        "fix": "Reviews are the strongest local ranking signal. Share the review link or QR code after every sale.", "to": "/gmb-profile/reviews"})

    # 3. Citations and NAP
    cit = citations_manage.overview(b, db)
    cs = cit["summary"]
    parts["citations"] = {"score": cs["score"], "detail": f"{cs['listed']} of {cs['total']} listings correct" + (f", {cs['inconsistent']} to fix" if cs["inconsistent"] else ""), "to": "/off-page-seo/citations"}
    todo = [d["label"] for d in cit["directories"] if d["status"] in ("missing", "inconsistent")][:3]
    if cs["inconsistent"]:
        actions.append({"key": "nap-fix", "area": "citations", "level": "warning", "title": f"Fix {cs['inconsistent']} listing{'s' if cs['inconsistent'] != 1 else ''} with a different name or phone", "fix": "A different name, address or phone on any site confuses Google. Make them identical.", "to": "/off-page-seo/citations"})
    if cs["missing"]:
        actions.append({"key": "citations", "area": "citations", "level": "warning", "title": f"Add the business to {', '.join(todo)}" if todo else "Add the business to listing sites", "fix": "Each listing with the same name, address and phone is another proof for Google.", "to": "/off-page-seo/citations"})

    # 4. The website
    latest = audits.latest(db, b, with_result=False)
    tech, onpage = latest.get("technical"), latest.get("onpage")
    site_scores = [a.score for a in (tech, onpage) if a is not None and a.score is not None]
    if not b.website:
        parts["website"] = {"score": 0, "detail": "No website on the profile", "to": "/gmb-profile/profile"}
        actions.append({"key": "no-website", "area": "website", "level": "critical", "title": "Add the website to the profile", "fix": "A website linked from the profile is a basic local ranking signal.", "to": "/gmb-profile/profile"})
    else:
        score = round(sum(site_scores) / len(site_scores)) if site_scores else None
        parts["website"] = {"score": score, "detail": (f"Speed {tech.score}" if tech and tech.score is not None else "Speed not checked") + (f" · On-page {onpage.score}" if onpage and onpage.score is not None else " · On-page not checked"), "to": "/website-audit"}
        if score is None:
            actions.append({"key": "audit", "area": "website", "level": "warning", "title": "Audit the website", "fix": "Find the technical and on-page problems that hold the local pages back.", "to": "/website-audit"})
        elif score < 70:
            actions.append({"key": "site-fix", "area": "website", "level": "warning", "title": f"Improve the website (score {score})", "fix": "Fix the audit's top issues: titles, descriptions, speed and LocalBusiness schema.", "to": "/website-audit"})

    # 5. Rankings
    pos = seo.current_positions(b, db)
    sm = pos["summary"]
    rows_ = pos["rows"]
    rank_score = None
    if sm["checked"]:
        good = sum(1 for r in rows_ if r["checked"] and (r["maps"]["found"] or (r["organic"]["found"] and (r["organic"]["position"] or 99) <= 10)))
        rank_score = round(good / sm["checked"] * 100)
    parts["rankings"] = {"score": rank_score, "detail": (f"{sm['in_pack']} in the Maps top 3 · {sm['page1']} on Google page 1 of {sm['keywords']} searches" if sm["checked"] else (f"{sm['keywords']} searches tracked, not checked yet" if sm["keywords"] else "No searches tracked yet")), "to": "/rank-tracking"}
    tracked = {k.keyword for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True)))}
    suggestions = [k for k in default_keywords(b) if " ".join(k.lower().split()) not in tracked]
    if not sm["keywords"]:
        actions.append({"key": "seed", "area": "rankings", "level": "critical", "title": "Start tracking the searches your customers use", "fix": "We add searches like “clothing rental in Pune” and check where you stand in Maps and Google.", "to": None, "action": "seed"})
    elif not sm["checked"]:
        actions.append({"key": "check", "area": "rankings", "level": "warning", "title": "Check where you rank now", "fix": "One check reads Google Maps and Google Search for each tracked search.", "to": None, "action": "check"})
    else:
        missing_maps = [r["keyword"] for r in rows_ if r["checked"] and r["maps"]["checked"] and not r["maps"]["found"]]
        if missing_maps:
            actions.append({"key": "maps-gap", "area": "rankings", "level": "warning", "title": f"You are not in Google Maps for “{missing_maps[0]}”" + (f" and {len(missing_maps) - 1} more" if len(missing_maps) > 1 else ""), "fix": "Add the search words to your services and description, keep the category exact, and collect more reviews.", "to": "/gmb-profile/profile"})

    have = [(k, p["score"]) for k, p in parts.items() if p["score"] is not None]
    total_w = sum(WEIGHTS[k] for k, _ in have)
    overall = round(sum(WEIGHTS[k] * s for k, s in have) / total_w) if total_w else None
    for k, p in parts.items():
        p["level"] = _level(p["score"])
        p["weight"] = WEIGHTS[k]
    order = {"critical": 0, "warning": 1, "info": 2}
    actions.sort(key=lambda a: order.get(a["level"], 3))
    return {"score": overall, "level": _level(overall), "parts": parts, "actions": actions[:8], "positions": {"summary": sm, "rows": rows_, "area": pos["area"], "state": pos["state"], "last_checked_at": pos["last_checked_at"]},
            "suggestions": suggestions[:6], "method": METHOD, "note": "This is our own score. Google does not publish one. Each part uses only real data; a part with no data yet is left out, not guessed."}


@router.get("")
def local_seo(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return build(b, db)
