"""Google Business Profile score (0-100) on relevance, distance and prominence.

Weights follow the blueprint's order of impact: primary category, then reviews, then proximity,
website / landing page, citations & NAP, then activity (posts, photos). Same rules as the
frontend's GBP Manager so both show the same number.
"""
import re
from dataclasses import dataclass, field
from typing import Any

STUFFED = re.compile(r"[|]|\s-\s|\bbest\b|\bcheap\b|no\.?\s?1|\btop\s", re.I)


@dataclass
class ProfileStats:
    review_count: int = 0
    rating: float = 0.0
    reply_rate: float = 0.0  # 0-1
    reviews_last_30: int = 0
    photos: int = 0
    posts_last_30: int = 0


@dataclass
class ScoreResult:
    score: int
    factors: dict[str, int]
    items: list[dict[str, Any]]
    alerts: list[dict[str, str]] = field(default_factory=list)
    top_fixes: list[dict[str, Any]] = field(default_factory=list)


def name_looks_stuffed(name: str) -> bool:
    return bool(STUFFED.search(name or "")) or len(name or "") > 60


def score_profile(b: Any, stats: ProfileStats) -> ScoreResult:
    desc = b.description or ""
    services = [s for s in (b.services or []) if s.get("name")]
    attrs = b.attributes or []
    stuffed = name_looks_stuffed(b.name)

    def item(key, factor, weight, score, label, fix):
        score = max(0.0, min(1.0, float(score)))
        return {"key": key, "factor": factor, "weight": weight, "score": round(score, 2), "ok": score >= 0.999, "label": label, "fix": fix}

    items = [
        item("primary_category", "relevance", 12, 1 if b.primary_category else 0, "Primary category set",
             "Pick the primary category the top competitors for your main keyword use."),
        item("secondary_categories", "relevance", 3, 1 if b.secondary_categories else 0, "Secondary categories added",
             "Add 2-4 secondary categories that match services you offer."),
        item("description", "relevance", 5, 1 if len(desc) >= 250 and not re.search(r"https?:|www\.", desc) else 0.5 if len(desc) >= 100 else 0,
             f"Description 250-750 characters ({len(desc)} now)", "Write 600-750 characters: what you do, for whom, where. No links or promotions."),
        item("services", "relevance", 5, len(services) / 5, f"Services listed ({len(services)} of 5+)", "List every service with a one-line description."),
        item("prices", "relevance", 2, 1 if any(s.get("price") for s in services) else 0, "Service prices shown", "Add a price or 'from' price to the main services."),
        item("attributes", "relevance", 2, len(attrs) / 3, f"Attributes ({len(attrs)} of 3+)", "Set attributes such as wheelchair access or online appointments."),
        item("website", "relevance", 5, 1 if b.website else 0, "Website / landing page linked", "Link the page that matches the primary category."),
        item("real_name", "relevance", 3, 0 if stuffed else 1, "Real business name (no keywords)", "Use the signage name only. Keyword-stuffed names get suspended."),
        item("address", "distance", 5, 1 if (b.address or b.service_area) else 0, "Address or service area set", "Add the exact address, or a service area."),
        item("map_pin", "distance", 4, 1 if b.lat is not None and b.lng is not None else 0, "Map pin placed", "Set the exact map pin; the rank grid needs it too."),
        item("phone", "distance", 3, 1 if b.phone else 0, "Local phone number", "Use a local number that matches the website and directories."),
        item("reviews", "prominence", 10, stats.review_count / 50, f"Reviews ({stats.review_count} of 50+)", "Ask every customer for a review by WhatsApp or QR, never only happy ones."),
        item("rating", "prominence", 8, (stats.rating - 3.5) / 1.0 if stats.review_count else 0, f"Average rating ({stats.rating:.1f} of 4.5+)", "Reply to unhappy reviews quickly and fix the cause."),
        item("reply_rate", "prominence", 7, stats.reply_rate / 0.9 if stats.review_count else 0, f"Reply rate ({round(stats.reply_rate * 100)}% of 90%+)", "Reply to every review within 24 hours."),
        item("photos", "prominence", 5, stats.photos / 10, f"Photos ({stats.photos} of 10+)", "Upload real photos weekly: outside, inside, team, work."),
        item("posts", "prominence", 5, stats.posts_last_30 / 4, f"Posts in the last 30 days ({stats.posts_last_30} of 4+)", "Publish one or two Updates or Offers every week."),
    ]

    def factor(name: str) -> int:
        group = [i for i in items if i["factor"] == name]
        total = sum(i["weight"] for i in group)
        return round(sum(i["weight"] * i["score"] for i in group) / total * 100) if total else 0

    total = sum(i["weight"] for i in items)
    score = round(sum(i["weight"] * i["score"] for i in items) / total * 100)

    alerts: list[dict[str, str]] = []
    if b.verification == "unverified":
        alerts.append({"level": "critical", "text": "Profile not verified: it will not show in the Map Pack until verified."})
    if b.verification == "suspended":
        alerts.append({"level": "critical", "text": "Profile suspended. Request reinstatement before anything else."})
    if b.duplicate_listing:
        alerts.append({"level": "warning", "text": "A duplicate listing exists. Duplicates split reviews and ranking; request a merge."})
    if stuffed and b.name:
        alerts.append({"level": "warning", "text": "The business name looks keyword-stuffed, a common cause of suspension."})

    fixes = sorted((i for i in items if not i["ok"]), key=lambda i: i["weight"] * (1 - i["score"]), reverse=True)
    return ScoreResult(score=score, factors={f: factor(f) for f in ("relevance", "distance", "prominence")}, items=items, alerts=alerts, top_fixes=fixes[:3])


def issues_from(result: ScoreResult) -> list[dict[str, Any]]:
    """Checklist failures as audit issues (area GBP)."""
    out = [{"area": "GBP", "level": a["level"], "title": a["text"], "fix": ""} for a in result.alerts]
    for i in result.items:
        if not i["ok"]:
            missing = i["weight"] * (1 - i["score"])
            level = "critical" if missing >= 8 else "serious" if missing >= 4 else "warning"
            out.append({"area": "GBP", "level": level, "title": i["label"], "fix": i["fix"], "key": i["key"]})
    return out
