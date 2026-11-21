from app.services import dev_brief, keyword_placement as kp


def _detail(db, b, url, focus=None):
    return {"url": url, "path": "/gowns", "scope": {"kind": "offer", "label": "Product or service page", "takes": "x"}, "notes": ["Almost no text without JavaScript."],
            "keywords": [{"keyword": "gown rental", "role": "main", "warning": None, "to_add": [
                {"place": "title", "why": "Strongest place.", "current": "Old title | Shop", "example": "Gown Rental in Pune | Shop"},
                {"place": "heading", "why": "Name it.", "current": None, "example": "Gown Rental in Pune"}]},
                {"keyword": "party gown", "role": "supporting", "warning": "This keyword is mapped to an information page.", "to_add": []}]}


def test_developer_brief_lists_what_to_replace_and_add(client, monkeypatch):
    bid = client.post("/api/v1/businesses", json={"name": "Brief Co", "website": "https://brief.example/"}).json()["id"]
    client.post(f"/api/v1/businesses/{bid}/keywords", json=[{"keyword": "gown rental"}, {"keyword": "party gown"}, {"keyword": "saree rental"}])
    ids = {k["keyword"]: k["id"] for k in client.get(f"/api/v1/businesses/{bid}/keywords").json()["keywords"]}
    url = f"/api/v1/businesses/{bid}/keywords"
    client.patch(f"{url}/{ids['gown rental']}", json={"keyword": "x", "target_url": "https://brief.example/gowns", "role": "primary"})
    client.patch(f"{url}/{ids['party gown']}", json={"keyword": "x", "target_url": "https://brief.example/gowns"})
    monkeypatch.setattr(kp, "page_detail", _detail)
    monkeypatch.setattr(dev_brief, "_page", lambda bid_, u, f: _detail(None, None, u, f))
    r = client.post(f"/api/v1/businesses/{bid}/keyword-mapping/dev-brief", json={"format": "md"})
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"] and r.headers["content-disposition"].endswith('.md"')
    md = r.text
    assert "## Page: /gowns" in md and "Replace: Page title" in md and r"Old title \| Shop" in md and r"Gown Rental in Pune \| Shop" in md
    assert "Add: Main heading (H1)" in md and "(nothing there)" in md and "mapped to an information page" in md
    assert "saree rental" in md  # chosen but not mapped: listed so it is not forgotten
    pdf = client.post(f"/api/v1/businesses/{bid}/keyword-mapping/dev-brief", json={"format": "pdf"})
    assert pdf.status_code == 200 and pdf.content[:5] == b"%PDF-" and pdf.headers["content-type"] == "application/pdf"


def test_brief_needs_a_mapped_keyword(client):
    bid = client.post("/api/v1/businesses", json={"name": "Empty Co", "website": "https://empty.example/"}).json()["id"]
    assert client.post(f"/api/v1/businesses/{bid}/keyword-mapping/dev-brief", json={"format": "pdf"}).status_code == 409
