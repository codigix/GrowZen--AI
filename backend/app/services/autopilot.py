"""Autopilot: the software prepares the work on a schedule, a person approves it, and only then does anything reach Google.

What it prepares (all from the real profile, never invented):
  - Google posts for the coming week, at the days and time chosen in the settings
  - a reply to every review that waits
  - a monthly rewrite of the profile description and services
  - a photo schedule for the photos the owner uploads
THE RULE: nothing is posted, replied, uploaded or changed on Google without an explicit approval of that exact item. An approved post or photo goes out at the time it was approved for
(or at once, if "publish now" was chosen). The code enforces it in three places: these kinds always need approval (agent.ALWAYS_ASK), the autopilot-off switch only stops preparing,
and the publisher refuses any item without an approval record.
"""
import hashlib
import io
import re
import logging
from datetime import date, datetime, time as dtime, timedelta, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..models import AgentTask, Business, Post, Review
from . import agent, ai, gbp, localtime
from .activity import log

logger = logging.getLogger("seo.autopilot")

GATED_KINDS = ("gbp_post", "review_reply", "profile_edit", "gbp_photo")
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DEFAULTS = {"enabled": False, "posts_per_week": 3, "post_days": ["mon", "wed", "fri"], "post_time": "10:00", "replies": True, "profile": True, "photos_per_week": 2,
            "photo_days": ["tue", "sat"], "photo_time": "12:00", "language": "English"}
MAX_PENDING_POSTS = 6
MAX_PENDING_PHOTOS = 12
RULE = "Nothing is posted, replied, uploaded or changed on Google until you approve that exact item."


class AutopilotError(Exception):
    pass


# ------------------------------------------------------------------------------------------------------------------- settings
def settings(b: Business) -> dict[str, Any]:
    out = dict(DEFAULTS)
    out.update({k: v for k, v in (b.autopilot or {}).items() if k in DEFAULTS})
    return out


def _hhmm(v: Any, default: str) -> str:
    try:
        h, m = str(v).split(":")
        return f"{int(h):02d}:{int(m):02d}" if 0 <= int(h) < 24 and 0 <= int(m) < 60 else default
    except (ValueError, TypeError):
        return default


def save_settings(db: Session, b: Business, body: dict[str, Any]) -> dict[str, Any]:
    cur = settings(b)
    if "enabled" in body and body["enabled"] is not None:
        cur["enabled"] = bool(body["enabled"])
    for k in ("replies", "profile"):
        if body.get(k) is not None:
            cur[k] = bool(body[k])
    for k, hi in (("posts_per_week", 3), ("photos_per_week", 3)):  # three a week: more looks like spam to Google and to customers
        if body.get(k) is not None:
            cur[k] = max(0, min(hi, int(body[k])))
    for k in ("post_days", "photo_days"):
        if body.get(k) is not None:
            days = [d for d in DAYS if d in {str(x).lower()[:3] for x in body[k]}]
            cur[k] = days
    for k in ("post_time", "photo_time"):
        if body.get(k) is not None:
            cur[k] = _hhmm(body[k], cur[k])
    if body.get("language"):
        cur["language"] = str(body["language"]).strip()[:30] or "English"
    b.autopilot = cur
    db.add(b)
    db.flush()
    return cur


def linked(b: Business) -> bool:
    return bool(b.connection_id and b.gbp_account and b.gbp_location)


def enforce(db: Session) -> int:
    """Make the rule true for what already exists: every pending item of a gated kind needs approval (older defaults let 4-5 star replies and posts go out by themselves)."""
    n = db.execute(update(AgentTask).where(AgentTask.status == "pending", AgentTask.kind.in_(GATED_KINDS), AgentTask.requires_approval.is_(False)).values(requires_approval=True)).rowcount or 0
    try:
        from .playbook import get_playbook
        pb = get_playbook(db)
        rules = dict(pb.approval_rules or {})
        if any(rules.get(k) is False for k in ("gbp_post", "review_reply_high", "review_reply_low")):
            rules.update(gbp_post=True, review_reply_high=True, review_reply_low=True, profile_edit=True)
            pb.approval_rules = rules
            db.add(pb)
    except Exception:  # noqa: BLE001
        db.rollback()
    db.commit()
    return n


