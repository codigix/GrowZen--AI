import pytest

from app.services import gbp


class FakeClient:
    def __init__(self, offered, have=None):
        self.offered, self.have, self.calls = offered, have or [], []

    def place_action_types(self, location):
        return self.offered

    def place_action_links(self, location):
        return self.have

    def create_place_action_link(self, location, kind, url):
        self.calls.append(("create", kind, url))

    def update_place_action_link(self, name, url):
        self.calls.append(("update", name, url))

    def delete_place_action_link(self, name):
        self.calls.append(("delete", name))


def test_a_button_the_category_does_not_have_is_refused_with_the_ones_it_has():
    c = FakeClient({"SHOP_ONLINE": "Shop online", "FOOD_ORDERING": "Order food"})
    with pytest.raises(gbp.GbpError) as e:
        gbp.sync_action_links(c, "locations/1", [{"type": "APPOINTMENT", "url": "https://x.com/book"}])
    assert "no 'Book' button" in str(e.value) and "Shop online" in str(e.value) and c.calls == []


def test_the_home_page_is_not_a_booking_page():
    c = FakeClient({"APPOINTMENT": "Book"})
    with pytest.raises(gbp.GbpError) as e:
        gbp.sync_action_links(c, "locations/1", [{"type": "APPOINTMENT", "url": "https://x.com/"}])
    assert "home page" in str(e.value) and c.calls == []


def test_a_real_page_goes_through_and_nothing_is_checked_when_google_cannot_say_what_it_offers():
    c = FakeClient({})
    gbp.sync_action_links(c, "locations/1", [{"type": "APPOINTMENT", "url": "https://x.com/book-now"}])
    assert c.calls == [("create", "APPOINTMENT", "https://x.com/book-now")]


def test_one_refused_link_changes_nothing_for_the_others():
    c = FakeClient({"APPOINTMENT": "Book"})
    with pytest.raises(gbp.GbpError):
        gbp.sync_action_links(c, "locations/1", [{"type": "APPOINTMENT", "url": "https://x.com/book"}, {"type": "SHOP_ONLINE", "url": "https://x.com/shop"}])
    assert c.calls == []
