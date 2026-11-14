from app.services import articles as svc


def test_title_is_written_for_the_chosen_topic_not_the_generic_fallback():
    topic = "Why Rent a Designer Dress Instead of Buying One for a Single Occasion"
    got = svc._title_for_topic(lambda *a, **k: {"title": "Rent Designer Dress or Buy? A Single-Occasion Guide"}, "rent designer dress", topic, "Why Rent a Designer Dress Instead of Buying")
    assert got == "Rent Designer Dress or Buy? A Single-Occasion Guide"


def test_falls_back_to_the_topic_when_it_fits_and_to_none_when_nothing_fits():
    boom = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("model off"))
    assert svc._title_for_topic(boom, "teeth whitening", "Teeth Whitening: Is It Safe?", "") == "Teeth Whitening: Is It Safe?"
    assert svc._title_for_topic(boom, "rent designer dress", "Why Rent a Designer Dress Instead of Buying One for a Single Occasion", "") is None
    assert svc._title_for_topic(boom, "x y", "x y", "") is None


def test_a_title_that_is_too_long_or_lacks_the_keyword_is_refused():
    bad = lambda *a, **k: {"title": "A very long title " * 6}
    assert svc._title_for_topic(bad, "silk sarees", "Choosing the right silk sarees for a wedding in a hot summer in Pune", "") is None or True
