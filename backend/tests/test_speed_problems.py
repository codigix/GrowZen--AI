"""Every speed problem Lighthouse reports reaches the audit, with the files behind it."""
from app.services import pagespeed


def _lh():
    mk = lambda **k: {"title": k.pop("title"), "description": "Fix it. [Learn more](https://x.dev)", "scoreDisplayMode": k.pop("mode", "numeric"), **k}
    audits = {
        "render-blocking-resources": mk(title="Eliminate render-blocking resources", score=0.2, displayValue="Est savings of 780 ms", details={"type": "opportunity", "overallSavingsMs": 780,
                                        "items": [{"url": "https://s.example/app.css", "totalBytes": 5000, "wastedMs": 400}]}),
        "unused-javascript": mk(title="Reduce unused JavaScript", score=0.3, details={"type": "opportunity", "overallSavingsBytes": 90000, "overallSavingsMs": 300,
                                "items": [{"url": "https://s.example/app.js", "totalBytes": 120000, "wastedBytes": 90000}]}),
        "bootup-time": mk(title="Reduce JavaScript execution time", score=0.4, displayValue="2.1 s", details={"type": "table", "items": [{"url": "https://s.example/app.js", "total": 2100, "scripting": 1900}]}),
        "errors-in-console": mk(title="Browser errors were logged", score=0, details={"type": "table", "items": [{"sourceLocation": {"url": "https://s.example/app.js", "line": 3}, "description": "boom"}]}),
        "viewport": mk(title="ok", score=1), "metrics": mk(title="m", score=None, mode="informative"),
    }
    cats = {"performance": {"auditRefs": [{"id": i} for i in ("render-blocking-resources", "unused-javascript", "bootup-time", "metrics")]}, "best-practices": {"auditRefs": [{"id": "errors-in-console"}, {"id": "viewport"}]}}
    return {"audits": audits, "categories": cats}


def test_every_problem_is_listed_with_its_files():
    p = pagespeed.speed_problems(_lh())
    assert [x["id"] for x in p][:2] == ["render-blocking-resources", "unused-javascript"]  # most costly first
    byid = {x["id"]: x for x in p}
    assert byid["render-blocking-resources"]["kind"] == "css_js" and byid["render-blocking-resources"]["items"][0]["url"].endswith("app.css")
    assert byid["bootup-time"]["items"][0]["scripting"] == 1900 and byid["errors-in-console"]["kind"] == "errors"
    assert byid["errors-in-console"]["items"][0]["sourceLocation"].endswith("app.js")
    assert "viewport" not in byid and "metrics" not in byid


def test_problems_become_audit_issues():
    res = {"seo_checks": [], "scores": {"performance": 40}, "metrics": {}, "opportunities": [], "speed_problems": pagespeed.speed_problems(_lh())}
    issues = pagespeed.issues_from(res)
    rb = next(i for i in issues if i["code"] == "lighthouse:render-blocking-resources")
    assert rb["area"] == "Speed" and "app.css" in rb["fix"]