# ------------------------------------------------------------------------------------------------------------------- time
def slot_utc(b: Business, day: date, hhmm: str) -> datetime:
    h, m = (int(x) for x in hhmm.split(":"))
    return datetime.combine(day, dtime(h, m), tzinfo=localtime.tz_of(b)).astimezone(timezone.utc)


def _aware(d: datetime | None) -> datetime | None:
    return d if d is None or d.tzinfo else d.replace(tzinfo=timezone.utc)


def _iso(d: datetime | None) -> str | None:
    d = _aware(d)
    return d.isoformat() if d else None


def parse_when(v: Any) -> datetime | None:
    if not v:
        return None
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError as exc:
        raise AutopilotError("That date and time could not be read.") from exc
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _free_slots(b: Business, days: list[str], hhmm: str, count: int, taken: set[str], start: date | None = None, horizon: int = 14) -> list[datetime]:
    """The next `count` times on the chosen weekdays (in the business's own time) that are still in the future and not already used."""
    now = datetime.now(timezone.utc)
    day = start or localtime.today(b)
    out: list[datetime] = []
    for i in range(horizon):
        d = day + timedelta(days=i)
        if DAYS[d.weekday()] not in days:
            continue
        s = slot_utc(b, d, hhmm)
        if s <= now + timedelta(minutes=30) or s.isoformat() in taken:
            continue
        out.append(s)
        if len(out) >= count:
            break
    return out


# ------------------------------------------------------------------------------------------------------------------- preparing posts
def _topics(db: Session, b: Business, recent: list[str]) -> list[str]:
    """What the next posts can be about: the services first, then the main keywords; topics not used in the last posts come first."""
    from . import growth_content as gc
    names = [str(s.get("name")).strip() for s in (b.services or []) if isinstance(s, dict) and s.get("name")]
    pool = [t for t in dict.fromkeys(names + gc._main_keywords(b, gc.tracked(db, b), 6)) if t]
    used = " ".join(recent).lower()
    fresh = [t for t in pool if t.lower() not in used]
    return (fresh or pool)[:8]


def _count_pending(db: Session, b: Business, kind: str) -> int:
    return db.query(AgentTask).filter(AgentTask.business_id == b.id, AgentTask.kind == kind, AgentTask.status == "pending", AgentTask.detail["source"].as_string() == "autopilot").count()


