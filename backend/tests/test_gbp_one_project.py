from app.db import SessionLocal
from app.models import Business, GoogleConnection
from app.services import gbp


def _loc(name="locations/1", title="Asha Rental", phone="+91 98765 43210", site="https://asha.example/", place="PLACE1"):
    return {"name": name, "account": "accounts/9", "title": title, "phoneNumbers": {"primaryPhone": phone}, "websiteUri": site,
            "storefrontAddress": {"addressLines": ["Kesnand Road"], "locality": "Pune", "postalCode": "412207"}, "metadata": {"placeId": place},
            "categories": {"primaryCategory": {"displayName": "Clothing rental"}}, "profile": {"description": "From Google"}}


def test_connecting_google_adds_to_the_project_the_owner_already_has():
    db = SessionLocal()
    try:
        mine = Business(name="Asha Rental", website="https://www.asha.example/", phone="09876543210", description="Written by the owner", owner_id="u1", source="manual")
        db.add(mine)
        conn = GoogleConnection(email="o@x.com", status="active")
        db.add(conn)
        db.commit()
        before = db.query(Business).count()
        b = gbp.import_location(db, conn, _loc(), "t", owner_id="u1")
        db.commit()
        assert b.id == mine.id and db.query(Business).count() == before  # no second project
        assert b.gbp_location == "locations/1" and b.place_id == "PLACE1" and b.connection_id == conn.id and b.source == "manual"
        assert b.description == "Written by the owner"  # what the owner wrote is kept
        assert b.primary_category == "Clothing rental" and b.city == "Pune"  # the gaps are filled from Google
        # a second import of the same location changes nothing again
        again = gbp.import_location(db, conn, _loc(), "t", owner_id="u1")
        assert again.id == mine.id and db.query(Business).count() == before
    finally:
        db.query(Business).filter(Business.owner_id.in_(["u1", "u2"])).delete()
        db.query(GoogleConnection).filter(GoogleConnection.email == "o@x.com").delete()
        db.commit()
        db.close()


def test_a_different_business_or_another_owners_project_is_not_taken():
    db = SessionLocal()
    try:
        other_owner = Business(name="Asha Rental", website="https://asha.example/", phone="09876543210", owner_id="u2", source="manual")
        other_branch = Business(name="Asha Rental", website="https://asha.example/", phone="09876543210", owner_id="u1", gbp_location="locations/77", source="google")
        unrelated = Business(name="Zed Tailors", website="https://zed.example/", phone="09000000000", owner_id="u1", source="manual")
        db.add_all([other_owner, other_branch, unrelated])
        conn = GoogleConnection(email="o@x.com", status="active")
        db.add(conn)
        db.commit()
        b = gbp.import_location(db, conn, _loc(), "t", owner_id="u1")
        db.commit()
        assert b.id not in (other_owner.id, other_branch.id, unrelated.id) and b.source == "google"  # another owner's, another branch's and unrelated projects stay as they are
    finally:
        db.query(Business).filter(Business.owner_id.in_(["u1", "u2"])).delete()
        db.query(GoogleConnection).filter(GoogleConnection.email == "o@x.com").delete()
        db.commit()
        db.close()
