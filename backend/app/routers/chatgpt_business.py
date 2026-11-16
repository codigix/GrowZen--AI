"""Your business, in ChatGPT (Business Hub): where each project's claim stands, the copy to paste in, a hosted product/service feed, JSON-LD and Business Agent guidelines.

OpenAI's Business Hub has no public write API: a person claims and verifies the business there. This module is the place to keep the facts and the text.

GET/PUT /businesses/{id}/chatgpt                    the record (profile, claim and verification, agent, insights, feed address, readiness)
GET/POST /businesses/{id}/chatgpt/catalog           the feed's products and services (POST upserts by SKU)
DELETE   /businesses/{id}/chatgpt/catalog/{sku}
POST     /businesses/{id}/chatgpt/catalog/from-services
GET      /businesses/{id}/chatgpt/jsonld            Organization / LocalBusiness structured data
GET      /businesses/{id}/chatgpt/agent-guidelines  a starter for the Business Agent's rules
POST/DELETE /businesses/{id}/chatgpt/insights[/{month}]   monthly numbers read off the Hub
GET      /chatgpt/overview                          every project the user may see
GET      /public/feeds/chatgpt/{token}.json|.csv    the hosted feed (public; the token is the key)
"""
import json
import re
import time
from collections import defaultdict, deque
from datetime import date, datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import get_business, only_mine
from ..models import Business, CatalogItem, ChatGPTBusiness
from ..services import chatgpt_business as svc, ratelimit
from ..services.activity import log

router = APIRouter(prefix="/businesses/{business_id}/chatgpt", tags=["chatgpt-business"])
overview_router = APIRouter(prefix="/chatgpt", tags=["chatgpt-business"])
public_router = APIRouter(prefix="/public/feeds/chatgpt", tags=["chatgpt-feed"])
alias_router = APIRouter(prefix="/chatgpt-business/public/feed", tags=["chatgpt-feed"])  # the CSV feed at its second address

_hits = ratelimit.Hits("chatgpt_feed")  # ip -> feed requests, shared by every server process
FEED_LIMIT, FEED_WINDOW = 120, 3600


def _row(db: Session, b: Business) -> ChatGPTBusiness | None:
    return db.scalar(select(ChatGPTBusiness).where(ChatGPTBusiness.business_id == b.id))


def _items(db: Session, b: Business) -> list[CatalogItem]:
    return list(db.scalars(select(CatalogItem).where(CatalogItem.business_id == b.id).order_by(CatalogItem.sku)))


def _iso(d: datetime | None) -> str | None:
    return d.isoformat() if d else None


def payload(db: Session, b: Business) -> dict[str, Any]:
    row, items = _row(db, b), _items(db, b)
    updated = max((i.updated_at for i in items if i.updated_at), default=None)
    return {
        "claim": {"status": row.claim_status if row else "Unclaimed", "verification_method": row.verification_method if row else None, "dns_txt_record": (row.dns_txt_record if row else None) or "",
                  "persona_verified": bool(row and row.persona_verified), "history": list((row.status_history if row else None) or []), "updated_at": _iso(row.updated_at) if row else None},
        "profile": svc.profile_of(row), "defaults": svc.profile_defaults(b),
        "agent": {"is_enabled": bool(row and row.agent_enabled), "instructions": (row.agent_instructions if row else None) or ""},
        "insights": svc.insights_out(row),
        "feed": {**svc.feed_urls(b.id), "items": len(items), "updated_at": _iso(updated)},
        "readiness": svc.readiness(b, row, items),
        "limits": {"description_max": svc.DESCRIPTION_MAX, "catalog_max": svc.CATALOG_MAX, "instructions_max": svc.INSTRUCTIONS_MAX},
    }


