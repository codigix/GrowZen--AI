"""Pitching a website for a backlink: public contact addresses only, a reviewed email sent on request, the send recorded and followed up."""
import pytest

from app.backlinks import pitch
from app.services import notify

BODY = "Hello,\n\nI run Hub Clinic and think our guide would help your readers. Would you consider linking to it?\n\nThanks"


@pytest.fixture()
def bid(client):
    return client.post("/api/v1/businesses", json={"name": "Hub Clinic", "website": "https://www.hub-clinic.in/", "contact_email": "owner@hub-clinic.in"}).json()["id"]


def _set_topic(bid):
    from app.db import SessionLocal
    from app.models import Business
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        b.primary_category, b.city = "Dental clinic", "Pune"
        db.commit()
    finally:
        db.close()


def test_contacts_come_only_from_what_the_site_publishes(client, bid, monkeypatch):
    page = '<a href="mailto:Editor@news-site.in?subject=hi">mail</a> write to info@news-site.in or logo@2x.png or x@sentry.io'

    class R:
        status_code, headers, content, url, text = 200, {"content-type": "text/html"}, page.encode(), "https://news-site.in/contact", page

    class C:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def get(self, url): return R()

    monkeypatch.setattr(pitch.httpx, "Client", C)
    r = client.post(f"/api/v1/businesses/{bid}/backlink-hub/outreach/contacts", json={"domain": "news-site.in"})
    assert r.status_code == 200
    emails = [c["email"] for c in r.json()["contacts"]]
    assert emails == ["editor@news-site.in", "info@news-site.in"]  # the editor first; no image names, no tracking addresses
    assert client.post(f"/api/v1/businesses/{bid}/backlink-hub/outreach/contacts", json={"domain": "not a domain"}).status_code == 422


def test_send_records_the_email_and_marks_the_place_contacted(client, bid, monkeypatch):
    sent = []
    monkeypatch.setattr(notify, "send_email", lambda to, subject, body, **kw: sent.append((to, subject, kw)) or True)
    url = f"/api/v1/businesses/{bid}/backlink-hub/outreach/send"
    # unfinished placeholders and bad addresses are refused, nothing goes out
    assert client.post(url, json={"domain": "news-site.in", "to": "editor@news-site.in", "subject": "Link", "body": BODY + " [add name]"}).status_code == 422
    assert client.post(url, json={"domain": "news-site.in", "to": "nope", "subject": "Link", "body": BODY}).status_code == 422
    assert not sent
    r = client.post(url, json={"domain": "news-site.in", "to": "Editor@News-Site.in", "subject": "Link request", "body": BODY})
    assert r.status_code == 200
    item = next(x for x in r.json()["items"] if x["domain"] == "news-site.in")
    assert item["status"] == "contacted" and item["contact_email"] == "editor@news-site.in" and item["email_count"] == 1 and item["emailed_at"]
    assert sent[0][0] == "editor@news-site.in" and sent[0][2]["reply_to"] == "owner@hub-clinic.in"
    # the same message to the same address twice in a minute is refused (a double click)
    assert client.post(url, json={"domain": "news-site.in", "to": "editor@news-site.in", "subject": "Link request", "body": BODY}).status_code == 422
    rep = client.post(f"/api/v1/businesses/{bid}/backlink-hub/outreach/replied", json={"domain": "news-site.in"})
    assert next(x for x in rep.json()["items"] if x["domain"] == "news-site.in")["replied_at"]


def test_send_says_so_when_mail_is_not_set_up(client, bid, monkeypatch):
    monkeypatch.setattr(notify, "send_email", lambda *a, **k: False)
    r = client.post(f"/api/v1/businesses/{bid}/backlink-hub/outreach/send", json={"domain": "news-site.in", "to": "editor@news-site.in", "subject": "Link request", "body": BODY})
    assert r.status_code == 422 and "SMTP" in r.json()["detail"]


def test_search_ideas_are_written_from_the_business_and_a_site_can_be_added_by_hand(client, bid):
    client.put(f"/api/v1/businesses/{bid}", json={"primary_category": "Dental clinic", "city": "Pune"})
    r = client.get(f"/api/v1/businesses/{bid}/backlink-hub/outreach/search-ideas")
    assert r.status_code == 200
    d = r.json()
    if d["state"] == "ok":
        qs = [x["q"] for g in d["groups"] for x in g["queries"]]
        assert any("write for us" in x for x in qs) and any("-site:hub-clinic.in" in x for x in qs)
        assert all(x["url"].startswith("https://www.google.com/search?q=") for g in d["groups"] for x in g["queries"])
    add = client.post(f"/api/v1/businesses/{bid}/backlink-hub/plan", json={"domain": "pune-bloggers.in", "status": "planned", "source": "manual", "name": "Pune Bloggers"})
    assert add.status_code == 200 and next(x for x in add.json()["items"] if x["domain"] == "pune-bloggers.in")["source"] == "manual"


def _fake_page(monkeypatch, html, status=200):
    class R:
        status_code, text = status, html

    class C:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def get(self, url): return R()

    monkeypatch.setattr(pitch.httpx, "Client", C)


