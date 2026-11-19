"""The phased plan: tasks land in the right phase and step, page changes are read from the crawl, and the current phase is the first that is not done."""
from app.services import onboarding_plan as op


def T(key, area="seo"):
    return {"key": "fix." + key, "area": area}


def test_tasks_are_placed_by_what_they_are_about():
    cases = [
        (T("onpage.noindex"), ("website", "readable")), (T("site.sitemap.incomplete"), ("website", "readable")), (T("xray.single_canonical"), ("website", "readable")),
        (T("site.meta.title_length"), ("website", "titles")), (T("xray.description"), ("website", "titles")), (T("site.meta.og_image"), ("website", "titles")),
        (T("onpage.h1_count"), ("website", "content")), (T("onpage.thin_content"), ("website", "content")),
        (T("site.meta.alt"), ("website", "media")), (T("onpage.no_localbusiness_schema"), ("website", "data")), (T("xray.llms_txt", "geo"), ("website", "data")), (T("xray.faq", "aeo"), ("website", "data")),
        (T("security.hsts"), ("website", "speed")), (T("xray.response_time"), ("website", "speed")),
        (T("gbp.description", "gmb"), ("gbp", "basics")), (T("gbp.services", "gmb"), ("gbp", "services")), (T("gbp.photos", "gmb"), ("gbp", "proof")), (T("gbp.reviews", "gmb"), ("gbp", "proof")),
        (T("listing.bing.add", "local"), ("local", "listings")), (T("rank.none", "local"), ("local", "rank")),
        (T("chatgpt.profile", "chatgpt"), ("ai", "chatgpt")),
        (T("kw.few"), ("grow", "keywords")), (T("blog.none"), ("grow", "blog")), (T("bl.few"), ("grow", "links")),
    ]
    for task, want in cases:
        assert op.step_of(task) == want, (task["key"], op.step_of(task))


def test_page_changes_read_each_pages_own_data():
    thin = {"status": 200, "url": "https://x.example/services", "title": "Services", "title_length": 8, "meta_description": "", "meta_description_length": 0, "h1_count": 0, "word_count": 90,
            "images_missing_alt": 2, "images_without_alt": ["https://x.example/a.jpg"], "schema_types": [], "has_viewport": True, "canonical": "https://x.example/services", "h2_count": 0}
    good = {"status": 200, "url": "https://x.example/", "title": "A good title for the home page of this business in Pune", "title_length": 52, "meta_description": "d" * 150, "meta_description_length": 150,
            "h1_count": 1, "word_count": 600, "images_missing_alt": 0, "schema_types": ["LocalBusiness"], "has_viewport": True, "canonical": "https://x.example/", "h2_count": 3,
            "og_title": "t", "og_description": "d", "og_image": "i"}
    broken = {"status": 404, "url": "https://x.example/old", "title_length": 0}
    out = {p["path"]: {c["code"] for c in p["changes"]} for p in op.page_changes({"pages": [thin, good, broken]})}
    assert {"title_length", "missing_description", "h1_count", "thin_content", "missing_alt", "no_schema", "no_social_preview"} <= out["/services"]
    assert out["/"] == set()
    assert out["/old"] == {"http_error"}
    same = [dict(good, url="https://x.example/a"), dict(good, url="https://x.example/b")]
    codes = {c["code"] for p in op.page_changes({"pages": same}) for c in p["changes"]}
    assert {"title_duplicate", "description_duplicate"} <= codes


def test_plan_orders_phases_and_points_at_the_first_open_step(client):
    from app.db import SessionLocal
    from app.models import Business
    from app.services import growth_content
    bid = client.post("/api/v1/businesses", json={"name": "Plan Co", "website": "https://planco.example", "primary_category": "Shop", "modules": ["seo", "geo", "gmb"], "phone": "+919876543210", "city": "Pune", "services": [{"name": "x"}], "target_audience": "Shoppers in Pune", "goals": ["sales"]}).json()["id"]
    db = SessionLocal()
    b = db.get(Business, bid)
    orig = growth_content._crawl
    growth_content._crawl = lambda *_a, **_k: {"pages": [{"status": 200, "url": "https://planco.example/", "title": "", "title_length": 0, "meta_description_length": 0, "h1_count": 0, "word_count": 50,
                                                          "images_missing_alt": 0, "schema_types": [], "has_viewport": True, "canonical": "x"}], "site": {"robots_txt": True, "sitemap": False}, "_found": "2026-11-16"}
    try:
        p = op.plan(db, b)
    finally:
        growth_content._crawl = orig
        db.close()
    assert [x["key"] for x in p["phases"]] == ["website", "gbp", "local", "ai", "grow"]
    assert p["phases"][0]["status"] == "current" and p["phases"][1]["status"] == "empty"  # no profile tasks yet: not counted as done
    assert p["current"]["phase"] == "website" and p["current"]["step"] == "readable"  # no sitemap: the first thing to fix
    titles = next(s for s in p["phases"][0]["steps"] if s["key"] == "titles")
    assert titles["page_total"] >= 2 and titles["pages"][0]["path"] == "/"
    r = client.get(f"/api/v1/businesses/{bid}/fix-plan/phases")
    assert r.status_code == 200 and r.json()["phases"][0]["key"] == "website"
