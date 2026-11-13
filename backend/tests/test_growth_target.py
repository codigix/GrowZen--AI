"""Every fix task says exactly where the change is made: which page(s), which part, how to get there, and what not to touch."""
from datetime import datetime, timezone

import pytest

from app.db import SessionLocal
from app.models import Audit, Business, GrowthAction
from app.services import growth_target


@pytest.fixture
def project(client):
    return client.post("/api/v1/businesses", json={"name": "Where Co", "website": "https://where.example", "city": "Pune"}).json()["id"]


def task(db, project, key, link="/website-audit", why="", verify=None):
    a = GrowthAction(business_id=project, period="fix", key=key, area="seo", title=key, why=why, link=link, status="todo", due_on=datetime.now(timezone.utc).date(), verify=verify or {}, evidence={})
    db.add(a)
    db.flush()
    return a


def test_each_kind_of_fix_names_its_place(project):
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        db.add(Audit(business_id=project, kind="onpage", status="done", data_source="live", result={}, finished_at=datetime.now(timezone.utc), issues=[
            {"code": "duplicate_titles", "level": "warning", "title": "2 duplicate page titles", "pages": ["https://where.example/", "https://where.example/about"]},
            {"code": "h1_count", "level": "warning", "title": "/contact has 3 H1 headings"}]))
        db.flush()
        t = growth_target.target_for(db, b, task(db, project, "fix.onpage.duplicate_titles"))
        assert t["scope"] == "pages" and [p["path"] for p in t["pages"]] == ["/", "/about"] and "<title>" in t["place"] and t["pages"][0]["label"] == "Homepage"
        t = growth_target.target_for(db, b, task(db, project, "fix.onpage.h1_count"))
        assert t["scope"] == "page" and t["pages"][0]["url"] == "https://where.example/contact" and "exactly one H1" in t["place"]   # the page the audit named, not the homepage
        t = growth_target.target_for(db, b, task(db, project, "fix.xray.org_schema", link="/page-xray?url=https%3A%2F%2Fwhere.example%2Fabout"))
        assert t["pages"][0]["url"] == "https://where.example/about" and "JSON-LD" in t["place"] and "<head>" in t["place"]
        t = growth_target.target_for(db, b, task(db, project, "fix.security.hsts"))
        assert t["scope"] == "server" and "web server" in t["headline"] and "every page" in t["headline"]
        t = growth_target.target_for(db, b, task(db, project, "fix.xray.llms_txt"))
        assert t["scope"] == "file" and t["pages"][0]["url"] == "https://where.example/llms.txt"
        t = growth_target.target_for(db, b, task(db, project, "fix.gbp.photos", link="/media-management"))
        assert t["scope"] == "profile" and t["pages"] == [] and "not on the website" in t["headline"]
        t = growth_target.target_for(db, b, task(db, project, "fix.kw.few", link="/keyword-management/ai"))
        assert t["scope"] == "app" and "inside this software" in t["headline"].lower()
        t = growth_target.target_for(db, b, task(db, project, "fix.site.meta.title", why="Titles are missing or too long. Pages: /pricing, /faq"))
        assert [p["path"] for p in t["pages"]] == ["/pricing", "/faq"]
    finally:
        db.rollback()
        db.close()


def test_an_old_saved_solution_gets_its_place_when_the_fix_page_opens(client, project):
    db = SessionLocal()
    a = task(db, project, "fix.xray.title", link="/page-xray?url=https%3A%2F%2Fwhere.example%2F")
    a.evidence = {"solution": {"title": "old", "steps": [], "blocks": []}}
    db.commit()
    aid = a.id
    db.close()
    r = client.get(f"/api/v1/businesses/{project}/growth/actions/{aid}").json()
    assert r["solution"]["target"]["pages"][0]["url"] == "https://where.example/" and "<title>" in r["solution"]["target"]["place"]
