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
    assert "## Page: /gowns" in md and "### Meta data (goes in the page's head)" in md
    assert "Page title (the <title> tag in the head): REPLACE" in md and "Find: `Old title | Shop`" in md and "Replace with: `Gown Rental in Pune | Shop`" in md
    assert "### Add new content" in md and "Main heading (H1): ADD NEW" in md and "Text: `Gown Rental in Pune`" in md and "Where: Put it at the top of the page content" in md
    assert "mapped to an information page" in md
    assert "saree rental" in md  # chosen but not mapped: listed so it is not forgotten
    pdf = client.post(f"/api/v1/businesses/{bid}/keyword-mapping/dev-brief", json={"format": "pdf"})
    assert pdf.status_code == 200 and pdf.content[:5] == b"%PDF-" and pdf.headers["content-type"] == "application/pdf"


def test_brief_needs_a_mapped_keyword(client):
    bid = client.post("/api/v1/businesses", json={"name": "Empty Co", "website": "https://empty.example/"}).json()["id"]
    assert client.post(f"/api/v1/businesses/{bid}/keyword-mapping/dev-brief", json={"format": "pdf"}).status_code == 409


def test_changes_are_sorted_into_meta_replace_and_add_new():
    rows = [{"place": "title", "current": "Old", "new": "New title", "keyword": "k", "why": ""},
            {"place": "description", "current": "", "new": "A description", "keyword": "k", "why": ""},
            {"place": "heading", "current": "Old H1", "new": "New H1", "keyword": "k", "why": ""},
            {"place": "intro", "current": None, "new": "Intro line", "keyword": "k", "why": ""},
            {"place": "subheading", "current": None, "new": "Section on k", "keyword": "k2", "why": ""},
            {"place": "text", "current": None, "new": "Paragraph on k2", "keyword": "k2", "why": ""}]
    out = dev_brief.sort_changes(rows)
    assert [(m["action"], m["new"]) for m in out["meta"]] == [("REPLACE", "New title"), ("ADD", "A description")]  # a missing description is ADD, an existing title REPLACE
    assert [(r["element"], r["current"]) for r in out["replace"]] == [("Main heading (H1)", "Old H1")]
    assert out["add"][0] == {"kind": "section", "keyword": "k2", "heading": "Section on k", "paragraph": "Paragraph on k2", "why": "", "element": "New section", "place": "section"}
    assert out["add"][1]["element"] == "First paragraph" and out["add"][1]["place"] == "intro"
