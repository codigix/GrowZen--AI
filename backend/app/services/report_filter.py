"""The report filter of a request: the period, country and location the person chose in the page header (rf_from, rf_to, rf_country, rf_location).

A middleware reads them from the query string and keeps them for the rest of the request (a context variable, which follows the request into its worker thread). The places that decide which
market, which place or which dates a figure is read for ask this module first and fall back to the project's own defaults, so one choice reaches every page without each endpoint taking
parameters. Nothing here changes stored data."""
from __future__ import annotations

import re
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import date, timedelta

_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@dataclass(frozen=True)
class Filter:
    start: date | None = None
    end: date | None = None
    country: str | None = None
    location: str | None = None

    @property
    def has_period(self) -> bool:
        return self.start is not None and self.end is not None

    @property
    def days(self) -> int | None:
        return (self.end - self.start).days + 1 if self.has_period else None


_current: ContextVar[Filter] = ContextVar("report_filter", default=Filter())


def parse(params: dict[str, str]) -> Filter:
    """A Filter from the query parameters; anything malformed is ignored (the project's own defaults then apply)."""
    start = end = None
    a, z = params.get("rf_from", ""), params.get("rf_to", "")
    if _DATE.match(a) and _DATE.match(z):
        try:
            start, end = date.fromisoformat(a), date.fromisoformat(z)
        except ValueError:
            start = end = None
    if start and end:
        if start > end:
            start, end = end, start
        end = min(end, date.today())
        start = max(min(start, end), date(2015, 1, 1))
    country = params.get("rf_country", "").strip().upper()
    country = country if re.fullmatch(r"[A-Z]{2}", country) else None
    location = " ".join(params.get("rf_location", "").split())[:160] or None
    return Filter(start, end, country, location)


def set_current(f: Filter):
    return _current.set(f)


def reset(token) -> None:
    _current.reset(token)


def current() -> Filter:
    return _current.get()


def period(default_days: int, lag: int = 0, today: date | None = None) -> tuple[date, date]:
    """(start, end) to read: the chosen period when there is one (its end never later than today minus the data's lag), else the last `default_days` days as before."""
    today = today or date.today()
    f = current()
    limit = today - timedelta(days=lag)
    if f.has_period:
        end = min(f.end, limit)
        return min(f.start, end), end
    end = limit
    return end - timedelta(days=default_days - 1), end


def span(default_days: int) -> int:
    """The number of days of the chosen period, or the page's own default."""
    return current().days or default_days
