"""The backlink workspace API: /businesses/{id}/backlink-hub/... (read from what the crawler stored; Moz figures only on request)."""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import current_user
from ..db import get_db
from ..deps import get_business
from ..models import Business
from . import hub, pitch, playbook

router = APIRouter(prefix="/businesses/{business_id}/backlink-hub", tags=["backlinks"], dependencies=[Depends(current_user)])


@router.get("/summary")
def summary(b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    return hub.summary(db, b)


@router.get("/links")
def links(b: Business = Depends(get_business), db: Session = Depends(get_db), status: str = Query("live", pattern="^(live|lost|all)$"), follow: str = Query("", pattern="^(|dofollow|nofollow|sponsored|ugc)$"),
          category: str = Query("", max_length=30), useful: str = Query("", pattern="^(|useful|neutral|risky|unscored)$"), q: str = Query("", max_length=200),
          sort: str = Query("recent", pattern="^(recent|domain|da)$"), limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0)) -> dict:
    return hub.links(db, b, status=status, follow=follow, category=category, useful=useful, q=q, sort=sort, limit=limit, offset=offset)


@router.get("/domains")
def domains(b: Business = Depends(get_business), db: Session = Depends(get_db), sort: str = Query("links", pattern="^(links|da|domain|risk|recent)$"), q: str = Query("", max_length=200),
            verdict: str = Query("", pattern="^(|useful|neutral|risky|unscored)$"), limit: int = Query(100, ge=1, le=300), offset: int = Query(0, ge=0)) -> dict:
    return hub.domains(db, b, sort=sort, q=q, verdict=verdict, limit=limit, offset=offset)


@router.get("/opportunities")
def opportunities(b: Business = Depends(get_business), db: Session = Depends(get_db), q: str = Query("", max_length=200), category: str = Query("", max_length=30), status: str = Query("", pattern="^(|new|planned|contacted|live|skipped)$"),
                  limit: int = Query(60, ge=1, le=200)) -> dict:
    return hub.opportunities(db, b, q=q, category=category, status=status, limit=limit)


