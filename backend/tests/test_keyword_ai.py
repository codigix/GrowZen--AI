"""AI keyword suggestions grounded in the business's real activity, saved with where each is for, and the usage view (offline: the AI is faked)."""
import pytest

from app.db import SessionLocal
from app.models import Article, Business, GeoPrompt, Keyword, Post
from app.services import ai, keyword_ai


@pytest.fixture
def project(client):
    r = client.post("/api/v1/businesses", json={"name": "Smile Care", "primary_category": "Dentist", "city": "Pune", "area": "Baner", "website": "https://smile.example",
                                                "services": [{"name": "Dental implants"}, {"name": "Teeth whitening"}]})
    return r.json()["id"]


def test_without_ai_the_page_is_told_so_not_given_made_up_keywords(client, project, monkeypatch):
    monkeypatch.setattr(ai, "is_configured", lambda: False)
    r = client.post(f"/api/v1/businesses/{project}/keywords/ai-suggestions")
    assert r.status_code == 503 and "AI is not set up" in r.json()["detail"]


def test_suggestions_use_real_facts_and_never_repeat_what_is_saved(client, project, monkeypatch):
    seen = {}
    monkeypatch.setattr(ai, "is_configured", lambda: True)

    def fake(system, user, **kw):
        seen["user"] = user
        return {"items": [
            {"keyword": "Dental implants cost in Baner?", "topic": "Implants", "why": "You offer implants and have no article on the cost.", "intent": "commercial", "uses": ["blog", "aeo", "bogus"], "priority": "High", "horizon": "done"},
            {"keyword": "teeth whitening pune", "topic": "Whitening", "why": "already saved", "uses": ["blog"], "horizon": "done"},          # already saved: dropped
            {"keyword": "x", "topic": "bad", "why": "too short"},                                                                                     # not a search phrase: dropped
            {"keyword": "invisible braces for adults", "topic": "Braces", "why": "A natural next service.", "uses": [], "priority": "weird", "horizon": "next"}]}

    monkeypatch.setattr(ai, "complete_json", fake)
    client.post(f"/api/v1/businesses/{project}/keywords", json=[{"keyword": "teeth whitening pune", "tracked": True}])
    db = SessionLocal()
    db.add(Post(business_id=project, body="Free dental check-up camp this Sunday", status="published", post_type="Update"))
    db.add(Article(business_id=project, keyword="root canal pain", title="Does a root canal hurt?", status="completed"))
    db.commit()
    db.close()
    d = client.post(f"/api/v1/businesses/{project}/keywords/ai-suggestions").json()
    assert "Free dental check-up camp" in seen["user"] and "Does a root canal hurt?" in seen["user"] and "teeth whitening pune" in seen["user"]  # the past activity is what the AI is given
    items = {i["keyword"]: i for i in d["items"]}
    assert set(items) == {"dental implants cost in baner", "invisible braces for adults"}
    assert items["dental implants cost in baner"]["uses"] == ["blog", "aeo"] and items["dental implants cost in baner"]["priority"] == "High"  # unknown areas are dropped
    assert items["invisible braces for adults"]["uses"] == ["blog"] and items["invisible braces for adults"]["priority"] == "Medium" and items["invisible braces for adults"]["horizon"] == "next"
    assert d["evidence"]["posts"] == 1 and d["evidence"]["articles"] == 1 and d["evidence"]["saved"] == 1


def test_saved_with_where_to_use_then_the_usage_view_and_the_ai_question(client, project):
    r = client.post(f"/api/v1/businesses/{project}/keywords", json=[{"keyword": "dental implants cost in baner", "cluster": "Implants", "uses": ["blog", "geo", "aeo"]}])
    assert r.status_code == 201
    kws = client.get(f"/api/v1/businesses/{project}/keywords").json()["keywords"]
    assert kws[0]["uses"] == ["blog", "geo", "aeo"] and kws[0]["cluster"] == "Implants"
    assert client.post(f"/api/v1/businesses/{project}/keywords", json=[{"keyword": "x y", "uses": ["nonsense"]}]).status_code == 422  # an unknown area is refused
    u = client.get(f"/api/v1/businesses/{project}/keywords/usage").json()
    assert u["total"] == 1 and u["areas"]["blog"]["planned"] == 1 and u["items"][0]["used"]["blog"] is False and u["items"][0]["used"]["chatgpt"] is None  # never guessed
    g = client.post(f"/api/v1/businesses/{project}/keywords/{kws[0]['id']}/geo-prompt").json()
    assert g == {"prompt": "What is the dental implants cost in baner?", "added": True}
    assert client.post(f"/api/v1/businesses/{project}/keywords/{kws[0]['id']}/geo-prompt").json()["added"] is False  # asked once
    db = SessionLocal()
    assert db.query(GeoPrompt).filter_by(business_id=project).count() == 1
    assert client.get(f"/api/v1/businesses/{project}/keywords/usage").json()["items"][0]["used"]["geo"] is True
    db.close()
    assert client.post(f"/api/v1/businesses/{project}/keywords/987654/geo-prompt").status_code == 404


def test_question_keywords_stay_questions():
    assert keyword_ai.geo_question("how much do braces cost") == "How much do braces cost?"
    assert keyword_ai.geo_question("best dentist in pune") == "Which is the best dentist in pune?"
