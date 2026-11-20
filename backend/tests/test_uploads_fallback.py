"""Images uploaded through another GrowZen server that shares the database are fetched once from it (uploads_fallback_url)."""
import httpx
import pytest

from app.config import get_settings
from app.services import content_images as ci, featured_images as fi

WEBP = b"RIFF" + b"\x00" * 200


@pytest.fixture()
def uploads(tmp_path, monkeypatch):
    monkeypatch.setattr(fi, "UPLOAD_ROOT", tmp_path)
    fi._fetch_misses.clear()
    return tmp_path


def _serve(monkeypatch, routes, seen):
    real = httpx.Client

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req.url.path)
        body = routes.get(req.url.path)
        return httpx.Response(200, content=body, headers={"content-type": "image/webp"}) if body else httpx.Response(404, json={"detail": "Not found"})

    monkeypatch.setattr(httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(handler), **{k: v for k, v in kw.items() if k != "transport"}))


def test_missing_images_are_fetched_from_the_other_server_and_kept(uploads, monkeypatch):
    monkeypatch.setattr(get_settings(), "uploads_fallback_url", "https://live.example/api/v1")
    seen = []
    _serve(monkeypatch, {"/api/v1/businesses/40/articles/36/featured-image": WEBP,
                         "/api/v1/businesses/40/articles/36/content-images/36-d52132ffb263.webp": WEBP}, seen)
    p = fi.path_of("articles/40/36-ef699d7d0c9e.webp")
    assert p and p.read_bytes() == WEBP and p.parent == (uploads / "articles" / "40").resolve()
    c = ci.path_of(40, 36, "36-d52132ffb263.webp")
    assert c and c.read_bytes() == WEBP
    assert fi.path_of("articles/40/36-ef699d7d0c9e.webp") == p and len(seen) == 2  # kept: not downloaded again


def test_nothing_is_fetched_without_the_setting_or_when_the_server_has_no_image(uploads, monkeypatch):
    seen = []
    _serve(monkeypatch, {}, seen)
    monkeypatch.setattr(get_settings(), "uploads_fallback_url", "")
    assert fi.path_of("articles/40/36-ef699d7d0c9e.webp") is None and seen == []
    monkeypatch.setattr(get_settings(), "uploads_fallback_url", "https://live.example/api/v1")
    assert fi.path_of("articles/40/36-ef699d7d0c9e.webp") is None and len(seen) == 1
    assert fi.path_of("articles/40/36-ef699d7d0c9e.webp") is None and len(seen) == 1  # a miss is not retried for 10 minutes
    assert fi.path_of("../outside.webp") is None and ci.path_of(40, 36, "37-d52132ffb263.webp") is None  # never outside / other article
    fi.remove("articles/40/36-ef699d7d0c9e.webp")  # deleting never downloads
    assert len(seen) == 1
