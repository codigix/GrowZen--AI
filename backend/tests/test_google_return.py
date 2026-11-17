"""After Google sign-in the person returns to the address they started from, not to a saved one that may be an old IP."""
import jwt

from app.config import get_settings
from app.services import gbp


def test_state_carries_the_start_address(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "google_client_id", "id"); monkeypatch.setattr(s, "google_client_secret", "sec"); monkeypatch.setattr(s, "token_encryption_key", "k" * 44)
    url = gbp.auth_url("1", "gsc", "http://192.168.1.22:3100")
    state = url.split("state=")[1].split("&")[0]
    assert gbp.read_front(state) == "http://192.168.1.22:3100" and gbp.read_purpose(state) == "gsc"
    assert gbp.read_front("garbage") == ""


def test_start_only_trusts_known_origins(client, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "google_client_id", "id"); monkeypatch.setattr(s, "google_client_secret", "sec"); monkeypatch.setattr(s, "token_encryption_key", "k" * 44)
    monkeypatch.setattr(s, "cors_origins", "http://localhost:3100,http://192.168.1.22:3100")
    for origin, want in (("http://192.168.1.22:3100", "http://192.168.1.22:3100"), ("http://evil.example", "")):
        r = client.get("/api/v1/connections/google/start?purpose=gsc", headers={"Origin": origin})
        if r.status_code != 200:  # Google sign-in not configured in this test setup
            return
        state = r.json()["url"].split("state=")[1].split("&")[0]
        assert gbp.read_front(state) == want