def plan_posts(db: Session, b: Business) -> dict[str, Any]:
    """Draft the posts for the coming days (one per chosen weekday, at most posts_per_week). Drafts only: each waits for approval."""
    st = settings(b)
    if not st["posts_per_week"] or not st["post_days"]:
        return {"made": 0, "note": "Posts are switched off in the settings."}
    if not ai.is_configured():
        return {"made": 0, "note": "AI is not set up on this server, so no post can be written."}
    taken = {t.detail.get("publish_at") for t in db.scalars(select(AgentTask).where(AgentTask.business_id == b.id, AgentTask.kind == "gbp_post", AgentTask.status.in_(("pending", "scheduled")))) if (t.detail or {}).get("publish_at")}
    waiting = _count_pending(db, b, "gbp_post")
    want = min(int(st["posts_per_week"]), MAX_PENDING_POSTS - waiting)
    if want <= 0:
        return {"made": 0, "note": f"{waiting} posts already wait for your approval: approve or reject them first."}
    slots = _free_slots(b, st["post_days"], st["post_time"], want, taken)
    if not slots:
        return {"made": 0, "note": "No free posting day in the next two weeks."}
    posts = list(db.scalars(select(Post).where(Post.business_id == b.id).order_by(Post.created_at.desc()).limit(12)))
    topics = _topics(db, b, [f"{p.title or ''} {p.body[:80]}" for p in posts])
    if not topics:
        return {"made": 0, "note": "Add services or keywords to the project first, so the posts have something real to talk about."}
    try:
        out = ai.complete_json(f"You write Google Business Profile posts.\n{ai.RULES}\nUse only facts in the business profile. Never invent prices, offers, discounts, awards, statistics, reviews or events. No phone numbers or links in the text. "
                               "Each post is helpful, specific and different from the others, 40 to 120 words, with one clear call to action.",
                               f"Business profile:\n{ai.profile_text(b)}\n\nWrite {len(slots)} different Update posts, one per topic, in {st['language']}: {', '.join(topics[:len(slots) + 2])}.\n"
                               'Return JSON {"posts": [{"topic": "", "title": "", "body": "", "cta_type": "BOOK"|"LEARN_MORE"|"CALL"}]}', max_tokens=2200)
    except Exception as exc:  # noqa: BLE001
        return {"made": 0, "note": f"The AI service did not answer ({type(exc).__name__}). It will try again at the next run."}
    made = 0
    existing = {p.body[:60].lower() for p in posts}
    for slot, item in zip(slots, (out.get("posts") if isinstance(out, dict) else None) or []):
        body = " ".join(str(item.get("body") or "").split())[:1500]
        if len(body) < 40 or body[:60].lower() in existing or re.search(r"\[[^\]]{2,}\]|\{[^}]{2,}\}|lorem ipsum", body, re.I):  # a template placeholder in the text means the model had no facts: never offer it
            continue
        cta = item.get("cta_type") if item.get("cta_type") in ("BOOK", "LEARN_MORE", "CALL") else "LEARN_MORE"
        p = Post(business_id=b.id, post_type="Update", title=(str(item.get("title") or "").strip()[:90] or None), body=body, cta_type=cta, cta_url=b.booking_url or b.website, scheduled_for=slot, status="draft", ai_generated=True)
        db.add(p)
        db.flush()
        local = slot.astimezone(localtime.tz_of(b))
        t = AgentTask(business_id=b.id, agent="gbp", kind="gbp_post", title=f"Post for {local:%a %d %b}: {(p.title or body)[:60]}", impact="Medium", requires_approval=True,
                      detail={"post_id": p.id, "body": body, "publish_at": slot.isoformat(), "topic": str(item.get("topic") or "")[:80], "source": "autopilot"})
        db.add(t)
        existing.add(body[:60].lower())
        made += 1
    db.commit()
    return {"made": made, "note": None if made else "The AI answer had no usable post."}


def draft_replies(db: Session, b: Business) -> dict[str, Any]:
    st = settings(b)
    if not st["replies"]:
        return {"made": 0, "note": "Review replies are switched off in the settings."}
    if not ai.is_configured():
        return {"made": 0, "note": "AI is not set up on this server, so no reply can be written."}
    n = agent.draft_review_replies(db, b, st["language"])
    return {"made": n, "note": None}


# ------------------------------------------------------------------------------------------------------------------- the profile rewrite
def profile_state(b: Business) -> dict[str, Any]:
    return {"description": b.description or "", "services": [s for s in (b.services or []) if isinstance(s, dict)]}