@router.get("")
def get_record(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return payload(db, b)  # no row is created by reading


# ---------- update
class ProfileIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    business_name: str | None = None
    category: str | None = None
    description: str | None = None
    website_url: str | None = None
    logo_url: str | None = None
    delivery_policy: str | None = None
    return_policy: str | None = None


class AgentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    is_enabled: bool | None = None
    instructions: str | None = None


class UpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    claim_status: Literal["Unclaimed", "Claim_Pending", "Claim_Approved", "Disputed"] | None = None
    verification_method: Literal["DNS_TXT", "Shopify", "Business_Email", "Business_Phone"] | None = None
    dns_txt_record: str | None = None
    persona_verified: bool | None = None
    profile: ProfileIn | None = None
    agent: AgentIn | None = None


def _bad(msg: str) -> HTTPException:
    return HTTPException(422, msg)


def _text(value: str | None, field: str, limit: int) -> str | None:
    v = (value or "").strip()
    if len(v) > limit:
        raise _bad(f"{field} can be {limit} characters at most (it is {len(v)}).")
    return v or None


@router.put("")
def update(body: UpdateIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    sent = body.model_fields_set
    row = _row(db, b)
    changed: list[str] = []
    if row is None:
        row = ChatGPTBusiness(business_id=b.id, claim_status="Unclaimed", persona_verified=False, status_history=[], agent_enabled=False, insights=[])
        db.add(row)
    if "claim_status" in sent and body.claim_status is None:
        raise _bad("claim_status cannot be empty.")
    if "claim_status" in sent and body.claim_status != row.claim_status:
        row.status_history = [*(row.status_history or []), {"at": datetime.now(timezone.utc).isoformat(), "from": row.claim_status, "to": body.claim_status, "by": user.name}]
        row.claim_status = body.claim_status
        changed.append("claim_status")
    if "verification_method" in sent:
        row.verification_method = body.verification_method
        changed.append("verification_method")
    if "dns_txt_record" in sent:
        v = (body.dns_txt_record or "").strip()
        if len(v) > 500:
            raise _bad("The DNS TXT record can be 500 characters at most.")
        if re.search(r"[\r\n\x00-\x08\x0b\x0c\x0e-\x1f]", v):
            raise _bad("The DNS TXT record must be one line of text.")
        row.dns_txt_record = v or None
        changed.append("dns_txt_record")
    if body.profile is not None:
        p, ps = body.profile, body.profile.model_fields_set
        try:
            if "business_name" in ps:
                row.business_name = _text(p.business_name, "Business name", 255)
            if "category" in ps:
                row.category = _text(p.category, "Category", 160)
            if "description" in ps:
                row.description = _text(p.description, "Description", svc.DESCRIPTION_MAX)
            if "website_url" in ps:
                row.website_url = svc.clean_url(p.website_url, "Website")
            if "logo_url" in ps:
                row.logo_url = svc.clean_url(p.logo_url, "Logo")
            if "delivery_policy" in ps:
                row.delivery_policy = _text(p.delivery_policy, "Delivery policy", svc.POLICY_MAX)
            if "return_policy" in ps:
                row.return_policy = _text(p.return_policy, "Return policy", svc.POLICY_MAX)
        except ValueError as exc:
            raise _bad(str(exc)) from exc
        changed += [f"profile.{k}" for k in ps]
    if body.agent is not None:
        a, as_ = body.agent, body.agent.model_fields_set
        if "is_enabled" in as_:
            row.agent_enabled = bool(a.is_enabled)
        if "instructions" in as_:
            row.agent_instructions = _text(a.instructions, "Agent instructions", svc.INSTRUCTIONS_MAX)
        changed += [f"agent.{k}" for k in as_]
    if "persona_verified" in sent:
        if body.persona_verified and row.claim_status != "Claim_Approved":
            raise _bad("Persona verification follows an approved claim. Set the claim to Claim_Approved first.")
        row.persona_verified = bool(body.persona_verified)
        changed.append("persona_verified")
    elif row.persona_verified and row.claim_status != "Claim_Approved":
        row.persona_verified = False  # the claim moved back: the identity check no longer stands
    log(db, user.name, "chatgpt_business_updated", b.id, fields=changed)
    db.commit()
    return payload(db, b)


# ---------- catalog
class CatalogIn(BaseModel):
    items: list[Any] = Field(max_length=svc.BATCH_MAX)  # a row that is not an object is reported on its own, it does not reject the upload


def _upsert(db: Session, b: Business, rows: list[dict[str, Any]], overwrite: bool = True) -> dict[str, Any]:
    existing = {i.sku: i for i in _items(db, b)}
    seen: set[str] = set()
    added = updated = skipped = 0
    errors: list[dict[str, Any]] = []
    for n, raw in enumerate(rows, start=1):
        sku = str((raw or {}).get("sku") or "").strip() if isinstance(raw, dict) else ""
        try:
            clean = svc.clean_item(raw)
            if clean["sku"] in seen:
                raise ValueError("This SKU appears twice in the same upload.")
            seen.add(clean["sku"])
            cur = existing.get(clean["sku"])
            if cur is None and len(existing) >= svc.CATALOG_MAX:
                raise ValueError(f"The feed already has the maximum of {svc.CATALOG_MAX} items.")
            if cur is not None and not overwrite:
                skipped += 1
                continue
        except ValueError as exc:
            errors.append({"row": n, "sku": sku, "error": str(exc)})
            continue
        if cur is None:
            cur = CatalogItem(business_id=b.id, sku=clean["sku"])
            db.add(cur)
            existing[clean["sku"]] = cur
            added += 1
        else:
            updated += 1
        for k, v in clean.items():
            setattr(cur, k, v)
    db.flush()
    return {"added": added, "updated": updated, "skipped": skipped, "errors": errors, "total": len(existing)}


@router.get("/catalog")
def list_catalog(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    items = _items(db, b)
    return {"items": [svc.item_out(i) for i in items], "total": len(items)}


@router.post("/catalog")
def save_catalog(body: CatalogIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    out = _upsert(db, b, body.items)
    log(db, user.name, "chatgpt_catalog_saved", b.id, added=out["added"], updated=out["updated"], errors=len(out["errors"]))
    db.commit()
    return out


@router.delete("/catalog/{sku}")
def delete_item(sku: str, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = db.scalar(select(CatalogItem).where(CatalogItem.business_id == b.id, CatalogItem.sku == sku))
    if not item:
        raise HTTPException(404, "Item not found")
    db.delete(item)
    log(db, user.name, "chatgpt_catalog_item_deleted", b.id, sku=sku)
    db.commit()
    return {"ok": True, "total": db.scalar(select(func.count(CatalogItem.id)).where(CatalogItem.business_id == b.id)) or 0}


@router.post("/catalog/from-services")
def from_services(b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows, cannot = svc.items_from_services(b)
    out = _upsert(db, b, rows, overwrite=False)  # a SKU already in the feed is left as the person edited it
    out["errors"] = [*cannot, *out["errors"]]
    log(db, user.name, "chatgpt_catalog_from_services", b.id, added=out["added"], skipped=out["skipped"], errors=len(out["errors"]))
    db.commit()
    return out


# ---------- structured data and agent
@router.get("/jsonld")
def get_jsonld(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    data, warnings = svc.jsonld(b, _row(db, b), _items(db, b))
    return {"jsonld": data, "text": json.dumps(data, indent=2, ensure_ascii=False), "warnings": warnings}


@router.get("/agent-guidelines")
def get_guidelines(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return {"text": svc.agent_guidelines(b, _row(db, b), _items(db, b))}


# ---------- insights logged from the Hub
class InsightIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    month: str
    mentions: int = Field(ge=0, le=100_000_000)
    website_clicks: int = Field(ge=0, le=100_000_000)
    topics: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("topics")
    @classmethod
    def _topics(cls, v: list[str]) -> list[str]:
        out = list(dict.fromkeys(" ".join(str(t).split()) for t in v if str(t).strip()))
        if any(len(t) > 80 for t in out):
            raise ValueError("Each topic can be 80 characters at most.")
        return out


def _ensure(db: Session, b: Business) -> ChatGPTBusiness:
    row = _row(db, b)
    if row is None:
        row = ChatGPTBusiness(business_id=b.id, claim_status="Unclaimed", persona_verified=False, status_history=[], agent_enabled=False, insights=[])
        db.add(row)
    return row


@router.post("/insights")
def save_insight(body: InsightIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    if not svc.MONTH.match(body.month):
        raise _bad("Month must look like 2026-11.")
    if body.month > date.today().strftime("%Y-%m"):
        raise _bad("That month has not happened yet.")
    row = _ensure(db, b)
    kept = [i for i in (row.insights or []) if i.get("month") != body.month]
    row.insights = [*kept, {"month": body.month, "mentions": body.mentions, "website_clicks": body.website_clicks, "topics": body.topics}]
    log(db, user.name, "chatgpt_insights_saved", b.id, month=body.month)
    db.commit()
    return {"insights": svc.insights_out(row)}


@router.delete("/insights/{month}")
def delete_insight(month: str, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = _row(db, b)
    if not row or not any(i.get("month") == month for i in (row.insights or [])):
        raise HTTPException(404, "No insights for that month")
    row.insights = [i for i in row.insights if i.get("month") != month]
    db.commit()
    return {"insights": svc.insights_out(row)}


# ---------- every project
@overview_router.get("/overview")
def overview(db: Session = Depends(get_db), user: User = Depends(current_user)):
    businesses = list(db.scalars(only_mine(select(Business), user).order_by(Business.name).limit(500)))
    ids = [b.id for b in businesses]
    rows = {r.business_id: r for r in db.scalars(select(ChatGPTBusiness).where(ChatGPTBusiness.business_id.in_(ids)))} if ids else {}
    items: dict[int, list[CatalogItem]] = defaultdict(list)
    for i in (db.scalars(select(CatalogItem).where(CatalogItem.business_id.in_(ids)).order_by(CatalogItem.sku)) if ids else []):
        items[i.business_id].append(i)
    out = []
    for b in businesses:
        r = rows.get(b.id)
        out.append({"business_id": b.id, "name": b.name, "claim_status": r.claim_status if r else "Unclaimed", "verification_method": r.verification_method if r else None,
                    "persona_verified": bool(r and r.persona_verified), "items": len(items[b.id]), "readiness_score": svc.readiness(b, r, items[b.id])["score"], "updated_at": _iso(r.updated_at) if r else None})
    return out


# ---------- the hosted feed (public)
@public_router.get("/{name}")
def hosted_feed(name: str, request: Request, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else "?"
    if not _hits.hit(ip, FEED_LIMIT, FEED_WINDOW):
        raise HTTPException(429, "Too many requests. Try again later.")
    m = re.fullmatch(r"(?P<token>[0-9]+-[0-9a-f]{16})\.(?P<ext>json|csv)", name or "")
    bid = svc.business_id_of(m.group("token")) if m else None
    b = db.get(Business, bid) if bid else None
    if not m or not b:
        raise HTTPException(404, "Feed not found")  # the same answer for a wrong token, a wrong id and a wrong file name
    items = _items(db, b)
    headers = {"Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff"}
    if m.group("ext") == "json":
        return JSONResponse(svc.feed_json(b, items), headers=headers)
    return Response(svc.feed_csv(items), media_type="text/csv; charset=utf-8", headers={**headers, "Content-Disposition": 'inline; filename="chatgpt-feed.csv"'})


@alias_router.get("/{name}")
def hosted_feed_csv(name: str, request: Request, db: Session = Depends(get_db)):
    """The same feed, same signed token, same headers and the same rate limit, at /chatgpt-business/public/feed/<token>.csv (CSV only)."""
    if not (name or "").endswith(".csv"):
        raise HTTPException(404, "Feed not found")
    return hosted_feed(name, request, db)
