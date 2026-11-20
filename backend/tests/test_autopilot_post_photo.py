from app.db import SessionLocal
from app.models import AgentTask, Post


def test_a_waiting_post_can_get_and_lose_its_photo(client):
    bid = client.post("/api/v1/businesses", json={"name": "Photo Co", "website": "https://photo.example/"}).json()["id"]
    db = SessionLocal()
    try:
        p = Post(business_id=bid, body="Hello from the shop with enough words", status="draft", image_url="https://lh3.googleusercontent.com/gpu-csl/x")
        db.add(p)
        db.flush()
        t = AgentTask(business_id=bid, agent="gbp", kind="gbp_post", title="Post", status="pending", detail={"post_id": p.id, "body": p.body})
        db.add(t)
        db.commit()
        pid, tid = p.id, t.id
    finally:
        db.close()
    url = f"/api/v1/businesses/{bid}/autopilot/items/{tid}"
    assert client.patch(url, json={"image_url": "http://insecure.example/a.jpg"}).status_code == 422
    assert client.patch(url, json={"image_url": "https://lh3.googleusercontent.com/mine"}).status_code == 200
    d = SessionLocal()
    try:
        assert d.get(Post, pid).image_url == "https://lh3.googleusercontent.com/mine"
    finally:
        d.close()
    assert client.patch(url, json={"image_url": ""}).status_code == 200
    d = SessionLocal()
    try:
        assert d.get(Post, pid).image_url is None
    finally:
        d.close()


def test_deleting_a_post_closes_its_waiting_approval(client):
    bid = client.post("/api/v1/businesses", json={"name": "Del Co", "website": "https://del.example/"}).json()["id"]
    db = SessionLocal()
    try:
        p = Post(business_id=bid, body="A post that will be deleted before its time", status="scheduled")
        db.add(p)
        db.flush()
        t = AgentTask(business_id=bid, agent="gbp", kind="gbp_post", title="Post", status="scheduled", detail={"post_id": p.id})
        db.add(t)
        db.commit()
        pid, tid = p.id, t.id
    finally:
        db.close()
    assert client.delete(f"/api/v1/businesses/{bid}/posts/{pid}").status_code == 204
    d = SessionLocal()
    try:
        t = d.get(AgentTask, tid)
        assert t.status == "rejected" and "deleted" in t.result["note"]
    finally:
        d.close()