def propose_profile(db: Session, b: Business, force: bool = False) -> dict[str, Any]:
    """One rewrite of the description and services at a time, at most once every 28 days unless asked for. It only adds services: nothing the owner wrote is removed."""
    if not settings(b)["profile"] and not force:
        return {"made": 0, "note": "The profile rewrite is switched off in the settings."}
    if not ai.is_configured():
        return {"made": 0, "note": "AI is not set up on this server, so no rewrite can be written."}
    open_one = db.scalar(select(AgentTask.id).where(AgentTask.business_id == b.id, AgentTask.kind == "profile_edit", AgentTask.status == "pending", AgentTask.detail["source"].as_string() == "autopilot"))
    if open_one:
        return {"made": 0, "note": "A profile rewrite already waits for your approval."}
    last = db.scalar(select(AgentTask.created_at).where(AgentTask.business_id == b.id, AgentTask.kind == "profile_edit", AgentTask.detail["source"].as_string() == "autopilot").order_by(AgentTask.created_at.desc()).limit(1))
    if last and not force and datetime.now(timezone.utc) - _aware(last) < timedelta(days=28):
        return {"made": 0, "note": "The last rewrite was made less than 28 days ago."}
    from . import growth_content as gc
    kws = gc._main_keywords(b, gc.tracked(db, b), 4)
    try:
        out = ai.complete_json(f"You improve a Google Business Profile.\n{ai.RULES}\nUse only facts in the existing profile. Never invent services, prices, awards, years or claims. No links, phone numbers or promotions in the description. "
                               "Never put keywords in the business name. Use a keyword only if it truly describes what the business sells.",
                               f"Business profile:\n{ai.profile_text(b)}\n\nKeywords (may contain mistakes): {', '.join(kws)}\n\nWrite a clear description of 600 to 740 characters and suggest up to 5 services the profile shows the business really offers (name under 80 characters, description under 200). "
                               'Return JSON {"description": "", "services": [{"name": "", "description": ""}]}', max_tokens=1400)
    except Exception as exc:  # noqa: BLE001
        return {"made": 0, "note": f"The AI service did not answer ({type(exc).__name__})."}
    desc = " ".join(str(out.get("description") or "").split())[:750] if isinstance(out, dict) else ""
    have = {str(s.get("name")).strip().lower() for s in (b.services or []) if isinstance(s, dict)}
    add = [{"name": " ".join(str(s.get("name")).split())[:80], "description": " ".join(str(s.get("description") or "").split())[:200]} for s in (out.get("services") or []) if isinstance(s, dict) and s.get("name")] if isinstance(out, dict) else []
    add = [s for s in add if s["name"].lower() not in have][:5]
    if len(desc) < 200 and not add:
        return {"made": 0, "note": "The AI answer had no usable rewrite."}
    after_services = [s for s in (b.services or []) if isinstance(s, dict)] + add
    changes: dict[str, Any] = {}
    if len(desc) >= 200 and desc != (b.description or ""):
        changes["description"] = desc
    if add:
        changes["services"] = after_services
    if not changes:
        return {"made": 0, "note": "Nothing to improve right now."}
    db.add(AgentTask(business_id=b.id, agent="gbp", kind="profile_edit", title="Profile rewrite: " + ("description" if "description" in changes else "") + (" and " if len(changes) > 1 else "") + (f"{len(add)} new service{'s' if len(add) != 1 else ''}" if add else ""),
                     impact="High", requires_approval=True, detail={"source": "autopilot", "changes": changes, "before": profile_state(b), "added_services": add}))
    db.commit()
    return {"made": 1, "note": None}


def apply_profile(db: Session, b: Business, changes: dict[str, Any]) -> list[str]:
    """Write an approved rewrite: to Google first when the profile is linked (if Google refuses, nothing is saved), then here. Returns the fields pushed to Google."""
    allowed = {k: v for k, v in changes.items() if k in ("description", "services")}
    if not allowed:
        raise AutopilotError("There is nothing to apply.")
    pushed: list[str] = []
    patch = gbp.fields_to_location(allowed, b)
    if linked(b):
        if "services" in allowed:
            primary = ((gbp.GbpClient(b.connection).location(b.gbp_location).get("categories") or {}).get("primaryCategory") or {}).get("name")
            if primary:
                patch |= gbp.service_items_body(allowed["services"] or [], primary)
        if patch:
            gbp.GbpClient(b.connection).update_location(b.gbp_location, patch)
            pushed = sorted(patch)
    for k, v in allowed.items():
        setattr(b, k, v)
    db.add(b)
    return pushed


# ------------------------------------------------------------------------------------------------------------------- photos
def _jpeg(data_url: str, name: str | None) -> tuple[bytes, dict[str, Any]]:
    from PIL import Image
    from . import featured_images as fi
    raw = fi.decode_upload(data_url)
    webp, info = fi.convert(raw, name)  # validates the type, size and pixels, and strips everything but the picture
    img = Image.open(io.BytesIO(webp)).convert("RGB")
    out = io.BytesIO()
    img.save(out, "JPEG", quality=88, optimize=True)
    return out.getvalue(), info


