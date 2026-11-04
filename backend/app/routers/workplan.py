"""Website research, weekly work plans and weekly/monthly reports for every project."""
import io
from datetime import date
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import User, current_user
from ..db import get_db
from ..deps import get_business, in_background
from ..models import Business, SiteProfile, WeeklyReport, WorkItem
from ..serialize import row
from ..services import site_research, workplan
from ..services.activity import log

router = APIRouter(tags=["workplan"])
Status = Literal["todo", "doing", "done", "skipped", "backlog"]
Area = Literal["gmb", "seo", "technical", "metadata", "content", "backlinks", "rankings", "reviews", "other"]


class ItemIn(BaseModel):
    title: str = Field(min_length=3, max_length=500)
    area: Area = "other"
    week: date | None = None
    priority: int = Field(default=3, ge=1, le=4)
    assignee: str | None = Field(default=None, max_length=120)
    due_date: date | None = None
    how: str = Field(default="", max_length=2000)


class ItemPatch(BaseModel):
    status: Status | None = None
    title: str | None = Field(default=None, min_length=3, max_length=500)
    area: Area | None = None
    priority: int | None = Field(default=None, ge=1, le=4)
    assignee: str | None = Field(default=None, max_length=120)
    due_date: date | None = None
    note: str | None = Field(default=None, max_length=2000)


def _item(db: Session, b: Business, item_id: int) -> WorkItem:
    it = db.get(WorkItem, item_id)
    if not it or it.business_id != b.id:
        raise HTTPException(404, "Task not found")
    return it


# Website research ----------------------------------------------------------------------------------------------------------------------------------
def _research_job(db: Session, business_id: int) -> None:
    b = db.get(Business, business_id)
    if b:
        site_research.run(db, b, refresh=True)
        workplan.generate_week(db, b)


@router.get("/businesses/{business_id}/research")
def get_research(b: Business = Depends(get_business), db: Session = Depends(get_db)):
    prof = site_research.get(db, b)
    return row(prof) if prof else {"status": "none", "business_id": b.id}


