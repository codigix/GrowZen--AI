

def test_a_missing_google_ads_package_is_reported_not_a_server_error(monkeypatch):
    """Without the google-ads package the callers get GoogleAdsNotConfigured (a clear message), never a raw ImportError."""
    import builtins

    from app.config import get_settings
    from app.services import google_ads_client as ads
    real = builtins.__import__

    def no_ads(name, *a, **k):
        if name.startswith("google.ads"):
            raise ImportError("no google.ads")
        return real(name, *a, **k)

    monkeypatch.setattr(builtins, "__import__", no_ads)
    monkeypatch.setattr(type(get_settings()), "google_ads_enabled", property(lambda self: True), raising=False)
    import pytest
    with pytest.raises(ads.GoogleAdsNotConfigured, match="not installed"):
        ads.keyword_ideas(["dentist"])
