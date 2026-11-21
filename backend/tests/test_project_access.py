"""An admin, two people and five projects: each person opens only the projects given to them (or that they added); the admin opens all and can change it."""
from fastapi.testclient import TestClient

from app.services.passwords import hash_password
from app.db import SessionLocal
from app.main import app
from app.models import AppUser

PW = "a-long-enough-password"


def add_user(email, role):
    db = SessionLocal()
    db.query(AppUser).filter_by(email=email).delete()
    u = AppUser(email=email, name=email.split("@")[0], role=role, password_hash=hash_password(PW))
    db.add(u)
    db.commit()
    uid = u.id
    db.close()
    return uid


def sign_in(email):
    c = TestClient(app)
    assert c.post("/api/v1/auth/login", json={"email": email, "password": PW}).status_code == 200
    return c


def names(c):
    return sorted(b["name"] for b in c.get("/api/v1/businesses").json())


def test_each_person_opens_only_the_projects_the_admin_gave_them(client):
    admin_id = add_user("boss@x.in", "admin")
    p1, p2 = add_user("person1@x.in", "manager"), add_user("person2@x.in", "manager")
    admin, one, two = sign_in("boss@x.in"), sign_in("person1@x.in"), sign_in("person2@x.in")
    ids = {n: admin.post("/api/v1/businesses", json={"name": n}).json()["id"] for n in ("P1", "P2", "P3", "P4", "P5")}
    assert names(one) == [] and names(two) == []                       # nobody sees what they were not given
    r = admin.put(f"/api/v1/users/{p1}/projects", json={"business_ids": [ids["P1"], ids["P2"], ids["P3"]]})
    assert r.status_code == 200 and r.json()["shared"] == 3
    assert admin.put(f"/api/v1/users/{p2}/projects", json={"business_ids": [ids["P4"], ids["P5"]]}).status_code == 200
    assert names(one) == ["P1", "P2", "P3"] and names(two) == ["P4", "P5"]
    assert one.get(f"/api/v1/businesses/{ids['P4']}").status_code == 404 and two.get(f"/api/v1/businesses/{ids['P1']}").status_code == 404
    assert {"P1", "P2", "P3", "P4", "P5"} <= set(names(admin))          # the admin opens all of them

    own = one.post("/api/v1/businesses", json={"name": "Added by person 1"}).json()["id"]
    assert "Added by person 1" in names(one) and "Added by person 1" not in names(two)   # a project a person adds is theirs alone
    assert "Added by person 1" in names(admin)                                            # and the admin opens it too

    r = admin.get(f"/api/v1/users/{p1}/projects").json()["projects"]
    how = {x["name"]: x["access"] for x in r}
    assert how["P1"] == "shared" and how["Added by person 1"] == "owner" and how["P4"] == "none"
    assert admin.put(f"/api/v1/users/{p1}/projects", json={"business_ids": [ids["P1"]]}).status_code == 200   # the admin changes it
    assert names(one) == ["Added by person 1", "P1"]                                      # what they added stays, the rest is gone
    assert one.get(f"/api/v1/businesses/{ids['P2']}").status_code == 404
    over = {x["name"]: x for x in admin.get("/api/v1/projects-access").json()}
    assert over["P1"]["shared_with"] == ["person1@x.in"] and over["Added by person 1"]["owner"] == "person1"
    assert one.delete(f"/api/v1/businesses/{ids['P1']}").status_code in (403, 404) and one.delete(f"/api/v1/businesses/{own}").status_code in (200, 204)
    assert admin_id


def test_only_an_admin_can_give_or_see_access(client):
    add_user("boss2@x.in", "admin")
    ed = add_user("editor2@x.in", "editor")
    other = add_user("other2@x.in", "viewer")
    person = sign_in("editor2@x.in")
    assert person.get(f"/api/v1/users/{other}/projects").status_code == 403
    assert person.put(f"/api/v1/users/{other}/projects", json={"business_ids": []}).status_code == 403
    assert person.get("/api/v1/projects-access").status_code == 403
    admin = sign_in("boss2@x.in")
    assert admin.put("/api/v1/users/999999/projects", json={"business_ids": []}).status_code == 404
    assert admin.put(f"/api/v1/users/{ed}/projects", json={"business_ids": [999999]}).status_code == 422   # not a project
    admin_row = SessionLocal().query(AppUser).filter_by(email="boss2@x.in").one()
    assert admin.put(f"/api/v1/users/{admin_row.id}/projects", json={"business_ids": []}).status_code == 422  # an admin already has everything


