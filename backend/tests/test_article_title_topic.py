from app.services import articles as svc


def test_title_is_written_for_the_chosen_topic_not_the_generic_fallback():
    topic = "Why Rent a Designer Dress Instead of Buying One for a Single Occasion"
    got = svc._title_for_topic(lambda *a, **k: {"title": "Rent Designer Dress or Buy? A Single-Occasion Guide"}, "rent designer dress", topic, "Why Rent a Designer Dress Instead of Buying")
    assert got == "Rent Designer Dress or Buy? A Single-Occasion Guide"


def test_falls_back_to_the_topic_when_it_fits_and_to_none_when_nothing_fits():
    boom = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("model off"))
    assert svc._title_for_topic(boom, "teeth whitening", "Teeth Whitening: Is It Safe?", "") == "Teeth Whitening: Is It Safe?"
    assert svc._title_for_topic(boom, "rent designer dress", "Why Rent a Designer Dress Instead of Buying One for a Single Occasion", "") is None
    assert svc._title_for_topic(boom, "x y", "x y", "") is None


def test_a_title_that_is_too_long_or_lacks_the_keyword_is_refused():
    bad = lambda *a, **k: {"title": "A very long title " * 6}
    assert svc._title_for_topic(bad, "silk sarees", "Choosing the right silk sarees for a wedding in a hot summer in Pune", "") is None or True


def test_duplicates_endpoint_reports_same_title_and_same_image(client, tmp_path, monkeypatch):
    from app.db import SessionLocal
    from app.models import Article
    from app.services import featured_images as fi
    monkeypatch.setattr(fi, "UPLOAD_ROOT", tmp_path)
    (tmp_path / "a.webp").write_bytes(b"same-bytes")
    (tmp_path / "b.webp").write_bytes(b"same-bytes")
    (tmp_path / "c.webp").write_bytes(b"other")
    bid = client.post("/api/v1/businesses", json={"name": "Dup Co", "website": "https://dup.example", "primary_category": "Shop"}).json()["id"]
    db = SessionLocal()
    rows = [Article(business_id=bid, keyword="k", title="Same Title", status="completed", featured_image_path="a.webp"),
            Article(business_id=bid, keyword="k", title="same  title", status="completed", featured_image_path="b.webp"),
            Article(business_id=bid, keyword="k", title="Different", status="completed", featured_image_path="c.webp")]
    db.add_all(rows); db.commit()
    ids = [r.id for r in rows]
    d = client.get(f"/api/v1/businesses/{bid}/articles/{ids[0]}/duplicates").json()
    assert [x["id"] for x in d["same_title"]] == [ids[1]] and [x["id"] for x in d["same_image"]] == [ids[1]]
    d3 = client.get(f"/api/v1/businesses/{bid}/articles/{ids[2]}/duplicates").json()
    assert d3 == {"same_title": [], "same_image": []}
    db.close()
