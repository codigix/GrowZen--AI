from app.services import gbp


class Conn:
    id = 99
    email = "x@example.com"
    refresh_token_enc = "x"


def test_a_post_google_refuses_is_retried_without_the_photo_then_without_the_button(monkeypatch):
    c = gbp.GbpClient(Conn())
    sent = []

    def fake(method, url, **kw):
        sent.append(sorted(kw["json"]))
        if "media" in kw["json"] or "callToAction" in kw["json"]:
            raise gbp.GbpError("Google refused access (The caller does not have permission).")
        return {"name": "accounts/1/locations/2/localPosts/3"}

    monkeypatch.setattr(c, "_req", fake)
    out = c.create_post("accounts/1", "locations/2", {"body": "Hello there", "cta_type": "BOOK", "cta_url": "https://a.example/", "image_url": "https://lh3.googleusercontent.com/x"})
    assert out["dropped"] == ["the photo", "the button"] and len(sent) == 3
    assert "media" not in sent[-1] and "callToAction" not in sent[-1]


def test_other_errors_are_not_retried(monkeypatch):
    c = gbp.GbpClient(Conn())
    monkeypatch.setattr(c, "_req", lambda *a, **k: (_ for _ in ()).throw(gbp.GbpError("Google API 500: boom")))
    try:
        c.create_post("a", "l", {"body": "x"})
    except gbp.GbpError as e:
        assert "boom" in str(e)
