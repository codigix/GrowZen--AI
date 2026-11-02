"""Everything editable on a client's Google Business Profile, written to Google from here: categories, address,
attributes, photos, live posts and review replies. Profile text, hours and services go through PATCH /businesses/{id}."""
import base64
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import get_business
from ..models import AgentTask, Business, Post, Review
from ..serialize import row
from ..services import agent, gbp
from ..services.activity import log

router = APIRouter(prefix="/businesses/{business_id}/gbp", tags=["gbp-manage"])

MEDIA_CATEGORIES = {"COVER", "PROFILE", "LOGO", "EXTERIOR", "INTERIOR", "PRODUCT", "AT_WORK", "FOOD_AND_DRINK", "MENU", "COMMON_AREA", "ROOMS", "TEAMS", "ADDITIONAL"}


def _client(b: Business) -> gbp.GbpClient:
    if not (b.connection and b.gbp_account and b.gbp_location):
        raise HTTPException(409, "This client is not linked to a Google Business Profile yet. Connect the Google account first.")
    return gbp.GbpClient(b.connection)


def _google(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except gbp.GbpError as exc:
        raise HTTPException(502, f"Google did not accept this: {exc}") from exc


def _refresh(b: Business, client: gbp.GbpClient) -> None:
    """Bring the saved copy in line with what Google now holds."""
    loc = _google(client.location, b.gbp_location)
    for k, v in gbp.location_to_fields(loc).items():
        if k not in ("gbp_status", "gbp_account", "gbp_location") and v not in (None, "", [], {}):
            setattr(b, k, v)


# Categories
@router.get("/categories")
def search_categories(q: str, b: Business = Depends(get_business)):
    if len(q.strip()) < 2:
        return []
    return _google(_client(b).search_categories, q.strip(), (b.country or "IN").upper())


class Category(BaseModel):
    name: str = Field(pattern=r"^categories/")
    displayName: str = ""


class CategoriesIn(BaseModel):
    primary: Category
    additional: list[Category] = Field(default_factory=list, max_length=9)


@router.put("/categories")
def set_categories(body: CategoriesIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    c = _client(b)
    _google(c.update_location, b.gbp_location, {"categories": {"primaryCategory": {"name": body.primary.name}, "additionalCategories": [{"name": x.name} for x in body.additional if x.name != body.primary.name]}})
    b.primary_category, b.secondary_categories = body.primary.displayName or b.primary_category, [x.displayName for x in body.additional if x.displayName]
    _refresh(b, c)
    log(db, user.name, "gbp_categories_updated", b.id)
    db.commit()
    return {"primary_category": b.primary_category, "secondary_categories": b.secondary_categories}


# Address
class AddressIn(BaseModel):
    address_lines: list[str] = Field(min_length=1, max_length=5)
    locality: str = ""
    postal_code: str = ""
    administrative_area: str = ""
    region_code: str = ""


@router.get("/address")
def get_address(b: Business = Depends(get_business)):
    a = _google(_client(b).location, b.gbp_location).get("storefrontAddress") or {}
    return {"address_lines": a.get("addressLines", []), "locality": a.get("locality", ""), "postal_code": a.get("postalCode", ""), "administrative_area": a.get("administrativeArea", ""), "region_code": a.get("regionCode", "")}


@router.put("/address")
def set_address(body: AddressIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    c = _client(b)
    cur = _google(c.location, b.gbp_location).get("storefrontAddress")
    try:
        new = gbp.address_body(cur, body.model_dump())
    except gbp.GbpError as exc:
        raise HTTPException(400, str(exc)) from exc
    _google(c.update_location, b.gbp_location, {"storefrontAddress": new})
    _refresh(b, c)
    log(db, user.name, "gbp_address_updated", b.id)
    db.commit()
    return {"address": b.address, "city": b.city}


# Attributes
@router.get("/attributes")
def attributes(b: Business = Depends(get_business)):
    c = _client(b)
    current = {a["name"].split("/")[-1]: a.get("values") for a in _google(c.attributes, b.gbp_location)}
    out = []
    for m in _google(c.available_attributes, b.gbp_location, (b.country or "IN").upper()):
        aid = (m.get("parent") or "").split("/")[-1]
        if not aid:
            continue
        out.append({"id": aid, "name": m.get("displayName", aid), "group": m.get("groupDisplayName", ""), "type": m.get("valueType"),
                    "options": [{"value": v.get("value"), "label": v.get("displayName")} for v in m.get("valueMetadata", [])] if m.get("valueType") == "ENUM" else [],
                    "value": (current.get(aid) or [None])[0] if aid in current else None, "deprecated": m.get("deprecated", False)})
    return [a for a in out if not a["deprecated"] and a["type"] in ("BOOL", "ENUM")]


class AttributesIn(BaseModel):
    values: dict[str, Any] = Field(min_length=1)


@router.put("/attributes")
def set_attributes(body: AttributesIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    _google(_client(b).set_attributes, b.gbp_location, body.values)
    log(db, user.name, "gbp_attributes_updated", b.id, count=len(body.values))
    db.commit()
    return {"updated": list(body.values)}


# Photos
class MediaIn(BaseModel):
    category: str = "ADDITIONAL"
    url: str | None = None
    data_base64: str | None = None
    content_type: str = "image/jpeg"


@router.post("/media", status_code=201)
def add_media(body: MediaIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    if body.category not in MEDIA_CATEGORIES:
        raise HTTPException(400, f"Category must be one of {sorted(MEDIA_CATEGORIES)}")
    data = None
    if body.data_base64:
        try:
            data = base64.b64decode(body.data_base64, validate=True)
        except ValueError as exc:
            raise HTTPException(400, "The photo could not be read.") from exc
        if len(data) > 25 * 1024 * 1024:
            raise HTTPException(413, "Photos must be under 25 MB.")
    created = _google(_client(b).add_media, b.gbp_account, b.gbp_location, body.category, body.url, data, body.content_type)
    shown = created.get("googleUrl") or body.url
    if shown and body.category == "COVER":
        b.cover_photo = shown
    elif shown and body.category in ("PROFILE", "LOGO"):
        b.logo = shown
    b.photo_count = (b.photo_count or 0) + 1
    log(db, user.name, "gbp_media_added", b.id, category=body.category)
    db.commit()
    return {"name": created.get("name"), "googleUrl": created.get("googleUrl")}


@router.delete("/media", status_code=204)
def delete_media(name: str, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    if not name.startswith(f"{b.gbp_account}/{b.gbp_location}/media/"):
        raise HTTPException(400, "That photo does not belong to this client's profile.")
    _google(_client(b).delete_media, name)
    b.photo_count = max(0, (b.photo_count or 1) - 1)
    log(db, user.name, "gbp_media_deleted", b.id)
    db.commit()


# Posts
def _post(db: Session, b: Business, post_id: int) -> Post:
    p = db.get(Post, post_id)
    if not p or p.business_id != b.id:
        raise HTTPException(404, "Post not found")
    return p


class PostEditIn(BaseModel):
    body: str = Field(min_length=1, max_length=1500)
    cta_type: str | None = None
    cta_url: str | None = None


@router.post("/posts/{post_id}/publish")
def publish_now(post_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Publish a waiting post to Google now, without waiting in the approval queue."""
    p = _post(db, b, post_id)
    _client(b)
    task = next((t for t in db.scalars(select(AgentTask).where(AgentTask.business_id == b.id, AgentTask.kind == "gbp_post", AgentTask.status == "pending")) if (t.detail or {}).get("post_id") == p.id), None)
    if not task:
        task = agent._task(db, b, "gbp", "gbp_post", f"Post: {p.body[:60]}…", "Medium", post_id=p.id, body=p.body)
        db.flush()
    agent.decide(db, task, True, user.name)
    db.refresh(p)
    if p.status != "published":
        raise HTTPException(502, f"Google did not publish the post: {(task.result or {}).get('error') or 'unknown error'}")
    return row(p)


@router.patch("/posts/{post_id}")
def edit_live_post(post_id: int, body: PostEditIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = _post(db, b, post_id)
    cta_type, cta_url = body.cta_type or p.cta_type, body.cta_url or p.cta_url
    if p.external_id:
        _google(_client(b).update_post, p.external_id, {"body": body.body, "cta_type": cta_type, "cta_url": cta_url})
    p.body, p.cta_type, p.cta_url = body.body, cta_type, cta_url
    log(db, user.name, "gbp_post_edited", b.id, post_id=p.id)
    db.commit()
    return row(p)


@router.delete("/posts/{post_id}", status_code=204)
def delete_live_post(post_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = _post(db, b, post_id)
    if p.external_id:
        _google(_client(b).delete_post, p.external_id)
    db.delete(p)
    log(db, user.name, "gbp_post_deleted", b.id, post_id=post_id)
    db.commit()


@router.delete("/live-post", status_code=204)
def delete_google_post(name: str, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Delete any post on the profile, including ones made outside this software."""
    if not name.startswith(f"{b.gbp_account}/{b.gbp_location}/localPosts/"):
        raise HTTPException(400, "That post does not belong to this client's profile.")
    _google(_client(b).delete_post, name)
    for p in db.scalars(select(Post).where(Post.business_id == b.id, Post.external_id == name)):
        db.delete(p)
    log(db, user.name, "gbp_post_deleted", b.id)
    db.commit()


# Review replies
@router.delete("/reviews/{review_id}/reply", status_code=204)
def delete_reply(review_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    r = db.get(Review, review_id)
    if not r or r.business_id != b.id:
        raise HTTPException(404, "Review not found")
    if r.external_id:
        _google(_client(b).delete_reply, b.gbp_account, b.gbp_location, r.external_id.split("/")[-1])
    r.reply_text, r.reply_status, r.replied_at = None, "none", None
    log(db, user.name, "gbp_reply_deleted", b.id, review_id=r.id)
    db.commit()
