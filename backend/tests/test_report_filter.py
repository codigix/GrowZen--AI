"""The report filter: parsing, the period it gives to a data source, and that it follows a request into its worker thread."""
from datetime import date, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import _ReportFilterMiddleware
from app.services import market, report_filter


def test_parse_keeps_good_values_and_drops_bad_ones():
    f = report_filter.parse({"rf_from": "2026-01-01", "rf_to": "2026-01-31", "rf_country": "in", "rf_location": " Pune,  India "})
    assert (f.start, f.end, f.country, f.location) == (date(2026, 1, 1), date(2026, 1, 31), "IN", "Pune, India")
    bad = report_filter.parse({"rf_from": "yesterday", "rf_to": "2026-01-31", "rf_country": "India"})
    assert not bad.has_period and bad.country is None
    swapped = report_filter.parse({"rf_from": "2026-02-10", "rf_to": "2026-02-01"})
    assert swapped.start == date(2026, 2, 1) and swapped.end == date(2026, 2, 10)
    future = report_filter.parse({"rf_from": "2026-01-01", "rf_to": "2999-01-01"})
    assert future.end == date.today()


def test_period_uses_the_choice_else_the_default_days():
    today = date(2026, 6, 30)
    assert report_filter.period(28, 2, today) == (date(2026, 6, 1), date(2026, 6, 28))
    token = report_filter.set_current(report_filter.parse({"rf_from": "2026-05-01", "rf_to": "2026-05-31"}))
    try:
        assert report_filter.period(28, 2, today) == (date(2026, 5, 1), date(2026, 5, 31))
        assert report_filter.span(28) == 31
    finally:
        report_filter.reset(token)
    # a period that ends inside the data's lag stops where the data stops
    token = report_filter.set_current(report_filter.parse({"rf_from": "2026-06-20", "rf_to": "2026-06-30"}))
    try:
        assert report_filter.period(28, 2, today)[1] == date(2026, 6, 28)
    finally:
        report_filter.reset(token)


def test_the_market_follows_the_chosen_country_and_place():
    class B:
        target_scope, country, city = "local", "IN", "Pune"

    assert market.serp_country(B) == "IN"
    token = report_filter.set_current(report_filter.parse({"rf_country": "us", "rf_location": "Austin, Texas, United States"}))
    try:
        assert market.serp_country(B) == "US"
        assert market.search_location(B) == "Austin, Texas, United States"
    finally:
        report_filter.reset(token)


def test_the_filter_reaches_a_synchronous_endpoint_and_is_gone_after():
    app = FastAPI()
    app.add_middleware(_ReportFilterMiddleware)

    @app.get("/x")
    def x():  # a plain def runs in a worker thread: the choice must follow it there
        f = report_filter.current()
        return {"days": f.days, "country": f.country}

    c = TestClient(app)
    assert c.get("/x?rf_from=2026-03-01&rf_to=2026-03-31&rf_country=GB").json() == {"days": 31, "country": "GB"}
    assert c.get("/x").json() == {"days": None, "country": None}
    assert report_filter.current().days is None
    assert date.today() - timedelta(days=1) < date.today()