def test_a_viewer_with_a_project_can_look_but_not_change_it(client):
    add_user("boss3@x.in", "admin")
    viewer = add_user("viewer3@x.in", "viewer")
    admin, v = sign_in("boss3@x.in"), sign_in("viewer3@x.in")
    bid = admin.post("/api/v1/businesses", json={"name": "Look Only"}).json()["id"]
    assert admin.put(f"/api/v1/users/{viewer}/projects", json={"business_ids": [bid]}).status_code == 200
    assert v.get(f"/api/v1/businesses/{bid}").status_code == 200
    assert v.patch(f"/api/v1/businesses/{bid}", json={"name": "Changed"}).status_code == 403
    assert v.delete(f"/api/v1/businesses/{bid}").status_code == 403
    assert "Look Only" in names(admin)


def test_an_admin_may_give_a_team_member_an_8_character_password_but_not_a_guessable_one(client):
    add_user("boss4@x.in", "admin")
    admin = sign_in("boss4@x.in")
    ok = admin.post("/api/v1/users", json={"name": "Eight", "email": "eight4@x.in", "password": "Tr7!kq2M", "role": "manager"})
    assert ok.status_code == 201, ok.text
    assert admin.post("/api/v1/users", json={"name": "Short", "email": "short4@x.in", "password": "Tr7!kq2", "role": "manager"}).status_code in (400, 422)   # 7
    assert admin.post("/api/v1/users", json={"name": "Easy", "email": "easy4@x.in", "password": "12345678", "role": "manager"}).status_code == 400    # guessable
    c = TestClient(app)
    assert c.post("/api/v1/auth/login", json={"email": "eight4@x.in", "password": "Tr7!kq2M"}).status_code == 200


def test_an_admin_can_delete_a_team_member_but_not_themselves_or_the_last_admin(client):
    admin_id = add_user("boss5@x.in", "admin")
    gone = add_user("gone5@x.in", "manager")
    admin, person = sign_in("boss5@x.in"), sign_in("gone5@x.in")
    bid = admin.post("/api/v1/businesses", json={"name": "Shared Then Gone"}).json()["id"]
    assert admin.put(f"/api/v1/users/{gone}/projects", json={"business_ids": [bid]}).status_code == 200
    mine = person.post("/api/v1/businesses", json={"name": "Added By Gone"}).json()["id"]
    assert person.get(f"/api/v1/businesses/{bid}").status_code == 200
    assert person.delete(f"/api/v1/users/{gone}").status_code == 403                 # a manager cannot delete anyone
    assert admin.delete(f"/api/v1/users/{admin_id}").status_code == 400             # not yourself
    assert admin.delete(f"/api/v1/users/{gone}").status_code == 204
    assert gone not in [u["id"] for u in admin.get("/api/v1/users").json()]
    assert person.get(f"/api/v1/businesses/{bid}").status_code == 401               # their sign-in stops working at once
    assert TestClient(app).post("/api/v1/auth/login", json={"email": "gone5@x.in", "password": PW}).status_code == 401
    assert admin.get(f"/api/v1/businesses/{mine}").status_code == 200                # the projects they added stay, and the admin opens them
    assert admin.get(f"/api/v1/businesses/{bid}").status_code == 200
    assert admin.delete("/api/v1/users/999999").status_code == 404
    # re-adding the same email starts with no shared projects
    again = add_user("gone5@x.in", "manager")
    assert "Shared Then Gone" not in names(sign_in("gone5@x.in"))  # the project shared with the old account is not shared with the new one (the test database may reuse the old id, so projects the old one added are not checked here)
