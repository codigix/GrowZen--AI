from app.services import gbp


def test_markdown_marks_are_taken_out_of_a_description():
    assert gbp.plain_description("**Vastrbhushan** is built on __luxury__.\n# Title\n- one\n* two") == "Vastrbhushan is built on luxury.\nTitle\none\ntwo"


def test_unconfirmed_lists_what_google_does_not_hold():
    sent = {"profile": {"description": "New text"}, "phoneNumbers": {"primaryPhone": "123"}, "websiteUri": "https://a.com/"}
    assert gbp.unconfirmed(sent, {"profile": {"description": "New text"}, "phoneNumbers": {"primaryPhone": "123"}, "websiteUri": "https://a.com"}) == []
    assert gbp.unconfirmed(sent, {"profile": {"description": "Old"}, "phoneNumbers": {"primaryPhone": "999"}}) == ["website", "description", "phone"]