def photo_path(rel: str | None):
    from . import featured_images as fi
    p = (fi.UPLOAD_ROOT / (rel or "")).resolve()
    return p if fi.UPLOAD_ROOT.resolve() in p.parents and p.is_file() else None


def add_photos(db: Session, b: Business, files: list[dict[str, Any]]) -> dict[str, Any]:
    """Store the uploaded photos and give each the next free photo day. They wait for approval like everything else."""
    from . import featured_images as fi
    from ..routers.gbp_manage import MEDIA_CATEGORIES
    st = settings(b)
    waiting = _count_pending(db, b, "gbp_photo")
    if waiting + len(files) > MAX_PENDING_PHOTOS:
        raise AutopilotError(f"At most {MAX_PENDING_PHOTOS} photos can wait at once ({waiting} wait now). Approve or reject some first.")
    taken = {t.detail.get("publish_at") for t in db.scalars(select(AgentTask).where(AgentTask.business_id == b.id, AgentTask.kind == "gbp_photo", AgentTask.status.in_(("pending", "scheduled")))) if (t.detail or {}).get("publish_at")}
    days = st["photo_days"] or ["tue", "sat"]
    slots = _free_slots(b, days, st["photo_time"], len(files) + len(taken) + 2, taken, horizon=60)
    made, errors = [], []
    folder = fi.UPLOAD_ROOT / "autopilot" / str(int(b.id))
    folder.mkdir(parents=True, exist_ok=True)
    for f in files:
        name = str(f.get("name") or "photo")[:120]
        cat = str(f.get("category") or "ADDITIONAL").upper()
        if cat not in MEDIA_CATEGORIES:
            errors.append(f"{name}: the photo type must be one of {sorted(MEDIA_CATEGORIES)}.")
            continue
        try:
            data, info = _jpeg(str(f.get("data") or ""), name)
        except fi.ImageError as exc:
            errors.append(f"{name}: {exc}")
            continue
        digest = hashlib.sha256(data).hexdigest()[:24]
        if db.scalar(select(AgentTask.id).where(AgentTask.business_id == b.id, AgentTask.kind == "gbp_photo", AgentTask.status.in_(("pending", "scheduled")), AgentTask.detail["hash"].as_string() == digest)):
            errors.append(f"{name}: the same photo is already in the queue.")
            continue
        (folder / f"{digest}.jpg").write_bytes(data)
        slot = slots.pop(0) if slots else None
        t = AgentTask(business_id=b.id, agent="gbp", kind="gbp_photo", title=f"Photo: {name[:60]}", impact="Low", requires_approval=True,
                      detail={"source": "autopilot", "file": f"autopilot/{int(b.id)}/{digest}.jpg", "hash": digest, "category": cat, "name": name, "width": info.get("width"), "height": info.get("height"),
                              "publish_at": slot.isoformat() if slot else None})
        db.add(t)
        db.flush()  # so the next file of this batch sees it (a duplicate in the same upload is caught too)
        made.append(name)
    db.commit()
    return {"added": made, "errors": errors}


# ------------------------------------------------------------------------------------------------------------------- applying (called by agent.apply for approved items)
def apply_photo(db: Session, b: Business, task: AgentTask) -> dict[str, Any]:
    path = photo_path((task.detail or {}).get("file"))
    if path is None:
        raise AutopilotError("The photo file is missing on the server.")
    if not linked(b):
        raise AutopilotError("The Google profile is not linked.")
    created = gbp.GbpClient(b.connection).add_media(b.gbp_account, b.gbp_location, (task.detail or {}).get("category") or "ADDITIONAL", None, path.read_bytes(), "image/jpeg")
    b.photo_count = (b.photo_count or 0) + 1
    shown = created.get("googleUrl")
    cat = (task.detail or {}).get("category")
    if shown and cat == "COVER":
        b.cover_photo = shown
    elif shown and cat in ("PROFILE", "LOGO"):
        b.logo = shown
    return {"uploaded": True, "name": created.get("name")}


