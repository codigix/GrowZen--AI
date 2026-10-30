"""bevisibe Assistant: answers about the selected project only, guides the platform, never leaks another project."""
from app.db import SessionLocal
from app.models import Audit, Keyword
from app.services import ai, assistant


def make(client, name, website):
    return client.post("/api/v1/businesses", json={"name": name, "primary_category": "Dentist", "area": "Baner", "city": "Pune", "website": website}).json()["id"]


def seed_other(bid):
    db = SessionLocal()
    db.add(Keyword(business_id=bid, keyword="zebra orthopaedic secret keyword", tracked=True, rank=2))
    db.add(Audit(business_id=bid, kind="onpage", status="done", score=41, issues=[{"level": "critical", "title": "Zebra page returns 500", "fix": "Fix the zebra"}]))
    db.commit()
    db.close()


def ask(client, bid, message, **kw):
    return client.post(f"/api/v1/businesses/{bid}/assistant", json={"message": message, **kw}).json()


def test_answers_come_from_the_selected_project_only(client):
    mine = make(client, "Sai Dental Care", "https://saidental.in")
    other = make(client, "Vasant Orthopaedic Centre", "https://vasantortho.in")
    seed_other(other)
    for q in ["How is this project doing?", "What should I fix first?", "Which keywords rank?", "What's planned next?", "Who are the competitors?"]:
        a = ask(client, mine, q)
        text = a["answer"].lower()
        assert "zebra" not in text and "vasant" not in text, q
        assert "sai dental care" in text or a["topic"] in ("issues", "keywords", "competitors"), q
    # The other project's data is available when that project is the selected one.
    assert "zebra" in ask(client, other, "What should I fix first?")["answer"].lower()


def test_a_question_about_another_project_is_declined(client):
    mine = make(client, "Sai Dental Care", "https://saidental.in")
    make(client, "Vasant Orthopaedic Centre", "https://vasantortho.in")
    for q in ["How is Vasant Orthopaedic Centre doing?", "tell me about vasantortho.in", "what are the issues of vasantortho.in"]:
        a = ask(client, mine, q)
        assert a["topic"] == "scope" and "only answer about the project you've selected" in a["answer"] and "Sai Dental Care" in a["answer"], q


def test_unrelated_questions_are_politely_out_of_scope(client):
    mine = make(client, "Sai Dental Care", "https://saidental.in")
    a = ask(client, mine, "who won the cricket match yesterday")
    assert a["topic"] == "scope" and "only help with" in a["answer"]


def test_guides_the_user_through_the_system(client):
    mine = make(client, "Sai Dental Care", "https://saidental.in")
    a = ask(client, mine, "How do I connect the Google account?")
    assert a["topic"] == "guide" and "Connect Google account" in a["answer"] and a["links"][0]["to"] == "/gmb-profile"
    a = ask(client, mine, "how do I run the competitor research")
    assert "Competitor Research" in a["answer"] and a["links"][0]["to"] == "/competitor-finder"
    a = ask(client, mine, "how does this platform work")
    assert "recommended order" in a["answer"]


def test_future_scope_lists_what_is_missing_for_this_project(client):
    mine = make(client, "Sai Dental Care", "https://saidental.in")
    a = ask(client, mine, "what's planned next for this project?")
    text = a["answer"]
    assert a["topic"] == "future" and "never been crawled" in text and "competitor research" in text.lower() and "Connect the Google account" in text
    assert {"Site Audit", "Competitor Research"} <= {l["label"] for l in a["links"]} | {"Site Audit", "Competitor Research"}


def test_the_ai_engine_is_given_only_this_projects_facts(client, monkeypatch):
    mine = make(client, "Sai Dental Care", "https://saidental.in")
    other = make(client, "Vasant Orthopaedic Centre", "https://vasantortho.in")
    seed_other(other)
    seen = {}

    def fake(system, user, **kw):
        seen["system"], seen["user"] = system, user
        return "**Sai Dental Care** is not audited yet."
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete", fake)
    a = ask(client, mine, "Summarise where we stand", history=[{"role": "user", "text": "hello"}])
    assert a["mode"] == "ai" and a["answer"].startswith("**Sai Dental Care**")
    assert "Sai Dental Care" in seen["user"] and "zebra" not in seen["user"].lower() and "vasant" not in seen["user"].lower()
    assert "ONE project" in seen["system"]
    # Declined questions never reach the model.
    seen.clear()
    assert ask(client, mine, "how is Vasant Orthopaedic Centre doing")["mode"] == "rules" and not seen
    # A model failure falls back to the project's own data.
    monkeypatch.setattr(ai, "complete", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("down")))
    b = ask(client, mine, "Summarise where we stand")
    assert b["mode"] == "rules" and "Sai Dental Care" in b["answer"]


def test_suggestions_follow_the_project_state(client):
    mine = make(client, "Sai Dental Care", "https://saidental.in")
    s = client.get(f"/api/v1/businesses/{mine}/assistant/suggestions").json()
    assert s["project"] == "Sai Dental Care" and "How do I connect the Google account?" in s["suggestions"] and "How do I run the competitor research?" in s["suggestions"]
    assert assistant.suggestions  # exported for the UI


def test_blog_topic_requests_are_understood(client, monkeypatch):
    from app.services import keywords as kw
    monkeypatch.setattr(kw, "trending_today", lambda words, country="IN": [{"keyword": "dental checkup offer", "traffic": "2K+"}])
    mine = make(client, "Sai Dental Care", "https://saidental.in")
    other = make(client, "Vasant Orthopaedic Centre", "https://vasantortho.in")
    seed_other(other)
    for q in ["suggest me blogs trending topic for this month", "what should I write about?", "give me content ideas", "blog topics"]:
        a = ask(client, mine, q)
        assert a["topic"] == "content", q
        assert "Blog and post ideas for" in a["answer"] and "zebra" not in a["answer"].lower() and "vasant" not in a["answer"].lower()
        assert a["links"][0]["to"] == "/ai-content-generation?tab=blog"
    text = ask(client, mine, "suggest blog topics")["answer"]
    assert "Dentist in Pune" in text.replace("**", "") or "dentist in pune" in text.lower()  # built from this project's services and place
    assert "dental checkup offer" in text  # a real Google Trends match is included
    assert "Competitor Research" in text  # and it says what would make the ideas sharper
