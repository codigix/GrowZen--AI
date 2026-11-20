from app.services import categories


def test_a_rental_business_is_searched_as_a_rental_not_as_the_shop():
    out = categories.rental_seeds("vastrbhushan Rental", "Clothes market", ["legenga"],
                                  "Vastrbhushan offers designer clothing for rent. Our lehenga rental collection is built for weddings. Rental durations are 3, 5 and 7 days.")
    assert out == ["lehenga on rent", "designer clothes rental"]
    assert categories.rental_seeds("Rani Sarees Rental", None, [], "Sarees and gowns for every occasion")[:2] == ["saree on rent", "gown on rent"]


def test_other_rentals_use_their_own_kind():
    assert categories.rental_seeds("Pune Car Rentals", "Car rental agency", [], "") == ["car on rent", "car rental"]
    assert categories.rental_seeds("Cam Hire", "Store", ["DSLR camera"], "") == ["dslr camera on rent", "dslr camera rental"]


def test_a_business_that_only_mentions_rent_is_not_a_rental():
    assert categories.rental_seeds("CASA Royale - Luxury PG", "Serviced accommodation", [], "Affordable rent with meals included. Book a room today.") == []
    assert categories.rental_seeds("Impression Makeup Studio", "Beauty salon", ["Bridal makeup"], "Bridal makeup and salon services.") == []
