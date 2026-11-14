import io

from PIL import Image

from app.services import post_image as pi

BODY = "Planning a function in Pune? Rent a designer dress for the day. Call +91 98765 43210 or visit https://shop.example #rental #pune"


def _img(data):
    return Image.open(io.BytesIO(data))


def test_card_is_a_1200_by_900_jpeg_within_googles_limits():
    data = pi.render(business_name="Asha Rentals", place="Wagholi, Pune", title="Designer dress rental in Pune", body=BODY)
    im = _img(data)
    assert im.format == "JPEG" and im.size == (1200, 900) and 10 * 1024 < len(data) < 5 * 1024 * 1024
    assert im.size[0] >= pi.MIN_W and im.size[1] >= pi.MIN_H


def test_links_phones_and_hashtags_are_left_off_the_picture():
    t = pi.clean_text(BODY)
    assert "http" not in t and "98765" not in t and "#" not in t and "designer dress" in t.lower()


def test_headline_and_supporting_line_come_from_the_post():
    assert pi.support_line("Offer", BODY, "x", coupon="SAVE10", starts_on="2026-11-20", ends_on="2026-11-30") == "Use code SAVE10 · 20 Nov 2026 – 30 Nov 2026"
    assert pi.support_line("Event", BODY, "x", starts_on="2026-12-01", start_time="18:00") == "1 Dec 2026 · 18:00"
    assert pi.support_line("Update", "First one here. Second sentence is the support.", "First one here.") == "Second sentence is the support."


def test_every_style_renders_and_the_same_business_keeps_its_colour():
    for s in pi.STYLES:
        assert _img(pi.render(business_name="X", place=None, title="T", body="B body text here.", style=s)).size == (1200, 900)
    assert pi.pick_style("Asha Rentals") == pi.pick_style("asha rentals") and pi.pick_style("a", "light") == "light"


def test_very_long_headline_and_empty_post_still_render():
    assert _img(pi.render(business_name="N", place="P", title="word " * 80, body=BODY)).size == (1200, 900)
    assert _img(pi.render(business_name="Only Name", place=None, title=None, body=None)).size == (1200, 900)


def test_endpoint_returns_a_ready_picture_and_refuses_an_empty_post(client):
    import base64
    bid = client.post("/api/v1/businesses", json={"name": "Asha Rentals", "city": "Pune", "website": "https://asha.example", "primary_category": "Clothing rental service"}).json()["id"]
    r = client.post(f"/api/v1/businesses/{bid}/posts/image", json={"title": "Festive rentals", "body": BODY, "post_type": "Update"})
    assert r.status_code == 200
    j = r.json()
    assert (j["width"], j["height"]) == (1200, 900) and _img(base64.b64decode(j["image_base64"])).size == (1200, 900) and "light" in j["styles"]
    assert client.post(f"/api/v1/businesses/{bid}/posts/image", json={"post_type": "Update"}).status_code == 422
