from app.services import competitor_report as cr


def _m(key, label, ours, theirs, better, disp=None):
    return {"key": key, "label": label, "ours": ours, "competitor": theirs, "ours_display": disp or ours, "competitor_display": disp or theirs, "better": better, "available": True}


def test_report_lists_each_real_gap_in_priority_order_and_the_strengths():
    c = {"competitor": {"name": "Rival"},
         "overall": {"scores": [_m("performance", "Performance score", 40, 85, "competitor"), _m("seo", "SEO score", 95, 80, "ours")],
                     "core_web_vitals": [_m("lcp", "LCP", 4000, 2000, "competitor")]},
         "technical_seo": {"checks": [{"id": "canonical", "title": "Canonical", "description": "d", "status": "ours_fail_competitor_pass", "ours": {"display_value": None}},
                                      {"id": "x", "title": "X", "status": "ours_pass_competitor_fail"}]},
         "pages": {"matched": [{"path": "/", "ours": {"word_count": 100, "meta_description": "", "h1_count": 0, "schema_types": []}, "competitor": {"word_count": 900, "meta_description": "m", "h1_count": 1, "schema_types": ["FAQPage"]}}],
                   "unmatched_competitor": [{"title": "Teeth whitening cost"}]},
         "keywords_and_content_gaps": {"researched": {"items": [{"keyword": "teeth whitening", "side": "competitor", "volume": 900, "pages": 2}, {"keyword": "implants pune", "side": "client", "volume": 300, "pages": 1}]}}}
    r = cr.build(c)
    titles = [i["title"] for i in r["items"]]
    assert r["items"][0]["priority"] == "high" and r["counts"]["high"] >= 3
    assert "Make the site load faster" in titles and "Canonical" in titles and "Target “teeth whitening”" in titles
    assert any("much less content" in t for t in titles) and any("no meta description" in t for t in titles)
    assert any("SEO score: 95 vs 80" in s for s in r["strengths"]) and any("X: you pass" in s for s in r["strengths"])
    assert "Rival is ahead" in r["headline"]


def test_report_with_no_data_says_so():
    assert "not enough audit data" in cr.build({"overall": {}, "technical_seo": {}, "pages": {}})["headline"]
