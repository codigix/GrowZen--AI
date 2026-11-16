"""A React.js site (any profile) never receives a scheduled post early: GrowZen holds it and publishes at the chosen time."""
from datetime import datetime, timezone

from app.models import Article, ReactSiteConnection
from app.services import react_site as rs


def test_schedule_on_a_standard_site_is_held_and_nothing_is_sent(monkeypatch):
    def no_network(*_a, **_k):
        raise AssertionError("a scheduled post must not be sent to the website before its time")

    monkeypatch.setattr(rs, "site_client", no_network)
    conn = ReactSiteConnection(business_id=1, api_base_url="https://site.example", publish_endpoint="/api/blogs", mapping={"profile": "standard"})
    a = Article(id=1, business_id=1, keyword="seo", title="SEO Guide", body="<p>x</p>", status="completed")
    try:
        rs.publish(conn, a, "schedule", datetime(2099, 1, 1, tzinfo=timezone.utc))
    except rs.ScheduleHeldByGrowZen:
        pass
    else:
        raise AssertionError("GrowZen must hold the scheduled post")
