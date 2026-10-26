"""The playbook: the SOP, writing rules and approval rules the AI follows (one row)."""
from sqlalchemy.orm import Session

from ..models import Playbook

DEFAULT_STEPS = [
    "Match the Google Business Profile by name, phone and address; if two match, ask sales",
    "Audit GBP first: category, description, services, photos, posts, reviews, reply rate",
    "Scan the main keywords on a 7x7 grid, 5 km around the pin",
    "Check speed, indexing, schema and mobile on the home page and top pages",
    "Check titles, meta descriptions, H1 and content depth on every page",
    "Check NAP on directories and the backlink profile; flag toxic links",
    "Write the report in plain words; list the 10 highest-impact fixes as a 90-day plan",
    "Create the schedule for the client's plan and email the client the report",
]

# Kind -> needs approval. Profile edits always ask (enforced in code too).
DEFAULT_APPROVAL = {
    "review_reply_high": False,  # 4-5 star replies go out on autopilot
    "review_reply_low": True,    # 1-3 star replies wait for a person
    "gbp_post": False,
    "profile_edit": True,
    "website_fix": True,
    "blog_draft": True,
    "outreach_email": True,
}

# Plan -> job -> how often.
DEFAULT_PLAN_SCHEDULES = {
    "Starter": {"full_audit": "monthly", "reviews": "daily", "posts": "weekly", "report": "monthly", "rank_scan": "off", "technical": "off", "geo": "off"},
    "Growth": {"full_audit": "monthly", "reviews": "daily", "posts": "weekly", "report": "monthly", "rank_scan": "weekly", "technical": "weekly", "geo": "off"},
    "Pro": {"full_audit": "monthly", "reviews": "daily", "posts": "weekly", "report": "monthly", "rank_scan": "weekly", "technical": "weekly", "geo": "weekly"},
    "Agency": {"full_audit": "monthly", "reviews": "daily", "posts": "weekly", "report": "monthly", "rank_scan": "weekly", "technical": "weekly", "geo": "weekly"},
}


def get_playbook(db: Session) -> Playbook:
    pb = db.get(Playbook, 1)
    if not pb:
        pb = Playbook(id=1, steps=DEFAULT_STEPS, tone="Friendly and professional. Short sentences. No jargon for owners.",
                      languages="English, Hindi, Marathi",
                      alert_rules={"rating_below": 4.0, "rank_drop": 3, "on_suspension": True, "on_site_down": True},
                      approval_rules=DEFAULT_APPROVAL, plan_schedules=DEFAULT_PLAN_SCHEDULES, learnt=[])
        db.add(pb)
        db.commit()
    return pb
