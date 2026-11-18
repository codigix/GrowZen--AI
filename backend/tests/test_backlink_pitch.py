"""Pitching a website for a backlink: public contact addresses only, a reviewed email sent on request, the send recorded and followed up."""
import pytest

from app.backlinks import pitch
from app.services import notify

BODY = "Hello,\n\nI run Hub Clinic and think our guide would help your readers. Would you consider linking to it?\n\nThanks"


@pytest.fixture()
def bid(client):
    return client.post("/api/v1/businesses", json={"name": "Hub Clinic", "website": "https://www.hub-clinic.in/", "contact_email": "owner@hub-clinic.in"}).json()["id"]


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