@router.get("/audit")
def audit(b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    return hub.audit(db, b)


@router.post("/metrics/refresh")
def refresh_metrics(b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Ask Moz for DA, PA and spam score of this project's linking domains (and the best prospects) that have none yet."""
    me = hub.own_domain(db, b.id)
    names: list[str] = []
    if me:
        # every referring domain (not just the sites behind the 200 newest links: a few sitewide sites can fill those 200 and hide the rest)
        names = [x["domain"] for x in hub.domains(db, b, sort="links", limit=2000).get("domains", [])]
        names += [x["domain"] for x in hub.opportunities(db, b, limit=30).get("opportunities", [])]
    return hub.refresh_metrics(db, list(dict.fromkeys(names)))


class StatusIn(BaseModel):
    domain: str = Field(min_length=4, max_length=255)
    status: str = Field(pattern="^(planned|contacted|live|skipped)$")
    note: str | None = Field(default=None, max_length=500)
    source: str = Field(default="competitor", pattern="^(competitor|ai|manual)$")
    name: str | None = Field(default=None, max_length=160)


@router.get("/plan")
def plan(b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """The link-building plan: every place being worked on and how far along it is."""
    return playbook.plan(db, b)


@router.post("/plan")
def set_status(body: StatusIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    try:
        playbook.set_status(db, b, body.domain, body.status, body.note, body.source, body.name)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return playbook.plan(db, b)


class ContactsIn(BaseModel):
    domain: str = Field(min_length=4, max_length=255)


class SendIn(BaseModel):
    domain: str = Field(min_length=4, max_length=255)
    to: str = Field(min_length=5, max_length=255)
    subject: str = Field(min_length=3, max_length=200)
    body: str = Field(min_length=30, max_length=5000)
    name: str | None = Field(default=None, max_length=160)
    source: str = Field(default="competitor", pattern="^(competitor|ai|manual)$")


class RepliedIn(BaseModel):
    domain: str = Field(min_length=4, max_length=255)
    replied: bool = True


class DraftIn(BaseModel):
    domain: str = Field(min_length=4, max_length=255)
    url: str = Field(min_length=4, max_length=500)
    title: str = Field(default="", max_length=160)
    description: str = Field(default="", max_length=600)


class CheckIn(BaseModel):
    domain: str = Field(min_length=4, max_length=255)
    url: str = Field(min_length=8, max_length=600)


class GenIn(BaseModel):
    domain: str = Field(min_length=4, max_length=255)
    kind: str = Field(default="submit_link", pattern="^(submit_link|guest_post|listing|mention)$")
    url: str = Field(default="", max_length=500)
    title: str = Field(default="", max_length=160)
    description: str = Field(default="", max_length=600)
    about: str = Field(default="", max_length=400)  # what the platform says about itself (its page title or snippet)


class ManyIn(BaseModel):
    items: list[SendIn] = Field(min_length=1, max_length=10)


@router.post("/outreach/generate")
def outreach_generate(body: GenIn, b: Business = Depends(get_business)) -> dict:
    """Write the email for one platform from its purpose (post my link, guest post, listing, unlinked mention): AI when configured, a plain template otherwise."""
    return pitch.generate(b, body.domain, body.kind, body.url, body.title, body.description, body.about)


@router.post("/outreach/send-many")
def outreach_send_many(body: ManyIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Send the reviewed emails one after another; each result says whether it went out. A failure never stops the rest."""
    results = pitch.send_many(db, b, [x.model_dump() for x in body.items])
    return {"results": results, **playbook.plan(db, b)}


@router.post("/outreach/draft-submit")
def outreach_draft_submit(body: DraftIn, b: Business = Depends(get_business)) -> dict:
    """An email asking a platform to post our link for us: the link, a title and a short description they can copy."""
    return pitch.draft_submit(b, body.domain, body.url, body.title, body.description)


@router.post("/outreach/check-link")
def outreach_check_link(body: CheckIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Open the page where they posted it and see whether our link is really there, and whether it is followed."""
    try:
        res = pitch.check_published(db, b, body.domain, body.url)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"result": res, **playbook.plan(db, b)}


@router.post("/outreach/discover")
def outreach_discover(b: Business = Depends(get_business), db: Session = Depends(get_db), force: bool = Query(False)) -> dict:
    """Run the searches, collect the platforms they turn up and read each one's public contact addresses."""
    return pitch.discover(db, b, force)


@router.get("/outreach/search-ideas")
def outreach_search_ideas(b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Google searches that find sites that take guest posts, list businesses or mention you without a link."""
    return pitch.search_ideas(db, b)


@router.post("/outreach/contacts")
def outreach_contacts(body: ContactsIn, b: Business = Depends(get_business)) -> dict:
    """The public email addresses a website publishes (its contact and about pages)."""
    try:
        return pitch.find_contacts(body.domain)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/outreach/send")
def outreach_send(body: SendIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Send the reviewed pitch email and record it against the place in the plan."""
    try:
        pitch.send(db, b, body.domain, body.to, body.subject, body.body, body.name, body.source)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return playbook.plan(db, b)


@router.post("/outreach/replied")
def outreach_replied(body: RepliedIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    try:
        pitch.mark_replied(db, b, body.domain, body.replied)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return playbook.plan(db, b)


class AdviceIn(BaseModel):
    domain: str = Field(min_length=4, max_length=255)
    refresh: bool = False


@router.post("/advice")
def advice(body: AdviceIn, b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """What a link from this site would give the business and how to get it (AI when set up, plain rules otherwise)."""
    return playbook.advice(db, b, body.domain, body.refresh)


@router.post("/platforms/suggest")
def suggest_platforms(b: Business = Depends(get_business), db: Session = Depends(get_db)) -> dict:
    """Websites where this kind of business could earn a link, suggested by AI (not tied to competitors)."""
    return playbook.suggest_platforms(db, b)
