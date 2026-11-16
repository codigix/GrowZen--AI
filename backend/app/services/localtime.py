"""A project's own calendar day.

"Today" decides which daily, weekly and monthly window a task belongs to and which Monday a report is made on. The server clock is UTC, the business is usually in India (UTC+5:30):
with UTC days a "Monday report" arrives at 05:30 on Monday and a new day starts at 05:30. The day here is the business's own (its `timezone`, else its country's main one).
"""
from datetime import date, datetime, timedelta, timezone, tzinfo
from typing import Any

COUNTRY_TZ = {"IN": "Asia/Kolkata", "AE": "Asia/Dubai", "OM": "Asia/Muscat", "SA": "Asia/Riyadh", "QA": "Asia/Qatar", "KW": "Asia/Kuwait", "BH": "Asia/Bahrain", "PK": "Asia/Karachi", "BD": "Asia/Dhaka",
              "LK": "Asia/Colombo", "NP": "Asia/Kathmandu", "SG": "Asia/Singapore", "MY": "Asia/Kuala_Lumpur", "GB": "Europe/London", "IE": "Europe/Dublin", "DE": "Europe/Berlin", "FR": "Europe/Paris",
              "US": "America/New_York", "CA": "America/Toronto", "AU": "Australia/Sydney", "NZ": "Pacific/Auckland", "ZA": "Africa/Johannesburg", "NG": "Africa/Lagos", "KE": "Africa/Nairobi"}
FIXED_MINUTES = {"IN": 330, "AE": 240, "OM": 240, "SA": 180, "QA": 180, "KW": 180, "BH": 180, "PK": 300, "BD": 360, "LK": 330, "NP": 345, "SG": 480, "MY": 480, "GB": 0, "IE": 0, "ZA": 120, "NG": 60, "KE": 180}
DEFAULT_COUNTRY = "IN"


def tz_of(b: Any) -> tzinfo:
    name = (getattr(b, "timezone", None) or "").strip() or COUNTRY_TZ.get((getattr(b, "country", None) or DEFAULT_COUNTRY).upper(), COUNTRY_TZ[DEFAULT_COUNTRY])
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(name)
    except Exception:  # noqa: BLE001 - no time zone database on this machine (common on Windows): a fixed offset is right for the countries without daylight saving
        country = (getattr(b, "country", None) or DEFAULT_COUNTRY).upper()
        return timezone(timedelta(minutes=FIXED_MINUTES.get(country, FIXED_MINUTES[DEFAULT_COUNTRY])))


def today(b: Any, now: datetime | None = None) -> date:
    """The business's calendar day right now."""
    return (now or datetime.now(timezone.utc)).astimezone(tz_of(b)).date()