def test_submit_draft_carries_the_link_and_the_posted_link_is_checked(client, bid, monkeypatch):
    base = f"/api/v1/businesses/{bid}/backlink-hub"
    d = client.post(f"{base}/outreach/draft-submit", json={"domain": "links-hub.in", "url": "https://hub-clinic.in/guide", "title": "Hub Clinic guide"}).json()
    assert "https://hub-clinic.in/guide" in d["body"] and "[add" not in d["body"] and d["subject"].startswith("Request to feature")
    client.post(f"{base}/plan", json={"domain": "links-hub.in", "status": "contacted", "source": "manual"})
    # the page is not on the platform: refused; the page without our link: not found, not live
    assert client.post(f"{base}/outreach/check-link", json={"domain": "links-hub.in", "url": "https://other.com/post"}).status_code == 422
    _fake_page(monkeypatch, '<a href="https://example.org">x</a>')
    r = client.post(f"{base}/outreach/check-link", json={"domain": "links-hub.in", "url": "https://links-hub.in/p/1"}).json()
    assert r["result"]["found"] is False
    assert next(x for x in r["items"] if x["domain"] == "links-hub.in")["status"] == "contacted"
    # with our link (nofollow): found, live, and said to be not followed
    _fake_page(monkeypatch, '<p><a rel="nofollow" href="https://www.hub-clinic.in/guide"> Hub Clinic </a></p>')
    r = client.post(f"{base}/outreach/check-link", json={"domain": "links-hub.in", "url": "https://links-hub.in/p/1"}).json()
    assert r["result"]["found"] and r["result"]["followed"] is False and r["result"]["anchor"] == "Hub Clinic"
    item = next(x for x in r["items"] if x["domain"] == "links-hub.in")
    assert item["status"] == "live" and item["link_found"] and item["published_url"] == "https://links-hub.in/p/1"


def test_discover_finds_platforms_and_their_published_emails(client, bid, monkeypatch):
    from app.config import get_settings
    url = f"/api/v1/businesses/{bid}/backlink-hub/outreach/discover"
    monkeypatch.setattr(get_settings(), "serper_api_key", "")
    assert client.post(url).json()["state"] == "no_search"  # no search key: says how to set it up, invents nothing
    monkeypatch.setattr(get_settings(), "serper_api_key", "k")
    _set_topic(bid)
    pitch._CACHE.clear()
    results = [{"link": "https://www.smile-blog.in/write-for-us", "title": "Write for us", "snippet": "s"}, {"link": "https://www.facebook.com/x", "title": "fb"}, {"link": "https://hub-clinic.in/", "title": "me"},
               {"link": "https://pune-links.org/submit", "title": "Submit your link", "snippet": "t"}]
    monkeypatch.setattr(pitch, "_serper", lambda q, country: results)
    monkeypatch.setattr(pitch, "find_contacts", lambda d: {"contacts": [{"email": f"editor@{d}", "page": f"https://{d}/contact", "how": "mailto link"}] if d == "smile-blog.in" else [], "pages_read": 2})
    d = client.post(url).json()
    names = [p["domain"] for p in d["platforms"]]
    assert "facebook.com" not in names and "hub-clinic.in" not in names  # big social sites and our own site are never suggested
    assert names[0] == "smile-blog.in" and d["platforms"][0]["emails"][0]["email"] == "editor@smile-blog.in"  # a platform with an email comes first
    assert "pune-links.org" in names


def test_generate_writes_each_purpose_with_the_link_and_send_many_survives_a_failure(client, bid, monkeypatch):
    base = f"/api/v1/businesses/{bid}/backlink-hub"
    for kind in ("submit_link", "guest_post", "listing", "mention"):
        d = client.post(f"{base}/outreach/generate", json={"domain": "links-hub.in", "kind": kind, "url": "https://hub-clinic.in/guide"}).json()
        assert "https://hub-clinic.in/guide" in d["body"] and "[add" not in d["body"] and d["subject"], kind
    monkeypatch.setattr(__import__("time"), "sleep", lambda s: None)
    sent = []
    monkeypatch.setattr(notify, "send_email", lambda to, subject, body, **kw: sent.append(to) or True)
    items = [{"domain": "a-site.in", "to": "ed@a-site.in", "subject": "Hello", "body": BODY}, {"domain": "b-site.in", "to": "not-an-email", "subject": "Hello", "body": BODY},
             {"domain": "c-site.in", "to": "ed@c-site.in", "subject": "Hello", "body": BODY}]
    r = client.post(f"{base}/outreach/send-many", json={"items": items}).json()
    assert [x["ok"] for x in r["results"]] == [True, False, True] and sent == ["ed@a-site.in", "ed@c-site.in"]
    assert client.post(f"{base}/outreach/send-many", json={"items": items * 4}).status_code == 422  # at most ten at once


def test_daily_limit_stops_a_burst(client, bid, monkeypatch):
    monkeypatch.setattr(notify, "send_email", lambda *a, **k: True)
    monkeypatch.setattr(pitch, "DAILY_LIMIT", 2)
    url = f"/api/v1/businesses/{bid}/backlink-hub/outreach/send"
    codes = [client.post(url, json={"domain": f"s{i}-site.in", "to": f"ed@s{i}-site.in", "subject": "Hello", "body": BODY}).status_code for i in range(3)]
    assert codes == [200, 200, 422]
