"""A project's own calendar day (services/localtime.py)."""
from datetime import date, datetime, timezone
from types import SimpleNamespace

from app.services import localtime


def at(h, m=0, d=12):
    return datetime(2026, 11, d, h, m, tzinfo=timezone.utc)


def test_an_indian_project_changes_day_at_18_30_utc_not_at_midnight_utc():
    b = SimpleNamespace(country="IN", timezone=None)
    assert localtime.today(b, at(18, 29)) == date(2026, 11, 12)
    assert localtime.today(b, at(18, 30)) == date(2026, 11, 13)  # 00:00 in India
    assert localtime.today(b, at(0, 10, 16)) == date(2026, 11, 16)  # a Monday: the weekly roll belongs to Monday in India


def test_an_explicit_timezone_wins_and_a_missing_country_means_india():
    assert localtime.today(SimpleNamespace(country="IN", timezone="America/New_York"), at(2)) == date(2026, 11, 11)
    assert localtime.today(SimpleNamespace(country=None, timezone=None), at(19)) == date(2026, 11, 13)


def test_without_a_time_zone_database_a_fixed_offset_is_used(monkeypatch):
    import builtins
    real = builtins.__import__

    def no_zoneinfo(name, *a, **k):
        if name == "zoneinfo":
            raise ImportError("no tzdata")
        return real(name, *a, **k)
    monkeypatch.setattr(builtins, "__import__", no_zoneinfo)
    assert localtime.today(SimpleNamespace(country="IN", timezone=None), at(19)) == date(2026, 11, 13)


def test_the_growth_plan_uses_the_projects_day(client, monkeypatch):
    from app.db import SessionLocal
    from app.models import Business
    from app.services import growth_plan as gp
    bid = client.post("/api/v1/businesses", json={"name": "Tz Co", "country": "IN"}).json()["id"]
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        monkeypatch.setattr(localtime, "datetime", type("D", (), {"now": staticmethod(lambda tz=None: at(19))}))
        assert gp._today(None, b) == date(2026, 11, 13)
        assert gp._today(date(2026, 1, 1), b) == date(2026, 1, 1)  # an explicit day is never overridden
    finally:
        db.close()
