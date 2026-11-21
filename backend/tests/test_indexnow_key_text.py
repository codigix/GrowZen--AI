import httpx

from app.models import Business
from app.services import indexing


def _client_for(handler):
    return lambda timeout=15, user_agent=None: httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)


def _biz(db):
    b = Business(name="K", website="https://k.example/", owner_id="1")
    db.add(b)
    db.commit()
    return b


def test_plain_text_key_file_is_verified(monkeypatch):
    from app.db import SessionLocal
    db_session = SessionLocal()
    b = _biz(db_session)
    key = indexing.ensure_key(db_session, b).indexnow_key
    monkeypatch.setattr("app.services.net.site_client", _client_for(lambda req: httpx.Response(200, text=key + "\n", headers={"content-type": "text/plain"})))
    ok, msg = indexing.verify_key(db_session, b)
    assert ok, msg
    monkeypatch.setattr("app.services.net.site_client", _client_for(lambda req: httpx.Response(200, text="<html>home</html>", headers={"content-type": "text/html"})))
    ok, msg = indexing.verify_key(db_session, b)
    assert not ok and "web page" in msg
    db_session.delete(b)
    db_session.commit()
    db_session.close()
