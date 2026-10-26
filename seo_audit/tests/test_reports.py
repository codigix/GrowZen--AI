from __future__ import annotations

from app.services import report_service


def test_normalize_report_extracts_scores(lighthouse_result):
    normalized = report_service.normalize_report(lighthouse_result)
    scores = report_service.extract_scores(normalized)
    assert scores["performance"] == 93
    assert scores["accessibility"] == 88
    assert scores["best_practices"] == 100
    assert scores["seo"] == 75


def test_normalize_report_classifies_audits(lighthouse_result):
    normalized = report_service.normalize_report(lighthouse_result)
    perf = normalized["audits_by_category"]["performance"]
    assert any(a["id"] == "render-blocking-resources" for a in perf["opportunities"])
    assert any(a["id"] == "uses-long-cache-ttl" for a in perf["diagnostics"])
    assert any(a["id"] == "unused-javascript" for a in perf["informational"])

    a11y = normalized["audits_by_category"]["accessibility"]
    assert any(a["id"] == "image-alt" for a in a11y["failed"])
    assert any(a["id"] == "color-contrast" for a in a11y["passed"])

    seo = normalized["audits_by_category"]["seo"]
    assert any(a["id"] == "meta-description" for a in seo["failed"])
    assert any(a["id"] == "document-title" for a in seo["passed"])


def test_normalize_report_extracts_metrics(lighthouse_result):
    normalized = report_service.normalize_report(lighthouse_result)
    assert normalized["metrics"]["first-contentful-paint"]["display_value"] == "1.2 s"
    assert normalized["metrics"]["cumulative-layout-shift"]["numeric_value"] == 0.001


def test_normalize_report_handles_missing_category_score():
    raw = {
        "categories": {"performance": {"id": "performance", "title": "Performance", "score": None, "auditRefs": []}},
        "audits": {},
    }
    normalized = report_service.normalize_report(raw)
    scores = report_service.extract_scores(normalized)
    assert scores["performance"] is None
    # Categories absent entirely from the raw report must still surface as N/A, never 0.
    assert scores["accessibility"] is None


def test_normalize_report_handles_missing_metrics():
    raw = {"categories": {}, "audits": {}}
    normalized = report_service.normalize_report(raw)
    assert normalized["metrics"] == {}


def test_normalize_report_parses_crux_field_data(lighthouse_result):
    field_data = {
        "overall_category": "FAST",
        "metrics": {
            "LARGEST_CONTENTFUL_PAINT_MS": {"category": "FAST", "percentile": 1500},
        },
    }
    normalized = report_service.normalize_report(lighthouse_result, field_data=field_data)
    assert normalized["field_data"]["overall_category"] == "FAST"
    assert normalized["field_data"]["metrics"]["largest-contentful-paint"]["percentile"] == 1500


def test_render_summary_html_labels_itself_as_non_original(lighthouse_result):
    normalized = report_service.normalize_report(lighthouse_result)
    html = report_service.render_summary_html(
        normalized, {"url": "https://example.com", "strategy": "mobile", "engine": "pagespeed", "completed_at": None}
    )
    assert "generated summary report" in html
    assert "not the original Lighthouse-generated HTML report" in html
    assert "example.com" in html
