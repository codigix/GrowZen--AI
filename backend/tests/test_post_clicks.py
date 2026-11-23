"""Clicks on a Google post's button: the link carries a campaign tag, and Google Analytics' count for that campaign is read back per post."""
from app.services import post_clicks as pc


def test_a_button_link_gets_the_posts_campaign_tag_and_keeps_what_it_had():
    out = pc.tag_url("https://shop.example/collection?ref=a#top", 7)
    assert out.startswith("https://shop.example/collection?") and "ref=a" in out and "utm_source=google" in out and "utm_campaign=gbp-post-7" in out and out.endswith("#top")
    own = pc.tag_url("https://shop.example/x?utm_campaign=mine", 7)
    assert own.count("utm_campaign=") == 1 and "utm_campaign=mine" in own  # a tag the owner already put on is never overwritten
    assert pc.tag_url(None, 7) is None and pc.tag_url("tel:+911234", 7) == "tel:+911234"


def test_the_campaign_name_gives_back_the_post():
    assert pc.post_id_of("gbp-post-12") == 12 and pc.post_id_of("gbp-post-x") is None and pc.post_id_of("spring-sale") is None and pc.post_id_of(None) is None


def test_the_counts_are_read_per_post_from_analytics():
    asked = []

    class Ga:
        def run(self, prop, body):
            asked.append((prop, body["dimensionFilter"]["filter"]["stringFilter"]))
            return [{"sessionCampaignName": "gbp-post-3", "sessions": 5, "activeUsers": 4}, {"sessionCampaignName": "gbp-post-9", "sessions": 2.0, "activeUsers": 2}, {"sessionCampaignName": "gbp-post-bad", "sessions": 9}]
    got = pc.counts(Ga(), "properties/1")
    assert got == {3: {"visits": 5, "users": 4}, 9: {"visits": 2, "users": 2}} and asked == [("properties/1", {"matchType": "BEGINS_WITH", "value": "gbp-post-"})]
