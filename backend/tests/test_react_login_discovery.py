import httpx

from app.models import ReactSiteConnection
from app.services import crypto, react_site as rs


def _conn(path="/api/integrations/login"):
    c = ReactSiteConnection(business_id=1, api_base_url="https://site.example", auth_endpoint=path, login_username="admin_user", auth_scheme="login")
    c.password_enc = crypto.seal("pw")
    return c


def _client(real: str | None):
    def handler(req: httpx.Request) -> httpx.Response:
        if real and req.url.path == real:
            return httpx.Response(200, json={"token": "a.b.c", "expiresIn": 3600})
        return httpx.Response(404, json={"error": "not found"})
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_finds_the_sites_real_login_path_and_leaves_the_setting_alone():
    c = _conn()
    assert rs.discover_login(_client("/api/auth/login"), c) == "/api/auth/login"
    assert c.auth_endpoint == "/api/integrations/login"


def test_gives_none_when_the_site_has_no_login_at_all():
    assert rs.discover_login(_client(None), _conn()) is None
