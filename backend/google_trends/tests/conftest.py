import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture(autouse=True)
def _clear_cache():
    from gt_app.services import trends_client
    trends_client.clear_cache()
    trends_client._client = None
    yield
    trends_client.clear_cache()
    trends_client._client = None


@pytest.fixture(autouse=True)
def _fast_throttle(monkeypatch):
    from gt_app.services import trends_client
    monkeypatch.setattr(trends_client, "_throttle", lambda: None)
