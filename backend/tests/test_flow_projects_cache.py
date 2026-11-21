from app.routers import flow as flow_router


def test_journeys_are_worked_out_once_and_then_served_from_memory(client, monkeypatch):
    bid = client.post("/api/v1/businesses", json={"name": "Flow Co", "website": "https://flow.example/"}).json()["id"]
    flow_router._journeys.clear()
    calls = []

    def fake(db, b):
        calls.append(b.id)
        return {"done": 2, "total": 10, "percent": 20, "next": {"key": "k", "title": "Next", "link": "/x"}, "steps": [{"key": "k", "order": 3}]}
    monkeypatch.setattr(flow_router.flow, "evaluate", fake)
    first = client.get("/api/v1/flow/projects").json()["projects"]
    assert first[str(bid)]["percent"] == 20 and first[str(bid)]["next"]["order"] == 3
    n = len(calls)
    assert n >= 1
    again = client.get("/api/v1/flow/projects").json()["projects"]
    assert again == first and len(calls) == n  # the second call worked nothing out
