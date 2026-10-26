"""Pure logic: profile score, email extraction, crawler page checks, GEO answer analysis."""
from types import SimpleNamespace

from app.services import crawler, extraction, geo
from app.services.profile_score import ProfileStats, name_looks_stuffed, score_profile


def biz(**kw):
    base = dict(name="Shree Physio & Rehab Clinic", primary_category="Physiotherapist", secondary_categories=["Sports medicine clinic"],
                description="x" * 300, services=[{"name": f"S{i}", "price": "₹600"} for i in range(5)], attributes=["a", "b", "c"],
                website="https://shreephysio.in", address="Karve Road, Kothrud", service_area=None, lat=18.5, lng=73.8, phone="+91 98220 41234",
                verification="verified", duplicate_listing=False, id=1)
    base.update(kw)
    return SimpleNamespace(**base)


def test_complete_profile_scores_high():
    r = score_profile(biz(), ProfileStats(review_count=142, rating=4.6, reply_rate=0.95, photos=24, posts_last_30=5))
    assert r.score >= 95
    assert r.factors["distance"] == 100
    assert not r.alerts


def test_weak_profile_flags_biggest_fixes_first():
    r = score_profile(biz(primary_category=None, website=None, lat=None, lng=None, verification="unverified"),
                      ProfileStats(review_count=4, rating=3.9, reply_rate=0.1, photos=1, posts_last_30=0))
    assert r.score < 50
    assert r.top_fixes[0]["key"] == "primary_category"
    assert any(a["level"] == "critical" for a in r.alerts)


def test_keyword_stuffed_names():
    assert name_looks_stuffed("Best Gym Wakad | Cheap Membership")
    assert not name_looks_stuffed("IronCore Fitness")


def test_extract_labelled_email():
    body = "Business: Sai Dental Care\nWebsite: https://saidentalcare.in\nPhone: +91 98505 22140\nAddress: Shop 12, ITI Road, Aundh, Pune 411007\nCategory: Dentist\nContact person: Dr. Kavita Sai\nPackage: Growth\nMain services: dental implants, root canal, braces"
    f, missing, method = extraction.extract("New client onboarding: Sai Dental Care", body)
    assert method == "rules" and not missing
    assert f["name"] == "Sai Dental Care"
    assert f["phone"] == "+91 98505 22140"
    assert f["website"] == "https://saidentalcare.in"
    assert f["plan"] == "Growth"
    assert f["city"] == "Pune"
    assert "Root canal" in f["services"]


def test_extract_loose_email():
    body = "New signup. Zest Bakery & Cafe, Viman Nagar Pune. Call them on 9822010099. Site is zestbakery.co.in. They want the Starter plan."
    f, missing, _ = extraction.extract("Onboard: Zest Bakery & Cafe (Viman Nagar)", body)
    assert f["name"] == "Zest Bakery & Cafe"
    assert f["phone"] == "+91 98220 10099"
    assert f["website"] == "https://zestbakery.co.in"
    assert f["plan"] == "Starter"
    assert not missing


def test_extract_reports_missing_phone():
    _, missing, _ = extraction.extract("Onboard: Apex Interiors", "Apex Interiors, Hinjewadi. No website yet. Package Pro.")
    assert missing == ["phone"]


def test_crawler_page_checks():
    html = """<html><head><title>Physiotherapy in Kothrud, Pune | Shree Physio</title>
      <meta name="description" content="Back pain, sports injury and post-surgery rehab in Kothrud.">
      <meta name="viewport" content="width=device-width"><link rel="canonical" href="https://shreephysio.in/">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"MedicalClinic","name":"Shree Physio"}</script></head>
      <body><h1>Physiotherapy</h1><img src="a.jpg"><a href="/contact">click here</a></body></html>"""
    p = crawler.analyse_html("https://shreephysio.in/", 200, html)
    assert p["h1_count"] == 1 and p["canonical"] == "https://shreephysio.in/"
    assert p["schema_types"] == ["MedicalClinic"]
    assert p["images_missing_alt"] == 1 and p["generic_link_text"] == 1
    titles = [i["title"] for i in crawler.page_issues(p)]
    assert any("thin" in t for t in titles)
    assert not any("H1" in t for t in titles)


def test_geo_answer_analysis():
    b = SimpleNamespace(name="Shree Physio & Rehab Clinic")
    answer = "Here are good options:\n1. ActiveLife Physiotherapy\n2. Shree Physio & Rehab Clinic - highly recommended for sports injuries (https://practo.com/x)\n3. Rehab Plus"
    a = geo.analyse_answer(answer, b, ["ActiveLife Physiotherapy", "Rehab Plus"])
    assert a["mentioned"] and a["position"] == 2 and a["sentiment"] == "positive"
    assert a["competitors"] == ["ActiveLife Physiotherapy", "Rehab Plus"]
    assert a["cited_urls"] == ["https://practo.com/x"]
