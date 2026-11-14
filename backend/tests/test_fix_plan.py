"""A fix plan per area: the tasks with what each is worth, the score, and a re-check that raises the score once a fix is real."""
from datetime import date

import pytest

from app.db import SessionLocal
from app.models import Business, GrowthAction, PageXRayRun
from app.services import growth_metrics

URL = "https://planco.example/"


def report(title_ok: bool, desc_ok: bool) -> dict:
    checks = [{"key": "title", "label": "Title", "passed": title_ok, "weight": 10, "detail": "x", "fix": "Write a title."},
              {"key": "description", "label": "Description", "passed": desc_ok, "weight": 8, "detail": "x", "fix": "Write one."},
              {"key": "https", "label": "HTTPS", "passed": True, "weight": 2, "detail": "x", "fix": ""}]
    got = sum(c["weight"] for c in checks if c["passed"])
    return {"url": URL, "scores": {"seo": {"score": round(got / 20 * 100), "passed": sum(1 for c in checks if c["passed"]), "total": 3, "checks": checks}, "aeo": {"score": 0, "passed": 0, "total": 0, "checks": []}, "geo": {"score": 0, "passed": 0, "total": 0, "checks": []}},
            "fetched_at": "2026-11-14T10:00:00"}


def save(db, bid, rep):
    db.add(PageXRayRun(business_id=bid, url=URL, report=rep, seo_score=rep["scores"]["seo"]["score"]))
    db.commit()


@pytest.fixture()
def biz(client):
    bid = client.post("/api/v1/businesses", json={"name": "Plan Co", "website": URL}).json()["id"]
    db = SessionLocal()
    save(db, bid, report(False, False))
    for key, sev in (("title", "serious"), ("description", "warning")):
        db.add(GrowthAction(business_id=bid, area="seo", key=f"fix.xray.{key}", period="fix", due_on=date.today(), title=f"Fix the {key}", est_minutes=10, mode="manual", link="/page-xray",
                            verify={"type": "xray_check", "key": key, "area": "seo", "url": URL}, status="todo", evidence={"severity": sev, "source": "page_xray"}))
    db.add(GrowthAction(business_id=bid, area="gmb", key="fix.gmb.x", period="fix", due_on=date.today(), title="Add a phone number", est_minutes=5, mode="manual", link="/gmb-profile/profile",
                        verify={"type": "field", "field": "phone"}, status="todo", evidence={"severity": "warning", "source": "profile"}))
    db.commit()
    yield bid
    db.close()


def test_the_plan_lists_the_areas_tasks_with_their_real_worth(client, biz):
    d = client.get(f"/api/v1/businesses/{biz}/fix-plan/seo").json()
    assert d["scored"] and d["score"]["now"] == 10 and d["score"]["checks_total"] == 3
    pts = {i["key"]: i["points"] for i in d["open"]}
    assert pts == {"fix.xray.title": 50.0, "fix.xray.description": 40.0} and d["potential"] == 90.0 and d["score"]["potential"] == 100
    assert [i["severity"] for i in d["open"]] == ["serious", "warning"] and d["open_total"] == 2
    g = client.get(f"/api/v1/businesses/{biz}/fix-plan/gmb").json()
    assert g["scored"] is False and g["score"] is None and [i["title"] for i in g["open"]] == ["Add a phone number"] and g["open"][0]["points"] is None
    assert client.get(f"/api/v1/businesses/{biz}/fix-plan/nothing").status_code == 404


def test_checking_the_fixes_closes_passing_tasks_and_raises_the_score(client, biz, monkeypatch):
    def fresh(db, b):  # the site was fixed: the title now passes
        rep = report(True, False)
        db.add(PageXRayRun(business_id=b.id, url=URL, report=rep, seo_score=rep["scores"]["seo"]["score"]))
        db.commit()
        return rep, None
    monkeypatch.setattr(growth_metrics, "_fresh_xray", fresh)
    d = client.post(f"/api/v1/businesses/{biz}/fix-plan/seo/check").json()
    assert d["result"] == {"before": 10, "after": 60, "delta": 50, "closed": 1, "still_open": 1}
    assert [i["key"] for i in d["closed"]] == ["fix.xray.title"] and d["gained"] == 50.0 and [i["key"] for i in d["open"]] == ["fix.xray.description"]
    assert d["potential"] == 40.0 and len(d["history"]) == 2  # the scan history shows the score moving
    assert [h["score"] for h in d["history"]][-1] == 60


def test_an_unreachable_site_is_said_plainly(client, biz, monkeypatch):
    monkeypatch.setattr(growth_metrics, "_fresh_xray", lambda db, b: (None, "The website could not be read: timeout"))
    r = client.post(f"/api/v1/businesses/{biz}/fix-plan/seo/check")
    assert r.status_code == 422 and "could not be read" in r.json()["detail"]