# ------------------------------------------------------------------------------------------------------------------- the decisions
def approve(db: Session, b: Business, task: AgentTask, user: str, publish_at: datetime | None = None, now: bool = False) -> AgentTask:
    """Approve ONE item. Posts and photos are scheduled for their time (or sent at once with `now`); replies and profile rewrites go out at once."""
    if task.business_id != b.id or task.kind not in GATED_KINDS:
        raise AutopilotError("This item cannot be approved here.")
    if task.status != "pending":
        raise AutopilotError(f"This item is already {task.status}.")
    when = datetime.now(timezone.utc)
    if task.kind in ("gbp_post", "gbp_photo"):
        if not linked(b):
            raise AutopilotError("Link the Google Business Profile first: nothing can be published without it.")
        slot = when if now else (publish_at or parse_when((task.detail or {}).get("publish_at")))
        if slot is None:
            raise AutopilotError("Choose a date and time for it, or press Publish now.")
        if not now and slot <= when + timedelta(minutes=2):
            raise AutopilotError("Choose a time in the future, or press Publish now.")
        task.detail = {**(task.detail or {}), "publish_at": slot.isoformat(), "approved_by": user, "approved_at": when.isoformat()}
        if task.kind == "gbp_post":
            p = db.get(Post, (task.detail or {}).get("post_id"))
            if p is None or p.business_id != b.id:
                raise AutopilotError("The post no longer exists.")
            p.approved_by, p.approved_at, p.scheduled_for = user, when, slot
            p.status = "scheduled"
            db.add(p)
        if now:
            agent.decide(db, task, True, user)
            return task
        task.status, task.decided_by, task.decided_at = "scheduled", user, when
        log(db, user, "autopilot_scheduled", b.id, task_id=task.id, kind=task.kind, at=slot.isoformat())
        db.commit()
        return task
    agent.decide(db, task, True, user)
    return task


def publish_due(db: Session, limit: int = 20) -> int:
    """Send what was approved for a time that has come. Refuses anything without an approval record, and anything for a profile that is no longer linked."""
    now = datetime.now(timezone.utc)
    n = 0
    for t in db.scalars(select(AgentTask).where(AgentTask.status == "scheduled", AgentTask.kind.in_(("gbp_post", "gbp_photo"))).order_by(AgentTask.id).limit(200)):
        d = t.detail or {}
        due = parse_when(d.get("publish_at"))
        if n >= limit:
            break
        if due is None or due > now:
            continue
        b = db.get(Business, t.business_id)
        if not d.get("approved_by") or not d.get("approved_at") or b is None:
            t.status, t.result = "failed", {"error": "No approval is recorded for this item, so it was not sent."}  # never publish on a guess
            continue
        if t.kind == "gbp_post":
            p = db.get(Post, d.get("post_id"))
            if p is None or p.approved_at is None:
                t.status, t.result = "failed", {"error": "The post has no approval record, so it was not sent."}
                continue
        if not linked(b):
            t.status, t.result = "failed", {"error": "The Google profile is no longer linked."}
            continue
        agent.apply(db, t, f"scheduled:{d.get('approved_by')}")
        n += 1
    db.commit()
    return n


# ------------------------------------------------------------------------------------------------------------------- the daily job
def run_job(db: Session, b: Business) -> dict[str, Any]:
    """Prepare drafts (only when Autopilot is on) and tell the owner what waits. Never publishes anything."""
    st = settings(b)
    out: dict[str, Any] = {}
    if not st["enabled"]:
        return {"skipped": "Autopilot is off"}
    out["posts"] = plan_posts(db, b)
    out["replies"] = draft_replies(db, b)
    out["profile"] = propose_profile(db, b)
    made = sum(int(v.get("made") or 0) for v in out.values() if isinstance(v, dict))
    if made:
        from ..models import Notification
        db.add(Notification(business_id=b.id, owner_id=b.owner_id, kind="autopilot", title=f"{made} new item{'s' if made != 1 else ''} wait for your approval",
                            body="Autopilot prepared posts, replies or profile changes. Nothing is published until you approve it.", link="/autopilot"))
    db.commit()
    return out
