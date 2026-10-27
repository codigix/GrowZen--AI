import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture(autouse=True)
def _clear_cache():
    from app.services import trends_client
    trends_client.clear_cache()
    yield
    trends_client.clear_cache()


@pytest.fixture(autouse=True)
def _fast_throttle(monkeypatch):
    from app.services import trends_client
    monkeypatch.setattr(trends_client, "_throttle", lambda: None)