@router.post("/businesses/{business_id}/research", status_code=202)
def run_research(background: BackgroundTasks, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    prof = site_research.get(db, b)
    if prof and prof.status == "running":
        return {"status": "running"}
    if not prof:
        db.add(SiteProfile(business_id=b.id, status="queued"))
    else:
        prof.status = "queued"
    log(db, user.name, "site_research_started", b.id)
    db.commit()
    background.add_task(in_background(_research_job, b.id))
    return {"status": "queued"}


# Weekly plan -------------------------------------------------------------------------------------------------------------------------------------
@router.get("/workplan/overview")
def all_projects(week: date | None = None, db: Session = Depends(get_db), _: User = Depends(current_user)):
    wk = workplan.week_start(week)
    return {"week_start": wk.isoformat(), "projects": workplan.overview(db, wk)}


@router.get("/businesses/{business_id}/workplan")
def get_plan(week: date | None = None, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    wk = workplan.week_start(week)
    items = workplan.week_items(db, b, wk)
    backlog = list(db.scalars(select(WorkItem).where(WorkItem.business_id == b.id, WorkItem.status == "backlog", WorkItem.week_start != wk).order_by(WorkItem.priority, WorkItem.id).limit(100)))
    return {"week_start": wk.isoformat(), "current_week": workplan.week_start().isoformat(), "progress": workplan.progress(items),
            "items": [workplan.serialize(i) for i in items], "backlog_elsewhere": [workplan.serialize(i) for i in backlog]}


@router.post("/businesses/{business_id}/workplan/generate")
def generate_plan(week: date | None = None, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    log(db, user.name, "week_plan_requested", b.id)
    return workplan.generate_week(db, b, week)


@router.post("/businesses/{business_id}/workplan/items", status_code=201)
def add_task(body: ItemIn, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    it = workplan.add_item(db, b, body.week or date.today(), body.title, body.area, user.name, priority=body.priority, assignee=body.assignee, due_date=body.due_date, how=body.how)
    return workplan.serialize(it)


@router.patch("/businesses/{business_id}/workplan/items/{item_id}")
def update_task(item_id: int, body: ItemPatch, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    return workplan.serialize(workplan.update_item(db, _item(db, b, item_id), body.model_dump(exclude_unset=True), user.name))


@router.delete("/businesses/{business_id}/workplan/items/{item_id}", status_code=204)
def delete_task(item_id: int, b: Business = Depends(get_business), db: Session = Depends(get_db), user: User = Depends(current_user)):
    it = _item(db, b, item_id)
    if it.source != "manual":
        raise HTTPException(400, "Only tasks added by hand can be deleted; skip this one instead and it will not come back.")
    log(db, user.name, "work_item_deleted", b.id, title=it.title)
    db.delete(it)
    db.commit()


# Reports -----------------------------------------------------------------------------------------------------------------------------------------
@router.get("/businesses/{business_id}/reports/history")
def report_history(period: Literal["week", "month"] = "week", limit: int = 26, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    q = select(WeeklyReport).where(WeeklyReport.business_id == b.id, WeeklyReport.period == period).order_by(WeeklyReport.period_start.desc()).limit(min(limit, 120))
    return [{"id": r.id, "start": r.period_start.isoformat(), "end": r.period_end.isoformat(), "final": r.final, "highlights": (r.data or {}).get("highlights", []),
             "completion_pct": (r.data or {}).get("this_period", {}).get("completion_pct")} for r in db.scalars(q)]


def _pdf(d: dict) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    from xml.sax.saxutils import escape
    st = getSampleStyleSheet()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title=f"{d['business']['name']} {d['label']}")
    tp, pv = d["this_period"], d["previous"]
    pct = lambda v: f"{v}%" if v is not None else "-"  # noqa: E731
    story = [Paragraph(escape(f"{d['business']['name']}: {d['label']}"), st["Title"]), Paragraph(escape(d.get("narrative") or ""), st["BodyText"]), Spacer(1, 10)]
    t = Table([["", "Planned", "Done", "Completion"], [pv["label"], pv["planned"], pv["done"], pct(pv["completion_pct"])], [d["label"], tp["planned"], tp["done"], pct(tp["completion_pct"])]], colWidths=[190, 80, 80, 90])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2a78d6")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e1e0d9"))]))
    story += [t, Spacer(1, 10)]

    def section(title: str, lines: list[str]) -> None:
        if lines:
            story.append(Paragraph(escape(title), st["Heading2"]))
            story.extend(Paragraph("• " + escape(x), st["BodyText"]) for x in lines)

    section("Previous period: finished", [i["title"] for i in pv["completed"][:15]])
    section("Previous period: not finished", [f"{i['title']} ({i['status']})" for i in pv["not_finished"][:15]])
    section("Done in this period", [i["title"] + (" (confirmed by audit)" if i["verified"] else "") for i in tp["completed"][:30]])
    section("Still open", [i["title"] for i in tp["in_progress"][:20]])
    section("What changed", d["highlights"])
    section("Next", [i["title"] for i in d["next"]["planned"][:15]])
    for g in d["future_scope"]:
        section(f"Future scope: {g['horizon']}", [i["title"] for i in g["items"][:10]])
    doc.build(story)
    return buf.getvalue()


@router.get("/businesses/{business_id}/reports/{period}")
def get_report(period: Literal["week", "month"], start: date | None = None, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    return workplan.build_report(db, b, period, start)


@router.get("/businesses/{business_id}/reports/{period}/pdf")
def report_pdf(period: Literal["week", "month"], start: date | None = None, b: Business = Depends(get_business), db: Session = Depends(get_db)):
    d = workplan.build_report(db, b, period, start)
    return Response(_pdf(d), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{b.id}-{period}-{d["start"]}.pdf"'})
