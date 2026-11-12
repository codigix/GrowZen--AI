"""Listing management (citations): the business's NAP, every listing site with its state, and manual listing links that can be checked.

GET    /businesses/{id}/citations/overview
PUT    /businesses/{id}/citations/listings/{key}          {url?, status?, note?}
POST   /businesses/{id}/citations/listings/{key}/verify   open the saved link and compare it with the profile
DELETE /businesses/{id}/citations/listings/{key}
"""
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import get_business
from ..models import Business
from ..services import audits, citation_sites as sites
from ..services.activity import log
from ..services.url_safety import validate_url_shape

router = APIRouter(prefix="/businesses/{business_id}/citations", tags=["citations"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _nap(b: Business) -> dict[str, Any]:
    return {"name": b.name, "address": b.address, "phone": b.phone, "website": b.website}


@router.get("/overview")
def overview(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    audit = audits.latest(db, b).get("citations")
    auto = {sites.key_of(r.get("directory")): r for r in ((audit.result or {}).get("directories") if audit else None) or []}
    manual: dict[str, dict[str, Any]] = b.citation_listings or {}
    rows: list[dict[str, Any]] = []
    for d in sites.catalog_for(b.country, list(auto.values())):
        key = d["key"]
        a, m = auto.get(key), manual.get(key)
        row = {**d, "kind_label": sites.KINDS.get(d["kind"], "Directory"), "status": "missing", "source": None, "url": None, "found": None, "note": None, "checked_at": None, "managed": False,
               "confidence": "unchecked", "evidence": "Not checked yet."}
        if key == "google":
            linked = bool(b.gbp_location)
            row |= {"managed": True, "source": "app", "confidence": "verified" if linked else "unchecked", "evidence": "Read from Google through the Business Profile API." if linked else "Not linked to Google.", "status": "listed" if linked else "missing", "url": (b.gbp_status or {}).get("maps_url"),
                    "found": _nap(b) if linked else None, "note": "Managed in this software: edit it under GBP Optimization." if linked else "Create or connect the Google Business Profile first."}
        else:
            if a:
                found_in_search = a.get("status") != "missing"
                row |= {"status": a.get("status", "missing"), "source": "auto", "url": a.get("url"), "found": a.get("found"), "checked_at": audit.finished_at.isoformat() if audit and audit.finished_at else None,
                        "confidence": "search" if found_in_search else "not_found",
                        "evidence": "Matched from a Google search result (title and snippet). Press Check on the listing page to confirm." if found_in_search else "Google search did not return this listing. It may still exist: add its link and press Check."}
            if m:  # a person's entry wins over the automatic search
                verified = bool(m.get("verified_url")) and m.get("verified_url") == m.get("url")
                row |= {"source": "manual", "url": m.get("url") or row["url"], "note": m.get("note"), "checked_at": m.get("checked_at") or row["checked_at"],
                        "confidence": "verified" if verified else "self_reported",
                        "evidence": "We opened the listing page and compared its name and phone with the profile." if verified else "Entered by a person; not checked against the page yet. Press Check."}
                if m.get("status") in sites.STATUSES:
                    row["status"] = m["status"]
                if m.get("found"):
                    row["found"] = m["found"]
        rows.append(row)
    listed = sum(1 for r in rows if r["status"] == "listed")
    verified = sum(1 for r in rows if r["status"] == "listed" and r["confidence"] == "verified")
    return {
        "nap": _nap(b),
        "directories": rows,
        "summary": {"total": len(rows), "listed": listed, "verified": verified, "inconsistent": sum(1 for r in rows if r["status"] == "inconsistent"),
                    "missing": sum(1 for r in rows if r["status"] == "missing"), "pending": sum(1 for r in rows if r["status"] == "pending"),
                    "score": round(listed / len(rows) * 100) if rows else 0},
        "finished_at": audit.finished_at.isoformat() if audit and audit.finished_at else None,
        "data_source": audit.data_source if audit else None,
    }


def _key(b: Business, key: str) -> str:
    if key == "google":
        raise HTTPException(400, "The Google Business Profile is managed under GBP Optimization.")
    if not re.fullmatch(r"[a-z0-9]{2,40}", key or ""):
        raise HTTPException(404, "Unknown listing site")
    return key


class ListingIn(BaseModel):
    url: str | None = Field(default=None, max_length=500)
    status: str | None = None
    note: str | None = Field(default=None, max_length=300)


def _save(db: Session, b: Business, key: str, entry: dict[str, Any] | None) -> None:
    data = dict(b.citation_listings or {})
    if entry is None:
        data.pop(key, None)
    else:
        data[key] = entry
    b.citation_listings = data  # a new dict, so the JSON change is noticed


@router.put("/listings/{key}")
def set_listing(key: str, body: ListingIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    key = _key(b, key)
    entry = dict((b.citation_listings or {}).get(key) or {})
    if body.url is not None:
        url = body.url.strip()
        if url:
            if not re.match(r"^https?://", url, re.I):
                raise HTTPException(422, "Enter the full link of the listing, starting with https://")
            try:
                validate_url_shape(url)
            except Exception as exc:  # noqa: BLE001 - the shape check raises its own readable error
                raise HTTPException(422, str(exc)) from exc
        entry["url"] = url or None
        if url != (entry.get("verified_url") or ""):
            entry.pop("found", None)
    if body.status is not None:
        if body.status not in ("listed", "pending", "missing", "inconsistent"):
            raise HTTPException(422, "Status must be listed, pending, missing or inconsistent.")
        entry["status"] = body.status
    if body.note is not None:
        entry["note"] = body.note.strip() or None
    entry["checked_at"] = _now()
    _save(db, b, key, entry)
    log(db, user.name, "citation_updated", b.id, site=key)
    db.commit()
    return {"ok": True}


@router.post("/listings/{key}/verify")
def verify_listing(key: str, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    key = _key(b, key)
    entry = dict((b.citation_listings or {}).get(key) or {})
    url = entry.get("url")
    if not url:
        raise HTTPException(422, "Add the link of the listing first.")
    try:
        result = sites.check_listing(b, url)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - network errors and blocked addresses both mean "could not open it"
        raise HTTPException(502, f"Could not open that page: {str(exc)[:160]}") from exc
    entry |= {"status": result["status"], "found": result["found"], "note": result["note"], "checked_at": _now(), "verified_url": url}
    _save(db, b, key, entry)
    log(db, user.name, "citation_verified", b.id, site=key, status=result["status"])
    db.commit()
    return {"status": result["status"], "found": result["found"], "note": result["note"]}


@router.delete("/listings/{key}", status_code=204)
def remove_listing(key: str, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    key = _key(b, key)
    _save(db, b, key, None)
    db.commit()
