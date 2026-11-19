"""The article's web address: the slug follows the primary keyword unless set, is cleaned, never clashes, and never moves a page that is already live."""
import pytest

from app.models import Article
from app.services import articles as svc


@pytest.fixture()
def bid(client):
    return client.post("/api/v1/businesses", json={"name": "Slug Co", "website": "https://slug.example/"}).json()["id"]


def _article(bid, keyword="teeth whitening pune", **kw):
    from app.db import SessionLocal
    db = SessionLocal()
    try:
        a = Article(business_id=bid, keyword=keyword, title="A very different title", status="completed", body="<h1>x</h1><p>text</p>", **kw)
        db.add(a)
        db.commit()
        return a.id
    finally:
        db.close()


def api(bid, aid=None, path=""):
    return f"/api/v1/businesses/{bid}/articles" + (f"/{aid}" if aid else "") + path


def test_slugify_cleans_and_cuts_at_a_whole_word():
    assert svc.slugify("Teeth Whitening in Pune!") == "teeth-whitening-in-pune"
    assert svc.slugify("  --Dental   Implants & Crowns-- ") == "dental-implants-crowns"
    assert svc.slugify("!!!") == "" and svc.slugify(None) == ""
    long = svc.slugify("word " * 40, 30)
    assert len(long) <= 30 and not long.endswith("-") and long.split("-")[-1] == "word"


def test_the_address_follows_the_primary_keyword_unless_set_and_a_live_page_is_left_alone():
    new = Article(keyword="teeth whitening pune", title="Something else entirely")
    assert svc.explicit_slug(new) == "teeth-whitening-pune" and svc.publish_slug(new) == "teeth-whitening-pune"
    custom = Article(keyword="teeth whitening pune", title="T", slug="whitening-cost-pune")
    assert svc.explicit_slug(custom) == "whitening-cost-pune"
    live = Article(keyword="teeth whitening pune", title="Teeth Whitening in Pune", wp_post_id="12", wp_url="https://slug.example/teeth-whitening-in-pune/")
    assert svc.explicit_slug(live) is None  # nothing is sent: re-publishing must not move it
    assert svc.publish_slug(live) == "teeth-whitening-in-pune"  # file or webhook publishers keep the old rule for it
    live.slug = "teeth-whitening-pune"
    assert svc.explicit_slug(live) == "teeth-whitening-pune"  # unless the person chose to move it


def test_saving_a_slug_cleans_it_and_empty_goes_back_to_the_keyword(client, bid):
    aid = _article(bid)
    r = client.patch(api(bid, aid), json={"slug": "Whitening Cost -- Pune!!"})
    assert r.status_code == 200 and r.json()["slug"] == "whitening-cost-pune"
    assert client.patch(api(bid, aid), json={"slug": ""}).json()["slug"] is None
    assert client.patch(api(bid, aid), json={"title": "New title"}).json()["slug"] is None  # other edits do not touch it


def test_two_articles_cannot_end_their_address_the_same_way(client, bid):
    a1, a2 = _article(bid, "first keyword"), _article(bid, "second keyword")
    assert client.patch(api(bid, a1), json={"slug": "same-words"}).status_code == 200
    clash = client.patch(api(bid, a2), json={"slug": "Same Words"})
    assert clash.status_code == 409 and "same-words" in clash.json()["detail"]
    assert client.patch(api(bid, a1), json={"slug": "same-words"}).status_code == 200  # an article can keep its own


def test_the_schema_url_uses_the_slug(client, bid):
    aid = _article(bid)
    client.patch(api(bid, aid), json={"slug": "my-own-words", "title": "Whatever"})
    body = client.get(api(bid, aid)).json()["body"]
    assert "https://slug.example/blog/my-own-words" in body
    client.patch(api(bid, aid), json={"slug": ""})
    assert "https://slug.example/blog/teeth-whitening-pune" in client.get(api(bid, aid)).json()["body"]


def test_the_address_base_is_the_blog_folder_until_posts_are_published(client, bid):
    r = client.get(api(bid, path="/url-base")).json()
    assert r == {"base": "https://slug.example/blog/", "trailing_slash": True, "learned": False}
    from app.db import SessionLocal
    db = SessionLocal()
    try:
        for i, u in enumerate(["https://slug.example/insights/one/", "https://slug.example/insights/two/"]):
            db.add(Article(business_id=bid, keyword=f"k{i}", title="t", status="completed", wp_status="publish", wp_url=u))
        db.commit()
    finally:
        db.close()
    r = client.get(api(bid, path="/url-base")).json()
    assert r == {"base": "https://slug.example/insights/", "trailing_slash": True, "learned": True}  # learned from the posts that are live
